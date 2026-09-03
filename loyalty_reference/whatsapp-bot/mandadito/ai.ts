// ═══════════════════════════════════════════════════════════════════════════
// mandadito/ai.ts — NLP e Inteligencia Artificial para mandaditos
// Responsabilidad única: texto libre → datos estructurados
//
// Funciones:
//   - extraerOrigenDestino: "tráeme de Domino's a mi casa" → { origen, destino }
//   - validarDatosCompletos: ¿falta algo crítico para ejecutar el mandadito?
//   - extraerResumenFinal: formato limpio para mostrárselo al cliente
// ═══════════════════════════════════════════════════════════════════════════

import { callGemini } from '../../_shared/gemini.ts'

// ── Función 1: Extraer ruta multi-parada del mensaje ────────────────

export interface ParadaExtraida {
  tipo: 'recoger' | 'entregar' | 'comprar'
  ubicacion: string
  instruccion: string | null
}

export interface RutaMandadito {
  paradas: ParadaExtraida[]
  es_objeto_grande?: boolean
  efectivo_estimado?: number | null
}

/**
 * Extrae una ruta de múltiples paradas de un texto libre.
 * Ej: "ve a tpa por un paquete, pasa a estafeta, compra un pollo sinaloa y entrégalo en mi casa"
 */
export async function extraerRutaMandadito(texto: string): Promise<RutaMandadito> {
  const fallback: RutaMandadito = { paradas: [], es_objeto_grande: false, efectivo_estimado: null }
  const content = await callGemini([
    {
      role: 'system',
      content: `Extrae la ruta completa de este mensaje de mandadito/envío en un array de "paradas".
Cada parada debe tener:
- "tipo": puede ser "recoger", "comprar" o "entregar".
- "ubicacion": el nombre del lugar (ej: "tpa", "estafeta", "pollo sinaloa", "casa", "mi oficina"). 
  🚨 IMPORTANTE: Si el cliente menciona un objeto genérico a comprar (ej: "comprar un pollo", "unas pizzas", "refrescos") PERO NO menciona el nombre del negocio o la sucursal (ej: "Pollo Feliz", "Pizza Hut"), DEBES DEJAR este campo completamente vacío "". NUNCA uses un objeto como si fuera una ubicación física. Si no hay destino final explícito, también déjalo vacío "".
- "instruccion": detalle de qué hacer en esa parada (ej: "comprar pollo con papas", "recoger un paquete").

Además, extrae dos valores globales:
- "es_objeto_grande": true si mencionan transportar muebles, electrodomésticos, mudanzas, cosas muy grandes que NO caben en una motocicleta. false si es normal.
- "efectivo_estimado": Si dicen "paga mi recibo de 500" o "trae cambio de 500", extrae el monto numérico estimado que el repartidor debe tener en efectivo. Si no dicen, null.

Responde SOLO en JSON con esta estructura estricta:
{
  "paradas": [
    { "tipo": "string", "ubicacion": "string", "instruccion": "string o null" }
  ],
  "es_objeto_grande": boolean,
  "efectivo_estimado": number o null
}`
    },
    { role: 'user', content: texto.substring(0, 500) }
  ], 'gemini-3.1-pro-preview', 300, true)

  if (!content) return fallback
  try {
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object') return fallback
    if (parsed.paradas && Array.isArray(parsed.paradas)) {
      return { 
        paradas: parsed.paradas,
        es_objeto_grande: parsed.es_objeto_grande === true,
        efectivo_estimado: parsed.efectivo_estimado !== null && !isNaN(Number(parsed.efectivo_estimado)) ? Number(parsed.efectivo_estimado) : null
      }
    }
    return fallback
  } catch { return fallback }
}

// ── Función 2: Validar si los datos del mandadito están completos ─────────

export interface ValidacionMandadito {
  estaCompleto: boolean
  datosFaltantes: string[]
  preguntaAlCliente: string | null
  datosEstructurados: {
    nombreRemitente: string | null
    nombreReceptor: string | null
    numeroOrden: string | null
    telefonoContacto: string | null
  }
}

