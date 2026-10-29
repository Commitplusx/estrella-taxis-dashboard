import { parseZones, type AdminZone } from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/adminContracts.ts';
import { record } from '../../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts';
import { loadTaxiCoverage } from './taxiCoverage.ts';
import type { TaxiAdminClient } from './taxiAdminClient';

export interface CoverageCacheScope {
  project: string;
  actorId: number;
  tenantId: string;
  waba: string;
  source: 'base' | 'catalog';
  version: string;
}
export interface CoverageStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
const prefix = 'stellar-h3-coverage:v1:';
const maxEntryChars = 1024 * 1024;
const maxTotalChars = 1536 * 1024;
const maxAge = 7 * 86400000;

function key(scope: CoverageCacheScope): string {
  return prefix + JSON.stringify([scope.project, scope.actorId, scope.tenantId, scope.waba, scope.source]);
}
function validatedZones(value: unknown): AdminZone[] {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('Invalid cached coverage size');
  const zones: AdminZone[] = [];
  for (let start = 0; start < value.length; start += 500) {
    zones.push(...parseZones({ zones: value.slice(start, start + 500), hasMore: false, totalCells: value.length, totalAreas: 0 }).zones);
  }
  for (let index = 1; index < zones.length; index++) {
    if (zones[index].cell <= zones[index - 1].cell) throw new Error('Invalid cached coverage order');
  }
  return zones;
}

/** Only complete, versioned coverage is persisted. Authentication precedes every read. */
export class TaxiCoverageCache {
  private reported = false;
  private readonly storage: CoverageStorage | null;
  private readonly now: () => number;
  private readonly report: () => void;
  constructor(storage: CoverageStorage | null, now: () => number = Date.now,
    report: () => void = () => console.warn('coverage_cache_unavailable')) {
    this.storage = storage; this.now = now; this.report = report;
  }

  private unavailable(): void {
    if (!this.reported) { this.reported = true; this.report(); }
  }
  get(scope: CoverageCacheScope): AdminZone[] | null {
    if (!this.storage) return null;
    const cacheKey = key(scope);
    try {
      const raw = this.storage.getItem(cacheKey);
      if (!raw) return null;
      if (raw.length > maxEntryChars) throw new Error('Oversize cache entry');
      const entry: unknown = JSON.parse(raw);
      if (!record(entry) || entry.schema !== 1 || entry.version !== scope.version || typeof entry.savedAt !== 'number' ||
        !Number.isFinite(entry.savedAt) || entry.savedAt > this.now() || this.now() - entry.savedAt > maxAge) {
        this.storage.removeItem(cacheKey);
        return null;
      }
      return validatedZones(entry.zones);
    } catch {
      try { this.storage.removeItem(cacheKey); } catch { this.unavailable(); }
      this.unavailable();
      return null;
    }
  }
  put(scope: CoverageCacheScope, zones: readonly AdminZone[]): void {
    if (!this.storage) return;
    try {
      const complete = validatedZones(zones);
      const raw = JSON.stringify({ schema: 1, version: scope.version, savedAt: this.now(), zones: complete });
      if (raw.length > maxEntryChars) { this.unavailable(); return; }
      const cacheKey = key(scope);
      const entries: { key: string; size: number; savedAt: number }[] = [];
      for (let index = 0; index < this.storage.length; index++) {
        const candidate = this.storage.key(index);
        if (!candidate?.startsWith(prefix) || candidate === cacheKey) continue;
        const content = this.storage.getItem(candidate) ?? '';
        let savedAt = 0;
        try { const parsed: unknown = JSON.parse(content); if (record(parsed) && typeof parsed.savedAt === 'number' && Number.isFinite(parsed.savedAt)) savedAt = parsed.savedAt; } catch { /* Evict invalid entries first. */ }
        entries.push({ key: candidate, size: content.length, savedAt });
      }
      entries.sort((a, b) => a.savedAt - b.savedAt);
      let size = entries.reduce((sum, entry) => sum + entry.size, raw.length);
      while (entries.length >= 6 || size > maxTotalChars) {
        const oldest = entries.shift();
        if (!oldest) break;
        this.storage.removeItem(oldest.key);
        size -= oldest.size;
      }
      this.storage.setItem(cacheKey, raw);
    } catch { this.unavailable(); }
  }
  clear(): void {
    if (!this.storage) return;
    try {
      const keys: string[] = [];
      for (let index = 0; index < this.storage.length; index++) {
        const candidate = this.storage.key(index);
        if (candidate?.startsWith(prefix)) keys.push(candidate);
      }
      for (const candidate of keys) this.storage.removeItem(candidate);
    } catch { this.unavailable(); }
  }
}

function browserStorage(): CoverageStorage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}
let browserCache: TaxiCoverageCache | undefined;
export function taxiCoverageCache(): TaxiCoverageCache {
  return browserCache ??= new TaxiCoverageCache(browserStorage());
}
export async function loadCachedTaxiCoverage(client: Pick<TaxiAdminClient, 'zones'>, scope: CoverageCacheScope,
  signal: AbortSignal, onProgress: (loaded: number, total: number) => void, cache = taxiCoverageCache()): Promise<AdminZone[]> {
  signal.throwIfAborted();
  const saved = cache.get(scope);
  signal.throwIfAborted();
  if (saved) return saved;
  const zones = await loadTaxiCoverage(client, scope.tenantId, scope.waba, scope.source, signal, onProgress, scope.version);
  signal.throwIfAborted();
  cache.put(scope, zones);
  return zones;
}
