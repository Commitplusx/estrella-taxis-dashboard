import { coordinateTaxi, type TaxiServices } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/coordinator.ts';
import { emptyDraft, record, type Interpretation, type TaxiChannel, type TaxiInbound, type TaxiSession } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
import { parseOutgoing, sendTaxiMessage } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/transport.ts';
function assert(v:unknown):asserts v{if(!v)throw new Error('Assertion failed');}
function equal(a:unknown,b:unknown){if(JSON.stringify(a)!==JSON.stringify(b))throw new Error('Different values: '+JSON.stringify(a)+' / '+JSON.stringify(b));}
const now=Date.now(),waba='+529630000001',customer='+529630000002';
const channel:TaxiChannel={tenantId:'11111111-1111-4111-8111-111111111111',waba,enabled:true,name:'Base sintética',city:'Comitán',centerLat:16.25,centerLng:-92.13,radiusKm:20,dispatcher:'+529630000099',model:'fixture',baseCents:null,perKmCents:null,pricingMode:'h3_zone_max'};
const origin={text:'Recogida',lat:16.25,lng:-92.13,placeId:null,source:'gps' as const},destination={text:'Destino',lat:16.26,lng:-92.14,placeId:null};
function session():TaxiSession{return{revision:0,mode:'bot',active:null,history:[],draft:{...emptyDraft(),pickupMessageId:'fixture-native'}};}
function message(text='Hola'):TaxiInbound{return{id:crypto.randomUUID(),from:customer,to:waba,at:new Date(now).toISOString(),type:'text',text,button:null,location:null};}
function fixture(proposal:Interpretation={intent:'smalltalk',fields:{}}){
 let assignments=0,quotes=0;
 const services:TaxiServices={interpret:async()=>proposal,resolve:async()=>({kind:'unavailable'}),quote:async()=>{quotes++;return 6500;},candidates:async()=>{assignments++;return[];}};
 return{services,counts:()=>({assignments,quotes}),run:(s=session(),m=message())=>coordinateTaxi([m],s,channel,services,now)};
}
Deno.test('native location: greeting asks for pickup through a durable role without requesting a taxi',async()=>{
 const f=fixture(),d=await f.run();equal(d.messages[0].locationRequest,'origin');equal(d.draft.awaitingLocation,'origin');equal(d.draft.confirmation,null);equal(d.action,'draft');equal(f.counts(),{assignments:0,quotes:0});
});
Deno.test('native location: pickup then destination pins advance different fields and require passenger name and confirmation',async()=>{
 const f=fixture(),first=await f.run(),s=session();s.draft=first.draft;
 const pickup=await f.run(s,{...message(''),type:'location',location:{lat:origin.lat,lng:origin.lng}});
 equal(pickup.draft.origin?.lat,origin.lat);equal(pickup.draft.destination,null);equal(pickup.messages[0].locationRequest,undefined);equal(pickup.draft.awaitingLocation,null);equal(pickup.reason,'missing_name');
 s.draft=pickup.draft;const target=await f.run(s,{...message('destino'),type:'location',location:{lat:destination.lat,lng:destination.lng}});
 equal(target.draft.origin?.lat,origin.lat);equal(target.draft.destination?.lat,destination.lat);equal(target.reason,'missing_name');equal(target.draft.confirmation,null);equal(target.messages[0].locationRequest,undefined);equal(f.counts().assignments,0);
});
Deno.test('native location: written destinations remain valid and do not force a second pin',async()=>{
 const f=fixture({intent:'provide',fields:{destination:{value:'Terminal',evidence:'Voy a Terminal'}}});f.services.resolve=async()=>({kind:'resolved',place:destination});
 const s=session();s.draft={...emptyDraft(),origin,pickupMessageId:'fixture-native',name:'Persona',awaitingLocation:'destination'};
 const d=await f.run(s,message('Voy a Terminal'));equal(d.draft.destination,destination);assert(d.draft.confirmation);equal(d.messages[0].locationRequest,undefined);assert(d.messages[0].buttons?.[0].id.startsWith('txc_'));equal(f.counts().assignments,0);
});
Deno.test('native location: ambiguous single address requests its own role and leaves other fields unchanged',async()=>{
 const f=fixture({intent:'provide',fields:{destination:{value:'Terminal',evidence:'Mejor Terminal'}}}),s=session();s.draft={...emptyDraft(),origin,pickupMessageId:'fixture-native'};
 const d=await f.run(s,message('Mejor Terminal'));equal(d.reason,'missing_name');equal(d.draft.destinationText,'Terminal');equal(d.draft.origin,origin);equal(d.draft.awaitingLocation,null);equal(f.counts().assignments,0);
});
Deno.test('native location: a completed route with an unlabelled pin asks its meaning instead of requesting another pin',async()=>{
 const f=fixture(),s=session();s.draft={...emptyDraft(),origin,pickupMessageId:'fixture-native',destination,name:'Persona'};
 const d=await f.run(s,{...message(''),type:'location',location:{lat:16.255,lng:-92.135}});equal(d.reason,'location_target_unclear');equal(d.messages[0].locationRequest,undefined);assert(d.draft.pendingLocation);equal(d.draft.confirmation,null);
});
Deno.test('native location: active rides, human ownership and cancellation do not restart pickup',async()=>{
 const f=fixture(),s=session();s.active={id:crypto.randomUUID(),state:'en_camino',taxiName:'Unidad'};equal((await f.run(s)).messages[0].locationRequest,undefined);
 s.active=null;s.mode='human';equal((await f.run(s)).messages,[]);s.mode='bot';equal((await f.run(s,message('Cancela mi taxi'))).messages[0].locationRequest,undefined);
});
Deno.test('native location: durable outbox round trip produces the official YCloud native payload',async()=>{
 const out=parseOutgoing({id:crypto.randomUUID(),lease:crypto.randomUUID(),tenant_id:channel.tenantId,waba,destination:customer,body:{text:'¿Dónde te recogemos?',locationRequest:'origin',locationRevision:1,buttons:null}});
 let calls=0;const result=await sendTaxiMessage(out,'fixture-key',async(url,init)=>{
  calls++;equal(String(url),'https://api.ycloud.com/v2/whatsapp/messages');const body:unknown=JSON.parse(String(init?.body));assert(record(body));
  equal(body.interactive,{type:'location_request_message',body:{text:'¿Dónde te recogemos?'},action:{name:'send_location'}});equal(body.type,'interactive');equal(body.from,waba);equal(body.to,customer);equal(body.externalId,'taxi:'+out.id);
  return Response.json({id:'fixture-provider'});
 });equal(result,{state:'accepted',providerId:'fixture-provider'});equal(calls,1);
});
Deno.test('native location: malformed or mixed interactive requests are rejected before the provider',async()=>{
 for(const body of [{text:'Texto',locationRequest:'invalid'},{text:'Texto',locationRequest:null},{text:'x'.repeat(1025),locationRequest:'origin'},{text:'Texto',locationRequest:'origin',buttons:[{id:'x',title:'Otro'}]}]){
  let rejected=false;try{parseOutgoing({id:crypto.randomUUID(),lease:crypto.randomUUID(),tenant_id:channel.tenantId,waba,destination:customer,body});}catch{rejected=true;}assert(rejected);
 }
});
Deno.test('native location: provider rejection is visible and an uncertain result is never retried automatically',async()=>{
 const out=parseOutgoing({id:crypto.randomUUID(),lease:crypto.randomUUID(),tenant_id:channel.tenantId,waba,destination:customer,body:{text:'Ubicación',locationRequest:'origin'}});
 let calls=0;equal(await sendTaxiMessage(out,'fixture-key',async()=>{calls++;return new Response('',{status:400});}),{state:'failed',code:'provider_http_400'});equal(calls,1);
 equal(await sendTaxiMessage(out,'fixture-key',async()=>{calls++;throw new Error('timeout');}),{state:'uncertain',code:'provider_result_unknown'});equal(calls,2);
});
