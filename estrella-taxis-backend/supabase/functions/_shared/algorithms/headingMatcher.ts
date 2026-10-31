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

export interface TaxiSelectionOptions {
  /** A parked taxi can still receive an offer; the driver decides whether to take it. */
  allowIgnitionOff?: boolean;
  /** Permit an offline Traccar device only when its last valid fix is this recent. */
  allowOfflineFixAgeMs?: number;
  /** Explicit taxi policy; generic tracking callers retain their existing ten-minute limit. */
  maxPositionAgeMs?: number;
  maxStationaryMs?: number;
  maxHeadingAgeMs?: number;
  /** Optional read-only explanation of the exact production decisions. */
  onDecision?: (decision: TaxiSelectionDecision) => void;
}
export type TaxiSelectionReason = 'invalid_gps'|'outside_radius'|'stale_gps'|'idle_timeout'|'future_gps'|'outdated_gps'|'ignition_off'|'occupied'|'occupancy_unknown'|'offline'|'selected'|'ranked';
export interface TaxiSelectionDecision {
  deviceId:number;reason:TaxiSelectionReason;rank:number|null;distanceKm:number|null;penaltyKm:number|null;effectiveDistanceKm:number|null;
}

export function findOptimalTaxi(
  devices: TraccarDevice[], 
  positions: TraccarPosition[], 
  clientLat: number, 
  clientLng: number,
  maxRadiusKm: number = 10,
  nowMs: number = Date.now(),
  options: TaxiSelectionOptions = {},
): Result<OptimalTaxiResult[]> {
  const startMs = performance.now();
  
  if (!Array.isArray(positions) || positions.length === 0) return { success: false, error: "No positions available" };
  if (!Array.isArray(devices) || devices.length === 0) return { success: false, error: "No devices available" };
  if (!isValidCoord(clientLat, clientLng)) return { success: false, error: "Invalid client coordinates" };
  if (!Number.isFinite(nowMs) || !Number.isFinite(maxRadiusKm) || maxRadiusKm <= 0 || maxRadiusKm > 100 || devices.length > 50000 || positions.length > 100000) {
    return { success: false, error: "Invalid dispatch limits" };
  }
  const allowOfflineFixAgeMs = options.allowOfflineFixAgeMs ?? 0;
  const maxPositionAgeMs=options.maxPositionAgeMs??10*60*1000;
  const maxStationaryMs=options.maxStationaryMs??null,maxHeadingAgeMs=options.maxHeadingAgeMs??maxPositionAgeMs;
  if (!Number.isSafeInteger(maxPositionAgeMs)||maxPositionAgeMs<=0||maxPositionAgeMs>30*60*1000||!Number.isSafeInteger(allowOfflineFixAgeMs) || allowOfflineFixAgeMs < 0 || allowOfflineFixAgeMs > maxPositionAgeMs||maxStationaryMs!==null&&(!Number.isSafeInteger(maxStationaryMs)||maxStationaryMs<=0||maxStationaryMs>30*60*1000)||!Number.isSafeInteger(maxHeadingAgeMs)||maxHeadingAgeMs<0||maxHeadingAgeMs>maxPositionAgeMs) {
    return { success: false, error: "Invalid dispatch availability policy" };
  }

  const report = (deviceId:number,reason:TaxiSelectionReason) => options.onDecision?.({deviceId,reason,rank:null,distanceKm:null,penaltyKm:null,effectiveDistanceKm:null});
  const scoredTaxis: { device: TraccarDevice; effectiveDist: number; rawDist: number;penaltyKm:number }[] = [];
  const byId = new Map(devices.map((device) => [device.id, device]));
  const latest = new Map<number, TraccarPosition>();
  for (const pos of positions) {
    if (!pos || !Number.isSafeInteger(pos.deviceId) || pos.deviceId <= 0) continue;
    const previous = latest.get(pos.deviceId);
    if (!previous || Date.parse(pos.fixTime ?? '') >= Date.parse(previous.fixTime ?? '') || !Number.isFinite(Date.parse(previous.fixTime ?? ''))) latest.set(pos.deviceId, pos);
  }

  for (const pos of latest.values()) {
    if (!pos || !pos.deviceId || !isValidCoord(pos.latitude, pos.longitude)) {if(pos?.deviceId)report(pos.deviceId,'invalid_gps');continue;}
    if (pos.valid === false) {report(pos.deviceId,'invalid_gps');continue;}

    // Fast-path: Bounding box culling (O(1) simple math)
    if (!isWithinBoundingBox(clientLat, clientLng, pos.latitude, pos.longitude, maxRadiusKm * 1.5)) {
      report(pos.deviceId,'outside_radius');continue;
    }

    // Filtrar taxis apagados o sin señal (GPS > 10 mins de antigüedad)
    const fixTime = Date.parse(pos.fixTime ?? '');
    const fixAgeMs = nowMs - fixTime;
    if (!Number.isFinite(fixTime) || fixAgeMs > maxPositionAgeMs || fixAgeMs < -30000) {
      report(pos.deviceId,fixAgeMs < -30000?'future_gps':'stale_gps');continue;
    }

    const stationarySince=pos.attributes?.taxiStationarySinceMs;
    if(maxStationaryMs!==null&&typeof stationarySince==='number'&&nowMs-stationarySince>maxStationaryMs){report(pos.deviceId,'idle_timeout');continue;}

    if (pos.outdated === true && !(allowOfflineFixAgeMs > 0 && fixAgeMs <= allowOfflineFixAgeMs)) {report(pos.deviceId,'outdated_gps');continue;}

    // Filtrar taxis con motor apagado (si el GPS lo reporta)
    if (!options.allowIgnitionOff && pos.attributes && flag(pos.attributes.ignition) === false) {
      report(pos.deviceId,'ignition_off');continue;
    }

    // Only confirmed free telemetry is eligible. Missing/invalid occupancy is not free.
    if (!pos.attributes || flag(pos.attributes.occupied) !== false) {
      report(pos.deviceId,flag(pos.attributes?.occupied)===true?'occupied':'occupancy_unknown');continue;
    }

    const device = byId.get(pos.deviceId);
    if (!device) continue;
    if (device.status === 'offline' && !(allowOfflineFixAgeMs > 0 && fixAgeMs <= allowOfflineFixAgeMs)) {report(pos.deviceId,'offline');continue;}

    // Slow-path: Haversine
    const rawDistance = getDistanceFromLatLonInKm(pos.latitude, pos.longitude, clientLat, clientLng);
    if (rawDistance > maxRadiusKm * 1.5) {report(pos.deviceId,'outside_radius');continue;}

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

    if (taxiSpeedKmh > 5 && courseKnown && fixAgeMs<=maxHeadingAgeMs) {
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
    
    scoredTaxis.push({ device, effectiveDist: effectiveDistance, rawDist: rawDistance,penaltyKm });
  }

  // Ordenar por distancia efectiva (menor a mayor)
  scoredTaxis.sort((a, b) => a.effectiveDist - b.effectiveDist || a.rawDist - b.rawDist || a.device.id - b.device.id);

  // Filtrar los que están realmente dentro del radio máximo crudo
  const validTaxis = scoredTaxis.filter(t => t.rawDist <= maxRadiusKm);
  for(const taxi of scoredTaxis)if(taxi.rawDist>maxRadiusKm)report(taxi.device.id,'outside_radius');
  if(options.onDecision)validTaxis.forEach((taxi,index)=>options.onDecision?.({deviceId:taxi.device.id,reason:index<3?'selected':'ranked',rank:index+1,distanceKm:taxi.rawDist,penaltyKm:taxi.penaltyKm,effectiveDistanceKm:taxi.effectiveDist}));

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
