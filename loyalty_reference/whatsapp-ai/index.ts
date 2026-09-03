import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { conversacionDeepSeek } from '../whatsapp-bot/ai.ts'
import { sendWA, sendWALocation, sendInteractiveButtons, downloadYCloudMedia, sendTypingIndicator, markAsRead } from '../whatsapp-bot/whatsapp.ts'
import { guardarMemoria } from '../whatsapp-bot/db.ts'
import * as h3 from 'npm:h3-js@4.1.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const sendWAMulti = async (to: string, texto: string) => {
  const partes = texto.split('|||').map(p => p.trim()).filter(Boolean)
  for (let i = 0; i < partes.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 600))
    await sendWA(to, partes[i])
  }
}

const sendWAWithMainMenu = async (to: string, texto: string) => {
  const partes = texto.split('|||').map(p => p.trim()).filter(Boolean)
  for (let i = 0; i < partes.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 600))
    
    // Si es el último mensaje, lo enviamos con los botones del menú principal
    if (i === partes.length - 1) {
      await sendInteractiveButtons(to, partes[i], [
        { id: 'MENU_VER_PUNTOS', title: '⭐ Ver mis puntos' },
        { id: 'MENU_CANCELAR', title: '❌ Cancelar / Salir' }
      ])
    } else {
      await sendWA(to, partes[i])
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MÁQUINA DE ESTADOS — Registro de cliente no registrado
// El CÓDIGO controla cada paso. La IA NO participa en este flujo.
//
// Paso 0: Primer contacto   → saludar, pedir nombre
// Paso 1: Recibe nombre     → validar, guardar, pedir colonia
// Paso 2: Recibe colonia    → guardar, pedir dirección (texto o ubicación)
// Paso 3: Recibe dirección  → guardar, mostrar resumen + botones SI/NO
// Paso 4: Recibe SI/NO      → registrar o reiniciar
// ════════════════════════════════════════════════════════════════════════════
async function handleRegistrationFlow(
  supabase: any,
  fromPhone: string,
  from10: string,
  texto: string,
  regState: { nombre?: string; tel?: string; colonia?: string; direccion?: string; lat?: number; lng?: number; step?: number; ts?: number } | undefined,
  locationData?: { lat: number; lng: number; address?: string; name?: string } | null
): Promise<boolean> {
  // ── TTL: Si el reg_state tiene más de 24h, reiniciar ─────────────────────
  const REG_TTL_MS = 24 * 60 * 60 * 1000
  if (regState?.ts && Date.now() - regState.ts > REG_TTL_MS) {
    await supabase.from('bot_memory').delete().eq('phone', `reg_state_${from10}`)
    regState = { tel: from10, step: 0 }
    console.log(`⏰ [RegSM] TTL expirado para ${from10} — reiniciando`)
  }

  const step      = regState?.step ?? 0
  const nombre    = regState?.nombre?.trim()    ?? ''
  const colonia   = regState?.colonia?.trim()   ?? ''
  const direccion = regState?.direccion?.trim()  ?? ''
  const msg       = texto.trim()

  const save = async (patch: Record<string, any>) => {
    const next = { nombre, tel: from10, colonia, direccion, lat: regState?.lat, lng: regState?.lng, step, ts: Date.now(), ...patch }
    await supabase.from('bot_memory').upsert({
      phone: `reg_state_${from10}`,
      history: [next],
      updated_at: new Date().toISOString()
    })
      console.log(`💾 [RegSM] step=${next.step} | ID=${from10.slice(-4)}`)
  }

  const showConfirmation = async (coloniaFinal: string, dirFinal: string, latFinal?: number, lngFinal?: number) => {

    await sendWA(fromPhone,
      `¡Perfecto! Confirma tus datos 📋\n\n` +
      `👤 Nombre: *${nombre}*\n` +
      `📱 Tel: *${from10}*\n` +
      `🏠 Colonia: *${coloniaFinal}*\n` +
      `📍 Dirección: *${dirFinal}*`
    )
    // Mandar mapa real de WhatsApp si tenemos coordenadas
    if (latFinal && lngFinal) {
      await sendWALocation(fromPhone, latFinal, lngFinal, coloniaFinal, dirFinal)
    }
    await sendInteractiveButtons(fromPhone, '¿Todo correcto? 😊', [
      { id: `REG_CONFIRM_SI_${from10}`, title: '✅ Sí, registrarme' },
      { id: `REG_CONFIRM_NO_${from10}`, title: '❌ No, corregir' }
    ])
  }

  // ── PASO 0: Primer contacto ───────────────────────────────────────────────
  if (step === 0) {
    // Guard: ¿ya tiene una solicitud pendiente? (BUG-10 fix: 24h TTL)
    const { data: pending } = await supabase.from('bot_memory')
      .select('history').eq('phone', `pending_reg_${from10}`).maybeSingle()
    if (pending?.history?.[0]) {
      const solicitado = new Date(pending.history[0].solicitado).getTime()
      if (Date.now() - solicitado > 24 * 60 * 60 * 1000) {
        // Expiró, lo borramos silenciosamente y dejamos que se registre de nuevo
        await supabase.from('bot_memory').delete().eq('phone', `pending_reg_${from10}`)
        console.log(`⏰ [RegSM] pending_reg expirado para ${from10}`)
      } else {
        await sendWA(fromPhone,
          `⏳ Ya tienes una solicitud de registro pendiente.\nEn cuanto el equipo la revise, te avisamos aquí. 😊`
        )
        return true
      }
    }
    // Guard: ¿ya está registrado en clientes como VIP completo?
    const { data: yaCliente } = await supabase.from('clientes')
      .select('nombre, acepta_terminos').eq('telefono', from10).maybeSingle()
    if (yaCliente && yaCliente.acepta_terminos === true) {
      await sendWA(fromPhone,
        `✅ *${yaCliente.nombre}*, ya estás registrado en Estrella Envíos.\n🔗 https://www.app-estrella.shop/loyalty/`
      )
      await supabase.from('bot_memory').delete().eq('phone', `reg_state_${from10}`)
      return true
    }
    await save({ step: 1 })
    await sendWAMulti(fromPhone,
      `👋 ¡Hola! Soy el asistente virtual de *Estrella Envíos* 🌟 (nuestra división de comida se llama *Estrella Eats*)` +
      `|||Para brindarte un mejor servicio y beneficios VIP, vamos a registrarte. Como tu número ya está vinculado (*${from10}*), ¡no necesitas escribirlo! 📱` +
      `|||¿Me podrías decir tu *nombre completo*? 👤`
    )
    return true
  }

  // ── PASO 1: Esperando nombre ──────────────────────────────────────────────
  if (step === 1) {
    if (msg.length < 3 || /^\d+$/.test(msg)) {
      await sendWA(fromPhone, `👤 Por favor escríbeme tu *nombre completo* (ej: Juan Pérez).`)
      return true
    }
    await save({ nombre: msg, step: 2 })
    await sendWAMulti(fromPhone,
      `¡Perfecto, *${msg.split(' ')[0]}*! 👋` +
      `|||¿En qué *colonia* vives? Escríbela o comparte tu 📌 *ubicación* (botón 📎 → Ubicación) y listo.`
    )
    return true
  }

  // ── PASO 2: Esperando colonia (o ubicación directa) ──────────────────────
  if (step === 2) {
    // Caso A: El cliente compartió su ubicación en este paso → la usamos como colonia+dirección
    if (locationData) {
      const { lat, lng, address, name } = locationData
      // Guard: coordenadas inválidas (null island 0,0)
      if (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01) {
        await sendWA(fromPhone, `⚠️ No pude leer tu ubicación. ¿Intenta de nuevo o escribe tu dirección?`)
        return true
      }
      // BUG-12 fix: extraer colonia inteligente — evitar tomar la ciudad como colonia
      // address suele ser: "Calle, Colonia, Ciudad, Estado, Código"
      const partes = (address || '').split(',').map(p => p.trim()).filter(Boolean)
      const ESTADO_MUNICIPIO = ['comitán', 'comitan', 'chiapas', 'méxico', 'mexico']
      const coloniaDeUbicacion = partes.find((p, i) =>
        i > 0 && i < partes.length - 2 && !ESTADO_MUNICIPIO.some(c => p.toLowerCase().includes(c))
      ) || partes[1]?.trim() || partes[0]?.trim() || `${lat},${lng}`
      const dirCompleta = address || name || `${lat},${lng}`

      await save({ colonia: coloniaDeUbicacion, direccion: dirCompleta, lat, lng, step: 4 })
      await showConfirmation(coloniaDeUbicacion, dirCompleta, lat, lng)
      return true
    }

    // Caso B: Escribió texto como colonia
    if (msg.length < 3 || /^\d+$/.test(msg)) {
      await sendWA(fromPhone, `🏠 Por favor dime tu *colonia* (ej: La Esperanza, Centro...)`)
      return true
    }

    const { normalizarAbreviaturas } = await import('../_shared/utils.ts')
    const textoNorm = normalizarAbreviaturas(msg)
    const { data: colMatch } = await supabase.rpc('search_colonia_smart', { p_nombre: textoNorm })
    
    let coloniaGuardar = msg
    if (colMatch && colMatch.length > 0 && colMatch[0].score > 0.4) {
      coloniaGuardar = colMatch[0].nombre
    }

    await save({ colonia: coloniaGuardar, step: 3 })
    await sendWAMulti(fromPhone,
      `¡Gracias! Ya casi 😊` +
      `|||📍 ¿Cuál es tu *dirección*? Escríbela o comparte tu *📌 ubicación* desde WhatsApp (botón 📎 → Ubicación).`
    )
    return true
  }

  // ── PASO 3: Esperando dirección (texto o pin de ubicación) ───────────────
  if (step === 3) {
    // Caso A: Cliente compartió su ubicación (pin de Google Maps)
    if (locationData) {
      const { lat, lng, address, name } = locationData
      const dirGuardada = address || name || `${lat}, ${lng}`
      await save({ direccion: dirGuardada, lat, lng, step: 4 })
      await showConfirmation(colonia, dirGuardada, lat, lng)
      return true
    }

    // Caso B: Cliente escribió su dirección como texto
    if (msg.length < 5) {
      await sendWAMulti(fromPhone,
        `📍 Por favor escribe tu *dirección completa* (ej: Calle Niños Héroes #12, Col. Centro)` +
        `|||...o usa el botón 📎 → *Ubicación* para compartir tu pin de Google Maps.`
      )
      return true
    }
    await save({ direccion: msg, step: 4 })
    await showConfirmation(colonia, msg)
    return true
  }

  // ── PASO 4: Esperando confirmación (viene de botones SI/NO) ───────────────
  if (step === 4) {
    const lower = msg.toLowerCase().trim()
    // BUG-08 fix: usar palabras completas para evitar falsos positivos (ej: "mal" en "mándalo")
    const wordMatch = (words: string[]) => words.some(w => new RegExp(`\\b${w}\\b`, 'i').test(lower) || lower === w)
    const esConfirmacion = wordMatch(['si', 'sí', 'yes', 'ok', 'correcto', 'exacto', 'confirmo', 'dale', 'va', 'listo', 'perfecto', 'claro', '✅'])
    const esRechazo = wordMatch(['no', 'nop', 'mal', 'error', 'cambiar', 'equivocado', 'incorrecto', 'cancel', 'reiniciar'])

    if (esRechazo) {
      // BUG-01 fix: un solo upsert reemplaza el estado — sin delete previo que puede dejar orphan state
      await supabase.from('bot_memory').upsert({
        phone: `reg_state_${from10}`,
        history: [{ nombre: '', tel: from10, colonia: '', direccion: '', lat: null, lng: null, step: 1, ts: Date.now() }],
        updated_at: new Date().toISOString()
      })
      await sendWAMulti(fromPhone, `Sin problema 😊 Vamos de nuevo.|||¿Cuál es tu *nombre completo*? 👤`)
      return true
    }

    if (esConfirmacion) {
      // Validar datos mínimos
      if (!nombre || !colonia) {
        await supabase.from('bot_memory').delete().eq('phone', `reg_state_${from10}`)
        await save({ nombre: '', colonia: '', direccion: '', step: 1 })
        await sendWAMulti(fromPhone, `⚠️ Faltan datos. Vamos a reiniciar.|||¿Cuál es tu *nombre completo*? 👤`)
        return true
      }

      const lat = regState?.lat
      const lng = regState?.lng
      const mapLink = lat && lng ? `\n📍 https://maps.google.com/?q=${lat},${lng}` : ''

      // Guardar solicitud pendiente para el admin
      await supabase.from('bot_memory').upsert({
        phone: `pending_reg_${from10}`,
        history: [{
          nombre, telefono: from10, colonia,
          direccion, lat, lng,
          solicitado: new Date().toISOString()
        }],
        updated_at: new Date().toISOString()
      })

      // Notificar al admin
      const ADMIN_PHONES_ENV = Deno.env.get('ADMIN_PHONES') ?? Deno.env.get('ADMIN_PHONE') ?? ''
      const admin10 = ADMIN_PHONES_ENV.split(',')[0]?.trim() || ''
      if (admin10) {

        await sendWA(`52${admin10}`,
          `🔔 *Nueva Solicitud VIP*\n\n` +
          `👤 Nombre: ${nombre}\n📞 Tel: ${from10}\n` +
          `🏠 Colonia: ${colonia}\n📍 Dir: ${direccion || 'no especificada'}`
        )
        // BUG-07 fix: mandar mapa real al admin si hay coordenadas
        if (lat && lng) {
          await sendWALocation(`52${admin10}`, lat, lng, `${nombre} — ${colonia}`, direccion || colonia)
        }
        await sendInteractiveButtons(`52${admin10}`, '¿Aprobar solicitud?', [
          { id: `reg_accept_${from10}`, title: '✅ Aprobar' },
          { id: `reg_reject_${from10}`, title: '❌ Rechazar' }
        ])
      }

      await sendWAMulti(fromPhone,
        `🎉 ¡Excelente, *${(nombre.split(' ')[0] || nombre) || 'amigo/a'}*!` +
        `|||Tu solicitud fue enviada. En unos minutos recibirás tu confirmación y código QR aquí mismo. ⏳`
      )

      // Limpiar estado de registro
      await supabase.from('bot_memory').delete().eq('phone', `reg_state_${from10}`)
      await supabase.from('bot_memory').delete().eq('phone', from10)
      return true
    }

    // Respuesta ambigua → repetir botones
    const mapLink = regState?.lat && regState?.lng
      ? `\n📍 https://maps.google.com/?q=${regState.lat},${regState.lng}`
      : ''

    await sendWA(fromPhone,
      `¿Confirmas estos datos? 😊\n\n` +
      `👤 *${nombre}* | 📱 *${from10}*\n🏠 *${colonia}* | 📍 *${direccion}*` + mapLink
    )
    await sendInteractiveButtons(fromPhone, '¿Todo correcto?', [
      { id: `REG_CONFIRM_SI_${from10}`, title: '✅ Sí, registrarme' },
      { id: `REG_CONFIRM_NO_${from10}`, title: '❌ No, corregir' }
    ])
    return true
  }

  return false
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════
serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || authHeader.replace('Bearer ', '').trim() !== SUPABASE_KEY) {
      return new Response('Unauthorized', { status: 401 })
    }

    const {
      fromPhone, from10, texto,
      isRepartidor, repartidorInfo,
      isClient, clienteCtx, regState,
      agenteSession,
      locationData,
      mediaUrl,
      mediaMsgType,
      msgId,
      profileName
    } = await req.json()

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
    console.log(`🤖 [whatsapp-ai] ${from10.slice(0,3)}***${from10.slice(-3)} | registrado=${!!clienteCtx} | media=${mediaMsgType ?? 'none'}`)

    if (msgId) {
      // Mandar "visto" y "escribiendo..." de inmediato (fire and forget)
      markAsRead(msgId).catch(err => console.error('[markAsRead]', err))
      sendTypingIndicator(msgId).catch(err => console.error('[sendTypingIndicator]', err))
    }

    // ── Descargar media si viene adjunta ──
    let mediaData: { base64: string; mimeType: string } | null = null
    if (mediaUrl && mediaMsgType) {
      console.log(`📷 [whatsapp-ai] Descargando ${mediaMsgType} url=${mediaUrl.slice(0, 60)}...`)
      mediaData = await downloadYCloudMedia(mediaUrl)
      if (!mediaData) {
        console.error(`[whatsapp-ai] No se pudo descargar media desde ${mediaUrl.slice(0, 60)}`)
      }
    }

    // ── CLIENTE NO REGISTRADO → Máquina de estados (sin IA, sin loops) ──────
    // Desactivado a petición del usuario para que la IA responda a todos.
    /*
    if (!clienteCtx) {
      const handled = await handleRegistrationFlow(
        supabase, fromPhone, from10, texto, regState, locationData
      )
      if (handled) return new Response('OK', { status: 200 })
    }
    */

    // ── CLIENTE EN FLUJO AGÉNTICO ──────────────────────────────────────────
    if (agenteSession) {
      const { runMandaditoAgent } = await import('../whatsapp-bot/mandadito/agent.ts')
      // Bug fix: pasar fromPhone (con prefijo 52) — no from10 — para que el agente
      // construya correctamente el número de destino de WhatsApp.
      const result = await runMandaditoAgent(supabase, agenteSession, texto, fromPhone, mediaData, clienteCtx)

      if (result.action === 'FINALIZAR_COTIZACION') {
        // Guardamos el historial sólo si NO vamos a finalizar, para evitar
        // que una sesión corrupta quede en BD si cotizar_mandadito falla.
        // La limpieza va en finally para garantizarla incluso ante excepciones.
        try {
          const { cotizar_mandadito } = await import('../whatsapp-bot/mandadito/handler.ts')
          await cotizar_mandadito(supabase, fromPhone, from10, result.data)
        } finally {
          await supabase.from('bot_memory').delete().eq('phone', `mandadito_agent_${from10}`)
        }
      } else {
        // Solo guardamos historial cuando la conversación continúa
        if (result.newHistory) {
          await supabase.from('bot_memory').upsert({
            phone: `mandadito_agent_${from10}`,
            history: result.newHistory,
            updated_at: new Date().toISOString()
          })
        }
        if (result.textResponse) {
          await sendWA(fromPhone, result.textResponse)
        }
      }
      return new Response('OK', { status: 200 })
    }

    // ── CLIENTE REGISTRADO / REPARTIDOR → IA conversacional ──────────────────────────────────
    const resAI = await conversacionDeepSeek(
      supabase, fromPhone, texto,
      isRepartidor, repartidorInfo,
      isClient, clienteCtx, regState,
      mediaData,
      profileName
    )

    if (resAI?.errorObj) {
      const { sendInteractiveButtons } = await import('../whatsapp-bot/whatsapp.ts')
      const fallbackTxt = `⚠️ Mi cerebro de IA está en mantenimiento temporal.\n\nPero no te preocupes, puedes seguir pidiendo usando los botones de abajo 👇`
      await sendInteractiveButtons(fromPhone, fallbackTxt, [
        { id: 'MENU_MANDADITO', title: '📦 Enviar Paquete' },
        { id: 'MENU_COMIDA', title: '🍔 Pedir Comida' },
        { id: 'MENU_SOPORTE', title: '📞 Soporte Humano' }
      ])
      return new Response('OK', { status: 200 })
    }

    if (!resAI?.respuesta) return new Response('OK', { status: 200 })

    if (resAI.nuevoHistorial) {
      await guardarMemoria(supabase, from10, resAI.nuevoHistorial)
    }

    const accion = resAI.respuesta.accion
    const d = resAI.respuesta.datosAExtraer as any
    const sentimiento = (resAI.respuesta as any).sentimiento || 'neutro'

    // ── 😤 VIGÍA EMOCIONAL (SOS WATCHDOG) ────────────────────────────────
    if (sentimiento === 'molesto' || sentimiento === 'furioso') {
      const ADMIN_PHONES_ENV_A = Deno.env.get('ADMIN_PHONES') ?? Deno.env.get('ADMIN_PHONE') ?? ''
      const adminPhones = ADMIN_PHONES_ENV_A.split(',').map((p: string) => p.replace(/\D/g, '').slice(-10)).filter(Boolean)
      const nivel = sentimiento === 'furioso' ? '🔴 FURIOSO' : '🟠 MOLESTO'
      const vipTag = clienteCtx?.es_vip ? '🌟 *CLIENTE VIP* 🌟' : '👤 Cliente Standard'
      const alertaMsg = [
        `🚨 *VIGÍA EMOCIONAL: ALERTA SOS* 🚨`,
        ``,
        `El sistema detectó un cliente ${nivel}:`,
        `Rango: ${vipTag}`,
        `Cliente: wa.me/${fromPhone} (${clienteCtx?.nombre || 'Desconocido'})`,
        `Mensaje: "${texto.substring(0, 200)}"`,
        ``,
        `_Atiende rápido antes de que escale._`
      ].join('\n')
      const { sendInteractiveButtons } = await import('../whatsapp-bot/whatsapp.ts')
      for (const adminPhone of adminPhones) {
        sendInteractiveButtons(`52${adminPhone}`, alertaMsg, [
          { id: `ADMIN_PAUSAR_${from10}`, title: '🔇 Pausar Bot' },
          { id: `ADMIN_REACTIVAR_${from10}`, title: '🤖 Reactivar Bot' }
        ]).catch(() => {})
      }
    }

    if (accion === 'REGISTRAR_RESTAURANTE') {
      const nombreRest = d?.nombre_restaurante?.trim()
      // El correo es de CONTACTO únicamente — el email de Auth se construye desde el teléfono
      // en admin-approval. No es obligatorio, pero si se proporciona se guarda.
      const correoContacto = d?.correo?.trim() || null

      if (!nombreRest) {
        await sendWA(fromPhone, `⚠️ Para registrar el restaurante necesito al menos el *nombre del negocio*.`)
        return new Response('OK', { status: 200 })
      }

      const { error: restErr } = await supabase.from('restaurantes_solicitudes').insert({
        nombre_restaurante: nombreRest,
        correo: correoContacto,  // correo de contacto real (opcional)
        telefono: from10
      })
      if (restErr) {
        console.error('[REST_SOL] Error insertando:', restErr)
        await sendWA(fromPhone, `❌ Hubo un error guardando tu solicitud. Inténtalo en un momento.`)
        return new Response('OK', { status: 200 })
      }
      const ADMIN_PHONES_ENV = Deno.env.get('ADMIN_PHONES') ?? Deno.env.get('ADMIN_PHONE') ?? ''
      const admin10 = ADMIN_PHONES_ENV.split(',')[0]?.replace(/\D/g, '').slice(-10) || ''
      const functionUrl = `${SUPABASE_URL}/functions/v1/admin-approval`
      const secret = Deno.env.get('ADMIN_APPROVAL_SECRET') || ''
      if (admin10) {
        await sendWA(`52${admin10}`, `🔔 *Nueva Solicitud de Restaurante*\nNombre: ${nombreRest}\nTel: wa.me/52${from10}${correoContacto ? `\nContacto: ${correoContacto}` : ''}`)
        await sendWA(`52${admin10}`, `✅ ${functionUrl}?action=accept&tel=${from10}&secret=${secret}`)
        await sendWA(`52${admin10}`, `❌ ${functionUrl}?action=reject&tel=${from10}&secret=${secret}`)
      }
      await sendWA(fromPhone, `🎉 Solicitud enviada. Te confirmamos pronto. ✉️`)
      await supabase.from('bot_memory').delete().eq('phone', from10)

    } else if (accion === 'SOLICITAR_REGISTRO') {
      const { sendInteractiveFlow } = await import('../whatsapp-bot/whatsapp.ts')
      const flowToken = JSON.stringify({ phone: fromPhone })
      await sendInteractiveFlow(fromPhone, `¡Genial! 🎉 Para darte de alta como Cliente VIP y enviarte tu tarjeta digital, por favor llena este rápido formulario:`, `📝 Llenar Formulario`, `1489224042353572`, flowToken, `REGISTRO_CLIENTE`)
    } else if (accion === 'VER_RESTAURANTES_CLIENTE') {
      const { sendCatalogMessage } = await import('../whatsapp-bot/whatsapp.ts')
      const msg = resAI.respuesta.mensajeUsuario || `¡Con gusto! 🍔🍕 Toca el botón de abajo para abrir nuestro menú directamente aquí en WhatsApp, explora los restaurantes, arma tu carrito y envíamelo:`
      await sendCatalogMessage(fromPhone, msg)
    } else if (accion === 'APLICAR_REFERIDO') {
      // ── 👥 SISTEMA DE REFERIDOS ───────────────────────────────────────────
      const codigoRef = d?.codigoReferido?.toUpperCase()?.trim()
      if (!codigoRef) {
        await sendWA(fromPhone, `⚠️ No detecté un código de referido válido. Los códigos tienen el formato *ESTRELLA-XXXX*. ¿Me lo envías de nuevo?`)
        return new Response('OK', { status: 200 })
      }
      // Buscar quién tiene ese código
      const { data: referidor } = await supabase.from('clientes')
        .select('id, nombre, telefono, puntos')
        .eq('codigo_referido', codigoRef)
        .maybeSingle()

      if (!referidor) {
        await sendWA(fromPhone, `❌ El código *${codigoRef}* no existe. Verifica que sea correcto y vuelve a intentarlo.`)
        return new Response('OK', { status: 200 })
      }

      // Verificar que el cliente actual no haya ya usado un referido
      const { data: clienteActual } = await supabase.from('clientes')
        .select('id, referido_por, nombre')
        .eq('telefono', from10)
        .maybeSingle()

      if (clienteActual?.referido_por) {
        await sendWA(fromPhone, `👥 Ya tienes un código de referido registrado. Solo se puede usar uno por cuenta.`)
        return new Response('OK', { status: 200 })
      }

      // Aplicar referido: +1 punto al referidor y +1 al cliente actual
      await supabase.from('clientes').update({ referido_por: codigoRef, puntos: (clienteActual ? 1 : 0) }).eq('id', clienteActual?.id).select()
      await supabase.rpc('fn_registrar_entrega_bulk', { p_cliente_tel: from10, p_cantidad: 1 }).catch(() => {})
      await supabase.rpc('fn_registrar_entrega_bulk', { p_cliente_tel: referidor.telefono, p_cantidad: 1 }).catch(() => {})

      // Notificar al referidor
      await sendWA(`52${referidor.telefono.slice(-10)}`, `🎁 *¡Buenas noticias, ${referidor.nombre?.split(' ')[0] || 'amigo/a'}!*\n\nUn amigo tuyo se acaba de unir con tu código *${codigoRef}*. ¡Te ganaste *1 punto extra* ⭐ gracias a él!`)
      await sendWAMulti(fromPhone, `✅ ¡Código de referido *${codigoRef}* aplicado con éxito!|||Has ganado *1 punto extra* ⭐ y tu amigo ${referidor.nombre?.split(' ')[0] || ''} también recibió uno. ¡Gracias por crecer la comunidad Estrella! 🚀`)
    } else if (accion === 'GUARDAR_DIRECCION_FAVORITA') {
      const etiqueta = d?.etiqueta_direccion?.trim()?.toLowerCase() || 'favorita'
      const dir = d?.direccion?.trim() || ''

      // Bug 2 Fix: Validar texto vacío
      if (!dir) {
        await sendWAMulti(fromPhone, `⚠️ Necesito que me escribas la dirección o me mandes tu ubicación por GPS para poder guardarla.`)
        return new Response('OK', { status: 200 })
      }

      let lat = locationData?.lat ?? null
      let lng = locationData?.lng ?? null
      if (!lat && dir.includes(',')) {
        const parts = dir.split(',')
        const pl = parseFloat(parts[0]), plg = parseFloat(parts[1])
        if (!isNaN(pl) && !isNaN(plg) && Math.abs(pl) <= 90 && Math.abs(plg) <= 180) { lat = pl; lng = plg }
      }

      // Validacion Geografica (Nivel 1): Búsqueda difusa en h3_zonas (Robusto)
      if (!lat || !lng) {
        try {
          const { data: dbMatch } = await supabase.from('h3_zonas')
            .select('nombre, h3_index')
            .ilike('nombre', `%${dir}%`)
            .limit(1).maybeSingle();

          if (dbMatch && dbMatch.h3_index) {
            const [centerLat, centerLng] = h3.cellToLatLng(dbMatch.h3_index);
            lat = centerLat;
            lng = centerLng;
            dir = dbMatch.nombre; // Normalizar el nombre
            console.log(`[GEO] Match en base de datos local (H3): ${dir} -> [${lat}, ${lng}]`);
          }
        } catch (e) {
          console.error('[GEO] Error buscando en h3_zonas:', e);
        }
      }

      // Validacion Geografica (Nivel 2) con Google Maps
      if (!lat || !lng) {
        try {
          const mapsKey = Deno.env.get('GOOGLE_MAPS_KEY');
          const queryLower = dir.toLowerCase();
          const buscaCalleOEscuela = queryLower.includes('calle') || queryLower.includes('av ') || queryLower.includes('avenida') || queryLower.includes('escuela') || queryLower.includes('blvd');

          if (mapsKey) {
            // Usar Google Maps Geocoding API
            // Forzamos buscar dentro de Comitán con components
            const searchUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(dir)}&components=locality:Comitán&key=${mapsKey}`;
            const geocodeRes = await fetch(searchUrl);
            const geoData = await geocodeRes.json();

            if (geoData.status === 'OK' && geoData.results.length > 0) {
              let bestMatch = geoData.results[0];
              
              if (!buscaCalleOEscuela) {
                // Buscar si hay algún resultado que sea 'neighborhood' o 'sublocality'
                for (const res of geoData.results) {
                  if (res.types && (res.types.includes('neighborhood') || res.types.includes('sublocality'))) {
                    bestMatch = res;
                    break;
                  }
                }
              }

              // Prevenir el bug de la ciudad completa (si el mapa devuelve todo Comitán)
              const isGenericCity = bestMatch.types.includes('locality') && bestMatch.types.includes('political') && !bestMatch.types.includes('neighborhood');
              
              if (!isGenericCity) {
                lat = bestMatch.geometry.location.lat;
                lng = bestMatch.geometry.location.lng;
              } else {
                console.warn(`[Google Maps] Falso positivo detectado (Centro de ciudad) para: "${dir}"`);
              }
            }
          } else {
            // Fallback a Nominatim si no hay llave
            const searchDir = queryLower.includes('comitan') || queryLower.includes('comitán') ? dir : `${dir}, Comitán de Domínguez, Chiapas`;
            const geocodeRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchDir)}&limit=5`, {
              headers: { 'User-Agent': 'EstrellaDeliveryBot/1.0' }
            });
            const geoData = await geocodeRes.json();
            if (geoData && geoData.length > 0) {
              let bestMatch = geoData[0];
              if (!buscaCalleOEscuela) {
                for (const res of geoData) {
                  if (res.addresstype === 'suburb' || res.addresstype === 'neighbourhood' || res.type === 'residential') {
                    bestMatch = res; break;
                  }
                }
              }
              const isGenericCity = bestMatch.type === 'administrative' || bestMatch.class === 'boundary' || ['city', 'municipality', 'state', 'country'].includes(bestMatch.addresstype);
              if (!isGenericCity) {
                lat = parseFloat(bestMatch.lat);
                lng = parseFloat(bestMatch.lon);
              }
            }
          }
        } catch (e) {
          console.error('[Geocoding] Error:', e);
        }
      }

      if (!lat || !lng) {
        await sendWAMulti(fromPhone, `Huy, no logro ubicar "${dir}" exactamente en el mapa 🗺️.|||¿Podrías mandarme tu ubicación por GPS (el botoncito 📎 -> Ubicación) o darme más referencias de calles?`)
        return new Response('OK', { status: 200 })
      }
      
      const upsertOpts = { onConflict: 'cliente_telefono,tipo,colonia_nombre' }
      await supabase.from('cliente_ubicaciones').upsert({
        cliente_telefono: from10,
        tipo: etiqueta,
        colonia_nombre: dir,
        lat, lng,
        ultima_vez: new Date().toISOString()
      }, upsertOpts)

      await sendWAMulti(fromPhone, `✅ ¡Listo! Guardé esta dirección como *${etiqueta}*.|||La próxima vez que pidas un mandadito, solo dime "mándalo a mi ${etiqueta}" y sabré exactamente a dónde ir. 🛵💨`)
    } else if (accion === 'INICIAR_MANDADITO') {
      try {
        // ── 🕵️ INTELIGENCIA DE CLIENTES (Watchdog) ──
        const reputacion = clienteCtx?.reputacion?.toLowerCase()
        const saldo = Number(clienteCtx?.saldo || 0)

        if (reputacion === 'malo' || reputacion === 'vetado') {
          await sendWA(fromPhone, `⚠️ Tu cuenta se encuentra temporalmente suspendida para nuevos envíos.\n\nPor favor comunícate con soporte para revisar tu caso.`)
          // Alerta al Admin
          const ADMIN_PHONES_ENV = Deno.env.get('ADMIN_PHONES') ?? Deno.env.get('ADMIN_PHONE') ?? ''
          const adminPhones = ADMIN_PHONES_ENV.split(',').map((p: string) => p.replace(/\D/g, '').slice(-10)).filter(Boolean)
          const { sendInteractiveButtons } = await import('../whatsapp-bot/whatsapp.ts')
          for (const ap of adminPhones) {
            sendInteractiveButtons(`52${ap}`, `🚨 *WATCHDOG:* El cliente wa.me/${fromPhone} intentó pedir un mandadito pero está marcado como *${reputacion.toUpperCase()}*.`, [
              { id: `ADMIN_PAUSAR_${from10}`, title: '🔇 Pausar Bot' },
              { id: `ADMIN_REACTIVAR_${from10}`, title: '🤖 Reactivar Bot' }
            ]).catch(()=>{})
          }
          return new Response('OK', { status: 200 })
        }

        if (saldo <= -100) {
          await sendWA(fromPhone, `💳 Tienes un adeudo pendiente de *$${Math.abs(saldo)} MXN*.\n\nPara poder crear un nuevo mandadito, necesitas liquidar este adeudo. Contáctanos si tienes dudas.`)
          return new Response('OK', { status: 200 })
        }

        // Iniciamos flujo agéntico
        const { runMandaditoAgent } = await import('../whatsapp-bot/mandadito/agent.ts')
        // Si el cliente envió ubicaciones iniciales en su primer mensaje (texto o audio), podemos pasarlas.
        const result = await runMandaditoAgent(supabase, [], texto, from10, mediaData, clienteCtx)
        
        if (result.newHistory) {
          await supabase.from('bot_memory').upsert({
            phone: `mandadito_agent_${from10}`,
            history: result.newHistory,
            updated_at: new Date().toISOString()
          })
        }

        if (result.action === 'FINALIZAR_COTIZACION') {
          const { cotizar_mandadito } = await import('../whatsapp-bot/mandadito/handler.ts')
          await cotizar_mandadito(supabase, fromPhone, from10, result.data)
          await supabase.from('bot_memory').delete().eq('phone', `mandadito_agent_${from10}`)
        } else if (result.textResponse) {
          await sendWA(fromPhone, result.textResponse)
        }

      } catch (err) {
        console.error('Error en INICIAR_MANDADITO:', err)
        await sendWA(fromPhone, `😔 Tuve un problema iniciando el mandadito. ¿Puedes intentarlo de nuevo?`)
      }

    } else {
      const aiMsg = typeof resAI.respuesta.mensajeUsuario === 'string' && resAI.respuesta.mensajeUsuario.trim()
        ? resAI.respuesta.mensajeUsuario
        : '¡Hola! ¿En qué puedo ayudarte hoy? 😊'
      if (clienteCtx?.acepta_terminos && resAI.nuevoHistorial && resAI.nuevoHistorial.length <= 2) {
        await sendWAWithMainMenu(fromPhone, aiMsg)
      } else {
        await sendWAMulti(fromPhone, aiMsg)
      }
    }

    console.log(`✅ [whatsapp-ai] Listo para ${fromPhone} (${accion})`)
    return new Response('OK', { status: 200 })

  } catch (error: any) {
    console.error(`❌ [whatsapp-ai] Error crítico:`, error)
    return new Response('Internal Server Error', { status: 500 })
  }
})
