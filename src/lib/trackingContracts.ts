import { finite, positiveId, record } from '../../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts';
import type { AuditFacts, Finding, Narrative } from '../../estrella-taxis-backend/supabase/functions/_shared/tracking/insights.ts';
export interface AuditReport {
  requestId:string; generatedAt:string; period:{from:string;to:string};
  devices:{id:number;name:string}[]; facts:AuditFacts; narrative:Narrative|null;
  narrativeStatus:'generated'|'not_configured'|'unavailable';
}
export function parseAuditReport(value:unknown): AuditReport {
  if (!record(value) || value.version!=='audit-v2' || typeof value.requestId!=='string' || typeof value.generatedAt!=='string' || !record(value.period) || typeof value.period.from!=='string' || typeof value.period.to!=='string' || !Array.isArray(value.devices) || !record(value.facts) || !['generated','not_configured','unavailable'].includes(String(value.narrativeStatus))) throw new Error('El servidor devolvió un análisis que no pudimos validar.');
  const devices=value.devices.map((device)=>{
    if (!record(device) || !positiveId(device.id) || typeof device.name!=='string') throw new Error('Unidad no válida en el análisis.');
    return {id:device.id,name:device.name};
  });
  const raw=value.facts;
  if (!finite(raw.units) || !finite(raw.distanceKm) || !finite(raw.eventCount) || !finite(raw.maxSpeedKmh) || !Array.isArray(raw.findings) || !Array.isArray(raw.warnings) || !raw.warnings.every((item)=>typeof item==='string')) throw new Error('El análisis no contiene evidencia válida.');
  const findings=raw.findings.map((item): Finding=>{
    if (!record(item) || typeof item.id!=='string' || !positiveId(item.deviceId) || !devices.some((device)=>device.id===item.deviceId) || (item.severity!=='review' && item.severity!=='info') || typeof item.title!=='string' || typeof item.evidence!=='string') throw new Error('Hallazgo no válido en el análisis.');
    return {id:item.id,deviceId:item.deviceId,severity:item.severity,title:item.title,evidence:item.evidence};
  });
  let narrative: Narrative|null=null;
  if (value.narrative!==null) {
    const item=value.narrative;
    if (!record(item) || typeof item.summary!=='string' || !Array.isArray(item.recommendations)) throw new Error('Respuesta de IA no válida.');
    narrative={summary:item.summary,recommendations:item.recommendations.map((rec)=>{
      if (!record(rec) || typeof rec.findingId!=='string' || !findings.some((finding)=>finding.id===rec.findingId) || typeof rec.text!=='string') throw new Error('Recomendación sin evidencia.');
      return {findingId:rec.findingId,text:rec.text};
    })};
  }
  if (value.narrativeStatus==='generated' && !narrative) throw new Error('Falta el resultado de IA.');
  const narrativeStatus=value.narrativeStatus==='generated'?'generated':value.narrativeStatus==='not_configured'?'not_configured':'unavailable';
  return {requestId:value.requestId,generatedAt:value.generatedAt,period:{from:value.period.from,to:value.period.to},devices,
    facts:{units:raw.units,distanceKm:raw.distanceKm,eventCount:raw.eventCount,maxSpeedKmh:raw.maxSpeedKmh,findings,warnings:raw.warnings},narrative,narrativeStatus};
}
export interface TrackingScoreRow {
  device_id:number; device_name:string; score_date:string; score:number; score_label:string;
  distance_km:number; idle_minutes:number; algorithm_version:string; qualityStatus:'legacy'|'limited'|'sufficient';
}
export function parseScoreHistory(value:unknown): TrackingScoreRow[] {
  if (!record(value) || !Array.isArray(value.rows) || value.rows.length>3100) throw new Error('El historial de manejo no es válido.');
  return value.rows.map((row)=>{
    if (!record(row) || !positiveId(row.device_id) || typeof row.device_name!=='string' || typeof row.score_date!=='string' || !/^\d{4}-\d\d-\d\d$/.test(row.score_date) || !finite(row.score) || row.score<0 || row.score>100 || typeof row.score_label!=='string' || !finite(row.distance_km) || !finite(row.idle_minutes) || typeof row.algorithm_version!=='string') throw new Error('El historial incluye una calificación no válida.');
    const qualityStatus=row.algorithm_version!=='tracking-score-v2'?'legacy':record(row.quality) && row.quality.status==='sufficient'?'sufficient':'limited';
    return {device_id:row.device_id,device_name:row.device_name,score_date:row.score_date,score:row.score,score_label:row.score_label,distance_km:row.distance_km,idle_minutes:row.idle_minutes,algorithm_version:row.algorithm_version,qualityStatus};
  });
}
