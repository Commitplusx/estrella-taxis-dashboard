import { TAXI_INTENT_CASES }from'../../tests/fixtures/taxi-intents.ts';
import { createTaxiInterpreter,TAXI_INTERPRETER_CONTRACT }from'../supabase/functions/_shared/bot/taxis/interpreter.ts';
import { emptyDraft,type TaxiChannel,type TaxiSession }from'../supabase/functions/_shared/bot/taxis/contracts.ts';
import { fingerprint }from'../supabase/functions/_shared/tracking/contracts.ts';
const key=Deno.env.get('DEEPSEEK_API_KEY')??'',model=Deno.env.get('TAXI_EVAL_MODEL')??'';
if(!key||!model)throw new Error('Configura DEEPSEEK_API_KEY y TAXI_EVAL_MODEL en el entorno privado; no los pases por argumentos.');
const output=Deno.args[0];if(!output||!output.endsWith('.json'))throw new Error('Indica la ruta privada de salida JSON.');
const cases=TAXI_INTENT_CASES;if(cases.length>12)throw new Error('El límite aprobado del evaluador es 12 llamadas sintéticas.');
const interpreter=createTaxiInterpreter(fetch,key,model),session:TaxiSession={revision:0,mode:'bot',draft:emptyDraft(),active:null,history:[]};
const channel:TaxiChannel={tenantId:'11111111-1111-4111-8111-111111111111',waba:'+529630000001',enabled:false,name:'Base sintética',city:'Comitán de Domínguez, Chiapas',centerLat:16.25,centerLng:-92.13,radiusKm:20,dispatcher:null,model,baseCents:null,perKmCents:null,pricingMode:'road_distance'};
const results:{id:string;passed:boolean;abstained:boolean;latencyMs:number}[]=[];
const fixtureHash=await fingerprint(cases),promptStarted=Date.now(),deadline=AbortSignal.timeout(240000);
for(const item of cases){
  const start=performance.now();let passed=false,abstained=false;
  try{
    const result=await interpreter(item.message,session,channel,deadline),fields=Object.fromEntries(Object.entries(result.fields).map(([k,v])=>[k,v?.value]));
    const exact=result.intent===item.expected.intent&&Object.keys(fields).length===Object.keys(item.expected.fields).length&&Object.entries(item.expected.fields).every(([k,v])=>fields[k]===v);
    abstained=result.intent==='ambiguous'&&Object.keys(fields).length===0;passed=exact||(item.allowAbstention&&abstained);
  }catch{abstained=true;passed=false;}
  results.push({id:item.id,passed,abstained,latencyMs:Math.round(performance.now()-start)});
  console.log(JSON.stringify(results[results.length-1]));if(deadline.aborted)break;
}
const report={version:'taxi-intents-v2-tools',model,fixtureHash,contractHash:await fingerprint(TAXI_INTERPRETER_CONTRACT),startedAt:new Date(promptStarted).toISOString(),synthetic:true,training:false,blindAccuracyMeasured:false,cases:cases.length,executed:results.length,passed:results.filter((r)=>r.passed).length,results};
await Deno.writeTextFile(output,JSON.stringify(report,null,2));
if(results.length!==cases.length||results.some((r)=>!r.passed))Deno.exitCode=1;
