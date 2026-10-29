// Stellar's independent project only. Robin's keeps its own deployed entrypoint.
import { tryTaxiWebhook } from '../_shared/bot/taxis/runtime.ts';
import { corsHeaders, json } from '../_shared/tracking/http.ts';
export async function handleTaxiWebhook(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  return await tryTaxiWebhook(req) ?? json({ received: false, code: 'taxi_channel_not_found' }, 404);
}
if (import.meta.main) Deno.serve(handleTaxiWebhook);
