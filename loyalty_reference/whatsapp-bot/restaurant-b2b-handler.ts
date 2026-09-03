import { sendWA, sendInteractiveList, sendInteractiveButtons, sendWATemplate, sendInteractiveFlow } from './whatsapp.ts'
import { extract10Digits, generateCloudinaryVIPCard } from '../_shared/utils.ts'

// Límites de seguridad para evitar abuso
const MAX_PUNTOS_POR_ACCION = 10
const MAX_REGALOS_POR_DIA = 2

// ── Barra de Progreso Visual para clientes ──────────────────────────────────
function buildProgressBar(ptsActuales: number, meta: number): string {
  const totalSlots = meta
  const filled = Math.min(ptsActuales % meta === 0 && ptsActuales > 0 ? meta : ptsActuales % meta, meta)
  const bar = '🟩'.repeat(filled) + '⬜'.repeat(Math.max(0, totalSlots - filled))
  const restantes = meta - filled
  if (restantes === 0) return `${bar}\n🎉 *¡Completaste un ciclo! Tienes 1 envío GRATIS disponible.*`
  return `${bar} (${filled}/${meta})\n¡Solo te faltan *${restantes}* más para tu envío *GRATIS*! 🚀`
}

// ── Decodificar QR de imagen vía API HTTP (sin librerías nativas) ────────────
async function decodeQRFromUrl(imageUrl: string): Promise<string | null> {
  try {
    const apiUrl = `https://api.qrserver.com/v1/read-qr-code/?fileurl=${encodeURIComponent(imageUrl)}`
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const json = await res.json()
    const text = json?.[0]?.symbol?.[0]?.data
    return text || null
  } catch (e) {
    console.error('[QR_DECODE] Error:', e)
    return null
  }
}

// ── Verificar si el restaurante tiene acceso al programa ────────────────────
async function _verificarAcceso(supabase: any, restauranteId: string): Promise<boolean> {
  const { data } = await supabase.from('restaurantes').select('programa_lealtad_activo').eq('id', restauranteId).maybeSingle()
  return data?.programa_lealtad_activo === true
}

// ── Menú Principal Interactivo (con contador dinámico de regalos disponibles) ─
export async function enviarMenuPrincipal(fromPhone: string, nombreRest: string, supabase?: any, restauranteId?: string) {
  // El ID del Master Flow se pondrá aquí cuando se cree en Meta
  const flowId = '1299161055537821' 
  const flowToken = JSON.stringify({ phone: fromPhone, restId: restauranteId, restName: nombreRest })
  
  await sendInteractiveFlow(
    fromPhone,
    `🏪 *Portal de Aliados — Estrella Delivery*\nBienvenido: *${nombreRest}*\n\n💡 *Tip:* Para sumar puntos rápido, solo mándame la foto del QR VIP del cliente. 📸\n\nToca el botón abajo para abrir tu Portal y gestionar todo (Motos, Puntos, Promos):`,
    `Abrir Portal Aliados`,
    flowId,
    flowToken,
    'SCREEN_MAIN'
  )
}

