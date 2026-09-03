import { callGeminiWithTools } from '../../_shared/gemini.ts'
import { sendInteractiveList } from '../whatsapp.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
// Bug fix: imports ESM deben estar al INICIO del módulo, nunca en medio del código
import type { UbicacionMandadito, ResultadoResolucion } from './types.ts'

// ── Interfaces de tipos propios ───────────────────────────────────────────────

interface UbicacionGuardada {
  tipo:           string
  colonia_nombre: string | null
  lat:            number
  lng:            number
}

interface UbicacionSemantica {
  lat:            number
  lng:            number
  nombre_oficial: string
  referencia:     string
  colonia?:       string
}

interface Rutina {
  dia:    string
  hora:   string
  patron: string
}

interface PerfilInteligente {
  tono_preferido?:         string
  alergias_gustos?:        string[]
  resumen_memoria?:        string
  ubicaciones_semanticas?: Record<string, UbicacionSemantica> | string
  rutinas?:                Rutina[]
}

interface ClienteCtx {
  nombre?:               string
  puntos?:               number
  es_vip?:               boolean
  reputacion?:           string
  saldo?:                number
  envios?:               number
  rango?:                string
  notasCrm?:             string
  ubicacionesGuardadas?: UbicacionGuardada[]
  historialPedidos?:     unknown[]
  perfilInteligente?:    PerfilInteligente
}

export interface MediaData {
  base64:   string
  mimeType: string
}

// ── Tipos de mensajes del historial ──────────────────────────────────────────

interface TextPart       { text: string }
interface InlineDataPart { inlineData: { data: string; mimeType: string } }
interface FunctionCallPart {
  functionCall: { name: string; args: Record<string, unknown> }
}

type UserMessagePart = TextPart | InlineDataPart

interface FunctionResponse {
  name:     string
  response: { result: string } | { error: string }
}

interface UserMessage {
  role:     'user'
  parts:    UserMessagePart[]
  content?: string   // texto legible guardado en BD para observabilidad/debug
}

interface AssistantTextMessage {
  role:    'assistant'
  content: string
}

interface AssistantToolCallMessage {
  role:          'assistant'
  functionCalls: FunctionCallPart[]
}

interface FunctionResultMessage {
  role:              'function'
  functionResponses: FunctionResponse[]
}

// El historial solo contiene mensajes reales de conversación (sin 'system')
type HistorialMessage =
  | UserMessage
  | AssistantTextMessage
  | AssistantToolCallMessage
  | FunctionResultMessage

// El array que se manda a Gemini incluye el system prompt como primer elemento
interface SystemMessage {
  role:    'system'
  content: string
}

type GeminiMessage = SystemMessage | HistorialMessage

// ── Respuesta de Gemini ───────────────────────────────────────────────────────

// callGeminiWithTools devuelve json.candidates[0].content → { role, parts }
interface GeminiContent {
  role:   string
  parts?: (FunctionCallPart | TextPart)[]
}

// ── Args tipados para cada herramienta ───────────────────────────────────────

interface BuscarEnMapaArgs {
  query: string
}

interface MostrarDireccionesArgs {
  paso:          'ORIGEN' | 'DESTINO'
  mensaje_intro: string
}

interface FinalizarCotizacionArgs {
  origen_texto:           string
  origen_lat?:            number
  origen_lng?:            number
  destino_texto:          string
  destino_lat?:           number
  destino_lng?:           number
  paquete:                string
  instrucciones_origen?:  string
  instrucciones_destino?: string
  nombre_contacto?:       string
}

// ── Resultado del agente ─────────────────────────────────────────────────────

export interface AgentResult {
  textResponse?: string
  action:        string
  data:          FinalizarCotizacionArgs | Record<string, never>
  newHistory:    HistorialMessage[]
  pendingStep?:  string
}

// ── Constantes ────────────────────────────────────────────────────────────────

const DESCRIPCIONES_VAGAS = new Set([
  'una pizza', 'pizza', 'comida', 'refresco', 'paquete', 'mandado'
])

