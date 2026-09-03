// rep-handler.ts — Lógica del repartidor: botones y mensajes de texto
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendWA, sendInteractiveList, sendVIPCardSmart } from './whatsapp.ts'
import { extract10Digits, guardarMemoria } from './db.ts'
import { generateCloudinaryVIPCard } from '../_shared/utils.ts'
import { conversacionDeepSeek } from './ai.ts'

type Supa = ReturnType<typeof createClient>
const ADMIN_PHONES_ENV = Deno.env.get('ADMIN_PHONES') ?? Deno.env.get('ADMIN_PHONE') ?? ''
const _adminMain10 = ADMIN_PHONES_ENV.split(',').map((s: string) => extract10Digits(s)).filter(Boolean)[0] ?? ''
const ADMIN_PHONE_MAIN = _adminMain10 ? `52${_adminMain10}` : ''

// ── Log de auditoría del repartidor ─────────────────────────────────────────
async function logRep(
  supabase: Supa,
  repTel: string,
  repNombre: string,
  accion: string,
  clienteTel?: string,
  detalle?: string
): Promise<void> {
  try {
    await supabase.from('repartidor_log').insert({
      repartidor_tel: repTel,
      repartidor_nombre: repNombre,
      accion,
      cliente_tel: clienteTel ?? null,
      detalle: detalle ?? null
    })
  } catch (e) {
    console.error('[REP_LOG] Error guardando log:', e)
  }
}

// ── Menú principal del Repartidor como Lista Interactiva ─────────────────────
async function enviarMenuRepartidor(fromPhone: string, nombre: string): Promise<void> {
  await sendInteractiveList(
    fromPhone,
    `🛵 *Hola ${nombre.split(' ')[0]}!*\n¿Qué deseas hacer?`,
    `Ver opciones`,
    [
      {
        title: '👤 Gestión de Clientes',
        rows: [
          { id: 'REP_CMD_INFO',         title: '🔍 Info de Cliente',     description: 'Ver ficha y puntos' },
          { id: 'REP_CMD_QR',           title: '🎟️ Enviar Tarjeta VIP',  description: 'Reenviar QR al cliente' },
          { id: 'REP_CMD_LOYALTY',      title: '🌟 Registro Loyalty',    description: 'Alta completa con T&C y QR' },
          { id: 'REP_CMD_SCORE',        title: '📝 Calificar Cliente',   description: 'Registrar reputación' },
          { id: 'REP_CMD_DIRECCION',    title: '🏠 Actualizar Dirección',description: 'Guardar nueva dirección' },
          { id: 'REP_CMD_NOREGISTRADO', title: '🔇 Registro Express',    description: 'Alta silenciosa sin T&C' },
        ]
      },
      {
        title: '⚙️ Operativo',
        rows: [
          { id: 'REP_CMD_CUPON',   title: '🎟️ Usar Cupón',     description: 'Marcar código como usado' },
          { id: 'REP_CMD_SOS',     title: '🚨 Enviar SOS',      description: 'Alerta de emergencia al admin' },
          { id: 'REP_CMD_AYUDA',   title: '❓ Ayuda',           description: 'Ver comandos disponibles' },
        ]
      }
    ]
  )
}

// ── Estado de sesión del repartidor para flujos multi-paso ───────────────────
async function setRepState(supabase: Supa, from10: string, state: object): Promise<void> {
  await supabase.from('bot_memory').upsert({
    phone: `rep_state_${from10}`,
    history: [state],
    updated_at: new Date().toISOString()
  })
}
async function getRepState(supabase: Supa, from10: string): Promise<any | null> {
  const { data } = await supabase.from('bot_memory').select('history').eq('phone', `rep_state_${from10}`).maybeSingle()
  return data?.history?.[0] ?? null
}
async function clearRepState(supabase: Supa, from10: string): Promise<void> {
  await supabase.from('bot_memory').delete().eq('phone', `rep_state_${from10}`)
}

