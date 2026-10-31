import {assert,assertEquals,assertRejects,assertThrows} from 'https://deno.land/std@0.177.0/testing/asserts.ts';
import {evaluateSimulation,parseSimulationFleet,type SimulationFleet} from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/simulation.ts';
import {parseSimulationInput,parseSimulationResult,type TaxiSimulationInput} from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/simulationContracts.ts';
import {selectTaxiCandidates} from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/selection.ts';
import {simulationRequest} from '../estrella-taxis-backend/supabase/functions/taxi-bot-admin/simulation.ts';
import {FleetApi,type FleetDevice} from '../estrella-taxis-backend/supabase/functions/_shared/tracking/auth.ts';
import type {TrackingStore} from '../estrella-taxis-backend/supabase/functions/_shared/tracking/store.ts';
import type {Fetcher} from '../estrella-taxis-backend/supabase/functions/_shared/tracking/http.ts';
import type {AdminChannel} from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/adminContracts.ts';
const now=Date.now(),tenant='11111111-1111-4111-8111-111111111111',waba='+529630000001',requestId='33333333-3333-4333-8333-333333333333',lease='44444444-4444-4444-8444-444444444444';
const input:TaxiSimulationInput={origin:{lat:16.25,lng:-92.13},destination:null,overrides:[]};
const fleet:SimulationFleet={enabled:true,paused:false,units:Array.from({length:16},(_,i)=>({deviceId:i+1,name:'Unit '+(i+1),eligible:true,inTurn:true,hasPhone:true,busy:false}))};
const devices:FleetDevice[]=fleet.units.map(u=>({id:u.deviceId,name:u.name,status:'online'}));
const positions=fleet.units.map(u=>({id:u.deviceId,deviceId:u.deviceId,latitude:16.25+u.deviceId*.0005,longitude:-92.13,fixTime:new Date(now-20000).toISOString(),valid:true,speed:0,course:0,attributes:{occupied:false,taxiAvailability:'free',ignition:true}}));
const run=(request:TaxiSimulationInput=input,info=fleet,gps:unknown[]=positions)=>evaluateSimulation(request,info,devices,gps,20,now);
Deno.test('simulation uses the live selector, projects bounded nonrepeated rounds and never modifies source telemetry',()=>{
 const before=JSON.stringify({input,fleet,positions,devices}),result=run(),live=selectTaxiCandidates(devices,positions,new Set(devices.map(d=>d.id)),input.origin,20,now);assert(live.success);
 assertEquals(result.baseline.rounds[0],live.data.map(d=>d.deviceId));assertEquals(result.baseline.rounds,[[1,2,3],[4,5,6],[7,8,9],[10,11,12]]);
 assertEquals(new Set(result.baseline.rounds.flat()).size,12);assertEquals(JSON.stringify({input,fleet,positions,devices}),before);assertEquals(parseSimulationResult(result),result);
});
for(const [change,reason]of [[{availability:'occupied'},'occupied'],[{availability:'unknown'},'occupancy_unknown'],[{gpsAgeSeconds:1801},'stale_gps'],[{gpsAgeSeconds:-60},'future_gps'],[{eligible:false},'not_available'],[{status:'unknown'},'offline'],[{status:'offline',gpsAgeSeconds:1801},'stale_gps'],[{point:{lat:17,lng:-92.13}},'outside_radius']] as const)Deno.test('scenario exclusion is explained by the actual selector: '+reason,()=>{
 const request=parseSimulationInput({...input,overrides:[{deviceId:1,...change}]}),result=run(request);
 assertEquals(result.baseline.rounds[0],[1,2,3]);assertEquals(result.scenario.rounds[0],[2,3,4]);assertEquals(result.scenario.units[0].reason,reason);
 assertEquals(result.baseline.units[0].changed,false);assertEquals(result.scenario.units[0].changed,true);
});
Deno.test('a recent offline taxi and a parked free taxi preserve the production availability policy',()=>{
 const result=run({...input,overrides:[{deviceId:1,status:'offline',gpsAgeSeconds:60,speedKmh:0}]});assertEquals(result.scenario.rounds[0],[1,2,3]);
});
Deno.test('thirty-minute policy: twenty-minute GPS is eligible, but fresh GPS never resets a thirty-minute stop',()=>{
 const parked=run({...input,overrides:[{deviceId:1,status:'offline',gpsAgeSeconds:1200,speedKmh:0}]});assertEquals(parked.scenario.rounds[0],[1,2,3]);
 const idle=run({...input,overrides:[{deviceId:1,gpsAgeSeconds:0,stationarySeconds:1801,speedKmh:0}]});assertEquals(idle.scenario.rounds[0],[2,3,4]);assertEquals(idle.scenario.units[0].reason,'idle_timeout');assertEquals(idle.scenario.units[0].stationarySeconds,1801);assertEquals(idle.scenario.units[0].gpsAgeSeconds,0);
 const boundary=run({...input,overrides:[{deviceId:1,gpsAgeSeconds:0,stationarySeconds:1800,speedKmh:0}]});assertEquals(boundary.scenario.units[0].reason,'selected');
});
Deno.test('heading adjustment changes priority while changing only destination does not',()=>{
 const result=run({...input,overrides:[{deviceId:1,speedKmh:30,course:0}]});assertEquals(result.scenario.rounds[0],[2,3,4]);assertEquals(result.scenario.units[0].penaltyKm,2);
 assertEquals(run({...input,destination:{lat:16.28,lng:-92.12}}).scenario.rounds,result.baseline.rounds);
});
Deno.test('no free taxi produces no offers, and global channel/plan controls cannot be overridden per unit',()=>{
 const all=run({...input,overrides:devices.map(d=>({deviceId:d.id,availability:'occupied'}))});assertEquals(all.scenario.rounds,[]);
 assertEquals(run({...input,overrides:[{deviceId:1,eligible:true}]},{...fleet,enabled:false}).scenario.units[0].reason,'channel_disabled');
 assertEquals(run(input,{...fleet,paused:true}).scenario.units[0].reason,'channel_paused');
 assertEquals(evaluateSimulation(input,fleet,devices,positions,20,now,false).baseline.units[0].reason,'plan_disabled');
});
Deno.test('business exclusions and GPS without a free attestation remain visible and private',()=>{
 const rows=fleet.units.map(u=>u.deviceId===1?{...u,eligible:false,inTurn:false}:u.deviceId===2?{...u,eligible:false,hasPhone:false}:u.deviceId===3?{...u,eligible:false,busy:true}:u);
 const result=run(input,{...fleet,units:rows});assertEquals(result.baseline.units.slice(0,3).map(u=>u.reason),['not_in_turn','no_whatsapp','active_trip']);
 const old=positions.map(p=>({...p,attributes:{occupied:false}}));assertEquals(run(input,fleet,old).baseline.rounds,[]);
 const visible=devices.filter(d=>d.id!==1);assertEquals(evaluateSimulation(input,fleet,visible,positions,20,now).baseline.units[0].reason,'no_tracking_access');
 const noGps=positions.filter(p=>p.deviceId!==1);assertEquals(run(input,fleet,noGps).baseline.units[0].reason,'no_gps');
});
for(const bad of [{origin:{lat:91,lng:0}},{destination:{lat:16,lng:null}},{overrides:[{deviceId:1,availability:'unknown-value'}]},{overrides:[{deviceId:1,speedKmh:181}]},{overrides:[{deviceId:1,course:360}]},{overrides:[{deviceId:1,gpsAgeSeconds:86401}]},{overrides:[{deviceId:1,eligible:'true'}]},{overrides:[{deviceId:1,secret:'unexpected'}]},{overrides:[{deviceId:1},{deviceId:1}]}])Deno.test('simulation validates the untrusted edit boundary '+JSON.stringify(bad),()=>{assertThrows(()=>parseSimulationInput({...input,...bad}));});
Deno.test('foreign overrides, oversized snapshots and contradictory output cannot masquerade as valid simulations',()=>{
 assertThrows(()=>run({...input,overrides:[{deviceId:999,eligible:true}]}));assertThrows(()=>parseSimulationFleet({...fleet,units:Array.from({length:201},(_,i)=>({...fleet.units[0],deviceId:i+1}))}));
 const result=run();assertThrows(()=>parseSimulationResult({...result,scenario:{...result.scenario,rounds:[[999]]}}));
 assertThrows(()=>parseSimulationResult({...result,scenario:{...result.scenario,units:result.scenario.units.map((u,i)=>i===0?{...u,rank:1.5}:u)}}));
 assertThrows(()=>parseSimulationResult({...result,pricing:{state:'priced',cents:0}}));
});

