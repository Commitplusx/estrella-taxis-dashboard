import type { TrackingStore } from '../_shared/tracking/store.ts';
import { record, TrackingError, uuid } from '../_shared/tracking/contracts.ts';
import type { Fetcher } from '../_shared/tracking/http.ts';
import { exact } from '../_shared/bot/taxis/adminContracts.ts';
import { parseNeighborhood, parseNeighborhoods } from '../_shared/bot/taxis/neighborhoodContracts.ts';
import { exactNeighborhoods, semanticNeighborhoods } from '../_shared/bot/taxis/neighborhoods.ts';
export async function neighborhoodRequest(raw:Record<string,unknown>,tenant:string,actor:number,canEdit:boolean,store:TrackingStore,model:string,key:string,fetcher:Fetcher,signal:AbortSignal):Promise<unknown>{
 if(raw.action==='neighborhoods'){
  exact(raw,['action','tenantId','waba']);return {neighborhoods:parseNeighborhoods(await store.rpc('taxi_bot_neighborhood_read',{p_tenant:tenant}))};
 }
 if(raw.action==='neighborhood_search'){
  exact(raw,['action','tenantId','waba','query']);
  if(typeof raw.query!=='string'||raw.query.trim().length<2||raw.query.length>300)throw new TrackingError(400,'invalid_neighborhood_search','Escribe el nombre de la colonia o una referencia.');
  const rows=parseNeighborhoods(await store.rpc('taxi_bot_neighborhood_read',{p_tenant:tenant})),matches=exactNeighborhoods(raw.query,rows);
  if(matches.length)return {neighborhoods:matches,method:'name'};
  if(!key)throw new TrackingError(503,'neighborhood_search_not_configured','La búsqueda por significado todavía no está configurada. Puedes buscar por nombre.');
  return {neighborhoods:await semanticNeighborhoods(raw.query,rows,fetcher,key,model,signal),method:'semantic'};
 }
 exact(raw,['action','tenantId','waba','requestId','label','expected','payload']);
 if(!canEdit)throw new TrackingError(403,'configure_forbidden','Sólo la administración puede cambiar colonias y tarifas.');
 if(typeof raw.label!=='string'||!raw.label.trim()||raw.label.length>100||typeof raw.expected!=='string'||!/^[a-f0-9]{32}$/.test(raw.expected)||!record(raw.payload))throw new TrackingError(400,'invalid_neighborhood','Actualiza la colonia antes de editarla.');
 const p=raw.payload;exact(p,['label','aliases','description','cents']);
 if(typeof p.label!=='string'||!p.label.trim()||p.label.length>100||typeof p.description!=='string'||p.description.length>500||!Array.isArray(p.aliases)||p.aliases.length>12||!p.aliases.every(a=>typeof a==='string'&&a.trim().length>0&&a.length<=100)||typeof p.cents!=='number'||!Number.isSafeInteger(p.cents)||p.cents<1||p.cents>10000000)throw new TrackingError(400,'invalid_neighborhood','Revisa el nombre, los nombres alternativos y el precio de la colonia.');
 const result=await store.rpc('taxi_bot_neighborhood_apply',{p_tenant:tenant,p_actor:actor,p_request:uuid(raw.requestId),p_label:raw.label,p_expected:raw.expected,p_payload:{label:p.label.trim(),aliases:p.aliases.map(a=>String(a).trim()),description:p.description.trim(),cents:p.cents}});
 if(!record(result)||typeof result.state!=='string')throw new TrackingError(503,'neighborhood_result_uncertain','No se confirmó el guardado. Comprueba la misma solicitud.');
 const errors:Record<string,string>={revision_conflict:'La colonia cambió. Cierra y actualiza la lista antes de editar.',not_found:'La colonia ya no existe. Actualiza la lista.',name_conflict:'Ya existe una colonia con ese nombre.',alias_conflict:'Ese nombre alternativo ya identifica otra colonia.',request_conflict:'Esta solicitud ya se usó con otros datos. Actualiza la lista.'};
 if(result.state!=='saved')throw new TrackingError(409,result.state,errors[result.state]??'No se confirmó el cambio de colonia.');
 const row=parseNeighborhood(result.neighborhood);
 if(row.label!==p.label.trim()||row.cents!==p.cents||row.description!==p.description.trim()||JSON.stringify(row.aliases)!==JSON.stringify(p.aliases.map(a=>String(a).trim())))throw new TrackingError(503,'neighborhood_result_uncertain','No se confirmaron los mismos datos. Comprueba la solicitud antes de repetir.');
 return {state:'saved',neighborhood:row};
}
