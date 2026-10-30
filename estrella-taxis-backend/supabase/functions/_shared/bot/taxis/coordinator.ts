import {assertTaxiTransition,conversationPhase}from'./stateMachine.ts';
import type{ModelMetadata}from'./trace.ts';
import { emptyDraft, type Candidate, type Draft, type Interpretation, type Place, type TaxiChannel, type TaxiDecision, type TaxiInbound, type TaxiSession } from './contracts.ts';
import { activeRideChange, cancellationQuestion, cancelsTaxi, confirmsTaxi, courtesyOnly, declinesTaxi, locationRole, needsHuman, normalize, unsupportedRide } from './policy.ts';
import { getDistanceFromLatLonInKm } from '../../algorithms/headingMatcher.ts';
import { taxiH3Scope } from './h3.ts';
import type { NeighborhoodArea } from './neighborhoodContracts.ts';
import { localityDisplayName } from './neighborhoods.ts';
import type {TaxiQuestion}from'./conversationReply.ts';
export type LocationResult={kind:'resolved';place:Place}|{kind:'ambiguous';labels:string[];neighborhoods?:NeighborhoodArea[]}|{kind:'reference_conflict';label:string}|{kind:'unavailable'};
export interface TaxiServices {
  interpret:(text:string,session:TaxiSession,channel:TaxiChannel,signal?:AbortSignal,observe?:(metadata:ModelMetadata)=>void)=>Promise<Interpretation>;
  resolve:(text:string,channel:TaxiChannel,signal?:AbortSignal,area?:NeighborhoodArea|null,observe?:(metadata:ModelMetadata)=>void)=>Promise<LocationResult>;
  quote:(origin:Place,destination:Place,channel:TaxiChannel,signal?:AbortSignal,destinationArea?:NeighborhoodArea|null)=>Promise<number|null>;
  candidates:(origin:Place,channel:TaxiChannel,signal?:AbortSignal)=>Promise<Candidate[]>;
  question?:(kind:TaxiQuestion,current:string,channel:TaxiChannel,signal?:AbortSignal)=>Promise<string|null>;
}
export function taxiSummary(d:Draft):string {
  const price=d.quoteCents===null?'No hay una tarifa verificada.':`${d.quoteBasis==='pickup'?'Tarifa estimada de la zona de recogida':'Tarifa estimada del recorrido'}: $${(d.quoteCents/100).toFixed(2)} MXN.${d.quoteBasis==='pickup'?' El destino lo confirmas con el conductor.':''}`;
  return `🚕 ¿Así queda tu viaje?\nA nombre de: ${d.name}\nTe recogemos en: ${d.origin?.text}${d.pickupText?'\nReferencia de recogida: '+d.pickupText:''}\nDestino: ${d.destination?.text??d.destinationText??d.destinationArea?.label??'Se lo indicas al conductor'}\n${price}\nToca «Confirmar viaje» para empezar a buscar una unidad. Escribir «sí» no solicita el taxi.`;
}
function live(t:TaxiSession['active']):boolean{return t?.state==='buscando_conductor'||t?.state==='en_camino';}
function within(p:Place,c:TaxiChannel):boolean{return getDistanceFromLatLonInKm(p.lat,p.lng,c.centerLat,c.centerLng)<=c.radiusKm;}
export async function coordinateTaxi(messages:TaxiInbound[],session:TaxiSession,channel:TaxiChannel,services:TaxiServices,now:number,signal?:AbortSignal):Promise<TaxiDecision> {
  const decision=await decideTaxi(messages,session,channel,services,now,signal);
  assertTaxiTransition(session,messages,decision,now);
  if(services.question&&decision.action==='draft'&&decision.messages.length===1&&!decision.messages[0].buttons?.length){
    const kind=decision.reason==='missing_name'?'passenger_name':decision.messages[0].locationRequest==='origin'?'pickup_gps':null;
    if(kind){const question=await services.question(kind,messages.map(m=>m.text).filter(Boolean).join('\n'),channel,signal);if(question)decision.messages[0]={...decision.messages[0],text:`${question} ${kind==='pickup_gps'?'🚕':'😊'}`};}
  }
  return decision;
}
async function decideTaxi(messages:TaxiInbound[],session:TaxiSession,channel:TaxiChannel,services:TaxiServices,now:number,signal?:AbortSignal):Promise<TaxiDecision> {
  if(messages.length<1||messages.length>20)throw new Error('Invalid taxi turn size.');
  const latest=messages[messages.length-1],current=messages.map((m)=>m.text).filter(Boolean).join('\n');
  const base:TaxiDecision={action:'reply',draft:{...session.draft},confirmation:null,tripId:null,offerId:null,candidates:[],messages:[],reason:'reply'};
  const reply=(s:string,reason='reply'):TaxiDecision=>({...base,reason,messages:[{to:latest.from,text:s}]});
  const human=(reason:string,s='Voy a pasar tu mensaje a la base para que te ayuden.',draft:Draft=session.draft):TaxiDecision=>({...reply(s,reason),action:'human',draft:{...draft,confirmation:null,expiresAt:null}});
  const requestLocation=(d:Draft,role:'origin'|'destination',reason:string,body?:string):TaxiDecision=>({
    ...base,action:'draft',reason,draft:{...d,confirmation:null,expiresAt:null,quoteCents:null,quoteH3:null,awaitingLocation:role,pendingLocation:null},
    messages:[{to:latest.from,locationRequest:role,text:`${body??(role==='origin'?'Compárteme el pin GPS donde te recogemos con el botón. Si ya escribiste la dirección, la conservo como referencia.':'El destino es opcional. Puedes escribirlo o compartir su pin si quieres precisarlo.')} 🚕`}],
  });
  const clarifyPending=(reason:string):TaxiDecision=>{
    const d:Draft={...session.draft,confirmation:null,expiresAt:null};
    const phase=conversationPhase(session,now);
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
    if(d.awaitingLocation==='origin')return requestLocation(d,'origin','location_still_pending');
    if(!d.origin||d.origin.source!=='gps'||!d.pickupMessageId)return requestLocation(d,'origin','pickup_gps_required');
    d.awaitingLocation=null;d.originArea=null;
    if(d.destination?.source==='written'&&!d.destination.area){d.destinationText=d.destination.text;d.destination=null;}
    if(!within(d.origin,channel)||d.destination&&!within(d.destination,channel))return human('outside_service_area','El recorrido queda fuera de la cobertura actual. Paso la solicitud a la base para revisarla contigo.');
    let quoteCents:number|null=null;
    try{quoteCents=verifiedQuote?verifiedQuote.cents:await services.quote(d.origin,d.destination??d.origin,channel,signal,d.destination?null:d.destinationArea);}catch{return human('h3_quote_unavailable','No pude consultar la tarifa. Paso el recorrido a la base para que lo revisen contigo antes de solicitar una unidad.',d);}
    if(quoteCents===null||!Number.isSafeInteger(quoteCents)||quoteCents<=0||quoteCents>10000000)return human('h3_quote_unavailable','No encontré una tarifa verificada para este punto. La base debe revisarla antes de solicitar el taxi.',d);
    const quoteBasis=d.destination||d.destinationArea?'route':'pickup';
    if(!d.name){
      const price=reason==='quote_only'?(quoteCents===null?'La base necesita confirmar la tarifa de ese recorrido. ':`Ese recorrido tiene una tarifa estimada de $${(quoteCents/100).toFixed(2)} MXN. `):'';
      return {...reply(price+'¿A nombre de quién queda? 😊 Si quieres, también puedes decirme el destino; es opcional.','missing_name'),action:'draft',draft:{...d,quoteCents,quoteBasis,quoteH3:channel.pricingMode==='h3_zone_max'?taxiH3Scope(d.origin,d.destination??d.origin):null}};
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
  if(current.length>6000)return human('turn_too_large','Recibí muchos datos juntos. Paso la conversación a la base para revisar el viaje contigo.');
  if(session.mode==='human'&&!messages.some((m)=>m.type==='button'&&/^tx[arf]_/.test(m.button??'')))return {...base,reason:'human_owned'};
  if(needsHuman(current))return human('human_requested');
  const buttons=messages.filter((m)=>m.type==='button');
  if(buttons.length) {
    if(buttons.length!==1||messages.length!==1)return {...reply('Llegaron respuestas distintas. Revisa el viaje y dime qué quieres hacer.','mixed_button_turn'),action:'draft',draft:{...session.draft,confirmation:null,expiresAt:null}};
    const id=buttons[0].button??'';
    const driver=/^tx([arf])_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(id);
    if(driver)return {...base,action:driver[1]==='a'?'driver_accept':driver[1]==='r'?'driver_reject':'driver_finish',offerId:driver[2],reason:'driver_button'};
    const confirm=/^txc_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(id);
    if(!confirm||confirm[1]!==session.draft.confirmation||!session.draft.expiresAt||Date.parse(session.draft.expiresAt)<=now)return reply('Ese botón ya no corresponde al viaje actual. Revisa el resumen más reciente.','stale_confirmation');
    if(live(session.active))return reply('Ya tienes una solicitud activa. La base sigue pendiente de ese viaje.','active_trip');
    if(!session.draft.name||!session.draft.origin||session.draft.awaitingLocation||session.draft.pendingLocation)return reply('Faltan datos del viaje. Revisemos el punto de recogida y el nombre.','incomplete_draft');
    const review=await tariffReview(session.draft);if(review)return review;
    let candidates:Candidate[]=[];
    try{candidates=await services.candidates(session.draft.origin,channel,signal);}catch{return human('fleet_unavailable','No pude consultar las unidades. Voy a pasar el viaje a la base para que lo revisen.');}
    return {...base,action:'confirm',confirmation:confirm[1],candidates,reason:'button_confirmation'};
  }
  if(messages.some((m)=>m.type==='unsupported'))return reply('Por ahora mándame la dirección por texto o comparte tu ubicación desde WhatsApp.','unsupported_media');
  if(unsupportedRide(current))return human('special_ride','Ese servicio necesita revisión de la base. Les paso tu mensaje para que te confirmen si pueden atenderlo.');
  if(cancelsTaxi(current))return live(session.active)?{...base,action:'cancel',tripId:session.active?.id??null,reason:'explicit_cancellation'}:{...reply('No tienes un viaje activo para cancelar.','no_active_trip'),action:'draft',draft:emptyDraft()};
  if(cancellationQuestion(current))return reply(live(session.active)?'¿Quieres cancelar tu solicitud actual? Si es así, escribe «Cancela mi taxi».':'Todavía no tienes un taxi solicitado para cancelar.','cancellation_question');
  if(live(session.active)) {
    if(activeRideChange(current)||messages.some((m)=>m.location!==null))return human('active_trip_change','Tu viaje ya está solicitado. Paso el cambio a la base para que lo revisen antes de mover la unidad.');
    return reply(session.active?.state==='en_camino'?`🚕 La unidad ${session.active.taxiName??'asignada'} ya aceptó tu viaje. Aún no tengo una llegada confirmada.`:'🚕 Tu solicitud sigue en búsqueda. Todavía no hay una unidad confirmada.','active_status');
  }
  if(messages.every((m)=>m.type==='text'&&(confirmsTaxi(m.text)||courtesyOnly(m.text)))&&messages.some((m)=>confirmsTaxi(m.text))) {
    const d=session.draft;
    if(!d.name||!d.origin||d.pendingLocation||d.awaitingLocation)return reply('Todavía faltan datos por aclarar. Necesito el pin de recogida y el nombre; después toca «Confirmar viaje».','no_current_confirmation');
    return prepareSummary(d,'button_confirmation_required');
  }
  if(messages.every((m)=>m.type==='text'&&courtesyOnly(m.text)))return reply('¡Con gusto! 😊 Aquí sigo por si necesitas algo más.','courtesy');
  const finalDecline=declinesTaxi(latest.text)&&messages.every((m)=>m.type==='text'&&(confirmsTaxi(m.text)||courtesyOnly(m.text)||declinesTaxi(m.text)));
  if(finalDecline)return {...reply('Está bien, todavía no solicito el taxi. Cuando estés listo, revisamos el viaje de nuevo. 🙂','summary_declined'),action:'draft',draft:{...session.draft,confirmation:null,expiresAt:null}};
  let d:Draft={...session.draft};let changed=false;
  const selectedRole=locationRole(current);
  if(selectedRole&&d.pendingLocation&&messages.every((m)=>m.type==='text')){
    if(Date.parse(d.pendingLocation.expiresAt)<=now)return requestLocation(d,selectedRole,'pending_location_expired','Ese pin ya venció. Compártelo otra vez para usarlo en este viaje.');
    d[selectedRole]=d.pendingLocation.place;if(selectedRole==='origin')d.pickupMessageId=d.pendingLocation.messageId??null;d[selectedRole==='origin'?'originArea':'destinationArea']=null;d.pendingLocation=null;d.awaitingLocation=null;
    return prepareSummary(d,'summary');
  }
  let interpretation:Interpretation;
  try{interpretation=current&&!(selectedRole&&messages.some((m)=>m.location!==null))?await services.interpret(current,session,channel,signal):{intent:'provide',fields:{}};}
  catch{return clarifyPending('interpretation_failed');}
  if(interpretation.intent==='human')return human('model_handoff');
  if(interpretation.intent==='ambiguous'||interpretation.intent==='cancel'||interpretation.intent==='confirm')return clarifyPending('ambiguous_intent');
  if(interpretation.intent==='status')return reply('Todavía no has solicitado el taxi. Primero hay que revisar el recorrido y confirmar el resumen.','no_active_status');
  if(interpretation.fields.pickupReference){
    const note=interpretation.fields.pickupReference.value,combined=d.pickupText&&!d.pickupText.includes(note)?d.pickupText+'. '+note:note;
    if(combined.length>400)return {...reply('La referencia quedó muy larga. ¿Me la dices más breve para que el conductor pueda identificarte?','pickup_reference_too_long'),action:'draft',draft:{...d,confirmation:null,expiresAt:null}};
    d.pickupText=combined;changed=true;
  }
  if(interpretation.fields.name){
    const chosen=normalize(interpretation.fields.name.value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const explicit=new RegExp('\\b(?:me llamo|soy|a nombre de|mi nombre es)\\s+'+chosen+'(?:\\b|$)').test(normalize(interpretation.fields.name.evidence));
    const contextualAnswer=conversationPhase(session,now)==='name'&&!d.name;
    if(!explicit&&!contextualAnswer)return {...reply('¿Ese es el nombre del pasajero? ¿A nombre de quién queda el viaje?','unclear_name'),action:'draft',draft:{...d,confirmation:null,expiresAt:null}};
    d.name=interpretation.fields.name.value;changed=true;
  }
  const native=messages.filter((m)=>m.location!==null);
  if(native.length>1)return {...reply('Recibí más de una ubicación. ¿Cuál es el punto donde te recogemos?','multiple_locations'),action:'draft',draft:{...d,confirmation:null,expiresAt:null}};
  const unresolved:('origin'|'destination')[]=[];
  const recognized:Partial<Record<'origin'|'destination',NeighborhoodArea[]>>={};
  const referenceConflicts:Partial<Record<'origin'|'destination',string>>={};
  for(const field of ['origin','destination'] as const) {
    const requested=interpretation.fields[field];if(!requested)continue;
    changed=true;d.confirmation=null;d.expiresAt=null;d.quoteCents=null;d.quoteH3=null;
    const areaKey=field==='origin'?'originArea':'destinationArea';
    if(field==='origin'){
      d.pickupText=requested.value;d.origin=null;d.pickupMessageId=null;d.originArea=null;d.awaitingLocation='origin';continue;
    }
    d.destinationText=requested.value;
    let resolved:LocationResult;try{resolved=await services.resolve(requested.value,channel,signal,d[areaKey]);}catch{resolved={kind:'unavailable'};}
    d[areaKey]=null;
    if(resolved.kind==='resolved'&&within(resolved.place,channel)){d[field]=resolved.place;if(d.awaitingLocation===field)d.awaitingLocation=null;}
    else {d[field]=null;if(resolved.kind==='reference_conflict')referenceConflicts[field]=resolved.label;if(resolved.kind==='ambiguous'&&resolved.neighborhoods?.length){recognized[field]=resolved.neighborhoods;if(resolved.neighborhoods.length===1)d[areaKey]=resolved.neighborhoods[0];else unresolved.push(field);}if(d.awaitingLocation===field)d.awaitingLocation=null;}
  }
  if(d.awaitingLocation==='choice'&&!d.pendingLocation&&!unresolved.length&&(interpretation.fields.origin||interpretation.fields.destination))d.awaitingLocation=!d.origin?'origin':!d.destination?'destination':null;
  if(native[0]?.location) {
    const p=native[0].location;const place:Place={text:`Ubicación compartida (${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})`,lat:p.lat,lng:p.lng,placeId:null,source:'gps'};
    if(!within(place,channel))return human('outside_service_area','La ubicación queda fuera de la zona configurada. La base debe confirmar ese servicio.');
    const target=selectedRole??(unresolved.length===1?unresolved[0]:d.awaitingLocation==='origin'||d.awaitingLocation==='destination'?d.awaitingLocation:null)??(!current&&d.awaitingLocation!=='choice'&&(!d.origin||d.origin.source!=='gps')?'origin':null);
    if(!target)return {...reply('¿Ese pin cambia el punto de recogida o el destino?','location_target_unclear'),action:'draft',draft:{...d,confirmation:null,expiresAt:null,quoteCents:null,quoteH3:null,awaitingLocation:'choice',pendingLocation:{place,expiresAt:new Date(now+10*60000).toISOString(),messageId:native[0].id}}};
    d[target]=place;d[target==='origin'?'originArea':'destinationArea']=null;if(target==='origin')d.pickupMessageId=native[0].id;else d.destinationText=null;d.awaitingLocation=null;d.pendingLocation=null;changed=true;
    const resolvedIndex=unresolved.indexOf(target);if(resolvedIndex>=0)unresolved.splice(resolvedIndex,1);
  }
  if(changed){d.confirmation=null;d.expiresAt=null;d.quoteCents=null;d.quoteH3=null;}
  if(unresolved.length===1){
    const field=unresolved[0],areas=recognized[field];
    const conflict=referenceConflicts[field];if(conflict)return requestLocation(d,field,'neighborhood_reference_conflict',`La ubicación que encontré no cae en ${conflict}. ¿Me confirmas la colonia o me das otra calle o referencia? Si prefieres, comparte el pin.`);
    if(areas?.length===1)return requestLocation(d,field,'neighborhood_reference_required',`Ubico ${localityDisplayName(areas[0])}. ¿En qué calle o con qué referencia ${field==='origin'?'te recogemos':'queda el destino'}? También puedes compartir el pin, si prefieres.`);
    if(areas?.length)return requestLocation(d,field,'neighborhood_ambiguous',`Encontré estas opciones: ${areas.map(localityDisplayName).join(', ')}. ¿Cuál es? Después dime la calle o una referencia.`);
    return requestLocation(d,field,'unresolved_location',`Para ubicar bien ${field==='origin'?'la recogida':'el destino'}, ¿me pasas calle, número y colonia? Si te queda más fácil, también puedes compartir el punto con el botón.`);
  }
  if(unresolved.length>1){const field=unresolved.find(value=>referenceConflicts[value]);if(field)return requestLocation(d,field,'neighborhood_reference_conflict',`La ubicación que encontré no cae en ${referenceConflicts[field]}. ¿Me confirmas la colonia o me das otra calle o referencia? Si prefieres, comparte el pin.`);}
  if(unresolved.length)return {...reply('No pude ubicar con certeza la recogida y el destino. ¿Cuál es la dirección donde te recogemos?','unresolved_location'),action:'draft',draft:{...d,awaitingLocation:'choice',pendingLocation:null}};
  if(interpretation.intent==='smalltalk'&&!changed&&!d.origin&&!d.pendingLocation&&d.awaitingLocation!=='choice')return requestLocation(d,'origin','greeting',`¡Hola! 😊 Somos ${channel.name}. Compárteme el pin GPS donde te recogemos con el botón. Puedes agregar una referencia para que el conductor te identifique.`);
  if(!changed&&interpretation.intent==='smalltalk')return reply('Aquí sigo 😊. Si quieres cambiar algo del viaje, dime qué dato revisamos.','smalltalk');
  if(!changed&&interpretation.intent!=='quote'){
    if(!d.pendingLocation&&d.awaitingLocation!=='choice'&&(!d.origin||d.origin.source!=='gps'))return requestLocation(d,'origin','no_new_fields');
    return reply('Dime dónde te recogemos o qué dato del viaje quieres cambiar.','no_new_fields');
  }
  return prepareSummary(d,interpretation.intent==='quote'?'quote_only':'summary');
}
