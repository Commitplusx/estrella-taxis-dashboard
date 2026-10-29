export const channelCountries = [
  { id: 'MX', code: '+52', label: 'México (+52)' },
  { id: 'US', code: '+1', label: 'Estados Unidos / Canadá (+1)' },
  { id: 'GT', code: '+502', label: 'Guatemala (+502)' },
] as const;
export type ChannelCountry = typeof channelCountries[number]['id'];

export function channelPhone(country: string, national: string): string | null {
  if (!/^[\d ()-]+$/.test(national)) return null;
  const digits = national.replace(/[ ()-]/g, '');
  const entry = channelCountries.find(item => item.id === country);
  if (!entry) return null;
  if (country === 'MX' && !/^\d{10}$|^1\d{10}$/.test(digits)) return null;
  if (country === 'US' && !/^\d{10}$/.test(digits)) return null;
  if (country === 'GT' && !/^\d{8}$/.test(digits)) return null;
  return entry.code + digits;
}

export function splitChannelPhone(value: string): { country: ChannelCountry; national: string; needsCountryCode: boolean } {
  const compact = value.replace(/[ ()-]/g, '');
  for (const entry of channelCountries) {
    if (compact.startsWith(entry.code)) {
      const national = compact.slice(entry.code.length);
      if (channelPhone(entry.id, national)) return { country: entry.id, national, needsCountryCode: false };
    }
  }
  const local = compact.replace(/^\+/, '');
  return { country: 'MX', national: local, needsCountryCode: /^\d{10}$/.test(local) };
}

export function validChannelPhone(value: string): boolean {
  const parsed = splitChannelPhone(value);
  return !parsed.needsCountryCode && channelPhone(parsed.country, parsed.national) === value;
}
