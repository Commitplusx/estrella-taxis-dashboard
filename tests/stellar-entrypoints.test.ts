import { handleTaxiWebhook } from '../estrella-taxis-backend/supabase/functions/ycloud-webhook/index.ts';
import { handleTaxiQueue } from '../estrella-taxis-backend/supabase/functions/process-queue/index.ts';
import { record } from '../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts';
function assert(value: unknown): asserts value { if (!value) throw new Error('Assertion failed'); }
for (const handler of [handleTaxiWebhook, handleTaxiQueue]) {
  Deno.test('Stellar entrypoints reject unrelated methods and handle preflight without a legacy startup', async () => {
    assert((await handler(new Request('https://fixture.invalid', { method: 'OPTIONS' }))).status === 200);
    assert((await handler(new Request('https://fixture.invalid', { method: 'GET' }))).status === 405);
  });
}
Deno.test('Stellar queue rejects malformed and excessive payloads before selecting any business flow', async () => {
  for (const body of ['{', 'x'.repeat(131073)]) {
    const response = await handleTaxiQueue(new Request('https://fixture.invalid', { method: 'POST', body }));
    assert(response.status === 400 || response.status === 413);
    const payload: unknown = await response.json(); assert(record(payload) && payload.code !== 'taxi_event_not_found');
  }
});
