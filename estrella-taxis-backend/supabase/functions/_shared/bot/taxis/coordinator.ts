import {assertTaxiTransition,conversationPhase,hasDestination,pendingLocalityContext}from'./stateMachine.ts';
import type{ModelMetadata}from'./trace.ts';
import { emptyDraft, type Candidate, type Draft, type Interpretation, type Place, type TaxiChannel, type TaxiDecision, type TaxiInbound, type TaxiSession,type TaxiTurnContext,type FieldValue,type TaxiMessage } from './contracts.ts';
import { activeRideChange, cancellationQuestion, cancelsTaxi, confirmsTaxi, courtesyOnly, declinesTaxi, locationRole, locationRoleOnly, locationRoleConflict, refersToSharedLocation, needsHuman, normalize, unsupportedRide,resetCommand,cancelDraftCommand,draftLocationRequest,defersDestination } from './policy.ts';
import { getDistanceFromLatLonInKm } from '../../algorithms/headingMatcher.ts';
import { taxiH3Scope } from './h3.ts';
import type { NeighborhoodArea } from './neighborhoodContracts.ts';
import { localityDisplayName } from './neighborhoods.ts';
import type {TaxiQuestion,TaxiReplyContext}from'./conversationReply.ts';
import {constrainTaxiConversation,missingBookingDetails}from'./messageBudget.ts';
export type LocationResult={kind:'resolved';place:Place}|{kind:'ambiguous';labels:string[];neighborhoods?:NeighborhoodArea[]}|{kind:'reference_conflict';label:string}|{kind:'unavailable'};
export interface TaxiServices {
  interpret:(text:string,session:TaxiSession,channel:TaxiChannel,signal?:AbortSignal,observe?:(metadata:ModelMetadata)=>void,turn?:TaxiTurnContext)=>Promise<Interpretation>;
  resolve:(text:string,channel:TaxiChannel,signal?:AbortSignal,area?:NeighborhoodArea|null,observe?:(metadata:ModelMetadata)=>void)=>Promise<LocationResult>;
  quote:(origin:Place,destination:Place,channel:TaxiChannel,signal?:AbortSignal,destinationArea?:NeighborhoodArea|null)=>Promise<number|null>;
  candidates:(origin:Place,channel:TaxiChannel,signal?:AbortSignal,excluded?:readonly number[])=>Promise<Candidate[]>;
  question?:(kind:TaxiQuestion,current:string,channel:TaxiChannel,signal?:AbortSignal,context?:TaxiReplyContext)=>Promise<string|null>;
}
export function taxiSummary(d:Draft,includeFare=false):string {
  const name=d.name?.trim();
  const greeting=name?`🚕 ¡Listo, ${name}!`:'🚕 ¡Listo!';
  const short=(value:string,max:number)=>value.length<=max?value:value.slice(0,max-1).trimEnd()+'…';
  const mapsLink=(place:Place)=>`https://maps.google.com/?q=${place.lat.toFixed(5)},${place.lng.toFixed(5)}`;
  const pickup=d.origin?`📍 *Pasamos por ti aquí:*\n${mapsLink(d.origin)}${d.pickupText?`\n📝 *Referencia:* ${short(d.pickupText,160)}`:''}`:'📍 Aún falta confirmar dónde pasamos por ti.';
  const destination=d.destination
    ?`🏁 *Y te llevamos aquí:*\n${d.destination.source==='gps'?'':`${short(d.destination.text,160)}\n`}${mapsLink(d.destination)}`
    :d.destinationText||d.destinationArea
      ?`🏁 *Destino:* ${short(d.destinationText??d.destinationArea?.label??'',160)}`
      :'🏁 El destino puedes indicárselo al conductor.';
  const price=includeFare?(d.quoteCents===null
    ?'💵 La base necesita confirmar la tarifa antes de solicitar el taxi.'
    :d.quoteBasis==='pickup'
      ?`💵 *Tarifa estimada desde tu ubicación:* $${(d.quoteCents/100).toFixed(2)} MXN. El importe final se confirma cuando indiques el destino.`
      :`💵 *Tarifa estimada del recorrido:* $${(d.quoteCents/100).toFixed(2)} MXN.`):null;
  const review=name?`¿Todo está correcto, ${name}? 😊`:'¿Todo está correcto? 😊';
  return `${greeting}\n\n${pickup}\n\n${destination}${price?`\n\n${price}`:''}\n\n${review}\nToca *Confirmar viaje* y buscamos un taxi para ti.`;
}
/** Persist separate outbox messages instead of submitting an oversized interactive body. */
function summaryMessages(to:string,draft:Draft,includeFare=false,preamble=''):TaxiMessage[]{
  const text=preamble+taxiSummary(draft,includeFare),buttons=[{id:'txc_'+draft.confirmation,title:'Confirmar viaje'}];
  if(text.length>1024)throw new Error('Taxi summary exceeded the single-message contract.');
  return [{to,text,buttons}];
}
function live(t:TaxiSession['active']):boolean{return t?.state==='buscando_conductor'||t?.state==='en_camino';}
function within(p:Place,c:TaxiChannel):boolean{return getDistanceFromLatLonInKm(p.lat,p.lng,c.centerLat,c.centerLng)<=c.radiusKm;}
function pickupDescriptionKey(value:string):string{return normalize(value).replace(/^(?:(?:yo|aqui|aca|estoy|estamos|sigo|en|a|al|el|la|los|las)\s+)+/,'').replace(/[.!]+$/,'');}
function containsPickupDescription(known:string|null|undefined,value:string):boolean{
  const key=pickupDescriptionKey(value);return Boolean(key&&known?.split(/[.;\n]/).some(part=>pickupDescriptionKey(part)===key));
}
function restatesKnownPickup(d:Draft,value:string,evidence:string):boolean{
  if(d.origin?.source!=='gps'||!d.pickupMessageId||d.awaitingLocation==='origin')return false;
  if(/\b(?:ya no (?:estoy|estamos|sigo)|(?:me|nos) (?:movi|movimos|cambie|cambiamos)|ahora (?:estoy|recogeme|me recoges|te espero)|otra (?:entrada|direccion|calle|puerta|ubicacion)|nuevo (?:punto|origen)|(?:cambia|corrige) (?:el |mi )?(?:origen|recogida|punto))\b/.test(normalize(evidence)))return false;
  return containsPickupDescription(d.pickupText,value)||containsPickupDescription(d.origin.text,value);
}
/** Locate the final literal value inside its actual evidence, including clauses split across bubbles. */
function evidencedMessageIndex(messages:TaxiInbound[],field:FieldValue):number{
 const spans:{index:number;start:number;end:number}[]=[],parts:string[]=[];let offset=0;
 for(const [index,message]of messages.entries()){const value=normalize(message.text);if(!value)continue;if(parts.length)offset++;spans.push({index,start:offset,end:offset+value.length});parts.push(value);offset+=value.length;}
 const current=parts.join(' '),evidence=normalize(field.evidence),start=current.lastIndexOf(evidence),chosen=normalize(field.value);
 if(start<0)return-1;
 const escaped=chosen.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),at=[...evidence.matchAll(new RegExp('(?<![\\p{L}\\p{N}_])'+escaped+'(?![\\p{L}\\p{N}_])','gu'))].at(-1)?.index;
 if(at===undefined)return-1;
 const end=start+at+chosen.length-1;return spans.find(span=>span.start<=end&&span.end>end)?.index??-1;
}
function nativeLocationSegments(messages:TaxiInbound[]):{message:TaxiInbound;context:string}[]{
  const indexes=messages.flatMap((message,index)=>message.location?[index]:[]);
  if(indexes.length>1){
    const labels=messages.flatMap((message,index)=>message.type==='text'&&locationRole(message.text)&&!locationRoleConflict(message.text)?[{index,text:message.text}]:[]);
    // A label may precede or follow its pin. Pair in order only when every pin has
    // one explicit label and no pair crosses another pin; otherwise ask for roles.
    if(labels.length===indexes.length&&labels.every((label,position)=>!indexes.some(other=>other!==indexes[position]&&other>Math.min(label.index,indexes[position])&&other<Math.max(label.index,indexes[position]))))return indexes.map((index,position)=>({message:messages[index],context:labels[position].text}));
  }
  return indexes.map((index,position)=>{
    const start=position===0?0:indexes[position-1]+1;
    const end=position===indexes.length-1?messages.length:index+1;
    const context=messages.slice(start,end).filter((message)=>message.type==='text').map((message)=>message.text).filter(Boolean).join('\n');
    return{message:messages[index],context};
  });
}
function inferLocationRole(d:Draft,allowInference:boolean):'origin'|'destination'|null{
  if(d.awaitingLocation==='origin'||d.awaitingLocation==='destination')return d.awaitingLocation;
  if(d.awaitingLocation==='choice')return null;
  if(!allowInference)return null;
  if(!d.origin||d.origin.source!=='gps'||!d.pickupMessageId)return'origin';
  if(!d.destinationDeferred&&( !d.destination||d.destination.source==='written'||Boolean(d.destinationText||d.destinationArea)))return'destination';
  return null;
}
function replyNextStep(decision:TaxiDecision,phase:string):TaxiReplyContext['nextStep']{
  const message=decision.messages[0];
  if(message.locationRequest==='origin')return'pickup_gps';
  if(message.locationRequest==='destination'||message.buttons?.some(button=>button.id.startsWith('txd_')))return'destination_optional';
  if(['location_target_unclear','multiple_locations'].includes(decision.reason)||phase==='location_role')return'location_role';
  if(phase==='origin')return'pickup_gps';
  if(phase==='destination'&&!decision.draft.destinationDeferred)return'destination_optional';
  if(phase==='name'&&!decision.draft.name)return'passenger_name';
  return'none';
}
export async function coordinateTaxi(messages:TaxiInbound[],session:TaxiSession,channel:TaxiChannel,services:TaxiServices,now:number,signal?:AbortSignal):Promise<TaxiDecision> {
  const decision=await decideTaxi(messages,session,channel,services,now,signal);
  constrainTaxiConversation(session,decision,messages);
  const collection=decision.messages[0],missing=missingBookingDetails(decision.draft);
  const collectTogether=decision.action==='draft'&&!decision.draft.confirmation&&decision.messages.length===1&&missing.length>1&&
    ['pickup_gps_required','missing_destination','missing_name','location_still_pending','new_booking_requirements','greeting','taxi_requested','no_new_fields'].includes(decision.reason);
  if(collectTogether){
    const extras=[...(missing.includes('passenger_name')?['a nombre de quién va el taxi']:[]),...(missing.includes('destination_optional')?['a dónde te llevamos (o puedes decírselo al chofer)']:[])];
    collection.text+=` Para avanzar de una vez, dime también ${extras.join(' y ')}.`;
  }
  assertTaxiTransition(session,messages,decision,now);
  const outbound=decision.messages.length===1?decision.messages[0]:null,hasConfirmationSummary=decision.messages.some(message=>message.buttons?.some(button=>button.id.startsWith('txc_')));
  // A requested fare or server map link is authoritative output, just like a confirmation summary.
  const hasServerFacts=Boolean(outbound&&/(?:\$\s*\d|https?:\/\/)/i.test(outbound.text));
  const naturalInput=messages.every(message=>message.type==='text'||message.type==='location');
  if(services.question&&outbound&&['draft','reply'].includes(decision.action)&&naturalInput&&(!hasServerFacts||hasConfirmationSummary&&decision.reason==='service_question')&&(!hasConfirmationSummary||decision.reason==='service_question')&&!['neighborhood_ambiguous','location_clarification_followup'].includes(decision.reason)){
    const kind:TaxiQuestion=collectTogether?'conversation':decision.reason==='service_question'?'service_question':decision.reason==='missing_name'?'passenger_name':decision.reason==='missing_destination'?'destination_optional':outbound.locationRequest==='origin'?'pickup_gps':decision.reason==='active_status'?'active_status':['smalltalk','courtesy'].includes(decision.reason)?'smalltalk':'conversation';
    const d=decision.draft,recent:TaxiSession['history']=[];let size=0;for(const item of session.history.slice(-6).reverse()){if(size+item.content.length>2400)break;recent.unshift(item);size+=item.content.length;}
    const phase=conversationPhase({...session,draft:d},now);
    const context:TaxiReplyContext={baseName:channel.name,city:channel.city,hasPickupGps:Boolean(d.origin?.source==='gps'&&d.pickupMessageId),hasName:Boolean(d.name),hasDestination:hasDestination(d),destinationDeferred:d.destinationDeferred===true,phase,activeState:session.active?.state??null,recent,backendReply:hasConfirmationSummary?'El servidor preparó debajo el resumen vigente con tarifa verificada y el botón actual. No cambies ni repitas esos datos.':outbound.text,nextStep:hasConfirmationSummary?'none':collectTogether?'booking_details':replyNextStep(decision,phase),...(collectTogether?{missingDetails:missing}:{})};
    const current=messages.map(message=>message.type==='location'?'Compartiste un punto de ubicación por WhatsApp.':message.text).filter(Boolean).join('\n');
    let question:string|null=null;try{question=await services.question(kind,current,channel,signal,context);}catch{/* The server's validated decision and response remain authoritative if composition fails. */}
    if(question){if(hasConfirmationSummary){if(question.length+outbound.text.length+2<=1024)outbound.text=question+'\n\n'+outbound.text;else decision.messages.unshift({to:outbound.to,text:question});}else decision.messages[0]={...outbound,text:question};}
  }
  if(messages.some(message=>message.type==='unsupported')&&decision.messages.length){
    const note='Todavía no puedo leer audios, fotos o archivos; escríbeme lo que contienen. ',first=decision.messages[0];
    if(note.length+first.text.length<=1024)first.text=note+first.text;
    else decision.messages.push({to:first.to,text:note.trim()});
  }
  assertTaxiTransition(session,messages,decision,now);
  return decision;
}
async function decideTaxi(messages:TaxiInbound[],session:TaxiSession,channel:TaxiChannel,services:TaxiServices,now:number,signal?:AbortSignal):Promise<TaxiDecision> {
  if(messages.length<1||messages.length>20)throw new Error('Invalid taxi turn size.');
  const latest=messages[messages.length-1],current=messages.filter(m=>m.type!=='unsupported').map((m)=>m.text).filter(Boolean).join('\n');
  const base:TaxiDecision={action:'reply',draft:{...session.draft},confirmation:null,tripId:null,offerId:null,candidates:[],messages:[],reason:'reply'};
  const reply=(s:string,reason='reply'):TaxiDecision=>({...base,reason,messages:[{to:latest.from,text:s}]});
  const human=(reason:string,s='Voy a pasar tu mensaje a la base para que te ayuden.',draft:Draft=session.draft):TaxiDecision=>({...reply(s,reason),action:'human',draft:{...draft,confirmation:null,expiresAt:null,destinationPrompt:null}});
  const requestLocation=(d:Draft,role:'origin'|'destination',reason:string,body?:string):TaxiDecision=>({
    ...base,action:'draft',reason,draft:{...d,confirmation:null,expiresAt:null,quoteCents:null,quoteH3:null,awaitingLocation:role,pendingLocation:null,destinationPrompt:null,...(role==='destination'?{destinationDeferred:false}:{})},
    messages:[{to:latest.from,locationRequest:role,text:`${body??(role==='origin'?'¿Me compartes tu ubicación con el botón para que pasemos por ti? Si ya escribiste una dirección, la conservo como referencia.':'¿A dónde te llevamos? Puedes escribirlo o compartir la ubicación de ese lugar.')} 🚕`}],
  });
  const askDestination=(d:Draft,reason='missing_destination'):TaxiDecision=>{
    const token=crypto.randomUUID();return{...base,action:'draft',reason,draft:{...d,fareMode:'unquoted',confirmation:null,expiresAt:new Date(now+10*60000).toISOString(),quoteCents:null,quoteH3:null,awaitingLocation:'destination',pendingLocation:null,destinationDeferred:false,destinationPrompt:token},messages:[{to:latest.from,text:'¿A dónde te llevamos? Puedes escribir el destino, compartir su ubicación o decirlo después al chofer. 🚕',buttons:[{id:'txd_'+token,title:'Se lo digo al chofer'}]}]};
  };
  const clarifyPending=async(reason:string,draft:Draft=session.draft):Promise<TaxiDecision>=>{
    const d:Draft={...draft,confirmation:null,expiresAt:null,destinationPrompt:null};
    const phase=conversationPhase({...session,draft:d},now);
    if(reason==='unclear_name'||reason==='pickup_reference_too_long')return {...reply(reason==='unclear_name'?'¿Ese es el nombre del pasajero? ¿A nombre de quién queda el viaje?':'La referencia quedó muy larga. ¿Me la dices más breve para que el conductor pueda identificarte?',reason),action:'draft',draft:d};
    if(phase==='origin'||phase==='destination'){
      const area=phase==='origin'?d.originArea:d.destinationArea;
      if(phase==='destination'&&!hasDestination(d))return askDestination(d,reason);
      if(phase==='destination')return prepareSummary({...d,awaitingLocation:null},reason);
      const body=area
        ?phase==='origin'?`Ubico ${localityDisplayName(area)}. Comparte el pin GPS de recogida con el botón; conservo la dirección escrita como referencia.`:`Ubico ${localityDisplayName(area)}. ¿Qué calle o referencia tiene el destino? Su pin es opcional.`
        :phase==='origin'?'Necesito el pin GPS donde te recogemos. Usa el botón; conservo la dirección escrita como referencia.':'El destino es opcional. Si quieres precisarlo, dime a qué colonia o dirección vas; su pin es opcional.';
      return requestLocation(d,phase,reason,body);
    }
    if(phase==='name'||phase==='location_role')return {...reply(phase==='name'?'¿A nombre de quién queda el viaje? 😊':'¿El pin es donde te recogemos o a dónde vas? 🚕',reason),action:'draft',draft:d};
    // A fully collected route needs a usable review, not an open-ended correction loop.
    // Re-quote before issuing a new button; this is never permission to dispatch.
    return prepareSummary(d,reason);
  };
  const prepareSummary=async(draft:Draft,reason:string,verifiedQuote?:{cents:number|null}):Promise<TaxiDecision>=>{
    const d:Draft={...draft,fareMode:'quoted',confirmation:null,expiresAt:null,quoteCents:null,quoteH3:null};
    if(d.pendingLocation||d.awaitingLocation==='choice')return {...reply('¿El pin es el punto de recogida o el destino?','location_target_unclear'),action:'draft',draft:d};
    if(d.awaitingLocation==='origin')return requestLocation(d,'origin',reason==='service_question'?'service_question':'location_still_pending');
    if(!d.origin||d.origin.source!=='gps'||!d.pickupMessageId)return requestLocation(d,'origin',reason==='service_question'?'service_question':'pickup_gps_required');
    if(!hasDestination(d)&&d.destinationDeferred!==true)return askDestination(d,reason==='service_question'?reason:'missing_destination');
    d.awaitingLocation=null;d.originArea=null;
    d.destinationPrompt=null;
    if(d.destination?.source==='written'&&!d.destination.area){d.destinationText=d.destination.text;d.destination=null;}
    if(!within(d.origin,channel)||d.destination&&!within(d.destination,channel))return human('outside_service_area','El recorrido queda fuera de la cobertura actual. Paso la solicitud a la base para revisarla contigo.');
    let quoteCents:number|null=null;
    try{quoteCents=verifiedQuote?verifiedQuote.cents:await services.quote(d.origin,d.destination??d.origin,channel,signal,d.destination?null:d.destinationArea);}catch{return human('h3_quote_unavailable','No pude consultar la tarifa. Paso el recorrido a la base para que lo revisen contigo antes de solicitar una unidad.',d);}
    if(quoteCents===null||!Number.isSafeInteger(quoteCents)||quoteCents<Math.max(1,channel.baseCents??0)||quoteCents>10000000)return human('h3_quote_unavailable','No encontré una tarifa verificada para este punto. La base debe revisarla antes de solicitar el taxi.',d);
    const quoteBasis=d.destination||d.destinationArea?'route':'pickup';
    if(!d.name){
      const price=reason==='quote_only'?(quoteCents===null?'La base necesita confirmar la tarifa de ese recorrido. ':`Ese recorrido tiene una tarifa estimada de $${(quoteCents/100).toFixed(2)} MXN. `):'';
      return {...reply(price+'¿A nombre de quién pedimos el taxi? 😊',reason==='service_question'?'service_question':'missing_name'),action:'draft',draft:{...d,quoteCents,quoteBasis,quoteH3:channel.pricingMode==='h3_zone_max'?taxiH3Scope(d.origin,d.destination??d.origin):null}};
    }
    const summary:Draft={...d,quoteCents,quoteBasis,quoteH3:channel.pricingMode==='h3_zone_max'?taxiH3Scope(d.origin,d.destination??d.origin):null,confirmation:crypto.randomUUID(),expiresAt:new Date(now+10*60000).toISOString(),awaitingLocation:null,pendingLocation:null};
    const preamble=['ambiguous_intent','interpretation_failed'].includes(reason)?'No pude aplicar tu último mensaje con certeza. Estos son los datos que siguen guardados; revísalos antes de confirmar.\n\n':'';
    return {...base,action:'draft',draft:summary,reason,messages:summaryMessages(latest.from,summary,reason==='quote_only',preamble)};
  };
  const tariffReview=async(d:Draft):Promise<TaxiDecision|null>=>{
    if(!d.origin||d.origin.source!=='gps'||!d.pickupMessageId||d.fareMode!=='quoted'||d.quoteCents===null)return prepareSummary(d,'new_booking_requirements');
    for(const field of ['origin','destination'] as const){
      const place=d[field];if(!place?.area)continue;
      let current:LocationResult;try{current=await services.resolve(place.area.reference,channel,signal,place.area);}catch{return human('neighborhood_review_failed','No pude comprobar la colonia del recorrido. Paso la solicitud a la base antes de buscar una unidad.');}
      if(current.kind!=='resolved')return requestLocation({...d,[field]:null,[field+'Area']:null},field,'neighborhood_changed',field==='origin'?'Cambió la zona de recogida. Comparte de nuevo el pin GPS con el botón.':'Cambió la zona del destino. ¿Me confirmas la colonia, calle o referencia? Su pin es opcional.');
      if(JSON.stringify(current.place)!==JSON.stringify(place))return prepareSummary({...d,[field]:current.place},'neighborhood_changed');
    }
    if(!within(d.origin,channel)||d.destination&&!within(d.destination,channel))return human('outside_service_area','La cobertura de la base cambió y el recorrido queda fuera. Les paso tu solicitud antes de buscar una unidad.');
    let cents:number|null;
    try{cents=await services.quote(d.origin,d.destination??d.origin,channel,signal,d.destination?null:d.destinationArea);}catch{return human('h3_quote_unavailable','No pude volver a comprobar la tarifa. Paso la solicitud a la base antes de buscar una unidad.');}
    const scope=channel.pricingMode==='h3_zone_max'?taxiH3Scope(d.origin,d.destination??d.origin):null;
    if(cents!==d.quoteCents||JSON.stringify(scope)!==JSON.stringify(d.quoteH3))return prepareSummary(d,'tariff_changed',{cents});
    return null;
  };
  if(Date.parse(latest.at)<now-10*60000)return human('stale_turn','Tu mensaje quedó pendiente demasiado tiempo. La base debe confirmar si todavía necesitas el viaje.');
  if(messages.some(m=>m.type==='text'&&resetCommand(m.text))){
    const needsPin=session.mode==='bot'&&!live(session.active);
    const text=live(session.active)?'Reinicié la conversación. Tu viaje actual sigue activo; para cancelarlo escribe «Cancela mi taxi». 🚕':session.mode==='human'?'Reinicié los datos de la conversación. La base continúa atendiéndote. 🙂':'Listo, empezamos de nuevo. ¿Me compartes tu ubicación con el botón para que pasemos por ti? 🚕';
    return {...base,action:'reset',reason:'conversation_reset',draft:{...emptyDraft(),awaitingLocation:needsPin?'origin':null},messages:[{to:latest.from,text,...(needsPin?{locationRequest:'origin' as const}:{})}]};
  }
  if(current.length>6000)return human('turn_too_large','Recibí muchos datos juntos. Paso la conversación a la base para revisar el viaje contigo.');
  if(session.mode==='human'&&!messages.some((m)=>m.type==='button'&&/^tx[arf]_/.test(m.button??'')))return {...base,reason:'human_owned'};
  if(needsHuman(current))return human('human_requested');
  const buttons=messages.filter((m)=>m.type==='button');
  if(buttons.length) {
    if(buttons.length!==1||messages.length!==1)return {...reply('Llegaron respuestas distintas. Revisa el viaje y dime qué quieres hacer.','mixed_button_turn'),action:'draft',draft:{...session.draft,confirmation:null,expiresAt:null,destinationPrompt:null}};
    const id=buttons[0].button??'';
    // The commit validates ownership, token, expiry and native event atomically.
    // This remains a reply proposal; the model cannot authorize continuation.
    if(/^tx[wk]_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))return {...base,reason:'dispatch_choice',replyClass:'change'};
    if(id.startsWith('txd_')){
      if(live(session.active)||!session.draft.destinationPrompt||id!=='txd_'+session.draft.destinationPrompt||session.draft.awaitingLocation!=='destination'||!session.draft.expiresAt||Date.parse(session.draft.expiresAt)<=now){
        if(!live(session.active)&&session.draft.awaitingLocation==='destination'&&!hasDestination(session.draft))return askDestination(session.draft,'stale_destination_choice');
        return reply('Esa opción ya no corresponde al viaje actual. Revisemos a dónde quieres ir.','stale_destination_choice');
      }
      return prepareSummary({...session.draft,destinationDeferred:true,destinationPrompt:null,awaitingLocation:null,expiresAt:null},'destination_deferred');
    }
    const driver=/^tx([arf])_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(id);
    if(driver)return {...base,action:driver[1]==='a'?'driver_accept':driver[1]==='r'?'driver_reject':'driver_finish',offerId:driver[2],reason:'driver_button'};
    const confirm=/^txc_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(id);
    if(confirm&&live(session.active))return reply('Ya tienes una solicitud activa. La base sigue pendiente de ese viaje.','active_trip');
    if(!confirm)return reply('Ese botón ya no corresponde al viaje actual. Revisa el resumen más reciente.','stale_confirmation');
    if(confirm[1]!==session.draft.confirmation||!session.draft.expiresAt||Date.parse(session.draft.expiresAt)<=now){
      // Replaying an old button must not invalidate another still-current button.
      if(conversationPhase(session,now)==='review')return {...base,reason:'stale_confirmation',messages:summaryMessages(latest.from,session.draft)};
      return clarifyPending('stale_confirmation');
    }
    if(!hasDestination(session.draft)&&session.draft.destinationDeferred!==true)return prepareSummary(session.draft,'destination_required');
    if(!session.draft.name||!session.draft.origin||session.draft.awaitingLocation||session.draft.pendingLocation)return reply('Faltan datos del viaje. Revisemos el punto de recogida y el nombre.','incomplete_draft');
    const review=await tariffReview(session.draft);if(review)return review;
    let candidates:Candidate[]=[];
    try{candidates=await services.candidates(session.draft.origin,channel,signal);}catch{return {...base,action:'confirm',confirmation:confirm[1],candidates:[],reason:'fleet_lookup_deferred'};}
    return {...base,action:'confirm',confirmation:confirm[1],candidates,reason:'button_confirmation'};
  }
  if(unsupportedRide(current))return human('special_ride','Ese servicio necesita revisión de la base. Les paso tu mensaje para que te confirmen si pueden atenderlo.');
  if(cancelsTaxi(current))return live(session.active)?{...base,action:'cancel',tripId:session.active?.id??null,reason:'explicit_cancellation'}:{...reply('No tienes un viaje activo para cancelar.','no_active_trip'),action:'draft',draft:emptyDraft()};
  if(messages.every(m=>m.type==='text')&&cancelDraftCommand(current))return live(session.active)?reply('Para cancelar tu viaje actual, escribe «Cancela mi taxi».','cancellation_question'):{...reply('Descarté el borrador. No se solicitó ningún taxi. Cuando quieras empezar de nuevo, aquí estoy. 🙂','draft_cancelled'),action:'draft',draft:emptyDraft()};
  if(cancellationQuestion(current))return reply(live(session.active)?'¿Quieres cancelar tu solicitud actual? Si es así, escribe «Cancela mi taxi».':'Todavía no tienes un taxi solicitado para cancelar.','cancellation_question');
  if(live(session.active)) {
    if(activeRideChange(current)||messages.some((m)=>m.location!==null))return human('active_trip_change','Tu viaje ya está solicitado. Paso el cambio a la base para que lo revisen antes de mover la unidad.');
    const choice=session.active?.dispatchChoice;
    if(choice&&Date.parse(choice.expiresAt)>now)return {...reply('🚕 Todavía no conseguimos una unidad. ¿Seguimos buscando o prefieres cancelar? 😊','dispatch_choice_pending'),replyClass:'question',messages:[{to:latest.from,text:'🚕 Todavía no conseguimos una unidad. ¿Seguimos buscando o prefieres cancelar? 😊',buttons:[{id:'txw_'+choice.token,title:'Seguir esperando'},{id:'txk_'+choice.token,title:'Cancelar solicitud'}]}]};
    return reply(session.active?.state==='en_camino'?`🚕 La unidad ${session.active.taxiName??'asignada'} ya aceptó tu viaje. Aún no tengo una llegada confirmada.`:session.active?.dispatchAttention?'🚕 Tu solicitud sigue registrada y necesita revisión de la base. Todavía no hay una unidad confirmada.':'🚕 Tu solicitud sigue en búsqueda. Todavía no hay una unidad confirmada.','active_status');
  }
  if(messages.every((m)=>m.type==='unsupported'))return clarifyPending('unsupported_media');
  const requestedLocation=messages.every(m=>m.type==='text')&&!session.draft.pendingLocation?draftLocationRequest(current):null;
  if(requestedLocation)return requestedLocation==='destination'?askDestination({...session.draft,destination:null,destinationText:null,destinationArea:null}):requestLocation(session.draft,'origin','edit_location_requested','¿Me compartes tu nueva ubicación con el botón para pasar por ti?');
  if(messages.length===1&&messages[0].type==='text'&&defersDestination(current))return prepareSummary({...session.draft,destination:null,destinationText:null,destinationArea:null,destinationDeferred:true,destinationPrompt:null,awaitingLocation:session.draft.awaitingLocation==='origin'?'origin':null,expiresAt:null},'destination_deferred');
  if(messages.every((m)=>m.type==='text'&&(confirmsTaxi(m.text)||courtesyOnly(m.text)))&&messages.some((m)=>confirmsTaxi(m.text))) {
    const d=session.draft;
    if(!d.name||!d.origin||d.pendingLocation||d.awaitingLocation)return clarifyPending('no_current_confirmation');
    return prepareSummary(d,'button_confirmation_required');
  }
  if(messages.every((m)=>m.type==='text'&&courtesyOnly(m.text)))return reply('¡Con gusto! 😊 Aquí sigo por si necesitas algo más.','courtesy');
  const finalDecline=declinesTaxi(latest.text)&&messages.every((m)=>m.type==='text'&&(confirmsTaxi(m.text)||courtesyOnly(m.text)||declinesTaxi(m.text)));
  if(finalDecline)return {...reply('Está bien, todavía no solicito el taxi. Cuando estés listo, revisamos el viaje de nuevo. 🙂','summary_declined'),action:'draft',draft:{...session.draft,confirmation:null,expiresAt:null,destinationPrompt:null}};
  let d:Draft={...session.draft};let changed=false;
  let resolvedPendingRole:'origin'|'destination'|null=null;
  const selectedRole=locationRole(current),roleOnly=locationRoleOnly(current);
  if(selectedRole&&d.pendingLocation&&messages.every((m)=>m.type==='text')){
    if(Date.parse(d.pendingLocation.expiresAt)<=now)return requestLocation(d,selectedRole,'pending_location_expired','Ese pin ya venció. Compártelo otra vez para usarlo en este viaje.');
    d[selectedRole]=d.pendingLocation.place;if(selectedRole==='origin')d.pickupMessageId=d.pendingLocation.messageId??null;d[selectedRole==='origin'?'originArea':'destinationArea']=null;d.pendingLocation=null;d.awaitingLocation=null;
    resolvedPendingRole=selectedRole;
    if(selectedRole==='destination'){d.destinationText=null;d.destinationDeferred=false;}
    if(roleOnly)return prepareSummary(d,'summary');
    changed=true;
  }
  const native=nativeLocationSegments(messages);
  const turn:TaxiTurnContext={nativeLocations:native.map(item=>({role:locationRole(item.context),beforeText:messages.slice(0,messages.indexOf(item.message)).filter(m=>Boolean(m.text)).length}))};
  let interpretation:Interpretation;
  let interpretationIssue:'interpretation_failed'|'ambiguous_intent'|'unclear_name'|'pickup_reference_too_long'|null=null;
  const interpretationSession=changed?{...session,draft:d}:session,pendingLocality=pendingLocalityContext(interpretationSession);
  try{
    interpretation=current&&!(selectedRole&&roleOnly&&native.length)?await services.interpret(current,interpretationSession,channel,signal,undefined,turn):{intent:'provide',fields:{}};
  }
  catch{interpretationIssue='interpretation_failed';interpretation={intent:'ambiguous',fields:{}};}
  if(interpretation.intent==='human')return human('model_handoff');
  if(interpretationIssue||interpretation.intent==='ambiguous'||interpretation.intent==='cancel'||interpretation.intent==='confirm'){
    interpretationIssue??='ambiguous_intent';
    if(!native.length)return clarifyPending(interpretationIssue,d);
    interpretation={intent:'provide',fields:{}};
  }
  if(interpretation.intent==='status'){
    if(!native.length&&!changed)return reply('Todavía no has solicitado el taxi. Primero hay que revisar el recorrido y confirmar el resumen.','no_active_status');
    interpretationIssue='ambiguous_intent';interpretation={intent:'provide',fields:{}};
  }
  if(interpretation.fields.name){
    const chosen=normalize(interpretation.fields.name.value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const explicit=new RegExp('\\b(?:me llamo|soy|a nombre de|(?:mi |el )?nombre (?:es|sera)|(?:el |la )?pasajer[oa] (?:es|sera))\\s+'+chosen+'(?:\\b|$)').test(normalize(interpretation.fields.name.evidence));
    const askedName=session.history.at(-1)?.role==='assistant'&&/\b(?:a nombre|tu nombre|nombre del pasajero)\b/i.test(session.history.at(-1)?.content??'');
    const contextualAnswer=(conversationPhase(session,now)==='name'||askedName)&&!d.name;
    // A complete personal name in its own bubble can accompany the first pickup pin.
    // The model still proposes the role; a place, instruction or quoted phrase is not a name.
    const bare=interpretation.fields.name.value.trim(),bareKey=normalize(bare),evidenceKey=normalize(interpretation.fields.name.evidence).replace(/[.!]+$/,'');
    const nativePickupName=!d.name&&!d.origin&&native.length===1&&!locationRoleConflict(native[0].context)&&locationRole(native[0].context)!=='destination'&&
      /^[\p{L}][\p{L}'’\-]*(?:\s+[\p{L}][\p{L}'’\-]*){1,5}$/u.test(bare)&&
      !/^(?:a|al|en|el|la|los|las|por|para|frente|junto|calle|avenida|av|barrio|colonia|fracc|fraccionamiento|fabrica|plaza|parque|hospital|terminal|san|santa|necesito|quiero|solicito|buenas|buenos|hola|gracias|me|es|soy|estoy|voy|vamos)\b/.test(bareKey)&&
      evidenceKey===bareKey&&messages.some(m=>m.type==='text'&&normalize(m.text).replace(/[.!]+$/,'')===bareKey);
    if(!explicit&&!contextualAnswer&&!nativePickupName){
      if(!native.length)return clarifyPending('unclear_name',d);
      const fields={...interpretation.fields};delete fields.name;
      interpretationIssue='unclear_name';interpretation={intent:'provide',fields};
    }
  }
  // A model-proposed continuation must target the exact unresolved place in this durable session.
  // New destinations default to replacement; the backend never appends a name or an unrelated reply.
  const textPositions:Partial<Record<'origin'|'destination',number>>={};
  for(const field of ['origin','destination'] as const){const proposed=interpretation.fields[field];if(proposed)textPositions[field]=evidencedMessageIndex(messages,proposed);}
  for(const field of ['origin','destination'] as const){
    const proposed=interpretation.fields[field];if(proposed?.refines===undefined)continue;
    if(!pendingLocality||pendingLocality.field!==field||pendingLocality.query!==proposed.refines)return requestLocation(session.draft,pendingLocality?.field??field,'ambiguous_intent','No pude relacionar esa referencia con el lugar pendiente. ¿Me confirmas el lugar y una referencia?');
    const query=pendingLocality.query,answer=proposed.value,combined=normalize(query)===normalize(answer)?query:`${query}, ${answer}`;
    if(combined.length>400)return{...reply('Ese detalle es demasiado largo. Conservé el destino anterior sin cambiar el recorrido.','ambiguous_intent'),action:'draft',draft:{...session.draft,confirmation:null,expiresAt:null}};
    interpretation={...interpretation,fields:{...interpretation.fields,[field]:{value:combined,evidence:proposed.evidence}}};
  }
  const repeatedPickup=interpretation.fields.origin?restatesKnownPickup(d,interpretation.fields.origin.value,interpretation.fields.origin.evidence):false;
  let pickupNote:string|null=null;
  if(interpretation.fields.pickupReference){
    const note=interpretation.fields.pickupReference.value,prior=interpretation.fields.origin&&!repeatedPickup?interpretation.fields.origin.value:d.pickupText;
    const combined=prior?containsPickupDescription(prior,note)?prior:prior+'. '+note:note;
    if(combined.length>400){
      if(!native.length)return clarifyPending('pickup_reference_too_long',d);
      interpretationIssue='pickup_reference_too_long';interpretation={intent:'provide',fields:{}};
    }else pickupNote=combined;
  }
  if(interpretation.fields.name){
    d.name=interpretation.fields.name.value;changed=true;
  }
  for(const field of ['origin','destination'] as const) {
    const requested=interpretation.fields[field];if(!requested)continue;
    if((native.length||resolvedPendingRole===field)&&refersToSharedLocation(requested.value))continue;
    if(field==='origin'&&repeatedPickup){changed=true;continue;}
    changed=true;d.confirmation=null;d.expiresAt=null;d.quoteCents=null;d.quoteH3=null;d.destinationPrompt=null;
    const areaKey=field==='origin'?'originArea':'destinationArea';
    if(field==='origin'){
      d.pickupText=requested.value;d.origin=null;d.pickupMessageId=null;d.originArea=null;d.awaitingLocation='origin';continue;
    }
    d.destinationText=requested.value;d.destinationDeferred=false;d.destinationPrompt=null;
    let resolved:LocationResult;try{resolved=await services.resolve(requested.value,channel,signal,d[areaKey]);}catch{resolved={kind:'unavailable'};}
    d[areaKey]=null;
    if(resolved.kind==='resolved'){
      if(!within(resolved.place,channel))return human('outside_service_area','El destino queda fuera de la cobertura actual. La base debe revisar ese servicio.');
      d[field]=resolved.place;
    }else{
      // The passenger already gave a destination. Catalog categories and failed
      // geocoding cannot turn optional destination GPS into a collection loop.
      // Keep the literal text, select no ambiguous area, and quote the pickup
      // when the server cannot verify a unique destination tariff.
      d[field]=null;
      if(resolved.kind==='ambiguous'&&resolved.neighborhoods?.length===1)d[areaKey]=resolved.neighborhoods[0];
    }
    if(d.awaitingLocation===field)d.awaitingLocation=null;
  }
  if(pickupNote!==null){d.pickupText=pickupNote;changed=true;}
  if(d.awaitingLocation==='choice'&&!d.pendingLocation&&(interpretation.fields.origin||interpretation.fields.destination))d.awaitingLocation=!d.origin?'origin':!hasDestination(d)?'destination':null;
  if(native.length){
    const preview:Draft={...d},planned:{target:'origin'|'destination';place:Place;messageId:string}[]=[];
    let unclear:{place:Place;messageId:string}|null=null;
    for(const item of native){
      const point=item.message.location;if(!point)continue;
      const place:Place={text:`Ubicación compartida (${point.lat.toFixed(5)}, ${point.lng.toFixed(5)})`,lat:point.lat,lng:point.lng,placeId:null,source:'gps'};
      const explicit=locationRole(item.context),conflict=locationRoleConflict(item.context);
      const target=conflict?null:explicit??inferLocationRole(preview,(interpretationIssue===null||interpretationIssue==='unclear_name')&&planned.length===0&&(!preview.origin||preview.origin.source!=='gps'));
      if(target&&interpretation.fields[target]&&(textPositions[target]??-1)>messages.indexOf(item.message)&&!(target==='origin'&&repeatedPickup)&&!refersToSharedLocation(interpretation.fields[target]?.value??''))continue;
      if(!within(place,channel))return human('outside_service_area','La ubicación queda fuera de la zona configurada. La base debe confirmar ese servicio.');
      if(!target){unclear={place,messageId:item.message.id};break;}
      planned.push({target,place,messageId:item.message.id});
      preview[target]=place;
      preview[target==='origin'?'originArea':'destinationArea']=null;
      if(target==='origin')preview.pickupMessageId=item.message.id;
      else{preview.destinationText=null;preview.destinationDeferred=false;}
      preview.destinationPrompt=null;preview.awaitingLocation=null;preview.pendingLocation=null;
    }
    if(unclear){
      if(native.length===1)return {...reply('¿Este punto es donde pasamos por ti o es a dónde vas? 🚕','location_target_unclear'),action:'draft',draft:{...d,confirmation:null,expiresAt:null,quoteCents:null,quoteH3:null,destinationPrompt:null,awaitingLocation:'choice',pendingLocation:{place:unclear.place,expiresAt:new Date(now+10*60000).toISOString(),messageId:unclear.messageId}}};
      return {...reply('Me llegaron varias ubicaciones y quiero asociarlas bien. Vuelve a compartirlas indicando cuál es el punto donde pasamos por ti y cuál es tu destino. 🚕','multiple_locations'),action:'draft',draft:{...d,confirmation:null,expiresAt:null,quoteCents:null,quoteH3:null,destinationPrompt:null}};
    }
    for(const item of planned){
      d[item.target]=item.place;d[item.target==='origin'?'originArea':'destinationArea']=null;
      if(item.target==='origin')d.pickupMessageId=item.messageId;
      else{d.destinationText=null;d.destinationDeferred=false;}
      d.destinationPrompt=null;d.awaitingLocation=null;d.pendingLocation=null;changed=true;
    }
  }
  if(changed){d.confirmation=null;d.expiresAt=null;d.quoteCents=null;d.quoteH3=null;}
  if(interpretationIssue)return clarifyPending(interpretationIssue,d);
  if(pendingLocality&&!interpretation.fields[pendingLocality.field]&&d.awaitingLocation===pendingLocality.field){
    if(pendingLocality.field==='destination'&&hasDestination(d))return prepareSummary({...d,awaitingLocation:null},interpretation.intent==='question'?'service_question':'summary');
    return requestLocation(d,pendingLocality.field,interpretation.intent==='question'?'service_question':'locality_still_pending',`Sigo con ${pendingLocality.query} como ${pendingLocality.field==='destination'?'destino':'referencia de dónde pasamos por ti'}. ¿Me das una calle o referencia para ubicar ese punto? ${pendingLocality.field==='destination'?'Su pin es opcional.':'Comparte también el pin donde pasamos por ti.'}`);
  }
  if(interpretation.intent==='question'){
    if(changed)return prepareSummary(d,'service_question');
    if(!d.origin||d.origin.source!=='gps')return requestLocation(d,'origin','service_question');
    if(!hasDestination(d)&&d.destinationDeferred!==true&&(!d.destinationPrompt||!d.expiresAt||Date.parse(d.expiresAt)<=now))return askDestination(d,'service_question');
    if(!['review','destination'].includes(conversationPhase({...session,draft:d},now)))return clarifyPending('service_question',d);
    const buttons=d.destinationPrompt?[{id:'txd_'+d.destinationPrompt,title:'Se lo digo al chofer'}]:undefined;
    return {...reply('No tengo esa información confirmada. La base puede ayudarte a consultarla; tus datos del viaje siguen guardados.','service_question'),messages:[{to:latest.from,text:'No tengo esa información confirmada. La base puede ayudarte a consultarla; tus datos del viaje siguen guardados.',...(buttons?{buttons}:{})}]};
  }
  if(interpretation.intent==='request')return prepareSummary(d,'taxi_requested');
  if(interpretation.intent==='smalltalk'&&!changed&&!d.origin&&!d.pendingLocation&&d.awaitingLocation!=='choice')return requestLocation(d,'origin','greeting',`¡Hola! 😊 Somos ${channel.name}. ¿Me compartes tu ubicación con el botón para que pasemos por ti? Puedes agregar una referencia para encontrarte más fácil.`);
  if(!changed&&interpretation.intent==='smalltalk')return clarifyPending('smalltalk',d);
  if(!changed&&interpretation.intent!=='quote'){
    if(!d.pendingLocation&&d.awaitingLocation!=='choice'&&(!d.origin||d.origin.source!=='gps'))return requestLocation(d,'origin','no_new_fields');
    return clarifyPending('no_new_fields',d);
  }
  return prepareSummary(d,interpretation.intent==='quote'?'quote_only':'summary');
}
