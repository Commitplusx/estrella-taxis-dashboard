import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const briefFlowSql = readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261031233000_taxi_brief_customer_flow.sql', import.meta.url), 'utf8');
const trackingSql = readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261101025802_taxi_customer_live_tracking.sql', import.meta.url), 'utf8');
const functionStart = briefFlowSql.indexOf('CREATE TABLE public.taxi_bot_message_budgets');
const functionEndMarker = 'END $$;';
const functionEnd = briefFlowSql.indexOf(functionEndMarker, briefFlowSql.indexOf('CREATE OR REPLACE FUNCTION public.taxi_bot_emit(')) + functionEndMarker.length;
if (functionStart < 0 || functionEnd <= functionStart) throw new Error('Could not locate the current outbox function in the source migration.');
const messageBudgetAndEmitSql = briefFlowSql.slice(functionStart, functionEnd);

const tenant = '11111111-1111-4111-8111-111111111111';
const otherTenant = '22222222-2222-4222-8222-222222222222';
const waba = '+529630000001';
const customer = '+529630000002';
const driver = '+529630000003';
const tripId = '123e4567-e89b-42d3-a456-426614174000';
const tripToken = '123e4567-e89b-42d3-a456-426614174001';

async function fixture(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE public.taxi_bot_channels(tenant_id uuid NOT NULL,waba text NOT NULL,PRIMARY KEY(tenant_id,waba));
    CREATE TABLE public.taxi_bot_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,waba text NOT NULL,destination text NOT NULL,body jsonb NOT NULL,dedupe_key text NOT NULL UNIQUE);
    CREATE TABLE public.viajes(id uuid PRIMARY KEY,token text NOT NULL,tenant_id uuid NOT NULL,bot_waba text NOT NULL,cliente_tel text NOT NULL,device_id integer,taxi_name text,bot_managed boolean NOT NULL,estado text NOT NULL,origen_lat double precision,origen_lng double precision);
    CREATE TABLE public.taxi_bot_offers(trip_id uuid NOT NULL,device_id integer NOT NULL,state text NOT NULL,driver_phone text NOT NULL);
    CREATE FUNCTION public.taxi_bot_customer_phone(value text)RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT '+'||regexp_replace(value,'\\D','','g')$$;`);
  await db.exec(messageBudgetAndEmitSql);
  await db.exec(trackingSql);
  await db.query('INSERT INTO public.taxi_bot_channels(tenant_id,waba)VALUES($1,$2)', [tenant, waba]);
  await db.query('INSERT INTO public.taxi_bot_channels(tenant_id,waba)VALUES($1,$2)', [otherTenant, waba]);
  await db.query("INSERT INTO public.viajes(id,token,tenant_id,bot_waba,cliente_tel,device_id,taxi_name,bot_managed,estado,origen_lat,origen_lng)VALUES($1,$2,$3,$4,$5,540,'OMAR 1134',true,'en_camino',16.23533,-92.12439)", [tripId, tripToken, tenant, waba, customer]);
  await db.query("INSERT INTO public.taxi_bot_offers(trip_id,device_id,state,driver_phone)VALUES($1,540,'accepted',$2)", [tripId, driver]);
  return db;
}

async function value(db: PGlite, sql: string, args: unknown[] = []): Promise<unknown> {
  const result = await db.query<Record<string, unknown>>(sql, args);
  return Object.values(result.rows[0] ?? {})[0];
}

test('the accepted customer receipt adds the current trip link exactly once and does not reveal fare or phone', async () => {
  const db = await fixture();
  try {
    await value(db, 'SELECT public.taxi_bot_emit($1,$2,$3,$4,$5)', [tenant, waba, customer, '🚕 La unidad aceptó tu viaje.', `trip-assigned:${tripId}`]);
    const body = String(await value(db, "SELECT body->>'text'FROM public.taxi_bot_outbox WHERE dedupe_key=$1", [`trip-assigned:${tripId}`]));
    assert.match(body, new RegExp(`https://stellar\\.estrella-eats\\.mx/track/${tripToken}`));
    assert.match(body, /ubicación en tiempo real/i);
    assert.doesNotMatch(body, /tarifa|precio|\+529630000002/i);
    await value(db, 'SELECT public.taxi_bot_emit($1,$2,$3,$4,$5)', [tenant, waba, customer, 'Texto duplicado', `trip-assigned:${tripId}`]);
    assert.equal(await value(db, "SELECT count(*)::integer FROM public.taxi_bot_outbox WHERE dedupe_key=$1", [`trip-assigned:${tripId}`]), 1);
  } finally {
    await db.close();
  }
});

