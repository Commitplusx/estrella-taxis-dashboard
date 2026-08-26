// ============================================================
//  mapIcons.ts — Sistema centralizado de íconos de vehículos
//  Fuente única de verdad para el mapa y el selector de categoría
// ============================================================

// Colores de estado — misma paleta que en el mapa
export const STATUS_COLORS = {
  moving:  '#1d4ed8', // azul  = online + en movimiento
  online:  '#16a34a', // verde = online + detenido
  offline: '#94a3b8', // gris  = offline / sin señal
} as const;

export type MarkerStatus = keyof typeof STATUS_COLORS;

// Cada categoría define:
//  - label:  texto legible para el selector
//  - path:   SVG path data (viewBox 0 0 24 24, apuntando hacia ARRIBA)
//  - anchor: punto de anclaje en px dentro del path [x, y]
export const VEHICLE_CATEGORIES: {
  value: string;
  label: string;
  path: string;
  anchor: [number, number];
  scale?: number;
}[] = [
  // ── Coches ────────────────────────────────────────────────
  {
    value: 'default',
    label: 'Taxi / Auto',
    path: 'M 12 2 L 21 21 L 12 16 L 3 21 Z',
    anchor: [12, 12],
  },
  {
    value: 'car',
    label: 'Automóvil',
    path: 'M 12 2 L 21 21 L 12 16 L 3 21 Z',
    anchor: [12, 12],
  },
  {
    value: 'pickup',
    label: 'Camioneta',
    path: 'M 12 2 L 21 21 L 12 16 L 3 21 Z',
    anchor: [12, 12],
    scale: 1.2,
  },
  {
    value: 'offroad',
    label: 'Todoterreno',
    path: 'M 12 2 L 21 21 L 12 16 L 3 21 Z',
    anchor: [12, 12],
    scale: 1.1,
  },
  {
    value: 'van',
    label: 'Furgoneta',
    path: 'M 5 4 L 19 4 L 21 10 L 21 21 L 3 21 L 3 10 Z',
    anchor: [12, 13],
    scale: 0.9,
  },
  {
    value: 'camper',
    label: 'Camper / RV',
    path: 'M 4 4 L 18 4 L 21 10 L 21 21 L 3 21 L 3 10 Z',
    anchor: [12, 13],
    scale: 0.9,
  },

  // ── Motos ─────────────────────────────────────────────────
  {
    value: 'motorcycle',
    label: 'Motocicleta',
    path: 'M 12 2 L 16 22 L 12 18 L 8 22 Z',
    anchor: [12, 12],
  },
  {
    value: 'scooter',
    label: 'Scooter',
    path: 'M 12 2 L 15 22 L 12 18 L 9 22 Z',
    anchor: [12, 12],
  },
  {
    value: 'bicycle',
    label: 'Bicicleta',
    path: 'M 12 2 L 15 22 L 12 18 L 9 22 Z',
    anchor: [12, 12],
    scale: 0.85,
  },

  // ── Vehículos pesados ──────────────────────────────────────
  {
    value: 'bus',
    label: 'Autobús',
    path: 'M 4 3 L 20 3 L 22 9 L 22 21 L 2 21 L 2 9 Z M 4 9 L 20 9',
    anchor: [12, 12],
    scale: 1.0,
  },
  {
    value: 'trolleybus',
    label: 'Trolebús',
    path: 'M 4 3 L 20 3 L 22 9 L 22 21 L 2 21 L 2 9 Z M 4 9 L 20 9',
    anchor: [12, 12],
  },
  {
    value: 'truck',
    label: 'Camión',
    path: 'M 3 6 L 16 6 L 16 21 L 3 21 Z M 16 10 L 21 13 L 21 21 L 16 21 Z',
    anchor: [12, 13],
    scale: 0.9,
  },
  {
    value: 'trailer',
    label: 'Remolque',
    path: 'M 3 6 L 21 6 L 21 21 L 3 21 Z M 3 12 L 21 12',
    anchor: [12, 13],
    scale: 0.9,
  },
  {
    value: 'tractor',
    label: 'Tractor',
    path: 'M 8 5 L 16 5 L 18 11 L 18 19 L 6 19 L 6 11 Z M 2 12 L 6 12 M 18 12 L 22 12',
    anchor: [12, 12],
  },
  {
    value: 'crane',
    label: 'Grúa',
    path: 'M 12 2 L 21 21 L 12 16 L 3 21 Z',
    anchor: [12, 12],
    scale: 1.3,
  },

  // ── Transporte ferroviario ─────────────────────────────────
  {
    value: 'train',
    label: 'Tren',
    path: 'M 7 2 L 17 2 L 19 7 L 19 22 L 5 22 L 5 7 Z M 7 9 L 17 9 M 7 15 L 17 15',
    anchor: [12, 12],
    scale: 0.85,
  },
  {
    value: 'tram',
    label: 'Tranvía',
    path: 'M 8 2 L 16 2 L 18 7 L 18 22 L 6 22 L 6 7 Z M 8 10 L 16 10',
    anchor: [12, 12],
    scale: 0.85,
  },

  // ── Embarcaciones ──────────────────────────────────────────
  {
    value: 'boat',
    label: 'Lancha / Barco',
    path: 'M 12 3 L 20 13 L 20 21 L 4 21 L 4 13 Z',
    anchor: [12, 13],
  },
  {
    value: 'ship',
    label: 'Buque',
    path: 'M 12 2 L 21 15 L 21 22 L 3 22 L 3 15 Z',
    anchor: [12, 13],
    scale: 1.2,
  },

  // ── Aéreos ────────────────────────────────────────────────
  {
    value: 'plane',
    label: 'Avión',
    path: 'M 12 2 L 14 9 L 22 12 L 14 14 L 14 20 L 12 18 L 10 20 L 10 14 L 2 12 L 10 9 Z',
    anchor: [12, 12],
    scale: 0.95,
  },
  {
    value: 'helicopter',
    label: 'Helicóptero',
    path: 'M 2 10 L 22 10 M 12 4 L 12 20 M 8 16 L 16 16',
    anchor: [12, 12],
    scale: 0.9,
  },

  // ── Otros ─────────────────────────────────────────────────
  {
    value: 'person',
    label: 'Persona',
    path: 'M 12 3 C 9.8 3 8 4.8 8 7 C 8 9.2 9.8 11 12 11 C 14.2 11 16 9.2 16 7 C 16 4.8 14.2 3 12 3 Z M 4 21 C 4 17 7.6 14 12 14 C 16.4 14 20 17 20 21 Z',
    anchor: [12, 12],
  },
  {
    value: 'animal',
    label: 'Animal',
    path: 'M 12 5 L 19 12 L 12 22 L 5 12 Z',
    anchor: [12, 13],
  },
];

