import {useEffect,useRef,useState}from 'react';
import {AlertCircle,ArrowRight,RefreshCw,Radio,ShieldAlert}from 'lucide-react';
import {taxiDispatchClient}from '../lib/taxiDispatchClient';
import {TrackingClientError}from '../lib/trackingClient';
import type {DispatchStatus}from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/dispatchContracts.ts';
const issueLabels:Record<string,string>={round_limit:'Terminaron las tres rondas sin aceptación.',customer_choice:'El cliente puede seguir esperando o cancelar desde WhatsApp.',customer_continued:'El cliente eligió seguir buscando otras unidades.',search_exhausted:'Terminó la ampliación de búsqueda. La base debe revisar la solicitud.',deadline_limit:'Terminó el tiempo de búsqueda.',scan_limit:'No encontró una unidad disponible dentro del límite de búsqueda.',fleet_unavailable:'No pudo consultar las ubicaciones de los taxis.',channel_unavailable:'La conexión de la base necesita revisión.',no_candidates:'Espera para volver a consultar unidades disponibles.',provider_paused:'Los avisos están pausados por un problema de conexión.'};
function previewStatus():DispatchStatus{
 const now=new Date().toISOString();return{asOf:now,health:{paused:true,failures:3,code:'provider_http_401',pausedUntil:null,revision:2},jobs:[{tripId:'11111111-1111-4111-8111-111111111110',name:'Pasajero de ejemplo',customer:'+529630000010',state:'attention',round:3,scans:3,code:'customer_choice',nextAt:now,deadlineAt:now,updatedAt:now},{tripId:'11111111-1111-4111-8111-111111111120',name:'Otro pasajero de ejemplo',customer:'+529630000020',state:'waiting',round:2,scans:3,code:null,nextAt:now,deadlineAt:new Date(Date.now()+600000).toISOString(),updatedAt:now}]};
}
export default function TaxiDispatchPanel({tenantId,waba,canConfigure,preview=false,onSelect}:{tenantId:string;waba:string;canConfigure:boolean;preview?:boolean;onSelect:(customer:string)=>void}){
 const scope=tenantId+'|'+waba;
 const [snapshot,setSnapshot]=useState<{scope:string;data:DispatchStatus}|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0),[saving,setSaving]=useState(false);
 const currentScope=useRef(scope),operation=useRef<{scope:string;request:string;revision:number}|null>(null);
 const data=snapshot?.scope===scope?snapshot.data:null;
 useEffect(()=>{currentScope.current=scope;operation.current=null;setError('');setSaving(false);},[scope]);
 useEffect(()=>{
  const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const poll=async()=>{
   if(document.hidden){timer=setTimeout(()=>{void poll();},15000);return;}
   try{
    const result=preview?previewStatus():await taxiDispatchClient.status(tenantId,waba,AbortSignal.any([abort.signal,AbortSignal.timeout(15000)]));
    if(abort.signal.aborted)return;
    setSnapshot(previous=>previous?.scope===scope&&Date.parse(previous.data.asOf)>Date.parse(result.asOf)?previous:{scope,data:result});setError('');
    if(!preview)timer=setTimeout(()=>{void poll();},15000);
   }catch(e:unknown){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'No pudimos consultar la asignación. Usa Actualizar para intentarlo de nuevo.');}
  };
  void poll();return()=>{abort.abort();if(timer)clearTimeout(timer);};
 },[scope,tenantId,waba,reload,preview]);
 const resume=async()=>{
  if(!data||saving||!canConfigure||preview)return;
  const command=operation.current??{scope,request:crypto.randomUUID(),revision:data.health.revision};operation.current=command;setSaving(true);setError('');
  try{
   const result=await taxiDispatchClient.resume(tenantId,waba,command.request,command.revision,AbortSignal.timeout(15000));
   if(currentScope.current===scope){setSnapshot({scope,data:result});operation.current=null;setReload(value=>value+1);}
  }catch(e:unknown){if(currentScope.current===scope){
   if(e instanceof TrackingClientError&&e.code==='dispatch_control_changed')operation.current=null;
   setError(e instanceof Error?e.message:'No se confirmó la reanudación. Comprueba la misma solicitud.');
  }}
  finally{if(currentScope.current===scope)setSaving(false);}
 };
 return <section className="taxi-dispatch" aria-labelledby="taxi-dispatch-title">
  <header className="taxi-dispatch-header"><div><h2 id="taxi-dispatch-title"><Radio size={21} aria-hidden="true"/>Asignación de viajes</h2><p>Tres rondas de hasta tres taxis, con tres minutos para aceptar en cada ronda.</p></div><button type="button" className="taxi-secondary" disabled={saving} onClick={()=>setReload(value=>value+1)}><RefreshCw size={17} aria-hidden="true"/>Actualizar</button></header>
  {preview&&<p className="taxi-dispatch-caption">Vista de diseño con solicitudes de ejemplo.</p>}
  {error&&<p className="taxi-dispatch-error" role="alert"><AlertCircle size={19} aria-hidden="true"/>{error}</p>}
  {!data&&!error&&<p role="status">Consultando las búsquedas y el estado de los avisos…</p>}
  {data&&<>
   {data.health.paused?<div className="taxi-dispatch-warning" role="status"><ShieldAlert size={23} aria-hidden="true"/><div><h3>Avisos de WhatsApp en pausa</h3><p>{data.health.failures>=3?'Se repitió el fallo de conexión. La administración debe revisarla antes de reanudar.':'Detectamos un fallo de conexión. Los avisos pendientes esperarán antes de otro intento.'} Las solicitudes siguen guardadas.</p>{canConfigure&&<button type="button" className="taxi-secondary" disabled={saving||preview} onClick={()=>{void resume();}}>{saving?'Comprobando…':operation.current?'Comprobar reanudación':'Reanudar avisos'}</button>}<small>Reanuda después de corregir la conexión con YCloud. Los envíos de resultado incierto no se repiten.</small></div></div>:<p className="taxi-dispatch-caption">Avisos habilitados. La aceptación del proveedor y la entrega al conductor se comprueban por separado.</p>}
   {!data.jobs.length?<p className="taxi-dispatch-empty">No hay solicitudes pendientes de asignación en esta consulta.</p>:<ul className="taxi-dispatch-list">{data.jobs.map(job=>{
    const attention=job.state==='attention'||Date.parse(job.deadlineAt)<=Date.parse(data.asOf);
    return <li key={job.tripId}><div><strong>{job.name}</strong><p>{job.customer}</p><span className={attention?'taxi-dispatch-state needs-attention':'taxi-dispatch-state'}>{job.code==='customer_choice'?'Esperando al cliente':attention?'Requiere atención de la base':job.round?`Ronda ${job.round} de 3`:'Buscando unidades disponibles'}</span><p>{job.code?issueLabels[job.code]??'La base debe revisar esta búsqueda.':data.health.paused?'Espera a que se reanuden los avisos.':'Aún no hay una unidad confirmada.'}</p></div><button type="button" className="taxi-secondary" onClick={()=>onSelect(job.customer)}>Ver conversación<ArrowRight size={17} aria-hidden="true"/></button></li>;
   })}</ul>}
   <p className="taxi-dispatch-caption">Consulta de hasta 50 solicitudes · Estado del servidor al {new Date(data.asOf).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}.</p>
  </>}
 </section>;
}
