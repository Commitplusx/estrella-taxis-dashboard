import {coordinateTaxi,type TaxiServices}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/coordinator.ts';
import {emptyDraft,parseSession,type TaxiChannel,type TaxiInbound,type TaxiSession}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
import {parseInterpretation}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/policy.ts';
function assert(v:unknown):asserts v{if(!v)throw new Error('Assertion failed');}
const equal=(a:unknown,b:unknown)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error('Different values: '+JSON.stringify(a)+' / '+JSON.stringify(b));};
const now=Date.now(),address='Calle Primera número 20',destination='Calle Segunda número 35';
const channel:TaxiChannel={tenantId:'11111111-1111-4111-8111-111111111111',waba:'+529630000001',enabled:true,name:'Base sintética',city:'Comitán',centerLat:16.25,centerLng:-92.13,radiusKm:20,dispatcher:'+529630000099',model:'fixture',baseCents:null,perKmCents:null,pricingMode:'h3_zone_max'};
const pickup={text:address,lat:16.25,lng:-92.13,placeId:null},target={text:destination,lat:16.26,lng:-92.14,placeId:null};
const message=(text:string):TaxiInbound=>({id:crypto.randomUUID(),from:'+529630000002',to:channel.waba,at:new Date(now).toISOString(),type:'text',text,button:null,location:null});
const session=():TaxiSession=>({revision:0,mode:'bot',active:null,history:[],draft:emptyDraft()});
for(const prefix of ['txw_','txk_'])Deno.test('dispatch customer choice: '+prefix+' is a native proposal validated by SQL without model or fleet calls',async()=>{
 const never=async():Promise<never>=>{throw Error('Native choice cannot call a provider');};
 const d=await coordinateTaxi([{...message(''),type:'button',button:prefix+'22222222-2222-4222-8222-222222222222'}],session(),channel,{interpret:never,resolve:never,quote:never,candidates:never},now);
 equal(d.action,'reply');equal(d.reason,'dispatch_choice');equal(d.messages,[]);equal(d.candidates,[]);
});
Deno.test('dispatch customer choice: a current wait decision remains visible and malformed stored tokens fail validation',async()=>{
 const s=session();s.active={id:'11111111-1111-4111-8111-111111111111',state:'buscando_conductor',taxiName:null,dispatchAttention:true,dispatchChoice:{token:'22222222-2222-4222-8222-222222222222',expiresAt:new Date(now+60000).toISOString()}};
 equal(parseSession(s).active,s.active);const f=fixture({intent:'status',fields:{}}),d=await f.run('¿Qué pasó?',s);equal(d.reason,'dispatch_choice_pending');equal(d.messages[0].buttons?.length,2);equal(f.counts(),{quotes:0,assignments:0});
 for(const choice of [{token:'inventado',expiresAt:new Date(now).toISOString()},{token:s.active.dispatchChoice?.token,expiresAt:'mañana'}]){
  let rejected=false;try{parseSession({...s,active:{...s.active,dispatchChoice:choice}});}catch{rejected=true;}assert(rejected);
 }
});
function fixture(proposal:unknown){let quotes=0,assignments=0;
 const services:TaxiServices={interpret:async current=>parseInterpretation(proposal,current),resolve:async value=>value===address?{kind:'resolved',place:pickup}:value===destination?{kind:'resolved',place:target}:{kind:'unavailable'},quote:async()=>{quotes++;return 6500;},candidates:async()=>{assignments++;return[{deviceId:1,name:'Unidad sintética'}];}};
 return{services,counts:()=>({quotes,assignments}),run:(text:string,s=session())=>coordinateTaxi([message(text)],s,channel,services,now)};
}
for(const current of [`¿Me mandas un taxi a ${address}?`,`Oye bro, ¿me puedes mandar un taxi a ${address}?`,`¿Puedes mandarme un taxi a ${address}?`])Deno.test('natural taxi request: accepts the written pickup in a polite service question: '+current,async()=>{
 const f=fixture({intent:'provide',fields:{origin:{value:address,evidence:current}}}),d=await f.run(current);
 equal(d.draft.origin,null);equal(d.draft.pickupText,address);equal(d.draft.destination,null);equal(d.messages[0].locationRequest,'origin');equal(f.counts(),{quotes:0,assignments:0});
});
Deno.test('natural taxi request: complete written route is retained until the pickup GPS and a verified fare arrive',async()=>{
 const current=`Soy Mariana. Recógeme en ${address}. Voy a ${destination}.`;
 const f=fixture({intent:'provide',fields:{name:{value:'Mariana',evidence:'Soy Mariana'},origin:{value:address,evidence:`Recógeme en ${address}`},destination:{value:destination,evidence:`Voy a ${destination}`}}});
 const d=await f.run(current);equal(d.action,'draft');equal(d.draft.confirmation,null);equal(d.draft.pickupText,address);equal(d.draft.destination?.text,destination);equal(d.messages[0].locationRequest,'origin');
 const s=session();s.draft=d.draft;const reviewed=await coordinateTaxi([{...message(''),type:'location',location:{lat:16.25,lng:-92.13}}],s,channel,f.services,now);assert(reviewed.draft.confirmation);equal(reviewed.draft.quoteCents,6500);
 s.draft=reviewed.draft;const assent=await f.run('Sí, mándalo',s);equal(assent.action,'draft');equal(f.counts().assignments,0);
 s.draft=assent.draft;const confirmed=await coordinateTaxi([{...message(''),type:'button',button:'txc_'+s.draft.confirmation}],s,channel,f.services,now);equal(confirmed.action,'confirm');equal(f.counts().assignments,1);
});
Deno.test('natural taxi request: an explicit fare question still uses server H3 pricing and never books',async()=>{
 const current=`¿Cuánto cuesta ir de ${address} a ${destination}?`;
 const f=fixture({intent:'quote',fields:{origin:{value:address,evidence:current},destination:{value:destination,evidence:current}}}),d=await f.run(current);
 equal(d.draft.quoteCents,null);equal(d.messages[0].locationRequest,'origin');equal(f.counts(),{quotes:0,assignments:0});
});
for(const current of [`¿Hay taxis en ${address}?`,`¿Cuándo me mandas un taxi a ${address}?`,`Si pudiera, ¿me mandas un taxi a ${address}?`,`Mi amigo dijo: ¿me mandas un taxi a ${address}?`,`¿Me mandas un taxi a ${address} o al hospital?`])Deno.test('natural taxi request: doubt, hypothetical, third-party or alternative does not edit the pickup: '+current,()=>{
 let rejected=false;try{parseInterpretation({intent:'provide',fields:{origin:{value:address,evidence:current}}},current);}catch{rejected=true;}assert(rejected);
});
