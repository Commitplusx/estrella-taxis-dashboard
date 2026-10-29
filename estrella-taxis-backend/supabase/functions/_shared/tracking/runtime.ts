import { FleetApi } from './auth.ts';
import { RestTrackingStore } from './store.ts';
export function trackingRuntime() {
  return {
    fleet:new FleetApi(Deno.env.get('TRACCAR_URL') ?? 'https://taxis.estrella-eats.mx/api'),
    store:new RestTrackingStore(Deno.env.get('SUPABASE_URL') ?? '',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''),
    fetcher:fetch,
    now:()=>Date.now(),
    model:Deno.env.get('DEEPSEEK_MODEL') ?? 'deepseek-chat',
    apiKey:Deno.env.get('DEEPSEEK_API_KEY') ?? '',
    job:{secret:Deno.env.get('TRACKING_JOB_SECRET') ?? '',email:Deno.env.get('TRACCAR_EMAIL') ?? '',password:Deno.env.get('TRACCAR_PASSWORD') ?? ''},
  };
}
