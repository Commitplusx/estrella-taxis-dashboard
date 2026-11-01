import type { FleetApi, FleetIdentity } from '../_shared/tracking/auth.ts';
import type { TrackingStore } from '../_shared/tracking/store.ts';
import { positiveId, record, TrackingError, uuid } from '../_shared/tracking/contracts.ts';
import { exact } from '../_shared/bot/taxis/adminContracts.ts';

const messages: Record<string, string> = {
  driver_busy: 'Hay un viaje u oferta pendiente. Termínalo antes de cerrar el turno.',
  other_driver_active: 'Otro chofer está en turno en esta unidad. La base o el dueño debe liberar ese turno.',
  revision_conflict: 'El turno cambió. Actualiza antes de intentarlo otra vez.',
  phone_conflict: 'Ya estás en turno en otra unidad. Termina ese turno primero.',
  shift_changed: 'Tu turno cambió. Actualiza para volver a compartir ubicación.',
  invalid_position: 'Necesitamos una ubicación reciente, precisa y sin simulación.',
};
export async function driverMobileRequest(raw: Record<string, unknown>, identity: FleetIdentity, fleet: FleetApi, store: TrackingStore, signal: AbortSignal): Promise<unknown> {
  const action = raw.action;
  exact(raw, action === 'driver_context' ? ['action'] : action === 'driver_shift'
    ? ['action', 'requestId', 'deviceId', 'active', 'expected']
    : ['action', 'deviceId', 'version', 'lat', 'lng', 'accuracy', 'speed', 'heading', 'recordedAt', 'mocked']);
  const context: unknown = await store.rpc('taxi_driver_context', { p_user: identity.userId });
  if (!record(context) || !record(context.contact) || !Array.isArray(context.units) || context.units.length > 21 || !context.units.every(u => record(u) && positiveId(u.deviceId))) {
    throw new TrackingError(502, 'driver_context_invalid', 'No pudimos comprobar tus unidades autorizadas.');
  }
  const visible = await fleet.get('/devices', identity.cookie, signal);
  if (!Array.isArray(visible) || visible.length > 10000) throw new TrackingError(502, 'driver_context_invalid', 'No pudimos comprobar tus unidades.');
  const units = context.units.filter(record).filter(u => visible.some(d => record(d) && d.id === u.deviceId)).map(u => {
    const device = visible.find(d => record(d) && d.id === u.deviceId);
    return { ...u, deviceId: u.deviceId, name: record(device) && typeof device.name === 'string' ? device.name.slice(0, 120) : u.name };
  });
  if (action === 'driver_context') return { ...context, units };
  if (!positiveId(raw.deviceId) || !units.some(u => u.deviceId === raw.deviceId)) throw new TrackingError(403, 'driver_unit_forbidden', 'Esta unidad no está vinculada a tu cuenta.');
  let result: unknown;
  if (action === 'driver_shift') {
    if (typeof raw.active !== 'boolean' || !(raw.expected === null || typeof raw.expected === 'string' && /^[a-f0-9]{32}$/.test(raw.expected))) throw new TrackingError(400, 'invalid_shift', 'Actualiza el turno antes de guardarlo.');
    result = await store.rpc('taxi_driver_shift_apply', { p_user: identity.userId, p_request: uuid(raw.requestId), p_device: raw.deviceId, p_active: raw.active, p_expected: raw.expected });
  } else if (action === 'driver_position') {
    const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
    if (typeof raw.version !== 'string' || !/^[a-f0-9]{32}$/.test(raw.version) || !finite(raw.lat) || Math.abs(raw.lat) > 90 || !finite(raw.lng) || Math.abs(raw.lng) > 180 || !finite(raw.accuracy) || raw.accuracy < 0 || raw.accuracy > 100 || !finite(raw.speed) || raw.speed < 0 || raw.speed > 70 || !(raw.heading === null || finite(raw.heading) && raw.heading >= 0 && raw.heading < 360) || raw.mocked !== false || typeof raw.recordedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(raw.recordedAt) || !Number.isFinite(Date.parse(raw.recordedAt))) throw new TrackingError(400, 'invalid_position', messages.invalid_position);
    result = await store.rpc('taxi_mobile_position_write', { p_user: identity.userId, p_device: raw.deviceId, p_version: raw.version, p_lat: raw.lat, p_lng: raw.lng, p_accuracy: raw.accuracy, p_speed: raw.speed, p_heading: raw.heading, p_recorded: raw.recordedAt, p_mocked: raw.mocked });
    if (record(result) && ['saved', 'older_position', 'rate_limited'].includes(String(result.state))) return result;
  } else throw new TrackingError(400, 'invalid_driver_action', 'Esta acción no está disponible.');
  if (!record(result) || result.state !== 'saved') {
    const code = record(result) && typeof result.state === 'string' ? result.state : 'driver_write_unconfirmed';
    throw new TrackingError(409, code, messages[code] ?? 'No se confirmó el cambio. Comprueba la misma solicitud.');
  }
  return driverMobileRequest({ action: 'driver_context' }, identity, fleet, store, signal);
}
