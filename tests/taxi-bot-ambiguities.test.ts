import {coordinateTaxi,type TaxiServices}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/coordinator.ts';
import {parseInterpretation}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/policy.ts';
import {emptyDraft,parseSession,type TaxiChannel,type TaxiSession,type TaxiInbound}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
import {TAXI_CLARIFICATION_CASES}from'./fixtures/taxi-semantic-clarification.ts';
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
function pendingDestination():TaxiSession{
  const s=state();s.draft={...s.draft,destination:null,destinationText:'Plaza Las Flores',destinationArea:null,destinationDeferred:false,destinationPrompt:null,awaitingLocation:'destination',quoteCents:null,quoteH3:null,confirmation:null,expiresAt:null};
  s.history=[{role:'assistant',content:'Encontré estas opciones: Plaza Las Flores (Cash A), Plaza Las Flores (otros puntos). ¿Cuál es?'}];return s;
}
for(const text of ['Soy Jorge','Me llamo Jorge'])Deno.test('semantic clarification: an identity answer cannot be appended to a pending destination: '+text,async()=>{
  const s=pendingDestination(),f=fixture({intent:'provide',fields:{name:{value:'Jorge',evidence:text}}});
  f.services.resolve=async()=>{throw Error('A passenger name must not be geocoded.');};
  const d=await f.run(text,s);equal(f.counts().calls,1);equal(d.draft.name,'Jorge');equal(d.draft.destinationText,s.draft.destinationText);equal(d.draft.origin,s.draft.origin);equal(d.draft.pickupMessageId,s.draft.pickupMessageId);assert(d.draft.confirmation);equal(f.counts().quotes,1);equal(f.counts().candidates,0);
});
Deno.test('semantic clarification: a name completes a written destination without another reference question',async()=>{
  const s=pendingDestination(),f=fixture({intent:'provide',fields:{name:{value:'Jorge',evidence:'Soy Jorge'}}});let composed=false;
  const reply='¡Gracias, Jorge! Para ubicar tu destino en Plaza Las Flores, ¿me das una referencia? Su pin es opcional. 😊';
  f.services.question=async(kind,_current,_channel,_signal,context)=>{composed=true;equal(kind,'conversation');assert(context?.backendReply?.includes('Plaza Las Flores'));equal(context?.hasPickupGps,true);equal(context?.nextStep,'destination_optional');return reply;};
  const d=await f.run('Soy Jorge',s);assert(!composed,'The protected review must not become another collection question');assert(d.messages[0].text.includes('¡Listo, Jorge!'));equal(d.draft.name,'Jorge');equal(d.draft.destinationText,'Plaza Las Flores');assert(d.draft.confirmation);equal(d.draft.pickupMessageId,s.draft.pickupMessageId);equal(f.counts().candidates,0);
});
for(const text of ['Voy para Hospital','Me llevan al Hospital'])Deno.test('semantic clarification: a new explicit destination replaces a pending locality: '+text,async()=>{
  const s=pendingDestination(),f=fixture({intent:'provide',fields:{destination:{value:'Hospital',evidence:text}}});let query='';
  f.services.resolve=async(value)=>{query=value;return{kind:'unavailable'};};
  const d=await f.run(text,s);equal(f.counts().calls,1);equal(query,'Hospital');equal(d.draft.destinationText,'Hospital');equal(d.draft.origin,s.draft.origin);equal(f.counts().candidates,0);
});
Deno.test('semantic clarification: a pickup correction cannot be appended to destination options',async()=>{
  const text='Estoy en Pilita Seca',s=pendingDestination(),f=fixture({intent:'provide',fields:{origin:{value:'Pilita Seca',evidence:text}}});
  const d=await f.run(text,s);equal(f.counts().calls,1);equal(d.draft.destinationText,'Plaza Las Flores');equal(d.draft.pickupText,'Pilita Seca');equal(d.draft.origin,null);equal(d.draft.pickupMessageId,null);equal(d.messages[0].locationRequest,'origin');equal(f.counts().candidates,0);
});
Deno.test('semantic clarification: explicit name correction preserves the pickup and destination',async()=>{
  const text='Sigo en la fuente y el nombre es Jorge',s=state(),f=fixture({intent:'provide',fields:{name:{value:'Jorge',evidence:'el nombre es Jorge'},pickupReference:{value:'la fuente',evidence:'Sigo en la fuente'}}});
  if(s.draft.destination)s.draft.destination={...s.draft.destination,source:'gps'};
  const d=await f.run(text,s);equal(d.draft.name,'Jorge');equal(d.draft.origin,s.draft.origin);equal(d.draft.destination,s.draft.destination);equal(d.draft.pickupText,'la fuente');assert(d.draft.confirmation&&d.draft.confirmation!==s.draft.confirmation);equal(f.counts().candidates,0);
});
Deno.test('semantic clarification: a later destination correction does not negate the pickup reference',()=>{
  const current='Estoy en la fuente.\nMejor voy a la Terminal.';
  const fields={pickupReference:{value:'la fuente',evidence:'Estoy en la fuente'},destination:{value:'Terminal',evidence:'Mejor voy a la Terminal'}};
  equal(parseInterpretation({intent:'provide',fields},current),{intent:'provide',fields});
});
for(const item of [
  {key:'origin',value:'Centro',evidence:'Recógeme en Centro',current:'Recógeme en Centro.\nMejor soy Jorge y recógeme en Terminal'},
  {key:'destination',value:'Hospital',evidence:'Voy al Hospital',current:'Voy al Hospital.\nMejor el nombre es Jorge y voy a Terminal'},
  {key:'pickupReference',value:'la fuente',evidence:'Estoy en la fuente',current:'Estoy en la fuente.\nMejor el destino es Hospital y recógeme en Terminal'},
])Deno.test('semantic clarification: another field in a correction cannot hide an obsolete '+item.key,()=>{
  let failed=false;try{parseInterpretation({intent:'provide',fields:{[item.key]:{value:item.value,evidence:item.evidence}}},item.current);}catch{failed=true;}assert(failed);
});
for(const item of TAXI_CLARIFICATION_CASES)Deno.test('semantic clarification fixture has current literal fields: '+item.id,()=>{
  const fields:Record<string,unknown>={};
  for(const key of ['name','origin','destination','pickupReference'] as const){const value=item.expected.fields[key]?.[0];if(value)fields[key]={value,evidence:item.message,...(key==='destination'&&item.refines?{refines:item.refines}:{})};}
  equal(parseInterpretation({intent:item.expected.intent,fields},item.message),{intent:item.expected.intent,fields});
});
for(const rejected of [null,false,{},'', 'x'.repeat(401),' Plaza Las Flores','Plaza\nLas Flores'])Deno.test('semantic clarification: invalid refinement metadata is rejected: '+JSON.stringify(rejected),()=>{
  let failed=false;try{parseInterpretation({intent:'provide',fields:{destination:{value:'Liverpool',evidence:'Liverpool',refines:rejected}}},'Liverpool');}catch{failed=true;}assert(failed);
});
for(const key of ['name','pickupReference'])Deno.test('semantic clarification: only endpoints can refine a pending locality: '+key,()=>{
  let failed=false;try{parseInterpretation({intent:'provide',fields:{[key]:{value:'Jorge',evidence:'Soy Jorge',refines:'Plaza Las Flores'}}},'Soy Jorge');}catch{failed=true;}assert(failed);
});
for(const setup of ['different_query','missing_written_destination','already_resolved','other_endpoint','too_long'] as const)Deno.test('semantic clarification: stale or invalid refinements cannot partially edit a route: '+setup,async()=>{
  const s=pendingDestination();let refines='Plaza Las Flores';
  if(setup==='different_query')refines='Otra Plaza';
  if(setup==='missing_written_destination'){s.draft.awaitingLocation=null;s.draft.destinationText=null;}
  if(setup==='already_resolved')s.draft.destination=state().draft.destination;
  if(setup==='other_endpoint')s.draft.awaitingLocation='origin';
  if(setup==='too_long'){refines='a'.repeat(397);s.draft.destinationText=refines;}
  const text='Liverpool, soy Jorge',f=fixture({intent:'provide',fields:{name:{value:'Jorge',evidence:'soy Jorge'},destination:{value:'Liverpool',evidence:'Liverpool',refines}}});
  f.services.resolve=async()=>{throw Error('Invalid refinement cannot call the resolver.');};
  const d=await f.run(text,s);equal(d.reason,'ambiguous_intent');equal(d.draft.name,s.draft.name);equal(d.draft.origin,s.draft.origin);equal(d.draft.destinationText,s.draft.destinationText);equal(d.draft.confirmation,null);equal(f.counts().quotes,0);equal(f.counts().candidates,0);
});
Deno.test('semantic clarification: identity and place detail apply together after a durable session reload',async()=>{
  const s=pendingDestination();s.history=[{role:'assistant',content:'¿Qué referencia tiene el lugar al que vas?'}];
  const text='Liverpool\nSoy Jorge',f=fixture({intent:'provide',fields:{name:{value:'Jorge',evidence:'Soy Jorge'},destination:{value:'Liverpool',evidence:'Liverpool',refines:'Plaza Las Flores'}}});let query='';
  f.services.resolve=async(value)=>{query=value;return{kind:'unavailable'};};
  const d=await f.run(text,parseSession(JSON.parse(JSON.stringify(s))));equal(query,'Plaza Las Flores, Liverpool');equal(d.draft.name,'Jorge');equal(d.draft.origin,s.draft.origin);equal(d.draft.destinationText,query);assert(d.draft.confirmation);equal(f.counts().quotes,1);equal(f.counts().candidates,0);
});
for(const failure of ['ambiguous','outage'] as const)Deno.test('semantic clarification: '+failure+' cannot bypass interpretation and invent a locality continuation',async()=>{
  const s=pendingDestination(),f=fixture({intent:'ambiguous',fields:{}});if(failure==='outage')f.services.interpret=async()=>{throw Error('Declared outage');};
  f.services.resolve=async()=>{throw Error('No query without a valid semantic proposal.');};
  const d=await f.run('Liverpool',s);equal(d.draft.destinationText,s.draft.destinationText);equal(d.draft.origin,s.draft.origin);assert(d.draft.confirmation);assert(d.messages[0].text.includes('No pude aplicar tu último mensaje'));equal(f.counts().quotes,1);equal(f.counts().candidates,0);
});
Deno.test('ambiguity audit: a later correction in another bubble defeats an earlier cropped origin',()=>{
  let rejected=false;try{parseInterpretation({intent:'provide',fields:{origin:{value:'Centro',evidence:'Centro'}}},'Recógeme en Centro.\nNo, mejor Terminal.');}catch{rejected=true;}assert(rejected,'El intérprete no puede imponer la dirección anterior tras una corrección posterior.');
});
Deno.test('ambiguity audit: a model-declared clarification refines the exact pending place after interpretation',async()=>{
  const f=fixture({intent:'provide',fields:{destination:{value:'Liverpool',evidence:'Liverpool',refines:'Plaza Las Flores'}}}),s=pendingDestination();
  const restored=parseSession(JSON.parse(JSON.stringify(s)));let resolvedQuery='';f.services.resolve=async(text)=>{resolvedQuery=text;return{kind:'resolved',place:{text:'Liverpool, Plaza Las Flores',lat:16.255,lng:-92.135,placeId:'fixture-liverpool',source:'written'}};};
  const d=await f.run('Liverpool',restored);equal(f.counts().calls,1);equal(resolvedQuery,'Plaza Las Flores, Liverpool');equal(d.draft.destination,null);equal(d.draft.destinationText,'Liverpool, Plaza Las Flores');equal(d.draft.quoteBasis,'pickup');assert(d.draft.confirmation);assert(d.messages[0]?.text.includes('Liverpool, Plaza Las Flores'));
});
Deno.test('ambiguity audit: catalog ambiguity keeps the literal destination and a pickup quote without asking for tariff categories',async()=>{
  const f=fixture({intent:'provide',fields:{destination:{value:'Liverpool',evidence:'Liverpool',refines:'Plaza Las Flores'}}}),s=pendingDestination();
  const cashA={label:'Plaza Las Flores',category:'cash_a' as const,version:'a'.repeat(32),cents:5500,cell:null,priceSource:'reference' as const};const other={...cashA,category:'otro_punto' as const,version:'b'.repeat(32)};let resolvedQuery='';f.services.resolve=async(text)=>{resolvedQuery=text;return{kind:'ambiguous',labels:['Plaza Las Flores (Cash A)','Plaza Las Flores (otros puntos)'],neighborhoods:[cashA,other]};};
  const d=await f.run('Liverpool',s);equal(resolvedQuery,'Plaza Las Flores, Liverpool');equal(d.reason,'summary');equal(d.draft.destinationText,'Plaza Las Flores, Liverpool');assert(d.messages[0]?.text.includes('Liverpool'));assert(!/Cash A|otros puntos|tarifa/.test(d.messages[0].text));equal(d.draft.destinationArea,null);equal(d.draft.quoteBasis,'pickup');assert(d.draft.confirmation);equal(f.counts().quotes,1);equal(f.counts().candidates,0);
});
Deno.test('ambiguity audit: an explicit new destination replaces the unresolved place instead of being appended',async()=>{
  const current='No, mejor voy al Hospital',f=fixture({intent:'provide',fields:{destination:{value:'Hospital',evidence:current}}}),s=state();s.draft={...s.draft,destination:null,destinationText:'Plaza Las Flores',destinationArea:null,destinationDeferred:false,destinationPrompt:null,awaitingLocation:'destination',quoteCents:null,quoteH3:null,confirmation:null,expiresAt:null};s.history=[{role:'assistant',content:'Encontré estas opciones: Plaza Las Flores (Cash A), Plaza Las Flores (otros puntos). ¿Cuál es?'}];let resolvedQuery='';f.services.resolve=async(text)=>{resolvedQuery=text;return{kind:'resolved',place:{text:'Hospital, Comitán',lat:16.255,lng:-92.135,placeId:'fixture-hospital',source:'written'}};};
  const d=await f.run(current,s);equal(resolvedQuery,'Hospital');equal(d.draft.destinationText,'Hospital, Comitán');assert(d.draft.confirmation);
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
