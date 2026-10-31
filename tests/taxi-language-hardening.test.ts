import { assert, assertEquals, assertThrows } from 'https://deno.land/std@0.177.0/testing/asserts.ts';
import { coordinateTaxi, type TaxiServices } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/coordinator.ts';
import { emptyDraft, type Interpretation, type TaxiChannel, type TaxiInbound, type TaxiSession } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
import { locationRole, parseInterpretation } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/policy.ts';
import { TAXI_LANGUAGE_CASES } from './fixtures/taxi-language-hardening.ts';

const now=Date.parse('2026-10-30T21:00:00Z');
const channel:TaxiChannel={tenantId:'11111111-1111-4111-8111-111111111111',waba:'+529630000001',enabled:true,name:'Base sintética',city:'Comitán',centerLat:16.25,centerLng:-92.13,radiusKm:20,dispatcher:null,model:'fixture',baseCents:null,perKmCents:null,pricingMode:'h3_zone_max'};
const message=(text:string):TaxiInbound=>({id:crypto.randomUUID(),from:'+529630000002',to:channel.waba,at:new Date(now).toISOString(),type:'text',text,button:null,location:null});
const state=():TaxiSession=>({revision:0,mode:'bot',draft:emptyDraft(),active:null,history:[]});
function services(interpretation:Interpretation|Error):TaxiServices{return{interpret:async()=>{if(interpretation instanceof Error)throw interpretation;return interpretation;},resolve:async()=>({kind:'unavailable'}),quote:async()=>5500,candidates:async()=>{throw Error('No dispatch before a current button.');}};}

for(const item of TAXI_LANGUAGE_CASES.filter(item=>item.expected.intent==='provide'||item.expected.intent==='quote'))Deno.test('literal language fixture contract: '+item.id,()=>{
 const fields:Interpretation['fields']={};
 for(const key of ['name','origin','destination','pickupReference'] as const){const value=item.expected.fields[key]?.[0];if(value)fields[key]={value,evidence:item.message};}
 assertEquals(parseInterpretation({intent:item.expected.intent,fields},item.message),{intent:item.expected.intent,fields});
});
for(const item of TAXI_LANGUAGE_CASES.filter(item=>item.expected.intent==='ambiguous'))Deno.test('non-mutating language fixture contract: '+item.id,()=>{
 assertEquals(parseInterpretation({intent:'ambiguous',fields:{}},item.message),{intent:'ambiguous',fields:{}});
});

for(const item of [
 {text:'voy a Pilita Seca y no llevo equipaje',key:'destination',value:'Pilita Seca'},
 {text:'estoy en El Piedrón, no traigo maletas',key:'origin',value:'El Piedrón'},
 {text:'Me llamo Mariana y no traigo equipaje',key:'name',value:'Mariana'},
 {text:'voy a Pilita Seca, no al Centro',key:'destination',value:'Pilita Seca'},
 {text:'estoy en El Piedrón, mejor llévame a Pilita Seca',key:'origin',value:'El Piedrón'},
] as const)Deno.test('natural clauses preserve a valid field: '+item.text,()=>{
 const result=parseInterpretation({intent:'provide',fields:{[item.key]:{value:item.value,evidence:item.text}}},item.text);
 assertEquals(result.fields[item.key]?.value,item.value);
});
for(const text of ['no voy a Pilita Seca','voy a Pilita Seca o al Centro','si voy a Pilita Seca','mi vecino dijo que va a Pilita Seca','Voy a Pilita Seca.\nNo, mejor al Centro.'])Deno.test('natural clauses still reject a misleading proposal: '+text,()=>{
 assertThrows(()=>parseInterpretation({intent:'provide',fields:{destination:{value:'Pilita Seca',evidence:'Pilita Seca'}}},text));
});
Deno.test('literal word boundaries: a model cannot turn Mariana into Ana or ala into la',()=>{
 assertThrows(()=>parseInterpretation({intent:'provide',fields:{name:{value:'Ana',evidence:'Mariana'}}},'Mariana'));
 assertThrows(()=>parseInterpretation({intent:'provide',fields:{destination:{value:'la pilita seca',evidence:'me yebas ala pilita seca porfa'}}},'me yebas ala pilita seca porfa'));
});
Deno.test('a later corrected place cannot hide an earlier place inside a longer word',()=>{
 const text='Recógeme en Centro.\nNo, mejor Centrosur.';
 assertThrows(()=>parseInterpretation({intent:'provide',fields:{origin:{value:'Centro',evidence:'Recógeme en Centro'}}},text));
});
Deno.test('a complete visual reference retains its negative contrast without changing the pin',()=>{
 const text='es el portón azul, no el rojo';
 assertEquals(parseInterpretation({intent:'provide',fields:{pickupReference:{value:text,evidence:text}}},text).fields.pickupReference?.value,text);
 assertThrows(()=>parseInterpretation({intent:'provide',fields:{pickupReference:{value:'el portón azul',evidence:'no es el portón azul'}}},'no es el portón azul'));
});
for(const [answer,role] of [['ahí me recoges','origin'],['es donde estoy','origin'],['ese es donde me vas a recoger','origin'],['ahí voy','destination'],['es a donde voy','destination'],['ese es el lugar al que voy','destination']] as const)Deno.test('a natural direct pin role answer: '+answer,()=>assertEquals(locationRole(answer),role));
for(const answer of ['si ahí me recoges','¿ahí me recoges?','ahí me recoges o ahí voy','ahí me recoges mañana','me recoges en Centro'])Deno.test('a conditional or address cannot select a pending pin: '+answer,()=>assertEquals(locationRole(answer),null));

