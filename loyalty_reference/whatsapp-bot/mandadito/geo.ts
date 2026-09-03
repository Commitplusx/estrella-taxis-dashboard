// ═══════════════════════════════════════════════════════════════════════════
// mandadito/geo.ts — Resolución de ubicaciones
// Responsabilidad única: texto o GPS → coordenadas + nombre + precio de zona
//
// Estrategia en cascada (de más barato a más caro):
//   1. GPS directo (gratis)
//   2. Cache en bot_memory (gratis)
//   3. Búsqueda fuzzy en BD colonias (gratis)
//   4. NLP con IA para estructurar el texto (barato ~$0.0001)
//   5. Google Places API (moderado, solo si 1-4 fallan)
//   6. Google Geocoding API (fallback de Maps)
// ═══════════════════════════════════════════════════════════════════════════

import { resolveH3Location } from '../restaurant-delivery-handler.ts'
import type { UbicacionMandadito, ResultadoResolucion } from './types.ts'
import { callGemini } from '../../_shared/gemini.ts'

// ── Bounding box de Comitán de Domínguez ─────────────────────────────────
const enComitan = (lat: number, lng: number): boolean =>
  lat > 15.9 && lat < 16.55 && lng > -92.6 && lng < -91.8
// Distancia de Levenshtein (Fuzzy Matching)
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null))
  for (let i = 0; i <= a.length; i += 1) { matrix[0][i] = i }
  for (let j = 0; j <= b.length; j += 1) { matrix[j][0] = j }
  for (let j = 1; j <= b.length; j += 1) {
    for (let i = 1; i <= a.length; i += 1) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + indicator
      )
    }
  }
  return matrix[b.length][a.length]
}

// ── Utilidades internas ───────────────────────────────────────────────────

/** Expande abreviaturas callejeras mexicanas antes de enviar a Maps/NLP */
export const normalizarAbreviaturas = (texto: string): string =>
  texto
    .replace(/\bav\.?\b/gi, 'avenida')
    .replace(/\bcalz\.?\b/gi, 'calzada')
    .replace(/\bblvd?\.?\b/gi, 'boulevard')
    .replace(/\bote\.?\b/gi, 'oriente')
    .replace(/\bpte\.?\b/gi, 'poniente')
    .replace(/\bnte\.?\b/gi, 'norte')
    .replace(/\bno\.\s*(\d)/gi, 'número $1') // Solo matchea "no." con punto (evita "no quiero" → "número quiero")
    .replace(/\bfracc?\.?\b/gi, 'fraccionamiento')
    .replace(/\bcol\.?\b/gi, 'colonia')
    .replace(/\bbo\.?\b/gi, 'barrio')
    .replace(/\bcda\.?\b/gi, 'cerrada')
    .replace(/\bpriv\.?\b/gi, 'privada')
    .replace(/\s{2,}/g, ' ')
    .trim()

export const stripPrefijos = (s: string): string =>
  s.replace(/^(Barrio|Colonia|Fraccionamiento|Polígono|Poligono)\s+/i, '').trim()

/** Timeout helper para fetch (evita que Maps nos cuelgue la función) */
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([promise, new Promise<null>(resolve => setTimeout(() => resolve(null), ms))])

// ── Estrategia 1: Extraer coords de links de Google Maps ──────────────────
export async function extractCoordsFromMapsUrl(text: string): Promise<{ lat: number; lng: number } | null> {
  const urlMatch = text.match(/https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.com|google\.com\/maps)[^\s<>"']*/i)
  if (!urlMatch) return null
  const url = urlMatch[0]

  // Patrón @lat,lng embebido
  const coordDirect = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/)
  if (coordDirect) {
    const lat = parseFloat(coordDirect[1]), lng = parseFloat(coordDirect[2])
    if (lat && lng) return { lat, lng }
  }

  // Patrón ?q=lat,lng
  const qParam = url.match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/)
  if (qParam) {
    const lat = parseFloat(qParam[1]), lng = parseFloat(qParam[2])
    if (lat && lng) return { lat, lng }
  }

  // URL corta → resolver redirect
  try {
    const res = await withTimeout(fetch(url, { redirect: 'follow' }), 4000)
    if (res) {
      const finalUrl = res.url
      const m1 = finalUrl.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/)
      if (m1) return { lat: parseFloat(m1[1]), lng: parseFloat(m1[2]) }
      const m2 = finalUrl.match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/)
      if (m2) return { lat: parseFloat(m2[1]), lng: parseFloat(m2[2]) }
    }
  } catch { /* ignorar */ }

  return null
}

