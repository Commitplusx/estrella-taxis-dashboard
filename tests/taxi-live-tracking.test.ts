import { FleetApi } from '../estrella-taxis-backend/supabase/functions/_shared/tracking/auth.ts';
import type { Fetcher } from '../estrella-taxis-backend/supabase/functions/_shared/tracking/http.ts';
import type { TrackingStore } from '../estrella-taxis-backend/supabase/functions/_shared/tracking/store.ts';
import { createTrackPositionHandler } from '../estrella-taxis-backend/supabase/functions/track-position/handler.ts';
import { parsePublicTaxiTracking } from '../src/lib/taxiTrackingContracts.ts';

const token = '123e4567-e89b-42d3-a456-426614174000';
const tenant = '11111111-1111-4111-8111-111111111111';
const baseTrip: Record<string, unknown> = {
  token,
  tenant_id: tenant,
  bot_waba: '+529630000001',
  bot_managed: true,
  device_id: 540,
  taxi_name: 'Unidad de prueba',
  origen: 'Punto de recogida',
  destino: 'Centro',
  origen_lat: 16.23533,
  origen_lng: -92.12439,
  estado: 'en_camino',
  created_at: '2026-10-31T18:00:00.000Z',
};
const now = Date.parse('2026-10-31T18:01:00.000Z');

interface TestAssert {
  ok(value: unknown, message?: string): void;
  equal<T>(actual: T, expected: T, message?: string): void;
  deepEqual(actual: unknown, expected: unknown, message?: string): void;
  match(actual: string, expected: RegExp, message?: string): void;
  throws(operation: () => unknown, message?: string): void;
}

const assert: TestAssert = {
  ok(value: unknown, message = 'Expected a truthy value.'): void {
    if (!value) throw new Error(message);
  },
  equal<T>(actual: T, expected: T, message = 'Values are not equal.'): void {
    if (!Object.is(actual, expected)) throw new Error(`${message} Expected ${String(expected)}, got ${String(actual)}.`);
  },
  deepEqual(actual: unknown, expected: unknown, message = 'Values are not deeply equal.'): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message} Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  },
  match(actual: string, expected: RegExp, message = 'String did not match.'): void {
    if (!expected.test(actual)) throw new Error(message);
  },
  throws(operation: () => unknown, message = 'Expected the operation to throw.'): void {
    try { operation(); } catch { return; }
    throw new Error(message);
  },
};

interface TestFixture {
  handler: (request: Request) => Promise<Response>;
  counts: { login: number; position: number; reads: number };
}

