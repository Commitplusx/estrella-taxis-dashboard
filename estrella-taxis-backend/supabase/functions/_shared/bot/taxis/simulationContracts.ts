import {coord,record} from './contracts.ts';
import {positiveId,TrackingError} from '../../tracking/contracts.ts';
import type {TaxiSelectionReason} from '../../algorithms/headingMatcher.ts';
export interface SimulationPoint {lat:number;lng:number}
export type SimulatedAvailability='free'|'occupied'|'unknown';
export interface TaxiSimulationChange {
 deviceId:number;availability?:SimulatedAvailability;eligible?:boolean;point?:SimulationPoint;speedKmh?:number;course?:number;gpsAgeSeconds?:number;stationarySeconds?:number;status?:'online'|'offline'|'unknown';
}
export interface TaxiSimulationInput {origin:SimulationPoint;destination:SimulationPoint|null;overrides:TaxiSimulationChange[]}
export type SimulationReason=TaxiSelectionReason|'no_gps'|'not_in_turn'|'no_whatsapp'|'active_trip'|'channel_disabled'|'channel_paused'|'not_available'|'no_tracking_access'|'plan_disabled';
export const simulationReasonLabels:Record<SimulationReason,string>={selected:'Recibiría oferta',ranked:'Elegible, sin oferta inicial',invalid_gps:'GPS sin posición válida',outside_radius:'Fuera del radio de búsqueda',stale_gps:'GPS con más de 30 minutos',idle_timeout:'Detenido más de 30 minutos',future_gps:'Hora del GPS adelantada',outdated_gps:'Traccar marca la posición atrasada',ignition_off:'Motor apagado',occupied:'Switch ocupado',occupancy_unknown:'Sin señal de libre confirmada',offline:'Sin conexión GPS utilizable',no_gps:'Sin posición GPS',not_in_turn:'Sin conductor activo en turno',no_whatsapp:'Sin WhatsApp válido',active_trip:'Tiene un viaje en curso',channel_disabled:'Canal apagado',channel_paused:'Envíos pausados',not_available:'No habilitada para ofertas',no_tracking_access:'GPS no visible para tu cuenta',plan_disabled:'El plan no permite atender viajes'};
export interface TaxiSimulationUnit {
 deviceId:number;name:string;point:SimulationPoint|null;availability:SimulatedAvailability;eligible:boolean;status:'online'|'offline'|'unknown';gpsAgeSeconds:number|null;stationarySeconds?:number|null;speedKmh:number|null;course:number|null;changed:boolean;
 reason:SimulationReason;rank:number|null;distanceKm:number|null;penaltyKm:number|null;effectiveDistanceKm:number|null;
}
export interface TaxiSimulationRun {units:TaxiSimulationUnit[];rounds:number[][]}
export interface TaxiSimulationResult {
 asOf:string;algorithm:'heading-matcher-v1';radiusKm:number;origin:SimulationPoint;destination:SimulationPoint|null;baseline:TaxiSimulationRun;scenario:TaxiSimulationRun;
 pricing:{state:'priced'|'uncovered'|'unavailable'|'not_simulated';cents:number|null};source:'live'|'example';
}
const invalid=()=>new TrackingError(400,'invalid_simulation','Revisa las coordenadas y los cambios del escenario.');
function keys(value:Record<string,unknown>,allowed:readonly string[]):void{if(Object.keys(value).some(k=>!allowed.includes(k)))throw invalid();}
export function simulationPoint(value:unknown):SimulationPoint{
 if(!record(value)||!coord(value.lat,value.lng)||typeof value.lng!=='number')throw invalid();keys(value,['lat','lng']);return{lat:value.lat,lng:value.lng};
}
function bounded(value:unknown,min:number,max:number):value is number{return typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;}
export function parseSimulationChange(value:unknown):TaxiSimulationChange{
 if(!record(value)||!positiveId(value.deviceId))throw invalid();
 keys(value,['deviceId','availability','eligible','point','speedKmh','course','gpsAgeSeconds','stationarySeconds','status']);
 if(value.stationarySeconds!==undefined&&(!bounded(value.stationarySeconds,0,604800)||typeof value.speedKmh==='number'&&value.speedKmh>3))throw invalid();
 if(value.availability!==undefined&&!['free','occupied','unknown'].includes(String(value.availability))||value.eligible!==undefined&&typeof value.eligible!=='boolean'||value.speedKmh!==undefined&&!bounded(value.speedKmh,0,180)||value.course!==undefined&&!bounded(value.course,0,359.999)||value.gpsAgeSeconds!==undefined&&!bounded(value.gpsAgeSeconds,-120,86400)||value.status!==undefined&&!['online','offline','unknown'].includes(String(value.status)))throw invalid();
 return{deviceId:value.deviceId,...(value.availability==='free'||value.availability==='occupied'||value.availability==='unknown'?{availability:value.availability}:{}),...(typeof value.eligible==='boolean'?{eligible:value.eligible}:{}),...(value.point!==undefined?{point:simulationPoint(value.point)}:{}),...(typeof value.speedKmh==='number'?{speedKmh:value.speedKmh}:{}),...(typeof value.course==='number'?{course:value.course}:{}),...(typeof value.gpsAgeSeconds==='number'?{gpsAgeSeconds:value.gpsAgeSeconds}:{}),...(typeof value.stationarySeconds==='number'?{stationarySeconds:value.stationarySeconds}:{}),...(value.status==='online'||value.status==='offline'||value.status==='unknown'?{status:value.status}:{})};
}
export function parseSimulationInput(raw:Record<string,unknown>):TaxiSimulationInput{
 if(!Array.isArray(raw.overrides)||raw.overrides.length>200)throw invalid();const overrides=raw.overrides.map(parseSimulationChange);
 if(new Set(overrides.map(o=>o.deviceId)).size!==overrides.length)throw invalid();
 return{origin:simulationPoint(raw.origin),destination:raw.destination===null?null:simulationPoint(raw.destination),overrides};
}
function parseRun(value:unknown):TaxiSimulationRun{
 if(!record(value)||!Array.isArray(value.units)||value.units.length>200||!Array.isArray(value.rounds)||value.rounds.length>4)throw invalid();
 const units=value.units.map((v:unknown):TaxiSimulationUnit=>{
  if(!record(v)||!positiveId(v.deviceId)||typeof v.name!=='string'||!v.name.trim()||v.name.length>120||typeof v.eligible!=='boolean'||typeof v.changed!=='boolean'||!['free','occupied','unknown'].includes(String(v.availability))||!['online','offline','unknown'].includes(String(v.status))||typeof v.reason!=='string'||!Object.hasOwn(simulationReasonLabels,v.reason))throw invalid();
  const numeric=(key:string,min:number,max:number):number|null=>{const n=v[key];if(n===null)return null;if(!bounded(n,min,max))throw invalid();return n;};
  const reason=v.reason as SimulationReason;
  if(v.availability!=='free'&&v.availability!=='occupied'&&v.availability!=='unknown'||v.status!=='online'&&v.status!=='offline'&&v.status!=='unknown')throw invalid();
  const rank=numeric('rank',1,200);if(rank!==null&&!Number.isSafeInteger(rank)||['selected','ranked'].includes(reason)!==(rank!==null)||reason==='selected'&&rank!==null&&rank>3)throw invalid();
  return{deviceId:v.deviceId,name:v.name,point:v.point===null?null:simulationPoint(v.point),availability:v.availability,status:v.status,eligible:v.eligible,changed:v.changed,reason,rank,distanceKm:numeric('distanceKm',0,40000),penaltyKm:numeric('penaltyKm',0,3),effectiveDistanceKm:numeric('effectiveDistanceKm',0,40003),gpsAgeSeconds:numeric('gpsAgeSeconds',-10000000000000,10000000000000),...(v.stationarySeconds!==undefined?{stationarySeconds:numeric('stationarySeconds',0,10000000000000)}:{}),speedKmh:numeric('speedKmh',0,1000),course:numeric('course',0,359.999)};
 });
 const known=new Map(units.map(u=>[u.deviceId,u]));const ranks=units.flatMap(u=>u.rank===null?[]:[u.rank]);if(known.size!==units.length||new Set(ranks).size!==ranks.length)throw invalid();
 const used=new Set<number>();const rounds=value.rounds.map((round:unknown):number[]=>{if(!Array.isArray(round)||round.length<1||round.length>3||!round.every(positiveId))throw invalid();for(const id of round){if(used.has(id)||!known.has(id)||!['selected','ranked'].includes(known.get(id)?.reason??''))throw invalid();used.add(id);}return round;});
 if(units.filter(u=>u.reason==='selected').some(u=>!rounds[0]?.includes(u.deviceId))||rounds[0]?.some(id=>known.get(id)?.reason!=='selected'))throw invalid();
 return{units,rounds};
}
function parseResult(value:unknown):TaxiSimulationResult{
 if(!record(value)||typeof value.asOf!=='string'||!Number.isFinite(Date.parse(value.asOf))||value.algorithm!=='heading-matcher-v1'||!bounded(value.radiusKm,0.01,100)||!record(value.pricing)||!['priced','uncovered','unavailable','not_simulated'].includes(String(value.pricing.state))||!['live','example'].includes(String(value.source)))throw invalid();
 const state=value.pricing.state;if(state!=='priced'&&state!=='uncovered'&&state!=='unavailable'&&state!=='not_simulated')throw invalid();
 if(state==='priced'?!Number.isSafeInteger(value.pricing.cents)||!bounded(value.pricing.cents,1,10000000):value.pricing.cents!==null)throw invalid();
 if(value.source!=='live'&&value.source!=='example')throw invalid();
 const baseline=parseRun(value.baseline),scenario=parseRun(value.scenario);
 if(baseline.units.length!==scenario.units.length||baseline.units.some(u=>!scenario.units.some(v=>v.deviceId===u.deviceId)))throw invalid();
 return{asOf:value.asOf,algorithm:'heading-matcher-v1',radiusKm:value.radiusKm,origin:simulationPoint(value.origin),destination:value.destination===null?null:simulationPoint(value.destination),baseline,scenario,pricing:{state,cents:typeof value.pricing.cents==='number'?value.pricing.cents:null},source:value.source};
}
export function parseSimulationResult(value:unknown):TaxiSimulationResult{
 try{return parseResult(value);}catch(error:unknown){if(error instanceof TrackingError&&error.code==='invalid_simulation')throw new TrackingError(502,'simulation_result_invalid','El servidor devolvió una prueba incompleta. Inicia una simulación nueva.');throw error;}
}
