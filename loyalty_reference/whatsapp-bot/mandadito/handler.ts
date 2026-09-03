// ═══════════════════════════════════════════════════════════════════════════
// mandadito/handler.ts — Máquina de estados del flujo de mandadito
// Responsabilidad única: dirigir la conversación paso a paso
//
// Este archivo NO sabe de Maps, precios ni NLP.
// Solo llama a geo.ts, pricing.ts y ai.ts en el momento correcto.
//
// Estados:
//   0.5  → Preguntar: ¿tú envías o recibes?
//   1    → Recolectar origen
//   1.5  → Aclaración de origen (múltiples sucursales Maps)
//   1.6  → Aclaración de referencias de origen (solo colonia dada)
//   2    → Recolectar destino
//   2.5  → Aclaración de destino
//   2.6  → Aclaración de referencias de destino
//   3    → Validación IA + Cotización + Confirmación
// ═══════════════════════════════════════════════════════════════════════════

import { sendWA, sendInteractiveButtons, sendInteractiveList, sendLocationRequest } from '../whatsapp.ts'
import { resolverUbicacion, getBarrioFromMaps } from './geo.ts'
import { calcularPrecioMandadito } from './pricing.ts'
import { extraerRutaMandadito, validarDatosCompletos, extraerResumenFinal } from './ai.ts'
import { sanitizeUbicacion } from '../ai.ts'
import type { UbicacionMandadito, UbicacionResuelta, EstadoMandadito } from './types.ts'
import { avanzarMultiParada } from './multi-stop.ts'

const STATE_KEY = (tel: string) => `mandadito_state_${tel}`

// ── Helpers de persistencia ───────────────────────────────────────────────

async function getState(supabase: any, from10: string): Promise<EstadoMandadito | null> {
  const { data } = await supabase.from('bot_memory').select('history').eq('phone', STATE_KEY(from10)).maybeSingle()
  return data?.history?.[0] ?? null
}

async function setState(supabase: any, from10: string, estado: EstadoMandadito): Promise<void> {
  await supabase.from('bot_memory').upsert({
    phone: STATE_KEY(from10),
    history: [{ ...estado, v: 2, ts: Date.now() }],
    updated_at: new Date().toISOString()
  })
}

async function clearState(supabase: any, from10: string): Promise<void> {
  await supabase.from('bot_memory').delete().eq('phone', STATE_KEY(from10))
}

// ── Helpers de UI ─────────────────────────────────────────────────────────

function etiquetaEmoji(tipo: string): string {
  const m: Record<string, string> = {
    casa: '🏠', trabajo: '🏢', escuela: '🏫', oficina: '🏢',
    gym: '💪', iglesia: '⛪', favorita: '⭐'
  }
  return m[tipo?.toLowerCase()] || '📍'
}

