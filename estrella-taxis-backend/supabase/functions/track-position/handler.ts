import { FleetApi } from '../_shared/tracking/auth.ts';
import { record, TrackingError } from '../_shared/tracking/contracts.ts';
import { requestJson, type Fetcher } from '../_shared/tracking/http.ts';
import type { TrackingStore } from '../_shared/tracking/store.ts';

const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SESSION_TTL_MS = 10 * 60 * 1000;
const SESSION_REFRESH_MARGIN_MS = 30 * 1000;
const POSITION_RESPONSE_LIMIT = 512 * 1024;
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, authorization, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '600',
  'Cache-Control': 'no-store, max-age=0',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
};

interface Trip {
  token: string;
  tenantId: string;
  waba: string;
  deviceId: number | null;
  taxiName: string | null;
  origin: string;
  destination: string;
  originLat: number | null;
  originLng: number | null;
  state: 'buscando_conductor' | 'en_camino' | 'completado' | 'cancelado' | 'cancelado_timeout';
  createdAt: string;
}

interface TaxiPosition {
  name: string;
  lat: number;
  lng: number;
  speedKmh: number | null;
  course: number | null;
  lastUpdate: string;
}

interface PositionCandidate extends TaxiPosition {
  timestamp: number;
}

export interface TrackPositionDependencies {
  store: Pick<TrackingStore, 'read'>;
  fleet: FleetApi;
  fetcher: Fetcher;
  email: string;
  password: string;
  now?: () => number;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: CORS_HEADERS });
}

