import { phone, record } from './contracts.ts';
import { TrackingError } from '../../tracking/contracts.ts';
export interface CustomerAccess { revision: number; phones: string[] }
export function customerPhone(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\+?[0-9 ()-]{8,24}$/.test(value)) return null;
  const digits = value.replace(/\D/g, '');
  const parsed = phone(!value.trim().startsWith('+') && digits.length === 10 ? '+52' + digits : value);
  return parsed?.match(/^\+521[0-9]{10}$/) ? '+52' + parsed.slice(4) : parsed;
}
export function customerPhones(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) throw new TrackingError(400, 'invalid_customer_access', 'Puedes autorizar hasta 100 números.');
  const result: string[] = [];
  for (const item of value) {
    const normalized = customerPhone(item);
    if (!normalized || result.includes(normalized)) throw new TrackingError(400, 'invalid_customer_access', 'Revisa los números: hay uno inválido o repetido.');
    result.push(normalized);
  }
  return result.sort();
}
export function parseCustomerAccess(value: unknown): CustomerAccess {
  if (!record(value) || value.restricted !== true || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.phones)) throw new TrackingError(502, 'invalid_customer_access_response', 'No pudimos comprobar la lista de autorizados.');
  const phones = customerPhones(value.phones);
  return { revision: value.revision, phones };
}
