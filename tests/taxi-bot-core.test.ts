import {coordinateTaxi,type TaxiServices}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/coordinator.ts';
import {cancelsTaxi,confirmsTaxi,parseInterpretation}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/policy.ts';
import {emptyDraft,parseInbound,type TaxiChannel,type TaxiInbound,type TaxiSession}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
import {createTaxiInterpreter}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/interpreter.ts';
import {sendTaxiMessage,verifyYCloud}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/transport.ts';
import type{Fetcher}from'../estrella-taxis-backend/supabase/functions/_shared/tracking/http.ts';
function assert(v:unknown,m='Assertion failed'):asserts v{if(!v)throw new Error(m);}
const equal=(a:unknown,b:unknown)=>assert(JSON.stringify(a)===JSON.stringify(b),`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const now=Date.parse('2026-10-27T18:00:00Z'),customer='+529630000002',waba='+529630000001';
const channel:TaxiChannel={tenantId:'11111111-1111-4111-8111-111111111111',waba,enabled:true,name:'Base de prueba',city:'Comitán',centerLat:16.25,centerLng:-92.13,radiusKm:20,dispatcher:'+529630000099',model:'fixture-model',baseCents:null,perKmCents:null,pricingMode:'road_distance'};
const message=(text:string):TaxiInbound=>({id:crypto.randomUUID(),from:customer,to:waba,at:new Date(now).toISOString(),type:'text',text,button:null,location:null});
function session(complete=false):TaxiSession{return {revision:1,mode:'bot',active:null,history:[],draft:complete?{...emptyDraft(),fareMode:'quoted',pickupMessageId:'fixture-native',name:'Persona Prueba',origin:{text:'Centro',lat:16.25,lng:-92.13,placeId:null,source:'gps'},destination:{text:'Terminal',lat:16.26,lng:-92.14,placeId:null},quoteCents:6500,confirmation:'11111111-1111-4111-8111-111111111111',expiresAt:new Date(now+600000).toISOString()}:emptyDraft()};}
function fixture(proposal:unknown={intent:'smalltalk',fields:{}}){
  let calls=0,candidateCalls=0;
  const services:TaxiServices={
    interpret:async(text)=>{calls++;return parseInterpretation(proposal,text);},
    resolve:async(text)=>text==='Centro'?{kind:'resolved',place:{text,lat:16.25,lng:-92.13,placeId:null}}:text==='Terminal'?{kind:'resolved',place:{text,lat:16.26,lng:-92.14,placeId:null}}:{kind:'ambiguous',labels:['No definido']},
    quote:async()=>6500,candidates:async()=>{candidateCalls++;return [{deviceId:1,name:'Unidad 1'}];}
  };return {services,calls:()=>({calls,candidateCalls}),run:(text:string,s=session())=>coordinateTaxi([message(text)],s,channel,services,now)};
}
for(const text of ['¿Sí?','si cuesta menos de 100 mándalo','Sí, pero mejor a la terminal','no lo mandes','tal vez','dijo "sí"','si...','sí, mañana','confirma y cambia el origen'])Deno.test('taxi confirmation does not authorize: '+text,()=>equal(confirmsTaxi(text),false));
for(const text of ['¿Puedes cancelar?','no canceles mi taxi','si no llega cancélalo','me dijo cancela mi taxi','cancela mi taxi, mejor no'])Deno.test('taxi cancellation does not authorize: '+text,()=>equal(cancelsTaxi(text),false));
Deno.test('taxi interpretation requires literal current evidence and rejects fabricated values',()=>{
  for(const p of [{intent:'provide',fields:{origin:{value:'Terminal',evidence:'Centro'}}},{intent:'provide',fields:{origin:{value:'Centro',evidence:'Centro'}}}, {intent:'book_taxi',fields:{}}]){
    let rejected=false;try{parseInterpretation(p,'Ya no estoy ahí');}catch{rejected=true;}assert(rejected);
  }
});
Deno.test('taxi interpretation cannot crop negation, conditional, quote or later correction',()=>{
  for(const current of ['No en Centro','Manda a Centro, mejor Terminal','Si voy a Centro','Mi amigo dijo Centro','Mejor Centro, no Centro']){
    let rejected=false;try{parseInterpretation({intent:'provide',fields:{origin:{value:'Centro',evidence:'Centro'}}},current);}catch{rejected=true;}assert(rejected,current);
  }
  equal(parseInterpretation({intent:'provide',fields:{origin:{value:'Terminal',evidence:'No Centro, mejor Terminal'}}},'No Centro, mejor Terminal').fields.origin?.value,'Terminal');
});
Deno.test('written price request preserves the route but still needs pickup GPS',async()=>{
  const current='Soy Persona Prueba, de Centro a Terminal, cuánto cuesta';
  const f=fixture({intent:'quote',fields:{name:{value:'Persona Prueba',evidence:current},origin:{value:'Centro',evidence:current},destination:{value:'Terminal',evidence:current}}});
  const d=await f.run(current);equal(d.action,'draft');equal(d.draft.quoteCents,null);equal(f.calls().candidateCalls,0);equal(d.draft.pickupText,'Centro');equal(d.draft.confirmation,null);equal(d.messages[0].locationRequest,'origin');
});
Deno.test('a price question with explicit locations can be quoted without a name or a booking',async()=>{
  const current='¿Cuánto cuesta ir de Centro a Terminal?';const f=fixture({intent:'quote',fields:{origin:{value:'Centro',evidence:current},destination:{value:'Terminal',evidence:current}}});
  f.services.quote=async()=>6500;const d=await f.run(current);equal(d.action,'draft');equal(d.draft.confirmation,null);equal(d.messages[0].locationRequest,'origin');equal(d.draft.destination?.text,'Terminal');equal(f.calls().candidateCalls,0);
});
Deno.test('a complete ride still needs a current passenger confirmation',async()=>{
  const current='Soy Persona Prueba, de Centro a Terminal';
  const f=fixture({intent:'provide',fields:{name:{value:'Persona Prueba',evidence:current},origin:{value:'Centro',evidence:current},destination:{value:'Terminal',evidence:current}}});
  const d=await f.run(current);equal(d.action,'draft');equal(d.candidates.length,0);equal(f.calls().candidateCalls,0);
  const s=session(true);const button={...message(''),type:'button' as const,button:'txc_'+s.draft.confirmation};const confirmed=await coordinateTaxi([button],s,channel,f.services,now);equal(confirmed.action,'confirm');equal(confirmed.confirmation,s.draft.confirmation);equal(f.calls().candidateCalls,1);
});
Deno.test('a correction replaces the field and invalidates every previous summary token',async()=>{
  const f=fixture({intent:'provide',fields:{destination:{value:'Centro',evidence:'Mejor Centro'}}});const s=session(true);s.draft.origin={text:'Otra calle',lat:16.27,lng:-92.15,placeId:null};
  const result=await f.run('Mejor Centro',s);equal(result.action,'draft');equal(result.draft.destination?.text,'Centro');assert(result.draft.confirmation!==s.draft.confirmation);equal(f.calls().candidateCalls,0);
});
Deno.test('an ambiguous address clears only its target and never keeps an old confirmed location',async()=>{
  const f=fixture({intent:'provide',fields:{destination:{value:'La terminal',evidence:'Mejor La terminal'}}});const s=session(true),d=await f.run('Mejor La terminal',s);
  equal(d.action,'draft');equal(d.draft.destination,null);equal(d.draft.destinationText,'La terminal');equal(d.draft.origin,s.draft.origin);assert(d.draft.confirmation!==s.draft.confirmation);equal(f.calls().candidateCalls,0);
});
Deno.test('stale buttons and a confirmation beside a correction never dispatch',async()=>{
  const f=fixture();const s=session(true),m=message('');m.type='button';m.button='txc_22222222-2222-4222-8222-222222222222';
  const stale=await coordinateTaxi([m],s,channel,f.services,now);equal(stale.action,'reply');
  m.button='txc_'+s.draft.confirmation;const mixed=await coordinateTaxi([m,message('Mejor otro destino')],s,channel,f.services,now);equal(mixed.action,'draft');equal(mixed.draft.confirmation,null);equal(f.calls().candidateCalls,0);
});
Deno.test('missing confirmation cannot book and expired consent refreshes review without model consent',async()=>{
  const f=fixture({intent:'confirm',fields:{}}),missing=await f.run('Sí');equal(missing.action,'draft');equal(missing.messages[0].locationRequest,'origin');equal(missing.draft.confirmation,null);const s=session(true);s.draft.expiresAt=new Date(now-1).toISOString();const refreshed=await f.run('Sí',s);equal(refreshed.action,'draft');assert(refreshed.draft.confirmation!==s.draft.confirmation);equal(f.calls().candidateCalls,0);equal(f.calls().calls,0);
});
Deno.test('a live ride returns persisted status without requesting a second taxi',async()=>{
  const f=fixture(),s=session(true);s.active={id:crypto.randomUUID(),state:'buscando_conductor',taxiName:null};const d=await f.run('Mándame otro',s);equal(d.action,'reply');assert(d.messages[0].text.includes('Todavía no hay una unidad confirmada'));equal(f.calls().calls,0);
  s.active.state='en_camino';s.active.taxiName='Unidad 1';assert((await f.run('¿Ya viene?',s)).messages[0].text.includes('ya aceptó'));
});
Deno.test('taxi messages use friendly emojis only for their conversational state',async()=>{
  const greeting=await fixture().run('Hola');assert(/😊/.test(greeting.messages[0]?.text??''));assert(/🚕/.test(greeting.messages[0]?.text??''));
  const current='Soy Persona Prueba, de Centro a Terminal';
  const summary=await fixture().run('Sí',session(true));
  assert(/^🚕 ¡Listo, Persona Prueba! Ya tenemos los datos de tu viaje\./.test(summary.messages[0]?.text??''));equal(summary.messages[0]?.buttons?.[0]?.title,'Confirmar viaje');
  const active=session(true);active.active={id:crypto.randomUUID(),state:'buscando_conductor',taxiName:null};assert(/^🚕/.test((await fixture().run('¿Cómo va?',active)).messages[0]?.text??''));
  assert(/😊/.test((await fixture().run('Gracias')).messages[0]?.text??''));
});
Deno.test('explicit cancellation binds only the persisted active trip',async()=>{
  const f=fixture(),s=session(true);s.active={id:crypto.randomUUID(),state:'en_camino',taxiName:'Unidad 1'};const d=await f.run('Cancela mi taxi',s);equal(d.action,'cancel');equal(d.tripId,s.active.id);equal(f.calls().calls,0);
});
for(const current of ['Quiero una persona real','Es una emergencia','Mañana a las 8','Necesito dos taxis','Vamos seis personas','Llevo una mascota'])Deno.test('special service or handoff does not silently create a normal immediate ride: '+current,async()=>{const f=fixture();const d=await f.run(current,session(true));equal(d.action,'human');equal(f.calls().candidateCalls,0);});
Deno.test('native location never guesses whether a completed draft means pickup or destination',async()=>{
  const f=fixture(),m=message('');m.type='location';m.location={lat:16.255,lng:-92.135};const d=await coordinateTaxi([m],session(true),channel,f.services,now);equal(d.reason,'location_target_unclear');equal(d.draft.confirmation,null);
});
Deno.test('human ownership suppresses model and automated replies',async()=>{const f=fixture(),s=session(true);s.mode='human';const d=await f.run('Hola',s);equal(d.messages,[]);equal(f.calls().calls,0);});
Deno.test('model failure preserves fields, explains the unapplied change and requires a new review button',async()=>{
  const f=fixture();f.services.interpret=async()=>{throw new Error('fixture failure');};const s=session(true),d=await f.run('Mejor recoge en otra calle',s);equal(d.action,'draft');equal(d.draft.origin,s.draft.origin);equal(d.draft.destination,s.draft.destination);equal(d.draft.name,s.draft.name);assert(d.draft.confirmation&&d.draft.confirmation!==s.draft.confirmation);assert(d.messages[0].text.includes('No pude aplicar tu último mensaje'));assert(d.messages[0].buttons?.some(button=>button.id==='txc_'+d.draft.confirmation));equal(f.calls().candidateCalls,0);
});
Deno.test('fleet failure is a human review, never a fictitious booking success',async()=>{const f=fixture();f.services.candidates=async()=>{throw new Error('fixture fleet failure');};const s=session(true);const d=await coordinateTaxi([{...message(''),type:'button',button:'txc_'+s.draft.confirmation}],s,channel,f.services,now);equal(d.action,'human');assert(!d.messages[0].text.includes('registrada'));});
Deno.test('native inbound requires a stable provider identity, valid sender and source timestamp',()=>{
  const raw={createTime:new Date(now).toISOString(),whatsappInboundMessage:{id:'fixture-id',from:customer,to:waba,type:'location',location:{latitude:16.25,longitude:-92.13}}};
  equal(parseInbound(raw,now)?.location,{lat:16.25,lng:-92.13});let rejected=false;try{parseInbound({...raw,whatsappInboundMessage:{...raw.whatsappInboundMessage,id:''}},now);}catch{rejected=true;}assert(rejected);
});
Deno.test('provider signatures bind the exact body and expire',async()=>{
  const raw='{"fixture":true}',secret='fixture-secret-not-a-real-provider-key',timestamp=String(now/1000);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+raw)));const signature=[...bytes].map((b)=>b.toString(16).padStart(2,'0')).join('');
  equal(await verifyYCloud(raw,`t=${timestamp},s=${signature}`,secret,now),true);equal(await verifyYCloud(raw+' ',`t=${timestamp},s=${signature}`,secret,now),false);equal(await verifyYCloud(raw,`t=${timestamp},s=${signature}`,secret,now+301000),false);
});
Deno.test('provider timeout or malformed success remains uncertain and is sent only once',async()=>{
  const out={id:crypto.randomUUID(),lease:crypto.randomUUID(),tenantId:channel.tenantId,waba,message:{to:customer,text:'Prueba'}};let calls=0;
  const timeout:Fetcher=async()=>{calls++;throw new Error('timeout');};equal(await sendTaxiMessage(out,'fixture-key',timeout),{state:'uncertain',code:'provider_result_unknown'});equal(calls,1);
  const accepted:Fetcher=async()=>new Response('{"id":"fixture-provider-id"}',{status:202});equal((await sendTaxiMessage(out,'fixture-key',accepted)).state,'accepted');
  const bad:Fetcher=async()=>new Response('{}',{status:200});equal((await sendTaxiMessage(out,'fixture-key',bad)).state,'uncertain');
});
Deno.test('interpreter rejects truncated output and exposes no booking action tool',async()=>{
  let posted='';const fetcher:Fetcher=async(_input,init)=>{posted=String(init?.body);return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{}'}}]}),{status:200});};
  let failed=false;try{await createTaxiInterpreter(fetcher,'fixture-key','fixture-model')('hola',session(),channel);}catch{failed=true;}assert(failed);assert(posted.includes('"tools"'));assert(!posted.includes('"book_taxi"'));assert(!posted.includes('json_object'));
});
