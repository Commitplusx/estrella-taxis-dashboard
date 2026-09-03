// ═══════════════════════════════════════════════════════════════════════════
// mandadito/pricing.ts — Cálculo de precio de un mandadito
// Responsabilidad única: coordenadas A + B → precio en pesos MXN
//
// Estrategia en cascada:
//   1. Función PostgreSQL calcular_precio_mandadito (oficial, aplica tarifas)
//   2. Haversine fallback (si la BD falla)
//   3. Recargo de lluvia (se aplica al final si está activo)
// ═══════════════════════════════════════════════════════════════════════════

import type { CotizacionMandadito, UbicacionResuelta } from './types.ts'

// ── Haversine: distancia en km entre dos puntos ───────────────────────────
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p = 0.017453292519943295
  const a =
    0.5 -
    Math.cos((lat2 - lat1) * p) / 2 +
    Math.cos(lat1 * p) * Math.cos(lat2 * p) * (1 - Math.cos((lon2 - lon1) * p)) / 2
  return 12742 * Math.asin(Math.sqrt(a))
}

/** Redondea al múltiplo de 5 más cercano hacia arriba */
const redondearA5 = (n: number): number =>
  n % 5 === 0 ? n : Math.ceil(n / 5) * 5

async function getAutoWeatherRain(supabase: any): Promise<boolean> {
  try {
    const { data } = await supabase.from('bot_memory').select('history').eq('phone', 'sys_auto_weather').maybeSingle()
    const cached = data?.history?.[0]
    if (cached && (Date.now() - cached.timestamp < 15 * 60 * 1000)) {
      return cached.isRaining
    }

    const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=16.25&longitude=-92.13&current_weather=true')
    const json = await res.json()
    const code = json.current_weather?.weathercode || 0
    // WMO Weather codes: 50-99 indica precipitación (lluvia, llovizna, tormentas)
    const isRaining = code >= 50 && code <= 99
    
    await supabase.from('bot_memory').upsert({
      phone: 'sys_auto_weather',
      history: [{ isRaining, timestamp: Date.now(), code }],
      updated_at: new Date().toISOString()
    })
    return isRaining
  } catch (e) {
    console.error('[WEATHER] Error fetching weather:', e)
    return false
  }
}

// ── Obtener configuración de lluvia desde bot_memory ─────────────────────
export async function getModoLluvia(supabase: any): Promise<{ activo: boolean; recargo: number }> {
  try {
    // 1. Prioridad: Control manual del Admin
    const { data } = await supabase
      .from('bot_memory')
      .select('history')
      .eq('phone', 'sys_modo_lluvia')
      .maybeSingle()
    if (data?.history?.[0]?.activo !== undefined) {
      if (data.history[0].activo) return { activo: true, recargo: Number(data.history[0].recargo) || 15 }
      return { activo: false, recargo: 0 }
    }
  } catch { /* ignorar */ }

  // 2. Si no hay control manual explícito, usar Auto-Lluvia
  // SE DESACTIVA A PETICIÓN DEL USUARIO
  /*
  const isAutoRaining = await getAutoWeatherRain(supabase)
  if (isAutoRaining) {
    return { activo: true, recargo: 15 } // Recargo automático de $15
  }
  */

  return { activo: false, recargo: 0 }
}

// ── Función principal exportada ───────────────────────────────────────────

/**
 * Calcula el precio de un mandadito entre dos ubicaciones resueltas.
 * Primero intenta con la función de BD, después usa Haversine como fallback.
 * Aplica recargo de lluvia si está activo.
 */
