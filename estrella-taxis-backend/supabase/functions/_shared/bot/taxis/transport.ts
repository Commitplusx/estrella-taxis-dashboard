import { TrackingError } from '../../tracking/contracts.ts';
import { readJson, type Fetcher } from '../../tracking/http.ts';
import { phone, record, text, type TaxiMessage } from './contracts.ts';
export async function signedBody(req:Request):Promise<string> {
  const reader=req.body?.getReader();if(!reader)throw new TrackingError(400,'missing_body','Falta el mensaje.');
  const chunks:Uint8Array[]=[];let length=0;let expired=false;
  const timer=setTimeout(()=>{expired=true;void reader.cancel().catch(()=>{});},10000);
  try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>131072){await reader.cancel();throw new TrackingError(413,'taxi_payload_too_large','Mensaje demasiado grande.');}chunks.push(part.value);}if(expired)throw new TrackingError(408,'taxi_body_timeout','No llegó el mensaje completo.');}finally{clearTimeout(timer);reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
export async function verifyYCloud(raw:string,header:string|null,secret:string,now:number):Promise<boolean> {
  if(secret.length<16||!header||header.length>512)return false;
  const match=/^t=(\d{10}),s=([a-f0-9]{64})$/i.exec(header.trim());if(!match||Math.abs(now/1000-Number(match[1]))>300)return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const signature=new Uint8Array(match[2].match(/.{2}/g)?.map((n)=>parseInt(n,16))??[]);
  return crypto.subtle.verify('HMAC',key,signature,new TextEncoder().encode(match[1]+'.'+raw));
}
export interface TaxiOutgoing {id:string;lease:string;tenantId:string;waba:string;message:TaxiMessage}
export type SendOutcome={state:'accepted';providerId:string}|{state:'failed'|'uncertain';code:string};
export function parseOutgoing(raw:unknown):TaxiOutgoing {
  if(!record(raw)||!text(raw.id,40)||!text(raw.lease,40)||!text(raw.tenant_id,40)||!phone(raw.waba)||!phone(raw.destination)||!record(raw.body)||!text(raw.body.text,4096))throw new TrackingError(502,'invalid_taxi_outbox','La salida guardada no es válida.');
  let buttons:TaxiMessage['buttons'];
  if(raw.body.buttons!==null&&raw.body.buttons!==undefined){if(!Array.isArray(raw.body.buttons)||raw.body.buttons.length>3)throw new TrackingError(502,'invalid_taxi_buttons','Botones no válidos.');buttons=raw.body.buttons.map((b)=>{if(!record(b)||!text(b.id,128)||!text(b.title,20))throw new TrackingError(502,'invalid_taxi_button','Botón no válido.');return {id:String(b.id),title:String(b.title)};});}
  const locationRequest=raw.body.locationRequest;
  let urlButton:TaxiMessage['urlButton'];
  if(raw.body.urlButton!==undefined){
    const b=raw.body.urlButton;
    if(!record(b)||Object.keys(b).sort().join(',')!=='title,url'||b.title!=='Ver mi viaje'||typeof b.url!=='string'||!/^https:\/\/stellar\.estrella-eats\.mx\/driver-trip#[a-f0-9]{64}$/.test(b.url)||typeof raw.dedupe_key!=='string'||!/^driver-assigned:[a-f0-9-]{36}$/.test(raw.dedupe_key)||buttons?.length||locationRequest!==undefined||String(raw.body.text).length>1024)throw new TrackingError(502,'invalid_taxi_url_button','El botón del viaje no es válido.');
    urlButton={title:b.title,url:b.url};
  }
  if(buttons?.length&&String(raw.body.text).length>1024)throw new TrackingError(502,'invalid_taxi_interactive_body','El mensaje con botones es demasiado largo.');
  if(locationRequest!==undefined&&(locationRequest!=='origin'&&locationRequest!=='destination'||Boolean(buttons?.length)||String(raw.body.text).length>1024))throw new TrackingError(502,'invalid_taxi_location_request','Solicitud de ubicación no válida.');
  return {id:String(raw.id),lease:String(raw.lease),tenantId:String(raw.tenant_id),waba:String(raw.waba),message:{to:String(raw.destination),text:String(raw.body.text),...(buttons?{buttons}:{}),...(urlButton?{urlButton}:{}),...(locationRequest==='origin'||locationRequest==='destination'?{locationRequest}:{})}};
}
/** externalId reconciles callbacks; it is not assumed to make provider sends idempotent. */
export async function sendTaxiMessage(out:TaxiOutgoing,key:string,fetcher:Fetcher=fetch):Promise<SendOutcome> {
  if(!key)return {state:'failed',code:'provider_not_configured'};
  const m=out.message;
  if(m.urlButton&&(m.locationRequest||m.buttons?.length||m.text.length>1024||m.urlButton.title!=='Ver mi viaje'||!/^https:\/\/stellar\.estrella-eats\.mx\/driver-trip#[a-f0-9]{64}$/.test(m.urlButton.url)))return {state:'failed',code:'invalid_taxi_url_button'};
  if(m.locationRequest&&(m.buttons?.length||m.text.length>1024))return {state:'failed',code:'invalid_taxi_location_request'};
  if(m.buttons?.length&&m.text.length>1024)return {state:'failed',code:'invalid_taxi_interactive_body'};
  const payload={from:out.waba,to:m.to,externalId:'taxi:'+out.id,...(m.urlButton?{type:'interactive',interactive:{type:'cta_url',body:{text:m.text},action:{name:'cta_url',parameters:{display_text:m.urlButton.title,url:m.urlButton.url}}}}:m.locationRequest?{type:'interactive',interactive:{type:'location_request_message',body:{text:m.text},action:{name:'send_location'}}}:m.buttons?.length?{type:'interactive',interactive:{type:'button',body:{text:m.text},action:{buttons:m.buttons.map((b)=>({type:'reply',reply:b}))}}}:{type:'text',text:{body:m.text}})};
  try{
    const response=await fetcher('https://api.ycloud.com/v2/whatsapp/messages',{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':key},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000),redirect:'error'});
    if(!response.ok){await response.body?.cancel();return {state:response.status>=400&&response.status<500?'failed':'uncertain',code:'provider_http_'+response.status};}
    const data=await readJson(response,16384);return record(data)&&text(data.id,256)?{state:'accepted',providerId:String(data.id)}:{state:'uncertain',code:'provider_missing_id'};
  }catch{return {state:'uncertain',code:'provider_result_unknown'};}
}
