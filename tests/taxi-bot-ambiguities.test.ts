import {coordinateTaxi,type TaxiServices}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/coordinator.ts';
import {parseInterpretation}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/policy.ts';
import {emptyDraft,parseSession,type TaxiChannel,type TaxiSession,type TaxiInbound}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
function assert(value:unknown,message='Assertion failed'):asserts value{if(!value)throw new Error(message);}
function equal(a:unknown,b:unknown){assert(JSON.stringify(a)===JSON.stringify(b),`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);}
const now=Date.parse('2026-10-27T18:00:00Z');
const channel:TaxiChannel={tenantId:'11111111-1111-4111-8111-111111111111',waba:'+529630000001',enabled:true,name:'Base sintética',city:'Comitán',centerLat:16.25,centerLng:-92.13,radiusKm:20,dispatcher:'+529630000099',model:'fixture',baseCents:4000,perKmCents:1000,pricingMode:'road_distance'};
const message=(text:string):TaxiInbound=>({id:crypto.randomUUID(),from:'+529630000002',to:channel.waba,at:new Date(now).toISOString(),type:'text',text,button:null,location:null});
function state():TaxiSession{return{revision:1,mode:'bot',history:[],active:null,draft:{...emptyDraft(),fareMode:'quoted',pickupMessageId:'fixture-native',name:'Mariana',origin:{text:'Centro',lat:16.25,lng:-92.13,placeId:null,source:'gps'},destination:{text:'Terminal',lat:16.26,lng:-92.14,placeId:null,source:'written'},quoteCents:6500,confirmation:crypto.randomUUID(),expiresAt:new Date(now+600000).toISOString()}};}
function fixture(proposal:unknown={intent:'smalltalk',fields:{}}){
  let calls=0,quotes=0,candidates=0;
  const services:TaxiServices={interpret:async(current)=>{calls++;return parseInterpretation(proposal,current);},resolve:async(text)=>({kind:'resolved',place:{text,lat:16.255,lng:-92.135,placeId:null}}),quote:async()=>{quotes++;return 6500;},candidates:async()=>{candidates++;return[{deviceId:1,name:'Unidad 1'}];}};
  return{services,counts:()=>({calls,quotes,candidates}),run:(text:string,s=state())=>coordinateTaxi([message(text)],s,channel,services,now)};
}
Deno.test('ambiguity audit: a later correction in another bubble defeats an earlier cropped origin',()=>{
  let rejected=false;try{parseInterpretation({intent:'provide',fields:{origin:{value:'Centro',evidence:'Centro'}}},'Recógeme en Centro.\nNo, mejor Terminal.');}catch{rejected=true;}assert(rejected,'El intérprete no puede imponer la dirección anterior tras una corrección posterior.');
});
Deno.test('ambiguity audit: an either-or location cannot be reduced to the first candidate',()=>{
  let rejected=false;try{parseInterpretation({intent:'provide',fields:{origin:{value:'Centro',evidence:'Recógeme en Centro o Terminal'}}},'Recógeme en Centro o Terminal');}catch{rejected=true;}assert(rejected,'Hace falta que el pasajero elija entre las dos ubicaciones.');
});
Deno.test('ambiguity audit: text confirmation and courtesy cannot request a taxi',async()=>{
  const f=fixture(),s=state();const d=await coordinateTaxi([message('Sí'),message('gracias')],s,channel,f.services,now);equal(d.action,'draft');equal(f.counts().candidates,0);equal(f.counts().calls,0);
});
Deno.test('ambiguity audit: expired consent refreshes the actual stored journey instead of asking pickup again',async()=>{
  const f=fixture(),s=state();s.draft.expiresAt=new Date(now-1).toISOString();const d=await f.run('Sí',s);equal(d.action,'draft');equal(d.draft.origin,s.draft.origin);assert(d.draft.confirmation&&d.draft.confirmation!==s.draft.confirmation);assert(d.messages[0]?.buttons?.length);equal(f.counts().candidates,0);
});
Deno.test('ambiguity audit: courtesy does not reprice the route or replace its confirmation',async()=>{
  const f=fixture(),s=state(),d=await f.run('Gracias',s);equal(d.action,'reply');equal(d.draft.confirmation,s.draft.confirmation);equal(f.counts().quotes,0);
});
Deno.test('ambiguity audit: a status question without a requested taxi is answered without another summary',async()=>{
  const f=fixture({intent:'status',fields:{}}),s=state(),d=await f.run('¿Ya viene el taxi?',s);equal(d.action,'reply');assert(d.messages[0]?.text.includes('Todavía no'));equal(f.counts().quotes,0);
});
Deno.test('ambiguity audit: a supplied pin survives the question about pickup versus destination',async()=>{
  const f=fixture({intent:'provide',fields:{}}),s=state(),pin=message('');pin.type='location';pin.location={lat:16.255,lng:-92.135};
  const first=await coordinateTaxi([pin],s,channel,f.services,now);equal(first.reason,'location_target_unclear');s.draft=first.draft;
  const second=await f.run('Es el origen',s);equal(second.draft.origin?.lat,16.255);equal(second.draft.destinationText,'Terminal');assert(second.draft.confirmation);
});
Deno.test('ambiguity audit: an origin pin requested after a failed correction does not become the destination',async()=>{
  const f=fixture({intent:'provide',fields:{origin:{value:'Calle Dudosa',evidence:'Recógeme en Calle Dudosa'}}}),s=state();s.draft.destination=null;f.services.resolve=async()=>({kind:'unavailable'});
  const failed=await f.run('Recógeme en Calle Dudosa',s);s.draft=failed.draft;const pin=message('');pin.type='location';pin.location={lat:16.255,lng:-92.135};const next=await coordinateTaxi([pin],s,channel,f.services,now);equal(next.draft.origin?.lat,16.255);equal(next.draft.destination,null);
});
Deno.test('ambiguity audit: changing the destination of an active trip requires the base even without the word change',async()=>{
  const f=fixture(),s=state();s.active={id:crypto.randomUUID(),state:'en_camino',taxiName:'Unidad 1'};const d=await f.run('Voy a Calle Segunda',s);equal(d.action,'human');equal(f.counts().candidates,0);
});
Deno.test('ambiguity audit: a cancellation question gets clarification, not unrelated search status',async()=>{
  const f=fixture(),s=state();s.active={id:crypto.randomUUID(),state:'buscando_conductor',taxiName:null};const d=await f.run('¿Puedes cancelar mi taxi?',s);equal(d.action,'reply');assert(d.messages[0]?.text.includes('cancelar'));equal(f.counts().candidates,0);
});
Deno.test('ambiguity audit: a location mentioned in text cannot overwrite an already known passenger name',async()=>{
  const f=fixture({intent:'provide',fields:{name:{value:'Centro',evidence:'Estoy en Centro'}}}),s=state(),d=await f.run('Estoy en Centro',s);equal(d.draft.name,'Mariana');equal(d.draft.confirmation,null);
});
Deno.test('ambiguity audit: declining a summary does not silently issue another confirmation',async()=>{
  const f=fixture(),d=await f.run('Todavía no');equal(d.action,'draft');equal(d.draft.confirmation,null);assert(!d.messages[0]?.buttons?.length);equal(f.counts().quotes,0);
});
Deno.test('ambiguity audit: newline corrections need no punctuation and a correction of destination preserves pickup evidence',()=>{
  let rejected=false;try{parseInterpretation({intent:'provide',fields:{origin:{value:'Centro',evidence:'Centro'}}},'Recógeme en Centro\nNo, mejor Terminal');}catch{rejected=true;}assert(rejected);
  equal(parseInterpretation({intent:'provide',fields:{origin:{value:'Centro',evidence:'Recógeme en Centro'}}},'Recógeme en Centro. Mejor el destino es Terminal.').fields.origin?.value,'Centro');
});
Deno.test('ambiguity audit: a name marker elsewhere in the evidence cannot authorize a different name',async()=>{
  const current='Soy Mariana, estoy en Centro',f=fixture({intent:'provide',fields:{name:{value:'Centro',evidence:current}}}),s=state(),d=await f.run(current,s);
  equal(d.draft.name,'Mariana');equal(d.draft.confirmation,null);
});
Deno.test('ambiguity audit: a final decline after assent and courtesy wins before dispatch',async()=>{
  const f=fixture(),s=state(),d=await coordinateTaxi([message('Sí'),message('gracias'),message('Todavía no')],s,channel,f.services,now);
  equal(d.action,'draft');equal(d.draft.confirmation,null);equal(f.counts().candidates,0);
});
Deno.test('ambiguity audit: a pending pin round trips through durable parsing and requires a direct role answer',async()=>{
  const f=fixture(),s=state(),pin=message('');pin.type='location';pin.location={lat:16.255,lng:-92.135};
  s.draft=(await coordinateTaxi([pin],s,channel,f.services,now)).draft;
  const restored=parseSession(JSON.parse(JSON.stringify(s)));equal(restored.draft.pendingLocation?.place.lat,16.255);
  const conditional=await f.run('Si es el origen',restored);equal(conditional.draft.origin,s.draft.origin);equal(conditional.draft.confirmation,null);
  const uncertain=await f.run('Sí',restored);assert(uncertain.action!=='confirm');equal(f.counts().candidates,0);
  const selected=await f.run('Es el destino',restored);equal(selected.draft.destination?.lat,16.255);equal(selected.draft.origin,s.draft.origin);equal(selected.draft.pendingLocation,null);
});
Deno.test('ambiguity audit: a pending pin expires and cannot be revived by a later role answer',async()=>{
  const f=fixture(),s=state();s.draft.confirmation=null;s.draft.expiresAt=null;s.draft.awaitingLocation='choice';s.draft.pendingLocation={place:{text:'Pin anterior',lat:16.255,lng:-92.135,placeId:null},expiresAt:new Date(now-1).toISOString()};
  const d=await f.run('Es el origen',s);equal(d.reason,'pending_location_expired');equal(d.draft.origin,s.draft.origin);equal(d.draft.pendingLocation,null);equal(d.draft.awaitingLocation,'origin');equal(f.counts().quotes,0);
});
Deno.test('ambiguity audit: another passenger name cannot bypass an outstanding request to resend an expired pin',async()=>{
  const current='A nombre de Pedro',f=fixture({intent:'provide',fields:{name:{value:'Pedro',evidence:current}}}),s=state();
  s.draft.confirmation=null;s.draft.expiresAt=null;s.draft.awaitingLocation='origin';
  const d=await f.run(current,s);equal(d.draft.name,'Pedro');equal(d.draft.confirmation,null);equal(d.draft.awaitingLocation,'origin');equal(f.counts().quotes,0);
});
Deno.test('ambiguity audit: written endpoints preserve context but still require the pickup GPS',async()=>{
  const current='De Centro a Terminal',f=fixture({intent:'provide',fields:{origin:{value:'Centro',evidence:current},destination:{value:'Terminal',evidence:current}}}),s=state();
  s.draft.origin=null;s.draft.destination=null;s.draft.confirmation=null;s.draft.expiresAt=null;s.draft.awaitingLocation='choice';
  f.services.resolve=async(text)=>({kind:'resolved',place:{text,lat:text==='Centro'?16.25:16.26,lng:text==='Centro'?-92.13:-92.14,placeId:null}});
  const d=await f.run(current,s);equal(d.draft.confirmation,null);equal(d.draft.awaitingLocation,'origin');equal(d.draft.pickupText,'Centro');
});
