import type {Fetcher} from '../../tracking/http.ts';
import {readJson} from '../../tracking/http.ts';
import {TrackingError,record} from '../../tracking/contracts.ts';

export interface GpsRefreshConfig {url:string;secret:string}
/** Server-to-server only. Do not select a taxi after a failed refresh. */
export async function refreshTaxiGps(fetcher:Fetcher,config:GpsRefreshConfig,signal?:AbortSignal):Promise<void>{
 const fail=()=>new TrackingError(503,'taxi_gps_refresh_unavailable','No pudimos actualizar las ubicaciones de las unidades. La búsqueda continuará en la siguiente ronda.');
 if(config.secret.length<32||config.url!=='https://taxis.estrella-eats.mx/taxi-gps-refresh')throw fail();
 try{
  const response=await fetcher(config.url,{method:'POST',headers:{'x-taxi-worker-secret':config.secret},redirect:'error',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(10000)])});
  if(!response.ok){await response.body?.cancel();throw fail();}
  const raw=await readJson(response,2048);
  const at=record(raw)&&typeof raw.completedAt==='string'?Date.parse(raw.completedAt):NaN;
  if(!record(raw)||raw.state!=='refreshed'||!Number.isSafeInteger(raw.synced)||typeof raw.synced!=='number'||raw.synced<1||!Number.isFinite(at)||Date.now()-at>15000||at-Date.now()>5000)throw fail();
 }catch{throw fail();}
}
