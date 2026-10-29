import { finite, flag, isoMs, numeric, positiveId, record } from './contracts.ts';
export const SCORE_VERSION='tracking-score-v2';
export interface NormalPosition { ms: number; lat: number; lng: number; speed: number | null; ignition: boolean | null }
export interface ScoreQuality {
  inputPoints: number; acceptedPoints: number; rejectedPoints: number; duplicatePoints: number;
  gapSegments: number; suspectSegments: number; observedMinutes: number; spanMinutes: number;
  coverage: number; harshWindows: number; unknownIgnitionMinutes: number;
  status: 'limited' | 'sufficient';
}
export interface ScoreResult {
  deviceId: number; deviceName: string; scoreDate: string; score: number; scoreLabel: string;
  harshBraking: number; harshAcceleration: number; overspeedEvents: number; idleMinutes: number;
  distanceKm: number; durationMinutes: number; maxSpeedKmh: number; positionsAnalyzed: number;
  algorithmVersion: string; quality: ScoreQuality;
}
export interface ScoreAnalysis { score: ScoreResult | null; quality: ScoreQuality }
export function distanceKm(a: {lat:number;lng:number}, b: {lat:number;lng:number}): number {
  const rad=Math.PI/180, dlat=(b.lat-a.lat)*rad, dlng=(b.lng-a.lng)*rad;
  const value=Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlng/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(Math.min(1,Math.max(0,value))),Math.sqrt(Math.max(0,1-value)));
}
const round=(value:number)=>Math.round(value*1000)/1000;
export function analyzeDriving(raw: unknown, device: {id:number;name:string}, date: string, from: number, to: number): ScoreAnalysis {
  const quality: ScoreQuality={ inputPoints:0,acceptedPoints:0,rejectedPoints:0,duplicatePoints:0,gapSegments:0,suspectSegments:0,observedMinutes:0,spanMinutes:0,coverage:0,harshWindows:0,unknownIgnitionMinutes:0,status:'limited' };
  if (!Array.isArray(raw) || raw.length > 25000 || !positiveId(device.id) || !finite(from) || !finite(to) || to < from) return {score:null,quality};
  quality.inputPoints=raw.length;
  const parsed: NormalPosition[]=[];
  for (const item of raw) {
    if (!record(item) || item.valid === false || item.outdated === true || (item.deviceId !== undefined && item.deviceId !== device.id)) { quality.rejectedPoints++; continue; }
    const ms=isoMs(item.fixTime ?? item.deviceTime ?? item.serverTime), lat=numeric(item.latitude), lng=numeric(item.longitude);
    if (ms === null || ms < from || ms > to || lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat === 0 && lng === 0)) { quality.rejectedPoints++; continue; }
    const knots=numeric(item.speed), speed=knots !== null && knots >= 0 && knots*1.852 <= 220 ? knots*1.852 : null;
    parsed.push({ms,lat,lng,speed,ignition:record(item.attributes)?flag(item.attributes.ignition):null});
  }
  parsed.sort((a,b)=>a.ms-b.ms || a.lat-b.lat || a.lng-b.lng);
  const positions: NormalPosition[]=[];
  for (let index=0;index<parsed.length;) {
    let next=index+1;
    while (next<parsed.length && parsed[next].ms === parsed[index].ms) next++;
    const group=parsed.slice(index,next);
    quality.duplicatePoints+=group.length-1;
    // Conflicting fixes at one timestamp are not evidence of movement.
    if (group.some((point)=>distanceKm(point,group[0]) > 0.2)) quality.rejectedPoints+=group.length;
    else positions.push(group.find((point)=>point.speed !== null) ?? group[0]);
    index=next;
  }
  quality.acceptedPoints=positions.length;
  if (positions.length < 2) return {score:null,quality};
  quality.spanMinutes=(positions.at(-1)!.ms-positions[0].ms)/60000;
  let harshBraking=0,harshAcceleration=0,overspeedEvents=0,idleSeconds=0,idleTotal=0,observed=0,totalDistance=0,maxSpeed=0;
  let lastBrake=-Infinity,lastAccel=-Infinity,inOverspeed=false;
  for (const point of positions) if (point.speed !== null) maxSpeed=Math.max(maxSpeed,point.speed);
  for (let index=1;index<positions.length;index++) {
    const prev=positions[index-1], curr=positions[index], seconds=(curr.ms-prev.ms)/1000;
    const km=distanceKm(prev,curr);
    if (seconds <= 0 || seconds > 300) { quality.gapSegments++; idleSeconds=0;inOverspeed=false;continue; }
    if (km > 0.08 && km/(seconds/3600) > 220) { quality.suspectSegments++;idleSeconds=0;inOverspeed=false;continue; }
    observed+=seconds; totalDistance+=km;
    const speedKnown=prev.speed !== null && curr.speed !== null;
    if (speedKnown && seconds >= 2 && seconds <= 15) {
      quality.harshWindows++;
      const rate=(curr.speed!-prev.speed!)/seconds;
      if (rate <= -9 && curr.ms-lastBrake >= 15000) { harshBraking++;lastBrake=curr.ms; }
      if (rate >= 6 && curr.ms-lastAccel >= 15000) { harshAcceleration++;lastAccel=curr.ms; }
    }
    const over=curr.speed !== null && curr.speed > 90;
    if (over && !inOverspeed) overspeedEvents++;
    inOverspeed=over;
    if (prev.ignition === null || curr.ignition === null) quality.unknownIgnitionMinutes+=seconds/60;
    // Unknown ignition must never be presented as engine-on idling.
    if (prev.ignition === true && curr.ignition === true && speedKnown && prev.speed! < 3 && curr.speed! < 3) {
      const before=Math.max(0,idleSeconds-180);idleSeconds+=seconds;idleTotal+=Math.max(0,idleSeconds-180)-before;
    } else idleSeconds=0;
  }
  quality.observedMinutes=round(observed/60);
  quality.spanMinutes=round(quality.spanMinutes);
  quality.coverage=quality.spanMinutes > 0 ? round(Math.min(1,quality.observedMinutes/quality.spanMinutes)) : 0;
  quality.unknownIgnitionMinutes=round(quality.unknownIgnitionMinutes);
  quality.status=positions.length >= 30 && quality.coverage >= .8 && quality.harshWindows >= 10 && observed >= 900 ? 'sufficient' : 'limited';
  if (positions.length < 8 || observed < 60) return {score:null,quality};
  const score=Math.max(0,100-harshBraking*5-harshAcceleration*4-overspeedEvents*3-Math.floor(idleTotal/300));
  return { quality, score: {
    deviceId:device.id,deviceName:device.name,scoreDate:date,score,
    scoreLabel:score>=85?'Excelente':score>=70?'Bueno':score>=50?'Regular':'Deficiente',
    harshBraking,harshAcceleration,overspeedEvents,idleMinutes:round(idleTotal/60),
    distanceKm:round(totalDistance),durationMinutes:quality.observedMinutes,maxSpeedKmh:round(maxSpeed),positionsAnalyzed:positions.length,
    algorithmVersion:SCORE_VERSION,quality,
  }};
}
export function scoreRow(score: ScoreResult): Record<string,unknown> {
  return { device_id:score.deviceId,device_name:score.deviceName,score_date:score.scoreDate,score:score.score,score_label:score.scoreLabel,
    harsh_braking:score.harshBraking,harsh_acceleration:score.harshAcceleration,overspeed_events:score.overspeedEvents,idle_minutes:score.idleMinutes,
    distance_km:score.distanceKm,duration_minutes:score.durationMinutes,max_speed_kmh:score.maxSpeedKmh,positions_analyzed:score.positionsAnalyzed,
    algorithm_version:score.algorithmVersion,quality:score.quality,computed_at:new Date().toISOString() };
}
