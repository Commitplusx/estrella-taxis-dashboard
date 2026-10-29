import test from 'node:test';
import assert from 'node:assert/strict';
import { packageStellarFunction } from '../estrella-taxis-backend/scripts/package-stellar-functions.ts';
test('Stellar deployment bundles contain the real taxi runtime and no restaurant fallback or private settings', () => {
  for (const entry of ['ycloud-webhook', 'process-queue', 'taxi-bot-admin']) {
    const files = packageStellarFunction(entry);
    assert.ok(files.some((file) => file.name === entry + '/index.ts'));
    if (entry !== 'taxi-bot-admin') assert.ok(files.some((file) => file.name.endsWith('/taxis/conversationTools.ts')));
    assert.ok(files.every((file) => !/restaurante|\.env|ecosystem|loyalty|\\/.test(file.name)));
    assert.ok(!files.some((file) => /\/core\/router\.ts$/.test(file.name)));
    const imports = files.find((file) => file.name === entry + '/deno.json');
    assert.ok(imports?.content.includes('npm:h3-js@4.5.0'));
  }
  assert.throws(() => packageStellarFunction('vapi-robins'), /Unsupported/);
  assert.throws(() => packageStellarFunction('../ycloud-webhook'), /Unsupported/);
});