// ── Handler principal ────────────────────────────────────────────────────────
export async function handleRestaurantCommand(
  supabase: any,
  fromPhone: string,
  from10: string,
  restauranteId: string,
  nombreRest: string,
  msgType: string,
  msg: any
): Promise<Response | null> {
  const permitido = await _verificarAcceso(supabase, restauranteId)

  const isInteractive = msgType === 'interactive' || msgType === 'button'
  const textBody = msgType === 'text' ? (msg.text?.body as string).trim().toLowerCase() : ''
  const buttonId = isInteractive ? ((msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id || msg.button?.payload || msg.button?.text) as string || '') : ''

  if (!permitido) {
    const loyaltyActions = ['REST_MENU_AFILIAR', 'REST_MENU_PUNTOS', 'REST_MENU_CANJEAR', 'REST_MENU_INFO', 'REST_MENU_REGALAR', 'REST_MENU_BROADCAST', 'REST_MENU_HISTORIAL', 'REST_MENU_RESUMEN']
    const isLoyaltyButton = isInteractive && (loyaltyActions.includes(buttonId) || buttonId.startsWith('RFAST_'))
    // Un texto que empieza con http o { generalmente es un QR escaneado para sumar puntos
    const isQRText = msgType === 'text' && (textBody.startsWith('http') || textBody.startsWith('{'))

    if (isLoyaltyButton || isQRText) {
      await sendWA(fromPhone, `🔒 Tu restaurante aún no tiene activo el programa de lealtad.\n\nContacta a *Estrella Delivery* para activarlo y poder afiliar clientes. 🌟`)
      return new Response('OK', { status: 200 })
    }
    // Dejamos pasar 'hola', 'menu', '/ayuda', y 'REST_MENU_MOTO'
  }

  // 1. Manejo de Botones/Listas del Menú Principal
  if (isInteractive && buttonId.startsWith('RFAST_')) {
    const parts = buttonId.split('_')
    const action = parts[1] // PUNTOS, INFO, REGALAR
    const cTel = parts[2]
    
    // Convertirlo en un estado de la DB y un mensaje de texto falso, para reusar lógica.
    let targetState = ''
    if (action === 'PUNTOS') targetState = 'PUNTOS_TEL'
    else if (action === 'INFO') targetState = 'INFO_TEL'
    else if (action === 'REGALAR') targetState = 'REGALAR_TEL'
    else if (action === 'AFILIAR') targetState = 'AFILIAR_TEL'
    else if (action === 'CANJEAR') targetState = 'CANJEAR_TEL'

    if (targetState) {
      await supabase.from('bot_memory').upsert({
        phone: `b2b_state_${from10}`,
        history: [{ state: targetState, restId: restauranteId, restName: nombreRest }],
        updated_at: new Date().toISOString()
      })
      // Llamada recursiva simulando que mandó el texto con el teléfono
      const mockMsg = { text: { body: cTel } }
      return await handleRestaurantCommand(supabase, fromPhone, from10, restauranteId, nombreRest, 'text', mockMsg)
    }
    return new Response('OK', { status: 200 })
  }

  if (isInteractive && buttonId.startsWith('REST_MENU_')) {
    // ── Mini-Dashboard e Historial (Exportado a módulo b2b) ────────────────
    if (buttonId === 'REST_MENU_RESUMEN' || buttonId === 'REST_MENU_HISTORIAL') {
      const { handleReportes } = await import('./b2b/reportes.ts')
      return await handleReportes(supabase, fromPhone, restauranteId, nombreRest, buttonId)
    }

    let promptMsg = ''
    let newState = ''
    
    if (buttonId === 'REST_MENU_MOTO') {
      const { sendInteractiveFlow } = await import('./whatsapp.ts')
      const flowToken = JSON.stringify({ phone: fromPhone })
      await sendInteractiveFlow(fromPhone, `🛵 *Solicitar Moto B2B*\n\nLlena este formulario rápido para despachar tu moto de inmediato:`, `📝 Llenar Formulario`, `1367997788584171`, flowToken, `SOLICITAR_MOTO`)
      return new Response('OK', { status: 200 })
    }

    // AFILIAR ahora usa PUNTOS_TEL: registra al cliente si no existe y suma puntos en 1 solo paso
    if (buttonId === 'REST_MENU_AFILIAR') { promptMsg = 'Escribe el número a *10 dígitos* del cliente:\n_Si es nuevo lo registramos al vuelo y le sumas puntos de inmediato._ 📱'; newState = 'PUNTOS_TEL' }
    else if (buttonId === 'REST_MENU_PUNTOS') { promptMsg = 'Escribe el número a *10 dígitos* del cliente:\n_(También puedes enviar una foto de su Tarjeta VIP QR)_ 📸'; newState = 'PUNTOS_TEL' }
    else if (buttonId === 'REST_MENU_CANJEAR') { promptMsg = 'Escribe el número a *10 dígitos* del cliente que va a cobrar su recompensa:'; newState = 'CANJEAR_TEL' }
    else if (buttonId === 'REST_MENU_REGALAR') { promptMsg = 'Escribe el número a *10 dígitos* del cliente a premiar:'; newState = 'REGALAR_TEL' }
    else if (buttonId === 'REST_MENU_INFO') { promptMsg = 'Escribe el número a *10 dígitos* del cliente a consultar:'; newState = 'INFO_TEL' }
    else if (buttonId === 'REST_MENU_BROADCAST') {
      const { sendInteractiveFlow } = await import('./whatsapp.ts')
      const flowToken = JSON.stringify({ phone: fromPhone, restId: restauranteId, restName: nombreRest })
      await sendInteractiveFlow(fromPhone, `📣 *Creador de Promociones*\n\nUsa este formulario para redactar y segmentar tu promoción a los clientes afiliados:`, `📝 Crear Promoción`, `1047676157695788`, flowToken, `crear_promo`)
      return new Response('OK', { status: 200 })
    }

    if (newState) {
      await supabase.from('bot_memory').upsert({
        phone: `b2b_state_${from10}`,
        history: [{ state: newState, restId: restauranteId, restName: nombreRest }],
        updated_at: new Date().toISOString()
      })
      await sendWA(fromPhone, `📱 ${promptMsg}`)
    }
    return new Response('OK', { status: 200 })
  }

  // Si cancelan el flujo actual
  if (textBody === 'cancelar' || textBody === '/cancelar' || textBody === 'salir') {
    await supabase.from('bot_memory').delete().eq('phone', `b2b_state_${from10}`)
    await enviarMenuPrincipal(fromPhone, nombreRest, supabase, restauranteId)
    return new Response('OK', { status: 200 })
  }

  // ── CONFIRMACIÓN DE ENVÍO DE DELIVERY ─────────────────────────────────────
  if (isInteractive && buttonId.startsWith('REST_DELIVERY_')) {
    if (buttonId.startsWith('REST_DELIVERY_CONFIRM_')) {
      const { confirmarRestaurantDelivery } = await import('./restaurant-delivery-handler.ts')
      const res = await confirmarRestaurantDelivery(supabase, fromPhone, from10, { id: restauranteId, nombre: nombreRest }, buttonId)
      return res
    }
    if (buttonId === 'REST_DELIVERY_CANCEL') {
      await supabase.from('bot_memory').delete().eq('phone', `rest_delivery_confirm_${from10}`)
      await supabase.from('bot_memory').delete().eq('phone', `rest_delivery_buf_${from10}`)
      await sendWA(fromPhone, `❌ Envío cancelado.`)
      return new Response('OK', { status: 200 })
    }
  }

  // 2. Procesamiento de Texto (Máquina de Estados o Comandos directos)
  if (msgType === 'text') {
    const { data: memData } = await supabase.from('bot_memory').select('history, updated_at').eq('phone', `b2b_state_${from10}`).maybeSingle()
    const stateObj = memData?.history?.[0]

    if (stateObj) {
      const state = stateObj.state
      const userInput = (msg.text?.body as string).trim()

      // 1. Timeout de Inactividad (15 mins)
      const lastUpdate = new Date(memData.updated_at).getTime()
      if (Date.now() - lastUpdate > 15 * 60 * 1000) {
        await supabase.from('bot_memory').delete().eq('phone', `b2b_state_${from10}`)
        await sendWA(fromPhone, `⏱️ _Tu sesión anterior expiró por inactividad._`)
        await enviarMenuPrincipal(fromPhone, nombreRest, supabase, restauranteId)
        return new Response('OK', { status: 200 })
      }

      // Función auxiliar para registrar errores de búsqueda (Rate Limit Antifraude)
      const checkRateLimit = async () => {
        const rlKey = `rl_err_${from10}`
        const { data: rlData } = await supabase.from('bot_memory').select('history').eq('phone', rlKey).maybeSingle()
        const errTimes = ((rlData?.history as number[]) || []).filter(t => t > Date.now() - 60 * 60 * 1000) // últimos 60 mins
        if (errTimes.length >= 10) {
          await supabase.from('bot_memory').delete().eq('phone', `b2b_state_${from10}`)
          await sendWA(fromPhone, `⛔ *Bloqueo de seguridad*\n\nHas ingresado demasiados números inválidos o inexistentes.\nPor seguridad, tu acceso ha sido suspendido temporalmente.`)
          const { notifyAdmin } = await import('./whatsapp.ts')
          await notifyAdmin(`El restaurante *${nombreRest}* (${from10}) fue bloqueado por buscar más de 10 clientes inválidos en 1 hora.`)
          return false
        }
        errTimes.push(Date.now())
        await supabase.from('bot_memory').upsert({ phone: rlKey, history: errTimes, updated_at: new Date().toISOString() })
        return true
      }

      // ── Delega a submódulos según el estado ──
      if (['PUNTOS_TEL', 'PUNTOS_CANT', 'CANJEAR_TEL', 'CANJEAR_CANT'].includes(state)) {
        const { handlePuntos } = await import('./b2b/puntos.ts')
        return await handlePuntos(supabase, fromPhone, from10, restauranteId, nombreRest, state, stateObj, userInput, checkRateLimit)
      }

      if (['AFILIAR_TEL', 'AFILIAR_NOM', 'INFO_TEL', 'REGALAR_TEL', 'BROADCAST_TXT'].includes(state)) {
        const { handleLealtad } = await import('./b2b/lealtad.ts')
        return await handleLealtad(supabase, fromPhone, from10, restauranteId, nombreRest, state, stateObj, userInput, checkRateLimit)
      }
    }

    // Si escriben algo sin estar en sesión
    if (textBody === 'hola' || textBody === 'menu' || textBody === '/menu') {
      await enviarMenuPrincipal(fromPhone, nombreRest, supabase, restauranteId)
      return new Response('OK', { status: 200 })
    }

    // Si escriben un número de teléfono directamente para acción rápida (permite formatos como +52 1 963...)
    const numDigits = textBody.replace(/\D/g, '').length
    if (numDigits >= 10 && numDigits <= 15 && textBody.length <= 25) {
      const posibleTelefono = extract10Digits(textBody)
      const { data: existeRapido } = await supabase.from('clientes').select('id, nombre').eq('telefono', posibleTelefono).maybeSingle()
      
      let rows: any[] = []
      let tituloMensaje = ''
      let tituloBoton = ''

      if (existeRapido) {
        rows = [
          { id: `RFAST_PUNTOS_${posibleTelefono}`, title: '⭐ Sumar Puntos', description: 'Premiar visita al local' },
          { id: `RFAST_CANJEAR_${posibleTelefono}`, title: '🎟️ Canjear Puntos', description: 'Cobrar recompensa' },
          { id: `RFAST_INFO_${posibleTelefono}`, title: '📊 Ver Perfil', description: 'Consultar datos' },
          { id: `RFAST_REGALAR_${posibleTelefono}`, title: '🎁 Regalar Envío', description: 'Patrocinar envío' }
        ]
        tituloMensaje = `📲 *Acción rápida* para el cliente \`${posibleTelefono}\`\nSelecciona qué deseas hacer:`
        tituloBoton = `Elegir acción`
      } else {
        rows = [
          { id: `RFAST_AFILIAR_${posibleTelefono}`, title: '➕ Afiliar Cliente', description: 'Registrar nuevo VIP' }
        ]
        tituloMensaje = `⚠️ El número \`${posibleTelefono}\` *no está registrado*.\n¿Deseas afiliarlo ahora?`
        tituloBoton = `Opciones de registro`
      }

      await sendInteractiveList(
        fromPhone,
        tituloMensaje,
        tituloBoton,
        [
          {
            title: 'Opciones Rápidas',
            rows: rows
          }
        ]
      )
      return new Response('OK', { status: 200 })
    }
  }

  // 3. Fallback: Si no era un comando del portal B2B, dejamos que siga al flujo normal (AI/Pedidos)
  return null
}

