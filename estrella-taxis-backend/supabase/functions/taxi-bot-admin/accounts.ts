import { type FleetApi, type FleetIdentity } from '../_shared/tracking/auth.ts';
import type { TrackingStore } from '../_shared/tracking/store.ts';
import { positiveId, record, TrackingError, uuid } from '../_shared/tracking/contracts.ts';
import { exact } from '../_shared/bot/taxis/adminContracts.ts';
import { isContactRole, parseContactSetup, parseContactId } from '../_shared/bot/taxis/contactAdmin.ts';

function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 500 || !value.every(record)) throw new TrackingError(502, 'invalid_accounts', 'No pudimos comprobar las cuentas de Traccar.');
  return value;
}
function account(value: unknown): Record<string, unknown> & { id: number; name: string; email: string } {
  if (!record(value) || !positiveId(value.id) || typeof value.name !== 'string' || typeof value.email !== 'string' || typeof value.administrator !== 'boolean') throw new TrackingError(502, 'invalid_account', 'Traccar devolvió una cuenta sin identificar.');
  return { ...value, id: value.id, name: value.name, email: value.email };
}
const fail = (code: string, message: string): never => { throw new TrackingError(409, code, message); };
/** All credentials and device grants remain in Traccar; PostgreSQL binds that user to the existing person. */
export async function accountRequest(raw: Record<string, unknown>, tenant: string, waba: string, identity: FleetIdentity, fleet: FleetApi, store: TrackingStore, signal: AbortSignal): Promise<unknown> {
  if (!identity.admin) throw new TrackingError(403, 'account_admin_required', 'Sólo el administrador puede crear accesos y asignar taxis.');
  const users = rows(await fleet.get('/users', identity.cookie, signal, 4194304)).map(account);
  const profiles = await store.read('perfiles', new URLSearchParams({ select: 'traccar_user_id,empresa_id,rol', limit: '501' }));
  if (profiles.length > 500 || !profiles.every(record)) throw new TrackingError(502, 'invalid_profiles', 'No pudimos comprobar los accesos de la base.');
  const setupRaw = await store.rpc('taxi_bot_contacts_read', { p_tenant: tenant, p_waba: waba });
  const devices = rows(await fleet.get('/devices', identity.cookie, signal)).map(unit => {
    if (!positiveId(unit.id) || typeof unit.name !== 'string') throw new TrackingError(502, 'invalid_devices', 'No pudimos comprobar los taxis.');
    return { id: unit.id, name: unit.name };
  });
  if (!record(setupRaw) || !Array.isArray(setupRaw.linkedUnitIds) || !setupRaw.linkedUnitIds.every(positiveId)) throw new TrackingError(502, 'invalid_base_units', 'No pudimos comprobar la flota de esta base.');
  const linked = new Set(setupRaw.linkedUnitIds);
  const baseDevices = devices.filter(unit => linked.has(unit.id));
  const setup = parseContactSetup({ ...setupRaw, units: baseDevices });
  const allowedUsers = users.filter(user => !user.administrator && user.id !== identity.userId && !profiles.some(profile => profile.traccar_user_id === user.id && (profile.empresa_id !== tenant || profile.rol === 'superadmin' || profile.rol === 'admin_empresa')));
  if (raw.action === 'accounts') {
    exact(raw, ['action', 'tenantId', 'waba']);
    const pending = await store.rpc('taxi_account_pending', { p_actor: identity.userId, p_tenant: tenant });
    if (!Array.isArray(pending) || pending.length > 100 || !pending.every(record)) throw new TrackingError(502, 'invalid_account_pending', 'No pudimos comprobar las altas pendientes.');
    return { users: allowedUsers.map(user => ({ id: user.id, name: user.name, email: user.email, disabled: user.disabled === true,
      contactId: setup.contacts.find(contact => contact.accountUserId === user.id)?.id ?? null })), pending: pending.map(operation => ({ ...operation,
        needsPassword: record(operation.command) && operation.command.userId === null && !users.some(user => record(user.attributes) && user.attributes.stellarAccountRequest === operation.requestId) })) };
  }
  exact(raw, ['action', 'tenantId', 'waba', 'contactId', 'expected', 'userId', 'email', 'password', 'requestId', 'role', 'deviceId', 'receiveOffers', 'driverVersion']);
  const contactId = parseContactId(raw.contactId), requestId = uuid(raw.requestId);
  const person = setup.contacts.find(contact => contact.id === contactId);
  if (!person) throw new TrackingError(403, 'contact_forbidden', 'Elige una persona de esta base.');
  if (!isContactRole(raw.role) || raw.role === 'pending' || !(raw.deviceId === null || positiveId(raw.deviceId) && baseDevices.some(unit => unit.id === raw.deviceId)) ||
    typeof raw.receiveOffers !== 'boolean' || !(raw.driverVersion === null || typeof raw.driverVersion === 'string' && /^[a-f0-9]{32}$/.test(raw.driverVersion)) ||
    raw.role !== 'staff' && raw.deviceId === null || raw.receiveOffers && (!['driver', 'owner_driver'].includes(raw.role) || !person.phone || raw.deviceId === null)) throw new TrackingError(400, 'invalid_assignment', 'Confirma su rol, su taxi y quién recibirá las ofertas.');
  if (typeof raw.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.email) || raw.email.length > 254 || raw.email !== raw.email.trim().toLowerCase() ||
    typeof raw.expected !== 'string' || !/^[a-f0-9]{32}$/.test(raw.expected) || !(raw.userId === null || positiveId(raw.userId))) throw new TrackingError(400, 'invalid_account', 'Revisa el correo y el acceso elegido.');
  const marked = users.find(user => record(user.attributes) && user.attributes.stellarAccountRequest === requestId);
  if (raw.userId === null && !marked && (typeof raw.password !== 'string' || raw.password.length < 12 || raw.password.length > 128)) throw new TrackingError(400, 'invalid_password', 'Usa una contraseña de entre 12 y 128 caracteres.');
  if (raw.userId !== null && raw.password !== '') throw new TrackingError(400, 'unexpected_password', 'No se cambia la contraseña al vincular una cuenta existente.');
  let target = raw.userId === null ? marked : allowedUsers.find(user => user.id === raw.userId);
  if (raw.userId !== null && (!target || target.email.toLowerCase() !== raw.email)) fail('user_forbidden', 'La cuenta elegida no está disponible o cambió su correo.');
  if (raw.userId === null && users.some(user => user.email.toLowerCase() === raw.email && user.id !== marked?.id)) fail('email_exists', 'Ese correo ya tiene una cuenta. Elige Usar cuenta existente.');
  if (target?.administrator || target?.id === identity.userId || target && !allowedUsers.some(user => user.id === target?.id)) fail('user_forbidden', 'No se puede convertir esa cuenta en dueño o conductor.');
  const begun = await store.rpc('taxi_account_begin', { p_tenant: tenant, p_actor: identity.userId, p_request: requestId, p_contact: contactId, p_expected: raw.expected, p_email: raw.email, p_user: raw.userId,
    p_assignment: { role: raw.role, deviceId: raw.deviceId, receiveOffers: raw.receiveOffers, driverVersion: raw.driverVersion } });
  if (!record(begun)) throw new TrackingError(503, 'account_uncertain', 'No pudimos comprobar el alta. Comprueba la misma solicitud.');
  const replay = begun.state === 'replay' && record(begun.result) ? begun.result : null;
  if (replay && begun.activated === true) return replay;
  if (replay) target = users.find(user => user.id === replay.userId);
  if (!replay && (begun.state !== 'proceed' || typeof begun.lease !== 'string')) {
    const messages: Record<string, string> = { running: 'El alta sigue en curso. Espera 90 segundos y comprueba la misma solicitud.', account_pending: 'Esta persona o correo ya tiene un alta pendiente. Completa esa solicitud.',
      role_required: 'Confirma si es dueño, conductor u operador antes de crear su acceso.', device_required: 'Vincula su taxi GPS antes de crear el acceso.', revision_conflict: 'Los datos cambiaron. Actualiza la persona antes de crear su acceso.', account_already_linked: 'Esta persona ya tiene un acceso. Elige su cuenta existente.', user_forbidden: 'La cuenta ya está vinculada con otra persona o base.', account_review: 'Los datos cambiaron durante el alta. Actualiza la persona y elige la cuenta existente para revisar su asignación; permanece sin acceso hasta completarla.' };
    throw new TrackingError(begun.state === 'running' ? 503 : 409, String(begun.state), messages[String(begun.state)] ?? 'El alta cambió. Revisa la misma solicitud.');
  }
  if (!target && !replay) target = account(await fleet.write('/users', 'POST', identity.cookie, { name: person.name, email: raw.email, password: raw.password,
    administrator: false, readonly: true, disabled: true, deviceLimit: 0, userLimit: 0, deviceReadonly: true, limitCommands: true, fixedEmail: true,
    attributes: { stellarAccountRequest: requestId } }, signal));
  if (!target) throw new TrackingError(503, 'account_uncertain', 'No encontramos el acceso reservado. Revisa la misma solicitud.');
  if (target.administrator || target.email.toLowerCase() !== raw.email) throw new TrackingError(503, 'account_uncertain', 'Traccar no confirmó la cuenta solicitada.');
  if (!replay) {
    // Suspend login while replacing grants; interruption cannot expose another taxi or grant base administration.
    const { password: _secret, ...safeUser } = target;
    await fleet.write('/users/' + target.id, 'PUT', identity.cookie, { ...safeUser, disabled: true, administrator: false, readonly: true, deviceLimit: 0, userLimit: 0, deviceReadonly: true, limitCommands: true, fixedEmail: true }, signal);
    const groups = rows(await fleet.get('/groups?userId=' + target.id, identity.cookie, signal));
    for (const group of groups) {
      if (!positiveId(group.id)) throw new TrackingError(502, 'invalid_groups', 'No pudimos comprobar los grupos del acceso.');
      await fleet.write('/permissions', 'DELETE', identity.cookie, { userId: target.id, groupId: group.id }, signal);
    }
    const assigned = rows(await fleet.get('/devices?userId=' + target.id, identity.cookie, signal));
    const wanted = raw.role === 'staff' ? baseDevices.map(unit => unit.id) : raw.deviceId === null ? [] : [raw.deviceId];
    if (wanted.some(id => !baseDevices.some(unit => unit.id === id))) throw new TrackingError(503, 'device_not_visible', 'El taxi ya no está disponible en esta base. Revisa la asignación.');
    for (const unit of assigned) {
      if (!positiveId(unit.id)) throw new TrackingError(502, 'invalid_devices', 'No pudimos comprobar los taxis asignados.');
      if (!wanted.includes(unit.id)) await fleet.write('/permissions', 'DELETE', identity.cookie, { userId: target.id, deviceId: unit.id }, signal);
    }
    for (const deviceId of wanted) if (!assigned.some(unit => unit.id === deviceId)) await fleet.write('/permissions', 'POST', identity.cookie, { userId: target.id, deviceId }, signal);
    const verified = rows(await fleet.get('/devices?userId=' + target.id, identity.cookie, signal));
    if (verified.length !== wanted.length || verified.some(unit => !positiveId(unit.id) || !wanted.includes(unit.id))) throw new TrackingError(503, 'account_uncertain', 'No se confirmó la asignación exacta de taxis. Comprueba la misma solicitud.');
  }
  const saved = replay ?? await store.rpc('taxi_account_finish', { p_actor: identity.userId, p_request: requestId, p_lease: begun.lease, p_user: target.id });
  if (record(saved) && saved.state === 'account_review') throw new TrackingError(409, 'account_review', 'Los datos cambiaron durante el alta. Actualiza la persona y elige la cuenta existente para revisar su asignación; permanece sin acceso hasta completarla.');
  if (!record(saved) || saved.state !== 'saved' || saved.userId !== target.id) throw new TrackingError(503, 'account_uncertain', 'No se confirmó el vínculo con Pompeyo. Comprueba la misma solicitud.');
  const { password: _secret, ...safeUser } = target;
  const activated = account(await fleet.write('/users/' + target.id, 'PUT', identity.cookie, { ...safeUser, disabled: false, administrator: false, readonly: true, deviceLimit: 0, userLimit: 0, deviceReadonly: true, limitCommands: true, fixedEmail: true }, signal));
  if (activated.disabled !== false || activated.administrator !== false || activated.readonly !== true || activated.userLimit !== 0 || activated.deviceReadonly !== true) throw new TrackingError(503, 'account_uncertain', 'El vínculo quedó guardado, pero falta confirmar la activación. Comprueba la misma solicitud.');
  if (await store.rpc('taxi_account_activated', { p_actor: identity.userId, p_request: requestId, p_user: target.id }) !== true) throw new TrackingError(503, 'account_uncertain', 'Falta confirmar el alta. Comprueba la misma solicitud.');
  return saved;
}
