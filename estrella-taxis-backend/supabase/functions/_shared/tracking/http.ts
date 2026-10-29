import { TrackingError } from './contracts.ts';
export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-traccar-token, x-traccar-session, x-tracking-job-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '600',
  'Cache-Control': 'no-store',
};
export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' } });
}
export function errorResponse(error: unknown): Response {
  if (error instanceof TrackingError) return json({ error: error.message, code: error.code }, error.status);
  return json({ error: 'No pudimos completar la consulta. Intenta de nuevo.', code: 'internal_error' }, 500);
}
export async function readJson(response: Response | Request, limit = 2097152): Promise<unknown> {
  const declared = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > limit) throw new TrackingError(413, 'payload_too_large', 'La respuesta excede el límite de datos. Reduce el periodo o las unidades.');
  const reader = response.body?.getReader();
  if (!reader) throw new TrackingError(400, 'invalid_json', 'Faltan los datos de la solicitud.');
  const chunks: Uint8Array[] = []; let size=0;let timedOut=false;
  const deadline=setTimeout(()=>{timedOut=true;void reader.cancel().catch(()=>{});},10000);
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length;
      if (size > limit) { await reader.cancel(); throw new TrackingError(413, 'payload_too_large', 'Demasiados datos. Reduce el periodo o las unidades.'); }
      chunks.push(chunk.value);
    }
    if(timedOut)throw new TrackingError(504,'body_timeout','Se agotó el tiempo para recibir los datos.');
  } finally { clearTimeout(deadline);reader.releaseLock(); }
  const all = new Uint8Array(size); let offset=0;
  for (const chunk of chunks) { all.set(chunk,offset); offset+=chunk.length; }
  try { const result: unknown = JSON.parse(new TextDecoder().decode(all)); return result; }
  catch { throw new TrackingError(response instanceof Request?400:502, 'invalid_json', 'Los datos recibidos no tienen un formato válido.'); }
}
export async function requestJson(fetcher: Fetcher, url: string | URL, init: RequestInit = {}, timeout = 10000, limit = 2097152): Promise<{ data: unknown; response: Response }> {
  const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
  let response: Response;
  try { response = await fetcher(url, { ...init, signal, redirect: 'error' }); }
  catch { throw new TrackingError(504, 'upstream_unavailable', 'El servicio tardó demasiado o no está disponible.'); }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403) throw new TrackingError(401, 'session_expired', 'Inicia sesión otra vez para consultar tu flota.');
    throw new TrackingError(502, 'upstream_error', 'El proveedor no pudo completar la consulta.');
  }
  return { data: await readJson(response, limit), response };
}
export async function mapLimit<T, U>(values: readonly T[], limit: number, job: (value: T, index: number) => Promise<U>): Promise<U[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 32) throw new Error('Invalid concurrency limit.');
  const results: U[] = new Array(values.length); let index=0; let failed=false; let error: unknown;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (!failed && index < values.length) {
      const current=index++;
      try { results[current] = await job(values[current],current); }
      catch (caught: unknown) { if (!failed) error=caught; failed=true; }
    }
  }));
  if (failed) throw error;
  return results;
}