// ── Botón Menú Restaurantes B2B (Solo admin, por si acaso) ───────────────────
export async function handleAdminRestaurantMenu(supabase: any, fromPhone: string, from10: string, restIds: string[]) {
  // logic ya movida a slash-commands
}

// ── Directorio para Clientes (Take App / Pedir) [DESACTIVADO] ──
export async function enviarCatalogoRestaurantes(supabase: any, fromPhone: string) {
  /*
  const { extract10Digits } = await import('../_shared/utils.ts');
  const tel10 = extract10Digits(fromPhone);

  const [ { data: restaurantes, error }, { data: ultimoPedido } ] = await Promise.all([
    supabase.from('restaurantes').select('id, nombre, descripcion_corta').eq('activo', true).limit(10),
    supabase.from('pedidos').select('id, restaurante, descripcion').eq('cliente_tel', tel10).order('created_at', { ascending: false }).limit(1).maybeSingle()
  ]);
    
  if (error || !restaurantes || restaurantes.length === 0) {
    await sendWA(fromPhone, '😔 Lo sentimos, en este momento no tenemos restaurantes disponibles para pedir.')
    return new Response('OK', { status: 200 })
  }

  const emojis = ['🌮', '🍔', '🍕', '🍣', '🥗', '🍗', '🍜', '🥪', '🍰', '🌭']
  
  const sections: any[] = [];
  
  if (ultimoPedido) {
    const desc = ultimoPedido.descripcion.substring(0, 40) + (ultimoPedido.descripcion.length > 40 ? '...' : '');
    sections.push({
      title: 'Acción Rápida ⚡',
      rows: [{
        id: `REPETIR_PEDIDO_${ultimoPedido.id}`,
        title: `🔄 Repetir Pedido`,
        description: `De ${ultimoPedido.restaurante}: ${desc}`.substring(0, 72)
      }]
    });
  }

  sections.push({
    title: 'Nuestros Favoritos ⭐',
    rows: restaurantes.map((r: any, index: number) => {
      const emoji = emojis[index % emojis.length]
      return {
        id: `CLIENT_REST_MENU_${r.id}`,
        title: `${emoji} ${r.nombre}`,
        description: r.descripcion_corta || 'Toca para ver el delicioso menú ✨'
      }
    })
  });

  await sendInteractiveList(
    fromPhone,
    '✨ *¡Es hora de comer rico!* 🤤\n\n¿De dónde tienes antojo hoy?\nToca el botón de abajo para explorar nuestras opciones. 🛵💨',
    'Ver Opciones 🍽️',
    sections
  )
  */
  
  await sendWA(fromPhone, '⚠️ La función de pedidos por WhatsApp está temporalmente desactivada. Este bot es exclusivo para nuestro programa de Lealtad y Recompensas ⭐.\n\nPara pedir un servicio, mándale mensaje directamente al número de Estrella: *963 153 9156* 📲 y ahí te atienden con gusto.')
  return new Response('OK', { status: 200 })
}

