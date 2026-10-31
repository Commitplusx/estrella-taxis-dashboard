import {record,TrackingError,uuid}from '../_shared/tracking/contracts.ts';
import type {TrackingStore}from '../_shared/tracking/store.ts';
import {exact,revision}from '../_shared/bot/taxis/adminContracts.ts';
import {parseDispatchStatus,type DispatchStatus}from '../_shared/bot/taxis/dispatchContracts.ts';
export async function dispatchRequest(raw:Record<string,unknown>,tenant:string,waba:string,actor:number,configure:boolean,store:TrackingStore):Promise<DispatchStatus>{
 if(raw.action==='dispatch_status')exact(raw,['action','tenantId','waba']);
 else if(raw.action==='dispatch_resume'){
  exact(raw,['action','tenantId','waba','requestId','revision']);
  if(!configure)throw new TrackingError(403,'dispatch_control_forbidden','Sólo la administración de la base puede reanudar los avisos.');
  const result=await store.rpc('taxi_bot_dispatch_resume',{p_tenant:tenant,p_waba:waba,p_actor:actor,p_request:uuid(raw.requestId),p_revision:revision(raw.revision)});
  if(!record(result)||result.state!=='resumed')throw new TrackingError(409,'dispatch_control_changed','No se confirmó la reanudación. Actualiza el estado antes de continuar.');
 }else throw new TrackingError(400,'invalid_dispatch_action','Esa operación de asignación no está disponible.');
 return parseDispatchStatus(await store.rpc('taxi_bot_dispatch_status',{p_tenant:tenant,p_waba:waba}));
}