// ── Botones del ciclo de vida del pedido ─────────────────────────────────────
export async function handleRepButtons(
  supabase: Supa,
  fromPhone: string,
  buttonId: string,
  repData?: { nombre: string } | null
): Promise<boolean> {
  const from10 = extract10Digits(fromPhone)

  // ── Manejo del menú interactivo del repartidor ────────────────────────────
  if (buttonId.startsWith('REP_CMD_')) {
    const cmd = buttonId.replace('REP_CMD_', '')
    const prompts: Record<string, string> = {
      INFO:         '🔍 Escribe el *número a 10 dígitos* del cliente a consultar:',
      QR:           '🎟️ Escribe el *número a 10 dígitos* del cliente para reenviarle su Tarjeta VIP:',
      SCORE:        '📝 Escribe el *número a 10 dígitos* del cliente a calificar:',
      DIRECCION:    '🏠 Escribe el *número a 10 dígitos* del cliente cuya dirección quieres actualizar:',
      NOREGISTRADO: '🔇 Escribe el *número a 10 dígitos* del cliente a registrar silenciosamente:',
      LOYALTY:      '🌟 Escribe el *número a 10 dígitos* del cliente para el Registro Loyalty completo:',
      CUPON:        '🎟️ Escribe el *código del cupón* a marcar como usado (Ejemplo: EST-ABC123):',
      SOS:          '🚨 Escribe tu *mensaje de emergencia* para enviar al administrador:',
      AYUDA:        '__help__',
    }
    const prompt = prompts[cmd]
    if (!prompt) return false

    if (cmd === 'AYUDA') {
      await enviarMenuRepartidor(fromPhone, repData?.nombre || 'Repartidor')
      return true
    }

    const repState = await getRepState(supabase, from10)
    if (repState?.prefill) {
      const prefill = repState.prefill as string
      await setRepState(supabase, from10, { cmd })
      // Llamar directamente a ejecutarComando con el teléfono ya conocido
      // evita que handleRepMessage lo busque en el estado otra vez
      await ejecutarComando(
        supabase, fromPhone, from10,
        cmd === 'NOREGISTRADO' ? 'NOREGISTRADO_TEL' :
        cmd === 'SCORE'        ? 'SCORE_TEL' :
        cmd === 'DIRECCION'    ? 'DIRECCION_TEL' :
        cmd,
        prefill,
        repData?.nombre || 'Repartidor'
      )
      return true
    }

    await setRepState(supabase, from10, { cmd })
    await sendWA(fromPhone, prompt)
    return true
  }

  // ── Cupones (botón físico legacy) ─────────────────────────────────────────
  const [action, ...rest] = buttonId.split('_')
  if (action !== 'BTN') return false
  const tipo = rest[0]

  try {
    if (tipo === 'CUPON') {
      const codigo = rest.slice(1).join('_')
      // BUG-C4 fix: was using direct UPDATE which could race with the modern RPC path.
      // Now uses the same usar_cupon RPC as the REP_CMD_CUPON flow, guaranteeing
      // idempotency regardless of which path processes the coupon first.
      const { data, error } = await (supabase as any).rpc('usar_cupon', { p_codigo: codigo })
      if (error) {
        await sendWA(fromPhone, `❌ Error interno al procesar el cupón: ${error.message}`)
      } else if (data?.ok) {
        if (data.cliente_tel) {
          await supabase.from('clientes').update({ cupon_activo: null }).eq('telefono', data.cliente_tel)
        }
        await sendWA(fromPhone, `✅ Cupón *${codigo}* marcado como usado. ¡Buen trabajo!`)
        if (ADMIN_PHONE_MAIN) await sendWA(ADMIN_PHONE_MAIN, `🎟️ [OP] Repartidor marcó cupón ${codigo} como usado.`)
      } else {
        await sendWA(fromPhone, `⚠️ Ese cupón ya fue usado o no existe.`)
      }
      return true
    }


    if (tipo === 'ACEPTAR') {
      const pedidoId = rest.slice(1).join('_')
      
      // Guard de idempotencia: solo avanzar si el pedido aún está en un estado
      // que permita aceptación. Evita que el repartidor revierta accidentalmente
      // el estado 'en_cocina' o posterior a 'recibido'.
      const ESTADOS_ACEPTABLES = ['pendiente', 'pagado', 'aceptado', 'asignado']
      
      const { data: pedido } = await supabase.from('pedidos')
        .update({ estado: 'recibido' })
        .eq('id', pedidoId)
        .in('estado', ESTADOS_ACEPTABLES)  // <-- Guard clave
        .select('*')
        .maybeSingle()

      if (pedido) {
        // Armar el mensaje detallado para el repartidor
        let msg = `✅ *¡Servicio Aceptado!*\n\n`
        msg += `📦 *Detalle:* ${pedido.descripcion || 'Sin descripción'}\n`
        
        if (pedido.restaurante) msg += `🍽️ *Restaurante:* ${pedido.restaurante}\n`
        if (pedido.origen) msg += `🛳️ *Origen:* ${pedido.origen}\n`
        
        if (pedido.cliente_nombre) msg += `👤 *Cliente:* ${pedido.cliente_nombre}\n`
        if (pedido.cliente_tel) {
          const tel10 = extract10Digits(pedido.cliente_tel)
          if (tel10) msg += `📞 *Teléfono:* wa.me/52${tel10}\n`
        }

        if (pedido.direccion) msg += `🛬 *Destino:* ${pedido.direccion}\n`
        if (pedido.lat && pedido.lng) msg += `📍 *Mapa Destino:* https://maps.google.com/?q=${pedido.lat},${pedido.lng}\n`

        await sendWA(fromPhone, msg)

        // Disparar función para avisar al cliente
        supabase.functions.invoke('notificar-whatsapp', {
          body: { pedido_id: pedido.id, tipo: 'aceptado' }
        }).catch(err => console.error("Error al notificar al cliente que fue recibido:", err))

      } else {
        // Si no actualizó ninguna fila, puede ser que el pedido ya estaba en cocina
        const { data: pedidoActual } = await supabase.from('pedidos')
          .select('estado, descripcion, restaurante')
          .eq('id', pedidoId)
          .maybeSingle()
        
        if (pedidoActual && !ESTADOS_ACEPTABLES.includes(pedidoActual.estado)) {
          await sendWA(fromPhone, `ℹ️ El pedido ya está en estado *${pedidoActual.estado}*. No se puede revertir. El restaurante ya lo está preparando.`)
        } else {
          await sendWA(fromPhone, `⚠️ El pedido ya no existe o ya fue asignado a alguien más.`)
        }
      }
      return true
    }
  } catch (err) {
    console.error('[REP HANDLER] Button Error:', err)
    await sendWA(fromPhone, `⚠️ Ocurrió un error. Intenta de nuevo o usa /sos.`)
  }
  return true
}

