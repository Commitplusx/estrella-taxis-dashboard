import { createClient } from '@supabase/supabase-js';
import { stellarBackendConfig } from './stellarBackendConfig';
import publicConfig from '../../deployment/stellar/web-public.json';
export const config = stellarBackendConfig({
  VITE_STELLAR_SUPABASE_URL: import.meta.env.VITE_STELLAR_SUPABASE_URL ?? publicConfig.url,
  VITE_STELLAR_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_STELLAR_SUPABASE_PUBLISHABLE_KEY ?? publicConfig.publishableKey,
});
export const supabase = createClient(config.url, config.publicKey);
