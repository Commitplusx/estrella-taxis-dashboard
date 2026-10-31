import {assertTaxiTransition,conversationPhase,hasDestination}from'./stateMachine.ts';
import type{ModelMetadata}from'./trace.ts';
import { emptyDraft, type Candidate, type Draft, type Interpretation, type Place, type TaxiChannel, type TaxiDecision, type TaxiInbound, type TaxiSession } from './contracts.ts';
import { activeRideChange, cancellationQuestion, cancelsTaxi, confirmsTaxi, courtesyOnly, declinesTaxi, locationRole, locationRoleConflict, refersToSharedLocation, needsHuman, normalize, unsupportedRide,resetCommand,cancelDraftCommand,draftLocationRequest,defersDestination } from './policy.ts';
import { getDistanceFromLatLonInKm } from '../../algorithms/headingMatcher.ts';
import { taxiH3Scope } from './h3.ts';
import type { NeighborhoodArea } from './neighborhoodContracts.ts';
import { localityDisplayName } from './neighborhoods.ts';
import type {TaxiQuestion,TaxiReplyContext}from'./conversationReply.ts';
export type LocationResult={kind:'resolved';place:Place}|{kind:'ambiguous';labels:string[];neighborhoods?:NeighborhoodArea[]}|{kind:'reference_conflict';label:string}|{kind:'unavailable'};
export interface TaxiServices {
  interpret:(text:string,session:TaxiSession,channel:TaxiChannel,signal?:AbortSignal,observe?:(metadata:ModelMetadata)=>void)=>Promise<Interpretation>;
  resolve:(text:string,channel:TaxiChannel,signal?:AbortSignal,area?:NeighborhoodArea|null,observe?:(metadata:ModelMetadata)=>void)=>Promise<LocationResult>;
  quote:(origin:Place,destination:Place,channel:TaxiChannel,signal?:AbortSignal,destinationArea?:NeighborhoodArea|null)=>Promise<number|null>;
  candidates:(origin:Place,channel:TaxiChannel,signal?:AbortSignal)=>Promise<Candidate[]>;
  question?:(kind:TaxiQuestion,current:string,channel:TaxiChannel,signal?:AbortSignal,context?:TaxiReplyContext)=>Promise<string|null>;
}
export function taxiSummary(d:Draft):string {
  const name=d.name?.trim();
  const greeting=name?`🚕 ¡Listo, ${name}! Ya tenemos los datos de tu viaje.`:'🚕 ¡Listo! Ya tenemos los datos de tu viaje.';
  const mapsLink=(place:Place)=>`https://maps.google.com/?q=${place.lat.toFixed(5)},${place.lng.toFixed(5)}`;
  const pickup=d.origin?`📍 *Pasamos por ti aquí:*\n${mapsLink(d.origin)}${d.pickupText?`\n📝 *Referencia para encontrarte:* ${d.pickupText}`:''}`:'📍 Aún falta confirmar dónde pasamos por ti.';
  const destination=d.destination
    ?`🏁 *Y te llevamos aquí:*\n${d.destination.source==='gps'?'':`${d.destination.text}\n`}${mapsLink(d.destination)}`
    :d.destinationText||d.destinationArea
      ?`🏁 *Destino:* ${d.destinationText??d.destinationArea?.label}`
      :'🏁 El destino puedes indicárselo al conductor.';
  const price=d.quoteCents===null
    ?'💵 La base necesita confirmar la tarifa antes de solicitar el taxi.'
    :d.quoteBasis==='pickup'
      ?`💵 *Tarifa estimada desde tu ubicación:* $${(d.quoteCents/100).toFixed(2)} MXN. El importe final se confirma cuando indiques el destino.`
      :`💵 *Tarifa estimada del recorrido:* $${(d.quoteCents/100).toFixed(2)} MXN.`;
  const review=name?`¿Todo está correcto, ${name}? 😊`:'¿Todo está correcto? 😊';
  return `${greeting}\n\n${pickup}\n\n${destination}\n\n${price}\n\n${review}\nSi es así, toca *Confirmar viaje* aquí abajo y enseguida buscamos un taxi para ti. 🚕`;
}
function live(t:TaxiSession['active']):boolean{return t?.state==='buscando_conductor'||t?.state==='en_camino';}
function within(p:Place,c:TaxiChannel):boolean{return getDistanceFromLatLonInKm(p.lat,p.lng,c.centerLat,c.centerLng)<=c.radiusKm;}
function nativeLocationSegments(messages:TaxiInbound[]):{message:TaxiInbound;context:string}[]{
  const indexes=messages.flatMap((message,index)=>message.location?[index]:[]);
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
  assertTaxiTransition(session,messages,decision,now);
  const outbound=decision.messages.length===1?decision.messages[0]:null,hasConfirmationSummary=decision.messages.some(message=>message.buttons?.some(button=>button.id.startsWith('txc_')));
  const naturalInput=messages.every(message=>message.type==='text'||message.type==='location');
  if(services.question&&outbound&&['draft','reply'].includes(decision.action)&&naturalInput&&(!hasConfirmationSummary||decision.reason==='service_question')){
    const kind:TaxiQuestion=decision.reason==='service_question'?'service_question':decision.reason==='missing_name'?'passenger_name':decision.reason==='missing_destination'?'destination_optional':outbound.locationRequest==='origin'?'pickup_gps':decision.reason==='active_status'?'active_status':['smalltalk','courtesy'].includes(decision.reason)?'smalltalk':'conversation';
    const d=decision.draft,recent:TaxiSession['history']=[];let size=0;for(const item of session.history.slice(-6).reverse()){if(size+item.content.length>2400)break;recent.unshift(item);size+=item.content.length;}
    const phase=conversationPhase({...session,draft:d},now);
    const context:TaxiReplyContext={baseName:channel.name,city:channel.city,hasPickupGps:Boolean(d.origin?.source==='gps'&&d.pickupMessageId),hasName:Boolean(d.name),hasDestination:hasDestination(d),destinationDeferred:d.destinationDeferred===true,phase,activeState:session.active?.state??null,recent,backendReply:hasConfirmationSummary?'El servidor preparó debajo el resumen vigente con tarifa verificada y el botón actual. No cambies ni repitas esos datos.':outbound.text,nextStep:hasConfirmationSummary?'none':replyNextStep(decision,phase)};
    const current=messages.map(message=>message.type==='location'?'Compartiste un punto de ubicación por WhatsApp.':message.text).filter(Boolean).join('\n');
    let question:string|null=null;try{question=await services.question(kind,current,channel,signal,context);}catch{/* The server's validated decision and response remain authoritative if composition fails. */}
    if(question){if(hasConfirmationSummary)decision.messages.unshift({to:outbound.to,text:question});else decision.messages[0]={...outbound,text:question};}
  }
  assertTaxiTransition(session,messages,decision,now);
  return decision;
}
async function decideTaxi(messages:TaxiInbound[],session:TaxiSession,channel:TaxiChannel,services:TaxiServices,now:number,signal?:AbortSignal):Promise<TaxiDecision> {
  if(messages.length<1||messages.length>20)throw new Error('Invalid taxi turn size.');
  const latest=messages[messages.length-1],current=messages.map((m)=>m.text).filter(Boolean).join('\n');
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
  const clarifyPending=(reason:string,draft:Draft=session.draft):TaxiDecision=>{
    const d:Draft={...draft,confirmation:null,expiresAt:null,destinationPrompt:null};
    const phase=conversationPhase({...session,draft:d},now);
    if(reason==='unclear_name'||reason==='pickup_reference_too_long')return {...reply(reason==='unclear_name'?'¿Ese es el nombre del pasajero? ¿A nombre de quién queda el viaje?':'La referencia quedó muy larga. ¿Me la dices más breve para que el conductor pueda identificarte?',reason),action:'draft',draft:d};
    if(phase==='origin'||phase==='destination'){
      const area=phase==='origin'?d.originArea:d.destinationArea;
      const body=area
        ?phase==='origin'?`Ubico ${localityDisplayName(area)}. Comparte el pin GPS de recogida con el botón; conservo la dirección escrita como referencia.`:`Ubico ${localityDisplayName(area)}. ¿Qué calle o referencia tiene el destino? Su pin es opcional.`
        :phase==='origin'?'Necesito el pin GPS donde te recogemos. Usa el botón; conservo la dirección escrita como referencia.':'El destino es opcional. Si quieres precisarlo, dime a qué colonia o dirección vas; su pin es opcional.';
      return requestLocation(d,phase,reason,body);
    }
    const body=phase==='name'?'¿A nombre de quién queda el viaje? 😊':phase==='location_role'?'¿El pin es donde te recogemos o a dónde vas? 🚕':'¿Qué dato del recorrido quieres corregir: la recogida, el destino o el nombre? 😊';
    return {...reply(body,reason),action:'draft',draft:d};
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
    return {...base,action:'draft',draft:summary,reason,messages:[{to:latest.from,text:taxiSummary(summary),buttons:[{id:'txc_'+summary.confirmation,title:'Confirmar viaje'}]}]};
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
    if(id.startsWith('txd_')){
      if(live(session.active)||!session.draft.destinationPrompt||id!=='txd_'+session.draft.destinationPrompt||session.draft.awaitingLocation!=='destination'||!session.draft.expiresAt||Date.parse(session.draft.expiresAt)<=now)return reply('Esa opción ya no corresponde al viaje actual. Revisemos a dónde quieres ir.','stale_destination_choice');
      return prepareSummary({...session.draft,destinationDeferred:true,destinationPrompt:null,awaitingLocation:null,expiresAt:null},'destination_deferred');
    }
    const driver=/^tx([arf])_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(id);
    if(driver)return {...base,action:driver[1]==='a'?'driver_accept':driver[1]==='r'?'driver_reject':'driver_finish',offerId:driver[2],reason:'driver_button'};
    const confirm=/^txc_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(id);
    if(!confirm||confirm[1]!==session.draft.confirmation||!session.draft.expiresAt||Date.parse(session.draft.expiresAt)<=now)return reply('Ese botón ya no corresponde al viaje actual. Revisa el resumen más reciente.','stale_confirmation');
    if(live(session.active))return reply('Ya tienes una solicitud activa. La base sigue pendiente de ese viaje.','active_trip');
    if(!hasDestination(session.draft)&&session.draft.destinationDeferred!==true)return prepareSummary(session.draft,'destination_required');
    if(!session.draft.name||!session.draft.origin||session.draft.awaitingLocation||session.draft.pendingLocation)return reply('Faltan datos del viaje. Revisemos el punto de recogida y el nombre.','incomplete_draft');
    const review=await tariffReview(session.draft);if(review)return review;
    let candidates:Candidate[]=[];
    try{candidates=await services.candidates(session.draft.origin,channel,signal);}catch{return human('fleet_unavailable','No pude consultar las unidades. Voy a pasar el viaje a la base para que lo revisen.');}
    return {...base,action:'confirm',confirmation:confirm[1],candidates,reason:'button_confirmation'};
  }
  if(messages.some((m)=>m.type==='unsupported'))return reply('Por ahora mándame la dirección por texto o comparte tu ubicación desde WhatsApp.','unsupported_media');
  if(unsupportedRide(current))return human('special_ride','Ese servicio necesita revisión de la base. Les paso tu mensaje para que te confirmen si pueden atenderlo.');
  if(cancelsTaxi(current))return live(session.active)?{...base,action:'cancel',tripId:session.active?.id??null,reason:'explicit_cancellation'}:{...reply('No tienes un viaje activo para cancelar.','no_active_trip'),action:'draft',draft:emptyDraft()};
  if(messages.every(m=>m.type==='text')&&cancelDraftCommand(current))return live(session.active)?reply('Para cancelar tu viaje actual, escribe «Cancela mi taxi».','cancellation_question'):{...reply('Descarté el borrador. No se solicitó ningún taxi. Cuando quieras empezar de nuevo, aquí estoy. 🙂','draft_cancelled'),action:'draft',draft:emptyDraft()};
  if(cancellationQuestion(current))return reply(live(session.active)?'¿Quieres cancelar tu solicitud actual? Si es así, escribe «Cancela mi taxi».':'Todavía no tienes un taxi solicitado para cancelar.','cancellation_question');
  if(live(session.active)) {
    if(activeRideChange(current)||messages.some((m)=>m.location!==null))return human('active_trip_change','Tu viaje ya está solicitado. Paso el cambio a la base para que lo revisen antes de mover la unidad.');
    return reply(session.active?.state==='en_camino'?`🚕 La unidad ${session.active.taxiName??'asignada'} ya aceptó tu viaje. Aún no tengo una llegada confirmada.`:'🚕 Tu solicitud sigue en búsqueda. Todavía no hay una unidad confirmada.','active_status');
  }
  const requestedLocation=messages.every(m=>m.type==='text')&&!session.draft.pendingLocation?draftLocationRequest(current):null;
  if(requestedLocation)return requestedLocation==='destination'?askDestination({...session.draft,destination:null,destinationText:null,destinationArea:null}):requestLocation(session.draft,'origin','edit_location_requested','¿Me compartes tu nueva ubicación con el botón para pasar por ti?');
  if(messages.every(m=>m.type==='text')&&session.draft.awaitingLocation==='destination'&&session.draft.destinationPrompt&&session.draft.expiresAt&&Date.parse(session.draft.expiresAt)>now&&defersDestination(current))return prepareSummary({...session.draft,destinationDeferred:true,destinationPrompt:null,awaitingLocation:null,expiresAt:null},'destination_deferred');
  if(messages.every((m)=>m.type==='text'&&(confirmsTaxi(m.text)||courtesyOnly(m.text)))&&messages.some((m)=>confirmsTaxi(m.text))) {
    const d=session.draft;
    if(!d.name||!d.origin||d.pendingLocation||d.awaitingLocation)return reply('Todavía faltan datos por aclarar. Necesito el pin de recogida y el nombre; después toca «Confirmar viaje».','no_current_confirmation');
    return prepareSummary(d,'button_confirmation_required');
  }
  if(messages.every((m)=>m.type==='text'&&courtesyOnly(m.text)))return reply('¡Con gusto! 😊 Aquí sigo por si necesitas algo más.','courtesy');
  const finalDecline=declinesTaxi(latest.text)&&messages.every((m)=>m.type==='text'&&(confirmsTaxi(m.text)||courtesyOnly(m.text)||declinesTaxi(m.text)));
  if(finalDecline)return {...reply('Está bien, todavía no solicito el taxi. Cuando estés listo, revisamos el viaje de nuevo. 🙂','summary_declined'),action:'draft',draft:{...session.draft,confirmation:null,expiresAt:null,destinationPrompt:null}};
  let d:Draft={...session.draft};let changed=false;
  const selectedRole=locationRole(current);
  if(selectedRole&&d.pendingLocation&&messages.every((m)=>m.type==='text')){
    if(Date.parse(d.pendingLocation.expiresAt)<=now)return requestLocation(d,selectedRole,'pending_location_expired','Ese pin ya venció. Compártelo otra vez para usarlo en este viaje.');
    d[selectedRole]=d.pendingLocation.place;if(selectedRole==='origin')d.pickupMessageId=d.pendingLocation.messageId??null;d[selectedRole==='origin'?'originArea':'destinationArea']=null;d.pendingLocation=null;d.awaitingLocation=null;
    return prepareSummary(d,'summary');
  }
  const native=nativeLocationSegments(messages);
  let interpretation:Interpretation;
  let interpretationIssue:'interpretation_failed'|'ambiguous_intent'|'unclear_name'|'pickup_reference_too_long'|null=null;
  try{interpretation=current&&!(selectedRole&&messages.some((m)=>m.location!==null))?await services.interpret(current,session,channel,signal):{intent:'provide',fields:{}};}
  catch{interpretationIssue='interpretation_failed';interpretation={intent:'ambiguous',fields:{}};}
  if(interpretation.intent==='human')return human('model_handoff');
  if(interpretationIssue||interpretation.intent==='ambiguous'||interpretation.intent==='cancel'||interpretation.intent==='confirm'){
    interpretationIssue??='ambiguous_intent';
    if(!native.length)return clarifyPending(interpretationIssue);
    interpretation={intent:'provide',fields:{}};
  }
  if(interpretation.intent==='status'){
    if(!native.length)return reply('Todavía no has solicitado el taxi. Primero hay que revisar el recorrido y confirmar el resumen.','no_active_status');
    interpretationIssue='ambiguous_intent';interpretation={intent:'provide',fields:{}};
  }
  if(interpretation.fields.name){
    const chosen=normalize(interpretation.fields.name.value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const explicit=new RegExp('\\b(?:me llamo|soy|a nombre de|mi nombre es)\\s+'+chosen+'(?:\\b|$)').test(normalize(interpretation.fields.name.evidence));
    const contextualAnswer=conversationPhase(session,now)==='name'&&!d.name;
    if(!explicit&&!contextualAnswer){
      if(!native.length)return clarifyPending('unclear_name',d);
      interpretationIssue='unclear_name';interpretation={intent:'provide',fields:{}};
    }
  }
  if(interpretation.fields.pickupReference){
    const note=interpretation.fields.pickupReference.value,combined=d.pickupText&&!d.pickupText.includes(note)?d.pickupText+'. '+note:note;
    if(combined.length>400){
      if(!native.length)return clarifyPending('pickup_reference_too_long',d);
      interpretationIssue='pickup_reference_too_long';interpretation={intent:'provide',fields:{}};
    }else{d.pickupText=combined;changed=true;}
  }
  if(interpretation.fields.name){
    d.name=interpretation.fields.name.value;changed=true;
  }
  const unresolved:('origin'|'destination')[]=[];
  const recognized:Partial<Record<'origin'|'destination',NeighborhoodArea[]>>={};
  const referenceConflicts:Partial<Record<'origin'|'destination',string>>={};
  for(const field of ['origin','destination'] as const) {
    const requested=interpretation.fields[field];if(!requested)continue;
    if(native.length&&refersToSharedLocation(requested.value))continue;
    changed=true;d.confirmation=null;d.expiresAt=null;d.quoteCents=null;d.quoteH3=null;d.destinationPrompt=null;
    const areaKey=field==='origin'?'originArea':'destinationArea';
    if(field==='origin'){
      d.pickupText=requested.value;d.origin=null;d.pickupMessageId=null;d.originArea=null;d.awaitingLocation='origin';continue;
    }
    d.destinationText=requested.value;d.destinationDeferred=false;d.destinationPrompt=null;
    let resolved:LocationResult;try{resolved=await services.resolve(requested.value,channel,signal,d[areaKey]);}catch{resolved={kind:'unavailable'};}
    d[areaKey]=null;
    if(resolved.kind==='resolved'&&within(resolved.place,channel)){d[field]=resolved.place;if(d.awaitingLocation===field)d.awaitingLocation=null;}
    else {d[field]=null;if(resolved.kind==='reference_conflict')referenceConflicts[field]=resolved.label;if(resolved.kind==='ambiguous'&&resolved.neighborhoods?.length){recognized[field]=resolved.neighborhoods;if(resolved.neighborhoods.length===1)d[areaKey]=resolved.neighborhoods[0];else unresolved.push(field);}if(d.awaitingLocation===field)d.awaitingLocation=null;}
  }
  if(d.awaitingLocation==='choice'&&!d.pendingLocation&&!unresolved.length&&(interpretation.fields.origin||interpretation.fields.destination))d.awaitingLocation=!d.origin?'origin':!d.destination?'destination':null;
  if(native.length){
    const preview:Draft={...d},planned:{target:'origin'|'destination';place:Place;messageId:string}[]=[];
    let unclear:{place:Place;messageId:string}|null=null;
    for(const item of native){
      const point=item.message.location;if(!point)continue;
      const place:Place={text:`Ubicación compartida (${point.lat.toFixed(5)}, ${point.lng.toFixed(5)})`,lat:point.lat,lng:point.lng,placeId:null,source:'gps'};
      if(!within(place,channel))return human('outside_service_area','La ubicación queda fuera de la zona configurada. La base debe confirmar ese servicio.');
      const explicit=locationRole(item.context),conflict=locationRoleConflict(item.context);
      const target=conflict?null:explicit??inferLocationRole(preview,interpretationIssue===null&&planned.length===0&&(!preview.origin||preview.origin.source!=='gps'));
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
      const resolvedIndex=unresolved.indexOf(item.target);if(resolvedIndex>=0)unresolved.splice(resolvedIndex,1);
    }
  }
  if(changed){d.confirmation=null;d.expiresAt=null;d.quoteCents=null;d.quoteH3=null;}
  if(interpretationIssue)return clarifyPending(interpretationIssue,d);
  if(unresolved.length===1){
    const field=unresolved[0],areas=recognized[field];
    const conflict=referenceConflicts[field];if(conflict)return requestLocation(d,field,'neighborhood_reference_conflict',`La ubicación que encontré no cae en ${conflict}. ¿Me confirmas la colonia o me das otra calle o referencia? Si prefieres, comparte el pin.`);
    if(areas?.length===1)return requestLocation(d,field,'neighborhood_reference_required',`Ubico ${localityDisplayName(areas[0])}. ¿En qué calle o con qué referencia ${field==='origin'?'te recogemos':'queda el destino'}? También puedes compartir el pin, si prefieres.`);
    if(areas?.length)return requestLocation(d,field,'neighborhood_ambiguous',`Encontré estas opciones: ${areas.map(localityDisplayName).join(', ')}. ¿Cuál es? Después dime la calle o una referencia.`);
    return requestLocation(d,field,'unresolved_location',`Para ubicar bien ${field==='origin'?'la recogida':'el destino'}, ¿me pasas calle, número y colonia? Si te queda más fácil, también puedes compartir el punto con el botón.`);
  }
  if(unresolved.length>1){const field=unresolved.find(value=>referenceConflicts[value]);if(field)return requestLocation(d,field,'neighborhood_reference_conflict',`La ubicación que encontré no cae en ${referenceConflicts[field]}. ¿Me confirmas la colonia o me das otra calle o referencia? Si prefieres, comparte el pin.`);}
  if(unresolved.length)return {...reply('No pude ubicar con certeza la recogida y el destino. ¿Cuál es la dirección donde te recogemos?','unresolved_location'),action:'draft',draft:{...d,awaitingLocation:'choice',pendingLocation:null}};
  if(interpretation.intent==='question'){
    if(changed)return prepareSummary(d,'service_question');
    if(!d.origin||d.origin.source!=='gps')return requestLocation(d,'origin','service_question');
    if(!hasDestination(d)&&d.destinationDeferred!==true&&!d.destinationPrompt)return askDestination(d,'service_question');
    const buttons=d.destinationPrompt?[{id:'txd_'+d.destinationPrompt,title:'Se lo digo al chofer'}]:undefined;
    return {...reply('No tengo esa información confirmada. La base puede ayudarte a consultarla; tus datos del viaje siguen guardados.','service_question'),messages:[{to:latest.from,text:'No tengo esa información confirmada. La base puede ayudarte a consultarla; tus datos del viaje siguen guardados.',...(buttons?{buttons}:{})}]};
  }
  if(interpretation.intent==='request')return prepareSummary(d,'taxi_requested');
  if(interpretation.intent==='smalltalk'&&!changed&&!d.origin&&!d.pendingLocation&&d.awaitingLocation!=='choice')return requestLocation(d,'origin','greeting',`¡Hola! 😊 Somos ${channel.name}. ¿Me compartes tu ubicación con el botón para que pasemos por ti? Puedes agregar una referencia para encontrarte más fácil.`);
  if(!changed&&interpretation.intent==='smalltalk')return reply('Aquí sigo 😊. Si quieres cambiar algo del viaje, dime qué dato revisamos.','smalltalk');
  if(!changed&&interpretation.intent!=='quote'){
    if(!d.pendingLocation&&d.awaitingLocation!=='choice'&&(!d.origin||d.origin.source!=='gps'))return requestLocation(d,'origin','no_new_fields');
    return reply('Dime dónde te recogemos o qué dato del viaje quieres cambiar.','no_new_fields');
  }
  return prepareSummary(d,interpretation.intent==='quote'?'quote_only':'summary');
}
