import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const bootstrap = readFileSync(new URL('../deployment/stellar/supabase/migrations/20261029142013_stellar_independent_bootstrap.sql', import.meta.url), 'utf8');
const names = ['20261027190000_tracking_ai_integrity.sql','20261027220000_taxi_bot_transactions.sql','20261027223402_taxi_bot_h3_pricing.sql','20261028145826_taxi_bot_admin_zones.sql','20261028160342_taxi_bot_trace_state_quality.sql'];
test('Stellar fresh database supports the complete taxi protocol without restaurant tables or public writes', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
    await db.exec(bootstrap);
    for (const name of names) await db.exec(readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/' + name, import.meta.url), 'utf8'));
    await db.exec(readFileSync(new URL('../deployment/stellar/supabase/migrations/20261029142807_stellar_private_runtime.sql', import.meta.url), 'utf8'));
    await db.exec(readFileSync(new URL('../deployment/stellar/supabase/migrations/20261029143500_stellar_relation_indexes.sql', import.meta.url), 'utf8'));
    await db.exec(readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261029165842_taxi_customer_access.sql', import.meta.url), 'utf8'));
    const missing = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN('pedidos','catalogos','promociones','ruta_envios')");
    assert.equal(missing.rows[0].count, 0);
    const privateTables = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND NOT relrowsecurity");
    assert.equal(privateTables.rows[0].count, 0);
    await db.exec('SET ROLE anon');
    await assert.rejects(db.exec('SELECT * FROM public.empresas'), /permission denied/);
    await assert.rejects(db.exec('SELECT * FROM public.conductores'), /permission denied/);
    await assert.rejects(db.exec('SELECT * FROM public.viajes'), /permission denied/);
    await assert.rejects(db.exec('SELECT public.taxi_bot_pending()'), /permission denied/);
    await assert.rejects(db.exec("SELECT public.taxi_bot_owns_tenant('11111111-1111-4111-8111-111111111111')"), /permission denied/);
    await db.exec('RESET ROLE');
    const triggers = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM pg_trigger WHERE tgrelid='public.webhook_queue'::regclass AND NOT tgisinternal");
    assert.equal(triggers.rows[0].count, 0);
    await assert.rejects(db.exec(bootstrap), /stellar_bootstrap_requires_empty_project/);
    await db.exec('ROLLBACK');
  } finally { await db.close(); }
});
