import type { FleetApi, FleetIdentity } from '../_shared/tracking/auth.ts';
import type { TrackingStore } from '../_shared/tracking/store.ts';
import { positiveId, record, TrackingError, uuid } from '../_shared/tracking/contracts.ts';
import { exact } from '../_shared/bot/taxis/adminContracts.ts';
import { validChannelPhone } from '../_shared/bot/taxis/channelPhone.ts';
import { parseBotDriver, parseDriverSetup } from '../_shared/bot/taxis/driverAdmin.ts';

export async function driverRequest(raw: Record<string, unknown>, tenant: string, waba: string, identity: FleetIdentity,
  canConfigure: boolean, fleet: FleetApi, store: TrackingStore, signal: AbortSignal): Promise<unknown> {
  exact(raw, raw.action === 'drivers' ? ['action', 'tenantId', 'waba'] : ['action', 'tenantId', 'waba', 'requestId', 'deviceId', 'name', 'phone', 'active', 'expected']);
  if (raw.action === 'driver_save' && !canConfigure) throw new TrackingError(403, 'configure_forbidden', 'Sólo la administración de la base puede registrar conductores.');
  const data = await fleet.get('/devices', identity.cookie, signal);
  if (!Array.isArray(data) || data.length > 10000) throw new TrackingError(502, 'invalid_devices', 'No pudimos comprobar las unidades en Traccar.');
  const units = data.map((unit: unknown) => {
    if (!record(unit) || !positiveId(unit.id) || typeof unit.name !== 'string' || !unit.name.trim()) throw new TrackingError(502, 'invalid_devices', 'Traccar devolvió una unidad sin identificar.');
    return { id: unit.id, name: unit.name.slice(0, 120) };
  });
  if (new Set(units.map(unit => unit.id)).size !== units.length) throw new TrackingError(502, 'invalid_devices', 'Traccar devolvió unidades repetidas.');
  if (raw.action === 'drivers') {
    const state = await store.rpc('taxi_bot_driver_read', { p_tenant: tenant, p_waba: waba });
    if (!record(state)) throw new TrackingError(502, 'invalid_drivers', 'No pudimos leer los conductores de esta base.');
    return parseDriverSetup({ ...state, units });
  }
  if (!positiveId(raw.deviceId) || !units.some(unit => unit.id === raw.deviceId)) throw new TrackingError(403, 'device_forbidden', 'Elige una unidad disponible en tu cuenta de Traccar.');
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.trim().length > 120 || typeof raw.phone !== 'string' || !validChannelPhone(raw.phone) ||
    typeof raw.active !== 'boolean' || (raw.expected !== null && (typeof raw.expected !== 'string' || !/^[a-f0-9]{32}$/.test(raw.expected)))) throw new TrackingError(400, 'invalid_driver', 'Completa el nombre, la unidad y el WhatsApp con código de país.');
  const saved = await store.rpc('taxi_bot_driver_apply', { p_tenant: tenant, p_actor: identity.userId, p_request: uuid(raw.requestId), p_device: raw.deviceId,
    p_name: raw.name.trim(), p_phone: raw.phone, p_active: raw.active, p_expected: raw.expected });
  if (!record(saved) || typeof saved.state !== 'string') throw new TrackingError(503, 'driver_result_uncertain', 'No se confirmó el registro. Comprueba el mismo guardado.');
  const errors: Record<string, string> = {
    device_conflict: 'Esa unidad ya está vinculada con otra base. No se modificó.',
    phone_conflict: 'Ese WhatsApp ya está activo en otra unidad de esta base.',
    driver_busy: 'El conductor tiene un servicio u oferta pendiente. Termínalo antes de editarlo.',
    revision_conflict: 'El conductor cambió. Actualiza la lista antes de editarlo.',
    request_conflict: 'Esta solicitud ya se usó con otros datos. Actualiza la lista.',
  };
  if (saved.state !== 'saved') throw new TrackingError(409, saved.state, errors[saved.state] ?? 'No se confirmó el registro del conductor.');
  return { state: 'saved', driver: parseBotDriver(saved.driver) };
}