test('tracking is withheld for a searching trip or a different customer', async () => {
  const db = await fixture();
  try {
    await db.query("UPDATE public.viajes SET estado='buscando_conductor'WHERE id=$1", [tripId]);
    await value(db, 'SELECT public.taxi_bot_emit($1,$2,$3,$4,$5)', [tenant, waba, customer, 'Solicitud registrada', `trip-assigned:${tripId}`]);
    const searching = String(await value(db, "SELECT body->>'text'FROM public.taxi_bot_outbox WHERE dedupe_key=$1", [`trip-assigned:${tripId}`]));
    assert.doesNotMatch(searching, /stellar\\.estrella-eats\\.mx\/track/);

    await db.query("UPDATE public.viajes SET estado='en_camino'WHERE id=$1", [tripId]);
    const wrongKey = '123e4567-e89b-42d3-a456-426614174002';
    await value(db, 'SELECT public.taxi_bot_emit($1,$2,$3,$4,$5)', [tenant, waba, '+529630000099', 'Otro cliente', `trip-assigned:${wrongKey}`]);
    assert.doesNotMatch(String(await value(db, "SELECT body->>'text'FROM public.taxi_bot_outbox WHERE dedupe_key=$1", [`trip-assigned:${wrongKey}`])), /stellar\\.estrella-eats\\.mx\/track/);
  } finally {
    await db.close();
  }
});

test('tracking links are withheld when the outbox tenant does not own the trip', async () => {
  const db = await fixture();
  try {
    await value(db, 'SELECT public.taxi_bot_emit($1,$2,$3,$4,$5)', [otherTenant, waba, customer, 'La unidad aceptó tu viaje.', `trip-assigned:${tripId}`]);
    const body = String(await value(db, "SELECT body->>'text'FROM public.taxi_bot_outbox WHERE dedupe_key=$1", [`trip-assigned:${tripId}`]));
    assert.doesNotMatch(body, /stellar\.estrella-eats\.mx\/track/);
  } finally {
    await db.close();
  }
});

test('the assigned driver receipt receives a pickup map link only for its accepted unit and WhatsApp', async () => {
  const db = await fixture();
  try {
    await value(db, 'SELECT public.taxi_bot_emit($1,$2,$3,$4,$5)', [tenant, waba, driver, '🚕 Viaje asignado a tu unidad.', `driver-assigned:${tripId}`]);
    const receipt = String(await value(db, "SELECT body->>'text'FROM public.taxi_bot_outbox WHERE dedupe_key=$1", [`driver-assigned:${tripId}`]));
    assert.match(receipt, /https:\/\/maps\.google\.com\/\?q=16\.235330,-92\.124390/);

    await value(db, 'SELECT public.taxi_bot_emit($1,$2,$3,$4,$5)', [tenant, waba, '+529630000099', '🚕 Viaje asignado a tu unidad.', `driver-assigned:${tripId}`]);
    assert.equal(await value(db, "SELECT count(*)::integer FROM public.taxi_bot_outbox WHERE dedupe_key=$1", [`driver-assigned:${tripId}`]), 1);
  } finally {
    await db.close();
  }
});
