import { sendWA, sendInteractiveButtons } from './whatsapp.ts'
import { handleRestaurantOnboarding } from './restaurant-onboarding.ts'
import { avanzarFlujoMandadito, STATE_KEY } from './mandadito/handler.ts'

export async function handleClientFlow(
  supabase: any,
  fromPhone: string,
  from10: string,
  msgType: string,
  msg: any,
  cachedRepData: any,
  SUPABASE_KEY: string,
  profileName?: string
): Promise<Response | null> {
  // Repartidor descolgado: recordarle que use botones
  if (cachedRepData) {
    await sendWA(fromPhone, `🤖 Hola ${cachedRepData.nombre}.\nRecuerda usar los botones para avanzar pedidos o enviarme mensajes de texto sin emojis.`)
    return new Response('OK', { status: 200 })
  }

  // Solo procesar texto, ubicación, imagen, audio, documento y sticker
  if (!['text', 'location', 'image', 'audio', 'voice', 'document', 'sticker'].includes(msgType)) return null

  // ── DEBOUNCE (GROUPING) PARA MENSAJES DE TEXTO ──
  // Si el usuario envía varios textos rápidos, los agrupamos en uno solo.
  if (msgType === 'text') {
    const miTs = Date.now()
    const bufferKey = `debounce_${from10}`
    
    // 1. Añadimos nuestro mensaje al buffer
    const { data: bData } = await supabase.from('bot_memory').select('history').eq('phone', bufferKey).maybeSingle()
    let buffer = bData?.history || []
    // Limpiar mensajes muy viejos (ej. > 15s) por seguridad
    buffer = buffer.filter((b: any) => Date.now() - b.ts < 15000)
    buffer.push({ text: msg.text?.body || '', ts: miTs })
    
    await supabase.from('bot_memory').upsert({ phone: bufferKey, history: buffer, updated_at: new Date().toISOString() })
    
    // 2. Esperamos 2s a ver si llegan más (era 4.5s → Supabase lo mataba antes de terminar)
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    // 3. Revisamos el buffer de nuevo
    const { data: bData2 } = await supabase.from('bot_memory').select('history').eq('phone', bufferKey).maybeSingle()
    const currentBuffer = bData2?.history || []
    
    // Si NO soy el último mensaje del buffer, me aborto silenciosamente
    const lastMsg = currentBuffer[currentBuffer.length - 1]
    if (lastMsg && lastMsg.ts !== miTs) {
      console.log(`[DEBOUNCE] Abortando webhook para ${from10}, llegó un mensaje más reciente.`)
      return new Response('OK', { status: 200 })
    }
    
    // Si llegué aquí, soy el último mensaje. Combino todos los textos.
    const combinedText = currentBuffer.map((b: any) => b.text).join(' ')
    msg.text.body = combinedText
    
    // Limpio el buffer para futuras conversaciones
    await supabase.from('bot_memory').delete().eq('phone', bufferKey)
  }

  // ── Modo pausa (admin habló directamente con el cliente) ──
  const { data: pausaData } = await supabase.from('bot_memory')
    .select('history').eq('phone', `bot_pausa_${from10}`).maybeSingle()
  if (pausaData) {
    return new Response('OK', { status: 200 })
  }

  // ── PRIORIDAD 1: Flujo de Onboarding de Restaurante ──
  const { data: restRegData } = await supabase.from('bot_memory')
    .select('history').eq('phone', `reg_rest_${from10}`).maybeSingle()
  if (restRegData?.history?.[0]) {
    return await handleRestaurantOnboarding(supabase, fromPhone, from10, msgType, msg, restRegData.history[0])
  }

  // ── PRIORIDAD 1.5: Guardado rápido de dirección (Esperando nombre) ──
  const { data: saveAddrData } = await supabase.from('bot_memory')
    .select('history').eq('phone', `save_addr_state_${from10}`).maybeSingle()
  if (saveAddrData?.history?.[0]?.esperando_nombre && msgType === 'text') {
    const customName = msg.text?.body?.trim()
    if (customName) {
      const { lat, lng, colonia } = saveAddrData.history[0]
      await supabase.from('cliente_ubicaciones').upsert({
        cliente_telefono: from10,
        tipo: customName.substring(0, 30), // límite razonable
        colonia_nombre: colonia,
        lat: lat,
        lng: lng,
        ultima_vez: new Date().toISOString()
      }, { onConflict: 'cliente_telefono,tipo,colonia_nombre' })
      await supabase.from('bot_memory').delete().eq('phone', `save_addr_state_${from10}`)
      await sendWA(fromPhone, `✅ ¡Listo! Ubicación guardada como *${customName}* 🏠.\n\nSeguimos buscando repartidor para tu pedido. 🛵`)
    }
    return new Response('OK', { status: 200 })
  }

  // ── PRIORIDAD 1.8: Relay de ubicación al repartidor (cliente responde "no te encuentro") ──
  const { data: relayData } = await supabase.from('bot_memory')
    .select('history').eq('phone', `ubicacion_relay_${from10}`).maybeSingle()
  if (relayData?.history?.[0]?.pedido_id) {
    const { pedido_id } = relayData.history[0]
    let referencia: string | null = null

    if (msgType === 'text') {
      referencia = msg.text?.body?.trim() || null
    } else if (msgType === 'location') {
      const lat = msg.location?.latitude
      const lng = msg.location?.longitude
      referencia = lat && lng ? `📍 GPS: ${lat.toFixed(6)},${lng.toFixed(6)}` : null
    }

    if (referencia) {
      // Guardar la referencia en el pedido — la app del repartidor la ve en tiempo real
      await supabase.from('pedidos')
        .update({ referencias_cliente: referencia })
        .eq('id', pedido_id)

      // Limpiar el estado relay (una sola respuesta es suficiente)
      await supabase.from('bot_memory').delete().eq('phone', `ubicacion_relay_${from10}`)

      // Confirmarle al cliente que ya le llegó al repartidor
      await sendWA(fromPhone,
        `✅ *¡Listo!* Ya le mandé tu referencia al repartidor. Llegará en un momento. 🛵`
      )
    }
    return new Response('OK', { status: 200 })
  }

  // ── Buscar cliente en BD ──
  const { data: clienteDB } = await supabase.from('clientes')
    .select('nombre, puntos, es_vip, reputacion, saldo_billetera, envios_totales, rango, acepta_terminos, notas_crm')
    .eq('telefono', from10).limit(1).maybeSingle()

  let ubicacionesGuardadas: any[] = []
  const { data: ubiData } = await supabase.from('cliente_ubicaciones')
    .select('tipo, colonia_nombre, lat, lng')
    .eq('cliente_telefono', from10)
    .not('tipo', 'in', '(origen,destino)')
  if (ubiData) ubicacionesGuardadas = ubiData

  let historialPedidos: any[] = []
  if (clienteDB) {
    const { data: pedidosData } = await supabase.from('pedidos')
      .select('restaurante, descripcion, total, tipo_pedido, created_at, estado')
      .eq('cliente_telefono', from10)
      .neq('estado', 'pendiente_pago')
      .order('created_at', { ascending: false })
      .limit(10)
    if (pedidosData) historialPedidos = pedidosData
  }

  const SUPABASE_PROJECT_URL = Deno.env.get('SUPABASE_URL') || ''

  let perfilInteligente = null
  if (clienteDB) {
    const { data: perfilData } = await supabase.from('cliente_perfiles')
      .select('tono_preferido, alergias_gustos, resumen_memoria, ubicaciones_semanticas, rutinas')
      .eq('cliente_telefono', from10)
      .maybeSingle()
    if (perfilData) perfilInteligente = perfilData
  }

  const clienteCtx = clienteDB ? { ...clienteDB, ubicacionesGuardadas, historialPedidos, perfilInteligente } : null

  // ── PRIORIDAD 2: ¿El cliente está en un flujo activo de mandadito (Rígido)? ──────────
  // Si hay sesión en bot_memory, TODOS sus mensajes van al handler — nunca a la IA.
  const { data: mandaditoSession } = await supabase
    .from('bot_memory').select('history').eq('phone', STATE_KEY(from10)).maybeSingle()

  if (mandaditoSession?.history?.[0]) {
    const currentState = mandaditoSession.history[0]
    let ubicacion: { texto?: string; lat?: number; lng?: number } = {}
    if (msgType === 'location') {
      ubicacion = { lat: msg.location?.latitude, lng: msg.location?.longitude }
    } else if (msgType === 'text') {
      ubicacion = { texto: msg.text?.body as string ?? '' }
    } else if (msgType === 'image') {
      // Durante un flujo activo de mandadito, imagen no sirve para geolocalización
      await sendWA(fromPhone, `Por favor envíanos la dirección en *texto* o comparte tu 📍 *Ubicación GPS*.`)
      return new Response('OK', { status: 200 })
    }
    await avanzarFlujoMandadito(supabase, fromPhone, from10, currentState, ubicacion)
    return new Response('OK', { status: 200 })
  }

  // ── PRIORIDAD 3: Flujo Conversacional Agéntico ──
  const { data: agenteSession } = await supabase
    .from('bot_memory').select('history').eq('phone', `mandadito_agent_${from10}`).maybeSingle()

  // ── Determinar texto y mediaUrl para whatsapp-ai ──
  let textoEnviar: string
  let mediaUrl: string | null = null
  let mediaMsgType: string | null = null

  if (msgType === 'location') {
    textoEnviar = `[UBICACIÓN GPS COMPARTIDA: ${msg.location?.latitude},${msg.location?.longitude}]`
  } else if (msgType === 'image') {
    // YCloud incluye una URL directa de descarga en msg.image.link
    mediaUrl = msg.image?.link || msg.image?.url || null
    mediaMsgType = 'image'
    textoEnviar = msg.image?.caption || '[El usuario envió una imagen]'
  } else if (msgType === 'audio' || msgType === 'voice') {
    console.log(`[client-flow] Procesando audio/voice. payload: ${JSON.stringify(msg.audio || msg.voice || {})}`)
    mediaUrl = msg.audio?.link || msg.audio?.url || msg.voice?.link || msg.voice?.url || null
    console.log(`[client-flow] URL extraida: ${mediaUrl}`)
    mediaMsgType = msgType
    textoEnviar = '[El usuario envió un audio]'
  } else if (msgType === 'sticker') {
    await sendWA(fromPhone, `❌ Por el momento no puedo leer stickers. Por favor envíame un mensaje de texto o un audio de voz normal.`)
    return new Response('OK', { status: 200 })
  } else if (msgType === 'document') {
    mediaUrl = msg.document?.link || msg.document?.url || null
    mediaMsgType = 'document'
    textoEnviar = msg.document?.filename ? `[El usuario envió un documento: ${msg.document.filename}]` : '[El usuario envió un documento]'
  } else {
    textoEnviar = (msg.text?.body as string) ?? ''
  }

  // ── 🚀 INTERCEPTOR DE ICEBREAKERS (Disparadores de YCloud) ──
  // Si el usuario toca un botón de "Disparador de Conversación" en un chat nuevo,
  // interceptamos el texto exacto para saltarnos la IA y lanzar la acción nativa de inmediato.
  if (msgType === 'text') {
    const rawText = textoEnviar.trim().toLowerCase()
    
    if (rawText === 'ver menú' || rawText === 'ver menu') {
      console.log(`[ICEBREAKER] Interceptado: Ver Menú -> from10: ${from10}`)
      const { sendCatalogMessage } = await import('./whatsapp.ts')
      const txt = clienteCtx?.nombre 
        ? `¡Hola ${clienteCtx.nombre}! 🌟 Aquí tienes nuestro catálogo de restaurantes 👇` 
        : `¡Hola${profileName ? ' ' + profileName : ''}! 🌟 Aquí tienes nuestro catálogo de restaurantes 👇`
      await sendCatalogMessage(fromPhone, txt)
      return new Response('OK', { status: 200 })
    }
    
    if (rawText === 'solicitar un mandadito') {
      console.log(`[ICEBREAKER] Interceptado: Solicitar Mandadito -> from10: ${from10}`)
      const { iniciarFlujoMandadito } = await import('./mandadito/handler.ts')
      await iniciarFlujoMandadito(supabase, fromPhone, from10, '', clienteCtx)
      return new Response('OK', { status: 200 })
    }
  }

  // @ts-ignore
  EdgeRuntime.waitUntil(
    fetch(`${SUPABASE_PROJECT_URL}/functions/v1/whatsapp-ai`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromPhone, from10,
        texto: textoEnviar,
        isRepartidor: false, repartidorInfo: null,
        isClient: true, clienteCtx, regState: undefined, profileName,
        agenteSession: agenteSession?.history || null,
        mediaUrl,
        mediaMsgType,
        msgId: msg?.wamid || msg?.id
      })
    }).catch(err => console.error('Error invocando whatsapp-ai:', err))
  )

  return new Response('OK', { status: 200 })
}
