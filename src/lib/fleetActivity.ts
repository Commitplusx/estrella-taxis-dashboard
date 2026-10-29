import { calculateKMeans, type Cluster, type Point } from '../../estrella-taxis-backend/supabase/functions/_shared/algorithms/kMeans.ts';
import { isoMs, numeric, record } from '../../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts';
import { mapLimit } from '../../estrella-taxis-backend/supabase/functions/_shared/tracking/http.ts';
export interface ActivityResult { clusters:Cluster[]; sampledPoints:number; units:number; missingUnits:number }
export async function loadFleetActivity(deviceIds:readonly number[],from:string,to:string,load:(id:number)=>Promise<unknown>): Promise<ActivityResult> {
  if (deviceIds.length>25) throw new Error('El mapa de actividad permite hasta 25 unidades a la vez.');
  const start=Date.parse(from),end=Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end<=start || end-start>7*86400000) throw new Error('Elige un periodo válido de hasta siete días.');
  const rows=await mapLimit(deviceIds,3,async(id)=>{
    const raw=await load(id); if (!Array.isArray(raw) || raw.length>25000) throw new Error('Una ruta supera el límite de datos. Reduce el periodo.');
    const byBucket=new Map<number,Point>();
    for(const item of raw) {
      if (!record(item) || item.deviceId!==id || item.valid===false) continue;
      const time=isoMs(item.fixTime ?? item.serverTime),lat=numeric(item.latitude),lng=numeric(item.longitude);
      if (time===null || time<start || time>end || lat===null || lng===null || lat < -90 || lat>90 || lng < -180 || lng>180 || (lat===0 && lng===0)) continue;
      // One observation per unit and 15-minute bucket prevents fast GPS reporting from dominating the map.
      const bucket=Math.floor((time-start)/900000); if (!byBucket.has(bucket)) byBucket.set(bucket,{lat,lng});
    }
    return [...byBucket.entries()].sort((a,b)=>a[0]-b[0]).map((entry)=>entry[1]);
  });
  const points=rows.flat();
  return {clusters:calculateKMeans(points,Math.min(8,points.length || 1)),sampledPoints:points.length,units:deviceIds.length,missingUnits:rows.filter((row)=>!row.length).length};
}