const channel:AdminChannel={tenantId:tenant,waba,name:'Synthetic base',city:'Comitán',enabled:true,dispatcher:null,centerLat:16.25,centerLng:-92.13,radiusKm:20,pricingMode:'h3_zone_max',baseCents:5500,perKmCents:null,revision:1};
const refresh={url:'https://taxis.estrella-eats.mx/taxi-gps-refresh',secret:'synthetic-secret-'.repeat(3)},identity={userId:42,admin:true,cookie:'JSESSIONID=synthetic-session'};
const never=async():Promise<never>=>{throw Error('Undeclared write is prohibited in simulation.');};
function serverFixture(mode:'success'|'refresh_failure'|'commit_unknown'|'replay'|'revoked'='success'){
 let refreshCalls=0,completions=0,gpsCalls=0;const calls:string[]=[];
 const stored=run();stored.pricing={state:'priced',cents:5500};
 const store:TrackingStore={writePackages:never,writeCompanyPackage:never,writeCompanyStatus:never,writeScores:never,read:never,rpc:async(name,args)=>{
  calls.push(name);
  if(name==='tracking_operation_begin'){assertEquals(args.p_user,42);assertEquals(args.p_kind,'simulation');return mode==='replay'||mode==='revoked'?{state:'replay',status:200,result:stored}:{state:'proceed',lease};}
  if(name==='tracking_operation_complete'){completions++;assertEquals(args.p_lease,lease);assertEquals(args.p_status,mode==='refresh_failure'?503:200);return mode!=='commit_unknown';}
  if(name==='taxi_bot_simulation_fleet'){assertEquals(args,{p_tenant:tenant,p_waba:waba});return fleet;}
  assertEquals(name,'taxi_bot_h3_quote');return{state:'priced',cents:5500,mode:'h3_zone_max',originCell:args.p_origin,destinationCell:args.p_destination};
 }};
 const fetcher:Fetcher=async(url)=>{calls.push(new URL(String(url)).pathname);assertEquals(url,refresh.url);refreshCalls++;return mode==='refresh_failure'?new Response('',{status:503}):Response.json({state:'refreshed',synced:16,completedAt:new Date().toISOString()});};
 const fleetApi=new FleetApi('https://tracking.invalid/api',async(url,init)=>{const path=new URL(String(url)).pathname;calls.push(path);gpsCalls++;assertEquals(new Headers(init?.headers).get('Cookie'),identity.cookie);if(path==='/api/devices')return Response.json(mode==='revoked'?devices.filter(d=>d.id!==1):[...devices,{id:999,name:'Other base',status:'online'}]);assertEquals(path,'/api/positions');return Response.json([...positions,{...positions[0],deviceId:999}]);});
 const execute=(configure=true)=>simulationRequest({action:'dispatch_simulation',tenantId:tenant,waba,requestId,...input},channel,identity,configure,true,fleetApi,store,refresh,fetcher,AbortSignal.timeout(10000));
 return{execute,counts:()=>({refreshCalls,completions,gpsCalls}),calls};
}
Deno.test('administrator simulation refreshes GPS, scopes the real fleet and only writes its operation receipt',async()=>{
 const f=serverFixture(),result=await f.execute();assertEquals(result.baseline.units.length,16);assertEquals(result.pricing,{state:'priced',cents:5500});assertEquals(f.counts(),{refreshCalls:1,completions:1,gpsCalls:2});assert(f.calls.indexOf('/taxi-gps-refresh')<f.calls.indexOf('/api/positions'));assert(!JSON.stringify(result).includes('Other base'));
});
Deno.test('operators are rejected before any fleet lookup or receipt write',async()=>{const f=serverFixture();await assertRejects(()=>f.execute(false));assertEquals(f.calls,[]);});
Deno.test('refresh failure does not reuse old GPS or invent a successful result',async()=>{const f=serverFixture('refresh_failure');await assertRejects(()=>f.execute());assertEquals(f.counts(),{refreshCalls:1,completions:1,gpsCalls:0});});
Deno.test('lost result commit never reports success and cached results revalidate current scope without refreshing GPS',async()=>{
 const unknown=serverFixture('commit_unknown');await assertRejects(()=>unknown.execute());assertEquals(unknown.counts().completions,1);
 const replay=serverFixture('replay');await replay.execute();assertEquals(replay.counts(),{refreshCalls:0,completions:0,gpsCalls:1});
 const revoked=serverFixture('revoked');await assertRejects(()=>revoked.execute());assertEquals(revoked.counts().refreshCalls,0);
});