// ── Estrategia 2: Reverse geocoding (GPS → nombre de colonia) ─────────────
export async function getBarrioFromMaps(lat: number, lng: number): Promise<string | null> {
  try {
    const MAPS_KEY = Deno.env.get('GOOGLE_MAPS_KEY') || ''
    if (!MAPS_KEY) return null
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=es&result_type=neighborhood|sublocality|locality&key=${MAPS_KEY}`
    const res = await withTimeout(fetch(url), 4000)
    if (!res) return null
    const json = await res.json()
    if (json.status !== 'OK' || !json.results?.length) return null
    const prioridades = ['neighborhood', 'sublocality_level_1', 'sublocality', 'locality']
    for (const result of json.results) {
      for (const tipo of prioridades) {
        const comp = result.address_components?.find((c: any) => c.types.includes(tipo))
        if (comp?.long_name) return stripPrefijos(comp.long_name)
      }
    }
    return null
  } catch { return null }
}

// ── Estrategia 3: Cache de texto → coords en bot_memory ──────────────────
const CACHE_KEY = (texto: string) => `geo_cache_${texto.trim().toLowerCase().substring(0, 80)}`

async function getGeoCache(supabase: any, texto: string): Promise<{ lat: number; lng: number; nombre: string } | null> {
  try {
    const { data } = await supabase.from('bot_memory').select('history').eq('phone', CACHE_KEY(texto)).maybeSingle()
    const entry = data?.history?.[0]
    if (!entry?.lat || !entry?.lng) return null
    // Cache válido por 30 días
    if (Date.now() - (entry.ts || 0) > 30 * 24 * 3600 * 1000) return null
    return entry
  } catch { return null }
}

function setGeoCache(supabase: any, texto: string, lat: number, lng: number, nombre: string): void {
  supabase.from('bot_memory').upsert({
    phone: CACHE_KEY(texto),
    history: [{ lat, lng, nombre, ts: Date.now() }],
    updated_at: new Date().toISOString()
  }).then().catch()
}

// ── Estrategia 4: NLP para estructurar el texto de dirección ─────────────
async function estructurarDireccionConIA(textoOriginal: string): Promise<{
  calle: string; colonia: string | null; referencias: string | null
  destinatario: string | null; telefono: string | null; esNegocio: boolean
}> {
  const PALABRAS_NEGOCIO = ['farmacia', 'oxxo', 'tienda', 'super', 'restaurant', 'taqueria',
    'hospital', 'clinica', 'escuela', 'colegio', 'hotel', 'banco', 'gasolinera', 'ferreteria',
    'papeleria', 'tortilleria', 'carniceria', 'panaderia', 'veterinaria', 'gym', 'salon',
    'pizza', 'burger', 'helados', 'dominos', 'domino', 'soriana', 'walmart', 'bodega',
    'aurrera', 'chedraui', 'liverpool', 'sanborns', 'sushi', 'taller', 'mecanico', 'imprenta']
  const esNegocioLocal = PALABRAS_NEGOCIO.some(kw => textoOriginal.toLowerCase().includes(kw))
  const defaultRes = { calle: textoOriginal, colonia: null, referencias: null, destinatario: null, telefono: null, esNegocio: esNegocioLocal }

  try {
    const prompt = `Eres un extractor de direcciones para Comitán de Domínguez, Chiapas, México.
Devuelve JSON con:
{ "calle": "via principal o nombre del comercio", "colonia": "barrio/col. o null", "referencias": "cruces o null", "destinatario": "nombre persona o null", "telefono": "teléfono o null", "esNegocio": true/false }

REGLAS DE ORO:
1. NUNCA extraigas saludos, justificaciones, ni basura conversacional ("hola", "es que fíjese", "uy perdón").
2. En "calle" pon ÚNICAMENTE el nombre del lugar, calle o negocio. ¡NO PONGAS TODA LA ORACIÓN!
3. En "referencias" pon indicaciones como color de fachada, junto a X lugar.

EJEMPLO 1:
Texto: "¡Uy, perdón! Es que con tanto estrés no me acuerdo ni de mi código postal. Pero es mi despacho, está frente al Teatro Junchavín, en el centro de Comitán. ¿Le sirve esa referencia?"
JSON: { "calle": "Despacho frente al Teatro Junchavín", "colonia": "Centro", "referencias": "Frente al Teatro Junchavín", "destinatario": null, "telefono": null, "esNegocio": true }

Sin markdown, solo JSON puro.`

    const content = await callGemini([
      { role: 'system', content: prompt },
      { role: 'user', content: textoOriginal.substring(0, 200) }
    ], 'gemini-3.1-pro-preview', 250, true)

    if (!content) return defaultRes
    
    const parsed = JSON.parse(content)
    return {
      calle: parsed.calle || textoOriginal,
      colonia: parsed.colonia || null,
      referencias: parsed.referencias || null,
      destinatario: parsed.destinatario || null,
      telefono: parsed.telefono || null,
      esNegocio: !!parsed.esNegocio || esNegocioLocal
    }
  } catch { return defaultRes }
}

// ── Estrategia 5 & 6: Google Places + Geocoding ───────────────────────────
interface PlaceResult { lat: number; lng: number; name: string }

async function buscarEnGoogleMaps(
  query: string,
  anclaLat?: number | null,
  anclaLng?: number | null,
  anclaRadio = 15000
): Promise<PlaceResult[] | null> {
  const MAPS_KEY = Deno.env.get('GOOGLE_MAPS_KEY') || ''
  if (!MAPS_KEY) return null

  const queryFull = `${query}, Comitán, Chiapas`

  const checkDistancia = (lat: number, lng: number, placeName?: string): boolean => {
    if (!anclaLat || !anclaLng) return true
    const p = 0.017453292519943295
    const a = 0.5 - Math.cos((lat - anclaLat) * p) / 2 +
      Math.cos(anclaLat * p) * Math.cos(lat * p) * (1 - Math.cos((lng - anclaLng) * p)) / 2
    const distMetros = 12742 * Math.asin(Math.sqrt(a)) * 1000
    let limite = anclaRadio + 200
    if (placeName) {
      const normPlace = placeName.toLowerCase()
      const palabras = query.split(/\s+/).filter(p => p.length > 4)
      if (palabras.some(p => normPlace.includes(p))) limite = 5000
    }
    return distMetros <= limite
  }

  // Intentar Places API primero
  try {
    const body: any = { textQuery: queryFull }
    if (anclaLat && anclaLng) {
      body.locationBias = { circle: { center: { latitude: anclaLat, longitude: anclaLng }, radius: anclaRadio } }
    }
    const res = await withTimeout(fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'X-Goog-Api-Key': MAPS_KEY,
        'X-Goog-FieldMask': 'places.displayName,places.location,places.currentOpeningHours',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }), 3500)

    if (res) {
      const json = await res.json()
      const resultados: PlaceResult[] = []
      for (const p of (json.places || [])) {
        const lat = p.location?.latitude, lng = p.location?.longitude
        const estaCerrado = p.currentOpeningHours ? p.currentOpeningHours.openNow === false : false
        if (lat && lng && enComitan(lat, lng) && checkDistancia(lat, lng, p.displayName?.text)) {
          resultados.push({ lat, lng, name: p.displayName?.text || query, estaCerrado })
          if (resultados.length >= 3) break
        }
      }
      if (resultados.length > 0) return resultados
    }
  } catch { /* continuar con Geocoding */ }

  // Fallback: Geocoding API
  try {
    const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(queryFull)}&key=${MAPS_KEY}`
    const res = await withTimeout(fetch(geoUrl), 3500)
    if (res) {
      const json = await res.json()
      if (json.status === 'OK' && json.results?.length > 0) {
        const r = json.results[0]
        const lat = r.geometry?.location?.lat, lng = r.geometry?.location?.lng
        if (lat && lng && enComitan(lat, lng) && checkDistancia(lat, lng)) {
          return [{ lat, lng, name: r.formatted_address || query }]
        }
      }
    }
  } catch { /* nada */ }

  return null
}

