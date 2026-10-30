import { assert, assertEquals } from 'https://deno.land/std@0.177.0/testing/asserts.ts';
import { coordinateTaxi, type TaxiServices } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/coordinator.ts';
import { emptyDraft, type TaxiChannel, type TaxiInbound, type TaxiSession } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
import {conversationPhase}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/stateMachine.ts';
const now=Date.parse('2026-10-30T21:30:00Z');
const channel:TaxiChannel={tenantId:'11111111-1111-4111-8111-111111111111',waba:'+529630000001',enabled:true,name:'Base sintética',city:'Comitán',centerLat:16.25,centerLng:-92.13,radiusKm:20,dispatcher:null,model:'fixture',baseCents:5500,perKmCents:null,pricingMode:'h3_zone_max'};
const message=(text:string):TaxiInbound=>({id:crypto.randomUUID(),from:'+529630000002',to:channel.waba,at:new Date(now).toISOString(),type:'text',text,button:null,location:null});
const state=():TaxiSession=>({revision:5,mode:'bot',history:[{role:'user',content:'Datos anteriores'}],active:null,draft:{...emptyDraft(),name:'Mariana',origin:{text:'Pin anterior',lat:16.25,lng:-92.13,source:'gps',placeId:null},pickupMessageId:'old-pin',destinationText:'Destino anterior',confirmation:crypto.randomUUID(),expiresAt:new Date(now+600000).toISOString()}});
const never=async():Promise<never>=>{throw Error('Control commands must not invoke model, quote, geocoder or dispatch.');};
const controlServices:TaxiServices={interpret:never,quote:never,resolve:never,candidates:never};
for(const command of ['/reset',' /RESET '])Deno.test('reset command clears the draft and asks for a fresh native pickup: '+command,async()=>{
 const decision=await coordinateTaxi([message(command)],state(),channel,controlServices,now);assertEquals(decision.action,'reset');assertEquals(decision.draft.name,null);assertEquals(decision.draft.origin,null);assertEquals(decision.draft.destinationText,undefined);assertEquals(decision.draft.confirmation,null);assertEquals(decision.messages[0].locationRequest,'origin');assert(!decision.messages[0].buttons?.length);
});
Deno.test('reset dominates other messages in its turn, including an obsolete confirmation button',async()=>{
 const s=state(),button:TaxiInbound={...message(''),type:'button',button:'txc_'+s.draft.confirmation};
 const decision=await coordinateTaxi([message('Datos viejos'),message('/reset'),button],s,channel,controlServices,now);assertEquals(decision.action,'reset');assertEquals(decision.candidates,[]);assertEquals(decision.tripId,null);
});
for(const mode of ['human','bot'] as const)Deno.test('reset preserves an active trip and ownership in '+mode+' mode',async()=>{
 const s=state();s.mode=mode;s.active={id:crypto.randomUUID(),state:'en_camino',taxiName:'Unidad sintética'};
 const decision=await coordinateTaxi([message('/reset')],s,channel,controlServices,now);assertEquals(decision.action,'reset');assertEquals(decision.tripId,null);assertEquals(decision.messages[0].locationRequest,undefined);assertEquals(s.mode,mode);assertEquals(s.active.state,'en_camino');
});
Deno.test('bare Cancelar discards an unconfirmed draft without entering a correction loop',async()=>{
 const decision=await coordinateTaxi([message('Cancelar')],state(),channel,controlServices,now);assertEquals(decision.action,'draft');assertEquals(decision.reason,'draft_cancelled');assertEquals(decision.draft,emptyDraft());assert(!decision.messages[0].buttons?.length);
});
Deno.test('Destino requests a concrete optional destination and invalidates the previous summary',async()=>{
 const decision=await coordinateTaxi([message('Destino')],state(),channel,controlServices,now);assertEquals(decision.action,'draft');assertEquals(decision.draft.awaitingLocation,'destination');assertEquals(decision.messages[0].locationRequest,'destination');assertEquals(decision.draft.confirmation,null);assert(decision.messages[0].text.includes('destino'));
});
Deno.test('an explicitly requested destination is understood before pickup and the native GPS is still required afterwards',async()=>{
 const s:TaxiSession={revision:0,mode:'bot',history:[],active:null,draft:emptyDraft()};
 const first=await coordinateTaxi([message('Destino')],s,channel,controlServices,now);s.draft=first.draft;assertEquals(conversationPhase(s,now),'destination');
 const text='Pilita Seca',services:TaxiServices={...controlServices,interpret:async()=>({intent:'provide',fields:{destination:{value:text,evidence:text}}}),resolve:async()=>({kind:'unavailable'})};
 const next=await coordinateTaxi([message(text)],s,channel,services,now);assertEquals(next.draft.destinationText,text);assertEquals(next.messages[0].locationRequest,'origin');assertEquals(next.draft.confirmation,null);
});
Deno.test('a quoted or embedded reset command is ordinary text and never resets a conversation',async()=>{
 for(const text of ['¿Qué hace /reset?','no uses /reset','/reset todo']){const s=state(),services:TaxiServices={...controlServices,interpret:async()=>({intent:'ambiguous',fields:{}})};const decision=await coordinateTaxi([message(text)],s,channel,services,now);assert(decision.action!=='reset');assertEquals(decision.draft.origin,s.draft.origin);}
});
