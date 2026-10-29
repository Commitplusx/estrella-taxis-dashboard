export interface TraccarDevice {
  id:number; name:string; uniqueId:string; status?:string; lastUpdate?:string; positionId?:number; groupId?:number; phone?:string;
}
export interface TraccarPosition {
  id:number; deviceId:number; protocol?:string; serverTime?:string; deviceTime?:string; fixTime?:string;
  outdated?:boolean; valid?:boolean; latitude:number; longitude:number; altitude?:number; speed?:number; course?:number; address?:string;
  attributes?:Record<string,unknown>;
}
