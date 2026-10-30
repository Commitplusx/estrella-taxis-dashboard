import { createTaxiAdminHandler } from '../estrella-taxis-backend/supabase/functions/taxi-bot-admin/handler.ts';
import { FleetApi } from '../estrella-taxis-backend/supabase/functions/_shared/tracking/auth.ts';
import type { TrackingStore } from '../estrella-taxis-backend/supabase/functions/_shared/tracking/store.ts';
import { record } from '../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts';
const tenant = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222', waba = '+529630000001';
const driver = { deviceId: 7, name: 'Persona sintética', phone: '+529630000002', active: true, version: 'a'.repeat(32) };
// Imported PostgreSQL UUIDs are stable entity IDs; they need not be RFC request UUIDs.
const contact = { id: '33333333-3333-f333-0333-333333333333', unitNumber: '487', name: driver.name, phoneInput: driver.phone, phone: driver.phone, role: 'driver', deviceId: 7, receiving: true, version: 'b'.repeat(32) };
function assert(value: unknown, message = 'Expected assertion'): asserts value { if (!value) throw new Error(message); }
function fixture({ role = 'admin_empresa', result = 'saved' }: { role?: string; result?: string } = {}) {
  const writes: Record<string, unknown>[] = [];
  const deny = async (): Promise<never> => { throw new Error('Unexpected administration write'); };
  const store: TrackingStore = {
    writePackages: deny, writeCompanyPackage: deny, writeCompanyStatus: deny, writeScores: deny,
    read: async (table, query) => {
      if (table === 'perfiles') return [{ empresa_id: tenant, rol: role }];
      if (table === 'empresas') { assert(query.get('id') === 'eq.' + tenant); return [{ id: tenant, tipo_negocio: 'taxi' }]; }
      if (table === 'taxi_bot_channels') return [{ tenant_id: tenant, waba, name: 'Base sintética', city: 'Comitán', enabled: false, dispatcher: null, center_lat: 16.25, center_lng: -92.13, radius_km: 20, pricing_mode: 'h3_zone_max', base_cents: null, per_km_cents: null, revision: 0 }];
      throw new Error('Unexpected table ' + table);
    },
    rpc: async (name, args) => {
      assert(args.p_tenant === tenant);
      if (name === 'taxi_bot_driver_read') { assert(args.p_waba === waba); return { drivers: [driver], activeCount: 1, zoneCount: 2541 }; }
      if (name === 'taxi_bot_contacts_read') return { drivers: [driver], activeCount: 1, zoneCount: 2541, linkedUnitIds: [7, 99], contacts: [contact] };
      if (name === 'taxi_bot_contact_apply') {
        assert(args.p_actor === 42 && args.p_contact === contact.id && record(args.p_payload));
        assert(args.p_payload.name === contact.name && args.p_payload.deviceId === 7 && args.p_payload.receiveOffers === true);
        writes.push(args); return result === 'saved' ? { state: 'saved', contact } : { state: result };
      }
      assert(name === 'taxi_bot_driver_apply'); assert(args.p_actor === 42); assert(args.p_device === 7); writes.push(args);
      return result === 'saved' ? { state: result, driver } : { state: result };
    },
  };
  const fleet = new FleetApi('https://tracking.test/api', async input => {
    const url = new URL(String(input));
    if (url.pathname === '/api/session') return new Response(JSON.stringify({ id: 42, administrator: false }), { headers: { 'set-cookie': 'JSESSIONID=fixture-cookie-123' } });
    assert(url.pathname === '/api/devices'); return new Response(JSON.stringify([{ id: 7, name: 'Unidad sintética' }]));
  });
  const handler = createTaxiAdminHandler({ fleet, store, runtimeReady: true });
  const call = (body: Record<string, unknown>) => handler(new Request('https://edge.test', { method: 'POST', headers: { 'content-type': 'application/json', 'x-traccar-token': 'fixture-token-123' }, body: JSON.stringify(body) }));
  const command = { action: 'driver_save', tenantId: tenant, waba, requestId: crypto.randomUUID(), deviceId: 7, name: driver.name, phone: driver.phone, active: true, expected: null };
  const contactCommand = { action: 'contact_save', tenantId: tenant, waba, requestId: crypto.randomUUID(), contactId: contact.id,
    unitNumber: contact.unitNumber, name: contact.name, phoneInput: contact.phoneInput, role: contact.role, deviceId: 7, receiveOffers: true, expected: null, driverVersion: driver.version };
  return { call, command, contactCommand, writes };
}
Deno.test('contacts administration: lists only real visible GPS units owned by the selected base', async () => {
  const f = fixture(), response = await f.call({ action: 'contacts', tenantId: tenant, waba }); assert(response.status === 200);
  const body: unknown = await response.json(); assert(record(body) && Array.isArray(body.units) && body.units.length === 1 && Array.isArray(body.contacts) && body.contacts.length === 1); assert(f.writes.length === 0);
});
Deno.test('contacts administration: contact edits use the existing verified tenant and durable RPC', async () => {
  const f = fixture(); assert((await f.call(f.contactCommand)).status === 200); assert(f.writes.length === 1);
});
for (const [name, changed, expected] of [
  ['another base', { tenantId: other }, 403], ['unseen GPS', { deviceId: 99 }, 403], ['unknown role', { role: 'superadmin' }, 400],
  ['malformed phone', { phoneInput: 'not a phone' }, 400], ['missing review', { expected: '' }, 400], ['invalid contact id', { contactId: 'invalid' }, 400],
  ['non-RFC request id', { requestId: '33333333-3333-f333-0333-333333333333' }, 400],
] as const) Deno.test('contacts administration: rejects ' + name + ' before writing', async () => {
  const f = fixture(); assert((await f.call({ ...f.contactCommand, ...changed })).status === expected); assert(f.writes.length === 0);
});
Deno.test('contacts administration: an operator can read and cannot change owner/driver assignments', async () => {
  const f = fixture({ role: 'operador' }); assert((await f.call({ action: 'contacts', tenantId: tenant, waba })).status === 200);
  assert((await f.call(f.contactCommand)).status === 403); assert(f.writes.length === 0);
});
for (const result of ['role_not_driving', 'driver_busy', 'driver_changed', 'phone_conflict', 'revision_conflict']) Deno.test('contacts administration: returns explicit ' + result + ' without claiming a successful edit', async () => {
  const f = fixture({ result }); assert((await f.call(f.contactCommand)).status === 409);
});
Deno.test('driver administration: actual Traccar units and saved base mappings load together, without mutations', async () => {
  const f = fixture(), response = await f.call({ action: 'drivers', tenantId: tenant, waba }); assert(response.status === 200);
  const body: unknown = await response.json(); assert(record(body) && body.activeCount === 1 && body.zoneCount === 2541 && Array.isArray(body.units)); assert(f.writes.length === 0);
});
Deno.test('driver administration: a company admin saves only an actual allowed unit through the durable RPC', async () => {
  const f = fixture(); assert((await f.call(f.command)).status === 200); assert(f.writes.length === 1); assert(f.writes[0].p_phone === driver.phone);
});
for (const [name, changed, expected] of [
  ['another base', { tenantId: other }, 403], ['unseen unit', { deviceId: 99 }, 403],
  ['missing country', { phone: '+9630000002' }, 400], ['unversioned edit', { expected: '' }, 400],
  ['extra privilege', { admin: true }, 400], ['missing active flag', { active: null }, 400],
] as const) Deno.test('driver administration: rejects ' + name + ' before mutating', async () => {
  const f = fixture(); assert((await f.call({ ...f.command, ...changed })).status === expected); assert(f.writes.length === 0);
});
Deno.test('driver administration: operators can read the base and cannot register a conductor', async () => {
  const f = fixture({ role: 'operador' }); assert((await f.call({ action: 'drivers', tenantId: tenant, waba })).status === 200);
  assert((await f.call(f.command)).status === 403); assert(f.writes.length === 0);
});
for (const result of ['device_conflict', 'revision_conflict', 'phone_conflict', 'driver_busy', 'request_conflict']) Deno.test('driver administration: ' + result + ' is an actionable error, never a false success', async () => {
  const f = fixture({ result }), response = await f.call(f.command); assert(response.status === 409);
  const body: unknown = await response.json(); assert(record(body) && body.code === result && typeof body.error === 'string');
});
