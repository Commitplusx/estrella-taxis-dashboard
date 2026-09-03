import { sendWA, sendWATemplate } from '../whatsapp.ts'
import { extract10Digits, generateCloudinaryVIPCard } from '../../_shared/utils.ts'
import { enviarMenuPrincipal } from '../restaurant-b2b-handler.ts'

const MAX_REGALOS_POR_DIA = 2

export async function handleLealtad(
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
  
  if (state === 'AFILIAR_TEL') {
    const cTel = extract10Digits(userInput)
    if (!cTel || cTel.length !== 10) { await sendWA(fromPhone, `⚠️ Número inválido. Escribe los 10 dígitos o "cancelar":`); return new Response('OK', { status: 200 }) }
    
    const { data: exist } = await supabase.from('clientes').select('id, nombre, acepta_terminos').eq('telefono', cTel).maybeSingle()
    if (exist) {
      if (!exist.acepta_terminos) {
        await sendWA(fromPhone, `ℹ️ El cliente *${exist.nombre}* ya está en el sistema pero no ha aceptado los términos. Le reenviaré la invitación VIP.`)
        await sendWATemplate(`52${cTel}`, 'estrella_terminos_condiciones', [exist.nombre])
        await supabase.from('bot_memory').delete().eq('phone', `b2b_state_${from10}`)
        await enviarMenuPrincipal(fromPhone, nombreRest, supabase, restauranteId)
        return new Response('OK', { status: 200 })
      } else {
        await sendWA(fromPhone, `ℹ️ El cliente *${exist.nombre}* ya está registrado en el programa VIP. Pasando directamente a sumarle puntos...`)
        stateObj.state = 'PUNTOS_CANT'
        stateObj.cTel = cTel
        stateObj.cNombre = exist.nombre
        await supabase.from('bot_memory').update({ history: [stateObj], updated_at: new Date().toISOString() }).eq('phone', `b2b_state_${from10}`)
        await sendWA(fromPhone, `🔢 ¿Cuántos puntos deseas sumar a *${exist.nombre}*?\n(Ejemplo: 1 o 2. Máximo 10)`)
        return new Response('OK', { status: 200 })
      }
    }
    
    stateObj.state = 'AFILIAR_NOM'
    stateObj.cTel = cTel
    await supabase.from('bot_memory').update({ history: [stateObj], updated_at: new Date().toISOString() }).eq('phone', `b2b_state_${from10}`)
    await sendWA(fromPhone, `✍️ Escribe el *Nombre* del cliente:`)
    return new Response('OK', { status: 200 })
  }

  if (state === 'AFILIAR_NOM') {
    const cTel = stateObj.cTel
    const nombreLimpio = userInput.slice(0, 60)
    await supabase.from('bot_memory').delete().eq('phone', `b2b_state_${from10}`)
    
    const tz = 'America/Mexico_City';
    const dateStr = new Date().toLocaleString("en-US", { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const [month, day, year] = dateStr.split('/');
    const isoStart = `${year}-${month}-${day}T00:00:00.000-06:00`;
    const startOfTodayMX = new Date(isoStart).toISOString();
    
    const { count } = await supabase.from('restaurante_loyalty_log').select('id', { count: 'exact', head: true })
      .eq('restaurante_id', restauranteId).eq('accion', 'afiliar_cliente').gte('created_at', startOfTodayMX)
    const afiliacionesHoy = count || 0
    if (afiliacionesHoy >= 15) {
      await supabase.from('bot_memory').delete().eq('phone', `b2b_state_${from10}`)
      await sendWA(fromPhone, `⚠️ Has alcanzado tu límite de seguridad de *15 invitaciones VIP* por hoy.\nPor favor, intenta de nuevo mañana.`)
      await enviarMenuPrincipal(fromPhone, nombreRest, supabase, restauranteId)
      return new Response('OK', { status: 200 })
    }

    const qrCode = generateCloudinaryVIPCard(cTel, nombreLimpio, 0, 0, false)
    const { error } = await supabase.from('clientes').insert({ telefono: cTel, nombre: nombreLimpio, acepta_terminos: false, puntos: 0, qr_code: qrCode })
    
    if (error) { await sendWA(fromPhone, `❌ Error interno al registrar. Posiblemente el cliente ya existe.`); return new Response('OK', { status: 200 }) }
    
    await supabase.from('restaurante_loyalty_log').insert({ restaurante_id: restauranteId, cliente_tel: cTel, accion: 'afiliar_cliente', valor: 0, descripcion: `Afilió a ${nombreLimpio}` })
    
    await supabase.from('bot_memory').upsert({
      phone: `pending_rest_invite_${cTel}`,
      history: [{ restPhone: fromPhone, restName: nombreRest }],
      updated_at: new Date().toISOString()
    })
    
    await sendWA(fromPhone, `🎉 *${nombreLimpio}* ha sido afiliado en el sistema.\nLe estoy enviando la invitación oficial a los Términos y Condiciones ahora mismo. 📲`)
    
    const templateResult = await sendWATemplate(`52${cTel}`, 'estrella_terminos_condiciones', [nombreLimpio])
    if (!templateResult.ok) {
       await sendWA(fromPhone, `⚠️ Hubo un problema al enviar la invitación a WhatsApp: ${templateResult.error?.substring(0,100)}`)
    }
    await enviarMenuPrincipal(fromPhone, nombreRest, supabase, restauranteId)
    return new Response('OK', { status: 200 })
  }

  if (state === 'INFO_TEL') {
    const cTel = extract10Digits(userInput)
    await supabase.from('bot_memory').delete().eq('phone', `b2b_state_${from10}`)
    if (!cTel || cTel.length !== 10) { 
      await sendWA(fromPhone, `⚠️ Número inválido.`); 
      await enviarMenuPrincipal(fromPhone, nombreRest, supabase, restauranteId); 
      return new Response('OK', { status: 200 }) 
    }

    const [{ data: c }, { data: restPts }] = await Promise.all([
      supabase.from('clientes').select('nombre, reputacion, envios_gratis_disponibles').eq('telefono', cTel).maybeSingle(),
      supabase.from('restaurante_clientes_puntos').select('puntos, visitas').eq('restaurante_id', restauranteId).eq('cliente_tel', cTel).maybeSingle()
    ])

    if (!c) { 
      if (!(await checkRateLimit())) return new Response('OK', { status: 200 })
      await sendWA(fromPhone, `❌ Cliente no encontrado en el sistema.`); 
      await enviarMenuPrincipal(fromPhone, nombreRest, supabase, restauranteId); 
      return new Response('OK', { status: 200 }) 
    }

    const enviosGratis = c.envios_gratis_disponibles || 0
    const lineaEnvios = enviosGratis > 0
      ? `🎁 Envíos gratis disponibles: *${enviosGratis}* 🎉`
      : `🎁 Envíos gratis: *Ninguno aún*`

    const info =
      `📊 *Perfil VIP — ${c.nombre || cTel}*\n` +
      `📞 Tel: \`${cTel}\`\n` +
      `🗣️ Reputación: *${c.reputacion || 'Sin calificar'}*\n` +
      `───────────────────\n` +
      `🏪 *Lealtad en tu Local:*\n` +
      `⭐ Puntos aquí: *${restPts?.puntos || 0}*\n` +
      `👀 Visitas: *${restPts?.visitas || 0}*\n` +
      `───────────────────\n` +
      `🛵 *Estrella Delivery:*\n` +
      lineaEnvios

    await sendWA(fromPhone, info)
    await enviarMenuPrincipal(fromPhone, nombreRest, supabase, restauranteId)
    return new Response('OK', { status: 200 })
  }

  if (state === 'REGALAR_TEL') {
    const cTel = extract10Digits(userInput)
    await supabase.from('bot_memory').delete().eq('phone', `b2b_state_${from10}`)
    if (!cTel || cTel.length !== 10) { 
      await sendWA(fromPhone, `⚠️ Número inválido. Escribe los 10 dígitos del celular del cliente.`); 
      await enviarMenuPrincipal(fromPhone, nombreRest, supabase, restauranteId); 
      return new Response('OK', { status: 200 }) 
    }

    const tz = 'America/Mexico_City';
    const dateStr = new Date().toLocaleString("en-US", { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const [month, day, year] = dateStr.split('/');
    const isoStart = `${year}-${month}-${day}T00:00:00.000-06:00`;
    const startOfTodayMX = new Date(isoStart).toISOString();
    
    const { count } = await supabase.from('restaurante_loyalty_log').select('id', { count: 'exact', head: true })
      .eq('restaurante_id', restauranteId).eq('accion', 'regalar_envio').gte('created_at', startOfTodayMX)
    const regalosHoy = count || 0
    if (regalosHoy >= MAX_REGALOS_POR_DIA) {
      await sendWA(fromPhone,
        `🚫 *Límite del día alcanzado*\n\n` +
        `Ya usaste tus *${MAX_REGALOS_POR_DIA} envíos gratis* de hoy.\n` +
        `Mañana se reinicia el contador. ⏰`
      )
      await enviarMenuPrincipal(fromPhone, nombreRest, supabase, restauranteId)
      return new Response('OK', { status: 200 })
    }

    let { data: c } = await supabase.from('clientes').select('nombre').eq('telefono', cTel).maybeSingle()
    let nombreCliente = c?.nombre || cTel
    let esNuevo = false

    if (!c) {
      esNuevo = true
      const qrCode = generateCloudinaryVIPCard(cTel, cTel, 0, 0, false)
      const { error: insErr } = await supabase.from('clientes').insert({
        telefono: cTel,
        nombre: cTel,
        acepta_terminos: true,
        puntos: 0,
        qr_code: qrCode
      })
      if (insErr) {
        const { data: reCheck } = await supabase.from('clientes').select('nombre').eq('telefono', cTel).maybeSingle()
        nombreCliente = reCheck?.nombre || cTel
      }
    }

    await supabase.rpc('increment_cliente_envios_gratis', { p_tel: cTel, p_amount: 1 })
    await supabase.from('restaurante_loyalty_log').insert({
      restaurante_id: restauranteId,
      cliente_tel: cTel,
      accion: 'regalar_envio',
      valor: 1,
      descripcion: `Regalo de ${nombreRest}${esNuevo ? ' (cliente nuevo)' : ''}`
    })

    const quedan = MAX_REGALOS_POR_DIA - (regalosHoy + 1)
    await sendWA(fromPhone,
      `🎁 *¡Envío regalado!*\n\n` +
      `✅ El cliente *${nombreCliente}* tiene 1 envío gratis acreditado.\n` +
      (esNuevo ? `📋 _Lo registramos automáticamente en el sistema._\n` : '') +
      `\n📊 Regalos de hoy: *${regalosHoy + 1}/${MAX_REGALOS_POR_DIA}*` +
      (quedan > 0 ? ` (te queda${quedan === 1 ? '' : 'n'} *${quedan}* más hoy)` : ` — *límite del día alcanzado*`)
    )
    
    const notifyResult = await sendWATemplate(`52${cTel}`, 'estrella_regalo_envio', [nombreRest])
    if (!notifyResult.ok) {
      await sendWA(`52${cTel}`,
        `🎁 *¡${nombreRest} te regaló un envío gratis!*\n\n` +
        `Tu próximo envío con *Estrella Delivery* es *GRATIS* gracias a *${nombreRest}* 🌟\n\n` +
        `¡Úsalo cuando quieras! Solo escríbenos aquí y te lo aplicamos automáticamente. 🛵💨`
      )
    }

    await enviarMenuPrincipal(fromPhone, nombreRest, supabase, restauranteId)
    return new Response('OK', { status: 200 })
  }

  if (state === 'BROADCAST_TXT') {
    const promoText = userInput.slice(0, 250)
    await supabase.from('bot_memory').delete().eq('phone', `b2b_state_${from10}`)

    if (promoText.length < 5) {
      await sendWA(fromPhone, `⚠️ Promoción muy corta. Envío cancelado.`)
      await enviarMenuPrincipal(fromPhone, nombreRest, supabase, restauranteId)
      return new Response('OK', { status: 200 })
    }

    await sendWA(fromPhone, `⏳ *Procesando envío masivo...*\n\nBuscando a tus mejores clientes VIP (Top 20). Esto puede tomar unos segundos.`)

    const { data: topClients } = await supabase.from('restaurante_clientes_puntos')
      .select('cliente_tel, puntos, visitas')
      .eq('restaurante_id', restauranteId)
      .order('puntos', { ascending: false })
      .limit(20)

    if (!topClients || topClients.length === 0) {
      await sendWA(fromPhone, `❌ No tienes clientes registrados aún para enviar la promoción.`)
      await enviarMenuPrincipal(fromPhone, nombreRest, supabase, restauranteId)
      return new Response('OK', { status: 200 })
    }

    const tels = topClients.map((c: any) => c.cliente_tel)
    const { data: profiles } = await supabase.from('clientes').select('telefono, nombre').in('telefono', tels)
    const profileMap = new Map((profiles || []).map((p: any) => [p.telefono, p.nombre]))

    let sent = 0
    const promises = topClients.map(async (c: any) => {
      const tel = c.cliente_tel
      const nombre = profileMap.get(tel) || tel
      const templateResult = await sendWATemplate(`52${tel}`, 'estrella_promo_aliado', [nombre, nombreRest, promoText])
      if (templateResult.ok) {
        sent++
        await supabase.from('bot_memory').upsert({
          phone: `last_promo_${tel}`,
          history: [{ restId: restauranteId, restName: nombreRest, promoText }],
          updated_at: new Date().toISOString()
        })
      }
      await new Promise(r => setTimeout(r, 100))
    })

    await Promise.allSettled(promises)

    await sendWA(fromPhone, `✅ *¡Promoción enviada con éxito!*\n\nSe entregó a *${sent} clientes VIP* de tu local.\n\n_Recuerda estar atento a tus pedidos. 🛵_`)
    
    const { notifyAdmin } = await import('../whatsapp.ts')
    await notifyAdmin(`📢 *Broadcast B2B* enviado por ${nombreRest} a ${sent} clientes:\n"${promoText}"`)

    await enviarMenuPrincipal(fromPhone, nombreRest, supabase, restauranteId)
    return new Response('OK', { status: 200 })
  }

  return null
}
