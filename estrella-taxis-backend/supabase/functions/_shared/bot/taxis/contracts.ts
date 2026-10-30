import { record, TrackingError, positiveId } from '../../tracking/contracts.ts';
import { taxiH3Cell, type H3QuoteScope } from './h3.ts';
import { parseNeighborhoodArea, streetReference, type NeighborhoodArea } from './neighborhoodContracts.ts';
export { record };
export const TAXI_BOT_VERSION='taxi-bot-v6-neighborhoods';
export interface TaxiChannel {
  tenantId:string; waba:string; enabled:boolean; name:string; city:string;
  centerLat:number; centerLng:number; radiusKm:number; dispatcher:string|null;
  model:string; baseCents:number|null; perKmCents:number|null;pricingMode:'h3_zone_max'|'road_distance';
}
export interface Place {text:string;lat:number;lng:number;placeId:string|null;area?:(NeighborhoodArea & {reference:string})}
export interface PendingLocation {place:Place;expiresAt:string}
export interface Draft {
  fareMode:'quoted'|'unquoted';
  name:string|null;origin:Place|null;destination:Place|null;quoteCents:number|null;confirmation:string|null;expiresAt:string|null;
  awaitingLocation:'origin'|'destination'|'choice'|null;pendingLocation:PendingLocation|null;
  quoteH3:H3QuoteScope|null;
  originArea?:NeighborhoodArea|null;destinationArea?:NeighborhoodArea|null;
}
export interface Trip {id:string;state:'buscando_conductor'|'en_camino'|'completado'|'cancelado'|'cancelado_timeout';taxiName:string|null}
export interface TaxiSession {revision:number;mode:'bot'|'human';draft:Draft;active:Trip|null;history:History[]}
export interface History {role:'user'|'assistant';content:string}
export interface TaxiInbound {
  id:string;from:string;to:string;at:string;type:'text'|'button'|'location'|'unsupported';
  text:string;button:string|null;location:{lat:number;lng:number}|null;
}
export interface FieldValue {value:string;evidence:string}
export interface Interpretation {
  intent:'provide'|'quote'|'confirm'|'cancel'|'status'|'human'|'smalltalk'|'ambiguous';
  fields:{name?:FieldValue;origin?:FieldValue;destination?:FieldValue};
}
export interface TaxiMessage {to:string;text:string;buttons?:{id:string;title:string}[];locationRequest?:'origin'|'destination'}
export interface Candidate {deviceId:number;name:string}
export interface TaxiDecision {
  action:'draft'|'reply'|'confirm'|'cancel'|'human'|'driver_accept'|'driver_reject'|'driver_finish';
  draft:Draft;confirmation:string|null;tripId:string|null;offerId:string|null;
  candidates:Candidate[];messages:TaxiMessage[];reason:string;
}
export function phone(value:unknown):string|null {
  if(typeof value!=='string' || !/^\+?[0-9 ()-]{8,24}$/.test(value))return null;
  const digits=value.replace(/\D/g,'');return /^[1-9]\d{7,14}$/.test(digits)?'+'+digits:null;
}
export function text(value:unknown,max=500):string|null {
  return typeof value==='string' && value.trim().length>0 && value.length<=max && ![...value].some((c)=>{const n=c.charCodeAt(0);return n<32&&n!==9&&n!==10&&n!==13;})?value.trim():null;
}
export function coord(lat:unknown,lng:unknown):lat is number {
  return typeof lat==='number' && typeof lng==='number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat)<=90 && Math.abs(lng)<=180 && !(lat===0 && lng===0);
}
export function emptyDraft():Draft{return {fareMode:'unquoted',name:null,origin:null,destination:null,quoteCents:null,confirmation:null,expiresAt:null,awaitingLocation:null,pendingLocation:null,quoteH3:null};}
export function parsePlace(value:unknown):Place|null {
  if(!record(value)||!text(value.text,400)||!coord(value.lat,value.lng)||typeof value.lng!=='number'||!(value.placeId===null||typeof value.placeId==='string'))return null;
  const area=value.area===undefined?null:parseNeighborhoodArea(value.area);
  if(value.area!==undefined&&(!area||!record(value.area)||typeof value.area.reference!=='string'||!streetReference(value.area.reference,area.label)||area.cell===null||area.priceSource==='h3'&&(!String(value.text).startsWith('Zona aproximada: ')||!String(value.text).includes(value.area.reference))||area.priceSource==='reference'&&String(value.text).startsWith('Zona aproximada: ')))return null;
  return {text:String(value.text),lat:value.lat,lng:value.lng,placeId:value.placeId,...(area&&record(value.area)&&typeof value.area.reference==='string'?{area:{...area,reference:value.area.reference}}:{})};
}
export function parseInbound(payload:unknown,now=Date.now()):TaxiInbound|null {
  if(!record(payload))return null;
  const m=record(payload.whatsappInboundMessage)?payload.whatsappInboundMessage:null;
  if(!m)return null;
  const from=phone(m.from),to=phone(m.to),id=text(m.id,256);
  const at=typeof m.sendTime==='string'?m.sendTime:typeof payload.createTime==='string'?payload.createTime:null;
  if(!from||!to||!id||!at||!Number.isFinite(Date.parse(at))||Date.parse(at)>now+300000||Date.parse(at)<now-86400000)throw new TrackingError(400,'invalid_taxi_message','Mensaje sin identidad, canal o fecha válidos.');
  let messageText='',button:string|null=null,location:TaxiInbound['location']=null,type:TaxiInbound['type']='unsupported';
  if(m.type==='text' && record(m.text)) {messageText=text(m.text.body,3000)??'';type='text';}
  if(m.type==='interactive'&&record(m.interactive)&&record(m.interactive.button_reply)) {button=text(m.interactive.button_reply.id,256);type='button';}
  if(m.type==='button'&&record(m.button)) {button=text(m.button.payload,256);type='button';}
  if(m.type==='location'&&record(m.location)&&coord(m.location.latitude,m.location.longitude)&&typeof m.location.longitude==='number') {location={lat:m.location.latitude,lng:m.location.longitude};type='location';}
  return {id,from,to,at,type,text:messageText,button,location};
}
export function parseStoredInbound(m:unknown,now:number):TaxiInbound {
  if(!record(m)||!text(m.id,256)||!phone(m.from)||!phone(m.to)||typeof m.at!=='string'||!Number.isFinite(Date.parse(m.at))||Date.parse(m.at)>now+300000||typeof m.text!=='string'||m.text.length>3000)throw new TrackingError(502,'invalid_taxi_event','Evento guardado no válido.');
  const type=m.type;if(type!=='text'&&type!=='button'&&type!=='location'&&type!=='unsupported')throw new TrackingError(502,'invalid_taxi_event','Tipo de evento no válido.');
  const location=record(m.location)&&coord(m.location.lat,m.location.lng)&&typeof m.location.lng==='number'?{lat:m.location.lat,lng:m.location.lng}:null;
  if((m.location!==null&&!location)||(type==='button'&&!text(m.button,256))||(type==='location'&&!location))throw new TrackingError(502,'invalid_taxi_event','Contenido de evento no válido.');
  return {id:String(m.id),from:String(m.from),to:String(m.to),at:m.at,type,text:m.text,button:m.button===null?null:String(m.button),location};
}
export function parseSession(value:unknown):TaxiSession {
  if(!record(value)||!Number.isSafeInteger(value.revision)||typeof value.revision!=='number'||value.revision<0||!['bot','human'].includes(String(value.mode))||!record(value.draft)||!Array.isArray(value.history)||value.history.length>12)throw new TrackingError(502,'invalid_taxi_session','La conversación no tiene un estado válido.');
  const d=value.draft;
  // A previously presented summary keeps its fare agreement; empty legacy drafts start unquoted.
  const fareMode=d.fareMode??(d.confirmation!==null||d.quoteCents!==null||d.quoteH3!=null?'quoted':'unquoted');
  if(fareMode!=='quoted'&&fareMode!=='unquoted'||fareMode==='unquoted'&&(d.quoteCents!==null||d.quoteH3!=null))throw new TrackingError(502,'invalid_taxi_fare_mode','El modo de tarifa no corresponde al viaje guardado.');
  const history:History[]=value.history.map((h)=>{if(!record(h)||!['user','assistant'].includes(String(h.role))||!text(h.content,3000))throw new TrackingError(502,'invalid_taxi_history','Historial no válido.');return {role:h.role==='user'?'user':'assistant',content:String(h.content)};});
  if(!(d.name===null||text(d.name,80))||!(d.confirmation===null||text(d.confirmation,64))||!(d.expiresAt===null||(typeof d.expiresAt==='string'&&Number.isFinite(Date.parse(d.expiresAt))))||!(d.quoteCents===null||(Number.isSafeInteger(d.quoteCents)&&typeof d.quoteCents==='number'&&d.quoteCents>=0&&d.quoteCents<=10000000)))throw new TrackingError(502,'invalid_taxi_draft','El borrador no tiene un formato válido.');
  const origin=d.origin===null?null:parsePlace(d.origin),destination=d.destination===null?null:parsePlace(d.destination);
  if((d.origin!==null&&!origin)||(d.destination!==null&&!destination))throw new TrackingError(502,'invalid_taxi_draft','La ubicación guardada no es válida.');
  // Older local drafts predate this durable clarification state. Missing means no pending pin.
  const awaitingLocation=d.awaitingLocation??null;
  if(awaitingLocation!==null&&awaitingLocation!=='origin'&&awaitingLocation!=='destination'&&awaitingLocation!=='choice')throw new TrackingError(502,'invalid_taxi_draft','La ubicación pendiente no es válida.');
  let pendingLocation:PendingLocation|null=null;
  if(d.pendingLocation!==undefined&&d.pendingLocation!==null){
    const p=d.pendingLocation,place=record(p)?parsePlace(p.place):null;
    if(!record(p)||!place||typeof p.expiresAt!=='string'||!Number.isFinite(Date.parse(p.expiresAt))||awaitingLocation!=='choice')throw new TrackingError(502,'invalid_taxi_draft','El pin pendiente no tiene un formato válido.');
    pendingLocation={place,expiresAt:p.expiresAt};
  }
  if((pendingLocation||awaitingLocation)&&d.confirmation!==null)throw new TrackingError(502,'invalid_taxi_draft','Un viaje pendiente de aclaración no puede estar confirmado.');
  let quoteH3:H3QuoteScope|null=null;
  if(d.quoteH3!==undefined&&d.quoteH3!==null){
    const q=d.quoteH3;
    if(!record(q)||!taxiH3Cell(q.originCell)||!taxiH3Cell(q.destinationCell))throw new TrackingError(502,'invalid_taxi_quote','Las zonas de la cotización no son válidas.');
    quoteH3={originCell:q.originCell,destinationCell:q.destinationCell};
  }
  let active:Trip|null=null;
  if(value.active!==null) {const a=value.active;if(!record(a)||!text(a.id,40)||!['buscando_conductor','en_camino','completado','cancelado','cancelado_timeout'].includes(String(a.state))||!(a.taxiName===null||text(a.taxiName,120)))throw new TrackingError(502,'invalid_taxi_trip','El viaje guardado no es válido.');
    const state=a.state;if(state==='buscando_conductor'||state==='en_camino'||state==='completado'||state==='cancelado'||state==='cancelado_timeout')active={id:String(a.id),state,taxiName:a.taxiName===null?null:String(a.taxiName)};
  }
  const originArea=parseNeighborhoodArea(d.originArea),destinationArea=parseNeighborhoodArea(d.destinationArea);
  if(originArea&&origin||destinationArea&&destination||(originArea||destinationArea)&&d.confirmation!==null)throw new TrackingError(502,'invalid_taxi_area','Falta aclarar una colonia del recorrido.');
  return {revision:value.revision,mode:value.mode==='human'?'human':'bot',draft:{fareMode,name:d.name===null?null:String(d.name),origin,destination,quoteCents:d.quoteCents===null?null:Number(d.quoteCents),confirmation:d.confirmation===null?null:String(d.confirmation),expiresAt:d.expiresAt===null?null:String(d.expiresAt),awaitingLocation,pendingLocation,quoteH3,...(d.originArea!==undefined?{originArea}:{}),...(d.destinationArea!==undefined?{destinationArea}:{})},active,history};
}
export function parseCandidates(raw:unknown):Candidate[] {
  if(!Array.isArray(raw)||raw.length>3)throw new TrackingError(502,'invalid_taxi_candidates','La selección de unidades no es válida.');
  const seen=new Set<number>();return raw.map((v)=>{if(!record(v)||!positiveId(v.deviceId)||!text(v.name,120)||seen.has(v.deviceId))throw new TrackingError(502,'invalid_taxi_candidates','Unidad no válida o repetida.');seen.add(v.deviceId);return {deviceId:v.deviceId,name:String(v.name)};});
}
