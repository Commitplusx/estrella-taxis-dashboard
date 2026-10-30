import {assertTaxiTransition}from'./stateMachine.ts';
import type{ModelMetadata}from'./trace.ts';
import { emptyDraft, type Candidate, type Draft, type Interpretation, type Place, type TaxiChannel, type TaxiDecision, type TaxiInbound, type TaxiSession } from './contracts.ts';
import { activeRideChange, cancellationQuestion, cancelsTaxi, confirmsTaxi, courtesyOnly, declinesTaxi, locationRole, needsHuman, normalize, unsupportedRide } from './policy.ts';
import { getDistanceFromLatLonInKm } from '../../algorithms/headingMatcher.ts';
import { taxiH3Scope } from './h3.ts';
import type { NeighborhoodArea } from './neighborhoodContracts.ts';
import { localityDisplayName } from './neighborhoods.ts';
export type LocationResult={kind:'resolved';place:Place}|{kind:'ambiguous';labels:string[];neighborhoods?:NeighborhoodArea[]}|{kind:'reference_conflict';label:string}|{kind:'unavailable'};
export interface TaxiServices {
  interpret:(text:string,session:TaxiSession,channel:TaxiChannel,signal?:AbortSignal,observe?:(metadata:ModelMetadata)=>void)=>Promise<Interpretation>;
  resolve:(text:string,channel:TaxiChannel,signal?:AbortSignal,area?:NeighborhoodArea|null,observe?:(metadata:ModelMetadata)=>void)=>Promise<LocationResult>;
  quote:(origin:Place,destination:Place,channel:TaxiChannel,signal?:AbortSignal)=>Promise<number|null>;
  candidates:(origin:Place,channel:TaxiChannel,signal?:AbortSignal)=>Promise<Candidate[]>;
}
export function taxiSummary(d:Draft):string {
  const price=d.fareMode==='quoted'?(d.quoteCents===null?'La tarifa la confirma la base; todavía no hay un precio acordado.':`Tarifa estimada: $${(d.quoteCents/100).toFixed(2)} MXN.`):'';
  return `🚕 ¿Así queda tu viaje?\nA nombre de: ${d.name}\nTe recogemos en: ${d.origin?.text}\nVas a: ${d.destination?.text}\n${price?price+'\n':''}Confirma para empezar a buscar una unidad.`;
}
function live(t:TaxiSession['active']):boolean{return t?.state==='buscando_conductor'||t?.state==='en_camino';}
function within(p:Place,c:TaxiChannel):boolean{return getDistanceFromLatLonInKm(p.lat,p.lng,c.centerLat,c.centerLng)<=c.radiusKm;}
export async function coordinateTaxi(messages:TaxiInbound[],session:TaxiSession,channel:TaxiChannel,services:TaxiServices,now:number,signal?:AbortSignal):Promise<TaxiDecision> {
  const decision=await decideTaxi(messages,session,channel,services,now,signal);
  assertTaxiTransition(session,messages,decision,now);
  return decision;
}
async function decideTaxi(messages:TaxiInbound[],session:TaxiSession,channel:TaxiChannel,services:TaxiServices,now:number,signal?:AbortSignal):Promise<TaxiDecision> {
  if(messages.length<1||messages.length>20)throw new Error('Invalid taxi turn size.');
  const latest=messages[messages.length-1],current=messages.map((m)=>m.text).filter(Boolean).join('\n');
  const base:TaxiDecision={action:'reply',draft:{...session.draft},confirmation:null,tripId:null,offerId:null,candidates:[],messages:[],reason:'reply'};
  const reply=(s:string,reason='reply'):TaxiDecision=>({...base,reason,messages:[{to:latest.from,text:s}]});
  const human=(reason:string,s='Voy a pasar tu mensaje a la base para que te ayuden.'):TaxiDecision=>({...reply(s,reason),action:'human'});
  const requestLocation=(d:Draft,role:'origin'|'destination',reason:string,body?:string):TaxiDecision=>({
    ...base,action:'draft',reason,draft:{...d,confirmation:null,expiresAt:null,quoteCents:null,quoteH3:null,awaitingLocation:role,pendingLocation:null},
    messages:[{to:latest.from,locationRequest:role,text:`${body??(role==='origin'?'¿Dónde te recogemos? Escríbeme la dirección o, si te queda más fácil, compártela con el botón.':'¿A dónde vas? Escríbeme la dirección o, si prefieres, elige el destino con el botón.')} 🚕`}],
  });
  const askDestination=(d:Draft,reason:string):TaxiDecision=>({...reply('Va, ¿a dónde vas? 🚕',reason),action:'draft',draft:{...d,awaitingLocation:'destination',confirmation:null,expiresAt:null,quoteCents:null,quoteH3:null}});
  const prepareSummary=async(draft:Draft,reason:string,verifiedQuote?:{cents:number|null}):Promise<TaxiDecision>=>{
    const d:Draft={...draft,fareMode:reason==='quote_only'?'quoted':draft.fareMode,confirmation:null,expiresAt:null,quoteCents:null,quoteH3:null};
    if(d.pendingLocation||d.awaitingLocation==='choice')return {...reply('¿El pin es el punto de recogida o el destino?','location_target_unclear'),action:'draft',draft:d};
    if(d.awaitingLocation)return d.awaitingLocation==='destination'?askDestination(d,'location_still_pending'):requestLocation(d,d.awaitingLocation,'location_still_pending');
    if(!d.origin)return requestLocation(d,'origin','missing_origin');
    if(!d.destination)return askDestination(d,'missing_destination');
    if(!within(d.origin,channel)||!within(d.destination,channel))return human('outside_service_area','El recorrido queda fuera de la cobertura actual. Paso la solicitud a la base para revisarla contigo.');
    const sameReference=normalize(d.origin.text)===normalize(d.destination.text);
    if(getDistanceFromLatLonInKm(d.origin.lat,d.origin.lng,d.destination.lat,d.destination.lng)<0.03&&(!(d.origin.area||d.destination.area)||sameReference))return requestLocation({...d,destination:null},'destination','same_place','El origen y el destino parecen el mismo punto. Escribe a dónde vas o elige el destino en el mapa.');
    let quoteCents:number|null=null;
    try{if(d.fareMode==='quoted')quoteCents=verifiedQuote?verifiedQuote.cents:await services.quote(d.origin,d.destination,channel,signal);}catch{
      if(channel.pricingMode==='h3_zone_max')return human('h3_quote_unavailable','No pude consultar la tarifa de esas zonas. Paso el recorrido a la base para que lo revisen contigo.');
      quoteCents=null;
    }
    if(quoteCents!==null&&(!Number.isSafeInteger(quoteCents)||quoteCents<0||quoteCents>10000000))quoteCents=null;
    if(!d.name){
      const price=reason==='quote_only'?(quoteCents===null?'La base necesita confirmar la tarifa de ese recorrido. ':`Ese recorrido tiene una tarifa estimada de $${(quoteCents/100).toFixed(2)} MXN. `):'';
      return {...reply(price+'¿A nombre de quién lo pido?','missing_name'),action:'draft',draft:{...d,quoteCents,quoteH3:d.fareMode==='quoted'&&channel.pricingMode==='h3_zone_max'?taxiH3Scope(d.origin,d.destination):null}};
    }
    const summary:Draft={...d,quoteCents,quoteH3:d.fareMode==='quoted'&&channel.pricingMode==='h3_zone_max'?taxiH3Scope(d.origin,d.destination):null,confirmation:crypto.randomUUID(),expiresAt:new Date(now+10*60000).toISOString(),awaitingLocation:null,pendingLocation:null};
    return {...base,action:'draft',draft:summary,reason,messages:[{to:latest.from,text:taxiSummary(summary),buttons:[{id:'txc_'+summary.confirmation,title:'Confirmar viaje'}]}]};
  };
  const tariffReview=async(d:Draft):Promise<TaxiDecision|null>=>{
    if(!d.origin||!d.destination)return null;
    for(const field of ['origin','destination'] as const){
      const place=d[field];if(!place?.area)continue;
      let current:LocationResult;try{current=await services.resolve(place.area.reference,channel,signal,place.area);}catch{return human('neighborhood_review_failed','No pude comprobar la colonia del recorrido. Paso la solicitud a la base antes de buscar una unidad.');}
      if(current.kind!=='resolved')return requestLocation({...d,[field]:null,[field+'Area']:null},field,'neighborhood_changed','Cambió la zona del recorrido. ¿Me confirmas la colonia, calle o referencia? El pin sigue siendo opcional.');
      if(JSON.stringify(current.place)!==JSON.stringify(place))return prepareSummary({...d,[field]:current.place},'neighborhood_changed');
    }
    if(!within(d.origin,channel)||!within(d.destination,channel))return human('outside_service_area','La cobertura de la base cambió y el recorrido queda fuera. Les paso tu solicitud antes de buscar una unidad.');
    if(d.fareMode==='unquoted')return null;
    if(channel.pricingMode==='road_distance')return d.quoteH3?prepareSummary(d,'tariff_changed'):null;
    let cents:number|null;
    try{cents=await services.quote(d.origin,d.destination,channel,signal);}catch{return human('h3_quote_unavailable','No pude volver a comprobar la tarifa. Paso la solicitud a la base antes de buscar una unidad.');}
    const scope=taxiH3Scope(d.origin,d.destination);
    if(cents!==d.quoteCents||!d.quoteH3||d.quoteH3.originCell!==scope.originCell||d.quoteH3.destinationCell!==scope.destinationCell)return prepareSummary(d,'tariff_changed',{cents});
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
    if(!session.draft.name||!session.draft.origin||!session.draft.destination||session.draft.awaitingLocation||session.draft.pendingLocation)return reply('Faltan datos del viaje. Revisemos el punto de recogida y el destino.','incomplete_draft');
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
    if(!d.name||!d.origin||!d.destination||d.pendingLocation||d.awaitingLocation)return reply('Todavía faltan datos por aclarar antes de solicitar el taxi. Revisemos el punto de recogida y el destino.','no_current_confirmation');
    if(!d.confirmation||!d.expiresAt||Date.parse(d.expiresAt)<=now)return prepareSummary(d,'refreshed_summary');
    const review=await tariffReview(d);if(review)return review;
    let candidates:Candidate[]=[];
    try{candidates=await services.candidates(d.origin,channel,signal);}catch{return human('fleet_unavailable','No pude consultar las unidades. Paso la solicitud a la base para que te ayuden.');}
    return {...base,action:'confirm',confirmation:d.confirmation,candidates,reason:'text_confirmation'};
  }
  if(messages.every((m)=>m.type==='text'&&courtesyOnly(m.text)))return reply('¡Con gusto! 😊 Aquí sigo por si necesitas algo más.','courtesy');
  const finalDecline=declinesTaxi(latest.text)&&messages.every((m)=>m.type==='text'&&(confirmsTaxi(m.text)||courtesyOnly(m.text)||declinesTaxi(m.text)));
  if(finalDecline)return {...reply('Está bien, todavía no solicito el taxi. Cuando estés listo, revisamos el viaje de nuevo. 🙂','summary_declined'),action:'draft',draft:{...session.draft,confirmation:null,expiresAt:null}};
  let d:Draft={...session.draft};let changed=false;
  const selectedRole=locationRole(current);
  if(selectedRole&&d.pendingLocation&&messages.every((m)=>m.type==='text')){
    if(Date.parse(d.pendingLocation.expiresAt)<=now)return requestLocation(d,selectedRole,'pending_location_expired','Ese pin ya venció. Compártelo otra vez para usarlo en este viaje.');
    d[selectedRole]=d.pendingLocation.place;d[selectedRole==='origin'?'originArea':'destinationArea']=null;d.pendingLocation=null;d.awaitingLocation=null;
    return prepareSummary(d,'summary');
  }
  let interpretation:Interpretation;
  try{interpretation=current&&!(selectedRole&&messages.some((m)=>m.location!==null))?await services.interpret(current,session,channel,signal):{intent:'provide',fields:{}};}
  catch{return {...reply('No alcancé a entender el cambio. ¿Me dices de nuevo dónde te recogemos y a dónde vas?','interpretation_failed'),action:'draft',draft:{...session.draft,confirmation:null,expiresAt:null}};}
  if(interpretation.intent==='human')return human('model_handoff');
  if(interpretation.intent==='ambiguous'||interpretation.intent==='cancel'||interpretation.intent==='confirm')return {...reply('Para no mover el viaje por error, dime exactamente qué quieres cambiar o cancelar.','ambiguous_intent'),action:'draft',draft:{...session.draft,confirmation:null,expiresAt:null}};
  if(interpretation.intent==='status')return reply('Todavía no has solicitado el taxi. Primero hay que revisar el recorrido y confirmar el resumen.','no_active_status');
  if(interpretation.fields.name){
    const chosen=normalize(interpretation.fields.name.value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const explicit=new RegExp('\\b(?:me llamo|soy|a nombre de|mi nombre es)\\s+'+chosen+'(?:\\b|$)').test(normalize(interpretation.fields.name.evidence));
    const bareAnswer=!d.name&&d.origin&&d.destination&&normalize(current).replace(/[.!¡]+$/,'')===normalize(interpretation.fields.name.value);
    if(!explicit&&!bareAnswer)return {...reply('¿Ese es el nombre del pasajero? Escríbeme «A nombre de…» para confirmarlo.','unclear_name'),action:'draft',draft:{...d,confirmation:null,expiresAt:null}};
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
    let resolved:LocationResult;try{resolved=await services.resolve(requested.value,channel,signal,d[areaKey]);}catch{resolved={kind:'unavailable'};}
    d[areaKey]=null;
    if(resolved.kind==='resolved'&&within(resolved.place,channel)){d[field]=resolved.place;if(d.awaitingLocation===field)d.awaitingLocation=null;}
    else {d[field]=null;unresolved.push(field);if(resolved.kind==='reference_conflict')referenceConflicts[field]=resolved.label;if(resolved.kind==='ambiguous'&&resolved.neighborhoods?.length){recognized[field]=resolved.neighborhoods;if(resolved.neighborhoods.length===1)d[areaKey]=resolved.neighborhoods[0];}}
  }
  if(d.awaitingLocation==='choice'&&!d.pendingLocation&&!unresolved.length&&(interpretation.fields.origin||interpretation.fields.destination))d.awaitingLocation=!d.origin?'origin':!d.destination?'destination':null;
  if(native[0]?.location) {
    const p=native[0].location;const place:Place={text:`Ubicación compartida (${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})`,lat:p.lat,lng:p.lng,placeId:null,source:'gps'};
    if(!within(place,channel))return human('outside_service_area','La ubicación queda fuera de la zona configurada. La base debe confirmar ese servicio.');
    const target=selectedRole??(unresolved.length===1?unresolved[0]:d.awaitingLocation==='origin'||d.awaitingLocation==='destination'?d.awaitingLocation:null)??(!current&&d.awaitingLocation!=='choice'&&!(d.origin&&d.destination)?(!d.origin?'origin':'destination'):null);
    if(!target)return {...reply('¿Ese pin cambia el punto de recogida o el destino?','location_target_unclear'),action:'draft',draft:{...d,confirmation:null,expiresAt:null,quoteCents:null,quoteH3:null,awaitingLocation:'choice',pendingLocation:{place,expiresAt:new Date(now+10*60000).toISOString()}}};
    d[target]=place;d[target==='origin'?'originArea':'destinationArea']=null;d.awaitingLocation=null;d.pendingLocation=null;changed=true;
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
  if(interpretation.intent==='smalltalk'&&!changed&&!d.origin&&!d.pendingLocation&&d.awaitingLocation!=='choice')return requestLocation(d,'origin','greeting',`¡Hola! 😊 Somos ${channel.name}. ¿Dónde te recogemos? Escríbeme la dirección o, si prefieres, compártela con el botón.`);
  if(!changed&&interpretation.intent==='smalltalk')return reply('Aquí sigo 😊. Si quieres cambiar algo del viaje, dime qué dato revisamos.','smalltalk');
  if(!changed&&interpretation.intent!=='quote'){
    if(!d.pendingLocation&&d.awaitingLocation!=='choice'&&(!d.origin||!d.destination))return !d.origin?requestLocation(d,'origin','no_new_fields'):askDestination(d,'no_new_fields');
    return reply('Dime dónde te recogemos o qué dato del viaje quieres cambiar.','no_new_fields');
  }
  return prepareSummary(d,interpretation.intent==='quote'?'quote_only':'summary');
}
