import { positiveId, record, TrackingError } from '../../tracking/contracts.ts';
import { parseDriverSetup, type DriverSetup } from './driverAdmin.ts';
export const contactRoles = [
  { value: 'pending', label: 'Por confirmar' }, { value: 'driver', label: 'Conductor' },
  { value: 'owner', label: 'Dueño' }, { value: 'owner_driver', label: 'Dueño y conductor' },
  { value: 'staff', label: 'Otro empleado' },
] as const;
export type ContactRole = typeof contactRoles[number]['value'];
export interface BaseContact {
  id: string; unitNumber: string; name: string; phoneInput: string; phone: string | null;
  role: ContactRole; deviceId: number | null; receiving: boolean; version: string;
  accountUserId?: number | null;
}
export interface ContactSetup extends DriverSetup { contacts: BaseContact[] }
export function isContactRole(value: unknown): value is ContactRole { return contactRoles.some(role => role.value === value); }
export function parseBaseContact(value: unknown): BaseContact {
  if (!record(value) || typeof value.id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.id) ||
    typeof value.unitNumber !== 'string' || !value.unitNumber.trim() || value.unitNumber.length > 20 ||
    typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120 ||
    typeof value.phoneInput !== 'string' || value.phoneInput.length > 40 || !/^[+0-9 ()-]*$/.test(value.phoneInput) ||
    !(value.phone === null || typeof value.phone === 'string' && /^\+[1-9][0-9]{7,14}$/.test(value.phone)) ||
    !isContactRole(value.role) || !(value.deviceId === null || positiveId(value.deviceId)) || typeof value.receiving !== 'boolean' ||
    typeof value.version !== 'string' || !/^[a-f0-9]{32}$/.test(value.version) ||
    !(value.accountUserId === undefined || value.accountUserId === null || positiveId(value.accountUserId))) throw new TrackingError(502, 'invalid_contact', 'No pudimos comprobar los datos del contacto.');
  return { id: value.id, unitNumber: value.unitNumber, name: value.name, phoneInput: value.phoneInput, phone: value.phone,
    role: value.role, deviceId: value.deviceId, receiving: value.receiving, version: value.version, accountUserId: value.accountUserId ?? null };
}
export function parseContactSetup(value: unknown): ContactSetup {
  if (!record(value) || !Array.isArray(value.contacts) || value.contacts.length > 500) throw new TrackingError(502, 'invalid_contacts', 'No pudimos cargar los contactos de la base.');
  const contacts = value.contacts.map(parseBaseContact);
  if (new Set(contacts.map(contact => contact.id)).size !== contacts.length) throw new TrackingError(502, 'invalid_contacts', 'La lista de contactos tiene registros repetidos.');
  return { ...parseDriverSetup(value), contacts };
}
