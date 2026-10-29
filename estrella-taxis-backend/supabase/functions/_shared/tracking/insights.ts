import { finite, isoMs, positiveId, record, TrackingError, type Period } from './contracts.ts';
import type { FleetDevice } from './auth.ts';
export interface FleetSummary { deviceId: number; distance: number; maxSpeed: number; averageSpeed: number; engineHours: number }
export interface FleetEvent { id: number; deviceId: number; type: string; time: string }
export interface Finding { id: string; deviceId: number; severity: 'review' | 'info'; title: string; evidence: string }
export interface AuditFacts { units: number; distanceKm: number; eventCount: number; maxSpeedKmh: number; findings: Finding[]; warnings: string[] }
export function normalizeSummaries(value: unknown, allowed: ReadonlySet<number>): FleetSummary[] {
  if (!Array.isArray(value) || value.length > 250) throw new TrackingError(502,'invalid_summary','No pudimos validar el resumen de la flota.');
  const rows: FleetSummary[]=[]; const seen=new Set<number>();
  for (const item of value) {
    if (!record(item) || !positiveId(item.deviceId) || !allowed.has(item.deviceId) || seen.has(item.deviceId) || !finite(item.distance) || item.distance < 0 || item.distance > 10000000 || !finite(item.maxSpeed) || item.maxSpeed < 0 || item.maxSpeed > 150 || !finite(item.averageSpeed) || item.averageSpeed < 0 || !finite(item.engineHours) || item.engineHours < 0) throw new TrackingError(502,'invalid_summary','El resumen contiene datos ajenos o no válidos.');
    rows.push({deviceId:item.deviceId,distance:item.distance,maxSpeed:item.maxSpeed,averageSpeed:item.averageSpeed,engineHours:item.engineHours});seen.add(item.deviceId);
  }
  return rows.sort((a,b)=>a.deviceId-b.deviceId);
}
export function normalizeEvents(value: unknown, allowed: ReadonlySet<number>, period: Period): FleetEvent[] {
  if (!Array.isArray(value) || value.length > 10000) throw new TrackingError(413,'too_many_events','Hay demasiados eventos. Reduce el periodo.');
  const rows: FleetEvent[]=[]; const seen=new Set<number>();
  for (const item of value) {
    if (!record(item) || !positiveId(item.id) || !positiveId(item.deviceId) || !allowed.has(item.deviceId) || typeof item.type !== 'string' || !/^[a-zA-Z]{1,60}$/.test(item.type)) throw new TrackingError(502,'invalid_events','El proveedor devolvió eventos ajenos o no válidos.');
    const ms=isoMs(item.eventTime ?? item.serverTime);
    if (ms === null || ms < Date.parse(period.from) || ms > Date.parse(period.to)) continue;
    if (!seen.has(item.id)) rows.push({id:item.id,deviceId:item.deviceId,type:item.type,time:new Date(ms).toISOString()});
    seen.add(item.id);
  }
  return rows.sort((a,b)=>a.id-b.id);
}
export function buildFacts(devices: readonly FleetDevice[], summaries: readonly FleetSummary[], events: readonly FleetEvent[]): AuditFacts {
  const findings: Finding[]=[], warnings: string[]=[];
  const summaryById=new Map(summaries.map((item)=>[item.deviceId,item]));
  for (const device of devices) {
    const summary=summaryById.get(device.id), own=events.filter((item)=>item.deviceId===device.id);
    const offline=own.filter((item)=>item.type==='deviceOffline').length;
    const overspeed=own.filter((item)=>item.type==='deviceOverspeed').length;
    if (offline >= 3) findings.push({id:`offline-${device.id}`,deviceId:device.id,severity:'review',title:'Revisar desconexiones del GPS',evidence:`${offline} eventos de desconexión en el periodo. No prueban manipulación del equipo.`});
    if (overspeed) findings.push({id:`speed-${device.id}`,deviceId:device.id,severity:'review',title:'Revisar eventos de velocidad',evidence:`${overspeed} avisos del GPS; el límite vial debe verificarse para cada zona.`});
    if (summary && summary.distance < 1000 && summary.engineHours >= 7200000) findings.push({id:`activity-${device.id}`,deviceId:device.id,severity:'review',title:'Poco recorrido con motor activo',evidence:`${(summary.distance/1000).toFixed(2)} km y ${(summary.engineHours/3600000).toFixed(1)} horas de motor. No confirma ralentí ni falta de trabajo.`});
    if (!summary) warnings.push(`La unidad ${device.id} no tiene resumen para este periodo.`);
  }
  if (events.length===0) warnings.push('No hubo eventos devueltos para este periodo; eso no demuestra ausencia de incidentes.');
  return { units:devices.length,distanceKm:Math.round(summaries.reduce((sum,item)=>sum+item.distance,0)/10)/100,eventCount:events.length,
    maxSpeedKmh:Math.round(Math.max(0,...summaries.map((item)=>item.maxSpeed))*1.852*10)/10,findings,warnings };
}
export interface Narrative { summary: string; recommendations: { findingId: string; text: string }[] }
export function parseNarrative(value: unknown, facts: AuditFacts): Narrative {
  if (!record(value) || typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 1400 || /[<>]/.test(value.summary) || !Array.isArray(value.recommendations) || value.recommendations.length > 12) throw new TrackingError(502,'invalid_ai_output','La respuesta de IA no cumplió el formato solicitado.');
  const allowed=new Set(facts.findings.map((finding)=>finding.id)); const seen=new Set<string>();
  const recommendations=value.recommendations.map((item): {findingId:string;text:string}=>{
    if (!record(item) || typeof item.findingId !== 'string' || !allowed.has(item.findingId) || seen.has(item.findingId) || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 700 || /[<>]/.test(item.text)) throw new TrackingError(502,'invalid_ai_output','La IA citó un hallazgo que no está en los datos.');
    seen.add(item.findingId);return {findingId:item.findingId,text:item.text.trim()};
  });
  return {summary:value.summary.trim(),recommendations};
}
