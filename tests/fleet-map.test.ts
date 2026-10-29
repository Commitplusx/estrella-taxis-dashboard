import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fleetMarkerHtml, validFleetPoint } from '../src/lib/fleetMapPresentation.ts';
import { fleetMapQuote } from '../src/lib/fleetMapQuote.ts';
import type { TaxiAdminClient } from '../src/lib/taxiAdminClient.ts';
import type { AdminChannel, AdminContext } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/adminContracts.ts';

const origin = { lat: 16.25, lng: -92.13 }, destination = { lat: 16.26, lng: -92.14 };
function channel(tenantId: string, waba: string): AdminChannel {
  return { tenantId, waba, name: 'Base sintética', city: 'Comitán', enabled: true, dispatcher: null,
    centerLat: 16.25, centerLng: -92.13, radiusKm: 20, pricingMode: 'h3_zone_max', baseCents: null, perKmCents: null, revision: 1 };
}
function fixture(channels: AdminChannel[], result: { state: string; cents: number | null } = { state: 'priced', cents: 6500 }) {
  const calls: { tenantId: string; waba: string }[] = [];
  const context: AdminContext = { actorId: 42, tenants: [], channels, canConfigure: true, runtimeReady: false };
  const client: Pick<TaxiAdminClient, 'context' | 'quote'> = {
    context: async () => context,
    quote: async (tenantId, waba, start, end) => { calls.push({ tenantId, waba }); assert.deepEqual(start, origin); assert.deepEqual(end, destination); return result; },
  };
  return { client, calls };
}

test('map accepts zero on one axis and rejects invalid or empty GPS fixes', () => {
  for (const [lat, lng] of [[0, -92], [16, 0], [-90, 180], [90, -180]]) assert.equal(validFleetPoint(lat, lng), true);
  for (const [lat, lng] of [[0, 0], [NaN, 1], [16, Infinity], [91, -92], [16, -181]]) assert.equal(validFleetPoint(lat, lng), false);
});
test('vehicle labels cannot inject HTML and numeric rotation stays bounded', () => {
  const html = fleetMarkerHtml({ name: '<img src=x onerror="alert(1)">', status: 'online', speed: 0, course: -450 });
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('rotate(270deg)'));
  assert.ok(fleetMarkerHtml({ name: 'Taxi', status: 'offline', speed: 0, course: NaN }).includes('rotate(0deg)'));
});
test('dashboard quote uses only the selected base and the server cents', async () => {
  const f = fixture([channel('base-A', '+529630000001'), channel('base-B', '+529630000002')]);
  assert.match(await fleetMapQuote(f.client, 'base-B', origin, destination), /\$65\.00/);
  assert.deepEqual(f.calls, [{ tenantId: 'base-B', waba: '+529630000002' }]);
});
test('unselected or ambiguous channels never choose the first base', async () => {
  for (const channels of [[], [channel('base-A', '+529630000001'), channel('base-B', '+529630000002')], [channel('base-A', '+529630000001'), channel('base-A', '+529630000002')]]) {
    const f = fixture(channels);
    assert.match(await fleetMapQuote(f.client, null, origin, destination), /Selecciona/);
    assert.equal(f.calls.length, 0);
  }
});
test('missing selected base cannot quote against another base', async () => {
  const f = fixture([channel('base-A', '+529630000001')]);
  assert.match(await fleetMapQuote(f.client, 'base-B', origin, destination), /Selecciona/);
  assert.equal(f.calls.length, 0);
});
test('uncovered and unavailable trips never receive an invented minimum fare', async () => {
  for (const state of ['uncovered', 'outside_service_area', 'channel_unavailable', 'invalid_zone']) {
    const f = fixture([channel('base-A', '+529630000001')], { state, cents: null });
    const result = await fleetMapQuote(f.client, 'base-A', origin, destination);
    assert.ok(!result.includes('$'));
    assert.equal(f.calls.length, 1);
  }
});
test('authentication and pricing failures propagate instead of looking like a successful quote', async () => {
  const denied = new Error('Session expired');
  const f = fixture([channel('base-A', '+529630000001')]);
  await assert.rejects(fleetMapQuote({ ...f.client, context: async () => { throw denied; } }, 'base-A', origin, destination), denied);
  await assert.rejects(fleetMapQuote({ ...f.client, quote: async () => { throw denied; } }, 'base-A', origin, destination), denied);
});
