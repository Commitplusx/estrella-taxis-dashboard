import {TaxiTurnTrace,safeErrorCode}from'./trace.ts';
import { fingerprint, TrackingError, uuid } from '../../tracking/contracts.ts';
import { json, mapLimit, type Fetcher } from '../../tracking/http.ts';
import type { TrackingStore } from '../../tracking/store.ts';
import { coord, phone, record, text, parseInbound, parseSession, parseStoredInbound, type TaxiChannel } from './contracts.ts';
import { coordinateTaxi, type TaxiServices } from './coordinator.ts';
import { parseOutgoing, sendTaxiMessage, verifyYCloud,type TaxiOutgoing } from './transport.ts';
import {parseDispatchClaims}from './dispatchContracts.ts';
export interface TaxiEngineConfig {webhookSecret:string;workerSecret:string;ycloudKey:string;now:()=>number}
export class TaxiEngine {
  private readonly store:TrackingStore;private readonly services:TaxiServices;private readonly config:TaxiEngineConfig;private readonly fetcher:Fetcher;
  constructor(store:TrackingStore,services:TaxiServices,config:TaxiEngineConfig,fetcher:Fetcher=fetch){this.store=store;this.services=services;this.config=config;this.fetcher=fetcher;}
  async channel(waba:string):Promise<TaxiChannel|null>{
    const rows=await this.store.read('taxi_bot_channels',new URLSearchParams({select:'*',waba:'eq.'+waba,limit:'2'}));
    if(!rows.length){
      const digits=waba.slice(1);
      const old=await this.store.read('empresas',new URLSearchParams({select:'id',tipo_negocio:'eq.taxi',telefono_whatsapp:`in.(${waba},${digits})`,limit:'2'}));
      if(old.length)throw new TrackingError(503,'taxi_channel_not_migrated','El canal de taxis requiere configuración revisada antes de activarse.');
      return null;
    }
    if(rows.length!==1||!record(rows[0]))throw new TrackingError(503,'taxi_channel_conflict','Canal de taxi no válido.');
    const c=rows[0];
    if(!text(c.tenant_id,40)||!phone(c.waba)||!text(c.name,120)||!text(c.city,200)||!coord(c.center_lat,c.center_lng)||typeof c.center_lng!=='number'||typeof c.enabled!=='boolean'||!text(c.model,120))throw new TrackingError(503,'invalid_taxi_channel','Completa la configuración del canal de taxis.');
    const radius=typeof c.radius_km==='number'?c.radius_km:typeof c.radius_km==='string'&&/^\d+(?:\.\d+)?$/.test(c.radius_km)?Number(c.radius_km):NaN;
    const cents=(v:unknown):number|null=>v===null?null:typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=1000000?v:NaN;
    const base=cents(c.base_cents),perKm=cents(c.per_km_cents);
    const pricingMode=c.pricing_mode;
    if(pricingMode!=='h3_zone_max'&&pricingMode!=='road_distance')throw new TrackingError(503,'taxi_pricing_not_configured','Falta configurar la regla de tarifa del canal.');
    if(!Number.isFinite(radius)||radius<=0||radius>100||(base!==null&&!Number.isFinite(base))||(perKm!==null&&!Number.isFinite(perKm))||!(c.dispatcher===null||phone(c.dispatcher)))throw new TrackingError(503,'invalid_taxi_channel','Zona o tarifa de taxis no válida.');
    return {tenantId:String(c.tenant_id),waba:String(c.waba),enabled:c.enabled,name:String(c.name),city:String(c.city),centerLat:c.center_lat,centerLng:c.center_lng,radiusKm:radius,dispatcher:c.dispatcher===null?null:String(c.dispatcher),model:String(c.model),baseCents:base,perKmCents:perKm,pricingMode};
  }
  private async permitted(c:TaxiChannel):Promise<void>{
    if(!c.enabled)throw new TrackingError(503,'taxi_channel_disabled','El canal de taxis todavía no está activado.');
    if(!this.config.ycloudKey||this.config.workerSecret.length<32)throw new TrackingError(503,'taxi_transport_not_configured','Falta completar el transporte privado del bot de taxis.');
    const rows=await this.store.read('empresas',new URLSearchParams({select:'id,activo,tipo_negocio,paquete:paquetes(activo,incluye_whatsapp)',id:'eq.'+c.tenantId,limit:'1'}));
    const e=rows[0],p=record(e)?e.paquete:null;
    if(!record(e)||e.activo!==true||e.tipo_negocio!=='taxi'||!record(p)||p.activo!==true||p.incluye_whatsapp!==true)throw new TrackingError(403,'taxi_plan_forbidden','La empresa no tiene el bot de taxis habilitado.');
  }
  async inbound(raw:string,signature:string|null):Promise<Response|null>{
    let payload:unknown;try{payload=JSON.parse(raw);}catch{throw new TrackingError(400,'invalid_json','JSON no válido.');}
    if(!record(payload))return null;
    const updated=payload.whatsappMessage;
    if(payload.type==='whatsapp.message.updated'&&record(updated)&&typeof updated.externalId==='string'&&updated.externalId.startsWith('taxi:')){
      if(!await verifyYCloud(raw,signature,this.config.webhookSecret,this.config.now()))throw new TrackingError(401,'taxi_signature_invalid','Firma de proveedor no válida.');
      const id=uuid(updated.externalId.slice(5)),from=phone(updated.from),to=phone(updated.to),provider=text(updated.id,256);
      const state=updated.status==='sent'?'accepted':updated.status;
      if(!from||!to||!provider||!['accepted','delivered','read','failed'].includes(String(state)))return json({received:true,updated:false});
      const changed=await this.store.rpc('taxi_bot_provider_status',{p_id:id,p_provider:provider,p_waba:from,p_to:to,p_status:state});
      return json({received:true,updated:changed===true});
    }
    const m=record(payload.whatsappInboundMessage)?payload.whatsappInboundMessage:null;
    const waba=m?phone(m.to):null;if(!waba)return null;
    const c=await this.channel(waba);if(!c)return null;
    if(!await verifyYCloud(raw,signature,this.config.webhookSecret,this.config.now()))throw new TrackingError(401,'taxi_signature_invalid','Firma de proveedor no válida.');
    await this.permitted(c);
    const message=parseInbound(payload,this.config.now());if(!message)throw new TrackingError(400,'invalid_taxi_event','Falta el mensaje de WhatsApp.');
    const result=await this.store.rpc('taxi_bot_enqueue',{p_tenant:c.tenantId,p_waba:c.waba,p_message:message,p_hash:await fingerprint(message),p_payload:payload});
    if(!record(result))throw new TrackingError(503,'taxi_queue_unknown','No se confirmó la recepción del mensaje.');
    return json({received:true,queued:result.ignored!==true,duplicate:result.duplicate===true});
  }
  async authorized(secret:string|null):Promise<boolean>{return this.config.workerSecret.length>=32&&secret!==null&&secret.length<=512&&await fingerprint(secret)===await fingerprint(this.config.workerSecret);}
  async process(eventId:string,signal?:AbortSignal):Promise<string>{
    const raw=await this.store.rpc('taxi_bot_begin',{p_event:uuid(eventId)});
    if(record(raw)&&raw.state==='debounce')return 'deferred';
    if(!record(raw))throw new TrackingError(503,'taxi_claim_unknown','No se confirmó el turno de la conversación.');
    if(raw.state==='blocked')return 'blocked';if(raw.state==='replay')return 'replay';if(raw.state==='busy'||raw.state==='limited')return 'deferred';
    if(raw.state!=='proceed'||!Array.isArray(raw.messages)||typeof raw.waba!=='string')throw new TrackingError(502,'invalid_taxi_claim','No se pudo recuperar el turno.');
    const c=await this.channel(raw.waba);if(!c||c.tenantId!==raw.tenantId)throw new TrackingError(403,'taxi_channel_changed','El canal ya no pertenece a esa empresa.');await this.permitted(c);
    const session=parseSession(raw.session),messages=raw.messages.map((m)=>parseStoredInbound(m,this.config.now()));
    if(messages.some((m)=>m.to!==c.waba||m.from!==messages[0]?.from))throw new TrackingError(502,'taxi_batch_scope','El lote contiene otra conversación.');
    const trace=new TaxiTurnTrace(session,this.config.now()),event=uuid(raw.eventId),lease=uuid(raw.lease);
    const started=await this.store.rpc('taxi_bot_trace_start',{p_event:event,p_lease:lease,p_revision:session.revision,p_meta:await trace.metadata(c)});
    if(started!==true)throw new TrackingError(503,'taxi_trace_unavailable','No se pudo registrar el inicio del turno.');
    try{
      const decision=await coordinateTaxi(messages,session,c,trace.services(this.services),this.config.now(),signal);
      const result=await this.store.rpc('taxi_bot_commit',{p_event:event,p_lease:lease,p_revision:session.revision,p_decision:{...decision,audit:trace.packet(decision)}});
      if(record(result)&&result.state==='superseded')return 'deferred';
      if(!record(result)||!['committed','replay'].includes(String(result.state)))throw new TrackingError(503,'taxi_commit_unknown','No se confirmó el resultado; no se repetirá la reserva a ciegas.');
      return 'committed';
    }catch(error:unknown){
      try{await this.store.rpc('taxi_bot_trace_fail',{p_event:event,p_lease:lease,p_code:safeErrorCode(error),p_packet:trace.packet()});}
      catch{console.error(JSON.stringify({event:'taxi_trace_failure_unrecorded',eventId:event,code:safeErrorCode(error)}));}
      throw error;
    }
  }
  async drain(tenant:string,waba:string):Promise<void>{
    const claimed=await this.store.rpc('taxi_bot_outbox_claim',{p_tenant:tenant,p_waba:waba});
    if(!Array.isArray(claimed)||claimed.length>10)throw new TrackingError(502,'invalid_taxi_send_claim','La tanda de mensajes no es válida.');
    await mapLimit(claimed,3,async(raw)=>{
      let out:TaxiOutgoing;
      try{out=parseOutgoing(raw);}catch(error:unknown){
        if(!record(raw)||raw.tenant_id!==tenant||raw.waba!==waba)throw new TrackingError(502,'taxi_outbox_scope','La salida no pertenece al canal.');
        const saved=await this.store.rpc('taxi_bot_outbox_complete',{p_id:uuid(raw.id),p_lease:uuid(raw.lease),p_state:'failed',p_provider:null,p_error:safeErrorCode(error)});
        console.error(JSON.stringify({event:'taxi_invalid_outbox_message',saved:saved===true,code:safeErrorCode(error)}));return;
      }
      if(out.tenantId!==tenant||out.waba!==waba)throw new TrackingError(502,'taxi_outbox_scope','La salida pertenece a otro canal.');
      const permitted=await this.store.rpc('taxi_bot_dispatch_send_check',{p_id:out.id,p_lease:out.lease});
      if(permitted==='paused'||permitted==='stale')return;
      if(permitted!=='ready'&&permitted!=='denied')throw new TrackingError(502,'taxi_access_unknown','No se pudo comprobar el permiso del destinatario.');
      // Re-read the channel after the SQL send check so an emergency pause is
      // observed as close as possible to the provider handoff. Fail closed if
      // the channel was paused, moved, or removed while this message was leased.
      const currentChannel=permitted==='ready'?await this.channel(waba):null;
      const sendAllowed=permitted==='ready'&&currentChannel?.tenantId===tenant&&currentChannel.enabled;
      const result=sendAllowed?await sendTaxiMessage(out,this.config.ycloudKey,this.fetcher):{state:'failed' as const,code:permitted!=='ready'?'outbox_no_longer_permitted':currentChannel?.tenantId!==tenant?'taxi_channel_scope_changed':'taxi_channel_disabled'};
      const saved=await this.store.rpc('taxi_bot_outbox_complete',{p_id:out.id,p_lease:out.lease,p_state:result.state,p_provider:result.state==='accepted'?result.providerId:null,p_error:result.state==='accepted'?null:result.code});
      // A verified callback can win this race. No resend is attempted on a lost write response.
      if(saved!==true)console.warn(JSON.stringify({event:'taxi_send_result_unconfirmed',outbox:out.id}));
    });
  }
  async dispatch(signal?:AbortSignal):Promise<number>{
    const claims=parseDispatchClaims(await this.store.rpc('taxi_bot_dispatch_claim',{}));let failed=0;
    await mapLimit(claims,2,async claim=>{
      let candidates:Awaited<ReturnType<TaxiServices['candidates']>>=[],error:string|null=null;
      const deadline=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(20000)]);
      try{
        const channel=await this.channel(claim.waba);
        if(!channel||channel.tenantId!==claim.tenantId||!channel.enabled)error='channel_unavailable';
        else{await this.permitted(channel);candidates=await this.services.candidates(claim.origin,channel,deadline,claim.excluded);}
      }catch{error='fleet_unavailable';}
      try{
        const result=await this.store.rpc('taxi_bot_dispatch_complete',{p_trip:claim.tripId,p_lease:claim.lease,p_candidates:candidates,p_error:error});
        if(!record(result)||!['stale','done','paused','offered','waiting','attention'].includes(String(result.state)))throw Error('invalid_dispatch_result');
        console.info(JSON.stringify({event:'taxi_dispatch_round',state:result.state,offers:result.offers??0,round:result.round??null}));
      }catch{failed++;console.error(JSON.stringify({event:'taxi_dispatch_result_unconfirmed',code:'dispatch_commit_unavailable'}));}
    });return failed;
  }
  async tick(signal?:AbortSignal):Promise<{processed:number;deferred:number;failed:number}>{
    await this.store.rpc('taxi_bot_maintain',{});
    const pending=await this.store.rpc('taxi_bot_pending',{});
    if(!Array.isArray(pending)||pending.length>10)throw new TrackingError(502,'invalid_taxi_pending','Lista de tareas no válida.');
    const selected=pending.slice(0,2);let processed=0,deferred=0,failed=0;
    await mapLimit(selected,2,async(e)=>{
      if(!record(e)||typeof e.id!=='string')throw new TrackingError(502,'invalid_taxi_pending','Evento pendiente no válido.');
      try{const result=await this.process(e.id,signal);if(result==='deferred')deferred++;else processed++;}
      catch(error:unknown){failed++;console.error(JSON.stringify({event:'taxi_turn_failed',eventId:e.id,code:error instanceof TrackingError?error.code:'unexpected'}));}
    });
    try{failed+=await this.dispatch(signal);}catch{failed++;console.error(JSON.stringify({event:'taxi_dispatch_claim_failed',code:'dispatch_queue_unavailable'}));}
    const outgoing=await this.store.read('taxi_bot_outbox',new URLSearchParams({select:'tenant_id,waba',state:'in.(pending,sending)',order:'created_at.asc',limit:'100'}));
    const channels=new Map<string,{tenant:string;waba:string}>();for(const o of outgoing){if(!record(o)||typeof o.tenant_id!=='string'||typeof o.waba!=='string')throw new TrackingError(502,'invalid_taxi_pending','Canal pendiente no válido.');channels.set(o.tenant_id+o.waba,{tenant:o.tenant_id,waba:o.waba});}
    await mapLimit([...channels.values()].slice(0,2),2,async(c)=>{
      try{const config=await this.channel(c.waba);if(!config||config.tenantId!==c.tenant)throw new TrackingError(403,'taxi_channel_changed','El canal cambió de empresa.');await this.permitted(config);await this.drain(c.tenant,c.waba);}
      catch(error:unknown){failed++;console.error(JSON.stringify({event:'taxi_outbox_drain_failed',code:error instanceof TrackingError?error.code:'unexpected'}));}
    });return {processed,deferred,failed};
  }
  async worker(payload:unknown,secret:string|null,signal?:AbortSignal):Promise<Response|null>{
    if(!record(payload))return null;
    const tick=payload.action==='taxi_tick';
    const envelope=record(payload.record)?payload.record:payload;
    const queueId=typeof envelope.id==='string'&&/^[0-9a-f-]{36}$/i.test(envelope.id)?envelope.id:null;
    const rows=queueId?await this.store.rpc('taxi_bot_event_for_queue',{p_queue:queueId}):[];
    const records=Array.isArray(rows)?rows:[];
    if(!tick&&!records.length){
      const raw=record(envelope.payload)?envelope.payload:envelope,m=record(raw.whatsappInboundMessage)?raw.whatsappInboundMessage:null,to=m?phone(m.to):null;
      if(to&&await this.channel(to))throw new TrackingError(409,'taxi_requires_durable_event','El canal de taxis requiere un evento guardado por el webhook verificado.');return null;
    }
    if(!await this.authorized(secret))throw new TrackingError(401,'taxi_worker_unauthorized','Consumo de cola no autorizado.');
    if(tick)return json(await this.tick(signal));
    if(records.length!==1||!record(records[0])||typeof records[0].id!=='string')throw new TrackingError(502,'invalid_taxi_queue','Evento de cola no válido.');
    const result=await this.process(records[0].id,signal);return json({processed:result!=='deferred',state:result},result==='deferred'?202:200);
  }
}
