import { record, positiveId } from '../../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts';
export interface TaxiAccountOption { id: number; name: string; email: string; disabled: boolean; contactId: string | null }
export interface PendingAccount { requestId: string; needsPassword: boolean; command: { contact: string; expected: string; email: string; userId: number | null; assignment: { role: string; deviceId: number | null; receiveOffers: boolean; driverVersion: string | null } } }
export function parsePendingAccounts(value: unknown): PendingAccount[] {
  if (!record(value) || !Array.isArray(value.pending) || value.pending.length > 100) throw new Error('No pudimos comprobar las altas pendientes.');
  return value.pending.map((operation): PendingAccount => {
    const c = record(operation) ? operation.command : null;
    const a = record(c) ? c.assignment : null;
    if (!record(operation) || typeof operation.requestId !== 'string' || typeof operation.needsPassword !== 'boolean' || !record(c) || typeof c.contact !== 'string' || typeof c.expected !== 'string' || typeof c.email !== 'string' || !(c.userId === null || positiveId(c.userId)) || !record(a) || typeof a.role !== 'string' || !(a.deviceId === null || positiveId(a.deviceId)) || typeof a.receiveOffers !== 'boolean' || !(a.driverVersion === null || typeof a.driverVersion === 'string')) throw new Error('Un alta pendiente no es válida.');
    return { requestId: operation.requestId, needsPassword: operation.needsPassword, command: { contact: c.contact, expected: c.expected, email: c.email, userId: c.userId, assignment: { role: a.role, deviceId: a.deviceId, receiveOffers: a.receiveOffers, driverVersion: a.driverVersion } } };
  });
}
export function parseAccountOptions(value: unknown): TaxiAccountOption[] {
  if (!record(value) || !Array.isArray(value.users) || value.users.length > 500) throw new Error('No pudimos comprobar las cuentas disponibles.');
  const users = value.users.map((item): TaxiAccountOption => {
    if (!record(item) || !positiveId(item.id) || typeof item.name !== 'string' || typeof item.email !== 'string' || typeof item.disabled !== 'boolean' || !(item.contactId === null || typeof item.contactId === 'string')) throw new Error('Una cuenta no está identificada.');
    return { id: item.id, name: item.name, email: item.email, disabled: item.disabled, contactId: item.contactId };
  });
  if (new Set(users.map(user => user.id)).size !== users.length) throw new Error('La lista de accesos está repetida.');
  return users;
}