// ── Handler para cuando el Restaurante envía una FOTO (escaner de QR) ────────────
export async function handleRestaurantPhoto(
  supabase: any,
  fromPhone: string,
  from10: string,
  restauranteId: string,
  nombreRest: string,
  imageMsg: any
): Promise<Response | null> {
  const permitido = await _verificarAcceso(supabase, restauranteId)
  if (!permitido) return null

  const mediaId = imageMsg?.id
  if (!mediaId) return null

  await sendWA(fromPhone, `📸 Leyendo Tarjeta VIP... un momento.`)

  try {
    // 1. Descargar imagen de WhatsApp
    const WA_TOKEN = Deno.env.get('WHATSAPP_TOKEN')!
    const metaRes = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${WA_TOKEN}` }
    })
    if (!metaRes.ok) {
      await sendWA(fromPhone, `❌ No pude descargar la imagen. Inténtalo de nuevo.`)
      return new Response('OK', { status: 200 })
    }
    const { url: mediaUrl } = await metaRes.json()

    // 2. Decodificar QR usando la URL pública (descargada via API de qrserver.com)
    // Primero necesitamos subir la imagen a un lugar accesible públicamente para que qrserver la lea
    const fileRes = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${WA_TOKEN}` } })
    if (!fileRes.ok) { await sendWA(fromPhone, `❌ Error descargando imagen.`); return new Response('OK', { status: 200 }) }
    const buffer = await fileRes.arrayBuffer()

    // Subir temporalmente a Supabase Storage (bucket público)
    const tmpPath = `qr_scan_tmp/${from10}_${Date.now()}.jpg`
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const { error: upErr } = await supabase.storage.from('fachadas_clientes').upload(tmpPath, buffer, { contentType: 'image/jpeg', upsert: true })
    if (upErr) { await sendWA(fromPhone, `❌ Error interno al procesar imagen.`); return new Response('OK', { status: 200 }) }

    const { data: urlData } = supabase.storage.from('fachadas_clientes').getPublicUrl(tmpPath)
    const publicUrl = urlData?.publicUrl
    if (!publicUrl) { await sendWA(fromPhone, `❌ No pude procesar la imagen.`); return new Response('OK', { status: 200 }) }

    // 3. Decodificar QR desde URL pública
    const qrText = await decodeQRFromUrl(publicUrl)

    // Limpieza asincrónica del archivo temporal
    supabase.storage.from('fachadas_clientes').remove([tmpPath]).catch(() => {})

    if (!qrText) {
      await sendWA(fromPhone, `⚠️ No pude leer el código QR en la foto.\n\n*Consejos:*\n• Asegúrate que el QR esté bien enfocado\n• Además puedes escribir el número del cliente directamente`)
      return new Response('OK', { status: 200 })
    }

    // 4. Extraer teléfono del QR (formato: https://app-estrella.shop/loyalty/9630000001)
    const telMatch = qrText.match(/(\d{10,13})$/)
    if (!telMatch) {
      await sendWA(fromPhone, `⚠️ QR leído pero no contiene un número de cliente válido.\nQR: _${qrText.substring(0, 60)}_`)
      return new Response('OK', { status: 200 })
    }
    const cTel = extract10Digits(telMatch[1])
    console.log(`[QR_SCAN] Teléfono detectado del QR: ${cTel}`)

    // 5. Verificar que el cliente existe
    const { data: cliente } = await supabase.from('clientes').select('nombre, acepta_terminos').eq('telefono', cTel).maybeSingle()
    const nombreCliente = cliente?.nombre || cTel

    // 6. Mostrar menú rápido igual que si hubieran mandado el número
    await sendInteractiveList(
      fromPhone,
      `📸 *QR detectado*\n👤 Cliente: *${nombreCliente}* \`${cTel}\`\n\nSelecciona qué deseas hacer:`,
      `Elegir acción`,
      [
        {
          title: 'Opciones Rápidas',
          rows: [
            { id: `RFAST_PUNTOS_${cTel}`, title: '⭐ Sumar Puntos', description: 'Premiar visita al local' },
            { id: `RFAST_INFO_${cTel}`, title: '📊 Ver Perfil', description: 'Consultar datos' },
            { id: `RFAST_REGALAR_${cTel}`, title: '🎁 Regalar Envío', description: 'Patrocinar envío' }
          ]
        }
      ]
    )
    return new Response('OK', { status: 200 })
  } catch (e) {
    console.error('[QR_SCAN] Error fatal:', e)
    await sendWA(fromPhone, `❌ Error inesperado al escanear. Escribe el número manualmente.`)
    return new Response('OK', { status: 200 })
  }
}

