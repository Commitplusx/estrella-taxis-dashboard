import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const migration = readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261101140000_taxi_driver_mobile_shifts.sql', import.meta.url), 'utf8');
const setupSql = readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261029193220_taxi_bot_driver_setup.sql', import.meta.url), 'utf8');
const fleetSql = readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261030134513_taxi_base_fleet.sql', import.meta.url), 'utf8');
const extract = (sql: string, start: string) => { const from = sql.indexOf(start), to = sql.indexOf('$$;', from); if (from < 0 || to < from) throw new Error('Fixture source changed'); return sql.slice(from, to + 3); };
const tenant = '11111111-1111-4111-8111-111111111111', foreign = '22222222-2222-4222-8222-222222222222';
const person = '33333333-3333-4333-8333-333333333333';
async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE empresas(id uuid PRIMARY KEY,activo boolean,tipo_negocio text);
    CREATE TABLE perfiles(traccar_user_id integer,empresa_id uuid,rol text);
    CREATE TABLE taxi_base_units(tenant_id uuid,device_id integer,name text,PRIMARY KEY(tenant_id,device_id));
    CREATE TABLE taxi_base_contacts(id uuid,tenant_id uuid,device_id integer,traccar_user_id integer,role text,phone text,name text,unit_number text,PRIMARY KEY(tenant_id,id));
    CREATE TABLE taxi_unit_drivers(tenant_id uuid,device_id integer,contact_id uuid);
    CREATE TABLE taxi_account_operations(contact_id uuid,activated boolean);
    CREATE TABLE conductores(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,device_id integer UNIQUE,nombre text,telefono_whatsapp text,activo boolean);
    CREATE TABLE taxi_bot_driver_operations(actor bigint,request_id uuid,command jsonb,response jsonb,PRIMARY KEY(actor,request_id));
    CREATE TABLE viajes(device_id integer,estado text);
    CREATE TABLE taxi_bot_offers(tenant_id uuid,device_id integer,state text,expires_at timestamptz);
    CREATE FUNCTION taxi_bot_customer_phone(v text)RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT v$$;
    CREATE FUNCTION taxi_bot_contact_record(c taxi_base_contacts)RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT to_jsonb(c)$$;`);
  await db.exec(extract(setupSql, 'CREATE FUNCTION public.taxi_bot_driver_record('));
  await db.exec(extract(fleetSql, 'CREATE OR REPLACE FUNCTION public.taxi_bot_driver_apply('));
  await db.exec(migration);
  await db.query(`INSERT INTO empresas VALUES($1,true,'taxi'),($2,true,'taxi');`, [tenant, foreign]);
  await db.query(`INSERT INTO taxi_base_units VALUES($1,1,'Phone taxi'),($1,2,'Cover taxi'),($2,9,'Foreign taxi')`, [tenant, foreign]);
  await db.query(`INSERT INTO taxi_base_contacts VALUES($1,$2,1,81,'driver','+529630000081','Synthetic driver','1')`, [person, tenant]);
  await db.query(`INSERT INTO perfiles VALUES(81,$1,'driver')`, [tenant]);
  const scalar = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, params)).rows[0]?.result;
  const version = () => scalar('SELECT public.taxi_bot_driver_record(d)->>\'version\' AS result FROM conductores d WHERE device_id=1') as Promise<string>;
  const shift = (active: boolean, expected: string | null, device = 1, request = crypto.randomUUID()) => scalar('SELECT public.taxi_driver_shift_apply(81,$1,$2,$3,$4) AS result', [request, device, active, expected]);
  const locationVersion = () => scalar('SELECT epoch AS result FROM taxi_driver_location_epochs WHERE device_id=1') as Promise<string>;
  const write = async (patch: { version?: string; device?: number; lat?: number; accuracy?: number; seconds?: number; mocked?: boolean } = {}) => scalar(`SELECT public.taxi_mobile_position_write(81,$1,$2,$3,-92.13,$4,0,NULL,clock_timestamp()+($5::text||' seconds')::interval,$6) AS result`, [patch.device ?? 1, patch.version ?? await locationVersion(), patch.lat ?? 16.25, patch.accuracy ?? 10, patch.seconds ?? 0, patch.mocked ?? false]);
  return { db, scalar, version, locationVersion, shift, write };
}
Deno.test('driver can start its authorized shift, replay once, and stop without changing another unit', async () => {
  const f = await fixture(); try {
    const id = crypto.randomUUID(), start = await f.shift(true, null, 1, id);
    assert.equal((start as { state: string }).state, 'saved'); assert.deepEqual(await f.shift(true, null, 1, id), start);
    assert.equal((await f.shift(false, null, 1, id) as { state: string }).state, 'request_conflict');
    assert.equal((await f.shift(false, await f.version()) as { state: string }).state, 'saved');
    assert.equal(await f.scalar('SELECT count(*)::int AS result FROM conductores WHERE activo'), 0);
    await assert.rejects(f.shift(true, null, 9));
  } finally { await f.db.close(); }
});
Deno.test('shift rejects another active driver, current offers and accepted trips, including stale revisions', async () => {
  const f = await fixture(); try {
    await f.shift(true, null); const v = await f.version();
    await f.db.exec(`INSERT INTO taxi_bot_offers VALUES('${tenant}',1,'offered',clock_timestamp()+interval '3 minutes')`);
    assert.equal((await f.shift(false, v) as { state: string }).state, 'driver_busy');
    await f.db.exec(`DELETE FROM taxi_bot_offers; INSERT INTO viajes VALUES(1,'en_camino')`);
    assert.equal((await f.shift(false, v) as { state: string }).state, 'driver_busy');
    await f.db.exec(`DELETE FROM viajes; UPDATE conductores SET telefono_whatsapp='+529630000082'`);
    assert.equal((await f.shift(true, v) as { state: string }).state, 'revision_conflict');
    assert.equal((await f.shift(true, await f.version()) as { state: string }).state, 'other_driver_active');
  } finally { await f.db.close(); }
});
Deno.test('fresh mobile location requires current shift; old, mocked, inaccurate and replayed samples cannot refresh it', async () => {
  const f = await fixture(); try {
    assert.equal((await f.write({ version: 'a'.repeat(32) }) as { state: string }).state, 'shift_changed');
    await f.shift(true, null);
    const oldLocationVersion = await f.locationVersion();
    for (const patch of [{ seconds: -91 }, { seconds: 31 }, { accuracy: 101 }, { mocked: true }, { lat: 91 }]) assert.equal((await f.write(patch) as { state: string }).state, 'invalid_position');
    assert.equal((await f.write() as { state: string }).state, 'saved');
    assert.equal((await f.write({ seconds: -1 }) as { state: string }).state, 'older_position');
    assert.equal((await f.write({ seconds: 1 }) as { state: string }).state, 'rate_limited');
    assert.equal(await f.scalar('SELECT jsonb_array_length(taxi_mobile_dispatch_positions($1)) AS result', [tenant]), 1);
    assert.equal(await f.scalar('SELECT jsonb_array_length(taxi_mobile_dispatch_positions($1)) AS result', [foreign]), 0);
    await f.db.exec(`UPDATE taxi_mobile_positions SET recorded_at=clock_timestamp()-interval '121 seconds'`);
    assert.equal(await f.scalar('SELECT jsonb_array_length(taxi_mobile_dispatch_positions($1)) AS result', [tenant]), 0);
    await f.shift(false, await f.version());
    assert.equal(await f.scalar('SELECT count(*)::int AS result FROM taxi_mobile_positions'), 0);
    await f.shift(true, await f.version());
    assert.notEqual(await f.locationVersion(), oldLocationVersion);
    assert.equal((await f.write({version:oldLocationVersion}) as { state: string }).state, 'shift_changed');
  } finally { await f.db.close(); }
});
Deno.test('GPS jitter preserves the 30 minute stationary clock; movement and a linked cover unit remain deliberate', async () => {
  const f = await fixture(); try {
    await f.shift(true, null); await f.write();
    await f.db.exec(`UPDATE taxi_mobile_positions SET stationary_since=clock_timestamp()-interval '31 minutes', recorded_at=clock_timestamp()-interval '20 seconds',received_at=clock_timestamp()-interval '20 seconds'`);
    await f.write({ lat: 16.25001 });
    assert.equal(await f.scalar(`SELECT stationary_since<clock_timestamp()-interval '30 minutes' AS result FROM taxi_mobile_positions`), true);
    await f.db.exec(`UPDATE taxi_mobile_positions SET recorded_at=clock_timestamp()-interval '20 seconds',received_at=clock_timestamp()-interval '20 seconds'`);
    await f.write({ lat: 16.26 });
    assert.equal(await f.scalar(`SELECT stationary_since>clock_timestamp()-interval '1 minute' AS result FROM taxi_mobile_positions`), true);
    await f.shift(false, await f.version());
    await f.db.query('INSERT INTO taxi_unit_drivers VALUES($1,2,$2)', [tenant, person]);
    assert.equal((await f.shift(true, null, 2) as { state: string }).state, 'saved');
    assert.equal((await f.shift(true, await f.version(), 1) as { state: string }).state, 'phone_conflict');
    await f.db.exec(`UPDATE perfiles SET empresa_id='${foreign}'`);
    await assert.rejects(f.write({ device: 2, version: 'a'.repeat(32) }));
    assert.equal(await f.scalar("SELECT has_function_privilege('authenticated','taxi_driver_shift_apply(integer,uuid,integer,boolean,text)','EXECUTE') AS result"), false);
  } finally { await f.db.close(); }
});
