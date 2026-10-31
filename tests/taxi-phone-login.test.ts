import {assertEquals,assertRejects} from 'https://deno.land/std@0.177.0/testing/asserts.ts';
import {phoneLogin} from '../estrella-taxis-backend/supabase/functions/taxi-bot-admin/phoneLogin.ts';
import {FleetApi} from '../estrella-taxis-backend/supabase/functions/_shared/tracking/auth.ts';
import {TrackingError} from '../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts';
import {loginPhone} from '../estrella-taxis-backend/supabase/functions/_shared/tracking/phoneLogin.ts';
import type {TrackingStore} from '../estrella-taxis-backend/supabase/functions/_shared/tracking/store.ts';
const tenant='11111111-1111-4111-8111-111111111111',phone='+529630000021';
type Failure='unknown'|'limited'|'disabled'|'admin'|'wrong_password'|'wrong_identity'|'extra_device'|'missing_device'|'scope_changed'|'bad_token'|'manager';
function fixture(failure?:Failure){
 const requests:{path:string;method:string}[]=[],rpcCalls:string[]=[];
 const account={userId:21,deviceId:1,deviceIds:[1,2],tenantId:tenant};
 const deny=async():Promise<never>=>{throw Error('Undeclared write');};
 const store:TrackingStore={read:deny,writeScores:deny,writePackages:deny,writeCompanyPackage:deny,writeCompanyStatus:deny,rpc:async(name,args)=>{
  rpcCalls.push(name);assertEquals(args,{p_phone:phone});
  if(name==='taxi_phone_login_begin')return{allowed:failure!=='limited',account:failure==='unknown'?null:account};
  if(name==='taxi_phone_login_scope')return failure==='scope_changed'?null:account;
  throw Error('Undeclared RPC '+name);
 }};
 const fleet=new FleetApi('https://fleet.invalid/api',async(input,init)=>{
  const path=new URL(String(input)).pathname.replace('/api',''),method=init?.method??'GET';requests.push({path,method});
  if(path==='/users/21'){assertEquals(new Headers(init?.headers).get('Cookie'),'JSESSIONID=manager-session');return Response.json({id:21,email:'private@example.test',administrator:failure==='admin',disabled:failure==='disabled'});}
  if(path==='/session'&&method==='POST'){
   const body=init?.body;assertEquals(body instanceof URLSearchParams?Object.fromEntries(body):null,{email:'private@example.test',password:'Correct-fixture-123'});
   return failure==='wrong_password'?new Response(null,{status:401}):Response.json({id:21},{headers:{'Set-Cookie':'JSESSIONID=personal-session; HttpOnly; Secure'}});
  }
  assertEquals(new Headers(init?.headers).get('Cookie'),'JSESSIONID=personal-session');
  if(path==='/session')return Response.json({id:failure==='wrong_identity'?22:21,administrator:false,disabled:false});
  if(path==='/devices')return Response.json((failure==='extra_device'?[1,2,3]:failure==='missing_device'?[1]:[1,2]).map(id=>({id,name:'Unidad sintética'})));
  if(path==='/session/token')return new Response(failure==='bad_token'?'invalid token':''+'fixture-token-123');
  throw Error('Undeclared provider request '+path);
 });
 const manager=async()=>({userId:99,admin:failure!=='manager',cookie:'JSESSIONID=manager-session'});
 const run=(patch:Record<string,unknown>={})=>phoneLogin({action:'phone_login',phone,password:'Correct-fixture-123',client:'apk',...patch},fleet,store,manager,new AbortController().signal);
 return{run,requests,rpcCalls};
}
Deno.test('phone alias accepts Mexican national, international and legacy mobile prefix, rejects invalid or email input',()=>{
 for(const p of ['9630000021','+52 963 000 0021','+5219630000021'])assertEquals(loginPhone(p),phone);
 for(const p of ['+1 (202) 555-0123','+502 1234 5678'])assertEquals(typeof loginPhone(p),'string');
 for(const p of ['',null,42,'private@example.test','96300002','+9999630000021','963/0000021'])assertEquals(loginPhone(p),null);
});
Deno.test('phone login APK verifies password, exact authorized taxis and current scope without returning provider email',async()=>{
 const f=fixture(),result=await f.run();assertEquals(result,{session:'JSESSIONID=personal-session'});assertEquals(f.rpcCalls,['taxi_phone_login_begin','taxi_phone_login_scope']);assertEquals(f.requests.some(r=>r.path==='/session/token'),false);
});
Deno.test('phone login web returns only a short lived user token, never the manager session',async()=>{
 const f=fixture();assertEquals(await f.run({client:'web'}),{token:'fixture-token-123'});assertEquals(f.requests.filter(r=>r.path==='/session/token').length,1);
});
for(const failure of ['unknown','disabled','admin','wrong_password','wrong_identity','extra_device','missing_device','scope_changed'] as const)Deno.test('phone login denies '+failure+' with the same generic credentials error',async()=>{
 const f=fixture(failure),e=await assertRejects(()=>f.run(),TrackingError);assertEquals(e.status,401);assertEquals(e.code,'invalid_credentials');assertEquals(f.requests.some(r=>r.path==='/session/token'),false);
});
Deno.test('durable login limit blocks provider requests before looking up accounts',async()=>{
 const f=fixture('limited'),e=await assertRejects(()=>f.run(),TrackingError);assertEquals(e.status,429);assertEquals(f.requests,[]);
});
for(const patch of [{phone:'bad'},{password:''},{password:'x'.repeat(129)},{client:'other'},{userId:99},{email:'other@example.test'},{session:'JSESSIONID=injected'}])Deno.test('phone login rejects expanded or malformed request '+JSON.stringify(Object.keys(patch)),async()=>{
 const f=fixture();await assertRejects(()=>f.run(patch),TrackingError);assertEquals(f.rpcCalls,[]);assertEquals(f.requests,[]);
});
Deno.test('malformed token and non-admin manager never return a session',async()=>{
 for(const failure of ['bad_token','manager'] as const){const f=fixture(failure);await assertRejects(()=>f.run({client:'web'}),TrackingError);}
});