// ──────────────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────────────

/** Devuelve la definición de categoría; usa 'default' como fallback. */
export function getCategoryDef(category?: string) {
  return (
    VEHICLE_CATEGORIES.find(c => c.value === category) ||
    VEHICLE_CATEGORIES.find(c => c.value === 'default')!
  );
}

/** Calcula el color del marcador según el estado del dispositivo y su velocidad. */
export function getMarkerColor(status: string, speed: number): string {
  if (status !== 'online') return STATUS_COLORS.offline;
  return speed > 0.5 ? STATUS_COLORS.moving : STATUS_COLORS.online;
}

/**
 * Retorna un objeto google.maps.Symbol listo para usar como ícono de marcador.
 * @param category  Valor de TraccarDevice.category (ej: 'motorcycle')
 * @param status    Estado del dispositivo ('online' | 'offline' | 'unknown')
 * @param speed     Velocidad en nudos (se convierte internamente)
 * @param course    Rumbo en grados (0=Norte, 90=Este...)
 */
export function getMarkerIcon(
  category: string | undefined,
  status: string,
  speed: number,
  course: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  googleMaps: typeof google.maps,
): google.maps.Symbol {
  const def = getCategoryDef(category);
  const color = getMarkerColor(status, speed);

  return {
    path: def.path,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeWeight: 2,
    scale: def.scale ?? 1.2,
    anchor: new googleMaps.Point(def.anchor[0], def.anchor[1]),
    rotation: course || 0,
  };
}
