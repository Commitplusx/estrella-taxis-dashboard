import { record, type Interpretation } from './contracts.ts';
import { TrackingError } from '../../tracking/contracts.ts';
export const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
export const resetCommand=(s:string):boolean=>/^\s*\/reset\s*$/i.test(s);
export function defersDestination(s:string):boolean{
 return /^(?:aun no (?:lo )?se|todavia no (?:lo )?se|no (?:lo )?se|(?:mejor |prefiero )?(?:se )?lo (?:digo|dire|indico) al (?:chofer|conductor)|(?:mejor )?despues|(?:de momento|por ahora) no|prefiero no (?:decirlo|darlo)(?: ahorita)?)[.!]*$/.test(normalize(s));
}
export function draftLocationRequest(s:string):'origin'|'destination'|null {
  const match=/^(?:(?:cambiar|cambia|corregir|corrige) (?:el |la )?)?(destino|origen|recogida)[.!¡]*$/.exec(normalize(s));
  return match?match[1]==='destino'?'destination':'origin':null;
}
export const cancelDraftCommand=(s:string):boolean=>/^(?:cancelar|cancela)[.!¡]*$/.test(normalize(s));
export function confirmsTaxi(s:string):boolean {
  if(/[?¿]|\.{2,}/.test(s))return false;
  return /^(?:si|si confirmo|confirmo(?: el (?:viaje|taxi))?|confirmar viaje|mandalo|envialo|manda el taxi|si[, ]+mandalo|adelante|dale|va|sale|de acuerdo|correcto|asi esta bien)(?:[,. ]+(?:por favor|porfa|gracias))?[.!¡]*$/.test(normalize(s));
}
export function cancelsTaxi(s:string):boolean {
  if(/[?¿]|\.{2,}/.test(s))return false;
  return /^(?:cancela(?:r)?(?: (?:el|mi))? (?:taxi|viaje)|cancelalo|ya no (?:quiero|necesito) (?:el |mi )?taxi|cancela mi solicitud)(?:[,. ]+(?:por favor|porfa|gracias))?[.!¡]*$/.test(normalize(s));
}
export function courtesyOnly(s:string):boolean {
  return /^(?:muchas gracias|gracias|por favor|porfa|ok gracias|perfecto gracias)[.!¡, ]*$/.test(normalize(s));
}
export function declinesTaxi(s:string):boolean {
  return /^(?:no|todavia no|aun no|ahorita no|por ahora no|espera|esperame)(?:[,. ]+(?:por favor|porfa|gracias))?[.!¡]*$/.test(normalize(s));
}
export function cancellationQuestion(s:string):boolean {
  return /\b(?:cancelar|cancela|cancelalo)\b/.test(normalize(s))&&(/[?¿]/.test(s)||/\b(?:puedes|podrias|se puede|quieres que)\b/.test(normalize(s)));
}
/** Role selection is deliberately anchored: an address or a conditional cannot choose a stored pin. */
function locationRoleSignals(s:string):{origin:boolean;destination:boolean} {
  const clauses=s.split(/[\n.!¡?;]+/).map(normalize).filter((part)=>Boolean(part)&&! /\b(?:si|o|u|manana|tal vez|quizas)\b/.test(part));
  const origin=clauses.some((n)=>
    /^(?:(?:es|ese es|este es|el pin es|la ubicacion es) (?:el |mi )?)?(?:origen|punto de recogida|recogida)$/.test(n)||
    /^(?:ahi me recoges|aqui me recoges|es donde estoy|(?:ese|este) es donde me vas a recoger|es donde me recoges|aqui estoy|aca estoy|me esperas aqui|pasas por mi aqui)$/.test(n)||
    /\b(?:recogeme|recogernos|pasas por mi|pasa por mi|me recoges|me recogen)\b[^\n]*\b(?:esta|esa|aqui|aca|ahi|alla)(?:\s+(?:direccion|ubicacion|punto))?\b/.test(n)||
    /\b(?:mandame|envíame|enviame|mandas|envias)\s+(?:un\s+)?taxi\s+(?:a|al|en|hasta)\s+(?:esta|esa)(?:\s+(?:direccion|ubicacion))?\b/.test(n)
  );
  const destination=clauses.some((n)=>
    /^(?:(?:es|ese es|este es|el pin es|la ubicacion es) (?:el |mi )?)?destino$/.test(n)||
    /^(?:ahi voy|alla voy|es a donde voy|(?:ese|este) es el lugar al que voy|ahi quiero llegar)$/.test(n)||
    /\b(?:voy|vamos|me dirijo)\s+(?:para|pa|a|hasta|hacia)\s+(?:esta|esa|este|ese|aqui|aca|ahi|alla)(?:\s+(?:direccion|ubicacion|lugar|punto))?\b/.test(n)||
    /\b(?:mi destino|a donde voy)\s+(?:es|queda)\s+(?:esta|ese|esta direccion|esa direccion|aqui|ahi|alla)\b/.test(n)||
    /\b(?:llevame|llevanos|me llevas|nos llevas)\s+(?:a|al|hasta)\s+(?:esta|esa|este|ese|aqui|aca|ahi|alla)(?:\s+(?:direccion|ubicacion|lugar|punto))?\b/.test(n)
  );
  return {origin,destination};
}
/** Exact role cues from nearby text may label a native WhatsApp location. */
export function locationRole(s:string):'origin'|'destination'|null {
  const roles=locationRoleSignals(s);
  if(roles.origin===roles.destination)return null;
  return roles.origin?'origin':'destination';
}
export function locationRoleConflict(s:string):boolean {
  const roles=locationRoleSignals(s);
  return roles.origin&&roles.destination;
}
/** Deictic text points at a paired native pin; it is not a searchable street name. */
export function refersToSharedLocation(s:string):boolean {
  return /^(?:(?:a|en|para|hacia|hasta)\s+)?(?:esta|ese|esa|este|aqui|aca|ahi|alla)(?:\s+(?:direccion|ubicacion|lugar|punto))?[.!¡? ]*$/.test(normalize(s));
}
export function activeRideChange(s:string):boolean {
  return /\b(?:cambia|cambiar|mejor|otro destino|otra direccion|corrige|voy a|vamos a|lleva(?:me|nos) a|recoge(?:me|nos) en|recogida en|destino es)\b/.test(normalize(s));
}
export function needsHuman(s:string):boolean {
  return /\b(?:persona real|hablar con (?:un |una )?(?:humano|persona|operador|operadora)|queja|emergencia|accidente|me (?:acosa|amenaza)|peligro)\b/.test(normalize(s));
}
export function unsupportedRide(s:string):boolean {
  return /\b(?:manana|pasado manana|programa(?:r|do)?|reserva(?:r|do)? para|a las? \d|(?:en|dentro de) (?:un|una|dos|tres|\d+) (?:horas?|minutos?)|para (?:hoy|esta noche|el lunes|el martes|el miercoles|el jueves|el viernes|el sabado|el domingo)|(?:2|3|4|dos|tres|cuatro) taxis|(?:[5-9]|cinco|seis|siete|ocho) (?:personas|pasajeros)|silla de ruedas|mascota|viaje redondo|ida y vuelta)\b/.test(normalize(s));
}
/** A polite service request is a question grammatically, not a hypothetical address. */
function serviceRequestQuestion(clause:string):boolean {
  const request=normalize(clause).replace(/^(?:[¿¡ ]*(?:hola|oye|buenas|bro|por favor|porfa)[,! . ]+)*[¿¡ ]*/, '');
  return /^(?:(?:me|nos)\s+(?:(?:puedes?|podrias?)\s+)?(?:mandas?|envias?|mandar|enviar)|(?:puedes?|podrias?)\s+(?:mandar|enviar)(?:me|nos)?|(?:manda|envia)(?:me|nos))\s+(?:un\s+)?taxi\s+(?:a|al|en|hasta)\s+\S/.test(request)
    || /^(?:(?:me|nos)\s+(?:(?:puedes?|podrias?)\s+)?(?:llevas?|llevar|recoges?|recoger)|(?:puedes?|podrias?)\s+(?:llevar|recoger)(?:me|nos))\s+(?:a|al|en|hasta|de)\s+\S/.test(request)
    || /^(?:(?:puedes?|podrias?)\s+)?(?:pasas?|pasar)\s+por\s+(?:mi|nosotros)\s+(?:a|al|en)\s+\S/.test(request);
}
/** Scope polarity to the actual field; an unrelated "no llevo equipaje" does not negate its address. */
function fieldClause(clause:string,chosen:string):string {
  const n=normalize(clause),escaped=chosen.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const at=[...n.matchAll(new RegExp('(?<![\\p{L}\\p{N}_])'+escaped+'(?![\\p{L}\\p{N}_])','gu'))].at(-1)?.index??-1;if(at<0)return n;
  let start=0,end=n.length;
  for(const match of n.matchAll(/[,;]|\b(?:no|sino|mejor|mas bien|quise decir|perdon|ahora)\b|\by\s+(?=(?:voy|vamos|llevame|llevanos|estoy|recogeme|me llamo|soy)\b)/g)){
    const index=match.index,finish=index+match[0].length;
    if(match[0]==='mejor'&&/a lo\s+$/.test(n.slice(0,index)))continue;
    if(finish<=at)start=match[0]===','||match[0]===';'?finish:index;
    else if(index>=at+chosen.length){end=index;break;}
  }
  return n.slice(start,end).trim();
}
/** Each new field must cite the current message; history cannot authorize a new mutation. */
export function parseInterpretation(raw:unknown,current:string):Interpretation {
  if(!record(raw)||Object.keys(raw).some((k)=>!['intent','fields'].includes(k))||!record(raw.fields))throw new TrackingError(502,'invalid_taxi_intent','No se pudo interpretar la solicitud con seguridad.');
  const intent=raw.intent;
  if(intent!=='request'&&intent!=='provide'&&intent!=='quote'&&intent!=='question'&&intent!=='confirm'&&intent!=='cancel'&&intent!=='status'&&intent!=='human'&&intent!=='smalltalk'&&intent!=='ambiguous')throw new TrackingError(502,'invalid_taxi_intent','Intención no válida.');
  const fields:Interpretation['fields']={};
  for(const [key,v] of Object.entries(raw.fields)) {
    if((key!=='name'&&key!=='origin'&&key!=='destination'&&key!=='pickupReference')||!record(v)||Object.keys(v).some((k)=>!['value','evidence'].includes(k))||typeof v.value!=='string'||typeof v.evidence!=='string')throw new TrackingError(502,'invalid_taxi_field','Campo no válido.');
    const value=v.value.trim(),evidence=v.evidence.trim();
    const chosen=normalize(value),escaped=chosen.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const literal=new RegExp('(?<![\\p{L}\\p{N}_])'+escaped+'(?![\\p{L}\\p{N}_])','u');
    if(value.length<2||value.length>(key==='name'?80:400)||evidence.length<value.length||evidence.length>3000||!current.includes(evidence)||!literal.test(normalize(evidence))||/[<>]/.test(value)||[...value].some((c)=>c.charCodeAt(0)<32))throw new TrackingError(502,'unproven_taxi_field','El dato no coincide con el mensaje actual.');
    const start=current.indexOf(evidence),before=current.slice(0,start),after=current.slice(start+evidence.length);
    // The evidence cannot crop a negation or a later correction out of its clause.
    const clauseStart=Math.max(before.lastIndexOf('.'),before.lastIndexOf('\n'),before.lastIndexOf(';'))+1;
    const tail=after.search(/[.\n;]/);const clause=current.slice(clauseStart,tail<0?current.length:start+evidence.length+tail);
    const n=fieldClause(clause,chosen),whole=normalize(clause);
    const corrections=[...n.matchAll(/\b(?:sino|mejor|mas bien|quise decir|perdon)\b[,: ]*/g)];
    const marker=corrections[corrections.length-1];
    const correction=marker?n.slice((marker.index??0)+marker[0].length):null;
    const quoteQuestion=intent==='quote'&&/\b(?:cuanto (?:cuesta|sale|cobra|cobran)|que (?:precio|tarifa)|cual es (?:el precio|la tarifa))\b/.test(n);
    const serviceQuestion=intent==='provide'&&key!=='name'&&serviceRequestQuestion(clause);
    const negated=new RegExp('\\bno\\s+(?:(?:en|a|al|de|desde|para|hacia|el|la|es|era|estoy|voy)\\s+)*'+escaped+'(?:\\b|$)').test(n);
    // Keep an explicit negative qualifier in a visual note, never a cropped positive claim from it.
    const referenceContrast=key==='pickupReference'&&/\bno\b/.test(chosen)&&!/^no\b/.test(chosen);
    // A cropped citation from an earlier bubble cannot defeat a later correction.
    // Explicit corrections of the other endpoint do not invalidate this endpoint.
    const all=current.split('\n').map(normalize).join('\n'),chosenAt=[...all.matchAll(new RegExp(literal.source,'gu'))].at(-1)?.index??-1,later=all.slice(chosenAt+chosen.length);
    const laterCorrection=[...later.matchAll(/(?:^|[.,\n;])\s*(?:no[, ]+)?(?:mejor|mas bien|quise decir|perdon|sino|ahora)\b[^,.;\n]*/g)].some((m)=>{
      const other=key==='origin'?'destino|voy a|vamos a|lleva(?:me|nos) (?:a|al)|me dirijo (?:a|al)':key==='destination'?'origen|recogida|recogeme|estoy en|te espero en':'origen|destino|recogida';
      return key==='name'?/\b(?:nombre|me llamo|soy)\b/.test(m[0]):!new RegExp('\\b(?:'+other+')\\b').test(m[0]);
    });
    const alternative=key!=='name'&&/\s(?:o|u)\s/.test(n);
    if((negated&&!referenceContrast)||alternative||laterCorrection||(/[?¿]/.test(n)&&!quoteQuestion&&!serviceQuestion)||/\b(?:si pudiera|tal vez|quizas|a lo mejor|podria|si voy|no se si)\b/.test(whole)||(!referenceContrast&&/\bno\b/.test(n)&&(correction===null||!correction.includes(chosen)))||(correction!==null&&!correction.includes(chosen))||/\b(?:dijo|dice|ejemplo|supongamos)\b/.test(whole))throw new TrackingError(502,'ambiguous_taxi_field','Hace falta aclarar el dato antes de cambiarlo.');
    if(key==='name'&&/\b(?:taxi|mandalo|confirmo|hola|si|no|origen|destino)\b/.test(chosen))throw new TrackingError(502,'invalid_taxi_name','Falta el nombre del pasajero.');
    fields[key]={value,evidence};
  }
  return {intent,fields};
}
