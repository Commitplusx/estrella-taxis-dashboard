import { escapeHtml } from './escapeHtml.ts';
import { getCategoryDef, getMarkerColor } from './mapIcons.ts';

export interface FleetMapPoint { lat: number; lng: number }
export function validFleetPoint(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0);
}

export function fleetMarkerHtml(input: {
  name: string; category?: string; status: string; speed: number; course: number; occupied?: boolean;
}): string {
  const definition = getCategoryDef(input.category);
  const color = getMarkerColor(input.status, input.speed, input.occupied);
  const course = Number.isFinite(input.course) ? ((input.course % 360) + 360) % 360 : 0;
  return `<span class="fleet-vehicle-symbol" style="transform:rotate(${course}deg)"><svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true"><path d="${escapeHtml(definition.path)}" fill="${color}" stroke="#fff" stroke-width="1.5"/></svg></span><span class="marker-label fleet-vehicle-label">${escapeHtml(input.name || 'Taxi')}</span>`;
}