function capitalizar(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/** Muestra lista de direcciones guardadas del cliente con opción de escribir */
async function enviarSelectorUbicacion(
  supabase: any,
  fromPhone: string,
  from10: string,
  titulo: string,
  paso: 1 | 2,
  role?: 'envio' | 'recibo'
): Promise<void> {
  const { data: favsRaw } = await supabase
    .from('cliente_ubicaciones')
    .select('tipo, colonia_nombre')
    .eq('cliente_telefono', from10)
    .order('ultima_vez', { ascending: false })
    .limit(20)

  // Deduplicar por tipo
  const tiposVistos = new Set<string>()
  const favs = favsRaw?.filter((f: any) => {
    if (tiposVistos.has(f.tipo)) return false
    tiposVistos.add(f.tipo)
    return true
  }) ?? []

  const debeMostrarGPS = true // Siempre permitimos mandar GPS (pueden arrastrar el pin)

  if (favs.length > 0) {
    const rows = favs.map((f: any) => ({
      id: `MAND_USAR_DIR_${paso}_${f.tipo}`.substring(0, 200),
      title: `${etiquetaEmoji(f.tipo)} ${capitalizar(f.tipo)}`,
      description: f.colonia_nombre?.substring(0, 60) || 'Dirección guardada'
    }))
    rows.push({
      id: `MAND_ESCRIBIR_${paso}`,
      title: `✏️ Escribir dirección`,
      description: 'Escribir colonia y calle'
    })
    await sendInteractiveList(fromPhone, titulo, `Ver mis direcciones 📋`, [{ title: 'Mis direcciones', rows }])
    if (debeMostrarGPS) {
      await sendLocationRequest(fromPhone, `O compárteme tu *Ubicación GPS* exacta 📍👇`)
    }
  } else {
    const extra = debeMostrarGPS
      ? `\n\nEscribe la colonia/barrio o toca el botón abajo para mandar tu *Ubicación GPS* 📍👇`
      : `\n\n_Escribe el nombre de la colonia, barrio o lugar._`
    if (debeMostrarGPS) {
      await sendLocationRequest(fromPhone, titulo + extra)
    } else {
      await sendWA(fromPhone, titulo + extra)
    }
  }
}

// ── Palabras que claramente no son direcciones ────────────────────────────
const PALABRAS_NO_UBICACION = new Set([
  'hola', 'hi', 'hello', 'hey', 'buenas', 'salir', 'exit', 'volver', 'regresar',
  'cancelar', 'cancel', 'nada', 'olvídalo', 'olvidalo', 'menu', 'menú', 'inicio',
  'ayuda', 'help', 'gracias', 'ok', 'okey', 'si', 'sí', 'no quiero', 'adios', 'bye',
  'que onda', 'como estas', 'cómo estás', 'buenos días', 'buenos dias', 'buenas tardes',
  'buenas noches', 'oiga', 'disculpe', 'mande', 'a ver', 'que tal', 'qué tal',
  'holi', 'buen día', 'buen dia', 'que hay', 'qué hay'
])

// ── Helper: resolver selección de opciones por número O por texto (Fix #6) ──
function resolverSeleccionOpciones(
  texto: string,
  opciones: Array<{ lat: number; lng: number; name: string }>
): number {
  const txtLower = texto.trim().toLowerCase()
  
  // Intentar match por número
  const match = txtLower.match(/(?:opcion|opción|numero|número|\b)\s*(\d+)/) || txtLower.match(/\d+/)
  if (match) {
    const num = parseInt(match[match.length - 1], 10)
    if (num >= 1 && num <= opciones.length + 1) return num - 1
  }
  
  // Fallback: buscar si el texto contiene el nombre de alguna opción
  for (let i = 0; i < opciones.length; i++) {
    if (opciones[i].name && txtLower.includes(opciones[i].name.toLowerCase())) {
      return i
    }
  }
  
  return -1  // No se encontró match
}

// ── Función de cotización final ───────────────────────────────────────────

async function cotizarMandaditoFinal(
  supabase: any,
  fromPhone: string,
  from10: string,
  mandaditoState: { origen: UbicacionMandadito; destino: UbicacionMandadito; referencias?: string | null; role?: 'envio' | 'recibo' }
): Promise<void> {
  await sendWA(fromPhone, `⚡ *Optimizando la ruta y calculando tu tarifa...* 🛵`)

  const [resOrigen, resDestino] = await Promise.all([
    resolverUbicacion(supabase, mandaditoState.origen, from10),
    resolverUbicacion(supabase, mandaditoState.destino, from10)
  ])

  console.log(`📍 [HANDLER] Origen: ${JSON.stringify({ texto: mandaditoState.origen.texto, lat: mandaditoState.origen.lat }).substring(0, 80)} → resuelto=${!!resOrigen?.colonia}`)
  console.log(`📍 [HANDLER] Destino: ${JSON.stringify({ texto: mandaditoState.destino.texto, lat: mandaditoState.destino.lat }).substring(0, 80)} → resuelto=${!!resDestino?.colonia}`)

  // ── Aclaraciones de origen ────────────────────────────────────────────
  if (resOrigen?.requiereAclaracion) {
    console.log(`🔀 [HANDLER] Múltiples sucursales para origen "${mandaditoState.origen.texto}": ${resOrigen.opciones!.map(o=>o.name).join(', ')}`)
    const { generarAclaracionConversacional } = await import('./ai.ts')
    const nombresOpciones = resOrigen.opciones!.map(o => o.name)
    const msg = await generarAclaracionConversacional(mandaditoState.origen.texto || '', nombresOpciones, 'multiples_opciones')
    await sendWA(fromPhone, msg)
    await setState(supabase, from10, { step: 1.5, opciones: resOrigen.opciones, originalState: mandaditoState })
    return
  }

  if (resOrigen?.requiereAclaracionReferencia) {
    console.log(`🏘️ [HANDLER] Solo colonia para origen "${mandaditoState.origen.texto}", pidiendo referencia.`)
    const { generarAclaracionConversacional } = await import('./ai.ts')
    const msg = await generarAclaracionConversacional(resOrigen.coloniaFaltante || '', [], 'pedir_calle')
    await sendWA(fromPhone, msg)
    await setState(supabase, from10, { step: 1.6, coloniaAnterior: resOrigen.coloniaFaltante, originalState: mandaditoState })
    return
  }

  // ── Aclaraciones de destino ───────────────────────────────────────────
  if (resDestino?.requiereAclaracion) {
    console.log(`🔀 [HANDLER] Múltiples sucursales para destino "${mandaditoState.destino.texto}": ${resDestino.opciones!.map(o=>o.name).join(', ')}`)
    const { generarAclaracionConversacional } = await import('./ai.ts')
    const nombresOpciones = resDestino.opciones!.map(o => o.name)
    const msg = await generarAclaracionConversacional(mandaditoState.destino.texto || '', nombresOpciones, 'multiples_opciones')
    await sendWA(fromPhone, msg)
    await setState(supabase, from10, { step: 2.5, opciones: resDestino.opciones, originalState: mandaditoState })
    return
  }

  if (resDestino?.requiereAclaracionReferencia) {
    console.log(`🏘️ [HANDLER] Solo colonia para destino "${mandaditoState.destino.texto}", pidiendo referencia.`)
    const { generarAclaracionConversacional } = await import('./ai.ts')
    const msg = await generarAclaracionConversacional(resDestino.coloniaFaltante || '', [], 'pedir_calle')
    await sendWA(fromPhone, msg)
    await setState(supabase, from10, { step: 2.6, coloniaAnterior: resDestino.coloniaFaltante, originalState: mandaditoState })
    return
  }

  if (!resOrigen?.colonia || !resDestino?.colonia) {
    const intentos = ((mandaditoState as any).intentosFallidos || 0) + 1
    if (intentos >= 2) {
      // 🚀 GRACEFUL DEGRADATION: Aceptar texto literal usando limpieza AI.
      // ─── C-3: NO asignar coords hardcodeadas del centro de Comitán ─────────
      // Antes se asignaba lat:16.2520, lng:-92.1340 que llevaba al repartidor
      // al centro de la ciudad aunque el destino fuera otro.
      // Correcto: lat/lng quedan null → el repartidor usa SOLO el texto descriptivo.
      const { limpiarTextoFallback } = await import('./ai.ts')
      if (!resOrigen?.colonia && mandaditoState.origen?.texto) {
        const cleaned = await limpiarTextoFallback(mandaditoState.origen.texto)
        resOrigen = { colonia: { lat: null as any, lng: null as any, nombre: cleaned.nombreCorto } }
      }
      if (!resDestino?.colonia && mandaditoState.destino?.texto) {
        const cleaned = await limpiarTextoFallback(mandaditoState.destino.texto)
        resDestino = { colonia: { lat: null as any, lng: null as any, nombre: cleaned.nombreCorto } }
      }

    } else {
      const msgs: string[] = []
      if (!resOrigen?.colonia) msgs.push(`❌ *Origen:* ${mandaditoState.origen?.texto || 'Desconocido'}`)
      if (!resDestino?.colonia) msgs.push(`❌ *Destino:* ${mandaditoState.destino?.texto || 'Desconocido'}`)
      const { sendLocationRequest } = await import('../whatsapp.ts')
      const { generarAclaracionConversacional } = await import('./ai.ts')
      const msg = await generarAclaracionConversacional(msgs.join(' y '), [], 'ubicacion_no_encontrada')
      await sendLocationRequest(fromPhone, msg)
      // Guardar intentos en el estado para que vuelva a intentar
      const fallbackStep = !resOrigen?.colonia ? 1 : 2
      await setState(supabase, from10, {
        step: fallbackStep,
        origen: mandaditoState.origen,
        destino: mandaditoState.destino,
        role: mandaditoState.role,
        intentosFallidos: intentos
      })
      return
    }
  }

  const origen = resOrigen!.colonia
  const destino = resDestino!.colonia

  // ── Validación IA de datos faltantes ─────────────────────────────────
  const origenInfo = mandaditoState.origen.texto || origen.nombre
  const destinoInfo = mandaditoState.destino.texto || destino.nombre
  
  // 🛡️ FIX #5: Solo pedir datos extra si es un negocio (tiene orden/ticket)
  // Para envíos casa↔casa, ir directo a cotización sin latencia de IA innecesaria
  const esNegocio = (origen as UbicacionResuelta).esNegocio || (destino as UbicacionResuelta).esNegocio
  if (!mandaditoState.referencias && esNegocio) {
    const validacion = await validarDatosCompletos(origenInfo, destinoInfo, from10, mandaditoState.role)
    if (!validacion.estaCompleto && validacion.preguntaAlCliente) {
      await sendWA(fromPhone, validacion.preguntaAlCliente)
      await setState(supabase, from10, {
        step: 3,
        origen: mandaditoState.origen,
        destino: mandaditoState.destino,
        role: mandaditoState.role,
        referencias: JSON.stringify(validacion.datosEstructurados)
      })
      return
    }
  }

  // ── Calcular precio ───────────────────────────────────────────────────
  const { precioFinal, lluviaActiva, recargoLluvia } = await calcularPrecioMandadito(supabase, origen, destino)
  console.log(`💰 [HANDLER] Cotización calculada — origen: "${origen.nombre}" | destino: "${destino.nombre}" | precio: $${precioFinal} | lluvia: ${lluviaActiva}`)

  // ── Resumen final ─────────────────────────────────────────────────────
  const refs = mandaditoState.referencias || null
  const resumen = await extraerResumenFinal(origenInfo, destinoInfo, refs as string | null, from10)

  // Extraer display de ubicaciones
  const origenDisplay = resumen.origenLimpio && resumen.origenLimpio !== 'Origen' ? resumen.origenLimpio : origen.nombre
  const destinoDisplay = resumen.destinoLimpio && resumen.destinoLimpio !== 'Destino' ? resumen.destinoLimpio : destino.nombre

  let detallesExtra = ''
  if (resumen.receptor) detallesExtra += `\n👤 *Receptor:* ${resumen.receptor}`
  if (resumen.remitente) detallesExtra += `\n👤 *Remitente:* ${resumen.remitente}`
  if (resumen.telefono) detallesExtra += `\n📞 *Teléfono:* ${resumen.telefono}`
  if (resumen.orden) detallesExtra += `\n🔢 *Orden/Ticket:* #${resumen.orden}`
  if (refs) detallesExtra += `\n📝 *Notas:* ${refs}`
  if (lluviaActiva) detallesExtra += `\n☔ _+ $${recargoLluvia} por alta demanda/lluvia_`

  let msg = `🧾 *RESUMEN DE TU SERVICIO* 🧾\n`
  
  if ((origen as any).estaCerrado || (destino as any).estaCerrado) {
    const lugarCerrado = (origen as any).estaCerrado ? origenDisplay : destinoDisplay
    msg = `⚠️ *¡Ojo!* Parece que *${lugarCerrado}* está cerrado ahorita. Confirma solo si estás seguro que atienden.\n\n` + msg
  }

  msg +=
    `───────────────\n` +
    `📍 *De:* ${origenDisplay}\n` +
    `🏁 *Para:* ${destinoDisplay}\n` +
    `───────────────` +
    (detallesExtra ? detallesExtra + `\n───────────────` : '') +
    `\n`
    
  if (esNegocio) {
    msg += `\n_Nota: Si hay compras, se te cobrarán aparte al entregar._`
  }

  // Guardar cotización aprobable en estado
  await setState(supabase, from10, {
    step: 4,
    cotizacion: {
      precioFinal, origenDisplay, destinoDisplay,
      origenLat: origen.lat, origenLng: origen.lng,
      destinoLat: destino.lat, destinoLng: destino.lng,
      destinatario: resumen.receptor || resumen.remitente,
      telefono: resumen.telefono || from10,
      detalles: refs,
      role: mandaditoState.role
    }
  })

  await sendInteractiveButtons(fromPhone, msg, [
    { id: 'CONFIRMAR_MANDADITO', title: '✅ Confirmar' },
    { id: 'CANCELAR_MANDADITO',  title: '❌ Cancelar'  }
  ])
}

/**
 * Inicia el flujo de mandadito.
 * Siempre lanza el Agente IA conversacional — nunca el flujo rígido.
 * El agente maneja preguntas, listas interactivas y cotización.
 */
export async function iniciarFlujoMandadito(
  supabase: any,
  fromPhone: string,
  from10: string,
  textoOriginal?: string,
  clienteCtx?: any
): Promise<void> {
  // 🔒 IDEMPOTENCIA: Si ya hay una sesión de agente activa y reciente, no crear otra
  const { data: existingAgent } = await supabase
    .from('bot_memory').select('history, updated_at').eq('phone', `mandadito_agent_${from10}`).maybeSingle()

  if (existingAgent?.history?.length > 0 && existingAgent?.updated_at) {
    const minutosActivo = (Date.now() - new Date(existingAgent.updated_at).getTime()) / 60000
    if (minutosActivo < 30) {
      console.log(`[MANDADITO] Sesión de agente activa (${minutosActivo.toFixed(1)} min). Retomando.`)
      // Reactivar el agente con el texto recibido si hay uno
      if (textoOriginal?.trim()) {
        const { runMandaditoAgent } = await import('./agent.ts')
        const result = await runMandaditoAgent(supabase, existingAgent.history, textoOriginal, fromPhone, null, clienteCtx)
        await supabase.from('bot_memory').upsert({
          phone: `mandadito_agent_${from10}`, history: result.newHistory, updated_at: new Date().toISOString()
        })
        if (result.action === 'FINALIZAR_COTIZACION') {
          await cotizar_mandadito(supabase, fromPhone, from10, result.data)
          await supabase.from('bot_memory').delete().eq('phone', `mandadito_agent_${from10}`)
        } else if (result.textResponse) {
          await sendWA(fromPhone, result.textResponse)
        }
      }
      return
    }
    // Sesión expirada → limpiar y empezar de nuevo
    await supabase.from('bot_memory').delete().eq('phone', `mandadito_agent_${from10}`)
  }

  // 🔒 WATCHDOG: Limpiar también cualquier sesión rígida legacy que pudiera existir
  await supabase.from('bot_memory').delete().eq('phone', STATE_KEY(from10))

  // 🚀 Siempre lanzamos el Agente IA
  const mensajeInicial = textoOriginal?.trim() || 'Hola, quiero solicitar un mandadito'
  const { runMandaditoAgent } = await import('./agent.ts')
  const result = await runMandaditoAgent(supabase, [], mensajeInicial, fromPhone, null, clienteCtx)

  await supabase.from('bot_memory').upsert({
    phone: `mandadito_agent_${from10}`,
    history: result.newHistory,
    updated_at: new Date().toISOString()
  })

  if (result.action === 'FINALIZAR_COTIZACION') {
    await cotizar_mandadito(supabase, fromPhone, from10, result.data)
    await supabase.from('bot_memory').delete().eq('phone', `mandadito_agent_${from10}`)
  } else if (result.textResponse) {
    await sendWA(fromPhone, result.textResponse)
  }
}

// ── PUNTO DE ENTRADA: Avanzar la conversación ─────────────────────────────
/**
 * Procesa la respuesta del cliente cuando ya hay un flujo de mandadito activo.
 * Llamado desde client-flow.ts cuando hay un mandadito_state_* en bot_memory.
 */
export async function avanzarFlujoMandadito(
  supabase: any,
  fromPhone: string,
  from10: string,
  currentState: EstadoMandadito,
  ubicacionRecibida: UbicacionMandadito
): Promise<void> {
  // 🕒 FIX 1: TTL — Si el estado lleva más de 2 horas activo, limpiarlo automáticamente
  const ts = (currentState as any).ts || 0
  const MANDADITO_TTL_MS = 2 * 60 * 60 * 1000 // 2 horas
  if (ts && Date.now() - ts > MANDADITO_TTL_MS) {
    await clearState(supabase, from10)
    await sendWA(fromPhone, `⏰ Tu solicitud de envío anterior expiró por inactividad. ¡No hay problema, comencemos de nuevo! 😊\n\n¿En qué te puedo ayudar?`)
    return
  }

  // 🚨 FIX 2: PALABRAS DE ESCAPE — En cualquier paso, detectar intención de cancelar
  const PALABRAS_ESCAPE = new Set(['cancelar', 'cancel', 'salir', 'exit', 'no quiero', 'olvida', 'olídalo', 'olvidalo', 'stop', 'parar'])
  const txtLower = ubicacionRecibida.texto?.trim().toLowerCase() || ''
  if (PALABRAS_ESCAPE.has(txtLower)) {
    await clearState(supabase, from10)
    await sendWA(fromPhone, `✅ Solicitud cancelada. ¡Cuando quieras cotizar un envío, aquí estoy! 🛵`)
    return
  }

  // ─── I-4: Detectar step:99 huérfano ─────────────────────────────────────
  // step:99 es el "lock" temporal mientras se ejecuta cotizarMandaditoFinal de forma asíncrona.
  // Si un error o timeout lo dejó atascado, el cliente queda bloqueado para siempre porque
  // 99 no está en VALID_STEPS y caería en el reset genérico.
  // TTL para el lock: 2 minutos. Si expiró, limpiamos y ofrecemos reiniciar.
  const step = currentState.step
  const LOCK_STEP = 99
  const LOCK_TTL_MS = 2 * 60 * 1000 // 2 minutos
  if (step === LOCK_STEP) {
    const lockTs = (currentState as any).lockTs || (currentState as any).ts || 0
    if (lockTs && Date.now() - lockTs < LOCK_TTL_MS) {
      // Aún dentro del TTL — cotización en progreso, informar al cliente
      await sendWA(fromPhone, `⏳ Estamos terminando de calcular tu cotización, espera un momento...`)
      return
    }
    // TTL expirado — lock huérfano, recuperar
    console.warn(`[HANDLER] step:99 huérfano detectado para ${from10} — TTL expirado, reseteando.`)
    await clearState(supabase, from10)
    await sendWA(fromPhone, `😅 Tardé demasiado calculando tu ruta. ¿Me das la información de nuevo?\n\n¿En qué te puedo ayudar?`)
    return
  }

  // 🔧 FIX 4: VALIDACIÓN DE ESTADO
  const VALID_STEPS = [0.5, 1, 1.5, 1.6, 2, 2.5, 2.6, 3, 4, 10, 10.5, 10.6]
  const estadoVersion = currentState.v || 1
  if (step === undefined || step === null || !VALID_STEPS.includes(step) || estadoVersion < 1) {
    await clearState(supabase, from10)
    await sendWA(fromPhone, `🔄 Ocurrió un pequeño error en tu sesión de envío. No te preocupes, vamos de nuevo.\n\n¿En qué te puedo ayudar? 😊`)
    const ADMIN_ENV = Deno.env.get('ADMIN_PHONES') ?? Deno.env.get('ADMIN_PHONE') ?? ''
    const adminPhones = ADMIN_ENV.split(',').map((p: string) => p.replace(/\D/g, '').slice(-10)).filter(Boolean)
    for (const ap of adminPhones) {
      sendWA(`52${ap}`, `⚠️ *Estado corrupto detectado* para wa.me/${fromPhone}\nStep: ${step}\nEstado: ${JSON.stringify(currentState).substring(0, 200)}`).catch(() => {})
    }
    return
  }


  // ── Multi-Parada Avanzada ─────────────────────────────────────────────
  if (step === 10 || step === 10.5 || step === 10.6) {
    return avanzarMultiParada(supabase, fromPhone, from10, currentState, ubicacionRecibida)
  }

  // ── Guardián 1: Detectar PREGUNTAS enviadas dentro del flujo ─────────────
  // Si el usuario hace una pregunta (ej: "¿Cuál es mi dirección?") en vez de dar una
  // dirección, el bot NO debe resolverlo como ubicación. Debemos re-preguntar.
  if (ubicacionRecibida.texto && !ubicacionRecibida.lat && (step === 1 || step === 2)) {
    const txt = ubicacionRecibida.texto.trim().toLowerCase()
    const esUnaPregunta = /^(\?|¿|cual|cuál|cuales|dónde|donde|qué|que|cómo|como|cuánto|cuanto|por qué|porqué)\b/.test(txt)
      || txt.includes('?') // También atrapar preguntas sin acento inicial

    if (esUnaPregunta) {
      const pasoActual = step === 1 ? 'el *origen* (de dónde recogemos)' : 'el *destino* (a dónde entregamos)'
      await sendWA(fromPhone, `Parece que tienes una pregunta. 😊 Por el momento estoy esperando ${pasoActual}.\n\nPor favor comparte una dirección, colonia o pin GPS 📍`)
      return
    }
  }

  // ── Guardián 2: detectar texto que no es una dirección ─────────────────
  if (ubicacionRecibida.texto && !ubicacionRecibida.lat && (step === 1 || step === 2)) {
    const txt = ubicacionRecibida.texto.trim().toLowerCase()
    if (PALABRAS_NO_UBICACION.has(txt) || txt.length <= 2) {
      const pasoActual = step === 1 ? 'el origen (de dónde recogemos)' : 'el destino (a dónde entregamos)'
      await sendInteractiveButtons(fromPhone,
        `🤔 Escribiste _"${ubicacionRecibida.texto}"_ pero estoy esperando *${pasoActual}*.\n\n¿Quieres continuar o cancelar la solicitud?`,
        [
          { id: 'MAND_CONTINUAR_SESION', title: '▶️ Continuar' },
          { id: 'CANCELAR_MANDADITO',    title: '❌ Cancelar'  }
        ]
      )
      return
    }
  }

  // ── Step 0.5: Elegir rol por texto ───────────────────────────────────
  if (step === 0.5) {
    const txt = ubicacionRecibida.texto?.trim().toLowerCase() || ''
    let role: 'envio' | 'recibo' | null = null
    if (txt.match(/(env[ií]o|env[ií]a|mando|mandar|llevo|llevar)/)) role = 'envio'
    if (txt.match(/(recibo|recibe|recibir|traer|trae|espero|pido|pedir|necesito|quiero|cliente|favor)/)) role = 'recibo'
    
    // 🛡️ FIX #2: Tras 2 intentos fallidos, asumir 'recibo' (caso más común)
    const roleIntentos = (currentState.roleIntentos || 0) + 1
    if (!role && roleIntentos >= 2) {
      role = 'recibo'
    }
    
    if (role) {
      await setState(supabase, from10, { step: 1, role })
      
      const tipoAclaracion = role === 'envio' ? 'pedir_origen_envio' : 'pedir_origen_recibo'
      const { generarAclaracionConversacional } = await import('./ai.ts')
      const pregunta = await generarAclaracionConversacional('', [], tipoAclaracion)
      
      await enviarSelectorUbicacion(supabase, fromPhone, from10, pregunta, 1, role)
    } else {
      await setState(supabase, from10, { step: 0.5, roleIntentos })
      await sendInteractiveButtons(fromPhone,
        `📦 Para iniciar tu envío:\n\n*¿Tú eres quien envía o quien recibe?*`,
        [{ id: 'MAND_ROLE_ENVIO', title: '⬆️ Yo envío' }, { id: 'MAND_ROLE_RECIBO', title: '⬇️ Yo recibo' }]
      )
    }
    return
  }

  // ── Step 1.5: Aclaración de múltiples orígenes ───────────────────────
  if (step === 1.5) {
    const opciones = currentState.opciones || []
    const selIndex = resolverSeleccionOpciones(ubicacionRecibida.texto || '', opciones)
    
    if (selIndex === -1) {
      await sendWA(fromPhone, `⚠️ Responde con el número de la opción (1-${opciones.length + 1}) o escribe el nombre.`)
      return
    }
    if (selIndex === opciones.length) {
      await setState(supabase, from10, { step: 1, ...currentState.originalState })
      await sendWA(fromPhone, `🔄 Vamos a intentar de nuevo. ¿Me dices desde dónde recogemos?`)
      return
    }
    const sel = opciones[selIndex]
    const newState: EstadoMandadito = { ...currentState.originalState!, origen: { lat: sel.lat, lng: sel.lng, texto: sel.name } }
    await setState(supabase, from10, { step: 99, lockTs: Date.now() })
    await cotizarMandaditoFinal(supabase, fromPhone, from10, newState)
    return
  }

  // ── Step 1.6: Recibir referencia de origen ────────────────────────────
  if (step === 1.6) {
    const newState = { ...currentState.originalState! }
    const colAnterior = currentState.coloniaAnterior || currentState.originalState?.coloniaAnterior || ''
    const prefix = colAnterior ? `${colAnterior}, ` : ''
    newState.origen = { texto: `${prefix}${ubicacionRecibida.texto}` }
    await setState(supabase, from10, { step: 99, lockTs: Date.now() })
    await cotizarMandaditoFinal(supabase, fromPhone, from10, newState)
    return
  }

  // ── Step 2.5: Aclaración de múltiples destinos ───────────────────────
  if (step === 2.5) {
    const opciones = currentState.opciones || []
    const selIndex = resolverSeleccionOpciones(ubicacionRecibida.texto || '', opciones)
    
    if (selIndex === -1) {
      await sendWA(fromPhone, `⚠️ Responde con el número de la opción (1-${opciones.length + 1}) o escribe el nombre.`)
      return
    }
    if (selIndex === opciones.length) {
      await setState(supabase, from10, { step: 2, ...currentState.originalState })
      await sendWA(fromPhone, `🔄 Inténtalo de nuevo. ¿A dónde entregamos?`)
      return
    }
    const sel = opciones[selIndex]
    const newState: EstadoMandadito = { ...currentState.originalState!, destino: { lat: sel.lat, lng: sel.lng, texto: sel.name } }
    await setState(supabase, from10, { step: 99, lockTs: Date.now() })
    await cotizarMandaditoFinal(supabase, fromPhone, from10, newState)
    return
  }

  // ── Step 2.6: Recibir referencia de destino ───────────────────────────
  if (step === 2.6) {
    const newState = { ...currentState.originalState! }
    const colAnterior = currentState.coloniaAnterior || currentState.originalState?.coloniaAnterior || ''
    const prefix = colAnterior ? `${colAnterior}, ` : ''
    newState.destino = { texto: `${prefix}${ubicacionRecibida.texto}` }
    await setState(supabase, from10, { step: 99, lockTs: Date.now() })
    await cotizarMandaditoFinal(supabase, fromPhone, from10, newState)
    return
  }

  // ── Step 1: Recolectar origen ─────────────────────────────────────────
  if (step === 1) {
    // Si el texto es largo, puede tener origen Y destino juntos
    if (ubicacionRecibida.texto && !ubicacionRecibida.lat && ubicacionRecibida.texto.split(/\s+/).length > 3) {
      const ext = await extraerRutaMandadito(ubicacionRecibida.texto)
      if (ext.paradas && ext.paradas.length > 1) {
        const destText = ext.paradas[ext.paradas.length - 1]?.ubicacion
        // ✅ BUG 3 FIX: Optional chaining para evitar crash si ubicacion es undefined
        if (destText && destText?.toLowerCase() !== ext.paradas[0]?.ubicacion?.toLowerCase()) {
          currentState.destinoPendiente = { texto: destText }
        }
      }
    }

    // Si ya tenemos destino pendiente → cotizar directo
    if (currentState.destinoPendiente?.texto || currentState.destinoPendiente?.lat) {
      const msgConfirm = ubicacionRecibida.lat
        ? `✅ *Origen:* Pin GPS exacto 📍\n✅ *Destino:* ${currentState.destinoPendiente.texto || 'Pin GPS exacto'} 📍`
        : `✅ *Origen registrado* 📍\n✅ *Destino:* ${currentState.destinoPendiente.texto || 'Pin GPS exacto'} 📍`
      await setState(supabase, from10, { step: 99, lockTs: Date.now() })
      await sendWA(fromPhone, msgConfirm)
      await cotizarMandaditoFinal(supabase, fromPhone, from10, {
        origen: ubicacionRecibida,
        destino: currentState.destinoPendiente,
        role: currentState.role
      })
      return
    }

    // Confirmar origen y pedir destino
    const msgOrigen = ubicacionRecibida.lat
      ? `✅ *Origen:* Pin GPS exacto 📍`
      : `✅ *Origen registrado:* ${ubicacionRecibida.texto} 📍`
    await setState(supabase, from10, { step: 2, origen: ubicacionRecibida, role: currentState.role })
    await sendWA(fromPhone, msgOrigen)
    await enviarSelectorUbicacion(supabase, fromPhone, from10,
      `🏁 *¿Y a dónde lo llevamos?* 📍\n_Colonia, nombre del lugar o pin GPS._`, 2, currentState.role)
    return
  }

  // ── Step 2: Recolectar destino ────────────────────────────────────────
  if (step === 2) {
    if (!currentState.origen) {
      await setState(supabase, from10, { step: 1, role: currentState.role })
      await sendWA(fromPhone, `⚠️ Perdí el origen. ¿Me lo dices de nuevo?`)
      await enviarSelectorUbicacion(supabase, fromPhone, from10, `📍 *¿Desde dónde recogemos?*`, 1)
      return
    }

    // ── Guardián: Origen ≠ Destino ──────────────────────────────────────
    // Si las coordenadas son idénticas o el texto resuelto es el mismo, el pedido es inválido.
    const origenLat = currentState.origen?.lat
    const origenLng = currentState.origen?.lng
    const destinoLat = ubicacionRecibida?.lat
    const destinoLng = ubicacionRecibida?.lng
    const mismasCoordenadas = origenLat && destinoLat &&
      Math.abs(origenLat - destinoLat) < 0.0001 &&
      Math.abs(origenLng! - destinoLng!) < 0.0001
    const mismoTexto = !ubicacionRecibida.lat && !currentState.origen.lat &&
      currentState.origen.texto?.toLowerCase().trim() === ubicacionRecibida.texto?.toLowerCase().trim()

    if (mismasCoordenadas || mismoTexto) {
      await sendWA(fromPhone, `⚠️ El origen y el destino son el mismo lugar. Por favor indica una dirección *diferente* de destino 📍`)
      return // Mantenemos step === 2 para que vuelva a intentar
    }

    await setState(supabase, from10, { step: 99, lockTs: Date.now() })
    await cotizarMandaditoFinal(supabase, fromPhone, from10, {
      origen: currentState.origen,
      destino: ubicacionRecibida,
      role: currentState.role
    })
    return
  }

  // ── Step 3: Recibir respuesta de validación IA ────────────────────────
  if (step === 3) {
    const nuevasRefs = ubicacionRecibida.texto || 'no'
    await clearState(supabase, from10)
    await cotizarMandaditoFinal(supabase, fromPhone, from10, {
      origen: currentState.origen!,
      destino: currentState.destino!,
      role: currentState.role,
      referencias: nuevasRefs
    })
    return
  }

  // ✅ BUG 2 FIX: Step 4 — usuario escribe texto en vez de usar botones de confirmación
  // Sin este handler, el fallback borraba el estado y cancelaba la cotización silenciosamente
  if (step === 4) {
    await sendWA(fromPhone, `⚠️ Usa los botones de *✅ Confirmar* o *❌ Cancelar* del mensaje anterior para continuar con tu envío.`)
    return
  }

  // ── Fallback ──────────────────────────────────────────────────────────
  await sendWA(fromPhone, `🚨 Algo salió mal con la solicitud. ¿Quieres intentarlo de nuevo?`)
  await clearState(supabase, from10)
}

// ── Exportar key para que otros módulos puedan verificar si hay sesión ────
export { STATE_KEY }

// ── Transición desde el Flujo Agéntico ────────────────────────────────
export async function cotizar_mandadito(
  supabase: any,
  fromPhone: string,
  from10: string,
  d: import('./agent.ts').AgentResult['data']
): Promise<void> {
  // Guard: d puede ser Record<string,never> si el agente llamó sin datos válidos
  if (!('origen_texto' in d) || !('destino_texto' in d) || !('paquete' in d)) {
    console.error('[COTIZAR] Datos de cotización incompletos:', d)
    await sendWA(fromPhone, '⚠️ Hubo un problema al preparar tu cotización. ¿Puedes repetirme los detalles? 🙏')
    return
  }

  let instrDestino = d.instrucciones_destino || ''
  if (d.nombre_contacto) {
    instrDestino = instrDestino ? `${instrDestino}. Contacto: ${d.nombre_contacto}` : `Contacto: ${d.nombre_contacto}`
  }

  const paradas = [
    {
      tipo: 'recoger',
      ubicacion: { texto: d.origen_texto, lat: d.origen_lat, lng: d.origen_lng },
      instruccion: d.instrucciones_origen || ''
    },
    {
      tipo: 'entregar',
      ubicacion: { texto: d.destino_texto, lat: d.destino_lat, lng: d.destino_lng },
      instruccion: instrDestino
    }
  ]

  if (d.paquete) {
    paradas[0].instruccion = paradas[0].instruccion
      ? `${paradas[0].instruccion}. Detalle: ${d.paquete}`
      : `Detalle: ${d.paquete}`
  }

  const currentState = { step: 10, paradas, resolvingIndex: 0, ts: Date.now() }
  
  const { avanzarMultiParada } = await import('./multi-stop.ts')
  // Null pass-through para iniciar la validación de las paradas
  await avanzarMultiParada(supabase, fromPhone, from10, currentState, {} as any)
}
