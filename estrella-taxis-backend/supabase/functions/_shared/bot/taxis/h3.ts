import { getResolution, isValidCell, latLngToCell } from 'h3-js';
import type { Place } from './contracts.ts';
export const TAXI_H3_RESOLUTION=10;
export interface H3QuoteScope {originCell:string;destinationCell:string}
export function taxiH3Cell(value:unknown):value is string {
  return typeof value==='string'&&/^8a[0-9a-f]{13}$/.test(value)&&isValidCell(value)&&getResolution(value)===TAXI_H3_RESOLUTION;
}
/** Exact containment only: neighboring cells cannot establish the price of this location. */
export function taxiH3Scope(origin:Place,destination:Place):H3QuoteScope {
  return {originCell:latLngToCell(origin.lat,origin.lng,TAXI_H3_RESOLUTION),destinationCell:latLngToCell(destination.lat,destination.lng,TAXI_H3_RESOLUTION)};
}
