import {record} from '../../tracking/contracts.ts';

export const TAXI_GPS_MAX_AGE_MS=30*60*1000;
export const TAXI_IDLE_MAX_MS=30*60*1000;
export const TAXI_HEADING_MAX_AGE_MS=2*60*1000;
export const TAXI_MOVING_KMH=3;
export type TaxiTelemetryIssue='invalid_gps'|'future_gps'|'stale_gps'|'idle_timeout';
export interface TaxiMotion {valid:boolean;stationarySinceMs:number|null}
function seconds(value:unknown):number|null{
 const n=typeof value==='number'?value:typeof value==='string'&&/^\d{1,12}(\.\d{1,3})?$/.test(value)?Number(value):NaN;
 return Number.isFinite(n)&&n>0&&n<=1000000000000?n*1000:null;
}
/** The bridge attestation refers to the original GPS fix, never its import time. */
export function taxiMotion(attributes:unknown,fixMs:number,speedKnots:unknown):TaxiMotion{
 if(!Number.isFinite(fixMs))return{valid:false,stationarySinceMs:null};
 const moving=typeof speedKnots==='number'&&Number.isFinite(speedKnots)&&speedKnots*1.852>TAXI_MOVING_KMH;
 if(!record(attributes)||attributes.taxiMotionVersion===undefined){
  // Legacy telemetry only proves that a stopped vehicle was stationary at this fix.
  return{valid:true,stationarySinceMs:!moving&&typeof speedKnots==='number'&&speedKnots>=0?fixMs:null};
 }
 const observed=seconds(attributes.taxiMotionFixTime),since=seconds(attributes.taxiStationarySince);
 if(attributes.taxiMotionVersion!==1&&attributes.taxiMotionVersion!=='1'||observed===null||Math.abs(observed-fixMs)>1000)return{valid:false,stationarySinceMs:null};
 if(attributes.taxiMotionState==='moving')return{valid:moving,stationarySinceMs:null};
 if(attributes.taxiMotionState!=='stationary'||since===null||since>fixMs||moving)return{valid:false,stationarySinceMs:null};
 return{valid:true,stationarySinceMs:since};
}
export function taxiTelemetryIssue(fixTime:unknown,attributes:unknown,speedKnots:unknown,now:number,valid:unknown):TaxiTelemetryIssue|null{
 const fix=typeof fixTime==='string'?Date.parse(fixTime):NaN,age=now-fix;
 if(valid!==true||!Number.isFinite(now)||!Number.isFinite(fix))return'invalid_gps';
 if(age < -30000)return'future_gps';
 if(age>TAXI_GPS_MAX_AGE_MS)return'stale_gps';
 const motion=taxiMotion(attributes,fix,speedKnots);
 if(!motion.valid)return'invalid_gps';
 return motion.stationarySinceMs!==null&&now-motion.stationarySinceMs>TAXI_IDLE_MAX_MS?'idle_timeout':null;
}
