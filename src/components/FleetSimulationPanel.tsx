import{useEffect,useState}from'react';
import{taxiAdminClient}from'../lib/taxiAdminClient';
import TaxiSimulationPanel from'./TaxiSimulationPanel';
import type{SimulationMapTool}from'./TaxiSimulationMap';
import type{SimulationPoint,TaxiSimulationResult}from'../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/simulationContracts.ts';
import type{AdminChannel}from'../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/adminContracts.ts';
import '../pages/taxiBotAdmin.css';
export default function FleetSimulationPanel({tenantId,point,onTool,onResult}:{tenantId:string|null;point:SimulationPoint|null;onTool:(tool:SimulationMapTool)=>void;onResult:(result:TaxiSimulationResult|null)=>void}){
 const[channels,setChannels]=useState<AdminChannel[]|null>(null),[selected,setSelected]=useState(''),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{const controller=new AbortController();setChannels(null);setError('');
  void taxiAdminClient.context(controller.signal).then(context=>{if(controller.signal.aborted)return;if(!context.canConfigure)throw Error('Tu cuenta no tiene permiso para simular la asignación de toda la base.');const list=context.channels.filter(c=>tenantId===null||c.tenantId===tenantId);setChannels(list);setSelected(list.length===1?list[0].tenantId+'|'+list[0].waba:'');}).catch((e:unknown)=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'No pudimos consultar la base. Intenta de nuevo.');});
  return()=>controller.abort();
 },[tenantId,retry]);
 const channel=channels?.find(c=>c.tenantId+'|'+c.waba===selected);
 return <>{error?<div className="taxi-error" role="alert"><p>{error}</p><button type="button" className="taxi-secondary" onClick={()=>setRetry(n=>n+1)}>Reintentar</button></div>:channels===null?<p role="status">Comprobando la base y sus permisos…</p>:channels.length===0?<p>No hay un canal de taxis configurado en esta base.</p>:<>
  {channels.length>1&&<label className="taxi-sim-control">Base y canal<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Selecciona la base</option>{channels.map(c=><option key={c.tenantId+'|'+c.waba} value={c.tenantId+'|'+c.waba}>{c.name}</option>)}</select></label>}
  {channel&&<TaxiSimulationPanel key={selected} channel={channel} externalMap={{point,onTool,onResult}}/>}
 </>}</>;
}