const DEFAULT_VALIDACION: ValidacionMandadito = {
  estaCompleto: false,
  datosFaltantes: ['referencias_generales'],
  preguntaAlCliente: `📝 ¿Alguna referencia o seña para llegar? También puedes contarnos qué paquete llevamos.\n\n_Escribe *no* si no tienes ninguna._`,
  datosEstructurados: { nombreRemitente: null, nombreReceptor: null, numeroOrden: null, telefonoContacto: null }
}

/**
 * Analiza si falta información crucial para que el repartidor ejecute el mandadito.
 * Considera el rol del cliente (envía o recibe) para saber qué datos pedir.
 */
export async function validarDatosCompletos(
  origenInfo: string,
  destinoInfo: string,
  telefonoCliente: string,
  role?: 'envio' | 'recibo'
): Promise<ValidacionMandadito> {
  const roleInstruction = role === 'envio'
    ? `El cliente (${telefonoCliente}) ES EL REMITENTE. Pide nombre y teléfono del RECEPTOR si no se han dado.`
    : role === 'recibo'
    ? `El cliente (${telefonoCliente}) ES EL DESTINATARIO. Pide nombre y teléfono del REMITENTE si no se han dado.`
    : `Pregunta si el cliente envía o recibe si no está claro.`

  const content = await callGemini([
    {
      role: 'user',
      content: `Eres auditor logístico de Estrella Delivery (Comitán, Chiapas).
Origen: ${origenInfo}
Destino: ${destinoInfo}
Teléfono cliente: ${telefonoCliente}

REGLAS:
1. COMERCIOS: Si el origen/destino es un comercio, pide número de orden/ticket y si el repartidor debe pagarlo.
2. CASAS: Si es una casa, pide referencias (color de fachada, portón, entre qué calles).
3. ${roleInstruction}
4. LUGARES PÚBLICOS: Pide a quién buscar o cómo va vestida la persona.
5. TONO (¡CRÍTICO!): Eres Estrella, un asistente cariismático, chiapaneco y súper amigable. Tu "preguntaAlCliente" debe sonar muy humana, relajada y con emojis. NUNCA suenes como robot. Prohibido usar "proporcione", "indique", etc. Háblale de tú.

Devuelve JSON:
{
  "estaCompleto": boolean,
  "datosFaltantes": string[],
  "preguntaAlCliente": string|null,
  "datosEstructurados": {
    "nombreRemitente": string|null,
    "nombreReceptor": string|null,
    "numeroOrden": string|null,
    "telefonoContacto": string|null
  }
}`
    }
  ], 'gemini-3.1-pro-preview', 400, true)

  if (!content) return DEFAULT_VALIDACION
  try {
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object') return DEFAULT_VALIDACION
    return {
      estaCompleto: !!parsed.estaCompleto,
      datosFaltantes: Array.isArray(parsed.datosFaltantes) ? parsed.datosFaltantes : [],
      preguntaAlCliente: parsed.preguntaAlCliente || null,
      datosEstructurados: parsed.datosEstructurados || DEFAULT_VALIDACION.datosEstructurados
    }
  } catch { return DEFAULT_VALIDACION }
}

// ── Función 3: Resumen final legible para el cliente ─────────────────────

export interface ResumenMandadito {
  origenLimpio: string
  destinoLimpio: string
  remitente: string | null
  receptor: string | null
  telefono: string | null
  orden: string | null
  detalles: string | null
}

/**
 * Genera un resumen limpio del mandadito para mostrarle al cliente antes de confirmar.
 */