// ── Función principal exportada ───────────────────────────────────────────

/**
 * Resuelve una UbicacionMandadito (texto libre o GPS) a coordenadas validadas.
 * Retorna null si no pudo resolver, o un flag `requiereAclaracion/requiereAclaracionReferencia`
 * si necesita preguntar al cliente.
 */
export async function resolverUbicacion(
  supabase: any,
  ubi: UbicacionMandadito,
  telefono?: string
): Promise<ResultadoResolucion | null> {
  const textoOriginal = String(ubi.texto || '').substring(0, 200).trim()
  const textNoAccents = textoOriginal.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()

  // ── Bloqueo de palabras vacías geográficas ──
  if (/\b(aqui|aca|alla|ahi|alli|este lugar|mi ubicacion|donde estoy)\b/.test(textNoAccents)) {
    console.log('[GEO] Palabra reservada detectada (aquí/acá), forzando solicitud de GPS.')
    return null
  }

  // ── Bloqueo de palabras genéricas sin nombre propio ──
  // ⚠️  Este bloqueo se evalúa DESPUÉS del PASO 0 (ver abajo).
  // Aquí solo definimos el patrón; el rechazo real ocurre si PASO 0 no encontró nada.
  const palabrasGenericas = /^(el mercado|al mercado|mercado|la tortilleria|tortilleria|la tienda|tienda|la oficina|oficina|el trabajo|trabajo|la casa|casa|la escuela|escuela)$/i

  // ── PASO 0: Buscar en Mis Direcciones Guardadas (Inferencia Avanzada) ──
  // IMPORTANTE: este paso va primero que el bloqueo de genéricas.
  // "mi trabajo" o "casa" deben resolver a coords guardadas cuando existen.
  if (telefono && textoOriginal) {
    const norm = textoOriginal.toLowerCase()
    // Evitar falsos positivos como "casa de toño"
    const esFalsoPositivo = /\b(casa de|oficina de|trabajo de)\b/.test(norm)

    if (!esFalsoPositivo) {
      try {
        const { data: savedLocs } = await supabase
          .from('cliente_ubicaciones')
          .select('*')
          .eq('cliente_telefono', telefono)

        if (savedLocs && savedLocs.length > 0) {
          for (const loc of savedLocs) {
            const tipo = loc.tipo.toLowerCase()
            let isMatch = false

            // Diccionario de Alias Semánticos
            if (tipo === 'casa') {
              isMatch = /\b(casa|casita|hogar|depa|depto|departamento)\b/.test(norm)
            } else if (tipo === 'trabajo' || tipo === 'oficina') {
              isMatch = /\b(trabajo|chamba|jale|oficina|negocio|local)\b/.test(norm)
            } else if (tipo === 'escuela') {
              isMatch = /\b(escuela|uni|universidad|facultad|prepa|colegio)\b/.test(norm)
            } else {
              isMatch = norm.includes(tipo)
            }

            if (isMatch) {
              console.log(`[GEO] Match semántico con dirección guardada: ${loc.tipo} -> ${loc.colonia_nombre}`)
              const resolved = await resolveH3Location(supabase, loc.lat, loc.lng)
              const precio = resolved?.precio ?? 45
              return {
                colonia: { nombre: loc.colonia_nombre, lat: loc.lat, lng: loc.lng, precio, esGps: true, coloniaId: resolved?.colonia_id },
                zona: { nombre: loc.colonia_nombre, precio },
                esGps: true
              }
            }
          }
        }
      } catch (e) { console.error('[GEO] Error buscando direcciones guardadas:', e) }
    }
  }

  // Si llegamos aquí, el cliente NO tiene guardada esa dirección.
  // Ahora sí bloqueamos palabras genéricas que no tienen nombre propio.
  if (palabrasGenericas.test(textNoAccents.trim())) {
    console.log('[GEO] Palabra genérica detectada sin especificar nombre, forzando solicitud de aclaración.')
    return null
  }


  // ── PASO 0.5: Mapa Semántico Personalizado (cliente_perfiles.ubicaciones_semanticas) ──
  // Resuelve aliases personalizados como "mi local", "mi bodega", "casa de mi mamá"
  if (telefono && textoOriginal) {
    try {
      const { data: perfil } = await supabase
        .from('cliente_perfiles')
        .select('ubicaciones_semanticas')
        .eq('cliente_telefono', telefono)
        .maybeSingle()

      if (perfil?.ubicaciones_semanticas) {
        const mapaAliases = typeof perfil.ubicaciones_semanticas === 'string'
          ? JSON.parse(perfil.ubicaciones_semanticas)
          : perfil.ubicaciones_semanticas

        const norm = textoOriginal.toLowerCase()
        const words = norm.split(/\s+/) // Separar texto original en palabras
        
        for (const [alias, datos] of Object.entries(mapaAliases as Record<string, any>)) {
          const aliasNorm = alias.toLowerCase().replace(/^"?|"?$/g, '').trim()
          let isMatch = false

          // 1. Coincidencia estricta (el texto contiene el alias completo)
          if (norm.includes(aliasNorm) || aliasNorm.includes(norm)) {
            isMatch = true
          } else {
            // 2. Coincidencia Fuzzy Avanzada (por si escriben "negosio", "kasa", etc.)
            // Dividimos el alias en palabras para validar cada componente contra el input
            const aliasWords = aliasNorm.split(' ')
            let matchedAllWords = true
            
            for (const aw of aliasWords) {
              if (aw.length < 4) {
                // Palabras muy cortas (mi, de, la) requieren coincidencia exacta
                if (!words.includes(aw)) {
                  matchedAllWords = false; break;
                }
              } else {
                // Palabras largas permiten fuzzy matching
                let foundFuzzy = false
                for (const word of words) {
                  if (levenshteinDistance(word, aw) <= 2) {
                    foundFuzzy = true; break;
                  }
                }
                if (!foundFuzzy) {
                  matchedAllWords = false; break;
                }
              }
            }
            
            if (matchedAllWords) {
              isMatch = true
            }
          }

          if (isMatch) {
            const lat = datos?.lat ?? datos?.coords?.lat
            const lng = datos?.lng ?? datos?.coords?.lng
            const nombreOficial = datos?.nombre_oficial || datos?.referencia || alias

            if (lat && lng) {
              console.log(`[GEO] 🗺️ Match en mapa semántico personalizado: "${alias}" → ${lat},${lng}`)
              const resolved = await resolveH3Location(supabase, lat, lng)
              const precio = resolved?.precio ?? 45
              return {
                colonia: { nombre: nombreOficial, lat, lng, precio, esGps: true, coloniaId: resolved?.colonia_id },
                zona: { nombre: nombreOficial, precio },
                esGps: true
              }
            }
          }
        }
      }
    } catch (e) { console.error('[GEO] Error buscando mapa semántico:', e) }
  }

  // ── PASO 1: GPS directo ───────────────────────────────────────────────
  if (ubi.lat && ubi.lng) {
    if (!enComitan(ubi.lat, ubi.lng)) return null // WATCHDOG: Fuera del área de servicio

    const resolved = await resolveH3Location(supabase, ubi.lat, ubi.lng)
    
    let nombre = ''
    // Si la IA (o el flujo rígido) ya nos dio un texto descriptivo, lo respetamos
    if (ubi.texto && !ubi.texto.includes('[UBICACIÓN GPS COMPARTIDA')) {
      nombre = stripPrefijos(ubi.texto)
    } else {
      // Si no hay texto (ej. Pin GPS directo), inferimos la colonia
      nombre = resolved?.colonia_nombre || ''
      if (!nombre || nombre.toLowerCase().includes('zona ')) {
        nombre = await getBarrioFromMaps(ubi.lat, ubi.lng) || nombre || 'Ubicación GPS'
      }
      nombre = stripPrefijos(nombre)
    }

    const precio = resolved?.precio ?? 45
    return {
      colonia: { nombre, lat: ubi.lat, lng: ubi.lng, precio, esGps: true, coloniaId: resolved?.colonia_id },
      zona: { nombre, precio },
      esGps: true
    }
  }

  // ── Sin texto tampoco ─────────────────────────────────────────────────
  if (!textoOriginal) return null

  // Verificar si viene con link de Google Maps en el texto
  const coordsLink = await extractCoordsFromMapsUrl(textoOriginal)
  if (coordsLink) {
    if (!enComitan(coordsLink.lat, coordsLink.lng)) return null // WATCHDOG: Fuera del área de servicio

    const resolved = await resolveH3Location(supabase, coordsLink.lat, coordsLink.lng)
    let nombre = resolved?.colonia_nombre || await getBarrioFromMaps(coordsLink.lat, coordsLink.lng) || 'Ubicación Maps'
    nombre = stripPrefijos(nombre)
    const precio = resolved?.precio ?? 45
    return {
      colonia: { nombre, lat: coordsLink.lat, lng: coordsLink.lng, precio, esGps: true },
      zona: { nombre, precio },
      esGps: true
    }
  }

  // ── PASO 2: Cache de texto ────────────────────
  console.log(`🔍 [GEO] Buscando en cache: "${textoOriginal.substring(0, 60)}"`)
  const cached = await getGeoCache(supabase, textoOriginal)
  if (cached) {
    console.log(`⚡ [GEO] Cache HIT → "${cached.nombre}" (${cached.lat.toFixed(4)},${cached.lng.toFixed(4)})`)
    if (!enComitan(cached.lat, cached.lng)) return null // WATCHDOG

    const resolved = await resolveH3Location(supabase, cached.lat, cached.lng)
    const precio = resolved?.precio ?? 45
    return {
      colonia: { nombre: cached.nombre, lat: cached.lat, lng: cached.lng, precio, esGps: true },
      zona: { nombre: cached.nombre, precio },
      esGps: true
    }
  }

  // ── PASO 3: Búsqueda fuzzy en BD ───────────────────
  const textoNorm = normalizarAbreviaturas(textoOriginal)
  let anclaLat: number | null = null
  let anclaLng: number | null = null
  let anclaRadio = 15000

  console.log(`🗃️ [GEO] Buscando en BD fuzzy: "${textoNorm.substring(0, 60)}"`)
  const { data: smartResults } = await supabase.rpc('search_colonia_smart', { query_text: textoOriginal })
  if (smartResults?.length > 0 && smartResults[0].score >= 0.35) {
    console.log(`🎯 [GEO] BD match: "${smartResults[0].nombre}" score=${smartResults[0].score.toFixed(2)}, usando como ancla`)
    anclaLat = smartResults[0].lat
    anclaLng = smartResults[0].lng
    anclaRadio = 500
  } else if (smartResults?.length > 0) {
    console.log(`🟡 [GEO] BD match débil: "${smartResults[0].nombre}" score=${smartResults[0].score.toFixed(2)} (necesita >= 0.35)`)
  } else {
    console.log(`❌ [GEO] Sin match en BD.`)
  }

  // ── PASO 4: NLP para estructurar el texto ─────────────────
  console.log(`🧠 [GEO] Pasando a NLP (Gemini): "${textoNorm.substring(0, 80)}"`)
  const nlpData = await estructurarDireccionConIA(textoNorm)
  const { calle, colonia: coloniaNlp, referencias, destinatario, telefono: nlpTelefono } = nlpData
  console.log(`🧠 [GEO] NLP result → calle:"${calle}" colonia:"${coloniaNlp}" refs:"${referencias}"`)

  // Refinar ancla con la colonia que sacó el NLP
  if (!anclaLat && coloniaNlp && coloniaNlp.length > 2) {
    const { data: nlpColList } = await supabase.rpc('search_colonia_smart', { query_text: coloniaNlp })
    if (nlpColList?.length && nlpColList[0].score >= 0.40) {
      anclaLat = nlpColList[0].lat
      anclaLng = nlpColList[0].lng
      anclaRadio = 400
    }
  }

  // Si el cliente SOLO mandó el nombre de la colonia sin calle/referencias, pedimos más datos
  // 🛡️ FIX #1: Si el texto es largo (>30 chars) o tiene números (manzana, lote, #), tiene suficiente detalle
  const tieneDetalleNumerico = /\d/.test(textoOriginal)
  const esTextoLargo = textoOriginal.length > 30
  
  if (!tieneDetalleNumerico && !esTextoLargo) {
    const pareceSoloColonia = (!calle || calle.length < 3) || 
      (calle.toLowerCase() === textoOriginal.toLowerCase() && !referencias && smartResults?.length > 0 && smartResults[0].score > 0.5)

    if (pareceSoloColonia && (!referencias || referencias.length < 3)) {
      const coloniaFaltante = coloniaNlp || (smartResults?.length > 0 ? smartResults[0].nombre : textoOriginal)
      console.log(`⚠️ [GEO] Incompleto, pidiendo aclaración. coloniaFaltante="${coloniaFaltante}"`)
      return { requiereAclaracionReferencia: true, coloniaFaltante }
    }
  }

  // ── PASO 5: Google Maps ──────────────────────
  const queryPartes = [calle, referencias, coloniaNlp ? `Colonia ${coloniaNlp}` : null]
    .filter(Boolean).join(', ')

  console.log(`🗺️ [GEO] Buscando en Google Maps: "${queryPartes}" ancla=(${anclaLat?.toFixed(4) || 'sin'}, ${anclaLng?.toFixed(4) || 'sin'}) radio=${anclaRadio}m`)

  if (queryPartes.length > 3) {
    const lugares = await buscarEnGoogleMaps(queryPartes, anclaLat, anclaLng, anclaRadio)
    console.log(`🗺️ [GEO] Maps result: ${lugares ? lugares.length + ' opciones' : 'sin resultados'}`)

    if (lugares && lugares.length > 0) {
      // 🛡️ FIX: Si hay múltiples resultados pero están a menos de 400 metros de distancia entre sí (ej. múltiples pines del mismo parque), auto-seleccionar el primero.
      let estanClustered = false
      if (lugares.length > 1) {
        const p = 0.017453292519943295
        const l1 = lugares[0], l2 = lugares[1]
        const a = 0.5 - Math.cos((l2.lat - l1.lat) * p) / 2 + Math.cos(l1.lat * p) * Math.cos(l2.lat * p) * (1 - Math.cos((l2.lng - l1.lng) * p)) / 2
        const distMetros = 12742 * Math.asin(Math.sqrt(a)) * 1000
        if (distMetros <= 400) estanClustered = true
      }

      // Siempre confiamos en el resultado #1 de Google (suele ser el landmark correcto o irrelevante para el precio si es genérico) para no molestar al usuario con preguntas "robóticas".
      const lugar = lugares[0]
      const resolved = await resolveH3Location(supabase, lugar.lat, lugar.lng)
      const precio = resolved?.precio ?? 45
      setGeoCache(supabase, textoOriginal, lugar.lat, lugar.lng, lugar.name)
      
      // Si usamos el primer resultado de varios, preservamos el texto estructurado para no perder el detalle
      const nombreCortoNlp = [calle, coloniaNlp].filter(Boolean).join(', ')
      const nombreLimpio = nombreCortoNlp.length > 5 ? nombreCortoNlp : (textoOriginal.length > 60 ? textoOriginal.substring(0, 57) + '...' : textoOriginal)
      const nombreFinal = lugares.length > 1 ? nombreLimpio : lugar.name
      
      return {
        colonia: { nombre: nombreFinal, lat: lugar.lat, lng: lugar.lng, precio, esGps: true, destinatario, telefono: nlpTelefono, estaCerrado: lugar.estaCerrado },
        zona: { nombre: resolved?.colonia_nombre || lugar.name, precio },
        esGps: true
      }
    } else if (anclaLat && anclaLng) {
      // 🌟 FIX #3 (Geo-Flexibilidad): Google Maps falló buscando el negocio exacto,
      // pero la IA encontró la colonia y tenemos su ancla (centro geográfico).
      // Usamos el ancla para el precio H3 y preservamos el texto original para el repartidor.
      const resolved = await resolveH3Location(supabase, anclaLat, anclaLng)
      const precio = resolved?.precio ?? 45
      const nombreCortoNlp = [calle, coloniaNlp].filter(Boolean).join(', ')
      const nombreLimpio = nombreCortoNlp.length > 5 ? nombreCortoNlp : (textoOriginal.length > 60 ? textoOriginal.substring(0, 57) + '...' : textoOriginal)
      return {
        colonia: { 
          nombre: nombreLimpio, 
          lat: anclaLat, 
          lng: anclaLng, 
          precio, 
          esGps: true, 
          destinatario, 
          telefono: nlpTelefono 
        },
        zona: { nombre: resolved?.colonia_nombre || coloniaNlp || 'Zona Local', precio },
        esGps: true
      }
    }
  } else if (anclaLat && anclaLng) {
      // Mismo soft-fallback si la query era muy corta pero tenemos ancla
      const nombreCortoNlp = [calle, coloniaNlp].filter(Boolean).join(', ')
      const nombreLimpio = nombreCortoNlp.length > 5 ? nombreCortoNlp : (textoOriginal.length > 60 ? textoOriginal.substring(0, 57) + '...' : textoOriginal)
      const resolved = await resolveH3Location(supabase, anclaLat, anclaLng)
      const precio = resolved?.precio ?? 45
      return {
        colonia: { nombre: nombreLimpio, lat: anclaLat, lng: anclaLng, precio, esGps: true, destinatario, telefono: nlpTelefono },
        zona: { nombre: resolved?.colonia_nombre || coloniaNlp || 'Zona Local', precio },
        esGps: true
      }
  }

  // ── PASO 6: Fallback final — mejor resultado BD aunque sea baja confianza ──
  if (smartResults && smartResults.length > 0) {
    const fallback = smartResults[0]
    
    const tieneDetalleNumerico = /\d/.test(textoOriginal)
    const esTextoLargo = textoOriginal.length > 30
    const requiereAclaracion = (!tieneDetalleNumerico && !esTextoLargo)

    const nombreCortoNlp = [calle, coloniaNlp].filter(Boolean).join(', ')
    const nombreLimpio = nombreCortoNlp.length > 5 ? nombreCortoNlp : (textoOriginal.length > 60 ? textoOriginal.substring(0, 57) + '...' : textoOriginal)

    // 🛡️ FIX: Llamar a H3 para obtener el precio real de la ubicación fallback, 
    // ya que search_colonia_smart no devuelve precio.
    const resolved = await resolveH3Location(supabase, fallback.lat, fallback.lng)
    const precio = resolved?.precio ?? 45

    return {
      colonia: { lat: fallback.lat, lng: fallback.lng, nombre: nombreLimpio, precio, esGps: false, destinatario, telefono: nlpTelefono },
      zona: { nombre: fallback.nombre, precio },
      esGps: false,
      requiereAclaracionReferencia: requiereAclaracion,
      coloniaFaltante: fallback.nombre
    }
  }

  return null
}
