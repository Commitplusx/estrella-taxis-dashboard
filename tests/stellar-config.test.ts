import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stellarBackendConfig, STELLAR_PROJECT_ID } from '../src/lib/stellarBackendConfig.ts';
const publicKey = 'sb_publishable_fixture_public_key';

test('a clean build includes only the independent project public browser configuration', () => {
  const config: unknown = JSON.parse(readFileSync(new URL('../deployment/stellar/web-public.json', import.meta.url), 'utf8'));
  assert.ok(typeof config === 'object' && config !== null && !Array.isArray(config));
  assert.deepEqual(Object.keys(config).sort(), ['publishableKey', 'url']);
  assert.ok('url' in config && 'publishableKey' in config);
  const validated = stellarBackendConfig({
    VITE_STELLAR_SUPABASE_URL: config.url,
    VITE_STELLAR_SUPABASE_PUBLISHABLE_KEY: config.publishableKey,
  });
  assert.equal(validated.url, `https://${STELLAR_PROJECT_ID}.supabase.co`);
  assert.ok(validated.publicKey.startsWith('sb_publishable_'));
});
test('Stellar cannot reconnect to restaurant or delivery projects through a build override', () => {
  for (const ref of ['knghdwpxheenkpuajkxl','jdrrkpvodnqoljycixbg','jsuufgmhukfzhpgceowk','zqwiqhdvwkvoufkdjbhm','ynqphaxvoauzmqsempis']) {
    assert.throws(() => stellarBackendConfig({ VITE_STELLAR_SUPABASE_URL: 'https://' + ref + '.supabase.co', VITE_STELLAR_SUPABASE_PUBLISHABLE_KEY: publicKey }), /independiente/);
  }
  assert.throws(() => stellarBackendConfig({}), /Configura/);
  assert.throws(() => stellarBackendConfig({ VITE_STELLAR_SUPABASE_URL: 'https://' + STELLAR_PROJECT_ID + '.supabase.co', VITE_STELLAR_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_not_a_browser_key' }), /Configura/);
  assert.equal(stellarBackendConfig({ VITE_STELLAR_SUPABASE_URL: 'https://' + STELLAR_PROJECT_ID + '.supabase.co', VITE_STELLAR_SUPABASE_PUBLISHABLE_KEY: publicKey }).url, 'https://' + STELLAR_PROJECT_ID + '.supabase.co');
});