export async function extraerResumenFinal(
  origenInfo: string,
  destinoInfo: string,
  referenciasInfo: string | null,
  telefonoCliente: string
): Promise<ResumenMandadito> {
  const fallback: ResumenMandadito = {
    origenLimpio: 'Origen', destinoLimpio: 'Destino',
    remitente: null, receptor: null, telefono: null, orden: null, detalles: referenciasInfo
  }

  const content = await callGemini([
    {
      role: 'user',
      content: `Resume este pedido de envío de forma corta y clara.
Origen: ${origenInfo}
Destino: ${destinoInfo}
Referencias: ${referenciasInfo || 'Ninguna'}
Teléfono del cliente: ${telefonoCliente}

Devuelve JSON:
{
  "origenLimpio": "dirección o lugar exacto preservando detalles como calles o números de casa (ej: 'Domino\\'s', 'Segunda calle sur poniente #17')",
  "destinoLimpio": "dirección o lugar exacto preservando detalles clave",
  "remitente": "nombre en origen o null",
  "receptor": "nombre en destino o null",
  "telefono": "teléfono encontrado o ${telefonoCliente} si dicen 'a mi número'",
  "orden": "número de ticket/orden o null",
  "detalles": "referencias visuales que no sean teléfono ni orden, o null"
}`
    }
  ], 'gemini-3.1-pro-preview', 300, true)

  if (!content) return fallback
  try {
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object') return fallback
    return { ...fallback, ...parsed }
  } catch { return fallback }
}

// ── Función 4: Generador de Aclaraciones Conversacionales ─────────────────

/**
 * Genera un mensaje de aclaración dinámico y conversacional usando LLM.
 * Reemplaza los menús numéricos robóticos con una pregunta amigable.
 */
export async function generarAclaracionConversacional(
  lugarCrudo: string,
  opciones: string[],
  tipoAclaracion: 'multiples_opciones' | 'pedir_calle' | 'pedir_destino' | 'pedir_ubicacion_vacia' | 'ubicacion_no_encontrada' | 'pedir_origen_envio' | 'pedir_origen_recibo'
): Promise<string> {
  const promptMultiples = `Eres Estrella, un asistente logístico chiapaneco y carismático.
El cliente pidió ir a "${lugarCrudo}", pero encontramos varias opciones: ${opciones.join(', ')}.
Escribe UN SOLO MENSAJE CORTO (máx 3 líneas) preguntándole de forma amable y natural a cuál de esas opciones se refiere.
Usa palabras como "fíjate que", "disculpa", o algún emoji. NO uses listas numeradas. NO digas "soy Estrella". Solo haz la pregunta directo.`

  const promptCalle = `Eres Estrella, asistente logístico chiapaneco. 
El cliente dijo que es en "${lugarCrudo}" pero es una zona muy grande. 
Escribe UN SOLO MENSAJE CORTO preguntándole amablemente la calle exacta o alguna referencia (ej. cerca del oxxo, color de casa) para que el repartidor no se pierda.`

  const promptDestino = `Eres Estrella, asistente logístico chiapaneco.
El cliente pidió comprar/recoger cosas pero se le olvidó decir a dónde vamos a entregar todo al final.
Escribe UN SOLO MENSAJE CORTO y carismático (ej. "¡Ya quedó apuntado lo que hay que recoger! 🏁 Pero cuéntame, ¿a dónde te llevo todo al final?")`

  const promptVacia = `Eres Estrella, asistente logístico chiapaneco.
El cliente pidió hacer una parada para "${opciones[0] || 'comprar'}", pero se le olvidó decir en qué negocio o dirección.
Escribe UN SOLO MENSAJE CORTO y amable preguntándole a dónde tiene que ir el repartidor a hacer eso.`

  const promptNoEncontrada = `Eres Estrella, asistente logístico chiapaneco.
El mapa no pudo encontrar esta dirección que dio el cliente: "${lugarCrudo}".
Escribe UN SOLO MENSAJE CORTO diciendo con pena que el mapa no lo halla, y pídele de favor si te puede mandar su ubicación por GPS 📍 o darte el nombre de la calle y colonia.`

  const promptOrigenEnvio = `Eres Estrella, asistente logístico chiapaneco.
El cliente quiere enviar un paquete. Escribe UN SOLO MENSAJE CORTO y natural preguntándole desde dónde pasamos a recoger el paquete.`

  const promptOrigenRecibo = `Eres Estrella, asistente logístico chiapaneco.
El cliente va a recibir un paquete o una compra. Escribe UN SOLO MENSAJE CORTO y natural preguntándole qué es lo que hay que recoger/comprar y en dónde.`

  const prompt = tipoAclaracion === 'multiples_opciones' ? promptMultiples :
                 tipoAclaracion === 'pedir_calle' ? promptCalle : 
                 tipoAclaracion === 'pedir_ubicacion_vacia' ? promptVacia :
                 tipoAclaracion === 'ubicacion_no_encontrada' ? promptNoEncontrada :
                 tipoAclaracion === 'pedir_origen_envio' ? promptOrigenEnvio :
                 tipoAclaracion === 'pedir_origen_recibo' ? promptOrigenRecibo : promptDestino

  const fallback = tipoAclaracion === 'multiples_opciones'
    ? `🤔 Encontré varias opciones para *${lugarCrudo}*:\n${opciones.map((o, i) => `${i+1}️⃣ ${o}`).join('\n')}\n¿A cuál de estas te referías?`
    : tipoAclaracion === 'pedir_calle'
    ? `📝 Para ir a *${lugarCrudo}*, ¿Me das la calle exacta o una referencia para no perdernos?`
    : tipoAclaracion === 'pedir_ubicacion_vacia'
    ? `📍 Oye, ¿a dónde vamos para hacer esto de ${opciones[0] || 'comprar'}?`
    : tipoAclaracion === 'ubicacion_no_encontrada'
    ? `😔 ¡Híjole! No logré ubicar "${lugarCrudo}". ¿Me podrías mandar tu *Ubicación GPS* 📍 o darme más detalles?`
    : tipoAclaracion === 'pedir_origen_envio'
    ? `📍 ¡Perfecto! ¿*Desde dónde* recogemos el paquete?`
    : tipoAclaracion === 'pedir_origen_recibo'
    ? `📍 ¡Bien! ¿Qué gustas que compremos o pasemos a recoger, y en dónde?`
    : `🏁 ¡Listo con las paradas! ¿Y a dónde entregamos todo al final?`

  const content = await callGemini([{ role: 'user', content: prompt }], 'gemini-3.1-pro-preview', 800, false)
  return content || fallback
}

