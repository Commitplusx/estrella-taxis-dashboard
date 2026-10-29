import test from 'node:test';
import assert from 'node:assert/strict';
import { TaxiCoverageCache, loadCachedTaxiCoverage, type CoverageCacheScope, type CoverageStorage } from '../src/lib/taxiCoverageCache.ts';
import { channelPhone, splitChannelPhone, validChannelPhone } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/channelPhone.ts';
import type { AdminZone } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/adminContracts.ts';
const version = '1:11111111-1111-4111-8111-111111111111';
const scope: CoverageCacheScope = { project: 'stellar-test', actorId: 42, tenantId: '11111111-1111-4111-8111-111111111111', waba: '+529630000001', source: 'base', version };
const zones: AdminZone[] = [{ cell: '8a69a518a0c7fff', label: 'Zona sintética', cents: 4500, source: 'base', assigned: true }];
class MemoryStorage implements CoverageStorage {
  readonly entries = new Map<string, string>();
  get length() { return this.entries.size; }
  key(index: number) { return [...this.entries.keys()][index] ?? null; }
  getItem(key: string) { return this.entries.get(key) ?? null; }
  setItem(key: string, value: string) { this.entries.set(key, value); }
  removeItem(key: string) { this.entries.delete(key); }
}
test('coverage cache: a fresh instance after reload reuses all verified cells without a page request', async () => {
  const storage = new MemoryStorage();
  let calls = 0;
  const client = { zones: async () => { calls++; return { zones, hasMore: false, totalCells: 1, totalAreas: 1, version }; } };
  const first = await loadCachedTaxiCoverage(client, scope, new AbortController().signal, () => {}, new TaxiCoverageCache(storage));
  const restored = await loadCachedTaxiCoverage(client, scope, new AbortController().signal, () => {}, new TaxiCoverageCache(storage));
  assert.deepEqual(first, zones); assert.deepEqual(restored, zones); assert.equal(calls, 1);
});
test('coverage cache: actor, project, tenant, channel, source and server version are isolated', () => {
  const cache = new TaxiCoverageCache(new MemoryStorage()); cache.put(scope, zones);
  for (const changed of [{ actorId: 43 }, { project: 'other' }, { tenantId: '22222222-2222-4222-8222-222222222222' }, { waba: '+529630000002' }, { source: 'catalog' as const }]) {
    assert.equal(cache.get({ ...scope, ...changed }), null);
  }
  assert.deepEqual(cache.get(scope), zones);
  assert.equal(cache.get({ ...scope, version: '2:11111111-1111-4111-8111-111111111111' }), null);
});
test('coverage cache: partial, changed, aborted and failed downloads never become persisted coverage', async () => {
  for (const kind of ['partial', 'changed', 'aborted', 'failed']) {
    const storage = new MemoryStorage(), cache = new TaxiCoverageCache(storage), abort = new AbortController();
    await assert.rejects(loadCachedTaxiCoverage({ zones: async () => {
      if (kind === 'failed') throw new Error('upstream failure');
      if (kind === 'aborted') abort.abort();
      return { zones, hasMore: false, totalCells: kind === 'partial' ? 2 : 1, totalAreas: 1, version: kind === 'changed' ? '2:11111111-1111-4111-8111-111111111111' : version };
    } }, scope, abort.signal, () => {}, cache));
    assert.equal(storage.length, 0);
  }
});
test('coverage cache: invalid records and expired prices are removed, without claiming a cache hit', () => {
  const storage = new MemoryStorage(); let time = 100;
  const cache = new TaxiCoverageCache(storage, () => time, () => {}); cache.put(scope, zones);
  const storedKey = storage.key(0); assert.ok(storedKey);
  storage.setItem(storedKey, '{bad json'); assert.equal(cache.get(scope), null); assert.equal(storage.length, 0);
  cache.put(scope, zones); time += 8 * 86400000; assert.equal(cache.get(scope), null); assert.equal(storage.length, 0);
});
test('coverage cache: storage failure is bounded and does not fail the map download', async () => {
  let notices = 0;
  const storage: CoverageStorage = { length: 0, key: () => null, getItem: () => { throw new Error('blocked storage'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
  const result = await loadCachedTaxiCoverage({ zones: async () => ({ zones, hasMore: false, totalCells: 1, totalAreas: 1, version }) }, scope, new AbortController().signal, () => {}, new TaxiCoverageCache(storage, Date.now, () => notices++));
  assert.deepEqual(result, zones); assert.equal(notices, 1);
});
test('coverage cache: eviction is bounded and logout clears only map entries', () => {
  const storage = new MemoryStorage(); storage.setItem('unrelated-setting', 'keep');
  const cache = new TaxiCoverageCache(storage, () => 100);
  for (let index = 0; index < 9; index++) cache.put({ ...scope, actorId: index + 1 }, zones);
  assert.equal(storage.length, 7); cache.clear(); assert.deepEqual([...storage.entries], [['unrelated-setting', 'keep']]);
});
test('channel country code: a local number gets Mexico +52, and explicit provider legacy +521 is preserved', () => {
  assert.deepEqual(splitChannelPhone('+9630000001'), { country: 'MX', national: '9630000001', needsCountryCode: true });
  assert.equal(channelPhone('MX', '963 000 0001'), '+529630000001');
  assert.equal(channelPhone('MX', '19630000001'), '+5219630000001');
  assert.equal(validChannelPhone('+9630000001'), false);
  for (const value of ['+529630000001', '+5219630000001', '+12025550123', '+50223456789']) assert.equal(validChannelPhone(value), true);
  for (const value of ['9630000001', '+52963', 'https://9630000001', '+520963000000001']) assert.equal(validChannelPhone(value), false);
});