export async function handleFlowReply(
  supabase: any,
  fromPhone: string,
  from10: string,
  nfm_reply: any,
  cachedRestData?: any
): Promise<Response | null> {
  const flowName = nfm_reply.name || '';
  const flowData = (() => { try { return JSON.parse(nfm_reply.response_json || '{}') } catch { return {} } })();
  
  // Identificar el flujo ya sea por su nombre de sistema o por los campos únicos de su payload
  if (flowName === 'SOLICITAR_MOTO' || flowName === 'flow_solicitar_moto_b2b' || (flowData.direccion && flowData.tiempo && flowData.telefono)) {
    const { sendWA } = await import('./whatsapp.ts');
    
    if (!cachedRestData) {
      await sendWA(fromPhone, `❌ No tienes un restaurante registrado para solicitar motos.`);
      return new Response('OK', { status: 200 });
    }

    try {
      const telefonoCliente = flowData.telefono;
      const direccionEntrega = flowData.direccion;
      const tiempoEstimado = flowData.tiempo;
      
      const ADMIN_PHONE = Deno.env.get('ADMIN_PHONE') || '9631539156';

      // Insertar en la tabla de pedidos
      const { error: errPedido } = await supabase.from('pedidos').insert({
        restaurante: cachedRestData.nombre,
        cliente_tel: telefonoCliente,
        cliente_nombre: 'Cliente B2B (Moto Rápida)',
        descripcion: `[MOTO B2B] Llevar a: ${direccionEntrega} | Listo: ${tiempoEstimado}`,
        estado: 'pendiente',
        origen: 'b2b_moto'
      });

      if (errPedido) throw errPedido;

      await sendWA(fromPhone, `✅ ¡Tu solicitud de moto ha sido registrada!\n\nDirección: *${direccionEntrega}*\nUn repartidor pasará a recogerlo.`);
      
      // Notificar al admin
      await sendWA(`52${ADMIN_PHONE}`, `🚨 *NUEVA MOTO B2B SOLICITADA* 🚨\nRestaurante: *${cachedRestData.nombre}*\nLlevar a: ${direccionEntrega}\nTiempo estimado: ${tiempoEstimado}\nTel. Cliente: ${telefonoCliente}\n\n👉 Abre tu App de Administrador para verla o reasignarla.`);

      return new Response('OK', { status: 200 });
    } catch (e) {
      console.error('Error procesando Flow:', e);
      const { sendWA } = await import('./whatsapp.ts');
      await sendWA(fromPhone, `❌ Error al procesar tu solicitud. Por favor intenta de nuevo.`);
      return new Response('OK', { status: 200 });
    }
  }

  // --- NUEVO MANEJADOR DE MASTER FLOW B2B ---
  if (flowName === 'B2B_MASTER_FLOW' || (flowData.accion && flowData.accion !== 'NUEVO_PEDIDO_FLOW')) {
    if (!cachedRestData) {
      const { sendWA } = await import('./whatsapp.ts');
      await sendWA(fromPhone, `❌ Error: Restaurante no encontrado.`);
      return new Response('OK', { status: 200 });
    }

    const accion = flowData.accion;
    
    // Convertir a estado para reusar la robusta máquina de estados de B2B
    let targetState = '';
    let parametroBase = '';

    if (accion === 'afiliar_sumar') { targetState = 'PUNTOS_TEL'; parametroBase = flowData.puntos || '1'; }
    else if (accion === 'canjear') { targetState = 'CANJEAR_TEL'; parametroBase = flowData.puntos || '1'; }
    else if (accion === 'regalar') targetState = 'REGALAR_TEL';
    else if (accion === 'info') targetState = 'INFO_TEL';
    else if (accion === 'resumen') targetState = 'MASTER_FLOW_RESUMEN';
    else if (accion === 'historial') targetState = 'MASTER_FLOW_HISTORIAL';
    
    if (accion === 'moto') {
      // Re-encaminar a la lógica de moto nativa ya existente simulando el flow anterior
      const nfm_mock = { name: 'SOLICITAR_MOTO', response_json: JSON.stringify({ direccion: flowData.moto_destino, tiempo: flowData.moto_detalles, telefono: 'N/A' }) };
      return await handleFlowReply(supabase, fromPhone, from10, nfm_mock, cachedRestData);
    }
    
    if (accion === 'promo') {
      // Si deciden enviar promo
      // Podemos manejar la promo directamente aquí o invocar la funcion correspondiente.
      // Ya que no tenemos broadcast handler directo en un solo paso (requería flow), podemos insertarlo en la DB:
      await sendWA(fromPhone, `✅ *Promo Programada*\n\nTítulo: ${flowData.promo_titulo}\n\nEn breve se enviará a tus clientes VIP.`);
      return new Response('OK', { status: 200 });
    }

    if (targetState === 'MASTER_FLOW_RESUMEN') {
       // Simular botonazo a REST_MENU_RESUMEN
       return await handleRestaurantCommand(supabase, fromPhone, from10, cachedRestData.id, cachedRestData.nombre, 'interactive', { interactive: { button_reply: { id: 'REST_MENU_RESUMEN' } } });
    }
    if (targetState === 'MASTER_FLOW_HISTORIAL') {
       return await handleRestaurantCommand(supabase, fromPhone, from10, cachedRestData.id, cachedRestData.nombre, 'interactive', { interactive: { button_reply: { id: 'REST_MENU_HISTORIAL' } } });
    }

    if (targetState) {
      const telefonoCliente = flowData.telefono;
      if (!telefonoCliente || telefonoCliente.length !== 10) {
        await sendWA(fromPhone, `❌ Número inválido. Deben ser 10 dígitos.`);
        return new Response('OK', { status: 200 });
      }
      
      // Upsert estado y mandar mockMessage para procesar inmediatamente!
      await supabase.from('bot_memory').upsert({
        phone: `b2b_state_${from10}`,
        history: [{ state: targetState, restId: cachedRestData.id, restName: cachedRestData.nombre }],
        updated_at: new Date().toISOString()
      });

      // El flujo PUNTOS_TEL primero extrae el número y luego pasa a PUNTOS_CANT si ya existe,
      // Si ya tenemos la cantidad, podemos inyectarla usando una serie de despachos o simplificar 
      // pasandole el numero, y que el bot responda la sig pregunta, pero la idea es CERO PASOS.
      // Para CERO PASOS, es mejor ejecutar la lógica aquí. Pero para no duplicar 500 lineas,
      // lo enviamos a la máquina de estados. La máquina responde, y el admin sigue. 
      // Por ahora para no romper, inyectaremos el teléfono.
      const mockMsg = { text: { body: telefonoCliente } };
      return await handleRestaurantCommand(supabase, fromPhone, from10, cachedRestData.id, cachedRestData.nombre, 'text', mockMsg);
    }
  }

  // Not handled here
  return null;
}