// ── Función 5: Summarization para Fallback Crítico ────────────────────────

/**
 * Cuando Google Maps falla y el cliente mandó una letanía ("Ay, ya le dije! La tortillería a un lado de la iglesia..."),
 * extrae el nombre corto del negocio para el display, y deja el resto como instrucción.
 */
export async function limpiarTextoFallback(textoCrudo: string): Promise<{ nombreCorto: string; instruccionExtra: string }> {
  const fallback = { nombreCorto: textoCrudo.substring(0, 40), instruccionExtra: textoCrudo }
  if (textoCrudo.length < 25) return { nombreCorto: textoCrudo, instruccionExtra: '' }
  
  const content = await callGemini([
    {
      role: 'system',
      content: `El cliente dio esta instrucción larga para un envío: "${textoCrudo}".
Extrae:
1. "nombreCorto": El nombre del lugar o negocio principal (máx 5 palabras). Si no hay nombre claro, inventa uno muy breve basado en la acción (ej. "Mercado", "Domicilio particular"). NUNCA devuelvas frases largas aquí.
2. "instruccionExtra": Todo el contexto extra (indicaciones, reclamos, color de casa) que sirva al repartidor.

Responde SOLO en JSON válido:
{
  "nombreCorto": "string",
  "instruccionExtra": "string"
}`
    }
  ], 'gemini-3.1-pro-preview', 150, true)
  
  if (!content) return fallback
  try {
    const parsed = JSON.parse(content)
    if (parsed.nombreCorto) return parsed
  } catch { /* nada */ }
  
  return fallback
}
