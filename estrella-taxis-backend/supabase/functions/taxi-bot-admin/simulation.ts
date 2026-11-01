import type {FleetApi,FleetIdentity,FleetDevice} from '../_shared/tracking/auth.ts';
import type {TrackingStore} from '../_shared/tracking/store.ts';
import type {GpsRefreshConfig} from '../_shared/bot/taxis/gpsRefresh.ts';
import type {Fetcher} from '../_shared/tracking/http.ts';
import type {AdminChannel} from '../_shared/bot/taxis/adminContracts.ts';
import {claimOperation,finishOperation} from '../_shared/tracking/store.ts';
import {exact} from '../_shared/bot/taxis/adminContracts.ts';
import {fingerprint,positiveId,record,TrackingError,uuid} from '../_shared/tracking/contracts.ts';
import {parseSimulationInput,parseSimulationResult,type TaxiSimulationResult} from '../_shared/bot/taxis/simulationContracts.ts';
import {evaluateSimulation,parseSimulationFleet} from '../_shared/bot/taxis/simulation.ts';
import {taxiH3Scope} from '../_shared/bot/taxis/h3.ts';
import {combineTaxiPositions,mobileTaxiPositions,refreshDispatchSources} from '../_shared/bot/taxis/mobilePositions.ts';
export async function simulationRequest(raw:Record<string,unknown>,channel:AdminChannel,identity:FleetIdentity,canConfigure:boolean,planEnabled:boolean,fleet:FleetApi,store:TrackingStore,refresh:GpsRefreshConfig|undefined,fetcher:Fetcher,signal:AbortSignal):Promise<TaxiSimulationResult>{
 if(!canConfigure)throw new TrackingError(403,'simulation_forbidden','Las pruebas de toda la flota están disponibles para la administración de la base.');
 exact(raw,['action','tenantId','waba','requestId','origin','destination','overrides']);const input=parseSimulationInput(raw),requestId=uuid(raw.requestId);
 if(raw.tenantId!==channel.tenantId||raw.waba!==channel.waba)throw new TrackingError(403,'simulation_scope_invalid','La prueba debe corresponder a la base y al canal seleccionados.');
 if(!refresh)throw new TrackingError(503,'simulation_not_configured','Falta habilitar la actualización privada de GPS para el simulador.');
 const command={tenantId:channel.tenantId,waba:channel.waba,...input};
 const claim=await claimOperation(store,identity.userId,requestId,'simulation',await fingerprint(command));
 if(claim.replay!==null){
  if(claim.status!==200)throw new TrackingError(claim.status,'simulation_previous_failure','Esta prueba no se completó. Inicia una simulación nueva.');
  const cached=parseSimulationResult(claim.replay),facts=parseSimulationFleet(await store.rpc('taxi_bot_simulation_fleet',{p_tenant:channel.tenantId,p_waba:channel.waba})),currentDevices=await fleet.get('/devices',identity.cookie,signal);
  if(!Array.isArray(currentDevices)||currentDevices.length>10000)throw new TrackingError(502,'simulation_gps_invalid','No pudimos comprobar el acceso actual a las unidades.');
  if(cached.source!=='live')throw new TrackingError(502,'simulation_result_invalid','El resultado guardado no corresponde a una prueba con GPS reales.');
  const known=new Set(facts.units.map(u=>u.deviceId)),visible=new Set(currentDevices.flatMap(d=>record(d)&&positiveId(d.id)?[d.id]:[]));
  if(cached.baseline.units.some(u=>!known.has(u.deviceId)||u.point!==null&&!visible.has(u.deviceId)))throw new TrackingError(409,'simulation_scope_changed','Cambió el acceso a las unidades. Inicia una prueba nueva.');
  return cached;
 }
 let result:TaxiSimulationResult;
 try{
  const mobile=await mobileTaxiPositions(store,channel.tenantId),mobileOnly=await refreshDispatchSources(fetcher,refresh,mobile,signal);
  const [facts,deviceRows,positionRows]=await Promise.all([store.rpc('taxi_bot_simulation_fleet',{p_tenant:channel.tenantId,p_waba:channel.waba}),fleet.get('/devices',identity.cookie,signal),fleet.get('/positions',identity.cookie,signal)]);
  const snapshot=parseSimulationFleet(facts),known=new Set(snapshot.units.map(u=>u.deviceId));
  if(!Array.isArray(deviceRows)||deviceRows.length>10000||!Array.isArray(positionRows)||positionRows.length>10000)throw new TrackingError(502,'simulation_gps_invalid','No pudimos comprobar la flota GPS. Actualiza e intenta de nuevo.');
  const devices:FleetDevice[]=[];
  for(const d of deviceRows){if(!record(d)||!positiveId(d.id)||!known.has(d.id))continue;if(typeof d.name!=='string'||!d.name.trim())throw new TrackingError(502,'simulation_gps_invalid','Una unidad GPS no tiene nombre.');devices.push({id:d.id,name:d.name.slice(0,120),status:d.status==='online'?'online':d.status==='offline'?'offline':'unknown'});}
  if(new Set(devices.map(d=>d.id)).size!==devices.length)throw new TrackingError(502,'simulation_gps_invalid','La flota GPS contiene unidades repetidas.');
  const now=Date.now(),positions=combineTaxiPositions(positionRows,mobile,now,mobileOnly);
  result=evaluateSimulation(input,snapshot,devices,positions,channel.radiusKm,now,planEnabled);
  if(channel.pricingMode==='h3_zone_max'){
   const cells=taxiH3Scope({...input.origin,text:'Punto de prueba',placeId:null},{...(input.destination??input.origin),text:'Punto de prueba',placeId:null});
   const quote=await store.rpc('taxi_bot_h3_quote',{p_tenant:channel.tenantId,p_waba:channel.waba,p_origin:cells.originCell,p_destination:cells.destinationCell});
   if(!record(quote)||!['priced','uncovered','invalid_zone','channel_unavailable'].includes(String(quote.state)))throw new TrackingError(502,'simulation_quote_invalid','No pudimos comprobar la tarifa de este recorrido.');
   if(quote.state==='priced'&&(quote.mode!=='h3_zone_max'||quote.originCell!==cells.originCell||quote.destinationCell!==cells.destinationCell||typeof quote.cents!=='number'||!Number.isSafeInteger(quote.cents)||quote.cents<1))throw new TrackingError(502,'simulation_quote_invalid','La tarifa no corresponde a los puntos de esta prueba.');
   result.pricing=quote.state==='priced'?{state:'priced',cents:typeof quote.cents==='number'?quote.cents:null}:{state:quote.state==='channel_unavailable'?'unavailable':'uncovered',cents:null};
  }
  result=parseSimulationResult(result);
 }catch(error:unknown){const typed=error instanceof TrackingError?error:new TrackingError(503,'simulation_failed','No pudimos completar la prueba. Actualiza los GPS e intenta una simulación nueva.');await finishOperation(store,identity.userId,requestId,claim.lease,{error:typed.message,code:typed.code},typed.status);throw typed;}
 await finishOperation(store,identity.userId,requestId,claim.lease,result,200);return result;
}
