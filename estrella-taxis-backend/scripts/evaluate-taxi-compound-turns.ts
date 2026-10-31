import {createTaxiInterpreter,TAXI_INTERPRETER_CONTRACT} from '../supabase/functions/_shared/bot/taxis/interpreter.ts';
import {coordinateTaxi,type TaxiServices} from '../supabase/functions/_shared/bot/taxis/coordinator.ts';
import {TAXI_COMPOUND_CASES,TAXI_COMPOUND_CHANNEL,TAXI_COMPOUND_NOW,matchesTaxiCompound} from '../../tests/fixtures/taxi-compound-turns.ts';
import {fingerprint} from '../supabase/functions/_shared/tracking/contracts.ts';
const key=Deno.env.get('DEEPSEEK_API_KEY')??'',model=Deno.env.get('TAXI_EVAL_MODEL')??'',output=Deno.args[0];
if(!key||!model)throw Error('Configura DEEPSEEK_API_KEY y TAXI_EVAL_MODEL en el entorno privado.');
if(Deno.args.length!==1||!output.endsWith('.json'))throw Error('Indica una ruta privada de salida JSON.');
if(TAXI_COMPOUND_CASES.length!==24)throw Error('La suite tiene un límite fijo de 24 llamadas sintéticas.');
const channel={...TAXI_COMPOUND_CHANNEL,model},interpret=createTaxiInterpreter(fetch,key,model),deadline=AbortSignal.timeout(240000);
const results:{id:string;passed:boolean;calls:number;reason:string;latencyMs:number}[]=[];let cursor=0;
async function worker():Promise<void>{
 while(cursor<TAXI_COMPOUND_CASES.length&&!deadline.aborted){
  const index=cursor++,item=TAXI_COMPOUND_CASES[index],start=performance.now();let calls=0,passed=false,reason='pipeline_failed';
  const services:TaxiServices={interpret:async(current,session,ch,signal,_observe,turn)=>{calls++;if(calls>1)throw Error('Se superó el límite por caso.');return interpret(current,session,ch,signal,turn);},resolve:async()=>({kind:'unavailable'}),quote:async()=>item.expected.destinationLat===null?5500:6500,candidates:async()=>{throw Error('No se enviaron botones de confirmación.');}};
  try{const decision=await coordinateTaxi(item.messages,item.session,channel,services,TAXI_COMPOUND_NOW,deadline);passed=calls===1&&matchesTaxiCompound(decision,item);reason=decision.reason;}catch{/* Synthetic evaluation failures are explicit results. */}
  results[index]={id:item.id,passed,calls,reason,latencyMs:Math.round(performance.now()-start)};console.log(JSON.stringify(results[index]));
 }
}
await Promise.all([worker(),worker()]);
const passed=results.length===24&&results.every(item=>item.passed);
await Deno.writeTextFile(output,JSON.stringify({synthetic:true,blindAccuracyMeasured:false,model,cases:24,executed:results.length,fixtureHash:await fingerprint(TAXI_COMPOUND_CASES),contractHash:await fingerprint(TAXI_INTERPRETER_CONTRACT),passed,results},null,2));
if(!passed)Deno.exitCode=1;
