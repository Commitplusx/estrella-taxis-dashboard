import { positiveId, record, TrackingError } from '../../tracking/contracts.ts';
import type { TrackingStore } from '../../tracking/store.ts';
import { coord } from './contracts.ts';
import { TAXI_GPS_MAX_AGE_MS } from './dispatchPolicy.ts';
import { refreshTaxiGps, type GpsRefreshConfig } from './gpsRefresh.ts';
import type { Fetcher } from '../../tracking/http.ts';

export async function mobileTaxiPositions(store: TrackingStore, tenant: string): Promise<unknown[]> {
  const rows = await store.rpc('taxi_mobile_dispatch_positions', { p_tenant: tenant });
  if (!Array.isArray(rows) || rows.length > 500 || !rows.every(record)) throw new TrackingError(502, 'mobile_positions_invalid', 'No pudimos comprobar las ubicaciones de la APK.');
  return rows;
}
/** A phone replaces only absent or provably stale hardware. Invalid coordinates,
 * an invalid fix or an unverifiable clock cannot silently turn a unit free. */
export function combineTaxiPositions(hardware: readonly unknown[], mobile: readonly unknown[], now: number, mobileOnly = false): unknown[] {
  const physical = new Set<number>();
  for (const p of hardware) if (record(p) && positiveId(p.deviceId)) {
    const age = typeof p.fixTime === 'string' ? now - Date.parse(p.fixTime) : NaN;
    if (!Number.isFinite(age) || age <= TAXI_GPS_MAX_AGE_MS) physical.add(p.deviceId);
  }
  const replacements = mobile.filter(p => {
    if (!record(p) || !positiveId(p.deviceId) || physical.has(p.deviceId) || p.valid !== true || !coord(p.latitude, p.longitude) || typeof p.fixTime !== 'string' || !record(p.attributes) || p.attributes.taxiPositionSource !== 'mobile') return false;
    const age = now - Date.parse(p.fixTime), since = p.attributes.taxiStationarySinceMs;
    return age >= -30000 && age <= 120000 && typeof since === 'number' && Number.isFinite(since) && since <= Date.parse(p.fixTime);
  }).filter(record);
  const replaced = new Set(replacements.map(p => p.deviceId));
  if (mobileOnly) return replacements;
  return [...hardware.filter(p => !record(p) || !replaced.has(p.deviceId)), ...replacements];
}

/** An unavailable hardware refresh never authorizes hardware dispatch. Independent,
 * current phone reports may still serve units with no usable hardware report. */
export async function refreshDispatchSources(fetcher: Fetcher, config: GpsRefreshConfig | undefined, mobile: readonly unknown[], signal?: AbortSignal): Promise<boolean> {
  if (!config) return false;
  try { await refreshTaxiGps(fetcher, config, signal); return false; }
  catch (error: unknown) {
    if (signal?.aborted || config.secret.length < 32 || config.url !== 'https://taxis.estrella-eats.mx/taxi-gps-refresh' || !(error instanceof TrackingError) || error.code !== 'taxi_gps_refresh_unavailable' || combineTaxiPositions([], mobile, Date.now()).length === 0) throw error;
    console.warn(JSON.stringify({ event: 'taxi_dispatch_source_degraded', source: 'mobile_only' }));
    return true;
  }
}
