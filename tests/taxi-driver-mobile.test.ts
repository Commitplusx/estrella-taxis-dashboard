import { assertEquals } from 'https://deno.land/std@0.177.0/testing/asserts.ts';
import { createTaxiAdminHandler } from '../estrella-taxis-backend/supabase/functions/taxi-bot-admin/handler.ts';
import { FleetApi } from '../estrella-taxis-backend/supabase/functions/_shared/tracking/auth.ts';
import type { TrackingStore } from '../estrella-taxis-backend/supabase/functions/_shared/tracking/store.ts';
const tenant='11111111-1111-4111-8111-111111111111',version='a'.repeat(32),requestId='22222222-2222-4222-8222-222222222222';
function fixture(visible=true,result='saved'){
 const writes:{name:string;params:Record<string,unknown>}[]=[];
 const unexpected=async():Promise<never>=>{throw new Error('Unexpected mutation');};
 const store:TrackingStore={writeScores:unexpected,writePackages:unexpected,writeCompanyPackage:unexpected,writeCompanyStatus:unexpected,
 read:async table=>{assertEquals(table,'perfiles');return[{empresa_id:tenant,rol:'driver'}];},rpc:async(name,params)=>{
  if(name==='taxi_driver_context')return{contact:{id:'33333333-3333-4333-8333-333333333333'},units:[{deviceId:1,name:'Taxi',active:false,version,busy:false,occupiedByOther:false,mobileFresh:false}]};
  if(!['taxi_driver_shift_apply','taxi_mobile_position_write'].includes(name))throw new Error('Unexpected RPC');
  writes.push({name,params});return{state:result};
 }};
 const fleet=new FleetApi('https://fleet.invalid/api',async url=>Response.json(String(url).endsWith('/session')?{id:81,administrator:false,disabled:false}:visible?[{id:1,name:'Taxi'}]:[]));
 const handler=createTaxiAdminHandler({store,fleet,runtimeReady:true});
 const run=(body:Record<string,unknown>)=>handler(new Request('https://internal.invalid',{method:'POST',headers:{'Content-Type':'application/json','x-traccar-session':'JSESSIONID=personal-session'},body:JSON.stringify(body)}));
 return{run,writes};
}
Deno.test('driver session can change only its current authorized unit; actor always comes from the authenticated identity',async()=>{
 const f=fixture();assertEquals((await f.run({action:'driver_shift',requestId,deviceId:1,active:true,expected:version})).status,200);
 assertEquals(f.writes,[{name:'taxi_driver_shift_apply',params:{p_user:81,p_request:requestId,p_device:1,p_active:true,p_expected:version}}]);
});
for(const patch of [{p_user:99},{contactId:'forged'},{deviceId:2},{expected:'bad'},{active:'yes'}])Deno.test('driver rejects expanded or unlinked shift '+JSON.stringify(patch),async()=>{
 const f=fixture();const r=await f.run({action:'driver_shift',requestId,deviceId:1,active:true,expected:version,...patch});assertEquals(r.status>=400,true);assertEquals(f.writes.length,0);
});
Deno.test('revoked Traccar unit permissions also stop shift and location writes before the database',async()=>{
 const f=fixture(false);assertEquals((await f.run({action:'driver_shift',requestId,deviceId:1,active:true,expected:version})).status,403);assertEquals(f.writes.length,0);
});
const position={action:'driver_position',deviceId:1,version,lat:16.25,lng:-92.13,accuracy:10,speed:0,heading:null,recordedAt:'2026-11-01T18:00:00Z',mocked:false};
for(const patch of [{mocked:true},{accuracy:101},{lat:91},{speed:-1},{heading:360},{recordedAt:'yesterday'},{version:'invalid'},{userId:99}])Deno.test('invalid mobile telemetry cannot reach storage '+JSON.stringify(patch),async()=>{
 const f=fixture();assertEquals((await f.run({...position,...patch})).status>=400,true);assertEquals(f.writes.length,0);
});
Deno.test('location writes expose a shift conflict, rather than pretending a rejected location was saved',async()=>{
 const f=fixture(true,'shift_changed');assertEquals((await f.run(position)).status,409);assertEquals(f.writes[0].params.p_user,81);
});
