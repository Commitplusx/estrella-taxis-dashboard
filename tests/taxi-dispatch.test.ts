import{assert,assertEquals,assertRejects,assertThrows}from'https://deno.land/std@0.177.0/testing/asserts.ts';
import{parseDispatchClaims,parseDispatchStatus,type DispatchStatus,type DispatchClaim}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/dispatchContracts.ts';
import{dispatchRequest}from'../estrella-taxis-backend/supabase/functions/taxi-bot-admin/dispatch.ts';
import{TaxiEngine}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/engine.ts';
import type{TaxiServices}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/coordinator.ts';
import type{TrackingStore}from'../estrella-taxis-backend/supabase/functions/_shared/tracking/store.ts';
const tenant='11111111-1111-4111-8111-111111111111',tripId='22222222-2222-4222-8222-222222222222',lease='33333333-3333-4333-8333-333333333333',waba='+529630000001';
const claim:DispatchClaim={tripId,tenantId:tenant,waba,lease,origin:{text:'Punto sintético',lat:16.25,lng:-92.13,placeId:null,source:'gps'},excluded:[1,2,3]};
const status:DispatchStatus={asOf:'2026-10-31T18:00:00Z',health:{paused:true,failures:3,code:'provider_http_401',pausedUntil:null,revision:7},jobs:[{tripId,name:'Persona de prueba',customer:'+529630000002',state:'attention',round:4,scans:5,code:'round_limit',nextAt:'2026-10-31T18:00:00Z',deadlineAt:'2026-10-31T18:12:00Z',updatedAt:'2026-10-31T18:00:00Z'}]};
const never=async():Promise<never>=>{throw Error('Undeclared service call');};
function storage(rpc:TrackingStore['rpc'],read:TrackingStore['read']=never):TrackingStore{return{rpc,read,writeScores:never,writePackages:never,writeCompanyPackage:never,writeCompanyStatus:never};}
function engine(store:TrackingStore,services:TaxiServices,fetcher:typeof fetch=never){return new TaxiEngine(store,services,{webhookSecret:'synthetic-webhook-secret',workerSecret:'x'.repeat(32),ycloudKey:'fixture-key',now:()=>Date.parse(status.asOf)},fetcher);}
const channel={tenant_id:tenant,waba,enabled:true,name:'Base sintética',city:'Comitán',center_lat:16.25,center_lng:-92.13,radius_km:20,dispatcher:null,model:'fixture',base_cents:5500,per_km_cents:null,pricing_mode:'h3_zone_max'};
for(const patch of [{excluded:[1,1]},{excluded:[-1]},{excluded:Array.from({length:13},(_,i)=>i+1)},{excluded:[null]},{origin:{...claim.origin,lat:91}},{origin:{...claim.origin,source:'written'}},{tripId:'invalid'},{tenantId:otherId()},{waba:'invalid'},{lease:null}])Deno.test('dispatch claim validation rejects '+JSON.stringify(patch),()=>{
 if('tenantId'in patch&&patch.tenantId===otherId())assertThrows(()=>parseDispatchClaims([{...claim,...patch},claim,claim]));else assertThrows(()=>parseDispatchClaims([{...claim,...patch}]));
});
function otherId(){return'44444444-4444-4444-8444-444444444444';}
Deno.test('dispatch claim validation rejects duplicate trips and accepts the declared bounded batch',()=>{assertEquals(parseDispatchClaims([claim]),[claim]);assertThrows(()=>parseDispatchClaims([claim,claim]));});
for(const patch of [{health:{...status.health,revision:-1}},{health:{...status.health,failures:4}},{health:{...status.health,paused:'yes'}},{health:{...status.health,pausedUntil:'invalid'}},{asOf:'invalid'},{jobs:[{...status.jobs[0],round:5}]},{jobs:[{...status.jobs[0],scans:13}]},{jobs:[{...status.jobs[0],state:'assigned'}]},{jobs:[{...status.jobs[0],customer:'bad'}]},{jobs:[status.jobs[0],status.jobs[0]]}])Deno.test('dispatch panel validation rejects '+JSON.stringify(patch),()=>{assertThrows(()=>parseDispatchStatus({...status,...patch}));});
for(const outcome of ['success','gps_failure','channel_moved','channel_disabled','commit_unknown','stale','paused'] as const)Deno.test('dispatch worker bounds one round and persists '+outcome,async()=>{
 let reads=0,lookups=0,completions=0;
 const store=storage(async(name,args)=>{
  if(name==='taxi_bot_dispatch_claim')return[claim];assertEquals(name,'taxi_bot_dispatch_complete');completions++;assertEquals(args.p_trip,tripId);assertEquals(args.p_lease,lease);
  assertEquals(args.p_error,outcome==='gps_failure'?'fleet_unavailable':['channel_moved','channel_disabled'].includes(outcome)?'channel_unavailable':null);
  assertEquals(args.p_candidates,['gps_failure','channel_moved','channel_disabled'].includes(outcome)?[]:[{deviceId:4,name:'Unidad 4'}]);
  if(outcome==='commit_unknown')throw Error('Declared lost commit response');return{state:outcome==='stale'?'stale':outcome==='paused'?'paused':'offered',offers:1,round:2};
 },async(table)=>{reads++;if(table==='taxi_bot_channels')return[{...channel,...(outcome==='channel_moved'?{tenant_id:otherId()}:outcome==='channel_disabled'?{enabled:false}:{})}];assertEquals(table,'empresas');return[{id:tenant,activo:true,tipo_negocio:'taxi',paquete:{activo:true,incluye_whatsapp:true}}];});
 const services:TaxiServices={interpret:never,resolve:never,quote:never,candidates:async(origin,ch,signal,excluded)=>{lookups++;assertEquals(origin,claim.origin);assertEquals(ch.tenantId,tenant);assert(signal);assertEquals(excluded,[1,2,3]);if(outcome==='gps_failure')throw Error('Declared GPS outage');return[{deviceId:4,name:'Unidad 4'}];}};
 assertEquals(await engine(store,services).dispatch(),outcome==='commit_unknown'?1:0);assertEquals(completions,1);assertEquals(lookups,['channel_moved','channel_disabled'].includes(outcome)?0:1);assert(reads<=2);
});
Deno.test('dispatch worker rejects malformed claims before consulting providers',async()=>{let lookups=0;const services:TaxiServices={interpret:never,resolve:never,quote:never,candidates:async()=>{lookups++;return[];}};await assertRejects(()=>engine(storage(async()=>[claim,claim]),services).dispatch());assertEquals(lookups,0);});
for(const result of ['paused','stale','denied','ready'] as const)Deno.test('dispatch send check '+result+' avoids blind sends or success',async()=>{
 let requests=0,completions=0;
 const message={id:tripId,lease,tenant_id:tenant,waba,destination:'+529630000002',body:{text:'Oferta sintética'}};
 const store=storage(async(name,args)=>{if(name==='taxi_bot_outbox_claim')return[message];if(name==='taxi_bot_dispatch_send_check')return result;assertEquals(name,'taxi_bot_outbox_complete');completions++;assertEquals(args.p_state,result==='ready'?'accepted':'failed');return true;});
 const services:TaxiServices={interpret:never,resolve:never,quote:never,candidates:never};
 await engine(store,services,async()=>{requests++;return Response.json({id:'synthetic-provider-ack'});}).drain(tenant,waba);
 assertEquals(requests,result==='ready'?1:0);assertEquals(completions,['paused','stale'].includes(result)?0:1);
});
Deno.test('malformed outbox content fails durably before provider submission',async()=>{let completed=0;const store=storage(async(name,args)=>{if(name==='taxi_bot_outbox_claim')return[{id:tripId,lease,tenant_id:tenant,waba,destination:'+529630000002',body:{text:'x'.repeat(1025),buttons:[{id:'fixture',title:'Aceptar'}]}}];assertEquals(name,'taxi_bot_outbox_complete');assertEquals(args.p_state,'failed');assertEquals(args.p_error,'invalid_taxi_interactive_body');completed++;return true;});await engine(store,{interpret:never,resolve:never,quote:never,candidates:never}).drain(tenant,waba);assertEquals(completed,1);});
Deno.test('dispatch administration reads server status and requires configuration permission for resuming',async()=>{
 let calls=0;const store=storage(async(name,args)=>{calls++;assertEquals(name,'taxi_bot_dispatch_status');assertEquals(args,{p_tenant:tenant,p_waba:waba});return status;});
 assertEquals(await dispatchRequest({action:'dispatch_status',tenantId:tenant,waba},tenant,waba,42,false,store),status);
 await assertRejects(()=>dispatchRequest({action:'dispatch_resume',tenantId:tenant,waba,requestId:lease,revision:7},tenant,waba,42,false,store));assertEquals(calls,1);
});
for(const result of ['resumed','conflict','unknown'] as const)Deno.test('dispatch control preserves request identity and handles '+result,async()=>{
 let reads=0,writes=0;const store=storage(async(name,args)=>{if(name==='taxi_bot_dispatch_status'){reads++;return status;}assertEquals(name,'taxi_bot_dispatch_resume');assertEquals(args,{p_tenant:tenant,p_waba:waba,p_actor:42,p_request:lease,p_revision:7});writes++;return result==='unknown'?null:{state:result};});
 const call=()=>dispatchRequest({action:'dispatch_resume',tenantId:tenant,waba,requestId:lease,revision:7},tenant,waba,42,true,store);
 if(result==='resumed')assertEquals(await call(),status);else await assertRejects(call);assertEquals(writes,1);assertEquals(reads,result==='resumed'?1:0);
});
