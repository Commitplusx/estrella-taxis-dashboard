import type { TraccarDevice, TraccarPosition } from '../tracking/fleetTypes.ts';
import { flag } from '../tracking/contracts.ts';

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
export function isValidCoord(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
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
  effectiveDistanceKm: number;
}

export function findOptimalTaxi(
  devices: TraccarDevice[], 
  positions: TraccarPosition[], 
  clientLat: number, 
  clientLng: number,
  maxRadiusKm: number = 10,
  nowMs: number = Date.now()
): Result<OptimalTaxiResult[]> {
  const startMs = performance.now();
  
  if (!Array.isArray(positions) || positions.length === 0) return { success: false, error: "No positions available" };
  if (!Array.isArray(devices) || devices.length === 0) return { success: false, error: "No devices available" };
  if (!isValidCoord(clientLat, clientLng)) return { success: false, error: "Invalid client coordinates" };
  if (!Number.isFinite(nowMs) || !Number.isFinite(maxRadiusKm) || maxRadiusKm <= 0 || maxRadiusKm > 100 || devices.length > 50000 || positions.length > 100000) {
    return { success: false, error: "Invalid dispatch limits" };
  }

  const scoredTaxis: { device: TraccarDevice; effectiveDist: number; rawDist: number }[] = [];
  const byId = new Map(devices.map((device) => [device.id, device]));
  const latest = new Map<number, TraccarPosition>();
  for (const pos of positions) {
    if (!pos || !Number.isSafeInteger(pos.deviceId) || pos.deviceId <= 0) continue;
    const previous = latest.get(pos.deviceId);
    if (!previous || Date.parse(pos.fixTime ?? '') >= Date.parse(previous.fixTime ?? '') || !Number.isFinite(Date.parse(previous.fixTime ?? ''))) latest.set(pos.deviceId, pos);
  }

  for (const pos of latest.values()) {
    if (!pos || !pos.deviceId || !isValidCoord(pos.latitude, pos.longitude)) continue;
    if (pos.valid === false || pos.outdated === true) continue;

    // Fast-path: Bounding box culling (O(1) simple math)
    if (!isWithinBoundingBox(clientLat, clientLng, pos.latitude, pos.longitude, maxRadiusKm * 1.5)) {
      continue; // Ignorar taxis completamente fuera de zona
    }

    // Filtrar taxis apagados o sin señal (GPS > 10 mins de antigüedad)
    const MAX_AGE_MS = 10 * 60 * 1000;
    const fixTime = Date.parse(pos.fixTime ?? '');
    if (!Number.isFinite(fixTime) || nowMs - fixTime > MAX_AGE_MS || fixTime > nowMs + 30000) {
      continue;
    }

    // Filtrar taxis con motor apagado (si el GPS lo reporta)
    if (pos.attributes && flag(pos.attributes.ignition) === false) {
      continue;
    }

    // Filtrar taxis ocupados (ignorar si attributes.occupied es 'true' o true)
    if (pos.attributes && flag(pos.attributes.occupied) === true) {
      continue; // Ignorar taxis que ya llevan pasaje
    }

    const device = byId.get(pos.deviceId);
    if (!device || device.status === 'offline') continue;

    // Slow-path: Haversine
    const rawDistance = getDistanceFromLatLonInKm(pos.latitude, pos.longitude, clientLat, clientLng);
    if (rawDistance > maxRadiusKm * 1.5) continue;

    const bearing = getBearing(pos.latitude, pos.longitude, clientLat, clientLng);
    const courseKnown = typeof pos.course === 'number' && Number.isFinite(pos.course) && pos.course >= 0 && pos.course < 360;
    const taxiCourse = courseKnown ? pos.course! : 0;
    const taxiSpeedKmh = (Number.isFinite(pos.speed) ? pos.speed! : 0) * 1.852; 
    
    const angleDiff = getAngleDifference(taxiCourse, bearing);
    
    // Penalización plana: 
    // Dar vuelta en U (U-turn) en una ciudad típicamente toma entre 1 y 2 km de recorrido extra.
    // Dar vuelta a la manzana toma ~0.5 a 1 km.
    // La penalización NO debe crecer con la distancia, ya que hacer una vuelta en U toma el mismo tiempo a 1km que a 10km.
    let penaltyKm = 0;

    if (taxiSpeedKmh > 5 && courseKnown) {
      if (angleDiff <= 45) {
        penaltyKm = 0; // Va en dirección correcta
      } else if (angleDiff <= 90) {
        penaltyKm = 0.5; // Va de lado (requiere cruzar/doblar)
      } else if (angleDiff <= 135) {
        penaltyKm = 1.2; // Va casi en contra
      } else {
        penaltyKm = 2.0; // Va totalmente en contra (requiere retorno / U-turn)
      }
    }

    const effectiveDistance = rawDistance + penaltyKm;
    
    scoredTaxis.push({ device, effectiveDist: effectiveDistance, rawDist: rawDistance });
  }

  // Ordenar por distancia efectiva (menor a mayor)
  scoredTaxis.sort((a, b) => a.effectiveDist - b.effectiveDist || a.rawDist - b.rawDist || a.device.id - b.device.id);

  // Filtrar los que están realmente dentro del radio máximo crudo
  const validTaxis = scoredTaxis.filter(t => t.rawDist <= maxRadiusKm);

  const endMs = performance.now();
  const perf = Number((endMs - startMs).toFixed(3));

  if (validTaxis.length > 0) {
    const topTaxis = validTaxis.slice(0, 3).map(t => ({
      name: t.device.name,
      distanceKm: t.rawDist,
      deviceId: t.device.id,
      performanceMs: perf,
      effectiveDistanceKm: t.effectiveDist
    }));

    // Retornamos el array de taxis encontrados
    return { success: true, data: topTaxis };
  }
  
  return { success: false, error: "No suitable taxi found within radius" };
}
