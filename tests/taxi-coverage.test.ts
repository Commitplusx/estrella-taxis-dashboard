import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTaxiCoverage } from '../src/lib/taxiCoverage.ts';
import type { TaxiAdminClient } from '../src/lib/taxiAdminClient';
import { parseZones } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/adminContracts.ts';
import { record } from '../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts';

const raw: unknown = JSON.parse(readFileSync(new URL('../src/lib/fixtures/taxiH3Catalog.preview.json', import.meta.url), 'utf8'));
assert.ok(Array.isArray(raw));
const all = raw.flatMap((zone: unknown) => {
  assert.ok(record(zone));
  return parseZones({ zones: [{ ...zone, source: 'catalog', assigned: true }], totalCells: 1, totalAreas: 1, hasMore: false }).zones;
}).sort((a, b) => a.cell.localeCompare(b.cell));
const scope = { tenant: '11111111-1111-4111-8111-111111111111', waba: '+529630000001' };

test('the whole Pompeyo map loads all 2541 distinct cells, beyond the old 500-cell viewport ceiling', async () => {
  let calls = 0;
  const progress: number[] = [];
  const client: Pick<TaxiAdminClient, 'zones'> = {
    zones: async (tenant, waba, query, signal) => {
      assert.equal(tenant, scope.tenant);
      assert.equal(waba, scope.waba);
      assert.equal(query.source, 'base');
      assert.equal(query.search, undefined);
      assert.equal(query.cells, undefined);
      assert.ok(signal);
      calls++;
      const remaining = all.filter((zone) => !query.after || zone.cell > query.after);
      return { zones: remaining.slice(0, 100), hasMore: remaining.length > 100, totalCells: all.length, totalAreas: 94 };
    },
  };
  const actual = await loadTaxiCoverage(client, scope.tenant, scope.waba, 'base', new AbortController().signal, (loaded) => progress.push(loaded));
  assert.equal(actual.length, 2541);
  assert.deepEqual(actual, all);
  assert.equal(new Set(actual.map((zone) => zone.cell)).size, 2541);
  assert.equal(calls, 26);
  assert.equal(progress.at(-1), 2541);
});

test('a repeated cursor page fails instead of silently duplicating part of the city', async () => {
  let calls = 0;
  await assert.rejects(loadTaxiCoverage({ zones: async () => {
    calls++;
    return { zones: all.slice(0, 100), hasMore: true, totalCells: 2541, totalAreas: 94 };
  } }, scope.tenant, scope.waba, 'catalog', new AbortController().signal, () => {}), /se repitió/);
  assert.equal(calls, 2);
});

test('a partial final page or changing coverage total never reports a complete map', async () => {
  await assert.rejects(loadTaxiCoverage({ zones: async () => ({ zones: all.slice(0, 100), hasMore: false, totalCells: 2541, totalAreas: 94 }) }, scope.tenant, scope.waba, 'catalog', new AbortController().signal, () => {}), /Faltaron zonas/);
  let calls = 0;
  await assert.rejects(loadTaxiCoverage({ zones: async () => {
    calls++;
    return { zones: all.slice((calls - 1) * 100, calls * 100), hasMore: true, totalCells: calls === 1 ? 2541 : 2540, totalAreas: 94 };
  } }, scope.tenant, scope.waba, 'base', new AbortController().signal, () => {}), /cambiaron/);
});

test('switching base aborts the previous read before requesting another page', async () => {
  const abort = new AbortController();
  let calls = 0;
  await assert.rejects(loadTaxiCoverage({ zones: async () => {
    calls++;
    abort.abort();
    return { zones: all.slice(0, 100), hasMore: true, totalCells: 2541, totalAreas: 94 };
  } }, scope.tenant, scope.waba, 'base', abort.signal, () => {}), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('coverage reads stop at the declared size budget instead of an unbounded pagination loop', async () => {
  let calls = 0;
  await assert.rejects(loadTaxiCoverage({ zones: async () => {
    calls++;
    return { zones: [], hasMore: true, totalCells: 10001, totalAreas: 94 };
  } }, scope.tenant, scope.waba, 'base', new AbortController().signal, () => {}), /10,000/);
  assert.equal(calls, 1);
});
