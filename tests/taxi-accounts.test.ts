import { accountRequest } from '../estrella-taxis-backend/supabase/functions/taxi-bot-admin/accounts.ts';
import { createTaxiAdminHandler } from '../estrella-taxis-backend/supabase/functions/taxi-bot-admin/handler.ts';
import { FleetApi } from '../estrella-taxis-backend/supabase/functions/_shared/tracking/auth.ts';
import { positiveId, record } from '../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts';
import type { TrackingStore } from '../estrella-taxis-backend/supabase/functions/_shared/tracking/store.ts';
const tenant='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',personId='33333333-3333-f333-0333-333333333333';
const waba='+529630000001',version='a'.repeat(32),requestId='44444444-4444-4444-8444-444444444444';
function assert(value:unknown,message='Assertion failed'):asserts value{if(!value)throw new Error(message);}
function fixture(options:{createLost?:boolean;replay?:boolean;foreignUser?:boolean;badGrants?:boolean;failFinish?:boolean}={}){
 const person={id:personId,unitNumber:'487',name:'Persona sintética',phoneInput:'9630000081',phone:'+529630000081',role:'driver',deviceId:7,receiving:false,version,accountUserId:null};
 const existing:Record<string,unknown>={id:81,name:'Persona existente',email:'existing@example.test',administrator:false,disabled:false,readonly:false,userLimit:0,attributes:{}};
 let users:Record<string,unknown>[]=[existing];let grants=[7,8],groups=[2],created=0;const calls:{path:string;method:string;body:unknown}[]=[];
 const rpcCalls:string[]=[];let activated=false;let createLost=options.createLost===true;
 const saved={state:'saved',userId:81,email:'existing@example.test',contact:{...person,accountUserId:81}};
 const deny=async():Promise<never>=>{throw new Error('Unexpected write');};
 const store:TrackingStore={writeScores:deny,writePackages:deny,writeCompanyPackage:deny,writeCompanyStatus:deny,
  read:async(table)=>table==='perfiles'?(options.foreignUser?[{traccar_user_id:81,empresa_id:other,rol:'operador'}]:[]):[],
  rpc:async(name,args)=>{
   rpcCalls.push(name);
   if(name==='taxi_bot_contacts_read')return{contacts:[person],drivers:[],activeCount:0,zoneCount:1,linkedUnitIds:[7,8]};
   if(name==='taxi_account_pending')return[];
   if(name==='taxi_account_begin')return options.replay?{state:'replay',result:saved,activated:true}:{state:'proceed',lease:'55555555-5555-4555-8555-555555555555'};
   if(name==='taxi_account_finish')return options.failFinish?{state:'revision_conflict'}:{...saved,userId:args.p_user,contact:{...person,accountUserId:args.p_user}};
   if(name==='taxi_account_activated'){activated=true;return true;}
   throw new Error('Unexpected RPC '+name);
  }};
 const fleet=new FleetApi('https://fleet.invalid/api',async(input,init)=>{
  const url=new URL(String(input)),path=url.pathname.replace('/api','')+url.search,method=init?.method??'GET';
  const body:unknown=typeof init?.body==='string'?JSON.parse(init.body):null;
  calls.push({path,method,body});
  if(method==='GET'){
   if(path==='/users')return Response.json(users);
   if(path==='/devices')return Response.json([{id:7,name:'Unidad 487'},{id:8,name:'Unidad 495'},{id:99,name:'Otra base'}]);
   if(path.startsWith('/devices?userId='))return Response.json((options.badGrants?[7,8,99]:grants).map(id=>({id,name:'Taxi '+id})));
   if(path.startsWith('/groups?userId='))return Response.json(groups.map(id=>({id})));
  }
  assert(record(body));
  if(method==='POST'&&path==='/users'){
   created++;const user={...body,id:82,password:undefined};users.push(user);
   if(createLost){createLost=false;throw new Error('Response lost after provider commit');}
   return Response.json(user);
  }
  if(method==='PUT'&&/^\/users\/\d+$/.test(path)){assert(positiveId(body.id));users=users.map(user=>user.id===body.id?body:user);return Response.json(body);}
  if(path==='/permissions'){
   if(positiveId(body.deviceId)){if(method==='DELETE')grants=grants.filter(id=>id!==body.deviceId);else grants.push(body.deviceId);}
   if(positiveId(body.groupId))groups=groups.filter(id=>id!==body.groupId);
   return new Response(null,{status:204});
  }
  throw new Error('Unexpected provider call '+method+' '+path);
 });
 const command:Record<string,unknown>={action:'account_save',tenantId:tenant,waba,contactId:personId,expected:version,userId:81,email:'existing@example.test',password:'',requestId,role:'driver',deviceId:7,receiveOffers:false,driverVersion:null};
 const run=(body=command,admin=true)=>accountRequest(body,tenant,waba,{userId:42,admin,cookie:'JSESSIONID=fixture-cookie'},fleet,store,new AbortController().signal);
 return{run,command,calls,rpcCalls,get users(){return users;},get grants(){return grants;},get groups(){return groups;},get created(){return created;},get activated(){return activated;}};
}
Deno.test('accounts: reuse selected email without creating a user or changing its password; exact taxi and no subordinate accounts',async()=>{
 const f=fixture();const result=await f.run();assert(record(result)&&result.state==='saved');assert(f.created===0);assert(f.grants.length===1&&f.grants[0]===7);assert(f.groups.length===0);assert(f.activated);
 const writes=f.calls.filter(call=>call.method==='PUT');assert(writes.length===2);for(const call of writes){assert(record(call.body));assert(!('password'in call.body));assert(call.body.administrator===false&&call.body.readonly===true&&call.body.userLimit===0&&call.body.deviceLimit===0);}
});
Deno.test('accounts: response lost after user creation recovers the marker and never creates a second email',async()=>{
 const f=fixture({createLost:true});const command={...f.command,userId:null,email:'new@example.test',password:'Initial-fixture-123'};
 let failed=false;try{await f.run(command);}catch{failed=true;}assert(failed&&f.created===1);
 const result=await f.run(command);assert(record(result)&&result.state==='saved');assert(f.created===1);
});
Deno.test('accounts: duplicate existing email requires explicit selection before reserving or writing',async()=>{
 const f=fixture();let failed=false;try{await f.run({...f.command,userId:null,password:'Initial-fixture-123'});}catch(error:unknown){failed=record(error)&&error.code==='email_exists';}
 assert(failed&&f.created===0&&!f.rpcCalls.includes('taxi_account_begin'));assert(!f.calls.some(call=>call.method!=='GET'));
});
Deno.test('accounts: another base user and non-admin caller cannot gain permissions',async()=>{
 for(const foreign of [true,false]){const f=fixture({foreignUser:foreign});let failed=false;try{await f.run(f.command,foreign);}catch{failed=true;}assert(failed);assert(!f.calls.some(call=>call.method!=='GET'));}
});
Deno.test('accounts: unexpected retained taxi prevents SQL commit and login activation',async()=>{
 const f=fixture({badGrants:true});let failed=false;try{await f.run();}catch{failed=true;}assert(failed&&!f.activated);assert(!f.rpcCalls.includes('taxi_account_finish'));assert(f.users[0].disabled===true);
});
Deno.test('accounts: SQL conflict never reactivates a partially configured account',async()=>{
 const f=fixture({failFinish:true});let failed=false;try{await f.run();}catch{failed=true;}assert(failed&&!f.activated);assert(f.users[0].disabled===true);
});
Deno.test('accounts: completed replay returns its receipt without re-enabling a later disabled user',async()=>{
 const f=fixture({replay:true});const result=await f.run();assert(record(result)&&result.state==='saved');assert(!f.calls.some(call=>call.method!=='GET'));assert(!f.activated);
});
Deno.test('accounts: arbitrary device from another base is rejected even for global administrator',async()=>{
 const f=fixture();let failed=false;try{await f.run({...f.command,deviceId:99});}catch{failed=true;}assert(failed&&!f.rpcCalls.includes('taxi_account_begin'));
});
Deno.test('personal account: owner, driver and owner-driver cannot access base contacts, plan, clients or configuration',async()=>{
 for(const role of ['owner','driver','owner_driver']){
  const deny=async():Promise<never>=>{throw new Error('No mutation allowed');};
  const store:TrackingStore={writeScores:deny,writePackages:deny,writeCompanyPackage:deny,writeCompanyStatus:deny,rpc:deny,read:async(table)=>{assert(table==='perfiles');return[{empresa_id:tenant,rol:role}];}};
  const fleet=new FleetApi('https://fleet.invalid/api',async()=>new Response(JSON.stringify({id:81,administrator:false}),{headers:{'Content-Type':'application/json','set-cookie':'JSESSIONID=personal-fixture; Path=/'}}));
  const handler=createTaxiAdminHandler({fleet,store,runtimeReady:true});
  for(const action of ['contacts','accounts','account_save','set_customer_access','configure','companies_list','operations','packages_list',...(role==='driver'?['owner_context','owner_driver_save','owner_shift']:[])]){
   const response=await handler(new Request('https://handler.invalid',{method:'POST',headers:{'x-traccar-token':'fixture-token'},body:JSON.stringify({action,tenantId:tenant,waba})}));assert(response.status===403,role+' '+action);
  }
 }
});
