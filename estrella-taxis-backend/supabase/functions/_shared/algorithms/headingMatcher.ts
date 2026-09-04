import { TraccarDevice, TraccarPosition } from "../traccar.ts";
import { z } from "npm:zod";

/**
 * Módulo de Enrutamiento Vectorial (Heading Matcher)
 * 
 * Nivel Enterprise (Ultra-Robusto):
 * - Zod Schema Validation para asegurar los tipos en runtime.
 * - Result Pattern para manejo de errores sin excepciones (anti-crashes).
 * - Bounding Box Pre-filter (Culling): Descarta taxis lejanos con matemáticas simples
 *   antes de ejecutar Haversine pesado, ahorrando CPU en flotas masivas.
 * - Profiling de rendimiento interno.
 */

// 1. Zod Schemas para Validación Estricta
const CoordSchema = z.number().min(-90).max(90);
const LngSchema = z.number().min(-180).max(180);

export function isValidCoord(lat: number, lng: number): boolean {
  return CoordSchema.safeParse(lat).success && LngSchema.safeParse(lng).success;
}

// 2. Result Pattern
export type Result<T> = { success: true; data: T } | { success: false; error: string };

// 3. Matemáticas Core
export function getBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (lat1 === lat2 && lon1 === lon2) return 0; 
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const y = Math.sin((lon2 - lon1) * toRad) * Math.cos(lat2 * toRad);
  const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
            Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos((lon2 - lon1) * toRad);
  const brng = Math.atan2(y, x) * toDeg;
  return Math.abs((brng + 360) % 360) || 0;
}

export function getAngleDifference(angle1: number, angle2: number): number {
  const diff = Math.abs((angle1 || 0) - (angle2 || 0)) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export function getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; 
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.max(0, Math.min(1, 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  ));
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// Bounding Box para descartar taxis fuera del radio máximo sin usar Haversine (Ahorro CPU)
// 1 grado de latitud ~= 111 km
function isWithinBoundingBox(lat1: number, lon1: number, lat2: number, lon2: number, maxRadiusKm: number): boolean {
  const deltaLat = maxRadiusKm / 111;
  const deltaLon = maxRadiusKm / (111 * Math.cos(lat1 * (Math.PI / 180)));
  
  return lat2 >= (lat1 - deltaLat) && lat2 <= (lat1 + deltaLat) &&
         lon2 >= (lon1 - deltaLon) && lon2 <= (lon1 + deltaLon);
}

export interface OptimalTaxiResult {
  name: string;
  distanceKm: number;
  deviceId: number;
  performanceMs: number;
}

export function findOptimalTaxi(
  devices: TraccarDevice[], 
  positions: TraccarPosition[], 
  clientLat: number, 
  clientLng: number,
  maxRadiusKm: number = 10
): Result<OptimalTaxiResult> {
  const startMs = performance.now();
  
  if (!Array.isArray(positions) || positions.length === 0) return { success: false, error: "No positions available" };
  if (!Array.isArray(devices) || devices.length === 0) return { success: false, error: "No devices available" };
  if (!isValidCoord(clientLat, clientLng)) return { success: false, error: "Invalid client coordinates" };

  let nearestTaxi: TraccarDevice | undefined;
  let minEffectiveDistance = Infinity;
  let trueDistanceOfSelected = Infinity;

  for (const pos of positions) {
    if (!pos || !pos.deviceId || !isValidCoord(pos.latitude, pos.longitude)) continue;

    // Fast-path: Bounding box culling (O(1) simple math)
    if (!isWithinBoundingBox(clientLat, clientLng, pos.latitude, pos.longitude, maxRadiusKm * 1.5)) {
      continue; // Ignorar taxis completamente fuera de zona
    }

    const device = devices.find(d => d.id === pos.deviceId);
    if (!device) continue;

    // Slow-path: Haversine
    const rawDistance = getDistanceFromLatLonInKm(pos.latitude, pos.longitude, clientLat, clientLng);
    if (rawDistance > maxRadiusKm * 1.5) continue;

    const bearing = getBearing(pos.latitude, pos.longitude, clientLat, clientLng);
    const taxiCourse = Number.isFinite(pos.course) ? pos.course! : 0;
    const taxiSpeedKmh = (Number.isFinite(pos.speed) ? pos.speed! : 0) * 1.852; 
    
    const angleDiff = getAngleDifference(taxiCourse, bearing);
    
    const basePenalty = Math.max(1, rawDistance * 0.2); 
    let penaltyKm = 0;

    if (taxiSpeedKmh > 5) {
      if (angleDiff <= 45) penaltyKm = 0;
      else if (angleDiff <= 90) penaltyKm = 0.5 * basePenalty;
      else if (angleDiff <= 135) penaltyKm = 1.2 * basePenalty;
      else penaltyKm = 2.5 * basePenalty;
    }

    const effectiveDistance = rawDistance + penaltyKm;
    
    if (effectiveDistance < minEffectiveDistance) {
      minEffectiveDistance = effectiveDistance;
      trueDistanceOfSelected = rawDistance;
      nearestTaxi = device;
    }
  }

  const endMs = performance.now();
  const perf = Number((endMs - startMs).toFixed(3));

  if (nearestTaxi && trueDistanceOfSelected <= maxRadiusKm) {
    return { 
      success: true, 
      data: { 
        name: nearestTaxi.name, 
        distanceKm: trueDistanceOfSelected, 
        deviceId: nearestTaxi.id,
        performanceMs: perf
      }
    };
  }
  
  return { success: false, error: "No suitable taxi found within radius" };
}