function fixture(trip: Record<string, unknown> | null = baseTrip, positionRows: unknown[] = [], expireFirstPosition = false): TestFixture {
  const counts = { login: 0, position: 0, reads: 0 };
  const fetcher: Fetcher = async input => {
    const url = new URL(String(input));
    if (url.pathname === '/api/session') {
      counts.login += 1;
      return new Response(JSON.stringify({ id: 7 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'JSESSIONID=fixture-cookie-123456; Path=/; HttpOnly' },
      });
    }
    if (url.pathname === '/api/positions') {
      counts.position += 1;
      assert.equal(url.searchParams.get('deviceId'), '540');
      if (expireFirstPosition && counts.position === 1) return new Response(null, { status: 401 });
      return Response.json(positionRows);
    }
    throw new Error('Unexpected provider route.');
  };
  const store: Pick<TrackingStore, 'read'> = {
    read: async (table, query) => {
      counts.reads += 1;
      assert.equal(table, 'viajes');
      assert.equal(query.get('token'), `eq.${token}`);
      assert.equal(query.get('bot_managed'), 'eq.true');
      assert.equal(query.get('limit'), '2');
      return trip === null ? [] : [trip];
    },
  };
  const fleet = new FleetApi('https://tracking.test/api', fetcher);
  return {
    counts,
    handler: createTrackPositionHandler({
      store,
      fleet,
      fetcher,
      email: 'tracking@example.invalid',
      password: 'fixture-password-only',
      now: () => now,
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Expected a JSON object.');
  return value;
}

async function invoke(handler: TestFixture['handler'], requestToken = token): Promise<{ response: Response; body: unknown }> {
  const response = await handler(new Request(`https://stellar.example/track-position?token=${encodeURIComponent(requestToken)}`));
  const body: unknown = await response.json();
  return { response, body };
}

Deno.test('public tracking returns only the assigned unit, converts Traccar knots, and reuses the short-lived login', async () => {
  const position = { deviceId: 540, latitude: 16.24, longitude: -92.12, speed: 10, course: 90, fixTime: '2026-10-31T18:00:58.000Z' };
  const test = fixture(baseTrip, [position]);
  const first = await invoke(test.handler);
  assert.equal(first.response.status, 200);
  const firstBody = expectRecord(first.body);
  const taxi = expectRecord(firstBody.taxi);
  assert.equal(taxi.lat, 16.24);
  assert.equal(taxi.speedKmh, 18.52);
  assert.equal(taxi.lastUpdate, '2026-10-31T18:00:58.000Z');
  const journey = expectRecord(firstBody.viaje);
  assert.equal(journey.estado, 'en_camino');
  const serialized = JSON.stringify(firstBody);
  assert.ok(!serialized.includes('cliente_tel'));
  assert.ok(!serialized.includes('tracking@example.invalid'));
  const second = await invoke(test.handler);
  assert.equal(second.response.status, 200);
  assert.deepEqual(test.counts, { login: 1, position: 2, reads: 2 });
});

Deno.test('public tracking ignores provider positions from any other unit and keeps the assigned trip route', async () => {
  const test = fixture(baseTrip, [{ deviceId: 541, latitude: 16.24, longitude: -92.12, speed: 10, course: 0, fixTime: '2026-10-31T18:00:58.000Z' }]);
  const result = await invoke(test.handler);
  assert.equal(result.response.status, 200);
  const body = expectRecord(result.body);
  assert.equal(body.taxi, null);
  const viaje = expectRecord(body.viaje);
  assert.equal(viaje.estado, 'en_camino');
  assert.equal(viaje.origen, 'Punto de recogida');
});

Deno.test('expired Traccar session is refreshed once, then tracking returns the latest position', async () => {
  const position = { deviceId: 540, latitude: 16.24, longitude: -92.12, speed: 0, course: 90, fixTime: '2026-10-31T18:00:58.000Z' };
  const test = fixture(baseTrip, [position], true);
  const result = await invoke(test.handler);
  assert.equal(result.response.status, 200);
  const body = expectRecord(result.body);
  assert.equal(expectRecord(body.taxi).lat, 16.24);
  assert.deepEqual(test.counts, { login: 2, position: 2, reads: 1 });
});

Deno.test('terminal trips stop querying GPS and never return a stale unit position', async () => {
  const completed = { ...baseTrip, estado: 'completado' };
  const test = fixture(completed, [{ deviceId: 540, latitude: 16.24, longitude: -92.12, speed: 10, course: 0, fixTime: '2026-10-31T18:00:58.000Z' }]);
  const result = await invoke(test.handler);
  assert.equal(result.response.status, 200);
  const body = expectRecord(result.body);
  assert.equal(body.taxi, null);
  assert.deepEqual(test.counts, { login: 0, position: 0, reads: 1 });
});

Deno.test('invalid and unknown tokens fail closed without leaking provider or client data', async () => {
  const test = fixture(null);
  const invalid = await invoke(test.handler, 'not-a-token');
  assert.equal(invalid.response.status, 400);
  assert.deepEqual(test.counts, { login: 0, position: 0, reads: 0 });
  const missing = await invoke(test.handler);
  assert.equal(missing.response.status, 404);
  const body = expectRecord(missing.body);
  assert.equal(body.error, 'No encontramos este viaje. Revisa que el enlace esté completo.');
  assert.ok(!JSON.stringify(missing.body).includes('tracking@example.invalid'));
});

Deno.test('cancelled trips return their state but no GPS', async () => {
  const test = fixture({ ...baseTrip, estado: 'cancelado_timeout', device_id: null }, []);
  const result = await invoke(test.handler);
  assert.equal(result.response.status, 200);
  const body = expectRecord(result.body);
  assert.equal(body.taxi, null);
  const viaje = expectRecord(body.viaje);
  assert.equal(viaje.estado, 'cancelado_timeout');
  assert.equal(test.counts.login, 0);
});

Deno.test('tracking replies with safe CORS headers and rejects non-GET requests', async () => {
  const test = fixture();
  const options = await test.handler(new Request('https://stellar.example/track-position', { method: 'OPTIONS' }));
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS');
  const post = await test.handler(new Request('https://stellar.example/track-position', { method: 'POST' }));
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('Cache-Control'), 'no-store, max-age=0');
});

Deno.test('browser contract rejects malformed coordinates and preserves a missing GPS state', () => {
  const valid = parsePublicTaxiTracking({
    taxi: null,
    viaje: { origen: 'Recogida', destino: 'Centro', origen_lat: 16.2, origen_lng: -92.1, estado: 'en_camino', createdAt: '2026-10-31T18:00:00Z' },
  });
  assert.equal(valid.taxi, null);
  assert.equal(valid.viaje.estado, 'en_camino');
  assert.throws(() => parsePublicTaxiTracking({
    taxi: { name: 'Taxi', deviceId: 540, lat: 999, lng: -92.1, speedKmh: 20, course: 0, lastUpdate: '2026-10-31T18:00:00Z' },
    viaje: { origen: 'Recogida', destino: 'Centro', origen_lat: 16.2, origen_lng: -92.1, estado: 'en_camino', createdAt: '2026-10-31T18:00:00Z' },
  }));
});
