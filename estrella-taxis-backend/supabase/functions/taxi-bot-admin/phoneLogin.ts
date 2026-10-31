import type { FleetApi } from '../_shared/tracking/auth.ts';
import type { TrackingStore } from '../_shared/tracking/store.ts';
import { positiveId, record, TrackingError } from '../_shared/tracking/contracts.ts';
import { loginPhone } from '../_shared/tracking/phoneLogin.ts';
import { exact } from '../_shared/bot/taxis/adminContracts.ts';
import type { AccountManager } from './owners.ts';
const invalid = () => new TrackingError(401, 'invalid_credentials', 'Número o contraseña incorrectos.');
function scope(value: unknown): {userId: number; deviceId: number; deviceIds:number[]; tenantId: string} | null {
  return record(value) && positiveId(value.userId) && positiveId(value.deviceId) && typeof value.tenantId === 'string' && Array.isArray(value.deviceIds) && value.deviceIds.length<=21 && value.deviceIds.every(positiveId) && value.deviceIds.includes(value.deviceId) && new Set(value.deviceIds).size===value.deviceIds.length
    ? {userId:value.userId,deviceId:value.deviceId,deviceIds:value.deviceIds,tenantId:value.tenantId} : null;
}
export async function phoneLogin(raw: Record<string, unknown>, fleet: FleetApi, store: TrackingStore, manager: AccountManager | undefined, signal: AbortSignal): Promise<Record<string, unknown>> {
  exact(raw, ['action', 'phone', 'password', 'client']);
  const phone = loginPhone(raw.phone);
  if (!phone || typeof raw.password !== 'string' || raw.password.length < 1 || raw.password.length > 128 || !['web','apk'].includes(String(raw.client))) throw invalid();
  const begun = await store.rpc('taxi_phone_login_begin', {p_phone:phone});
  if (!record(begun) || typeof begun.allowed !== 'boolean') throw new TrackingError(503, 'login_unavailable', 'No pudimos iniciar sesión. Intenta más tarde.');
  if (!begun.allowed) throw new TrackingError(429, 'login_limited', 'Demasiados intentos. Espera diez minutos antes de intentar de nuevo.');
  const account = scope(begun.account);
  if (!account) throw invalid();
  if (!manager) throw new TrackingError(503, 'login_unavailable', 'No pudimos iniciar sesión. Intenta más tarde.');
  const admin = await manager(signal);
  if (!admin.admin) throw new TrackingError(503, 'login_unavailable', 'No pudimos iniciar sesión. Intenta más tarde.');
  const user = await fleet.get('/users/' + account.userId, admin.cookie, signal);
  if (!record(user) || user.id !== account.userId || user.administrator !== false || user.disabled !== false || typeof user.email !== 'string' || !user.email || user.email.length > 254) throw invalid();
  let session;
  try { session = await fleet.jobSession(user.email, raw.password, signal); }
  catch (error: unknown) { if (error instanceof TrackingError && error.status === 401) throw invalid(); throw error; }
  if (session.admin || session.userId !== account.userId || session.devices.length !== account.deviceIds.length || session.devices.some(d=>!account.deviceIds.includes(d.id))) throw invalid();
  const current = scope(await store.rpc('taxi_phone_login_scope', {p_phone:phone}));
  if (!current || current.userId !== account.userId || current.deviceId !== account.deviceId || current.tenantId !== account.tenantId || current.deviceIds.length!==account.deviceIds.length || current.deviceIds.some(id=>!account.deviceIds.includes(id))) throw invalid();
  // Web exchanges this short-lived credential for its normal HttpOnly Traccar cookie.
  if (raw.client === 'web') return {token:await fleet.loginToken(session.cookie, signal)};
  return {session:session.cookie};
}
