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
  phone?: string;
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
  attributes?: Record<string, unknown>;
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

export async function getNearestTaxi(lat: number, lng: number, permisos: Record<string, boolean> = {}): Promise<{ name: string; distanceKm: number; deviceId: number; phone?: string }[] | null> {
  try {
    const cookie = await traccarLogin();
    
    // Traer todos los dispositivos (taxis) y sus posiciones actuales
    const [devices, positions] = await Promise.all([
      traccarGet<TraccarDevice>(cookie, '/devices'),
      traccarGet<TraccarPosition>(cookie, '/positions')
    ]);

    // ── MODO DE PRUEBAS: Filtrar a unidades específicas ──
    const testUnits = ["POMPEYO1014", "POMPEYO0540"];
    const filteredDevices = devices.filter(d => testUnits.includes(d.name));
    
    if (filteredDevices.length > 0) {
       console.log(`[TEST MODE] Forzando asignación a unidades de prueba:`, filteredDevices.map(d => d.name));
       return filteredDevices.map(d => ({
          name: d.name,
          distanceKm: 0.1, // Fake distance para evitar que sea rechazado
          deviceId: d.id,
          phone: d.phone
       }));
    }

    // ── FEATURE FLAG: Enrutamiento Vectorial ──
    const usaVectorial = permisos.enrutamiento_vectorial !== false; // Activo por defecto a menos que se apague explícitamente

    if (usaVectorial) {
      console.log(`[FEATURE FLAGS] Usando Enrutamiento Vectorial (Heading Matcher).`);
      const result = findOptimalTaxi(devices, positions, lat, lng, 10);
      
      if (result.success) {
        const topTaxis = result.data;
        console.log(`[TRACCAR] ${topTaxis.length} taxis encontrados. El más cercano es ${topTaxis[0].name} a ${topTaxis[0].distanceKm.toFixed(2)}km`);
        return topTaxis.map((t) => {
          const device = devices.find(d => d.id === t.deviceId);
          return {
            name: t.name, 
            distanceKm: t.distanceKm, 
            deviceId: t.deviceId,
            phone: device?.phone
          };
        });
      } else {
        console.warn(`[TRACCAR] No se asignó taxi por Vectorial: ${result.error}`);
        return null;
      }
    } else {
      console.log(`[FEATURE FLAGS] Enrutamiento vectorial apagado para esta empresa. (Lógica pendiente)`);
      return null;
    }
    
  } catch (e) {
    console.error('[TRACCAR] Error buscando taxis más cercanos:', e);
  }
  
  return null;
}
