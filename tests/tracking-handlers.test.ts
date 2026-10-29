import { FleetApi } from '../estrella-taxis-backend/supabase/functions/_shared/tracking/auth.ts';
import { createInsightsHandler } from '../estrella-taxis-backend/supabase/functions/ai-insights/handler.ts';
import { createScoresHandler } from '../estrella-taxis-backend/supabase/functions/calculate-driving-scores/handler.ts';
import { record } from '../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts';
import type { TrackingStore } from '../estrella-taxis-backend/supabase/functions/_shared/tracking/store.ts';
import type { Fetcher } from '../estrella-taxis-backend/supabase/functions/_shared/tracking/http.ts';
function assert(value:unknown,message='Assertion failed'):asserts value {if(!value)throw new Error(message);}
function equal(actual:unknown,expected:unknown){if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);}
const now=Date.parse('2026-10-27T18:00:00Z'),key='11111111-1111-4111-8111-111111111111';
const body={requestId:key,deviceIds:[1],from:'2026-10-26T06:00:00Z',to:'2026-10-27T05:59:59Z'};
const ok=(value:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});
class Store implements TrackingStore {
  async writePackages(): Promise<unknown[]> { throw new Error('No package writes.'); }
  async writeCompanyPackage(): Promise<unknown[]> { throw new Error('No package assignment writes.'); }
  async writeCompanyStatus(): Promise<unknown[]> { throw new Error('No base status writes.'); }
  begun=0;completed=0;written:readonly Record<string,unknown>[]=[];
  permitted=true;claimState='proceed';completeResult=true;history:unknown[]=[];replayed:unknown=null;
  async read(table:string,_query:URLSearchParams):Promise<unknown[]> {
    if(table==='perfiles')return [{empresa_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}];
    if(table==='empresas')return [{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',activo:true,paquete:{activo:true,permisos_sistema:{auditoria_ia:this.permitted,score_diario:this.permitted}}}];
    if(table==='driving_scores')return this.history;
    throw new Error('Unexpected table '+table);
  }
  async writeScores(rows:readonly Record<string,unknown>[]):Promise<void>{this.written=rows;}
  async rpc(name:string,params:Record<string,unknown>):Promise<unknown>{
    assert(params.p_user===42,'The authenticated Traccar identity must scope every operation.');
    if(name==='tracking_operation_begin') {this.begun++;return {state:this.claimState,lease:key,result:this.replayed,status:200};}
    if(name==='tracking_operation_complete') {this.completed++;assert(params.p_lease===key);this.replayed=params.p_result;return this.completeResult;}
    throw new Error('Unexpected RPC '+name);
  }
}
function fixture(options:{admin?:boolean;apiKey?:string;modelOutput?:unknown;providerStatus?:number;finishReason?:string;missingSummary?:boolean;badSummary?:boolean;badEvents?:boolean;badRoute?:boolean;sessionStatus?:number}={}) {
  const store=new Store();let providerCalls=0,reportCalls=0;let providerBody='';
  const fetcher:Fetcher=async(input,init)=>{
    const url=new URL(String(input));
    if(url.host==='api.deepseek.com') {
      providerCalls++;providerBody=String(init?.body);
      return ok({choices:[{finish_reason:options.finishReason??'stop',message:{content:JSON.stringify(options.modelOutput??{summary:'Revisar la actividad del motor.',recommendations:[{findingId:'activity-1',text:'Comprobar el registro de ignición.'}]})}}]},options.providerStatus??200);
    }
    if(url.pathname==='/api/session') {
      if(url.searchParams.has('token') && url.searchParams.get('token')!=='good-token-123') return ok({},401);
      return ok({id:42,administrator:options.admin??true,disabled:false},options.sessionStatus??200,{'set-cookie':'JSESSIONID=fixture-cookie-123; HttpOnly; Secure'});
    }
    assert(new Headers(init?.headers).get('Cookie')==='JSESSIONID=fixture-cookie-123','All provider data calls require the validated session.');
    if(url.pathname==='/api/devices') return ok([{id:1,name:'Nombre <script>no enviar al modelo</script>'}]);
    if(url.pathname.startsWith('/api/reports/')) {reportCalls++;assert(url.searchParams.getAll('deviceId').join(',')==='1','Only scoped devices can be queried.');}
    if(url.pathname==='/api/reports/summary') return ok(options.missingSummary?[]:[{deviceId:options.badSummary?2:1,distance:100,maxSpeed:10,averageSpeed:2,engineHours:7200000}]);
    if(url.pathname==='/api/reports/events') return ok(options.badEvents?[{id:1,deviceId:2,type:'deviceOffline',eventTime:'2026-10-26T12:00:00Z'}]:[]);
    if(url.pathname==='/api/reports/route')return ok(options.badRoute?{}:Array.from({length:20},(_,index)=>({id:index+1,deviceId:1,fixTime:new Date(Date.parse('2026-10-26T06:00:00Z')+index*10000).toISOString(),latitude:16.25,longitude:-92.13,speed:0,attributes:{ignition:true}})));
    throw new Error('Unexpected endpoint '+url.pathname);
  };
  const fleet=new FleetApi('https://tracking.test/api',fetcher);
  const audit=createInsightsHandler({fleet,store,fetcher,now:()=>now,apiKey:options.apiKey??'fixture-not-a-real-key',model:'fixture-model'});
  const scores=createScoresHandler({fleet,store,now:()=>now});
  const request=(payload:unknown=body,headers:Record<string,string>={'x-traccar-token':'good-token-123'})=>new Request('https://edge.test/ai-insights',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(payload)});
  return {store,audit,scores,request,calls:()=>({providerCalls,reportCalls,providerBody})};
}
Deno.test('audit rejects anonymous calls and expired sessions before accessing reports or model',async()=>{
  const f=fixture();equal((await f.audit(f.request(body,{}))).status,401);equal(f.calls().providerCalls,0);equal(f.calls().reportCalls,0);
  const expired=fixture({sessionStatus:401});equal((await expired.audit(expired.request())).status,401);equal(expired.calls().providerCalls,0);
});
Deno.test('audit rejects a forged device scope, package permission and browser-supplied totals',async()=>{
  const f=fixture();equal((await f.audit(f.request({...body,deviceIds:[2]}))).status,403);equal(f.store.begun,0);
  equal((await f.audit(f.request({...body,summary:[{distance:99999}]}))).status,400);
  const noPlan=fixture({admin:false});noPlan.store.permitted=false;
  equal((await noPlan.audit(noPlan.request())).status,403);equal(noPlan.calls().providerCalls,0);
});
Deno.test('audit validates real source data and does not send names, positions or contacts to model',async()=>{
  const f=fixture();const response=await f.audit(f.request());equal(response.status,200);
  const value:unknown=await response.json();assert(record(value));equal(value.narrativeStatus,'generated');
  equal(f.calls().providerCalls,1);equal(f.store.completed,1);
  assert(!f.calls().providerBody.includes('Nombre <script>'));assert(!f.calls().providerBody.includes('latitude'));
});
for(const [name,options] of [['foreign summary',{badSummary:true}],['foreign events',{badEvents:true}]] as const) {
  Deno.test('audit rejects '+name+' without generating an interpretation',async()=>{
    const f=fixture(options);equal((await f.audit(f.request())).status,502);equal(f.calls().providerCalls,0);
  });
}
for(const [name,options] of [
  ['HTML',{modelOutput:{summary:'<img src=x onerror=alert(1)>',recommendations:[]}}],
  ['invented evidence',{modelOutput:{summary:'Revisar',recommendations:[{findingId:'invented',text:'Suspender conductor'}]}}],
  ['truncated output',{finishReason:'length'}],['provider failure',{providerStatus:500}],
] as const) {
  Deno.test('audit marks AI unavailable for '+name+' and preserves verified findings',async()=>{
    const f=fixture(options),response=await f.audit(f.request());equal(response.status,200);
    const data:unknown=await response.json();assert(record(data));equal(data.narrativeStatus,'unavailable');equal(data.narrative,null);
    assert(record(data.facts) && Array.isArray(data.facts.findings) && data.facts.findings.length===1);
  });
}
Deno.test('missing key is explicit and never pretends that an AI report was generated',async()=>{
  const f=fixture({apiKey:''});const data:unknown=await (await f.audit(f.request())).json();assert(record(data));equal(data.narrativeStatus,'not_configured');equal(f.calls().providerCalls,0);
});
Deno.test('replayed request returns the stored result without another provider call',async()=>{
  const f=fixture();equal((await f.audit(f.request())).status,200);f.store.claimState='replay';
  equal((await f.audit(f.request())).status,200);equal(f.calls().providerCalls,1);equal(f.calls().reportCalls,2);
});
for(const [state,status] of [['limited',429],['running',409],['uncertain',409],['conflict',409]] as const) {
  Deno.test('durable operation gate rejects '+state+' without calling the model',async()=>{
    const f=fixture();f.store.claimState=state;equal((await f.audit(f.request())).status,status);equal(f.calls().providerCalls,0);
  });
}
Deno.test('an unconfirmed persistence response stays uncertain instead of reporting success',async()=>{
  const f=fixture();f.store.completeResult=false;equal((await f.audit(f.request())).status,503);
});
Deno.test('score calculation uses one server algorithm and persists version and quality',async()=>{
  const f=fixture();const response=await f.scores(f.request({action:'calculate',requestId:key,deviceIds:[1],date:'2026-10-26'}));equal(response.status,200);
  equal(f.store.written.length,1);equal(f.store.written[0].algorithm_version,'tracking-score-v2');assert(record(f.store.written[0].quality));
});
Deno.test('an invalid route cannot be saved as a score of 100',async()=>{
  const f=fixture({badRoute:true});equal((await f.scores(f.request({action:'calculate',requestId:key,deviceIds:[1],date:'2026-10-26'}))).status,413);equal(f.store.written.length,0);
});
Deno.test('score history is scoped by authenticated devices and rejects foreign database rows',async()=>{
  const f=fixture();f.store.history=[{device_id:2}];
  equal((await f.scores(f.request({action:'history',deviceIds:[1],date:'2026-10-26'}))).status,502);
  equal((await f.scores(f.request({action:'history',deviceIds:[2],date:'2026-10-26'}))).status,403);
});
Deno.test('score history validates dates and scores even when the store violates its query',async()=>{
  const f=fixture();
  const valid={device_id:1,score_date:'2026-10-26',score:80};
  f.store.history=[valid];equal((await f.scores(f.request({action:'history',deviceIds:[1],date:'2026-10-26'}))).status,200);
  for(const invalid of [{...valid,device_id:'1'},{...valid,score_date:'2026-10-25'},{...valid,score_date:'2026-02-30'},{...valid,score:101}]) {
    f.store.history=[invalid];equal((await f.scores(f.request({action:'history',deviceIds:[1],date:'2026-10-26'}))).status,502);
  }
});
Deno.test('scheduled scoring rejects an absent or weak job secret before accessing the fleet',async()=>{
  const f=fixture();
  const result=await f.scores(f.request({action:'calculate',deviceIds:[1],date:'2026-10-26'},{'x-tracking-job-secret':'not-configured'}));
  equal(result.status,401);equal(f.calls().reportCalls,0);equal(f.store.begun,0);
});
Deno.test('body limits and invalid methods are handled before provider work',async()=>{
  const f=fixture();equal((await f.audit(new Request('https://edge.test',{method:'GET'}))).status,405);
  equal((await f.audit(f.request({text:'x'.repeat(17000)}))).status,413);equal(f.calls().providerCalls,0);
});
