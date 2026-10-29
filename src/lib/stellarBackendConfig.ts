export const STELLAR_PROJECT_ID = 'izrsxygazsalfhpaualj';
export function stellarBackendConfig(env: Record<string, unknown>): { url: string; publicKey: string } {
  const url = env.VITE_STELLAR_SUPABASE_URL, publicKey = env.VITE_STELLAR_SUPABASE_PUBLISHABLE_KEY;
  if (typeof url !== 'string' || typeof publicKey !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(publicKey)) {
    throw new Error('Configura la URL y la clave publicable del proyecto independiente de Stellar Tracking.');
  }
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== STELLAR_PROJECT_ID + '.supabase.co' ||
    parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('Stellar Tracking sólo puede usar su proyecto independiente.');
  }
  return { url: parsed.origin, publicKey };
}
