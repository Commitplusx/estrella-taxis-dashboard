import type {FleetDevice} from '../../tracking/auth.ts';
import type {TraccarDevice,TraccarPosition} from '../../tracking/fleetTypes.ts';
import {flag,positiveId} from '../../tracking/contracts.ts';
import {coord,record} from './contracts.ts';
import {gpsOccupancy} from './gpsOccupancy.ts';
import {findOptimalTaxi,type TaxiSelectionDecision} from '../../algorithms/headingMatcher.ts';
import {taxiMotion,TAXI_GPS_MAX_AGE_MS,TAXI_IDLE_MAX_MS,TAXI_HEADING_MAX_AGE_MS} from './dispatchPolicy.ts';

/** Shared by live dispatch and the simulator; preserves the existing GPS policy. */
export function normalizeTaxiPositions(raw:readonly unknown[],allowed:ReadonlySet<number>,onDecision?:(d:TaxiSelectionDecision)=>void):TraccarPosition[]{
 const positions:TraccarPosition[]=[];
 const latest=new Map<number,Record<string,unknown>>();
 for(const p of raw){
  if(!record(p)||!positiveId(p.deviceId)||!allowed.has(p.deviceId))continue;
  const old=latest.get(p.deviceId),time=typeof p.fixTime==='string'?Date.parse(p.fixTime):NaN,oldTime=old&&typeof old.fixTime==='string'?Date.parse(old.fixTime):NaN;
  if(!old||!Number.isFinite(time)||Number.isFinite(oldTime)&&(time>oldTime||time===oldTime&&typeof p.id==='number'&&typeof old.id==='number'&&p.id>old.id))latest.set(p.deviceId,p);
 }
 for(const p of latest.values()){
  if(!positiveId(p.deviceId))continue;
  if(!positiveId(p.id)||!coord(p.latitude,p.longitude)||typeof p.longitude!=='number'||typeof p.fixTime!=='string'||p.valid!==true){onDecision?.({deviceId:p.deviceId,reason:'invalid_gps',rank:null,distanceKm:null,penaltyKm:null,effectiveDistanceKm:null});continue;}
  const ignition=record(p.attributes)?flag(p.attributes.ignition):null,occupied=gpsOccupancy(p.attributes);
  const isMobile=record(p.attributes)&&p.attributes.taxiPositionSource==='mobile';
  const motion=isMobile&&record(p.attributes)&&typeof p.attributes.taxiStationarySinceMs==='number'
    ?{valid:Number.isFinite(p.attributes.taxiStationarySinceMs)&&p.attributes.taxiStationarySinceMs<=Date.parse(p.fixTime),stationarySinceMs:p.attributes.taxiStationarySinceMs}:taxiMotion(p.attributes,Date.parse(p.fixTime),p.speed);
  if(!motion.valid){onDecision?.({deviceId:p.deviceId,reason:'invalid_gps',rank:null,distanceKm:null,penaltyKm:null,effectiveDistanceKm:null});continue;}
  positions.push({id:p.id,deviceId:p.deviceId,latitude:p.latitude,longitude:p.longitude,fixTime:p.fixTime,valid:true,outdated:p.outdated===true,speed:typeof p.speed==='number'&&Number.isFinite(p.speed)?p.speed:undefined,course:typeof p.course==='number'&&Number.isFinite(p.course)?p.course:undefined,attributes:{ignition,occupied,taxiStationarySinceMs:motion.stationarySinceMs,...(isMobile?{taxiPositionSource:'mobile'}:{})}});
 }
 return positions;
}
export function selectTaxiCandidates(devices:readonly FleetDevice[],rawPositions:readonly unknown[],allowed:ReadonlySet<number>,origin:{lat:number;lng:number},radiusKm:number,now:number,onDecision?:(d:TaxiSelectionDecision)=>void){
 const mobile=new Set(rawPositions.flatMap(p=>record(p)&&record(p.attributes)&&p.attributes.taxiPositionSource==='mobile'?[p.deviceId]:[]));
 const filtered:TraccarDevice[]=devices.filter(d=>allowed.has(d.id)&&(mobile.has(d.id)||d.status==='online'||d.status==='offline')).map(d=>({...d,...(mobile.has(d.id)?{status:'online'}:{}),uniqueId:String(d.id)}));
 for(const d of devices)if(allowed.has(d.id)&&!mobile.has(d.id)&&d.status!=='online'&&d.status!=='offline')onDecision?.({deviceId:d.id,reason:'offline',rank:null,distanceKm:null,penaltyKm:null,effectiveDistanceKm:null});
 return findOptimalTaxi(filtered,normalizeTaxiPositions(rawPositions,allowed,onDecision),origin.lat,origin.lng,radiusKm,now,{allowIgnitionOff:true,allowOfflineFixAgeMs:TAXI_GPS_MAX_AGE_MS,maxPositionAgeMs:TAXI_GPS_MAX_AGE_MS,maxStationaryMs:TAXI_IDLE_MAX_MS,maxHeadingAgeMs:TAXI_HEADING_MAX_AGE_MS,onDecision});
}