const MANDADITO_AGENT_SYSTEM_PROMPT = `Eres el asistente logístico de Estrella Envíos en Comitán, Chiapas.
Tu misión: coordinar envíos para el cliente de forma conversacional, inteligente y eficiente.

REGLAS DE ORO:
1. SÉ CONCISO Y DIRECTO. Haz solo las preguntas necesarias. Máximo 2 líneas por respuesta.
2. GEOFENCE. Solo cubrimos Comitán de Domínguez, Chiapas. Si piden otra ciudad, rechaza amablemente.
3. USA EL MAPA. Cuando el cliente mencione un lugar que NO está en sus direcciones guardadas, BÚSCALO con 'buscar_en_mapa' de inmediato.
4. CONFIRMA LUGARES. Si encuentras la dirección, confirma brevemente: "Ubicado en col. Guadalupe, ¿correcto?"
5. DIRECCIONES GUARDADAS. Si el cliente dice "mi casa", "mi trabajo" u otro alias:
   - PRIMERO revisa el CEREBRO IA (Mapa Semántico y Direcciones Frecuentes en el contexto).
   - Si tiene lat/lng ahí, ÚSALAS DIRECTAMENTE. No preguntes nada.
   - Si NO lo encuentras en el Cerebro IA, usa 'mostrar_direcciones_guardadas'.
   - Si no tiene ninguna guardada, pídele texto o GPS.
6. DETALLES DE COMPRA O PAQUETE. Antes de finalizar, asegúrate de saber EXACTAMENTE qué se va a transportar. Si el cliente pide COMPRAR algo (ej. "comprar una pizza", "comprar refresco"), es OBLIGATORIO preguntarle los detalles (tamaño, especialidad, marca, cantidad). NUNCA cotices con descripciones vagas como "una pizza".
7. NOMBRE DEL CONTACTO. ANTES de cotizar, DEBES preguntar amablemente cómo se llama la persona (ya sea quien envía o quien recibe) para poder personalizar la orden, a menos que ya tengas su nombre. Ejemplo: "¿A nombre de quién hacemos el envío?" o "¿Cómo te llamas para anotar el pedido?".
8. FINALIZAR. Solo cuando tengas Origen + Destino (con coordenadas confirmadas) + descripción clara del paquete + nombre de contacto, usa 'finalizar_cotizacion'.
9. MULTIMEDIA. Puedes ver fotos y escuchar audios. Procésalos normalmente.
10. BREVEDAD ABSOLUTA. Si ya saludaste, no repitas el saludo. Ve directo al grano.

HERRAMIENTAS:
- 'buscar_en_mapa': Geolocaliza cualquier lugar en Comitán.
- 'mostrar_direcciones_guardadas': Lista interactiva de WhatsApp cuando el cliente menciona un alias no resuelto.
- 'finalizar_cotizacion': Cierra y cotiza cuando ya tienes origen, destino y paquete detallado.

TONO: Amable, profesional, eficiente. Cero rodeos. 1 emoji máximo por mensaje.`

const TOOLS_DECLARATION = [
  {
    name: 'buscar_en_mapa',
    description: 'Busca una dirección, comercio, restaurante o colonia en Comitán para obtener sus coordenadas.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'El nombre del lugar a buscar en Comitán, Chiapas' }
      },
      required: ['query']
    }
  },
  {
    name: 'mostrar_direcciones_guardadas',
    description: 'Muestra al cliente una lista interactiva nativa de WhatsApp con sus direcciones guardadas. USA ESTO SOLO cuando el cliente mencione un alias (mi casa, mi trabajo) que NO tiene lat/lng en el Cerebro IA del contexto.',
    parameters: {
      type: 'OBJECT',
      properties: {
        paso: {
          type: 'STRING',
          enum: ['ORIGEN', 'DESTINO'],
          description: 'Si la dirección a seleccionar será el ORIGEN o el DESTINO del envío'
        },
        mensaje_intro: {
          type: 'STRING',
          description: 'Texto corto que aparece antes de la lista. Ej: "¿Cuál es tu domicilio de entrega?"'
        }
      },
      required: ['paso', 'mensaje_intro']
    }
  },
  {
    name: 'finalizar_cotizacion',
    description: 'Llama SOLO cuando tengas Origen con coordenadas, Destino con coordenadas y descripción del paquete confirmados.',
    parameters: {
      type: 'OBJECT',
      properties: {
        origen_texto:          { type: 'STRING', description: 'Dirección validada del origen' },
        origen_lat:            { type: 'NUMBER', description: 'Latitud del origen' },
        origen_lng:            { type: 'NUMBER', description: 'Longitud del origen' },
        destino_texto:         { type: 'STRING', description: 'Dirección validada del destino' },
        destino_lat:           { type: 'NUMBER', description: 'Latitud del destino' },
        destino_lng:           { type: 'NUMBER', description: 'Longitud del destino' },
        paquete:               { type: 'STRING', description: 'Descripción del objeto a transportar' },
        instrucciones_origen:  { type: 'STRING', description: 'A nombre de quién recoger, etc.' },
        instrucciones_destino: { type: 'STRING', description: 'A quién entregar, referencias' },
        nombre_contacto:       { type: 'STRING', description: 'Nombre de la persona que envía o recibe' }
      },
      required: ['origen_texto', 'destino_texto', 'paquete']
    }
  }
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function etiquetaDirEmoji(tipo: string): string {
  const map: Record<string, string> = {
    casa: '🏠', trabajo: '💼', oficina: '🏢', escuela: '🎓',
    gym: '🏋️', iglesia: '⛪', mercado: '🛒', negocio: '🏪', local: '🏪'
  }
  return map[tipo.toLowerCase()] ?? '📍'
}

