import{assert,assertEquals,assertStringIncludes}from'https://deno.land/std@0.177.0/testing/asserts.ts';
import{coordinateTaxi,taxiSummary,type TaxiServices}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/coordinator.ts';
import{emptyDraft,parseSession,type TaxiChannel,type TaxiInbound,type TaxiSession}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
import{parseTaxiToolCompletion}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/conversationTools.ts';
import{parseTaxiQuestion}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/conversationReply.ts';
import{taxiH3Scope}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/h3.ts';
import{defersDestination,locationRole,locationRoleConflict,refersToSharedLocation}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/policy.ts';
const now=Date.parse('2026-10-30T23:00:00Z');
const channel:TaxiChannel={tenantId:'11111111-1111-4111-8111-111111111111',waba:'+529630000001',enabled:true,name:'Base sintética',city:'Comitán',centerLat:16.25,centerLng:-92.13,radiusKm:20,dispatcher:null,model:'fixture',baseCents:5500,perKmCents:null,pricingMode:'h3_zone_max'};
const inbound=(text:string):TaxiInbound=>({id:crypto.randomUUID(),from:'+529630000002',to:channel.waba,at:new Date(now).toISOString(),type:'text',text,button:null,location:null});
const session=():TaxiSession=>({revision:0,mode:'bot',active:null,history:[],draft:{...emptyDraft(),name:'Mariana'}});
const never=async():Promise<never>=>{throw Error('This turn must not dispatch or invent a place.');};
const services:TaxiServices={interpret:async()=>({intent:'smalltalk',fields:{}}),resolve:never,quote:async()=>5500,candidates:never};
const completion=(name:string,args:Record<string,unknown>)=>({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'fixture',type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]});
Deno.test('destination dialogue: a pickup pin asks where the passenger is going before showing confirmation',async()=>{
 const pin={...inbound(''),type:'location' as const,location:{lat:16.25637,lng:-92.12810}};
 const result=await coordinateTaxi([pin],session(),channel,services,now);
 assertEquals(result.draft.confirmation,null);assertEquals(result.draft.awaitingLocation,'destination');
 assert(result.messages[0].buttons?.some(button=>button.id.startsWith('txd_')));assertStringIncludes(result.messages[0].text,'dónde');
});
Deno.test('friendly summary: personalized pickup and destination links are tappable, without unsolicited fare, and with explicit button cue',()=>{
 const draft={...emptyDraft(),name:'Jorge',origin:{text:'Ubicación compartida (16.23533, -92.12439)',lat:16.23533,lng:-92.12439,placeId:null,source:'gps' as const},destination:{text:'Ubicación compartida (16.23554, -92.12495)',lat:16.23554,lng:-92.12495,placeId:null,source:'gps' as const},quoteCents:6500,quoteBasis:'route' as const};
 const text=taxiSummary(draft);
 assertStringIncludes(text,'🚕 ¡Listo, Jorge! Ya tenemos los datos de tu viaje.');
 assertStringIncludes(text,'📍 *Pasamos por ti aquí:*\nhttps://maps.google.com/?q=16.23533,-92.12439');
 assertStringIncludes(text,'🏁 *Y te llevamos aquí:*\nhttps://maps.google.com/?q=16.23554,-92.12495');
 assertEquals(text.includes('💵'),false);assertEquals(text.includes('$65.00'),false);
 assertStringIncludes(text,'¿Todo está correcto, Jorge? 😊');
 assertStringIncludes(text,'toca *Confirmar viaje* aquí abajo y enseguida buscamos un taxi');
 assertEquals(text.includes('**'),false);assertEquals(text.includes('[Ver punto de recogida]'),false);
});
Deno.test('friendly summary: optional destination and pickup reference omit the fare unless requested',()=>{
 const draft={...emptyDraft(),name:'Jorge',origin:{text:'Ubicación compartida (16.23533, -92.12439)',lat:16.23533,lng:-92.12439,placeId:null,source:'gps' as const},destinationDeferred:true,quoteCents:5500,quoteBasis:'pickup' as const,pickupText:'Frente a la tienda azul'};
 const text=taxiSummary(draft);
 assertStringIncludes(text,'🏁 El destino puedes indicárselo al conductor.');
 assertStringIncludes(text,'📝 *Referencia para encontrarte:* Frente a la tienda azul');
 assertEquals(text.includes('💵'),false);assertEquals(text.includes('$55.00'),false);
 assertEquals(text.includes('https://maps.google.com/?q='),true);
});
Deno.test('taxi summary: shows the verified fare only when the client explicitly asks for it',async()=>{
 const askFare=async(intent:'request'|'quote')=>{
  const s=session();s.draft={...s.draft,origin:{text:'Pin de recogida',lat:16.25,lng:-92.13,placeId:null,source:'gps'},pickupMessageId:'native-pickup',destination:{text:'Terminal',lat:16.26,lng:-92.14,placeId:null,source:'gps'},name:'Jorge'};
  const configured={...services,interpret:async()=>({intent,fields:{}}),quote:async()=>6500};
  return await coordinateTaxi([inbound(intent==='quote'?'¿Cuánto cuesta?':'Mándame el taxi, por favor')],s,channel,configured,now);
 };
 const requested=await askFare('request'),asked=await askFare('quote');
 assertEquals(requested.draft.confirmation!==null,true);assertEquals(requested.messages[0].text.includes('💵'),false);
 assertEquals(asked.draft.confirmation!==null,true);assertStringIncludes(asked.messages[0].text,'💵 *Tarifa estimada del recorrido:* $65.00 MXN.');
});
Deno.test('service questions: the interpreter can propose a question while retaining an explicit route update',()=>{
 const current='Voy al Centro, ¿me mostrarás un resumen antes?';
 const result=parseTaxiToolCompletion(completion('responder_duda',{fields:{destination:{value:'Centro',evidence:'Voy al Centro'}}}),current);
 assertEquals(result.intent,'question');assertEquals(result.fields.destination?.value,'Centro');
});
Deno.test('natural taxi request: the interpreter identifies a booking request without inventing an address or confirming a ride',()=>{
 const result=parseTaxiToolCompletion(completion('solicitar_taxi',{}),'Buenas tardes\nMe puede enviar un taxi');
 assertEquals(result.intent,'request');assertEquals(result.fields,{});
});
Deno.test('natural taxi request: text-only request asks for the pickup naturally and keeps the GPS requirement',async()=>{
 const s=session(),answer='¡Claro! 😊 Compárteme tu ubicación por aquí y seguimos con tu viaje.';
 const f:TaxiServices={...services,interpret:async()=>({intent:'request',fields:{}}),question:async(kind,_current,_channel,_signal,context)=>{assertEquals(kind,'pickup_gps');assertEquals(context?.phase,'origin');return answer;}};
 const result=await coordinateTaxi([inbound('Buenas tardes'),inbound('Me puede enviar un taxi')],s,channel,f,now);
 assertEquals(result.draft.awaitingLocation,'origin');assertEquals(result.draft.confirmation,null);assertEquals(result.messages[0].locationRequest,'origin');assertEquals(result.messages[0].text,answer);
});
Deno.test('native location language: deictic text identifies a paired destination pin without treating “esta” as an address',async()=>{
 const s=session(),pickup={text:'Recogida',lat:16.25,lng:-92.13,placeId:null,source:'gps' as const},dropoff={text:'Destino',lat:16.26,lng:-92.14,placeId:null,source:'gps' as const};
 s.draft={...s.draft,origin:pickup,pickupMessageId:'pickup-native',awaitingLocation:'destination',destinationPrompt:crypto.randomUUID(),expiresAt:new Date(now+600000).toISOString()};
 const destination={...inbound(''),id:'destination-native',type:'location' as const,location:{lat:dropoff.lat,lng:dropoff.lng}};
 const f:TaxiServices={...services,resolve:never};
 const result=await coordinateTaxi([inbound('A esta dirección'),destination,inbound('Y voy para esta')],s,channel,f,now);
 assertEquals(result.draft.destination?.lat,dropoff.lat);assertEquals(result.draft.destination?.lng,dropoff.lng);assertEquals(result.draft.confirmation!==null,true);assertStringIncludes(result.messages[0].text,'🏁 *Y te llevamos aquí:*');assertStringIncludes(result.messages[0].text,'https://maps.google.com/?q=16.26000,-92.14000');
});
Deno.test('native location language: request, pickup pin, deictic destination and destination pin form one review without dispatch',async()=>{
 const s=session(),pickup={...inbound(''),id:'pickup-native',type:'location' as const,location:{lat:16.25,lng:-92.13}},dropoff={...inbound(''),id:'destination-native',type:'location' as const,location:{lat:16.26,lng:-92.14}};
 const result=await coordinateTaxi([inbound('Buenas tardes'),inbound('Me puede enviar un taxi'),pickup,inbound('A esta dirección'),dropoff,inbound('Y voy para esta')],s,channel,services,now);
 assertEquals(result.draft.origin?.lat,16.25);assertEquals(result.draft.destination?.lat,16.26);assert(result.draft.confirmation);assertEquals(result.action,'draft');assertEquals(result.candidates,[]);assertStringIncludes(result.messages[0].text,'📍 *Pasamos por ti aquí:*');assertStringIncludes(result.messages[0].text,'🏁 *Y te llevamos aquí:*');assert(result.messages[0].buttons?.[0].id.startsWith('txc_'));
});
for(const [text,role] of [['Y voy para esta','destination'],['Voy para esta dirección','destination'],['Me mandas un taxi a esta dirección','origin']] as const)Deno.test('native location language: route cue '+text,()=>assertEquals(locationRole(text),role));
Deno.test('native location language: a text with both route endpoints is not used to label a single pin',()=>assert(locationRoleConflict('Me recoges aquí y voy para esta')));
Deno.test('native location language: endpoint cues on separate batched messages remain distinct',()=>{
 const batch='Buenas tardes\nMe puede enviar un taxi\nAquí estoy\nY voy para esta\nSoy Jorge';
 assert(locationRoleConflict(batch));assertEquals(locationRole(batch),null);
});
Deno.test('native location language: a deictic pointer is not a literal address',()=>{assert(refersToSharedLocation('a esta dirección'));assert(refersToSharedLocation('esta ubicación'));assertEquals(refersToSharedLocation('Pilita Seca'),false);});
Deno.test('friendly phrasing: a grounded short explanation can precede the pickup question',()=>{
 const question='Así el chofer puede ubicarte mejor. ¿Me compartes tu ubicación con el botón?';
 assertEquals(parseTaxiQuestion({choices:[{finish_reason:'stop',message:{content:JSON.stringify({question})}}]},'pickup_gps'),question);
});
Deno.test('natural conversation: an unclear shared point gets a contextual answer without exposing coordinates or changing state',async()=>{
 const s=session(),oldPoint={text:'Punto anterior',lat:16.25,lng:-92.13,placeId:null,source:'gps' as const};
 s.draft={...s.draft,awaitingLocation:'choice',pendingLocation:{place:oldPoint,expiresAt:new Date(now+600000).toISOString()}};
 const shared={...inbound(''),type:'location' as const,location:{lat:16.25637,lng:-92.12810}};
 const answer='¿El punto que compartiste es donde pasamos por ti o el lugar a donde vas? 🚕';
 const f:TaxiServices={...services,question:async(kind,current,_channel,_signal,context)=>{assertEquals(kind,'conversation');assertEquals(current,'Compartiste un punto de ubicación por WhatsApp.');assertEquals(context?.nextStep,'location_role');assertStringIncludes(context?.backendReply??'','¿Este punto es donde pasamos por ti');return answer;}};
 const result=await coordinateTaxi([shared],s,channel,f,now);
 assertEquals(result.reason,'location_target_unclear');assertEquals(result.action,'draft');assertEquals(result.draft.awaitingLocation,'choice');assertEquals(result.draft.confirmation,null);assertEquals(result.messages[0].text,answer);assertEquals(result.candidates,[]);
});
Deno.test('natural conversation: ambiguous text is rewritten from the backend response without altering the draft',async()=>{
 const s=session(),pickup={text:'Punto confirmado',lat:16.25,lng:-92.13,placeId:null,source:'gps' as const};
 s.draft={...s.draft,name:'Mariana',origin:pickup,pickupMessageId:'native',destinationDeferred:true};s.history=[{role:'assistant',content:'El resumen anterior venció.'},{role:'user',content:'No estoy segura.'}];
 const answer='Claro, no hay prisa. ¿Qué parte del viaje quieres revisar?';
 const f:TaxiServices={...services,interpret:async()=>({intent:'ambiguous',fields:{}}),question:async(kind,current,_channel,_signal,context)=>{assertEquals(kind,'conversation');assertEquals(current,'No sé qué hacer');assertEquals(context?.nextStep,'none');assertStringIncludes(context?.backendReply??'','corregir');assertEquals(context?.recent.length,2);return answer;}};
 const result=await coordinateTaxi([inbound('No sé qué hacer')],s,channel,f,now);
 assertEquals(result.reason,'ambiguous_intent');assertEquals(result.messages[0].text,answer);assertEquals(result.draft.origin,pickup);assertEquals(result.draft.name,'Mariana');assertEquals(result.candidates,[]);
});
const pin=()=>({...inbound(''),type:'location' as const,location:{lat:16.25,lng:-92.13}});
for(const text of ['se lo digo al chofer','Todavía no sé','Prefiero no decirlo ahorita','por ahora no'])Deno.test('optional destination: direct choice is accepted without a magic greeting: '+text,async()=>{
 const s=session(),ask=await coordinateTaxi([pin()],s,channel,services,now);s.draft=ask.draft;
 const result=await coordinateTaxi([inbound(text)],s,channel,services,now);
 assertEquals(result.draft.destinationDeferred,true);assertEquals(result.draft.destination,null);assert(result.draft.confirmation);assertEquals(result.draft.quoteCents,5500);assertEquals(result.action,'draft');assertEquals(result.candidates,[]);
});
Deno.test('natural conversation: the server keeps ownership of fare, map links and the current confirmation summary',async()=>{
 const s=session(),ask=await coordinateTaxi([pin()],s,channel,services,now);s.draft=ask.draft;let composerCalls=0;
 const f:TaxiServices={...services,question:async()=>{composerCalls++;return'Confirma aquí y ya te mandamos un taxi.';}};
 const result=await coordinateTaxi([inbound('se lo digo al chofer')],s,channel,f,now);
 assertEquals(composerCalls,0);assert(result.messages[0].buttons?.[0].id.startsWith('txc_'));assertStringIncludes(result.messages[0].text,'https://maps.google.com/?q=16.25000,-92.13000');assertEquals(result.messages[0].text.includes('$55.00 MXN'),false);assertStringIncludes(result.messages[0].text,'toca *Confirmar viaje*');assertEquals(result.candidates,[]);
});
for(const text of ['¿Puedo decirlo al chofer?','No sé si voy al Centro','Mi amigo dijo se lo digo al chofer','no se lo digo al chofer','se lo digo al chofer, mejor voy al Centro'])Deno.test('optional destination: question, third-party or later correction does not authorize deferral: '+text,()=>assertEquals(defersDestination(text),false));
Deno.test('optional destination: a superseded choice and a mixed batch cannot skip the current question',async()=>{
 const s=session(),ask=await coordinateTaxi([pin()],s,channel,services,now);s.draft=ask.draft;
 const wrong={...inbound(''),type:'button' as const,button:'txd_'+crypto.randomUUID()};
 assertEquals((await coordinateTaxi([wrong],s,channel,services,now)).reason,'stale_destination_choice');
 const choice={...wrong,button:'txd_'+s.draft.destinationPrompt};
 const mixed=await coordinateTaxi([choice,inbound('Mejor voy al Centro')],s,channel,services,now);assertEquals(mixed.draft.destinationDeferred,false);assertEquals(mixed.draft.confirmation,null);
});
for(const failure of ['ambiguous','provider_error'] as const)Deno.test('destination recovery: '+failure+' renews the optional choice and survives a restored session',async()=>{
 const s=session(),ask=await coordinateTaxi([pin()],s,channel,services,now);s.draft=ask.draft;
 let quotes=0,dispatches=0;
 const f:TaxiServices={...services,interpret:async()=>{if(failure==='provider_error')throw Error('Declared interpreter outage');return{intent:'ambiguous',fields:{}};},quote:async()=>{quotes++;return 5500;},candidates:async()=>{dispatches++;return[];}};
 const recovered=await coordinateTaxi([inbound('No entendí lo que me preguntaste')],s,channel,f,now);
 assertEquals(recovered.draft.origin,s.draft.origin);assertEquals(recovered.draft.pickupMessageId,s.draft.pickupMessageId);assertEquals(recovered.draft.name,s.draft.name);
 assert(recovered.draft.destinationPrompt);assert(recovered.draft.destinationPrompt!==s.draft.destinationPrompt);assert(recovered.messages[0].buttons?.some(button=>button.id==='txd_'+recovered.draft.destinationPrompt));
 assertEquals(recovered.draft.confirmation,null);assertEquals(quotes,0);assertEquals(dispatches,0);
 const restored=parseSession(JSON.parse(JSON.stringify({...s,draft:recovered.draft})));
 const review=await coordinateTaxi([inbound('se lo digo al chofer')],restored,channel,f,now);
 assertEquals(review.draft.destinationDeferred,true);assert(review.draft.confirmation);assertEquals(quotes,1);assertEquals(dispatches,0);
});
for(const stale of ['expired','replaced'] as const)Deno.test('destination recovery: '+stale+' choice returns a new live button without accepting the old one',async()=>{
 const s=session(),ask=await coordinateTaxi([pin()],s,channel,services,now);s.draft=ask.draft;
 if(stale==='expired')s.draft.expiresAt=new Date(now-1).toISOString();
 const oldToken=stale==='replaced'?crypto.randomUUID():s.draft.destinationPrompt;
 const f:TaxiServices={...services,interpret:never,quote:never,candidates:never};
 const renewed=await coordinateTaxi([{...inbound(''),type:'button',button:'txd_'+oldToken}],s,channel,f,now);
 assertEquals(renewed.reason,'stale_destination_choice');assertEquals(renewed.action,'draft');assertEquals(renewed.draft.origin,s.draft.origin);assertEquals(renewed.draft.name,s.draft.name);assertEquals(renewed.draft.destinationDeferred,false);assertEquals(renewed.draft.confirmation,null);
 assert(renewed.draft.destinationPrompt!==s.draft.destinationPrompt);assert(renewed.draft.expiresAt&&Date.parse(renewed.draft.expiresAt)>now);assert(renewed.messages[0].buttons?.some(button=>button.id==='txd_'+renewed.draft.destinationPrompt));
});
for(const active of [false,true])Deno.test('destination recovery: an old choice cannot erase '+(active?'an active trip':'a destination already supplied'),async()=>{
 const s=session();s.draft={...s.draft,origin:{text:'Pin',lat:16.25,lng:-92.13,placeId:null,source:'gps'},pickupMessageId:'native',destinationText:'Terminal'};
 if(active)s.active={id:crypto.randomUUID(),state:'buscando_conductor',taxiName:null};
 const result=await coordinateTaxi([{...inbound(''),type:'button',button:'txd_'+crypto.randomUUID()}],s,channel,{...services,interpret:never,quote:never,candidates:never},now);
 assertEquals(result.reason,'stale_destination_choice');assertEquals(result.action,'reply');assertEquals(result.draft,s.draft);assertEquals(result.candidates,[]);
});
Deno.test('natural fare response: asking before giving a name preserves the server amount and does not let the redactor erase it',async()=>{
 const s=session();s.draft={...s.draft,name:null,origin:{text:'Pin',lat:16.25,lng:-92.13,placeId:null,source:'gps'},pickupMessageId:'native',destinationDeferred:true};
 let compositions=0,quotes=0;
 const f:TaxiServices={...services,interpret:async()=>({intent:'quote',fields:{}}),quote:async()=>{quotes++;return 6500;},question:async()=>{compositions++;return'Claro, ya casi terminamos. ¿A nombre de quién dejamos el viaje?';}};
 const result=await coordinateTaxi([inbound('¿Cuánto me sale?')],s,channel,f,now);
 assertEquals(result.reason,'missing_name');assertStringIncludes(result.messages[0].text,'$65.00 MXN');assertStringIncludes(result.messages[0].text,'nombre');assertEquals(compositions,0);assertEquals(quotes,1);assertEquals(result.draft.confirmation,null);assertEquals(result.candidates,[]);
});
Deno.test('service doubt: a question preserves an existing summary, price and current confirmation instead of restarting',async()=>{
 const s=session(),pickup={text:'Pin',lat:16.25,lng:-92.13,placeId:null,source:'gps' as const};s.draft={...s.draft,origin:pickup,pickupMessageId:'native',destinationDeferred:true,fareMode:'quoted',quoteCents:5500,quoteH3:taxiH3Scope(pickup,pickup),confirmation:crypto.randomUUID(),expiresAt:new Date(now+600000).toISOString()};
 const answer='No tengo confirmado ese método de pago. La base puede ayudarte a consultarlo.';
 const f:TaxiServices={...services,interpret:async()=>({intent:'question',fields:{}}),quote:never,question:async(kind,_current,_channel,_signal,context)=>{assertEquals(kind,'service_question');assertEquals(context?.phase,'review');assertEquals(context?.hasName,true);return answer;}};
 const result=await coordinateTaxi([inbound('¿Aceptan tarjeta?')],s,channel,f,now);assertEquals(result.action,'reply');assertEquals(result.draft,s.draft);assertEquals(result.messages[0].text,answer);assertEquals(result.candidates,[]);
});
Deno.test('service doubt: the natural answer also asks for pickup GPS and retains the native location request',async()=>{
 const answer='Para poder ubicarte bien y mandar la unidad al lugar correcto, ¿me compartes tu ubicación GPS con el botón?';
 const f:TaxiServices={...services,interpret:async()=>({intent:'question',fields:{}}),question:async(kind,_current,_channel,_signal,context)=>{assertEquals(kind,'service_question');assertEquals(context?.phase,'origin');return answer;}};
 const result=await coordinateTaxi([inbound('¿Cómo sabe el chofer dónde estoy?')],session(),channel,f,now);assertEquals(result.messages[0].text,answer);assertEquals(result.messages[0].locationRequest,'origin');assertEquals(result.draft.awaitingLocation,'origin');
});
Deno.test('service doubt: while choosing a destination, the answer keeps the optional destination button and asks where to go',async()=>{
 const s=session(),ask=await coordinateTaxi([pin()],s,channel,services,now);s.draft=ask.draft;
 const answer='Claro, puedes decirle el destino al chofer más tarde. ¿A dónde te llevamos?';
 const f:TaxiServices={...services,interpret:async()=>({intent:'question',fields:{}}),question:async(kind,_current,_channel,_signal,context)=>{assertEquals(kind,'service_question');assertEquals(context?.phase,'destination');return answer;}};
 const result=await coordinateTaxi([inbound('¿Puedo decidir el destino después?')],s,channel,f,now);assertEquals(result.messages[0].text,answer);assert(result.messages[0].buttons?.some(button=>button.id==='txd_'+s.draft.destinationPrompt));assertEquals(result.draft.confirmation,null);
});
Deno.test('service doubt: when the name is missing, the natural answer resumes with the passenger-name question',async()=>{
 const s=session();s.draft={...s.draft,name:null,origin:{text:'Pin',lat:16.25,lng:-92.13,placeId:null,source:'gps'},pickupMessageId:'native',destinationDeferred:true,fareMode:'quoted',quoteCents:5500,quoteH3:taxiH3Scope({text:'Pin',lat:16.25,lng:-92.13,placeId:null,source:'gps'},{text:'Pin',lat:16.25,lng:-92.13,placeId:null,source:'gps'})};
 const answer='Sí, primero revisamos el precio aquí. ¿A nombre de quién queda el viaje?';
 const f:TaxiServices={...services,interpret:async()=>({intent:'question',fields:{}}),question:async(kind,_current,_channel,_signal,context)=>{assertEquals(kind,'service_question');assertEquals(context?.phase,'name');return answer;}};
 const result=await coordinateTaxi([inbound('¿Me dices el precio antes?')],s,channel,f,now);assertEquals(result.messages[0].text,answer);assertEquals(result.draft.name,null);assertEquals(result.draft.confirmation,null);
});
Deno.test('natural service answer validation requires the missing next step',()=>{
 const answer='Sí, aquí puedes pedir el taxi. ¿A dónde te llevamos? Puedes decírselo al conductor después.';let rejected=false;
 try{parseTaxiQuestion({choices:[{finish_reason:'stop',message:{content:JSON.stringify({question:'Sí, aquí puedes pedir el taxi.'})}}]},'service_question',{baseName:'Base',city:'Comitán',hasPickupGps:true,hasName:true,hasDestination:false,destinationDeferred:false,phase:'destination',activeState:null,recent:[]});}catch{rejected=true;}
 assert(rejected);assertEquals(parseTaxiQuestion({choices:[{finish_reason:'stop',message:{content:JSON.stringify({question:answer})}}]},'service_question',{baseName:'Base',city:'Comitán',hasPickupGps:true,hasName:true,hasDestination:false,destinationDeferred:false,phase:'destination',activeState:null,recent:[]}),answer);
});
for(const question of ['Para seguir, necesito saber el destino. ¿A dónde vas?','Debes indicar el destino. ¿A dónde te llevamos?'])Deno.test('natural destination validation: a service answer cannot make an optional destination mandatory: '+question,()=>{
 const context={baseName:'Base',city:'Comitán',hasPickupGps:true,hasName:true,hasDestination:false,destinationDeferred:false,phase:'destination',activeState:null,recent:[],nextStep:'destination_optional' as const};
 let rejected=false;try{parseTaxiQuestion({choices:[{finish_reason:'stop',message:{content:JSON.stringify({question})}}]},'service_question',context);}catch{rejected=true;}assert(rejected);
});
for(const question of ['¿A dónde te llevamos? Si todavía no decides, puedes decírselo al conductor.','El destino es opcional. ¿A dónde vas?'])Deno.test('natural destination validation: a service answer keeps the optional choice: '+question,()=>{
 const context={baseName:'Base',city:'Comitán',hasPickupGps:true,hasName:true,hasDestination:false,destinationDeferred:false,phase:'destination',activeState:null,recent:[],nextStep:'destination_optional' as const};
 assertEquals(parseTaxiQuestion({choices:[{finish_reason:'stop',message:{content:JSON.stringify({question})}}]},'service_question',context),question);
});
Deno.test('service doubt: a question with a new destination keeps the change and answers before the authoritative summary',async()=>{
 const s=session();s.draft={...s.draft,origin:{text:'Pin',lat:16.25,lng:-92.13,placeId:null,source:'gps'},pickupMessageId:'native'};
 const f:TaxiServices={...services,interpret:async()=>({intent:'question',fields:{destination:{value:'Centro',evidence:'Voy al Centro'}}}),resolve:async()=>({kind:'unavailable'}),question:async()=> 'Te muestro un resumen para que puedas revisarlo antes de solicitar el taxi.'};
 const result=await coordinateTaxi([inbound('Voy al Centro, ¿me mostrarás un resumen antes?')],s,channel,f,now);assertEquals(result.draft.destinationText,'Centro');assertEquals(result.messages.length,2);assert(result.messages[1].buttons?.[0].id.startsWith('txc_'));assertEquals(result.candidates,[]);
});
for(const text of ['Ya quedó registrado tu taxi.','Aceptamos tarjeta y efectivo.','Tu taxi llegará en cinco minutos.','El precio es de 55 pesos.','https://example.com','La unidad ya llegó por ti.'])Deno.test('natural service answer rejects fabricated facts or mutations: '+text,()=>{
 let rejected=false;try{parseTaxiQuestion({choices:[{finish_reason:'stop',message:{content:JSON.stringify({question:text})}}]},'service_question');}catch{rejected=true;}assert(rejected);
});
