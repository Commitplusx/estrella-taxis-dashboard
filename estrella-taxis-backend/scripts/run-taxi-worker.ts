// Consumer for the existing process-queue endpoint. No local conversation state.
import { readJson } from '../supabase/functions/_shared/tracking/http.ts';
import { record } from '../supabase/functions/_shared/tracking/contracts.ts';
const target=new URL(Deno.env.get('TAXI_PROCESS_QUEUE_URL')??'');
const secret=Deno.env.get('TAXI_WORKER_SECRET')??'';
if(target.protocol!=='https:'||target.username||target.password||target.search||target.hash||!target.pathname.endsWith('/functions/v1/process-queue')||secret.length<32)throw new Error('Configura el endpoint HTTPS y el secreto privado del worker de taxis.');
let stopped=false,failures=0;
const shutdown=()=>{stopped=true;};Deno.addSignalListener('SIGINT',shutdown);
while(!stopped){
  try{
    const response=await fetch(target,{method:'POST',headers:{'Content-Type':'application/json','x-taxi-worker-secret':secret},body:JSON.stringify({action:'taxi_tick'}),signal:AbortSignal.timeout(110000),redirect:'error'});
    if(!response.ok){await response.body?.cancel();throw new Error('Worker request failed.');}
    const result=await readJson(response,16384);
    if(!record(result)||typeof result.processed!=='number'||typeof result.deferred!=='number'||typeof result.failed!=='number')throw new Error('Worker response not confirmed.');
    failures=0;console.log(JSON.stringify({event:'taxi_tick',processed:result.processed,deferred:result.deferred,failed:result.failed}));
  }catch{failures++;console.error(JSON.stringify({event:'taxi_tick_failed',consecutive:failures}));if(failures>=6){Deno.exitCode=1;break;}}
  if(!stopped)await new Promise<void>((resolve)=>setTimeout(resolve,Math.min(60000,2500*2**failures)));
}
Deno.removeSignalListener('SIGINT',shutdown);
