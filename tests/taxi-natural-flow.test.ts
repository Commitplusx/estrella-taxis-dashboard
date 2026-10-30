import {coordinateTaxi,type TaxiServices}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/coordinator.ts';
import {emptyDraft,type TaxiChannel,type TaxiInbound,type TaxiSession}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
import {parseInterpretation}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/policy.ts';
function assert(v:unknown):asserts v{if(!v)throw new Error('Assertion failed');}
const equal=(a:unknown,b:unknown)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error('Different values: '+JSON.stringify(a)+' / '+JSON.stringify(b));};
const now=Date.now(),address='Calle Primera número 20',destination='Calle Segunda número 35';
const channel:TaxiChannel={tenantId:'11111111-1111-4111-8111-111111111111',waba:'+529630000001',enabled:true,name:'Base sintética',city:'Comitán',centerLat:16.25,centerLng:-92.13,radiusKm:20,dispatcher:'+529630000099',model:'fixture',baseCents:null,perKmCents:null,pricingMode:'h3_zone_max'};
const pickup={text:address,lat:16.25,lng:-92.13,placeId:null},target={text:destination,lat:16.26,lng:-92.14,placeId:null};
const message=(text:string):TaxiInbound=>({id:crypto.randomUUID(),from:'+529630000002',to:channel.waba,at:new Date(now).toISOString(),type:'text',text,button:null,location:null});
const session=():TaxiSession=>({revision:0,mode:'bot',active:null,history:[],draft:emptyDraft()});
function fixture(proposal:unknown){let quotes=0,assignments=0;
 const services:TaxiServices={interpret:async current=>parseInterpretation(proposal,current),resolve:async value=>value===address?{kind:'resolved',place:pickup}:value===destination?{kind:'resolved',place:target}:{kind:'unavailable'},quote:async()=>{quotes++;return 6500;},candidates:async()=>{assignments++;return[{deviceId:1,name:'Unidad sintética'}];}};
 return{services,counts:()=>({quotes,assignments}),run:(text:string,s=session())=>coordinateTaxi([message(text)],s,channel,services,now)};
}
for(const current of [`¿Me mandas un taxi a ${address}?`,`Oye bro, ¿me puedes mandar un taxi a ${address}?`,`¿Puedes mandarme un taxi a ${address}?`])Deno.test('natural taxi request: accepts the written pickup in a polite service question: '+current,async()=>{
 const f=fixture({intent:'provide',fields:{origin:{value:address,evidence:current}}}),d=await f.run(current);
 equal(d.draft.origin,pickup);equal(d.draft.destination,null);equal(d.reason,'missing_destination');equal(d.messages[0].locationRequest,undefined);equal(f.counts(),{quotes:0,assignments:0});
});
Deno.test('natural taxi request: a complete written route can be requested without a fare or a location pin',async()=>{
 const current=`Soy Mariana. Recógeme en ${address}. Voy a ${destination}.`;
 const f=fixture({intent:'provide',fields:{name:{value:'Mariana',evidence:'Soy Mariana'},origin:{value:address,evidence:`Recógeme en ${address}`},destination:{value:destination,evidence:`Voy a ${destination}`}}});
 f.services.quote=async()=>{throw new Error('An optional price must not be requested.');};
 const d=await f.run(current);equal(d.action,'draft');assert(d.draft.confirmation);equal(d.draft.quoteCents,null);assert(!d.messages[0].text.includes('Tarifa'));equal(d.messages[0].locationRequest,undefined);
 const s=session();s.draft=d.draft;const confirmed=await f.run('Sí, mándalo',s);equal(confirmed.action,'confirm');equal(f.counts().assignments,1);
});
Deno.test('natural taxi request: an explicit fare question still uses server H3 pricing and never books',async()=>{
 const current=`¿Cuánto cuesta ir de ${address} a ${destination}?`;
 const f=fixture({intent:'quote',fields:{origin:{value:address,evidence:current},destination:{value:destination,evidence:current}}}),d=await f.run(current);
 equal(d.draft.quoteCents,6500);assert(d.messages[0].text.includes('$65.00'));equal(f.counts(),{quotes:1,assignments:0});
});
for(const current of [`¿Hay taxis en ${address}?`,`¿Cuándo me mandas un taxi a ${address}?`,`Si pudiera, ¿me mandas un taxi a ${address}?`,`Mi amigo dijo: ¿me mandas un taxi a ${address}?`,`¿Me mandas un taxi a ${address} o al hospital?`])Deno.test('natural taxi request: doubt, hypothetical, third-party or alternative does not edit the pickup: '+current,()=>{
 let rejected=false;try{parseInterpretation({intent:'provide',fields:{origin:{value:address,evidence:current}}},current);}catch{rejected=true;}assert(rejected);
});
