import type {FleetDevice} from '../../tracking/auth.ts';
import type {TraccarPosition} from '../../tracking/fleetTypes.ts';
import {positiveId,record,TrackingError} from '../../tracking/contracts.ts';
import {normalizeTaxiPositions,selectTaxiCandidates} from './selection.ts';
import {gpsOccupancy} from './gpsOccupancy.ts';
import {taxiMotion,TAXI_MOVING_KMH} from './dispatchPolicy.ts';
import type {TaxiSelectionDecision} from '../../algorithms/headingMatcher.ts';
import {getDistanceFromLatLonInKm} from '../../algorithms/headingMatcher.ts';
import type {SimulationReason,TaxiSimulationInput,TaxiSimulationChange,TaxiSimulationRun,TaxiSimulationUnit,TaxiSimulationResult} from './simulationContracts.ts';

export interface SimulationFleetUnit {deviceId:number;name:string;inTurn:boolean;hasPhone:boolean;busy:boolean;eligible:boolean}
export interface SimulationFleet {enabled:boolean;paused:boolean;units:SimulationFleetUnit[]}
export function parseSimulationFleet(value:unknown):SimulationFleet{
 const fail=()=>new TrackingError(502,'invalid_simulation_fleet','No pudimos comprobar las unidades de la base.');
 if(!record(value)||typeof value.enabled!=='boolean'||typeof value.paused!=='boolean'||!Array.isArray(value.units)||value.units.length>200)throw fail();
 const units=value.units.map((v:unknown):SimulationFleetUnit=>{
  if(!record(v)||!positiveId(v.deviceId)||typeof v.name!=='string'||!v.name.trim()||typeof v.inTurn!=='boolean'||typeof v.hasPhone!=='boolean'||typeof v.busy!=='boolean'||typeof v.eligible!=='boolean')throw fail();
  return{deviceId:v.deviceId,name:v.name.slice(0,120),inTurn:v.inTurn,hasPhone:v.hasPhone,busy:v.busy,eligible:v.eligible};
 });if(new Set(units.map(u=>u.deviceId)).size!==units.length)throw fail();
 return{enabled:value.enabled,paused:value.paused,units};
}
function applyChanges(raw:readonly unknown[],changes:readonly TaxiSimulationChange[],now:number):unknown[]{
 const result:unknown[]=[...raw];
 for(const change of changes){
  const matches=raw.filter(p=>record(p)&&p.deviceId===change.deviceId).filter(record).sort((a,b)=>(Date.parse(String(b.fixTime))||0)-(Date.parse(String(a.fixTime))||0));
  const previous=matches[0];
  const base:Record<string,unknown>=previous?{...previous}:{id:change.deviceId,deviceId:change.deviceId,valid:false,latitude:null,longitude:null,fixTime:new Date(now).toISOString(),speed:0};
  const attributes:Record<string,unknown>=record(base.attributes)?{...base.attributes}:{};
  const originalMotion=taxiMotion(attributes,Date.parse(String(base.fixTime)),base.speed);
  if(change.availability){attributes.taxiAvailability=change.availability;attributes.occupied=change.availability==='free'?false:change.availability==='occupied'?true:'unknown';}
  if(change.point){base.latitude=change.point.lat;base.longitude=change.point.lng;base.valid=true;}
  if(change.gpsAgeSeconds!==undefined){base.fixTime=new Date(now-change.gpsAgeSeconds*1000).toISOString();base.outdated=false;}
  if(change.speedKmh!==undefined)base.speed=change.speedKmh/1.852;
  if(change.course!==undefined)base.course=change.course;
  if(change.stationarySeconds!==undefined&&change.speedKmh===undefined)base.speed=0;
  if(change.gpsAgeSeconds!==undefined||change.stationarySeconds!==undefined||change.speedKmh!==undefined||change.point){
   const fix=Date.parse(String(base.fixTime))/1000,moving=typeof base.speed==='number'&&base.speed*1.852>TAXI_MOVING_KMH;
   if(Number.isFinite(fix)&&fix>0){
    const since=change.stationarySeconds!==undefined?(now-change.stationarySeconds*1000)/1000:change.point?fix:Math.min(fix,(originalMotion.stationarySinceMs??fix*1000)/1000);
    if(!moving&&since>fix)throw new TrackingError(400,'simulation_motion_conflict','El tiempo detenido no puede ser menor que la antigüedad del GPS.');
    attributes.taxiMotionVersion=1;attributes.taxiMotionFixTime=fix;attributes.taxiMotionState=moving?'moving':'stationary';
    if(moving)delete attributes.taxiStationarySince;else attributes.taxiStationarySince=since;
   }
  }
  base.attributes=attributes;
  for(let i=result.length-1;i>=0;i--){const p=result[i];if(record(p)&&p.deviceId===change.deviceId)result.splice(i,1);}
  result.push(base);
 }
 return result;
}
export function evaluateSimulation(input:TaxiSimulationInput,fleet:SimulationFleet,devices:readonly FleetDevice[],raw:readonly unknown[],radiusKm:number,now:number,planEnabled=true,source:'live'|'example'='live'):TaxiSimulationResult{
 const known=new Set(fleet.units.map(u=>u.deviceId));
 if(input.overrides.some(o=>!known.has(o.deviceId)))throw new TrackingError(403,'simulation_unit_forbidden','Uno de los cambios corresponde a una unidad de otra base.');
 const run=(changes:readonly TaxiSimulationChange[]):TaxiSimulationRun=>{
  const byChange=new Map(changes.map(c=>[c.deviceId,c])),positions=changes.length?applyChanges(raw,changes,now):raw;
  const selectedDevices=devices.filter(d=>known.has(d.id)).map(d=>({...d,...(byChange.get(d.id)?.status?{status:byChange.get(d.id)?.status}:{})}));
  const visible=new Map(selectedDevices.map(d=>[d.id,d]));
  const globalReason:SimulationReason|null=!planEnabled?'plan_disabled':!fleet.enabled?'channel_disabled':fleet.paused?'channel_paused':null;
  const allowed=new Set(fleet.units.filter(u=>!globalReason&&(byChange.get(u.deviceId)?.eligible??u.eligible)).map(u=>u.deviceId));
  const decisions=new Map<number,TaxiSelectionDecision>();
  const ranked=selectTaxiCandidates(selectedDevices,positions,allowed,input.origin,radiusKm,now,d=>decisions.set(d.deviceId,d));
  const normal=normalizeTaxiPositions(positions,known),latest=new Map<number,TraccarPosition>();
  for(const p of normal){const old=latest.get(p.deviceId);if(!old||Date.parse(p.fixTime??'')>=Date.parse(old.fixTime??''))latest.set(p.deviceId,p);}
  const units=fleet.units.map((u):TaxiSimulationUnit=>{
   const p=latest.get(u.deviceId),change=byChange.get(u.deviceId),decision=decisions.get(u.deviceId),device=visible.get(u.deviceId);
   const ownRaw=positions.find(r=>record(r)&&r.deviceId===u.deviceId),attributes=record(ownRaw)?ownRaw.attributes:null;
   const busy=p?.attributes?.occupied??gpsOccupancy(attributes),availability=busy===false?'free':busy===true?'occupied':'unknown';
   const age=p?.fixTime?Math.round((now-Date.parse(p.fixTime))/1000):null;
   const reason:SimulationReason=globalReason??(!allowed.has(u.deviceId)?change?.eligible===false?'not_available':!u.inTurn?'not_in_turn':!u.hasPhone?'no_whatsapp':u.busy?'active_trip':'not_available':!device?'no_tracking_access':decision?.reason??'no_gps');
   const speed=p?.speed!==undefined&&p.speed>=0&&p.speed*1.852<=1000?p.speed*1.852:null,course=p?.course!==undefined&&p.course>=0&&p.course<360?p.course:null;
   const since=p?.attributes?.taxiStationarySinceMs,stationarySeconds=typeof since==='number'?Math.max(0,Math.floor((now-since)/1000)):null;
   return{deviceId:u.deviceId,name:device?.name??u.name,point:p?{lat:p.latitude,lng:p.longitude}:null,availability,eligible:allowed.has(u.deviceId),status:device?.status??'unknown',gpsAgeSeconds:age!==null&&Number.isFinite(age)?age:null,stationarySeconds,speedKmh:speed,course,changed:Boolean(change),reason,rank:decision?.rank??null,distanceKm:decision?.distanceKm??(p?getDistanceFromLatLonInKm(p.latitude,p.longitude,input.origin.lat,input.origin.lng):null),penaltyKm:decision?.penaltyKm??null,effectiveDistanceKm:decision?.effectiveDistanceKm??null};
  });
  const rounds:number[][]=[];let result=ranked;const remaining=new Set(allowed);
  for(let round=0;round<4;round++){
   if(!result.success||!result.data.length)break;const ids=result.data.map(t=>t.deviceId);rounds.push(ids);for(const id of ids)remaining.delete(id);
   if(round<3)result=selectTaxiCandidates(selectedDevices,positions,remaining,input.origin,radiusKm,now);
  }
  return{units,rounds};
 };
 return{asOf:new Date(now).toISOString(),algorithm:'heading-matcher-v1',radiusKm,origin:input.origin,destination:input.destination,baseline:run([]),scenario:run(input.overrides),pricing:{state:'not_simulated',cents:null},source};
}
