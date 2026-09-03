import { sendWA, sendWATemplate } from '../whatsapp.ts'
import { extract10Digits, generateCloudinaryVIPCard } from '../../_shared/utils.ts'
import { enviarMenuPrincipal } from '../restaurant-b2b-handler.ts'

const MAX_PUNTOS_POR_ACCION = 10

function buildProgressBar(ptsActuales: number, meta: number): string {
  const totalSlots = meta
  const filled = Math.min(ptsActuales % meta === 0 && ptsActuales > 0 ? meta : ptsActuales % meta, meta)
  const bar = '🟩'.repeat(filled) + '⬜'.repeat(Math.max(0, totalSlots - filled))
  const restantes = meta - filled
  if (restantes === 0) return `${bar}\n🎉 *¡Completaste un ciclo! Tienes 1 envío GRATIS disponible.*`
  return `${bar} (${filled}/${meta})\n¡Solo te faltan *${restantes}* más para tu envío *GRATIS*! 🚀`
}

export async function handlePuntos(
  supabase: any,
  fromPhone: string,
  from10: string,
  restauranteId: string,
  nombreRest: string,
  state: string,
  stateObj: any,
  userInput: string,
  checkRateLimit: () => Promise<boolean>
): Promise<Response | null> {
  
  if (state === 'PUNTOS_TEL') {
    const cTel = extract10Digits(userInput)
    if (!cTel || cTel.length !== 10) { await sendWA(fromPhone, `⚠️ Número inválido. Escríbelo bien o "cancelar":`); return new Response('OK', { status: 200 }) }
    
    let { data: c } = await supabase.from('clientes').select('id, nombre').eq('telefono', cTel).maybeSingle()
    let esClienteNuevo = false

    if (!c) {
      esClienteNuevo = true
      const qrCode = generateCloudinaryVIPCard(cTel, cTel, 0, 0, false)
      const { error: insErr } = await supabase.from('clientes').insert({
        telefono: cTel,
        nombre: cTel,
        acepta_terminos: true,
        puntos: 0,
        qr_code: qrCode
      })
      if (!insErr) {
        c = { id: null, nombre: cTel }
      } else {
        const { data: reCheck } = await supabase.from('clientes').select('id, nombre').eq('telefono', cTel).maybeSingle()
        c = reCheck
      }
    }

    if (!c) {
      await supabase.from('bot_memory').delete().eq('phone', `b2b_state_${from10}`)
      await sendWA(fromPhone, `❌ Error interno al registrar al cliente. Intenta de nuevo.`)
      const { notifyAdmin } = await import('../whatsapp.ts')
      await notifyAdmin(`Error registrando cliente rápido en ${nombreRest}. Causa probable: falla en DB.`)
      await enviarMenuPrincipal(fromPhone, nombreRest, supabase, restauranteId)
      return new Response('OK', { status: 200 })
    }
    
    stateObj.state = 'PUNTOS_CANT'
    stateObj.cTel = cTel
    stateObj.cNombre = c.nombre || cTel
    stateObj.esClienteNuevo = esClienteNuevo
    await supabase.from('bot_memory').update({ history: [stateObj], updated_at: new Date().toISOString() }).eq('phone', `b2b_state_${from10}`)
    await sendWA(fromPhone,
      (esClienteNuevo ? `📋 _Cliente registrado automáticamente._\n\n` : '') +
      `🔢 ¿Cuántos puntos deseas sumar a *${stateObj.cNombre}*?\n(Ejemplo: 1 o 2. Máximo ${MAX_PUNTOS_POR_ACCION})`
    )
    return new Response('OK', { status: 200 })
  }

  if (state === 'PUNTOS_CANT') {
    const cant = Math.min(parseInt(userInput) || 0, MAX_PUNTOS_POR_ACCION)
    if (cant <= 0) { await sendWA(fromPhone, `⚠️ Escribe un número mayor a 0:`); return new Response('OK', { status: 200 }) }
    
    const cTel   = stateObj.cTel
    const cNombre = stateObj.cNombre
    await supabase.from('bot_memory').delete().eq('phone', `b2b_state_${from10}`)

    const { data: rpcResult, error: rpcError } = await supabase.rpc('fn_incrementar_puntos_restaurante', {
      p_restaurante_id: restauranteId,
      p_cliente_tel:    cTel,
      p_puntos:         cant
    })

    if (rpcError || !rpcResult?.ok) {
      await sendWA(fromPhone, `❌ Error al sumar puntos. Intenta de nuevo.`)
      const { notifyAdmin } = await import('../whatsapp.ts')
      await notifyAdmin(`Error sumando ${cant} pts en ${nombreRest} para ${cTel}. Error: ${rpcError?.message || 'RPC Failed'}`)
      return new Response('OK', { status: 200 })
    }

    const newPts     = rpcResult.puntos
    const newVisitas = rpcResult.visitas
    const META_B2B = 5
    const progressBar = buildProgressBar(newPts, META_B2B)

    await sendWA(fromPhone, `✅ Has sumado *${cant} punto(s)* a ${cNombre}.\n📊 Puntos en tu local: *${newPts} pts*\n👀 Visitas totales: ${newVisitas}`)
    
    if (stateObj.esClienteNuevo) {
      const templateResult = await sendWATemplate(`52${cTel}`, 'bienvendo_cte', [cNombre, nombreRest, cant.toString()], undefined, undefined, 'en')
      if (!templateResult.ok) {
        await sendWA(`52${cTel}`, `¡Hola ${cNombre}! 👋\n\n*${nombreRest}* te registró en el programa de recompensas de *Estrella Delivery* 🌟\n\n⭐ *Tus puntos: ${cant}*\nCada que pides a domicilio sumas puntos para tu envío GRATIS. ¡Escríbenos para consultar beneficios! 🔥`)
      }
    } else {
      const templateResult = await sendWATemplate(`52${cTel}`, 'estrella_puntos_acumulados', [cNombre, cant.toString(), newPts.toString()], undefined, cTel)
      if (!templateResult.ok) {
        await sendWA(`52${cTel}`, `⭐ *¡Sumamos puntos en ${nombreRest}!*\n\n${progressBar}`)
      }
    }
    await enviarMenuPrincipal(fromPhone, nombreRest, supabase, restauranteId)
    return new Response('OK', { status: 200 })
  }

  if (state === 'CANJEAR_TEL') {
    const cTel = extract10Digits(userInput)
    if (!cTel || cTel.length !== 10) { await sendWA(fromPhone, `⚠️ Número inválido. Escríbelo bien o "cancelar":`); return new Response('OK', { status: 200 }) }
    
    const { data: c } = await supabase.from('clientes').select('id, nombre, acepta_terminos').eq('telefono', cTel).maybeSingle()
    if (!c) {
      if (!(await checkRateLimit())) return new Response('OK', { status: 200 })
      await supabase.from('bot_memory').delete().eq('phone', `b2b_state_${from10}`)
      await sendWA(fromPhone, `❌ Cliente no encontrado.`)
      await enviarMenuPrincipal(fromPhone, nombreRest, supabase, restauranteId)
      return new Response('OK', { status: 200 })
    }
    
    const { data: restPts } = await supabase.from('restaurante_clientes_puntos').select('puntos').eq('restaurante_id', restauranteId).eq('cliente_tel', cTel).maybeSingle()
    const ptsDisponibles = restPts?.puntos || 0
    
    if (ptsDisponibles <= 0) {
      await supabase.from('bot_memory').delete().eq('phone', `b2b_state_${from10}`)
      await sendWA(fromPhone, `⚠️ El cliente *${c.nombre || cTel}* tiene *0 puntos* en tu local. No hay recompensas por canjear.`)
      await enviarMenuPrincipal(fromPhone, nombreRest, supabase, restauranteId)
      return new Response('OK', { status: 200 })
    }

    stateObj.state = 'CANJEAR_CANT'
    stateObj.cTel = cTel
    stateObj.cNombre = c.nombre || cTel
    stateObj.ptsDisp = ptsDisponibles
    await supabase.from('bot_memory').update({ history: [stateObj], updated_at: new Date().toISOString() }).eq('phone', `b2b_state_${from10}`)
    await sendWA(fromPhone, `🎟️ El cliente *${stateObj.cNombre}* tiene *${ptsDisponibles} puntos*.\n¿Cuántos puntos deseas canjear/descontar? (Ejemplo: 5)`)
    return new Response('OK', { status: 200 })
  }

  if (state === 'CANJEAR_CANT') {
    const cant = parseInt(userInput) || 0
    const ptsDisponibles = stateObj.ptsDisp || 0
    const cTel   = stateObj.cTel
    const cNombre = stateObj.cNombre
    
    if (cant <= 0 || cant > ptsDisponibles) { 
      await sendWA(fromPhone, `⚠️ Número inválido. Escribe una cantidad entre 1 y ${ptsDisponibles}, o escribe "cancelar".`)
      return new Response('OK', { status: 200 }) 
    }
    
    await supabase.from('bot_memory').delete().eq('phone', `b2b_state_${from10}`)

    const { data: rpcResult, error: rpcError } = await supabase.rpc('fn_incrementar_puntos_restaurante', {
      p_restaurante_id: restauranteId,
      p_cliente_tel:    cTel,
      p_puntos:         -cant
    })

    if (rpcError || !rpcResult?.ok) {
      await sendWA(fromPhone, `❌ Error interno al descontar puntos. Intenta de nuevo.`)
      return new Response('OK', { status: 200 })
    }

    const newPts = rpcResult.puntos
    await supabase.from('restaurante_loyalty_log').insert({ restaurante_id: restauranteId, cliente_tel: cTel, accion: 'canjear_recompensa', valor: cant, descripcion: `Canjeó recompensa` })

    await sendWA(fromPhone, `✅ Has canjeado *${cant} punto(s)* de ${cNombre}.\n📊 Saldo restante en tu local: *${newPts} pts*`)
    
    await sendWA(`52${cTel}`, `🎟️ *¡Recompensa Canjeada!*\n\nHas usado *${cant} puntos* en *${nombreRest}*. ¡Esperamos que lo hayas disfrutado! 🤤\n\nTe quedan ${newPts} puntos en este local.`)
    
    await enviarMenuPrincipal(fromPhone, nombreRest, supabase, restauranteId)
    return new Response('OK', { status: 200 })
  }

  return null
}
