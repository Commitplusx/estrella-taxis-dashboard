/** Phone is an alias for the existing Traccar account, never another password store. */
export function loginPhone(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40) return null;
  const phone = value.trim().replace(/[ ()-]/g, '');
  if (/^[0-9]{10}$/.test(phone)) return '+52' + phone;
  if (/^\+521[0-9]{10}$/.test(phone)) return '+52' + phone.slice(4);
  return /^\+(?:52[0-9]{10}|1[0-9]{10}|502[0-9]{8})$/.test(phone) ? phone : null;
}
export function personalAccountEmail(contactId: string): string {
  return 'taxi-' + contactId + '@accounts.stellar.invalid';
}
