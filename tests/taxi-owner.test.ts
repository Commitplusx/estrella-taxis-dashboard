import{assert,assertEquals,assertRejects,assertThrows}from'https://deno.land/std@0.177.0/testing/asserts.ts';
import{ownerRequest}from'../estrella-taxis-backend/supabase/functions/taxi-bot-admin/owners.ts';
import{parseOwnerContext}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/ownerContracts.ts';
import{FleetApi}from'../estrella-taxis-backend/supabase/functions/_shared/tracking/auth.ts';
import{record,TrackingError}from'../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts';
import type{TrackingStore}from'../estrella-taxis-backend/supabase/functions/_shared/tracking/store.ts';
const tenant='11111111-1111-4111-8111-111111111111',ownerId='22222222-2222-4222-8222-222222222222',contactId='33333333-3333-f333-0333-333333333333',requestId='44444444-4444-4444-8444-444444444444';
const version='a'.repeat(32),waba='+529630000001';
const person={id:contactId,unitNumber:'487',name:'Chofer sintético',phoneInput:'+529630000003',phone:'+529630000003',role:'driver',deviceId:7,receiving:false,version,accountUserId:82};
const context={owner:{...person,id:ownerId,role:'owner',accountUserId:42},tenantId:tenant,waba,deviceId:7,drivers:[person],driver:{deviceId:7,name:'Otro chofer',phone:'+529630000004',active:true,version},busy:false,pending:[]};
for(const patch of [{deviceId:8},{owner:{...context.owner,role:'driver'}},{drivers:[{...person,deviceId:8}]},{drivers:[person,person]},{pending:[{requestId,contactId:ownerId,expected:null,name:'Nombre',phone:'+529630000009',email:null,review:false}]},{busy:'yes'},{driver:{...context.driver,deviceId:8}}])Deno.test('owner context rejects malformed or foreign scope '+JSON.stringify(patch),()=>{assertThrows(()=>parseOwnerContext({...context,...patch}));});
function fixture(options:{visible?:boolean;disabled?:boolean;managerAdmin?:boolean;shiftState?:string;invalidShiftResult?:boolean;createLost?:boolean;registration?:boolean}={}){
 const calls:{name:string;args:Record<string,unknown>}[]=[],writes:{method:string;path:string;body:Record<string,unknown>}[]=[];
 const deny=async():Promise<never>=>{throw Error('Undeclared write');};
 let users:Record<string,unknown>[]=[],grants:number[]=[],created=0,activated=false,createLost=options.createLost===true,leaseExpired=false,beginCalls=0;
 const roster=()=>({...context,drivers:options.registration?[{...person,accountUserId:activated?82:null}]:context.drivers});
 const store:TrackingStore={writeScores:deny,writePackages:deny,writeCompanyPackage:deny,writeCompanyStatus:deny,
  read:async(table)=>{assertEquals(table,'perfiles');return[{traccar_user_id:42,empresa_id:tenant,rol:'owner'}];},
  rpc:async(name,args)=>{calls.push({name,args});
   if(name==='taxi_owner_read'){assertEquals(args,{p_user:42});return roster();}
   if(name==='taxi_owner_shift_apply'){assertEquals(args.p_user,42);return options.invalidShiftResult?null:{state:options.shiftState??'saved'};}
   if(name==='taxi_owner_contact_save'){assertEquals(args.p_user,42);return{state:'saved',contact:{...person,accountUserId:null},driverVersion:version};}
   if(name==='taxi_bot_contacts_read')return{contacts:[{...person,accountUserId:activated?82:null}],linkedUnitIds:[7],drivers:[context.driver],activeCount:1,zoneCount:1};
   if(name==='taxi_account_begin'){assertEquals(args.p_actor,42);beginCalls++;if(options.createLost&&beginCalls>1&&!leaseExpired)return{state:'running'};return{state:'proceed',lease:requestId};}
   if(name==='taxi_account_finish'){assertEquals(args.p_actor,42);return{state:'saved',userId:82,email:'driver@example.test',contact:{...person,accountUserId:82}};}
   if(name==='taxi_owner_account_allowed'){assertEquals(args.p_actor,42);return true;}
   if(name==='taxi_account_activated'){assertEquals(args.p_actor,42);activated=true;return true;}
   throw Error('Undeclared RPC '+name);
  }};
 const fleet=new FleetApi('https://fleet.invalid/api',async(input,init)=>{
  const url=new URL(String(input)),path=url.pathname.replace('/api','')+url.search,method=init?.method??'GET',cookie=new Headers(init?.headers).get('Cookie');
  if(method==='GET'){
   if(path==='/devices')return Response.json(options.visible===false?[]:[{id:7,name:'Taxi sintético'}]);
   assertEquals(cookie,'JSESSIONID=manager-session');
   if(path==='/users/82')return Response.json({id:82,administrator:false,disabled:options.disabled===true});
   if(path==='/users')return Response.json(users);
   if(path.startsWith('/groups?'))return Response.json([]);
   if(path.startsWith('/devices?'))return Response.json(grants.map(id=>({id,name:'Taxi sintético'})));
  }
  assertEquals(cookie,'JSESSIONID=manager-session');const body:unknown=typeof init?.body==='string'?JSON.parse(init.body):null;assert(record(body));writes.push({method,path,body});
  if(path==='/users'&&method==='POST'){created++;const target={...body,id:82,password:undefined};users.push(target);if(createLost){createLost=false;throw Error('Declared lost create response');}return Response.json(target);}
  if(path==='/users/82'&&method==='PUT'){users=[body];return Response.json(body);}
  if(path==='/permissions'){if(method==='POST'&&body.deviceId===7)grants=[7];return new Response(null,{status:204});}
  throw Error('Undeclared provider request '+path);
 });
 const manager=async()=>({userId:99,admin:options.managerAdmin!==false,cookie:'JSESSIONID=manager-session'});
 const run=(raw:Record<string,unknown>,available=true)=>ownerRequest(raw,{userId:42,admin:false,cookie:'JSESSIONID=owner-session'},fleet,store,available?manager:undefined,new AbortController().signal);
 return{run,calls,writes,get created(){return created;},get users(){return users;},get activated(){return activated;},expire:()=>{leaseExpired=true;}};
}
Deno.test('owner read derives the taxi from verified identity, never a supplied tenant or device',async()=>{
 const f=fixture();assertEquals((await f.run({action:'owner_context'})).deviceId,7);assertEquals(f.writes.length,0);
 for(const patch of [{tenantId:tenant},{deviceId:8},{userId:99}])await assertRejects(()=>f.run({action:'owner_context',...patch}));
 assertEquals(f.calls.length,1);
});
Deno.test('owner shift uses the original actor and server-selected driver account',async()=>{
 const f=fixture();await f.run({action:'owner_shift',requestId,contactId,expected:version});assertEquals(f.calls.find(c=>c.name==='taxi_owner_shift_apply')?.args,{p_user:42,p_request:requestId,p_contact:contactId,p_expected:version});assertEquals(f.writes.length,0);
});
Deno.test('owner shift keeps an uncertain result recoverable with the same request',async()=>{
 const f=fixture({invalidShiftResult:true});const error=await assertRejects(()=>f.run({action:'owner_shift',requestId,contactId,expected:version}),TrackingError);assertEquals(error.status,503);assertEquals(error.code,'owner_write_unconfirmed');
});
for(const failure of ['foreign_unit','disabled_account','manager_not_admin','manager_missing','busy','invalid_revision','unrelated_driver'])Deno.test('owner shift refuses '+failure+' without changing the operational recipient',async()=>{
 const f=fixture({visible:failure!=='foreign_unit',disabled:failure==='disabled_account',managerAdmin:failure!=='manager_not_admin',shiftState:failure==='busy'?'driver_busy':'saved'});
 await assertRejects(()=>f.run({action:'owner_shift',requestId,contactId:failure==='unrelated_driver'?ownerId:contactId,expected:failure==='invalid_revision'?'invalid':version},failure!=='manager_missing'));
 assertEquals(f.writes.length,0);if(failure!=='busy')assertEquals(f.calls.some(c=>c.name==='taxi_owner_shift_apply'),false);
});
Deno.test('owner registration reuses account provisioning with read-only driver permissions and never starts a shift',async()=>{
 const f=fixture({registration:true});await f.run({action:'owner_driver_save',requestId,contactId,expected:version,name:person.name,phone:person.phone,email:'driver@example.test',password:'Fixture-password-123'});assertEquals(f.created,1);assert(f.activated);
 const begin=f.calls.find(c=>c.name==='taxi_account_begin');assertEquals(begin?.args.p_actor,42);assertEquals(begin?.args.p_assignment,{role:'driver',deviceId:7,receiveOffers:false,driverVersion:version});
 for(const user of f.users){assertEquals(user.administrator,false);assertEquals(user.readonly,true);assertEquals(user.userLimit,0);assertEquals(user.deviceLimit,0);}
 assertEquals(f.calls.some(c=>c.name==='taxi_owner_shift_apply'),false);assertEquals(f.writes.some(w=>w.path==='/permissions'&&w.body.deviceId!==7),false);
});
Deno.test('owner registration preserves the request through a lost provider response and a live lease, then creates only one email',async()=>{
 const f=fixture({registration:true,createLost:true}),command={action:'owner_driver_save',requestId,contactId,expected:version,name:person.name,phone:person.phone,email:'driver@example.test',password:'Fixture-password-123'};
 await assertRejects(()=>f.run(command));assertEquals(f.created,1);await assertRejects(()=>f.run(command));assertEquals(f.created,1);f.expire();await f.run(command);assertEquals(f.created,1);assert(f.activated);
});
for(const patch of [{email:'bad'},{password:'short'},{phone:'+99999999999'},{role:'owner'},{deviceId:8}])Deno.test('owner registration rejects invalid or expanded input '+JSON.stringify(patch),async()=>{
 const f=fixture({registration:true});await assertRejects(()=>f.run({action:'owner_driver_save',requestId,contactId,expected:version,name:person.name,phone:person.phone,email:'driver@example.test',password:'Fixture-password-123',...patch}));assertEquals(f.writes.length,0);assertEquals(f.calls.some(c=>c.name==='taxi_owner_contact_save'),false);
});
