import {assert,assertEquals}from'https://deno.land/std@0.177.0/testing/asserts.ts';
import{coordinateTaxi,type TaxiServices}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/coordinator.ts';
import{emptyDraft,type Interpretation,type TaxiChannel,type TaxiInbound,type TaxiSession}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
import{conversationPhase,currentConsent,taxiProgress}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/stateMachine.ts';
import{naturalTaxiQuestion,parseTaxiQuestion}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/conversationReply.ts';
const now=Date.now(),channel:TaxiChannel={tenantId:'11111111-1111-4111-8111-111111111111',waba:'+529630000001',enabled:true,name:'Base sintética',city:'Comitán',centerLat:16.25,centerLng:-92.13,radiusKm:20,dispatcher:null,model:'fixture',baseCents:null,perKmCents:null,pricingMode:'h3_zone_max'};
const message=(text:string):TaxiInbound=>({id:crypto.randomUUID(),from:'+529630000002',to:channel.waba,at:new Date(now).toISOString(),type:'text',text,button:null,location:null});
const state=():TaxiSession=>({revision:0,mode:'bot',active:null,history:[],draft:emptyDraft()});
function fixture(proposal:Interpretation={intent:'smalltalk',fields:{}}){let quotes=0,fleet=0;
 const services:TaxiServices={interpret:async()=>proposal,resolve:async()=>({kind:'unavailable'}),quote:async()=>{quotes++;return 5500;},candidates:async()=>{fleet++;return[{deviceId:1,name:'Unidad sintética'}];}};
 return{services,counts:()=>({quotes,fleet}),run:(m:TaxiInbound,s:TaxiSession)=>coordinateTaxi([m],s,channel,services,now)};
}
Deno.test('GPS booking: written pickup is remembered but never replaces a native pin',async()=>{
 const f=fixture({intent:'provide',fields:{origin:{value:'Pilita Seca',evidence:'estoy en Pilita Seca'}}}),s=state();
 const d=await f.run(message('estoy en Pilita Seca'),s);assertEquals(d.draft.pickupText,'Pilita Seca');assertEquals(d.draft.origin,null);assertEquals(d.messages[0].locationRequest,'origin');assertEquals(d.draft.confirmation,null);assertEquals(f.counts(),{quotes:0,fleet:0});
});
Deno.test('GPS booking: pin and name are enough; server quotes before review and only its current button dispatches',async()=>{
 const f=fixture(),s=state();s.draft.name='Mariana';
 const pin={...message(''),type:'location' as const,location:{lat:16.25,lng:-92.13}};
 const review=await f.run(pin,s);assertEquals(review.draft.pickupMessageId,pin.id);assertEquals(review.draft.destination,null);assertEquals(review.draft.quoteCents,5500);assertEquals(review.draft.quoteBasis,'pickup');assert(review.draft.confirmation);assertEquals(f.counts(),{quotes:1,fleet:0});
 s.draft=review.draft;const assent=await f.run(message('sí, mándalo'),s);assertEquals(assent.action,'draft');assertEquals(f.counts().fleet,0);assert(assent.messages[0].buttons?.[0]);
 const stale=await f.run({...message(''),type:'button',button:'txc_'+crypto.randomUUID()},s);assertEquals(stale.reason,'stale_confirmation');assertEquals(f.counts().fleet,0);
 s.draft=assent.draft;const clicked=await f.run({...message(''),type:'button',button:'txc_'+s.draft.confirmation},s);assertEquals(clicked.action,'confirm');assertEquals(f.counts().fleet,1);
});
Deno.test('GPS booking: missing or failed server price cannot expose a confirmation or reach dispatch',async()=>{
 for(const fail of [false,true]){const f=fixture(),s=state();s.draft.name='Mariana';f.services.quote=async()=>{if(fail)throw Error('Declared price outage');return null;};
  const result=await f.run({...message(''),type:'location',location:{lat:16.25,lng:-92.13}},s);assertEquals(result.action,'human');assertEquals(result.draft.confirmation,null);assertEquals(f.counts().fleet,0);assert(!result.messages.some(m=>m.buttons?.length));}
});
Deno.test('GPS booking: progress lists backend requirements; no text, courtesy or mixed batch is consent',()=>{
 const s=state();assertEquals(taxiProgress(s,now).missing,['pickup_gps','passenger_name','server_fare']);assertEquals(conversationPhase(s,now),'origin');
 for(const text of ['sí','dale','mándalo','Confirmar viaje','gracias'])assertEquals(currentConsent([message(text)],'token'),false);
 const click={...message(''),type:'button' as const,button:'txc_token'};assert(currentConsent([click],'token'));assert(!currentConsent([click,message('mejor otro lugar')],'token'));
});
Deno.test('GPS booking: a written destination is optional context and does not hold a valid pickup hostage',async()=>{
 const f=fixture({intent:'provide',fields:{destination:{value:'Pilita Seca',evidence:'voy a Pilita Seca'}}}),s=state();s.draft={...emptyDraft(),name:'Mariana',origin:{text:'Pin compartido',lat:16.25,lng:-92.13,placeId:null,source:'gps'},pickupMessageId:'persisted-native-message'};
 const result=await f.run(message('voy a Pilita Seca'),s);assertEquals(result.draft.destinationText,'Pilita Seca');assertEquals(result.draft.origin,s.draft.origin);assert(result.draft.confirmation);assertEquals(result.draft.quoteBasis,'pickup');assertEquals(f.counts().fleet,0);
});
Deno.test('GPS booking: a visual pickup reference preserves the verified pin and invalidates the older summary',async()=>{
 const f=fixture({intent:'provide',fields:{pickupReference:{value:'es el portón azul',evidence:'es el portón azul'}}}),s=state();s.draft={...emptyDraft(),name:'Mariana',origin:{text:'Pin compartido',lat:16.25,lng:-92.13,placeId:null,source:'gps'},pickupMessageId:'persisted-native-message',pickupText:'Pilita Seca',confirmation:crypto.randomUUID(),expiresAt:new Date(now+600000).toISOString()};
 const result=await f.run(message('es el portón azul'),s);assertEquals(result.draft.origin,s.draft.origin);assertEquals(result.draft.pickupMessageId,s.draft.pickupMessageId);assertEquals(result.draft.pickupText,'Pilita Seca. es el portón azul');assert(result.draft.confirmation!==s.draft.confirmation);assertEquals(f.counts().fleet,0);
});
const phrasing=(question:string)=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({question})}}]});
Deno.test('natural questions: the model phrases only the requested missing field; invalid prices, claims and extra fields are rejected',()=>{
 assertEquals(parseTaxiQuestion(phrasing('¿Me compartes el pin para recogerte?'),'pickup_gps'),'¿Me compartes el pin para recogerte?');
 assertEquals(parseTaxiQuestion(phrasing('¿A nombre de quién dejamos la solicitud?'),'passenger_name'),'¿A nombre de quién dejamos la solicitud?');
 for(const question of ['Ya quedó registrado tu taxi','¿Confirmamos el viaje por 55 pesos?','¿Tu conductor ya llegó?','¿Me compartes tu destino?','¿Me compartes el pin en la calle 3?']){let rejected=false;try{parseTaxiQuestion(phrasing(question),'pickup_gps');}catch{rejected=true;}assert(rejected);}
});
Deno.test('natural questions: provider failure has one bounded attempt and preserves the server question and draft',async()=>{
 let calls=0;const result=await naturalTaxiQuestion(async()=>{calls++;throw Error('Declared provider outage');},'fixture-key','fixture','pickup_gps','Hola');assertEquals(result,null);assertEquals(calls,1);
 const f=fixture(),s=state();f.services.question=async()=>null;const decision=await f.run(message('Hola'),s);assertEquals(decision.messages[0].locationRequest,'origin');assertEquals(decision.draft.confirmation,null);assertEquals(f.counts().fleet,0);assert(decision.messages[0].text.includes('pin GPS'));assert(!decision.messages[0].text.includes('si prefieres'));
});
