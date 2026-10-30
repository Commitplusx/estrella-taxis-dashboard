import type { FleetApi, FleetIdentity } from '../_shared/tracking/auth.ts';
import type { TrackingStore } from '../_shared/tracking/store.ts';
import { positiveId, record, TrackingError, uuid } from '../_shared/tracking/contracts.ts';
import { exact } from '../_shared/bot/taxis/adminContracts.ts';
import { validChannelPhone } from '../_shared/bot/taxis/channelPhone.ts';
import { parseBotDriver, parseDriverSetup } from '../_shared/bot/taxis/driverAdmin.ts';
import { isContactRole, parseBaseContact, parseContactSetup, parseContactId } from '../_shared/bot/taxis/contactAdmin.ts';

export async function driverRequest(raw: Record<string, unknown>, tenant: string, waba: string, identity: FleetIdentity,
  canConfigure: boolean, fleet: FleetApi, store: TrackingStore, signal: AbortSignal): Promise<unknown> {
  const contacts = raw.action === 'contacts' || raw.action === 'contact_save';
  exact(raw, raw.action === 'drivers' || raw.action === 'contacts' ? ['action', 'tenantId', 'waba'] : contacts
    ? ['action', 'tenantId', 'waba', 'requestId', 'contactId', 'unitNumber', 'name', 'phoneInput', 'role', 'deviceId', 'receiveOffers', 'expected', 'driverVersion']
    : ['action', 'tenantId', 'waba', 'requestId', 'deviceId', 'name', 'phone', 'active', 'expected']);
  if ((raw.action === 'driver_save' || raw.action === 'contact_save') && !canConfigure) throw new TrackingError(403, 'configure_forbidden', 'Sólo la administración de la base puede registrar conductores.');
  const data = await fleet.get('/devices', identity.cookie, signal);
  if (!Array.isArray(data) || data.length > 10000) throw new TrackingError(502, 'invalid_devices', 'No pudimos comprobar las unidades en Traccar.');
  const units = data.map((unit: unknown) => {
    if (!record(unit) || !positiveId(unit.id) || typeof unit.name !== 'string' || !unit.name.trim()) throw new TrackingError(502, 'invalid_devices', 'Traccar devolvió una unidad sin identificar.');
    return { id: unit.id, name: unit.name.slice(0, 120) };
  });
  if (new Set(units.map(unit => unit.id)).size !== units.length) throw new TrackingError(502, 'invalid_devices', 'Traccar devolvió unidades repetidas.');
  if (contacts) {
    if (raw.action === 'contacts') {
      const state = await store.rpc('taxi_bot_contacts_read', { p_tenant: tenant, p_waba: waba });
      if (!record(state) || !Array.isArray(state.linkedUnitIds) || state.linkedUnitIds.length > 10000 || !state.linkedUnitIds.every(positiveId)) throw new TrackingError(502, 'invalid_contacts', 'No pudimos comprobar las unidades de esta base.');
      const linked = new Set(state.linkedUnitIds);
      return parseContactSetup({ ...state, units: units.filter(unit => linked.has(unit.id)) });
    }
    if (!(raw.deviceId === null || positiveId(raw.deviceId) && units.some(unit => unit.id === raw.deviceId))) throw new TrackingError(403, 'device_forbidden', 'Elige una unidad visible en tu cuenta de Traccar.');
    if (typeof raw.unitNumber !== 'string' || !raw.unitNumber.trim() || raw.unitNumber.trim().length > 20 ||
      typeof raw.name !== 'string' || !raw.name.trim() || raw.name.trim().length > 120 || !isContactRole(raw.role) ||
      typeof raw.phoneInput !== 'string' || raw.phoneInput.length > 40 || !/^[+0-9 ()-]*$/.test(raw.phoneInput) || typeof raw.receiveOffers !== 'boolean' ||
      !(raw.expected === null || typeof raw.expected === 'string' && /^[a-f0-9]{32}$/.test(raw.expected)) ||
      !(raw.driverVersion === null || typeof raw.driverVersion === 'string' && /^[a-f0-9]{32}$/.test(raw.driverVersion))) throw new TrackingError(400, 'invalid_contact', 'Revisa el nombre, el rol, la unidad y el teléfono del contacto.');
    const contactId = parseContactId(raw.contactId);
    const saved = await store.rpc('taxi_bot_contact_apply', { p_tenant: tenant, p_actor: identity.userId, p_request: uuid(raw.requestId),
      p_expected: raw.expected, p_contact: contactId, p_payload: { unitNumber: raw.unitNumber.trim(), name: raw.name.trim(), phoneInput: raw.phoneInput,
        role: raw.role, deviceId: raw.deviceId, receiveOffers: raw.receiveOffers, driverVersion: raw.driverVersion } });
    if (!record(saved) || typeof saved.state !== 'string') throw new TrackingError(503, 'contact_result_uncertain', 'No se confirmó el guardado. Comprueba la misma solicitud.');
    const errors: Record<string, string> = {
      role_not_driving: 'Sólo un conductor o un dueño que también conduce puede recibir ofertas.', phone_invalid: 'Completa el WhatsApp antes de permitir ofertas.',
      device_required: 'Vincula una unidad GPS antes de permitir ofertas.', device_forbidden: 'Esa unidad GPS no pertenece a esta base.',
      contact_forbidden: 'Ese contacto pertenece a otra base.', revision_conflict: 'El contacto cambió. Actualiza la lista antes de editarlo.',
      driver_changed: 'Cambió quien conduce esa unidad. Actualiza la lista antes de guardar.', phone_conflict: 'Ese WhatsApp ya está registrado en la base.',
      driver_busy: 'Hay un servicio u oferta pendiente. Termínalo antes de cambiar al conductor.', request_conflict: 'La solicitud ya se usó con otros datos. Actualiza la lista.',
      account_pending: 'Esta persona tiene un alta de acceso pendiente. Complétala antes de cambiar sus datos.',
      account_assignment_locked: 'La persona tiene un acceso vinculado. Su rol y taxi deben cambiarse desde la administración del acceso.',
    };
    if (saved.state !== 'saved') throw new TrackingError(409, saved.state, errors[saved.state] ?? 'No se confirmó el contacto. Actualiza la lista.');
    const contact = parseBaseContact(saved.contact);
    if (contact.id !== contactId || contact.name !== raw.name.trim() || contact.unitNumber !== raw.unitNumber.trim() || contact.phoneInput !== raw.phoneInput ||
      contact.role !== raw.role || contact.deviceId !== raw.deviceId || contact.receiving !== raw.receiveOffers) throw new TrackingError(503, 'contact_result_uncertain', 'El servidor no confirmó los mismos datos. Comprueba el guardado antes de repetir.');
    return { state: 'saved', contact };
  }
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