export async function calcularPrecioMandadito(
  supabase: any,
  origen: UbicacionResuelta,
  destino: UbicacionResuelta
): Promise<{ precioFinal: number; lluviaActiva: boolean; recargoLluvia: number }> {
  const lluvia = await getModoLluvia(supabase)
  let precioFinal: number | null = null

  // ── 🛡️ Estrategia 1: Prioridad H3 (Zonas Especiales) ───────────────
  // Si la resolución geo detectó una zona H3 con tarifa mayor a la base,
  // la respetamos por encima de la distancia.
  const baseOrigen = typeof origen.precio === 'number' ? origen.precio : 45
  const baseDestino = typeof destino.precio === 'number' ? destino.precio : 45
  const precioH3Maximo = Math.max(baseOrigen, baseDestino)

  if (precioH3Maximo > 45) {
    precioFinal = precioH3Maximo
    console.log(`[PRICING] H3 HIT Prioritario: Respetando zona especial -> $${precioFinal}`)
  }

  // ── Estrategia 2: Función PostgreSQL (distancia) ─────────────────────
  if (precioFinal === null) {
    try {
      const { data: cotizacion } = await supabase.rpc('calcular_precio_mandadito', {
        p_lat_origen:  origen.lat,
        p_lng_origen:  origen.lng,
        p_lat_destino: destino.lat,
        p_lng_destino: destino.lng,
      })
      const cot = Array.isArray(cotizacion) ? cotizacion[0] : cotizacion
      // Fix del typo: la BD retorna "precio", no "precio_final"
      if (cot?.precio && !isNaN(Number(cot.precio))) {
        precioFinal = Number(cot.precio)
        console.log(
          `[PRICING] BD: ${cot.colonia_origen} → ${cot.colonia_destino}` +
          ` | Distancia: ${cot.distancia_km}km → Final: $${precioFinal}`
        )
      }
    } catch (e) {
      console.error('[PRICING] Error en calcular_precio_mandadito:', e)
    }
  }

  // ── Estrategia 3: Haversine fallback ─────────────────────────────────
  if (precioFinal === null) {
    const distKm = haversineKm(origen.lat, origen.lng, destino.lat, destino.lng)
    // 🛡️ FIX #8: Solo cobrar extra distancia si AMBAS ubicaciones son GPS puro sin H3
    const ambasSinH3 = !origen.coloniaId && !destino.coloniaId && !origen.esGps && !destino.esGps
    const extraDistancia = ambasSinH3 && distKm > 3.5 ? (distKm - 3.5) * 8 : 0
    const tarifaBruta = 45 + extraDistancia
    precioFinal = redondearA5(Math.round(tarifaBruta))
    console.log(
      `[PRICING] Haversine fallback: ${distKm.toFixed(1)} km` +
      ` | Base: $45 | Extra: $${extraDistancia.toFixed(0)} → $${precioFinal}`
    )
  }

  // ── Estrategia 3: Recargo de lluvia ───────────────────────────────────
  // ── 🛡️ WATCHDOG: Sanity Check de Precios ──
  // 1. Tarifa Mínima Global
  if (precioFinal !== null && precioFinal < 25) {
    console.log(`[PRICING WATCHDOG] Precio base ($${precioFinal}) menor al mínimo. Forzando a $25.`)
    precioFinal = 25
  }

  if (lluvia.activo && lluvia.recargo > 0 && precioFinal !== null) {
    precioFinal += lluvia.recargo
    console.log(`[PRICING] ☔ Recargo lluvia +$${lluvia.recargo} → $${precioFinal}`)
  }

  return { precioFinal: precioFinal ?? 0, lluviaActiva: lluvia.activo, recargoLluvia: lluvia.recargo }
}

/**
 * Calcula el precio para un mandadito de múltiples paradas.
 * Regla:
 * - El primer tramo (Parada 0 a Parada 1) se cobra normal.
 * - Siguientes tramos (Parada N a Parada N+1):
 *   Si la distancia en línea recta es < 1km, se cobran +$15.
 *   Si es >= 1km, se cotiza como un envío nuevo completo y se suma.
 * - Recargo de lluvia se suma solo UNA VEZ al final.
 */
export async function calcularPrecioMultiParada(
  supabase: any,
  paradas: UbicacionResuelta[]
): Promise<{ precioFinal: number; lluviaActiva: boolean; recargoLluvia: number }> {
  if (paradas.length < 2) {
    return { precioFinal: 0, lluviaActiva: false, recargoLluvia: 0 }
  }

  const lluvia = await getModoLluvia(supabase)
  
  // Calcular primer tramo (0 -> 1) SIN lluvia (la agregamos al final)
  const tramoBase = await calcularPrecioMandadito(supabase, paradas[0], paradas[1])
  let subtotal = tramoBase.precioFinal - (tramoBase.lluviaActiva ? tramoBase.recargoLluvia : 0)

  // Calcular paradas extra
  for (let i = 1; i < paradas.length - 1; i++) {
    const origen = paradas[i]
    const destino = paradas[i + 1]
    
    const distKm = haversineKm(origen.lat, origen.lng, destino.lat, destino.lng)
    
    if (distKm < 2.5) {
      subtotal += 15 // +$15 por parada cercana/en ruta
      console.log(`[PRICING] Tramo ${i+1}->${i+2}: ${distKm.toFixed(2)}km (<2.5km) -> +$15`)
    } else {
      subtotal += 25 // +$25 por parada alejada, en lugar de cobrar un viaje entero nuevo
      console.log(`[PRICING] Tramo ${i+1}->${i+2}: ${distKm.toFixed(2)}km (>=2.5km) -> +$25`)
    }
  }

  let precioFinal = subtotal
  
  // ── 🛡️ WATCHDOG: Sanity Check de Precios ──
  // 1. Tarifa Mínima Global
  if (precioFinal < 25) {
    console.log(`[PRICING WATCHDOG] Precio subtotal ($${precioFinal}) menor al mínimo. Forzando a $25.`)
    precioFinal = 25
  }

  if (lluvia.activo && lluvia.recargo > 0) {
    precioFinal += lluvia.recargo
    console.log(`[PRICING] ☔ Recargo lluvia multi-stop +$${lluvia.recargo} → $${precioFinal}`)
  }

  return { precioFinal, lluviaActiva: lluvia.activo, recargoLluvia: lluvia.recargo }
}
