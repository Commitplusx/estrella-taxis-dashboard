import{assert,assertEquals,assertStringIncludes}from'https://deno.land/std@0.177.0/testing/asserts.ts';
import{coordinateTaxi,taxiSummary,type TaxiServices}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/coordinator.ts';
import{emptyDraft,type TaxiChannel,type TaxiInbound,type TaxiSession}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
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
Deno.test('friendly summary: personalized pickup and destination links are tappable WhatsApp URLs, with the server fare and explicit button cue',()=>{
 const draft={...emptyDraft(),name:'Jorge',origin:{text:'Ubicación compartida (16.23533, -92.12439)',lat:16.23533,lng:-92.12439,placeId:null,source:'gps' as const},destination:{text:'Ubicación compartida (16.23554, -92.12495)',lat:16.23554,lng:-92.12495,placeId:null,source:'gps' as const},quoteCents:6500,quoteBasis:'route' as const};
 const text=taxiSummary(draft);
 assertStringIncludes(text,'🚕 ¡Listo, Jorge! Ya tenemos los datos de tu viaje.');
 assertStringIncludes(text,'📍 *Pasamos por ti aquí:*\nhttps://maps.google.com/?q=16.23533,-92.12439');
 assertStringIncludes(text,'🏁 *Y te llevamos aquí:*\nhttps://maps.google.com/?q=16.23554,-92.12495');
 assertStringIncludes(text,'💵 *Tarifa estimada del recorrido:* $65.00 MXN.');
 assertStringIncludes(text,'¿Todo está correcto, Jorge? 😊');
 assertStringIncludes(text,'toca *Confirmar viaje* aquí abajo y enseguida buscamos un taxi');
 assertEquals(text.includes('**'),false);assertEquals(text.includes('[Ver punto de recogida]'),false);
});
Deno.test('friendly summary: an optional destination and pickup-only fare are stated without implying a route quote',()=>{
 const draft={...emptyDraft(),name:'Jorge',origin:{text:'Ubicación compartida (16.23533, -92.12439)',lat:16.23533,lng:-92.12439,placeId:null,source:'gps' as const},destinationDeferred:true,quoteCents:5500,quoteBasis:'pickup' as const,pickupText:'Frente a la tienda azul'};
 const text=taxiSummary(draft);
 assertStringIncludes(text,'🏁 El destino puedes indicárselo al conductor.');
 assertStringIncludes(text,'📝 *Referencia para encontrarte:* Frente a la tienda azul');
 assertStringIncludes(text,'*Tarifa estimada desde tu ubicación:* $55.00 MXN. El importe final se confirma cuando indiques el destino.');
 assertEquals(text.includes('https://maps.google.com/?q='),true);
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
const pin=()=>({...inbound(''),type:'location' as const,location:{lat:16.25,lng:-92.13}});
for(const text of ['se lo digo al chofer','Todavía no sé','Prefiero no decirlo ahorita','por ahora no'])Deno.test('optional destination: direct choice is accepted without a magic greeting: '+text,async()=>{
 const s=session(),ask=await coordinateTaxi([pin()],s,channel,services,now);s.draft=ask.draft;
 const result=await coordinateTaxi([inbound(text)],s,channel,services,now);
 assertEquals(result.draft.destinationDeferred,true);assertEquals(result.draft.destination,null);assert(result.draft.confirmation);assertEquals(result.draft.quoteCents,5500);assertEquals(result.action,'draft');assertEquals(result.candidates,[]);
});
for(const text of ['¿Puedo decirlo al chofer?','No sé si voy al Centro','Mi amigo dijo se lo digo al chofer','no se lo digo al chofer','se lo digo al chofer, mejor voy al Centro'])Deno.test('optional destination: question, third-party or later correction does not authorize deferral: '+text,()=>assertEquals(defersDestination(text),false));
Deno.test('optional destination: a superseded choice and a mixed batch cannot skip the current question',async()=>{
 const s=session(),ask=await coordinateTaxi([pin()],s,channel,services,now);s.draft=ask.draft;
 const wrong={...inbound(''),type:'button' as const,button:'txd_'+crypto.randomUUID()};
 assertEquals((await coordinateTaxi([wrong],s,channel,services,now)).reason,'stale_destination_choice');
 const choice={...wrong,button:'txd_'+s.draft.destinationPrompt};
 const mixed=await coordinateTaxi([choice,inbound('Mejor voy al Centro')],s,channel,services,now);assertEquals(mixed.draft.destinationDeferred,false);assertEquals(mixed.draft.confirmation,null);
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
 const answer='Sí, aquí puedes pedir el taxi. ¿A dónde te llevamos?';let rejected=false;
 try{parseTaxiQuestion({choices:[{finish_reason:'stop',message:{content:JSON.stringify({question:'Sí, aquí puedes pedir el taxi.'})}}]},'service_question',{baseName:'Base',city:'Comitán',hasPickupGps:true,hasName:true,hasDestination:false,destinationDeferred:false,phase:'destination',activeState:null,recent:[]});}catch{rejected=true;}
 assert(rejected);assertEquals(parseTaxiQuestion({choices:[{finish_reason:'stop',message:{content:JSON.stringify({question:answer})}}]},'service_question',{baseName:'Base',city:'Comitán',hasPickupGps:true,hasName:true,hasDestination:false,destinationDeferred:false,phase:'destination',activeState:null,recent:[]}),answer);
});
Deno.test('service doubt: a question with a new destination keeps the change and answers before the authoritative summary',async()=>{
 const s=session();s.draft={...s.draft,origin:{text:'Pin',lat:16.25,lng:-92.13,placeId:null,source:'gps'},pickupMessageId:'native'};
 const f:TaxiServices={...services,interpret:async()=>({intent:'question',fields:{destination:{value:'Centro',evidence:'Voy al Centro'}}}),resolve:async()=>({kind:'unavailable'}),question:async()=> 'Te muestro un resumen para que puedas revisarlo antes de solicitar el taxi.'};
 const result=await coordinateTaxi([inbound('Voy al Centro, ¿me mostrarás un resumen antes?')],s,channel,f,now);assertEquals(result.draft.destinationText,'Centro');assertEquals(result.messages.length,2);assert(result.messages[1].buttons?.[0].id.startsWith('txc_'));assertEquals(result.candidates,[]);
});
for(const text of ['Ya quedó registrado tu taxi.','Aceptamos tarjeta y efectivo.','Tu taxi llegará en cinco minutos.','El precio es de 55 pesos.','https://example.com','La unidad ya llegó por ti.'])Deno.test('natural service answer rejects fabricated facts or mutations: '+text,()=>{
 let rejected=false;try{parseTaxiQuestion({choices:[{finish_reason:'stop',message:{content:JSON.stringify({question:text})}}]},'service_question');}catch{rejected=true;}assert(rejected);
});
