import type {FleetDevice} from '../../tracking/auth.ts';
import type {TraccarDevice,TraccarPosition} from '../../tracking/fleetTypes.ts';
import {flag,positiveId} from '../../tracking/contracts.ts';
import {coord,record} from './contracts.ts';
import {gpsOccupancy} from './gpsOccupancy.ts';
import {findOptimalTaxi,type TaxiSelectionDecision} from '../../algorithms/headingMatcher.ts';

/** Shared by live dispatch and the simulator; preserves the existing GPS policy. */
export function normalizeTaxiPositions(raw:readonly unknown[],allowed:ReadonlySet<number>,onDecision?:(d:TaxiSelectionDecision)=>void):TraccarPosition[]{
 const positions:TraccarPosition[]=[];
 for(const p of raw){
  if(!record(p)||!positiveId(p.deviceId)||!allowed.has(p.deviceId))continue;
  if(!positiveId(p.id)||!coord(p.latitude,p.longitude)||typeof p.longitude!=='number'||typeof p.fixTime!=='string'||p.valid!==true){onDecision?.({deviceId:p.deviceId,reason:'invalid_gps',rank:null,distanceKm:null,penaltyKm:null,effectiveDistanceKm:null});continue;}
  const ignition=record(p.attributes)?flag(p.attributes.ignition):null,occupied=gpsOccupancy(p.attributes);
  positions.push({id:p.id,deviceId:p.deviceId,latitude:p.latitude,longitude:p.longitude,fixTime:p.fixTime,valid:true,outdated:p.outdated===true,speed:typeof p.speed==='number'&&Number.isFinite(p.speed)?p.speed:undefined,course:typeof p.course==='number'&&Number.isFinite(p.course)?p.course:undefined,attributes:{ignition,occupied}});
 }
 return positions;
}
export function selectTaxiCandidates(devices:readonly FleetDevice[],rawPositions:readonly unknown[],allowed:ReadonlySet<number>,origin:{lat:number;lng:number},radiusKm:number,now:number,onDecision?:(d:TaxiSelectionDecision)=>void){
 const filtered:TraccarDevice[]=devices.filter(d=>allowed.has(d.id)&&(d.status==='online'||d.status==='offline')).map(d=>({...d,uniqueId:String(d.id)}));
 for(const d of devices)if(allowed.has(d.id)&&d.status!=='online'&&d.status!=='offline')onDecision?.({deviceId:d.id,reason:'offline',rank:null,distanceKm:null,penaltyKm:null,effectiveDistanceKm:null});
 return findOptimalTaxi(filtered,normalizeTaxiPositions(rawPositions,allowed,onDecision),origin.lat,origin.lng,radiusKm,now,{allowIgnitionOff:true,allowOfflineFixAgeMs:2*60*1000,onDecision});
}
