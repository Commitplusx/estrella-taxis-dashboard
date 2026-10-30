import { errorResponse,json } from '../../tracking/http.ts';
import { RestTrackingStore } from '../../tracking/store.ts';
import { TaxiEngine } from './engine.ts';
import { createTaxiServices } from './services.ts';
import { signedBody } from './transport.ts';
function engine():TaxiEngine|null{
  if(Deno.env.get('TAXI_BOT_ENABLED')!=='true')return null;
  const store=new RestTrackingStore(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'');
  const services=createTaxiServices(store,fetch,{mapsKey:Deno.env.get('GOOGLE_MAPS_API_KEY')??'',modelKey:Deno.env.get('DEEPSEEK_API_KEY')??'',traccarUrl:Deno.env.get('TRACCAR_URL')??'https://taxis.estrella-eats.mx/api',traccarEmail:Deno.env.get('TRACCAR_EMAIL')??'',traccarPassword:Deno.env.get('TRACCAR_PASSWORD')??'',geocoderUrl:Deno.env.get('TAXI_GEOCODER_URL')??'https://photon.komoot.io/api/'});
  return new TaxiEngine(store,services,{webhookSecret:Deno.env.get('TAXI_YCLOUD_WEBHOOK_SECRET')??'',workerSecret:Deno.env.get('TAXI_WORKER_SECRET')??'',ycloudKey:Deno.env.get('YCLOUD_API_KEY')??'',now:()=>Date.now()});
}
/** This deployment is dedicated to taxis; Robin's runs in its own checkout/worker. */
export async function tryTaxiWebhook(req:Request):Promise<Response|null>{
  if(req.method!=='POST')return json({error:'Usa POST.',code:'method_not_allowed'},405);
  try{const bot=engine();if(!bot)return json({error:'El canal de taxis aún no está habilitado.',code:'taxi_disabled'},503);
    return await bot.inbound(await signedBody(req.clone()),req.headers.get('YCloud-Signature'))??json({received:false,code:'taxi_channel_not_found'},404);}
  catch(error:unknown){return errorResponse(error);}
}
/** Uses the same process-queue endpoint, with a separate service-only credential. */
export async function tryTaxiQueue(req:Request,payload:unknown):Promise<Response|null>{
  if(req.method!=='POST')return json({error:'Usa POST.',code:'method_not_allowed'},405);
  try{const bot=engine();if(!bot)return json({error:'El worker de taxis aún no está habilitado.',code:'taxi_disabled'},503);
    return await bot.worker(payload,req.headers.get('x-taxi-worker-secret'),AbortSignal.any([req.signal,AbortSignal.timeout(65000)]))??json({processed:false,code:'taxi_event_not_found'},404);}
  catch(error:unknown){return errorResponse(error);}
}