function buildPerfilBlock(p: PerfilInteligente): { perfilAI: string; aliasStr: string } {
  const t      = p.tono_preferido                     ? `Le gusta trato ${p.tono_preferido}. `                                   : ''
  const al     = (p.alergias_gustos ?? []).length > 0 ? `Alergias/Gustos: ${(p.alergias_gustos ?? []).join(', ')}. `            : ''
  const mem    = p.resumen_memoria                    ? `Notas IA: ${p.resumen_memoria}. `                                       : ''
  const rutinas = (p.rutinas ?? []).length > 0
    ? `Rutinas: ${(p.rutinas ?? []).map(r => `${r.dia} ${r.hora} (${r.patron})`).join(', ')}. `
    : ''

  const perfilAI = (t || al || mem || rutinas)
    ? `\n\n🔮 PERFIL DE COMPORTAMIENTO (Úsalo para personalizar tu trato):\n${t}${al}${mem}${rutinas}`
    : ''

  let aliasStr = 'Ninguno.'
  if (p.ubicaciones_semanticas) {
    try {
      const mapa: Record<string, UbicacionSemantica> =
        typeof p.ubicaciones_semanticas === 'string'
          ? JSON.parse(p.ubicaciones_semanticas)
          : p.ubicaciones_semanticas
      const lineas = Object.entries(mapa).map(([alias, d]) => {
        const nombre = d.colonia ?? d.nombre_oficial ?? 'col. desconocida'
        return `- "${alias}": ${nombre} (Lat: ${d.lat ?? '?'}, Lng: ${d.lng ?? '?'})`
      })
      if (lineas.length > 0) aliasStr = lineas.join('\n')
    } catch { /* formato inesperado — mantener 'Ninguno.' */ }
  }

  return { perfilAI, aliasStr }
}

// ── Función principal del agente ─────────────────────────────────────────────