// ── Ejecutar comando del repartidor con el teléfono ya capturado ─────────────
async function ejecutarComando(
  supabase: Supa,
  fromPhone: string,
  from10: string,
  cmd: string,
  valor: string,
  repNombre: string
): Promise<void> {

  // ── INFO ──────────────────────────────────────────────────────────────────
  if (cmd === 'INFO') {
    const tel = extract10Digits(valor)
    if (!tel || tel.length !== 10) { await sendWA(fromPhone, `⚠️ Número inválido. Intenta de nuevo con 10 dígitos.`); return }
    const { data: c } = await supabase.from('clientes')
      .select('nombre, puntos, reputacion, saldo_billetera, es_vip, rango, direccion, acepta_terminos')
      .eq('telefono', tel).maybeSingle()
    if (!c) { await sendWA(fromPhone, `❌ No encontré al cliente *${tel}*.`); return }
    const repIcon: Record<string, string> = { excelente: '🌟', bueno: '👍', regular: '⚠️', malo: '❌', vetado: '🚫' }
    const icon = repIcon[c.reputacion] || '❓'
    await sendWA(fromPhone,
      `📋 *Ficha de Cliente*\n` +
      `👤 *Nombre:* ${c.nombre || 'Sin nombre'}\n` +
      `📱 *Tel:* ${tel}\n` +
      `${icon} *Reputación:* ${c.reputacion || 'Sin calificar'}\n` +
      `⭐ *Puntos Estrella:* ${c.puntos ?? 0}\n` +
      `💰 *Saldo Billetera:* $${(c.saldo_billetera ?? 0).toFixed(2)}\n` +
      `👑 *VIP:* ${c.es_vip ? 'Sí' : 'No'} | *Rango:* ${c.rango || 'bronce'}\n` +
      `✅ *T&C:* ${c.acepta_terminos ? 'Aceptados' : 'Pendientes'}\n` +
      `🏠 *Dirección:* ${c.direccion || 'Sin registrar'}`
    )
    await logRep(supabase, from10, repNombre, 'info', tel, c.nombre || 'sin nombre')
    return
  }

  // ── QR ────────────────────────────────────────────────────────────────────
  if (cmd === 'QR') {
    const tel = extract10Digits(valor)
    if (!tel || tel.length !== 10) { await sendWA(fromPhone, `⚠️ Número inválido.`); return }
    const { data: c } = await supabase.from('clientes')
      .select('nombre, puntos, saldo_billetera, es_vip').eq('telefono', tel).maybeSingle()
    if (!c) { await sendWA(fromPhone, `❌ Cliente *${tel}* no encontrado.`); return }
    const qrUrl = generateCloudinaryVIPCard(tel, c.nombre || 'Cliente', c.puntos || 0, c.saldo_billetera || 0, c.es_vip || false)
    const result = await sendVIPCardSmart(`52${tel}`, qrUrl, c.nombre || 'Cliente', c.puntos || 0, tel)
    if (result.ok) {
      await sendWA(fromPhone, `✅ Tarjeta VIP reenviada a *${c.nombre || tel}*.`)
    } else {
      await sendWA(fromPhone, `⚠️ No pude enviar la tarjeta. El cliente tiene más de 24h inactivo en WhatsApp.`)
    }
    await logRep(supabase, from10, repNombre, 'qr', tel, result.ok ? 'enviado' : 'bloqueado 24h')
    return
  }

  // ── SCORE ─────────────────────────────────────────────────────────────────
  if (cmd === 'SCORE_TEL') {
    const tel = extract10Digits(valor)
    if (!tel || tel.length !== 10) { await sendWA(fromPhone, `⚠️ Número inválido.`); return }
    const { data: c } = await supabase.from('clientes').select('id, nombre, reputacion').eq('telefono', tel).maybeSingle()
    if (!c) { await sendWA(fromPhone, `❌ Cliente *${tel}* no encontrado.`); return }
    // Guardar teléfono en estado y pedir calificación
    await setRepState(supabase, from10, { cmd: 'SCORE_REP', tel, nombre: c.nombre })
    const repIcon: Record<string, string> = { excelente: '🌟', bueno: '👍', regular: '⚠️', malo: '❌', vetado: '🚫' }
    await sendInteractiveList(
      fromPhone,
      `📝 Calificar a *${c.nombre || tel}*\nReputación actual: ${repIcon[c.reputacion] || '❓'} ${c.reputacion || 'sin calificar'}\n\n¿Cuál es tu evaluación?`,
      'Elegir calificación',
      [{
        title: 'Calificación',
        rows: [
          { id: `REP_SCORE_excelente_${tel}`, title: '🌟 Excelente', description: 'Cliente ideal, siempre puntual' },
          { id: `REP_SCORE_bueno_${tel}`,     title: '👍 Bueno',     description: 'Sin problemas relevantes' },
          { id: `REP_SCORE_regular_${tel}`,   title: '⚠️ Regular',   description: 'Algunos inconvenientes' },
          { id: `REP_SCORE_malo_${tel}`,      title: '❌ Malo',       description: 'Problemas serios' },
        ]
      }]
    )
    return
  }

  // ── SCORE_REP (selección de la lista) ─────────────────────────────────────
  if (cmd.startsWith('SCORE_') && cmd !== 'SCORE_TEL' && cmd !== 'SCORE_REP') {
    // viene como REP_SCORE_excelente_9631234567
    const parts = cmd.split('_') // ['SCORE', 'excelente', '9631234567']
    const rep = parts[1] as string
    const tel = parts[2] as string
    const { data: c } = await supabase.from('clientes').select('id, nombre').eq('telefono', tel).maybeSingle()
    if (!c) { await sendWA(fromPhone, `❌ No encontré al cliente.`); return }
    const repMap: Record<string, string> = { excelente: '🌟', bueno: '👍', regular: '⚠️', malo: '❌' }
    await supabase.from('clientes').update({ reputacion: rep }).eq('id', c.id)
    await sendWA(fromPhone, `${repMap[rep] || '✅'} Calificación guardada: *${c.nombre}* → *${rep}*`)
    if (ADMIN_PHONE_MAIN) await sendWA(ADMIN_PHONE_MAIN, `📝 [OP] *${repNombre}* calificó a ${c.nombre || tel} como *${rep}*.`)
    await logRep(supabase, from10, repNombre, 'score', tel, rep)
    return
  }

  // ── DIRECCION_TEL ─────────────────────────────────────────────────────────
  if (cmd === 'DIRECCION_TEL') {
    const tel = extract10Digits(valor)
    if (!tel || tel.length !== 10) { await sendWA(fromPhone, `⚠️ Número inválido.`); return }
    const { data: c } = await supabase.from('clientes').select('nombre, direccion').eq('telefono', tel).maybeSingle()
    if (!c) { await sendWA(fromPhone, `❌ Cliente *${tel}* no encontrado.`); return }
    await setRepState(supabase, from10, { cmd: 'DIRECCION_NUEVA', tel, nombre: c.nombre })
    await sendWA(fromPhone, `🏠 *${c.nombre || tel}*\nDirección actual: _${c.direccion || 'Sin registrar'}_\n\nEscribe la *nueva dirección completa*:`)
    return
  }

  // ── DIRECCION_NUEVA ───────────────────────────────────────────────────────
  if (cmd === 'DIRECCION_NUEVA') {
    const { handleActualizarDireccion } = await import('./client-profile-handler.ts')
    const state = await getRepState(supabase, from10)
    const tel = state?.tel
    if (!tel) { await sendWA(fromPhone, `⚠️ Sesión expirada. Intenta de nuevo.`); return }
    await clearRepState(supabase, from10)
    await handleActualizarDireccion(supabase, fromPhone, tel, valor)
    if (ADMIN_PHONE_MAIN) await sendWA(ADMIN_PHONE_MAIN, `🏠 [OP] *${repNombre}* actualizó dirección de ${tel}: "${valor}"`)
    await logRep(supabase, from10, repNombre, 'direccion', tel, valor)
    return
  }

  // ── NOREGISTRADO ──────────────────────────────────────────────────────────
  if (cmd === 'NOREGISTRADO_TEL') {
    const tel = extract10Digits(valor)
    if (!tel || tel.length !== 10) { await sendWA(fromPhone, `⚠️ Número inválido.`); return }
    const { data: existe } = await supabase.from('clientes').select('id').eq('telefono', tel).maybeSingle()
    if (existe) { await sendWA(fromPhone, `ℹ️ El cliente *${tel}* ya está registrado en el sistema.`); return }
    await setRepState(supabase, from10, { cmd: 'NOREGISTRADO_NOMBRE', tel })
    await sendWA(fromPhone, `🌟 Registro express para *${tel}*\n\nEscribe el *nombre completo* del cliente:`)
    return
  }

  if (cmd === 'NOREGISTRADO_NOMBRE') {
    const state = await getRepState(supabase, from10)
    const tel = state?.tel
    if (!tel) { await sendWA(fromPhone, `⚠️ Sesión expirada. Intenta de nuevo.`); return }
    await clearRepState(supabase, from10)
    const nombre = valor.trim()
    const loyaltyUrl = `https://www.app-estrella.shop/loyalty/${tel}`
    const { error } = await supabase.from('clientes').insert({
      telefono: tel, nombre, puntos: 0, acepta_terminos: false, qr_code: loyaltyUrl
    })
    if (error) {
      await sendWA(fromPhone, `❌ Error al registrar: ${error.message}`)
    } else {
      await sendWA(fromPhone, `✅ *${nombre}* (${tel}) registrado silenciosamente.\nPuedes sumarle puntos en cualquier momento.`)
      if (ADMIN_PHONE_MAIN) await sendWA(ADMIN_PHONE_MAIN, `🌟 [OP] *${repNombre}* registró a ${nombre} (${tel}) silenciosamente.`)
      await logRep(supabase, from10, repNombre, 'noregistrado', tel, nombre)
    }
    return
  }

  // ── LOYALTY (registro completo con T&C y QR) ──────────────────────────────
  if (cmd === 'LOYALTY') {
    const tel = extract10Digits(valor)
    if (!tel || tel.length !== 10) { await sendWA(fromPhone, `⚠️ Número inválido.`); return }
    const { data: existe } = await supabase.from('clientes').select('id, nombre, acepta_terminos').eq('telefono', tel).maybeSingle()
    if (existe && existe.acepta_terminos) {
      await sendWA(fromPhone, `ℹ️ *${existe.nombre}* (${tel}) ya está registrado y aceptó los Términos. No necesita registro nuevo.`)
      return
    }
    await setRepState(supabase, from10, { cmd: 'LOYALTY_NOMBRE', tel, yaExiste: !!existe, nombreActual: existe?.nombre })
    await sendWA(fromPhone,
      existe
        ? `ℹ️ *${existe.nombre}* (${tel}) ya existe pero no aceptó los Términos.\n\nEscribe su nombre para confirmarlo o corregirlo:`
        : `🌟 Registro Loyalty para *${tel}*\n\nEscribe el *nombre completo* del cliente:`
    )
    return
  }

  if (cmd === 'LOYALTY_NOMBRE') {
    const state = await getRepState(supabase, from10)
    if (!state?.tel) { await sendWA(fromPhone, `⚠️ Sesión expirada. Intenta de nuevo.`); return }
    await setRepState(supabase, from10, { ...state, cmd: 'LOYALTY_COLONIA', nombre: valor.trim() })
    await sendWA(fromPhone, `🏠 ¿En qué colonia o zona vive *${valor.trim()}*?\n_(Escribe la colonia o zona. Escribe *omitir* si no la sabes)_`)
    return
  }

  if (cmd === 'LOYALTY_COLONIA') {
    const state = await getRepState(supabase, from10)
    if (!state?.tel) { await sendWA(fromPhone, `⚠️ Sesión expirada. Intenta de nuevo.`); return }
    await clearRepState(supabase, from10)

    const tel      = state.tel as string
    const nombre   = state.nombre as string
    const colonia  = valor.trim().toLowerCase() === 'omitir' ? null : valor.trim()
    const loyaltyUrl = `https://www.app-estrella.shop/loyalty/${tel}`
    const { sendWATemplate } = await import('./whatsapp.ts')

    // Crear o actualizar cliente
    if (state.yaExiste) {
      await supabase.from('clientes').update({ nombre, direccion: colonia, qr_code: loyaltyUrl }).eq('telefono', tel)
    } else {
      const { error } = await supabase.from('clientes').insert({
        telefono: tel, nombre, direccion: colonia, puntos: 0, acepta_terminos: false, qr_code: loyaltyUrl
      })
      if (error) { await sendWA(fromPhone, `❌ Error al crear cliente: ${error.message}`); return }
    }

    // Guardar pendiente para cuando acepte T&C
    await supabase.from('bot_memory').upsert({
      phone: `pending_qr_${tel}`,
      history: [{ admin: fromPhone }],
      updated_at: new Date().toISOString()
    })

    // Enviar T&C vía plantilla
    const tycResult = await sendWATemplate(`52${tel}`, 'estrella_terminos_condiciones', [nombre])
    if (tycResult?.ok === false) {
      await sendWA(fromPhone,
        `✅ *${nombre}* (${tel}) registrado.\n⚠️ No pude enviar los Términos. Inténtalo desde el admin.`
      )
    } else {
      await sendWA(fromPhone,
        `✅ *Registro Loyalty Completo*\n👤 *${nombre}* (${tel})\n🏠 Colonia: ${colonia || 'No especificada'}\n\n📲 Los Términos y Condiciones ya le llegaron a su WhatsApp.\n⏳ Cuando los acepte, recibirá su Tarjeta VIP automáticamente.`
      )
      if (ADMIN_PHONE_MAIN) {
        await sendWA(ADMIN_PHONE_MAIN,
          `🌟 [OP] *${repNombre}* registró a *${nombre}* (${tel}) en el Loyalty.${colonia ? ` Colonia: ${colonia}` : ''}`
        )
      }
    }
    await logRep(supabase, from10, repNombre, 'loyalty_registro', tel, nombre)
    return
  }

  // ── CUPON ─────────────────────────────────────────────────────────────────
  if (cmd === 'CUPON') {
    const codigo = valor.trim().toUpperCase()
    if (!codigo) { await sendWA(fromPhone, `⚠️ Escribe el código del cupón. Ejemplo: *EST-ABC123*`); return }
    const { data, error } = await (supabase as any).rpc('usar_cupon', { p_codigo: codigo })
    if (error) {
      await sendWA(fromPhone, `❌ *Error interno:* ${error.message}`)
    } else if (data?.ok) {
      await sendWA(fromPhone,
        `✅ *CUPÓN APLICADO*\n🎟️ Código: *${codigo}*\n👤 Cliente: ${data.cliente_nombre || 'Desconocido'}\n📱 Tel: ${data.cliente_tel || '-'}`
      )
      if (ADMIN_PHONE_MAIN) {
        await sendWA(ADMIN_PHONE_MAIN,
          `🎟️ *[OP] Cupón Usado*\n🛵 Repartidor: *${repNombre}*\n🎟️ Código: *${codigo}*\n👤 ${data.cliente_nombre || '-'} (${data.cliente_tel || '-'})`
        )
      }
      await logRep(supabase, from10, repNombre, 'cupon', data.cliente_tel, codigo)
    } else {
      await sendWA(fromPhone, `⚠️ *Cupón no válido:* ${data?.error || 'No encontrado o ya fue usado.'}`)
    }
    return
  }

  // ── SOS ───────────────────────────────────────────────────────────────────
  if (cmd === 'SOS') {
    const sosMsg = valor.trim() || 'Emergencia sin detalles'
    if (ADMIN_PHONE_MAIN) await sendWA(ADMIN_PHONE_MAIN, `🚨 *SOS de ${repNombre}*\n\n${sosMsg}`)
    await sendWA(fromPhone, `✅ Alerta enviada al admin.`)
    await logRep(supabase, from10, repNombre, 'sos', undefined, sosMsg)
    return
  }
}

