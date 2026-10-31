import { escapeHtml } from './escapeHtml.ts';
import { getCategoryDef, getMarkerColor } from './mapIcons.ts';
import {taxiTelemetryIssue} from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/dispatchPolicy.ts';

export interface FleetMapPoint { lat: number; lng: number }
export function validFleetPoint(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0);
}

export function fleetMarkerHtml(input: {
  name: string; category?: string; status: string; speed: number; course: number; occupied?: boolean|null;fixTime?:string;attributes?:unknown;nowMs?:number;
}): string {
  const definition = getCategoryDef(input.category);
  const issue=input.fixTime!==undefined?taxiTelemetryIssue(input.fixTime,input.attributes,input.speed,input.nowMs??Date.now()):null;
  const color = issue?'#94a3b8':input.occupied===null?'#b45309':getMarkerColor(input.status, input.speed, input.occupied);
  const detail=issue==='idle_timeout'?'Detenido más de 30 minutos':issue==='stale_gps'?'GPS con más de 30 minutos':issue?'GPS no utilizable':null;
  const course = Number.isFinite(input.course) ? ((input.course % 360) + 360) % 360 : 0;
  return `<span class="fleet-vehicle-symbol" style="transform:rotate(${course}deg)"><svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true"><path d="${escapeHtml(definition.path)}" fill="${color}" stroke="#fff" stroke-width="1.5"/></svg></span><span class="marker-label fleet-vehicle-label">${escapeHtml(input.name || 'Taxi')}${detail?` · ${detail}`:''}</span>`;
}
