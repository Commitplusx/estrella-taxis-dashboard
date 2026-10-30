import { TAXI_INTENT_CASES }from'../../tests/fixtures/taxi-intents.ts';
import { TAXI_LANGUAGE_CASES }from'../../tests/fixtures/taxi-language-hardening.ts';
import { TAXI_HELP_CASES }from'../../tests/fixtures/taxi-help-intents.ts';
import { taxiContextSession,matchesTaxiContext }from'../../tests/fixtures/taxi-contextual-intents.ts';
import { createTaxiInterpreter,TAXI_INTERPRETER_CONTRACT }from'../supabase/functions/_shared/bot/taxis/interpreter.ts';
import { emptyDraft,type Interpretation,type TaxiChannel,type TaxiSession }from'../supabase/functions/_shared/bot/taxis/contracts.ts';
import { fingerprint }from'../supabase/functions/_shared/tracking/contracts.ts';
const key=Deno.env.get('DEEPSEEK_API_KEY')??'',model=Deno.env.get('TAXI_EVAL_MODEL')??'';
if(!key||!model)throw new Error('Configura DEEPSEEK_API_KEY y TAXI_EVAL_MODEL en el entorno privado; no los pases por argumentos.');
const flags=Deno.args.filter(arg=>arg.startsWith('--')),outputs=Deno.args.filter(arg=>!arg.startsWith('--'));
if(flags.length>1||flags.some(arg=>arg!=='--suite=intents'&&arg!=='--suite=language'&&arg!=='--suite=help'))throw Error('Suite inválida: usa --suite=intents, --suite=language o --suite=help.');
const output=outputs[0];if(outputs.length!==1||!output.endsWith('.json'))throw new Error('Indica la ruta privada de salida JSON.');
const suite=flags[0]==='--suite=language'?'language':flags[0]==='--suite=help'?'help':'intents';
const interpreter=createTaxiInterpreter(fetch,key,model),session:TaxiSession={revision:0,mode:'bot',draft:emptyDraft(),active:null,history:[]};
const cases:{id:string;message:string;session:TaxiSession;matches:(actual:Interpretation)=>boolean}[]=suite!=='intents'
 ?(suite==='help'?TAXI_HELP_CASES:TAXI_LANGUAGE_CASES).map(item=>({id:item.id,message:item.message,session:taxiContextSession(item.context),matches:actual=>matchesTaxiContext(actual,item)}))
 :TAXI_INTENT_CASES.map(item=>({id:item.id,message:item.message,session,matches:actual=>{const fields=Object.fromEntries(Object.entries(actual.fields).map(([k,v])=>[k,v?.value]));return actual.intent===item.expected.intent&&Object.keys(fields).length===Object.keys(item.expected.fields).length&&Object.entries(item.expected.fields).every(([k,v])=>fields[k]===v)||(item.allowAbstention&&actual.intent==='ambiguous'&&Object.keys(actual.fields).length===0);}}));
if(cases.length>(suite==='language'?64:suite==='help'?20:12))throw new Error('La suite supera su límite declarado de llamadas sintéticas.');
const channel:TaxiChannel={tenantId:'11111111-1111-4111-8111-111111111111',waba:'+529630000001',enabled:false,name:'Base sintética',city:'Comitán de Domínguez, Chiapas',centerLat:16.25,centerLng:-92.13,radiusKm:20,dispatcher:null,model,baseCents:null,perKmCents:null,pricingMode:'road_distance'};
const results:{id:string;passed:boolean;abstained:boolean;latencyMs:number}[]=[];
const fixtureHash=await fingerprint(suite==='language'?TAXI_LANGUAGE_CASES:suite==='help'?TAXI_HELP_CASES:TAXI_INTENT_CASES),contextHash=await fingerprint(cases.map(item=>({id:item.id,session:item.session}))),promptStarted=Date.now(),deadline=AbortSignal.timeout(240000);
for(const item of cases){
  const start=performance.now();let passed=false,abstained=false;
  try{
    const result=await interpreter(item.message,item.session,channel,deadline);
    abstained=result.intent==='ambiguous'&&Object.keys(result.fields).length===0;passed=item.matches(result);
  }catch{abstained=true;passed=false;}
  results.push({id:item.id,passed,abstained,latencyMs:Math.round(performance.now()-start)});
  console.log(JSON.stringify(results[results.length-1]));if(deadline.aborted)break;
}
const report={version:'taxi-intents-v3-contextual',suite,model,fixtureHash,contextHash,contractHash:await fingerprint(TAXI_INTERPRETER_CONTRACT),startedAt:new Date(promptStarted).toISOString(),synthetic:true,training:false,blindAccuracyMeasured:false,cases:cases.length,executed:results.length,passed:results.filter((r)=>r.passed).length,results};
await Deno.writeTextFile(output,JSON.stringify(report,null,2));
if(results.length!==cases.length||results.some((r)=>!r.passed))Deno.exitCode=1;
