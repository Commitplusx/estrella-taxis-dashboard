// ══════════════════════════════════════════════════════════════════════════════
// _shared/constants.ts — Single Source of Truth para Edge Functions
// ══════════════════════════════════════════════════════════════════════════════
// Mismas reglas de negocio que src/lib/constants.ts (frontend).
// Si cambias un valor aquí, cámbialo también en el frontend.

/** Meta de puntos por rango para obtener envío gratis */
export const PUNTOS_META = {
  bronce: 5,
  plata: 4,
  oro: 3,
} as const

/** Calcula la meta de puntos según el rango del cliente */
export function getMetaPuntos(rango?: string | null, esVip?: boolean): number {
  if (rango === 'oro') return PUNTOS_META.oro
  if (rango === 'plata' || esVip) return PUNTOS_META.plata
  return PUNTOS_META.bronce
}

/** Precio normal del servicio de envío */
export const PRECIO_ENVIO_NORMAL = 50

/** Tope máximo que cubre un "envío gratis" */
export const MAX_COBERTURA_ENVIO_GRATIS = 45
