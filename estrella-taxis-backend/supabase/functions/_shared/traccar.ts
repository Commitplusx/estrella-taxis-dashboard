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

// Bug 7 Fix: Caché de sesión de Traccar para evitar login en cada petición.
// Las sesiones de Traccar duran ~30 min; renovamos a los 14 para tener margen.
let _traccarSession: { cookie: string; expiresAt: number } | null = null;

async function traccarLogin(): Promise<string> {
  const now = Date.now();
  if (_traccarSession && _traccarSession.expiresAt > now) {
    console.log(`[TRACCAR LOGIN] Usando sesión cacheada (expira en ${Math.round((_traccarSession.expiresAt - now) / 1000)}s)`);
    return _traccarSession.cookie;
  }

  console.log(`[TRACCAR LOGIN] Iniciando nueva sesión en: ${TRACCAR_BASE}/session`);
  const res = await fetch(`${TRACCAR_BASE}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(TRACCAR_EMAIL)}&password=${encodeURIComponent(TRACCAR_PASSWORD)}`,
  });

  console.log(`[TRACCAR LOGIN] Status: ${res.status} ${res.statusText}`);

  if (!res.ok) {
    const body = await res.text();
    console.error(`[TRACCAR LOGIN] Body de error:`, body);
    throw new Error(`Traccar login failed: ${res.status}`);
  }

  const cookie = res.headers.get('set-cookie');
  if (!cookie) throw new Error('No session cookie from Traccar');

  // Guardar en caché por 14 minutos
  _traccarSession = { cookie, expiresAt: now + 14 * 60 * 1000 };
  console.log(`[TRACCAR LOGIN] Sesión nueva guardada en caché (expira en 14 min)`);
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