// ── Mensajes de texto del repartidor ─────────────────────────────────────────
export async function handleRepMessage(
  supabase: Supa,
  fromPhone: string,
  from10: string,
  msgText: string,
  isRep: { id: string; nombre: string; alias: string },
): Promise<Response> {
  const trimCmd = msgText.trim()

  // ── Comandos de disponibilidad — siempre disponibles, incluso mid-flow ─────
  // Se colocan ANTES del bloque de sesión para que /activo y /apagado
  // funcionen aunque el repartidor esté en un flujo de múltiples pasos.
  if (trimCmd.toLowerCase() === '/activo') {
    const { error } = await supabase.from('repartidores').update({ activo: true }).eq('telefono', from10)
    if (error) {
      await sendWA(fromPhone, `❌ Error activando tu estado: ${error.message}`)
    } else {
      await sendWA(fromPhone,
        `✅ *¡Estás ACTIVO!* 🟢\n\nYa puedes recibir pedidos. El sistema te avisará cuando llegue uno.\n\nEscribe */apagado* cuando termines tu turno.`
      )
      if (ADMIN_PHONE_MAIN) {
        await sendWA(ADMIN_PHONE_MAIN, `🟢 *${isRep.nombre}* se puso en línea y está disponible para pedidos.`)
      }
    }
    return new Response('OK', { status: 200 })
  }

  if (trimCmd.toLowerCase() === '/apagado') {
    const { error } = await supabase.from('repartidores').update({ activo: false }).eq('telefono', from10)
    if (error) {
      await sendWA(fromPhone, `❌ Error cambiando tu estado: ${error.message}`)
    } else {
      await sendWA(fromPhone,
        `🔴 *¡Estás APAGADO!*\n\nYa no recibirás pedidos nuevos. Descansa bien 💤\n\nEscribe */activo* cuando regreses.`
      )
      if (ADMIN_PHONE_MAIN) {
        await sendWA(ADMIN_PHONE_MAIN, `🔴 *${isRep.nombre}* se puso fuera de línea.`)
      }
    }
    return new Response('OK', { status: 200 })
  }

  // ── Verificar si hay un estado de sesión activo (flujo multi-paso) ────────
  const repState = await getRepState(supabase, from10)
  if (repState?.cmd) {
    const cmd = repState.cmd

    // Cancelar siempre disponible
    if (trimCmd.toLowerCase() === 'cancelar') {
      await clearRepState(supabase, from10)
      await sendWA(fromPhone, `❌ Acción cancelada.`)
      await enviarMenuRepartidor(fromPhone, isRep.nombre)
      return new Response('OK', { status: 200 })
    }

    // BUG-A2 fix: removed premature global clearRepState().
    // Each branch clears state itself. Multi-step commands (LOYALTY_NOMBRE,
    // LOYALTY_COLONIA, DIRECCION_NUEVA, NOREGISTRADO_NOMBRE) need the state
    // intact when ejecutarComando reads it via getRepState() internally.

    // Single-step commands: clear state then execute
    if (cmd === 'INFO')         { await clearRepState(supabase, from10); await ejecutarComando(supabase, fromPhone, from10, 'INFO', trimCmd, isRep.nombre); return new Response('OK', { status: 200 }) }
    if (cmd === 'QR')           { await clearRepState(supabase, from10); await ejecutarComando(supabase, fromPhone, from10, 'QR', trimCmd, isRep.nombre); return new Response('OK', { status: 200 }) }
    if (cmd === 'SCORE')        { await clearRepState(supabase, from10); await ejecutarComando(supabase, fromPhone, from10, 'SCORE_TEL', trimCmd, isRep.nombre); return new Response('OK', { status: 200 }) }
    if (cmd === 'NOREGISTRADO') { await clearRepState(supabase, from10); await ejecutarComando(supabase, fromPhone, from10, 'NOREGISTRADO_TEL', trimCmd, isRep.nombre); return new Response('OK', { status: 200 }) }
    if (cmd === 'DIRECCION')    { await clearRepState(supabase, from10); await ejecutarComando(supabase, fromPhone, from10, 'DIRECCION_TEL', trimCmd, isRep.nombre); return new Response('OK', { status: 200 }) }
    if (cmd === 'CUPON')        { await clearRepState(supabase, from10); await ejecutarComando(supabase, fromPhone, from10, 'CUPON', trimCmd, isRep.nombre); return new Response('OK', { status: 200 }) }
    if (cmd === 'SOS')          { await clearRepState(supabase, from10); await ejecutarComando(supabase, fromPhone, from10, 'SOS', trimCmd, isRep.nombre); return new Response('OK', { status: 200 }) }
    if (cmd === 'LOYALTY')      { await clearRepState(supabase, from10); await ejecutarComando(supabase, fromPhone, from10, 'LOYALTY', trimCmd, isRep.nombre); return new Response('OK', { status: 200 }) }

    // Multi-step commands: preserve state (ejecutarComando reads it with getRepState internally)
    if (cmd === 'NOREGISTRADO_NOMBRE') { await ejecutarComando(supabase, fromPhone, from10, 'NOREGISTRADO_NOMBRE', trimCmd, isRep.nombre); return new Response('OK', { status: 200 }) }
    if (cmd === 'DIRECCION_NUEVA')     { await ejecutarComando(supabase, fromPhone, from10, 'DIRECCION_NUEVA', trimCmd, isRep.nombre); return new Response('OK', { status: 200 }) }
    if (cmd === 'LOYALTY_NOMBRE')      { await ejecutarComando(supabase, fromPhone, from10, 'LOYALTY_NOMBRE', trimCmd, isRep.nombre); return new Response('OK', { status: 200 }) }
    if (cmd === 'LOYALTY_COLONIA')     { await ejecutarComando(supabase, fromPhone, from10, 'LOYALTY_COLONIA', trimCmd, isRep.nombre); return new Response('OK', { status: 200 }) }
  }

  // ── Comandos de texto directos (retrocompatibilidad) ──────────────────────
  if (trimCmd === '/help' || trimCmd === '/ayuda' || trimCmd.toLowerCase() === 'hola' || trimCmd.toLowerCase() === 'menu' || trimCmd.toLowerCase() === '/menu') {
    await enviarMenuRepartidor(fromPhone, isRep.nombre)
    return new Response('OK', { status: 200 })
  }

  // ── Detección de teléfono en formato libre (acción rápida) ────────────────
  const numDigits = trimCmd.replace(/\D/g, '').length
  if (numDigits >= 10 && numDigits <= 15 && trimCmd.length <= 25) {
    const posibleTel = extract10Digits(trimCmd)
    if (posibleTel && posibleTel.length === 10) {
      const { data: existe } = await supabase.from('clientes').select('id, nombre, reputacion, puntos').eq('telefono', posibleTel).maybeSingle()
      if (existe) {
        const repIcon: Record<string, string> = { excelente: '🌟', bueno: '👍', regular: '⚠️', malo: '❌', vetado: '🚫' }
        await sendInteractiveList(
          fromPhone,
          `📲 *Acción rápida* para *${existe.nombre || posibleTel}*\n` +
          `📱 ${posibleTel} | ⭐ ${existe.puntos ?? 0} pts | ${repIcon[existe.reputacion] || '❓'} ${existe.reputacion || 'sin calificar'}\n\n` +
          `¿Qué deseas hacer?`,
          'Elegir acción',
          [{
            title: 'Opciones',
            rows: [
              { id: `REP_CMD_INFO`,      title: '🔍 Ver Ficha',          description: posibleTel },
              { id: `REP_CMD_QR`,        title: '🎟️ Enviar Tarjeta VIP', description: posibleTel },
              { id: `REP_CMD_SCORE`,     title: '📝 Calificar',          description: posibleTel },
              { id: `REP_CMD_DIRECCION`, title: '🏠 Actualizar Dirección',description: posibleTel },
            ]
          }]
        )
        // BUG-B4 fix: store prefill WITHOUT cmd so that if the repartidor types
        // a free-text message instead of pressing a button, it doesn't accidentally
        // trigger the INFO command with the typed text as the phone number.
        // The prefill is picked up only when a REP_CMD_* button is actually pressed.
        await setRepState(supabase, from10, { prefill: posibleTel })

      } else {
        await sendInteractiveList(
          fromPhone,
          `⚠️ El número *${posibleTel}* no está registrado en el sistema.\n\n¿Qué deseas hacer?`,
          'Opciones',
          [{
            title: 'Opciones',
            rows: [
              { id: 'REP_CMD_LOYALTY', title: '🌟 Registro Loyalty', description: 'Alta completa con T&C y QR' },
              { id: 'REP_CMD_NOREGISTRADO', title: '🔇 Registrar Express', description: 'Alta silenciosa en sistema' },
            ]
          }]
        )
        await setRepState(supabase, from10, { prefill: posibleTel })
      }
      return new Response('OK', { status: 200 })
    }
  }

  if (trimCmd.toLowerCase().startsWith('/sos')) {
    const sosMsg = trimCmd.slice(4).trim() || 'Emergencia sin detalles'
    if (ADMIN_PHONE_MAIN) await sendWA(ADMIN_PHONE_MAIN, `🚨 *SOS de ${isRep.nombre}*\n\n${sosMsg}`)
    await sendWA(fromPhone, `✅ Alerta enviada al admin.`)
    return new Response('OK', { status: 200 })
  }

  if (trimCmd.toLowerCase().startsWith('/usar ')) {
    const codigo = trimCmd.slice(6).trim().toUpperCase()
    await ejecutarComando(supabase, fromPhone, from10, 'CUPON', codigo, isRep.nombre)
    return new Response('OK', { status: 200 })
  }

  // ── Flujo IA (para lenguaje natural) ─────────────────────────────────────
  const ai = await conversacionDeepSeek(supabase, fromPhone, msgText, true, isRep)
  const action = ai?.respuesta?.accion
  const d: any = ai?.respuesta?.datosAExtraer || {}

  const { executeAdminAction } = await import('./admin-handler.ts')
  const res = await executeAdminAction(supabase, fromPhone, 'rep_' + Date.now(), ai)

  // Notificación operativa post-ejecución al admin
  if (action === 'SUMAR_PUNTOS' && d.clienteTel && ADMIN_PHONE_MAIN && from10 !== extract10Digits(ADMIN_PHONE_MAIN)) {
    const { data: c } = await supabase.from('clientes').select('nombre').eq('telefono', d.clienteTel).limit(1).maybeSingle()
    const cant = Number(d.puntosASumar) || 1
    await sendWA(ADMIN_PHONE_MAIN, `🌟 [OP] *${isRep.nombre}* sumó ${cant} pts a ${c?.nombre || d.clienteTel}.`)
  } else if (action === 'CARGAR_SALDO' && d.clienteTel && ADMIN_PHONE_MAIN && from10 !== extract10Digits(ADMIN_PHONE_MAIN)) {
    const { data: c } = await supabase.from('clientes').select('nombre').eq('telefono', d.clienteTel).limit(1).maybeSingle()
    const monto = parseFloat(String(d.montoSaldo)) || 0
    await sendWA(ADMIN_PHONE_MAIN, `💲 [OP] *${isRep.nombre}* cargó $${monto} de saldo a ${c?.nombre || d.clienteTel}.`)
  } else if (action === 'RESPONDER') {
    const esOperativo = /problem|error|accidente|no encuentro|cancelar|ayuda|tardare|tarde|demora|perdido|falla/i.test(msgText)
    if (esOperativo && ADMIN_PHONE_MAIN && from10 !== extract10Digits(ADMIN_PHONE_MAIN)) {
      await sendWA(ADMIN_PHONE_MAIN, `⚠️ *[Alerta de ${isRep.nombre}]*:\n${msgText}`)
    }
  }

  return res
}
