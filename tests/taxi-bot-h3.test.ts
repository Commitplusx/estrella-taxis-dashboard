import {createTaxiServices}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/services.ts';
import {coordinateTaxi,type TaxiServices}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/coordinator.ts';
import {emptyDraft,parseSession,type TaxiChannel,type TaxiSession,type TaxiInbound}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
import {taxiH3Cell,taxiH3Scope}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/h3.ts';
import type{TrackingStore}from'../estrella-taxis-backend/supabase/functions/_shared/tracking/store.ts';
import type{Fetcher}from'../estrella-taxis-backend/supabase/functions/_shared/tracking/http.ts';
function assert(value:unknown,message='Assertion failed'):asserts value{if(!value)throw new Error(message);}
function equal(a:unknown,b:unknown){assert(JSON.stringify(a)===JSON.stringify(b),`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);}
const now=Date.parse('2026-10-28T18:00:00Z');
const channel:TaxiChannel={tenantId:'11111111-1111-4111-8111-111111111111',waba:'+529630000001',enabled:true,name:'Base sintética',city:'Comitán',centerLat:16.25,centerLng:-92.13,radiusKm:20,dispatcher:'+529630000099',model:'fixture',baseCents:4000,perKmCents:1000,pricingMode:'h3_zone_max'};
const origin={text:'Centro',lat:16.25,lng:-92.13,placeId:null},destination={text:'Terminal',lat:16.26,lng:-92.14,placeId:null},scope=taxiH3Scope(origin,destination);
const config={mapsKey:'',modelKey:'',traccarUrl:'https://tracking.test/api',traccarEmail:'fixture@example.invalid',traccarPassword:'not-a-real-password'};
const denyFetch:Fetcher=async()=>{throw new Error('No Google/model/provider call is authorized in this H3 fixture.');};
function h3Store(answer:unknown){let calls=0;const store:TrackingStore={read:async()=>{throw new Error('H3 prices must use the scoped RPC.');},writeScores:async()=>{throw new Error('No tracking score writes.');},rpc:async(name,args)=>{
  calls++;equal(name,'taxi_bot_h3_quote');equal(args,{p_tenant:channel.tenantId,p_waba:channel.waba,p_origin:scope.originCell,p_destination:scope.destinationCell});return answer;
}};return{store,calls:()=>calls};}
const priced=(cents=6500)=>({state:'priced',mode:'h3_zone_max',cents,...scope});
function state():TaxiSession{return{revision:1,mode:'bot',history:[],active:null,draft:{...emptyDraft(),name:'Persona Prueba',origin,destination,quoteCents:6500,quoteH3:scope,confirmation:crypto.randomUUID(),expiresAt:new Date(now+600000).toISOString()}};}
const message=(text:string):TaxiInbound=>({id:crypto.randomUUID(),from:'+529630000002',to:channel.waba,at:new Date(now).toISOString(),type:'text',text,button:null,location:null});
function coordinatorFixture(cents:number|null){let candidates=0;const services:TaxiServices={interpret:async()=>{throw new Error('Server confirmation cannot invoke the model.');},resolve:async()=>{throw new Error('Stored endpoints must not be geocoded again.');},quote:async()=>cents,candidates:async()=>{candidates++;return[{deviceId:1,name:'Unidad 1'}];}};return{services,candidates:()=>candidates};}
Deno.test('H3 taxi: exact cells and tenant/channel are sent to one private quote RPC without Maps',async()=>{
  const f=h3Store(priced());equal(await createTaxiServices(f.store,denyFetch,config).quote(origin,destination,channel),6500);equal(f.calls(),1);
  assert(taxiH3Cell(scope.originCell));assert(taxiH3Cell(scope.destinationCell));assert(scope.originCell!==scope.destinationCell);
  equal(taxiH3Cell('8a0000000000000'),false);equal(taxiH3Cell('not-a-cell'),false);
});
for(const status of ['uncovered','invalid_zone'])Deno.test('H3 taxi: '+status+' leaves the tariff pending even if road rates are configured',async()=>{
  const f=h3Store({state:status,mode:'h3_zone_max'});equal(await createTaxiServices(f.store,denyFetch,config).quote(origin,destination,channel),null);equal(f.calls(),1);
});
Deno.test('H3 taxi: a disabled or changed channel is a configuration error, not an uncovered zone',async()=>{
  const f=h3Store({state:'channel_unavailable',mode:'h3_zone_max'});let rejected=false;
  try{await createTaxiServices(f.store,denyFetch,config).quote(origin,destination,channel);}catch{rejected=true;}assert(rejected);equal(f.calls(),1);
});
Deno.test('H3 taxi: a foreign route, malformed amount or unexpected database response is rejected',async()=>{
  for(const answer of [null,{},priced(0),priced(-1),priced(12.5),{...priced(),cents:'6500'},{...priced(),originCell:scope.destinationCell},{...priced(),mode:'road_distance'}]){
    let rejected=false;try{await createTaxiServices(h3Store(answer).store,denyFetch,config).quote(origin,destination,channel);}catch{rejected=true;}assert(rejected);
  }
});
Deno.test('H3 taxi: outside coverage does not query another base or a default tariff',async()=>{
  const f=h3Store(priced());equal(await createTaxiServices(f.store,denyFetch,config).quote(origin,{...destination,lat:0,lng:0},channel),null);equal(f.calls(),0);
});
Deno.test('H3 taxi: changed price issues a new review and requires a separate confirmation before dispatch',async()=>{
  const f=coordinatorFixture(7500),s=state(),first=await coordinateTaxi([message('Sí')],s,channel,f.services,now);
  equal(first.action,'draft');equal(first.reason,'tariff_changed');equal(first.draft.quoteCents,7500);assert(first.draft.confirmation!==s.draft.confirmation);equal(f.candidates(),0);
  const restored=parseSession(JSON.parse(JSON.stringify({...s,draft:first.draft}))),next=await coordinateTaxi([message('Sí')],restored,channel,f.services,now);equal(next.action,'confirm');equal(f.candidates(),1);
});
Deno.test('H3 taxi: old button also checks the current tariff and proof before asking any driver',async()=>{
  const f=coordinatorFixture(6500),s=state();s.draft.quoteH3=null;const m=message('');m.type='button';m.button='txc_'+s.draft.confirmation;
  const d=await coordinateTaxi([m],s,channel,f.services,now);equal(d.action,'draft');equal(d.reason,'tariff_changed');equal(d.draft.quoteH3,scope);equal(f.candidates(),0);
});
Deno.test('H3 taxi: loss of coverage replaces the priced summary with an explicit pending fare, without dispatch',async()=>{
  const f=coordinatorFixture(null),d=await coordinateTaxi([message('Sí')],state(),channel,f.services,now);equal(d.action,'draft');equal(d.draft.quoteCents,null);assert(d.messages[0]?.text.includes('todavía no hay un precio acordado'));equal(f.candidates(),0);
});
Deno.test('H3 taxi: database failure hands off instead of treating a failed quote as an uncovered zone',async()=>{
  const f=coordinatorFixture(6500);f.services.quote=async()=>{throw new Error('Fixture database unavailable.');};
  const d=await coordinateTaxi([message('Sí')],state(),channel,f.services,now);equal(d.action,'human');equal(d.reason,'h3_quote_unavailable');equal(f.candidates(),0);
});

Deno.test('H3 taxi: a reduced service radius invalidates the stored confirmation before quoting or dispatch',async()=>{
  const f=coordinatorFixture(6500),s=state();let quotes=0;f.services.quote=async()=>{quotes++;return 6500;};
  const d=await coordinateTaxi([message('Sí')],s,{...channel,radiusKm:0.1},f.services,now);
  equal(d.action,'human');equal(d.reason,'outside_service_area');equal(f.candidates(),0);equal(quotes,0);
});
