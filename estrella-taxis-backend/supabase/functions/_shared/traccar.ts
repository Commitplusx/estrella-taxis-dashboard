// _shared/traccar.ts
// Lógica compartida para comunicarse con la API de Traccar

export interface TraccarDevice {
  id: number;
  name: string;
  uniqueId: string;
  status?: string;
  lastUpdate?: string;
  positionId?: number;
  groupId?: number;
}

export interface TraccarPosition {
  id: number;
  deviceId: number;
  protocol?: string;
  serverTime?: string;
  deviceTime?: string;
  fixTime?: string;
  outdated?: boolean;
  valid?: boolean;
  latitude: number;
  longitude: number;
  altitude?: number;
  speed?: number;
  course?: number;
  address?: string;
}

const TRACCAR_BASE = Deno.env.get('TRACCAR_URL') || 'https://taxis.estrella-eats.mx/api';
const TRACCAR_EMAIL = Deno.env.get('TRACCAR_EMAIL')!;
const TRACCAR_PASSWORD = Deno.env.get('TRACCAR_PASSWORD')!;

async function traccarLogin(): Promise<string> {
  console.log(`[TRACCAR LOGIN] Intentando login en: ${TRACCAR_BASE}/session`);
  console.log(`[TRACCAR LOGIN] Email: ${TRACCAR_EMAIL}, Password length: ${TRACCAR_PASSWORD?.length}`);

  const res = await fetch(`${TRACCAR_BASE}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(TRACCAR_EMAIL)}&password=${encodeURIComponent(TRACCAR_PASSWORD)}`,
  });

  console.log(`[TRACCAR LOGIN] Status: ${res.status} ${res.statusText}`);
  
  // Log all headers to debug cookie issue
  const headersObj: Record<string, string> = {};
  res.headers.forEach((v, k) => { headersObj[k] = v; });
  console.log(`[TRACCAR LOGIN] Headers recibidos:`, JSON.stringify(headersObj));

  if (!res.ok) {
    const body = await res.text();
    console.error(`[TRACCAR LOGIN] Body de error:`, body);
    throw new Error(`Traccar login failed: ${res.status}`);
  }

  const cookie = res.headers.get('set-cookie');
  console.log(`[TRACCAR LOGIN] Cookie obtenida: ${cookie ? 'SÍ ✓' : 'NO ✗ - revisar headers arriba'}`);
  if (!cookie) throw new Error('No session cookie from Traccar');
  return cookie;
}

async function traccarGet<T>(cookie: string, path: string): Promise<T[]> {
  const res = await fetch(`${TRACCAR_BASE}${path}`, {
    headers: { 'Cookie': cookie },
  });
  if (!res.ok) {
    console.warn(`Traccar GET ${path} → ${res.status}`);
    return [];
  }
  return await res.json();
}

import { findOptimalTaxi } from "./algorithms/headingMatcher.ts";

export async function getNearestTaxi(lat: number, lng: number, permisos: Record<string, boolean> = {}): Promise<{ name: string; distanceKm: number; deviceId: number } | null> {
  try {
    const cookie = await traccarLogin();
    
    // Traer todos los dispositivos (taxis) y sus posiciones actuales
    const [devices, positions] = await Promise.all([
      traccarGet<TraccarDevice>(cookie, '/devices'),
      traccarGet<TraccarPosition>(cookie, '/positions')
    ]);

    // ── FEATURE FLAG: Enrutamiento Vectorial ──
    const usaVectorial = permisos.enrutamiento_vectorial !== false; // Activo por defecto a menos que se apague explícitamente

    if (usaVectorial) {
      console.log(`[FEATURE FLAGS] Usando Enrutamiento Vectorial (Heading Matcher).`);
      const result = findOptimalTaxi(devices, positions, lat, lng, 10);
      
      if (result.success) {
        console.log(`[TRACCAR] Taxi óptimo encontrado en ${result.data.performanceMs}ms: ${result.data.name} a ${result.data.distanceKm.toFixed(2)}km`);
        return { 
          name: result.data.name, 
          distanceKm: result.data.distanceKm, 
          deviceId: result.data.deviceId 
        };
      } else {
        console.warn(`[TRACCAR] No se asignó taxi por Vectorial: ${result.error}`);
        return null;
      }
    } else {
      console.log(`[FEATURE FLAGS] Enrutamiento vectorial apagado para esta empresa. (Lógica pendiente)`);
      return null;
    }
    
  } catch (e) {
    console.error('[TRACCAR] Error buscando taxi más cercano:', e);
  }
  
  return null;
}
