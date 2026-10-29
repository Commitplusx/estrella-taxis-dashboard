// There is no restaurant, billing or voice fallback in Stellar's independent worker.
import { tryTaxiQueue } from '../_shared/bot/taxis/runtime.ts';
import { corsHeaders, errorResponse, json, readJson } from '../_shared/tracking/http.ts';
export async function handleTaxiQueue(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Usa POST.', code: 'method_not_allowed' }, 405);
  try {
    const body = await readJson(req, 131072);
    return await tryTaxiQueue(req, body) ?? json({ processed: false, code: 'taxi_event_not_found' }, 404);
  } catch (error: unknown) { return errorResponse(error); }
}
if (import.meta.main) Deno.serve(handleTaxiQueue);
