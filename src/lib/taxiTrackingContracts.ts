export type PublicTaxiTripState = 'buscando_conductor' | 'en_camino' | 'completado' | 'cancelado' | 'cancelado_timeout';

export interface PublicTaxiPosition {
  name: string;
  lat: number;
  lng: number;
  speedKmh: number | null;
  course: number | null;
  lastUpdate: string;
}

export interface PublicTaxiTrip {
  origen: string;
  destino: string;
  origen_lat: number | null;
  origen_lng: number | null;
  estado: PublicTaxiTripState;
  createdAt: string;
}

export interface PublicTaxiTracking {
  taxi: PublicTaxiPosition | null;
  viaje: PublicTaxiTrip;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCoordinate(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isOptionalSpeed(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 400);
}

function isOptionalCourse(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 360);
}

function isTrackPosition(value: unknown): value is PublicTaxiPosition {
  return isRecord(value) && typeof value.name === 'string' && value.name.length <= 100 &&
    isCoordinate(value.lat, -90, 90) && isCoordinate(value.lng, -180, 180) &&
    isOptionalSpeed(value.speedKmh) && isOptionalCourse(value.course) && isValidTimestamp(value.lastUpdate);
}

function isOptionalCoordinate(value: unknown, minimum: number, maximum: number): value is number | null {
  return value === null || isCoordinate(value, minimum, maximum);
}

function isTripState(value: unknown): value is PublicTaxiTripState {
  return value === 'buscando_conductor' || value === 'en_camino' || value === 'completado' ||
    value === 'cancelado' || value === 'cancelado_timeout';
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function parseTaxi(value: unknown): PublicTaxiPosition | null {
  if (value === null) return null;
  if (!isTrackPosition(value)) {
    throw new TypeError('La respuesta de ubicación no tiene un formato válido.');
  }
  return {
    name: value.name,
    lat: value.lat,
    lng: value.lng,
    speedKmh: value.speedKmh,
    course: value.course,
    lastUpdate: value.lastUpdate,
  };
}

export function parsePublicTaxiTracking(value: unknown): PublicTaxiTracking {
  if (!isRecord(value) || !isRecord(value.viaje)) throw new TypeError('La respuesta de seguimiento no tiene un formato válido.');
  const trip = value.viaje;
  if (typeof trip.origen !== 'string' || trip.origen.length > 500 ||
    typeof trip.destino !== 'string' || trip.destino.length > 500 ||
    !isOptionalCoordinate(trip.origen_lat, -90, 90) || !isOptionalCoordinate(trip.origen_lng, -180, 180) ||
    !isTripState(trip.estado) || !isValidTimestamp(trip.createdAt)) {
    throw new TypeError('Los datos del viaje no tienen un formato válido.');
  }
  return {
    taxi: parseTaxi(value.taxi),
    viaje: {
      origen: trip.origen,
      destino: trip.destino,
      origen_lat: trip.origen_lat,
      origen_lng: trip.origen_lng,
      estado: trip.estado,
      createdAt: trip.createdAt,
    },
  };
}
