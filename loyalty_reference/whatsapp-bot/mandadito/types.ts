// ═══════════════════════════════════════════════════════════════════════════
// mandadito/types.ts — Interfaces y tipos compartidos
// Sin dependencias externas. Todo el módulo importa desde aquí.
// ═══════════════════════════════════════════════════════════════════════════

/** Ubicación tal como viene del cliente: texto libre o coordenadas GPS */
export interface UbicacionMandadito {
  texto?: string
  lat?: number
  lng?: number
}

/** Ubicación ya resuelta y validada con coords + nombre legible + precio de zona */
export interface UbicacionResuelta {
  nombre: string          // "Col. Centro", "Domino's Blvd. Domínguez"
  lat: number
  lng: number
  precio?: number         // Tarifa base de la zona (desde tabla colonias/h3_zonas)
  coloniaId?: string | null
  esGps?: boolean         // true si vino de GPS directo o Maps; false si fue fuzzy de BD
  destinatario?: string | null
  telefono?: string | null
  estaCerrado?: boolean   // Horario de Google Places
  esNegocio?: boolean     // Detectado por NLP
}

/** Parada individual en un mandadito multi-parada */
export interface ParadaMandadito {
  tipo: 'recoger' | 'entregar' | 'comprar' | 'destino'
  ubicacion: UbicacionMandadito
  instruccion?: string
  _coloniaObj?: UbicacionResuelta // Inyectado temporalmente tras resolución geo
}

/** Cotización guardada en el estado, lista para confirmar */
export interface CotizacionGuardada {
  precioFinal: number
  origenDisplay: string
  destinoDisplay: string
  origenLat?: number
  origenLng?: number
  destinoLat?: number
  destinoLng?: number
  destinatario?: string | null
  telefono?: string | null
  detalles?: string | null
  esMultiParada?: boolean
  paradas?: ParadaMandadito[]
}

/** Estado persistido en bot_memory para la máquina de estados */
export interface EstadoMandadito {
  step: number
  v?: number              // Versión del estado para migraciones
  ts?: number             // Timestamp para TTL
  role?: 'envio' | 'recibo'
  roleIntentos?: number   // Contador de intentos fallidos en paso 0.5

  // Flujo sencillo (legacy):
  origen?: UbicacionMandadito
  destino?: UbicacionMandadito
  referencias?: string | null

  // Multi-parada:
  paradas?: ParadaMandadito[]
  resolvingIndex?: number

  // Robustez:
  intentosFallidos?: number

  // Sub-estados de aclaración:
  destinoPendiente?: UbicacionMandadito | null
  opciones?: Array<{ lat: number; lng: number; name: string; estaCerrado?: boolean }>
  coloniaAnterior?: string
  originalState?: EstadoMandadito

  // Cotización pendiente de confirmación:
  cotizacion?: CotizacionGuardada
}

/**
 * Resultado de resolverUbicacion en geo.ts.
 * Puede ser:
 *  - Exitoso: colonia está presente
 *  - Aclaración requerida: requiereAclaracion=true con opciones
 *  - Referencia requerida: requiereAclaracionReferencia=true con coloniaFaltante
 *  - Fallo: null (retornado como null, no como este tipo)
 */
export type ResultadoResolucion =
  | {
      colonia: UbicacionResuelta
      zona: { id?: string | null; nombre: string; precio: number }
      esGps: boolean
      requiereAclaracion?: false
      requiereAclaracionReferencia?: false
      opciones?: undefined
      coloniaFaltante?: undefined
    }
  | {
      colonia?: undefined
      zona?: undefined
      esGps?: undefined
      requiereAclaracion: true
      opciones: Array<{ lat: number; lng: number; name: string; estaCerrado?: boolean }>
      requiereAclaracionReferencia?: false
      coloniaFaltante?: undefined
    }
  | {
      colonia?: undefined
      zona?: undefined
      esGps?: undefined
      requiereAclaracion?: false
      requiereAclaracionReferencia: true
      coloniaFaltante: string
      opciones?: undefined
    }

/** Cotización final con precio, detalles de origen/destino y metadata (legacy) */
export interface CotizacionMandadito {
  precioFinal: number
  modoLluviaAplicado: boolean
  recargoLluvia: number
  origenDisplay: string
  destinoDisplay: string
  origenLat: number
  origenLng: number
  destinoLat: number
  destinoLng: number
  destinatario?: string | null
  telefono?: string | null
}
