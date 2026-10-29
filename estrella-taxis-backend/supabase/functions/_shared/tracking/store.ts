import { record, TrackingError } from './contracts.ts';
import { requestJson, type Fetcher } from './http.ts';
export interface TrackingStore {
  read(table: string, query: URLSearchParams): Promise<unknown[]>;
  writeScores(rows: readonly Record<string, unknown>[]): Promise<void>;
  rpc(name: string, params: Record<string, unknown>): Promise<unknown>;
}
export class RestTrackingStore implements TrackingStore {
  private readonly base: string;
  private readonly key: string;
  private readonly fetcher: Fetcher;
  constructor(base: string, key: string, fetcher: Fetcher = fetch) {
    const url = new URL(base);
    if (url.protocol !== 'https:' || !key) throw new Error('Tracking server configuration is incomplete.');
    this.base=base.replace(/\/$/,'');this.key=key;this.fetcher=fetcher;
  }
  private headers(): Record<string,string> { return { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' }; }
  async read(table: string, query: URLSearchParams): Promise<unknown[]> {
    const { data } = await requestJson(this.fetcher, `${this.base}/rest/v1/${table}?${query}`, { headers: this.headers() });
    if (!Array.isArray(data)) throw new TrackingError(502,'storage_contract','No pudimos leer los datos de tracking.');
    return data;
  }
  async writeScores(rows: readonly Record<string,unknown>[]): Promise<void> {
    if (!rows.length) return;
    await requestJson(this.fetcher, `${this.base}/rest/v1/driving_scores?on_conflict=device_id,score_date`, {
      method:'POST', headers: { ...this.headers(), Prefer:'resolution=merge-duplicates,return=representation' }, body:JSON.stringify(rows),
    });
  }
  async rpc(name: string, params: Record<string,unknown>): Promise<unknown> {
    const { data } = await requestJson(this.fetcher, `${this.base}/rest/v1/rpc/${name}`, { method:'POST', headers:this.headers(), body:JSON.stringify(params) }); return data;
  }
}
export async function claimOperation(store: TrackingStore, user: number, key: string, kind: string, hash: string): Promise<{ lease: string; replay: unknown | null; status: number }> {
  const result = await store.rpc('tracking_operation_begin', { p_user:user, p_key:key, p_kind:kind, p_fingerprint:hash });
  if (!record(result) || typeof result.state !== 'string') throw new TrackingError(503,'tracking_upgrade_required','Falta completar la actualización del servidor de tracking.');
  if (result.state === 'replay') return { lease:'', replay:result.result, status:typeof result.status === 'number' ? result.status : 200 };
  if (result.state === 'limited') throw new TrackingError(429,'rate_limited','Ya hay varias consultas en proceso. Espera un momento antes de pedir otra.');
  if (result.state === 'conflict' || result.state === 'uncertain') throw new TrackingError(409,'request_conflict','Esta solicitud ya cambió o quedó pendiente de revisión. Actualiza el reporte antes de iniciar otra.');
  if (result.state === 'running') throw new TrackingError(409,'request_running','Este análisis sigue en proceso. Vuelve a consultar en unos segundos.');
  if (result.state !== 'proceed' || typeof result.lease !== 'string') throw new TrackingError(503,'tracking_upgrade_required','No pudimos reservar el análisis en el servidor.');
  return { lease:result.lease, replay:null, status:200 };
}
export async function finishOperation(store: TrackingStore, user: number, key: string, lease: string, result: unknown, status = 200): Promise<void> {
  const saved = await store.rpc('tracking_operation_complete', { p_user:user, p_key:key, p_lease:lease, p_result:result, p_status:status });
  if (saved !== true) throw new TrackingError(409,'operation_changed','La consulta perdió su reserva. Revisa su estado antes de pedir otra.');
}
