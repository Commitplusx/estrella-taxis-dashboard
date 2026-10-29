export class TrackingError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) { super(message);this.status=status;this.code=code; }
}
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
export function positiveId(value: unknown): value is number { return finite(value) && Number.isSafeInteger(value) && value > 0; }
export function numeric(value: unknown): number | null {
  if (finite(value)) return value;
  if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value)) return null;
  const result = Number(value); return Number.isFinite(result) ? result : null;
}
export function flag(value: unknown): boolean | null {
  if (value === true || value === 1 || value === 'true' || value === '1') return true;
  if (value === false || value === 0 || value === 'false' || value === '0') return false;
  return null;
}
export function ids(value: unknown, max = 25): number[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > max || !value.every(positiveId)) throw new TrackingError(400, 'invalid_devices', `Elige de 1 a ${max} unidades.`);
  return [...new Set(value)].sort((a,b) => a-b);
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new TrackingError(400, 'invalid_request_id', 'La solicitud necesita un identificador válido.');
  return value.toLowerCase();
}
export function isoMs(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT.*(Z|[+-]\d\d:\d\d)$/.test(value)) return null;
  const result = Date.parse(value); return Number.isFinite(result) ? result : null;
}
export interface Period { from: string; to: string }
export function period(from: unknown, to: unknown, now: number, days = 7): Period {
  const start = isoMs(from), end = isoMs(to);
  if (start === null || end === null || end <= start || end-start > days*86400000 || start >= now || end > now+86400000) throw new TrackingError(400, 'invalid_period', `Revisa el periodo: máximo ${days} días y fechas con zona horaria.`);
  return { from: new Date(start).toISOString(), to: new Date(Math.min(end, now)).toISOString() };
}
export function localDay(now: number): string {
  return new Date(now-6*3600000).toISOString().slice(0,10);
}
export function dayPeriod(date: unknown, now: number): Period & { date: string } {
  if (typeof date !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(date)) throw new TrackingError(400, 'invalid_date', 'Usa una fecha válida.');
  const start = Date.parse(`${date}T06:00:00Z`);
  if (!Number.isFinite(start) || new Date(start).toISOString().slice(0,10) !== date || start > now || now-start > 90*86400000) throw new TrackingError(400, 'invalid_date', 'Elige una fecha de los últimos 90 días.');
  return { date, from: new Date(start).toISOString(), to: new Date(Math.min(start+86400000-1, now)).toISOString() };
}
export async function fingerprint(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2,'0')).join('');
}