for(const fails of [true,false])Deno.test('native pickup survives '+(fails?'interpreter outage':'ambiguous text')+' in the same turn without presenting a booking button',async()=>{
 const s=state();s.draft.awaitingLocation='origin';s.draft.name='Mariana';
 const pin:TaxiInbound={...message(''),type:'location',location:{lat:16.25,lng:-92.13}};
 const decision=await coordinateTaxi([pin,message('y la otra cosa')],s,channel,services(fails?Error('Declared outage'):{intent:'ambiguous',fields:{}}),now);
 assertEquals(decision.action,'draft');assertEquals(decision.draft.origin?.source,'gps');assertEquals(decision.draft.pickupMessageId,pin.id);assertEquals(decision.draft.confirmation,null);assert(!decision.messages.some(m=>m.buttons?.some(button=>button.id.startsWith('txc_'))));assert(decision.messages.some(m=>m.buttons?.some(button=>button.id==='txd_'+decision.draft.destinationPrompt)));
});
for(const issue of ['unclear_name','pickup_reference_too_long'] as const)Deno.test('native pickup survives a rejected field: '+issue,async()=>{
 const s=state();s.draft.awaitingLocation='origin';s.draft.name='Mariana';
 if(issue==='pickup_reference_too_long')s.draft.pickupText='x'.repeat(399);
 const text=issue==='unclear_name'?'Pilita Seca':'el portón azul';
 const proposal:Interpretation=issue==='unclear_name'?{intent:'provide',fields:{name:{value:text,evidence:text}}}:{intent:'provide',fields:{pickupReference:{value:text,evidence:text}}};
 const pin:TaxiInbound={...message(''),type:'location',location:{lat:16.25,lng:-92.13}};
 const decision=await coordinateTaxi([pin,message(text)],s,channel,services(proposal),now);
 assertEquals(decision.reason,issue);assertEquals(decision.draft.origin?.source,'gps');assertEquals(decision.draft.pickupMessageId,pin.id);assertEquals(decision.draft.name,'Mariana');assertEquals(decision.draft.confirmation,null);assert(!decision.messages.some(m=>m.buttons?.length));
});
Deno.test('an ambiguous native pin survives a provider outage until its role is clarified',async()=>{
 const s=state();s.draft.origin={text:'Pin anterior',lat:16.25,lng:-92.13,placeId:null,source:'gps'};s.draft.pickupMessageId='old';
 const pin:TaxiInbound={...message(''),type:'location',location:{lat:16.26,lng:-92.14}};
 const first=await coordinateTaxi([pin,message('mira')],s,channel,services(Error('Declared outage')),now);
 assertEquals(first.draft.origin,s.draft.origin);assertEquals(first.draft.pendingLocation?.messageId,pin.id);assertEquals(first.draft.confirmation,null);
 const second=await coordinateTaxi([message('ahí me recoges')],{...s,draft:first.draft},channel,services({intent:'smalltalk',fields:{}}),now);
 assertEquals(second.draft.origin?.lat,16.26);assertEquals(second.draft.pickupMessageId,pin.id);
});