function errorResponse(error: unknown): Response {
  if (error instanceof TrackingError) {
    const status = error.status >= 500 ? 503 : error.status;
    return jsonResponse({ error: 'No pudimos actualizar la ubicación. Intenta de nuevo en un momento.', code: error.code }, status);
  }
  return jsonResponse({ error: 'No pudimos actualizar la ubicación. Intenta de nuevo en un momento.', code: 'tracking_unavailable' }, 503);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function latitude(value: unknown): number | null {
  return finite(value) && value >= -90 && value <= 90 ? value : null;
}

function longitude(value: unknown): number | null {
  return finite(value) && value >= -180 && value <= 180 ? value : null;
}

function isTripState(value: unknown): value is Trip['state'] {
  return value === 'buscando_conductor' || value === 'en_camino' || value === 'completado' ||
    value === 'cancelado' || value === 'cancelado_timeout';
}

function optionalCoordinate(value: unknown, valid: (candidate: unknown) => number | null): number | null {
  if (value === null || value === undefined) return null;
  return valid(value);
}

function parseTrip(value: unknown, token: string): Trip | null {
  if (!record(value) || value.token !== token || value.bot_managed !== true ||
    typeof value.tenant_id !== 'string' || !value.tenant_id ||
    typeof value.bot_waba !== 'string' || !value.bot_waba ||
    typeof value.origen !== 'string' || value.origen.length > 500 ||
    typeof value.destino !== 'string' || value.destino.length > 500 ||
    typeof value.created_at !== 'string' || !Number.isFinite(Date.parse(value.created_at))) return null;

  if (!isTripState(value.estado)) return null;
  const deviceId = value.device_id === null || value.device_id === undefined ? null
    : typeof value.device_id === 'number' && Number.isSafeInteger(value.device_id) && value.device_id > 0 ? value.device_id : null;
  if (value.estado === 'en_camino' && deviceId === null) return null;

  return {
    token,
    tenantId: value.tenant_id,
    waba: value.bot_waba,
    deviceId,
    taxiName: typeof value.taxi_name === 'string' && value.taxi_name.trim() ? value.taxi_name.slice(0, 100) : null,
    origin: value.origen,
    destination: value.destino,
    originLat: optionalCoordinate(value.origen_lat, latitude),
    originLng: optionalCoordinate(value.origen_lng, longitude),
    state: value.estado,
    createdAt: value.created_at,
  };
}

function parsePosition(value: unknown, deviceId: number, name: string, now: number): TaxiPosition | null {
  if (!Array.isArray(value) || value.length > 500) throw new TrackingError(502, 'position_contract', 'El proveedor devolvió un formato de GPS no válido.');
  const candidates: PositionCandidate[] = [];
  for (const item of value) {
    if (!record(item) || item.deviceId !== deviceId) continue;
    const lat = latitude(item.latitude);
    const lng = longitude(item.longitude);
    const timeValue = typeof item.fixTime === 'string' ? item.fixTime : typeof item.deviceTime === 'string' ? item.deviceTime : null;
    const timestamp = timeValue ? Date.parse(timeValue) : Number.NaN;
    if (lat === null || lng === null || !timeValue || !Number.isFinite(timestamp) || timestamp > now + 60_000) continue;
    const speedKnots = finite(item.speed) && item.speed >= 0 && item.speed <= 200 ? item.speed : null;
    const heading = finite(item.course) && item.course >= 0 && item.course <= 360 ? item.course : null;
    candidates.push({
      name,
      lat,
      lng,
      speedKmh: speedKnots === null ? null : speedKnots * 1.852,
      course: heading,
      lastUpdate: new Date(timestamp).toISOString(),
      timestamp,
    });
  }
  candidates.sort((left, right) => right.timestamp - left.timestamp);
  const latest = candidates[0];
  if (!latest) return null;
  return {
    name: latest.name,
    lat: latest.lat,
    lng: latest.lng,
    speedKmh: latest.speedKmh,
    course: latest.course,
    lastUpdate: latest.lastUpdate,
  };
}

export function createTrackPositionHandler(dependencies: TrackPositionDependencies): (request: Request) => Promise<Response> {
  const now = dependencies.now ?? Date.now;
  let cachedCookie: string | null = null;
  let cookieExpiresAt = 0;
  let pendingLogin: Promise<string> | null = null;

  async function login(): Promise<string> {
    if (!dependencies.email || !dependencies.password) throw new TrackingError(503, 'tracking_unconfigured', 'El seguimiento no está disponible en este momento.');
    const result = await requestJson(dependencies.fetcher, `${dependencies.fleet.base}/session`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: dependencies.email, password: dependencies.password }),
    }, 10000, 4096);
    const cookie = result.response.headers.get('set-cookie')?.split(';')[0] ?? '';
    if (!/^JSESSIONID=[A-Za-z0-9._~-]{8,512}$/.test(cookie)) {
      throw new TrackingError(503, 'tracking_login_unavailable', 'El seguimiento no está disponible en este momento.');
    }
    cachedCookie = cookie;
    cookieExpiresAt = now() + SESSION_TTL_MS;
    return cookie;
  }

  async function sessionCookie(): Promise<string> {
    if (cachedCookie && cookieExpiresAt - now() > SESSION_REFRESH_MARGIN_MS) return cachedCookie;
    if (!pendingLogin) {
      pendingLogin = login().finally(() => { pendingLogin = null; });
    }
    const pending = pendingLogin;
    if (!pending) throw new TrackingError(503, 'tracking_login_unavailable', 'El seguimiento no está disponible en este momento.');
    return pending;
  }

  async function readPosition(trip: Trip, signal: AbortSignal): Promise<TaxiPosition | null> {
    if (trip.state !== 'en_camino' || trip.deviceId === null) return null;
    const path = `/positions?deviceId=${trip.deviceId}`;
    let cookie = await sessionCookie();
    let raw: unknown;
    try {
      raw = await dependencies.fleet.get(path, cookie, signal, POSITION_RESPONSE_LIMIT);
    } catch (error: unknown) {
      if (!(error instanceof TrackingError) || error.code !== 'session_expired') throw error;
      if (cachedCookie === cookie) { cachedCookie = null; cookieExpiresAt = 0; }
      cookie = await sessionCookie();
      raw = await dependencies.fleet.get(path, cookie, signal, POSITION_RESPONSE_LIMIT);
    }
    return parsePosition(raw, trip.deviceId, trip.taxiName ?? 'Tu taxi', now());
  }

  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== 'GET') return jsonResponse({ error: 'Método no permitido.', code: 'method_not_allowed' }, 405);
    if (request.signal.aborted) return jsonResponse({ error: 'La consulta fue cancelada.', code: 'request_cancelled' }, 499);

    try {
      const token = new URL(request.url).searchParams.get('token') ?? '';
      if (!TOKEN_PATTERN.test(token)) return jsonResponse({ error: 'El enlace de seguimiento no es válido.', code: 'invalid_token' }, 400);

      const rows = await dependencies.store.read('viajes', new URLSearchParams({
        select: 'token,tenant_id,bot_waba,bot_managed,device_id,taxi_name,origen,destino,origen_lat,origen_lng,estado,created_at',
        token: `eq.${token}`,
        bot_managed: 'eq.true',
        limit: '2',
      }));
      if (rows.length !== 1) return jsonResponse({ error: 'No encontramos este viaje. Revisa que el enlace esté completo.', code: 'trip_not_found' }, 404);
      const trip = parseTrip(rows[0], token);
      if (!trip) return jsonResponse({ error: 'El enlace no corresponde a un viaje disponible.', code: 'trip_unavailable' }, 404);

      const terminal = trip.state === 'completado' || trip.state === 'cancelado' || trip.state === 'cancelado_timeout';
      const taxi = terminal ? null : await readPosition(trip, request.signal);
      return jsonResponse({
        taxi,
        viaje: {
          origen: trip.origin,
          destino: trip.destination,
          origen_lat: trip.originLat,
          origen_lng: trip.originLng,
          estado: trip.state,
          createdAt: trip.createdAt,
        },
      });
    } catch (error: unknown) {
      if (error instanceof TrackingError && error.code === 'upstream_unavailable') {
        return jsonResponse({ error: 'No pudimos consultar el GPS. Intenta de nuevo en un momento.', code: error.code }, 503);
      }
      return errorResponse(error);
    }
  };
}