export async function runMandaditoAgent(
  supabase: SupabaseClient,
  historial: HistorialMessage[],
  nuevoMensaje: string,
  userPhone: string,
  mediaData?: MediaData | null,
  clienteCtx?: ClienteCtx
): Promise<AgentResult> {

  const from10    = userPhone.replace(/\D/g, '').slice(-10)
  const fromPhone = userPhone.length > 10 ? userPhone : `52${userPhone}`

  // ── Construir partes multimedia del mensaje del usuario ──
  const userParts: UserMessagePart[] = []
  if (nuevoMensaje) userParts.push({ text: nuevoMensaje })
  if (mediaData)    userParts.push({ inlineData: { data: mediaData.base64, mimeType: mediaData.mimeType } })
  if (userParts.length === 0) userParts.push({ text: 'Hola, quiero un mandadito' })

  // ── Construir System Prompt con contexto del cliente ──
  let systemPrompt = MANDADITO_AGENT_SYSTEM_PROMPT

  if (clienteCtx) {
    const ubicacionesStr = (clienteCtx.ubicacionesGuardadas ?? []).length > 0
      ? (clienteCtx.ubicacionesGuardadas ?? [])
          .map(u => `- [${u.tipo}]: ${u.colonia_nombre} (Lat: ${u.lat}, Lng: ${u.lng})`)
          .join('\n')
      : 'Ninguna guardada.'

    let perfilAI = ''
    let aliasStr = 'Ninguno.'

    if (clienteCtx.perfilInteligente) {
      const bloque = buildPerfilBlock(clienteCtx.perfilInteligente)
      perfilAI = bloque.perfilAI
      aliasStr = bloque.aliasStr
    }

    systemPrompt += `\n\n🧠 CEREBRO IA — CONTEXTO DEL CLIENTE:
Nombre: ${clienteCtx.nombre ?? 'Desconocido'}${perfilAI}

Direcciones Frecuentes (ya tienen lat/lng — usa directamente, sin preguntar):
${ubicacionesStr}

Mapa Semántico (aliases personalizados — si coinciden, usa sus coordenadas directamente):
${aliasStr}

⚠️ CRÍTICO: Si el alias del cliente YA tiene lat/lng en las listas de arriba, NUNCA uses 'mostrar_direcciones_guardadas'. Simplemente toma las coordenadas y avanza.`
  }

  // El system prompt va separado — gemini.ts lo convierte a systemInstruction
  const messages: GeminiMessage[] = [
    { role: 'system', content: systemPrompt },
    ...historial,
    { role: 'user', parts: userParts, content: nuevoMensaje }
  ]

  // El historial devuelto no incluye el system prompt (es inmutable y se reconstruye en cada llamada)
  const returnedHistory: HistorialMessage[] = [
    ...historial,
    { role: 'user', parts: userParts, content: nuevoMensaje }
  ]

  let isDone    = false
  let loopCount = 0
  const finalResponse: AgentResult = { action: 'RESPONDER', data: {}, newHistory: returnedHistory }

  while (!isDone && loopCount < 6) {
    loopCount++
    const geminiContent: GeminiContent | null = await callGeminiWithTools(
      messages, TOOLS_DECLARATION, 'gemini-3.1-pro-preview-customtools', 1000
    )

    if (!geminiContent) {
      finalResponse.textResponse = 'Disculpa, tuve un problema técnico. ¿Puedes repetirme eso? 🙏'
      isDone = true
      break
    }

    const parts             = geminiContent.parts ?? []
    const functionCallParts = parts.filter((p): p is FunctionCallPart => 'functionCall' in p && !!p.functionCall)
    const textPart          = parts.find((p): p is TextPart => 'text' in p && typeof p.text === 'string')

    if (functionCallParts.length > 0) {
      const toolCallMsg: AssistantToolCallMessage = { role: 'assistant', functionCalls: functionCallParts }
      messages.push(toolCallMsg)
      returnedHistory.push(toolCallMsg)

      const functionResponses: FunctionResponse[] = []

      // IMPORTANTE: Procesamos tools secuencialmente para evitar condiciones de carrera
      // en las mutaciones de isDone y finalResponse.pendingStep
      for (const part of functionCallParts) {
        const call = part.functionCall
        console.log(`[AGENT] 🤖 Tool: ${call.name}`, JSON.stringify(call.args))

        // ── buscar_en_mapa ──────────────────────────────────────────────
        if (call.name === 'buscar_en_mapa') {
          const { query } = call.args as BuscarEnMapaArgs
          let mapResultStr = ''
          try {
            const { resolverUbicacion } = await import('./geo.ts')
            const geoUbi: UbicacionMandadito = { texto: query }
            const geoRes: ResultadoResolucion | null = await resolverUbicacion(supabase, geoUbi, from10)
            if (!geoRes) {
              mapResultStr = `No se encontró "${query}" en Comitán. Pide referencias más detalladas o GPS al cliente.`
            } else if (geoRes.colonia) {
              mapResultStr = `Encontrado: ${geoRes.colonia.nombre} (Lat: ${geoRes.colonia.lat}, Lng: ${geoRes.colonia.lng})`
            } else if (geoRes.requiereAclaracion && geoRes.opciones.length > 0) {
              mapResultStr = `Múltiples opciones encontradas para "${query}": ${geoRes.opciones.map(o => o.name).join(', ')}. Pide al cliente que especifique cuál de estas es.`
            } else if (geoRes.requiereAclaracionReferencia) {
              mapResultStr = `Encontré la zona/colonia "${geoRes.coloniaFaltante}", pero falta la calle, número o referencias exactas. Dile al cliente que sí ubicas la colonia pero necesitas la calle o referencias.`
            } else {
              mapResultStr = `No se encontró "${query}" en Comitán. Pide referencias más detalladas o GPS al cliente.`
            }
          } catch { mapResultStr = 'Error buscando en el mapa.' }
          console.log(`[AGENT] 🗺️ ${mapResultStr}`)
          functionResponses.push({ name: call.name, response: { result: mapResultStr } })

        // ── mostrar_direcciones_guardadas ───────────────────────────────
        } else if (call.name === 'mostrar_direcciones_guardadas') {
          const { paso, mensaje_intro } = call.args as MostrarDireccionesArgs
          let toolResult = ''

          try {
            const { data: dirs } = await supabase
              .from('cliente_ubicaciones')
              .select('tipo, colonia_nombre, lat, lng')
              .eq('cliente_telefono', from10)
              .not('tipo', 'in', '(origen,destino)')
              .order('ultima_vez', { ascending: false })
              .limit(10)

            const dirList: UbicacionGuardada[] = dirs ?? []

            if (dirList.length > 0) {
              const tiposVistos = new Set<string>()
              const unique = dirList.filter(d => {
                if (tiposVistos.has(d.tipo)) return false
                tiposVistos.add(d.tipo)
                return true
              })

              const rows = unique.map(d => ({
                id:          `AGENT_DIR_${paso}_${d.tipo}`,
                title:       `${etiquetaDirEmoji(d.tipo)} ${d.tipo.charAt(0).toUpperCase() + d.tipo.slice(1)}`,
                description: d.colonia_nombre?.substring(0, 60) ?? 'Dirección guardada'
              }))
              rows.push({
                id:          `AGENT_DIR_${paso}_ESCRIBIR`,
                title:       '✏️ Escribir dirección',
                description: 'Colonia, calle o mandar pin GPS'
              })

              await sendInteractiveList(fromPhone, mensaje_intro, 'Mis direcciones 📋', [{ title: 'Mis direcciones', rows }])
              toolResult = 'Lista enviada al cliente. Esperando selección. El loop del agente debe pausar aquí.'
              finalResponse.pendingStep = paso
              isDone = true
            } else {
              toolResult = 'El cliente no tiene direcciones guardadas. Pídele que escriba la dirección o mande su GPS.'
            }
          } catch (e) {
            console.error('[AGENT] Error mostrar_direcciones_guardadas:', e)
            toolResult = 'Error cargando direcciones. Pide texto o GPS.'
          }
          functionResponses.push({ name: call.name, response: { result: toolResult } })

          // Si ya pausamos por la lista, no procesar más tools en este ciclo
          if (isDone) break

        // ── finalizar_cotizacion ────────────────────────────────────────
        } else if (call.name === 'finalizar_cotizacion') {
          const d = call.args as FinalizarCotizacionArgs
          const errores: string[] = []
          if (!d.origen_lat  || !d.origen_lng)  errores.push('Faltan coordenadas del ORIGEN.')
          if (!d.destino_lat || !d.destino_lng) errores.push('Faltan coordenadas del DESTINO.')
          if (!d.paquete || d.paquete.length < 3) {
            errores.push('Falta descripción del paquete o compra.')
          } else if (DESCRIPCIONES_VAGAS.has(d.paquete.toLowerCase().trim())) {
            errores.push(`La descripción "${d.paquete}" es demasiado vaga. Pídele al cliente los detalles exactos (tamaño, ingredientes, marca, cantidad) para que el repartidor sepa qué comprar o recoger.`)
          }

          if (errores.length > 0) {
            console.log(`[AGENT WATCHDOG] ❌ Errores en finalizar_cotizacion:`, errores)
            functionResponses.push({ name: call.name, response: { error: errores.join(' | ') } })
          } else {
            finalResponse.action = 'FINALIZAR_COTIZACION'
            finalResponse.data   = d
            isDone = true
            break
          }
        }
      }

      if (functionResponses.length > 0) {
        const funcResultMsg: FunctionResultMessage = { role: 'function', functionResponses }
        returnedHistory.push(funcResultMsg)
        if (!isDone) {
          messages.push(funcResultMsg)
        }
      }

    } else if (textPart) {
      // textPart ya fue narroweado a TextPart por el type guard en .find() — no se necesita cast
      finalResponse.textResponse = textPart.text
      returnedHistory.push({ role: 'assistant', content: textPart.text })
      isDone = true
    } else {
      isDone = true
    }
  }

  if (loopCount >= 6 && !finalResponse.textResponse && finalResponse.action !== 'FINALIZAR_COTIZACION') {
    finalResponse.textResponse = '⏳ Dame un momento, sigo revisando...'
  }

  finalResponse.newHistory = returnedHistory
  return finalResponse
}
