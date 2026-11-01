import { customerPhone, customerPhones, parseCustomerAccess } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/customerAccess.ts';
import { createTaxiAdminHandler } from '../estrella-taxis-backend/supabase/functions/taxi-bot-admin/handler.ts';
import { FleetApi } from '../estrella-taxis-backend/supabase/functions/_shared/tracking/auth.ts';
import type { TrackingStore } from '../estrella-taxis-backend/supabase/functions/_shared/tracking/store.ts';
import { record } from '../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts';
function assert(value: unknown): asserts value { if (!value) throw new Error('Assertion failed'); }
function equal(a: unknown, b: unknown) { assert(JSON.stringify(a) === JSON.stringify(b)); }
const tenant='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',customer='+529630000002';
const denyAdminWrite = async (): Promise<never> => { throw new Error('No administration writes in this fixture.'); };
function fixture(role='admin_empresa',result:unknown={restricted:true,revision:1,phones:[customer],state:'saved'},expectedMode?:boolean,readResult:unknown={restricted:true,revision:0,phones:[]}) {
  let writes=0,reads=0;
  const store:TrackingStore={writePackages:denyAdminWrite,writeCompanyPackage:denyAdminWrite,writeCompanyStatus:denyAdminWrite,read:async(table,q)=>{
    if(table==='perfiles'){equal(q.get('traccar_user_id'),'eq.42');return[{empresa_id:tenant,rol:role}];}
    equal(table,'empresas');equal(q.get('id'),'eq.'+tenant);return[{id:tenant,tipo_negocio:'taxi'}];
  },writeScores:async()=>{throw new Error('Forbidden score write');},rpc:async(name,args)=>{
    equal(args.p_tenant,tenant);
    if(name==='taxi_bot_customer_access_read'){reads++;return readResult;}
    equal(name,expectedMode===undefined?'taxi_bot_customer_access_apply':'taxi_bot_customer_access_configure');
    if(expectedMode!==undefined)equal(args.p_restricted,expectedMode);
    equal(args.p_actor,42);equal(args.p_phones,[customer]);writes++;return result;
  }};
  const handler=createTaxiAdminHandler({store,runtimeReady:false,fleet:new FleetApi('https://tracking.test/api',async(input)=>{equal(new URL(String(input)).pathname,'/api/session');return new Response(JSON.stringify({id:42,administrator:false,disabled:false}),{headers:{'set-cookie':'JSESSIONID=fixture-cookie-123; Secure'}});})});
  const request=(body:unknown,auth=true)=>new Request('https://edge.test/taxi-bot-admin',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{'x-traccar-token':'fixture-token-123'}:{})},body:JSON.stringify(body)});
  const write={action:'set_customer_access',tenantId:tenant,requestId:crypto.randomUUID(),revision:0,phones:[customer]};
  return{handler,request,write,counts:()=>({reads,writes})};
}
Deno.test('authorized customers: local Mexican and legacy provider numbers match without accepting arbitrary text',()=>{
  equal(customerPhone('963 000 0002'),customer);equal(customerPhone('+5219630000002'),customer);equal(customerPhone('+52 963 000 0002'),customer);
  for(const invalid of ['call 9630000002','https://9630000002','+52*9630000002',null,42])equal(customerPhone(invalid),null);
  for(const invalid of [[customer,'+5219630000002'],Array(101).fill(customer),[null]]){let rejected=false;try{customerPhones(invalid);}catch{rejected=true;}assert(rejected);}
});
Deno.test('authorized customers: a response must explicitly prove its open or restricted mode',()=>{
  for(const restricted of [true,false])equal(parseCustomerAccess({restricted,revision:0,phones:[]}).restricted,restricted);
  for(const restricted of [undefined,'true',0,null]){let rejected=false;try{parseCustomerAccess({restricted,revision:0,phones:[]});}catch{rejected=true;}assert(rejected);}
});
Deno.test('authorized customers: authenticated operators can read their own list before a channel exists',async()=>{
  const f=fixture('operador'),response=await f.handler(f.request({action:'customer_access',tenantId:tenant}));equal(response.status,200);const body:unknown=await response.json();equal(parseCustomerAccess(body).phones,[]);equal(f.counts(),{reads:1,writes:0});
});
Deno.test('authorized customers: unauthenticated, cross-tenant and operator writes cannot change access',async()=>{
  const f=fixture();equal((await f.handler(f.request(f.write,false))).status,401);equal((await f.handler(f.request({...f.write,tenantId:other}))).status,403);equal((await f.handler(f.request({...f.write,actor:999}))).status,400);equal(f.counts().writes,0);
  const operator=fixture('operador');equal((await operator.handler(operator.request(operator.write))).status,403);equal(operator.counts().writes,0);
});
Deno.test('authorized customers: saving binds the real administrator and validates canonical numbers',async()=>{
  const f=fixture();const response=await f.handler(f.request({...f.write,phones:['963 000 0002']}));equal(response.status,200);const body:unknown=await response.json();assert(record(body));equal(body.state,'saved');equal(parseCustomerAccess(body).phones,[customer]);equal(f.counts().writes,1);
});
Deno.test('authorized customers: revision conflicts and malformed write acknowledgments never report success',async()=>{
  const conflict=fixture('admin_empresa',{state:'revision_conflict'});equal((await conflict.handler(conflict.request(conflict.write))).status,409);
  const broken=fixture('admin_empresa',{state:'saved',revision:1,phones:[customer]});equal((await broken.handler(broken.request(broken.write))).status,502);
});
Deno.test('pilot access: reads preserve public mode instead of falsely reporting a closed list',async()=>{
  const f=fixture('operador',undefined,undefined,{restricted:false,revision:2,phones:[customer]});
  const response=await f.handler(f.request({action:'customer_access',tenantId:tenant}));equal(response.status,200);
  equal(parseCustomerAccess(await response.json()),{restricted:false,revision:2,phones:[customer]});
});
for(const restricted of [true,false])Deno.test('pilot access: administrator can atomically save mode '+restricted+' and the retained list',async()=>{
  const f=fixture('admin_empresa',{restricted,revision:1,phones:[customer],state:'saved'},restricted);
  const response=await f.handler(f.request({...f.write,restricted}));equal(response.status,200);
  equal(parseCustomerAccess(await response.json()).restricted,restricted);equal(f.counts().writes,1);
});
Deno.test('pilot access: malformed modes and unauthorized mode changes never reach the write RPC',async()=>{
  const f=fixture();
  for(const restricted of [null,'false',0])equal((await f.handler(f.request({...f.write,restricted}))).status,400);
  equal(f.counts().writes,0);
  for(const role of ['operador','driver','owner']){
    const limited=fixture(role);equal((await limited.handler(limited.request({...limited.write,restricted:false}))).status,403);equal(limited.counts().writes,0);
  }
});
