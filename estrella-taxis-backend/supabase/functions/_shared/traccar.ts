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
  const res = await fetch(`${TRACCAR_BASE}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(TRACCAR_EMAIL)}&password=${encodeURIComponent(TRACCAR_PASSWORD)}`,
  });

  if (!res.ok) throw new Error(`Traccar login failed: ${res.status}`);

  const cookie = res.headers.get('set-cookie');
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

// Fórmula de Haversine para calcular distancia en kilómetros entre dos coordenadas
function getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radio de la tierra en km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); 
  return R * c;
}

export async function getNearestTaxi(lat: number, lng: number): Promise<{ name: string; distanceKm: number } | null> {
  try {
    const cookie = await traccarLogin();
    
    // Traer todos los dispositivos (taxis) y sus posiciones actuales
    const [devices, positions] = await Promise.all([
      traccarGet<TraccarDevice>(cookie, '/devices'),
      traccarGet<TraccarPosition>(cookie, '/positions')
    ]);

    if (!positions || positions.length === 0) return null;

    let nearestTaxi: TraccarDevice | undefined;
    let minDistance = Infinity;

    // Buscar el dispositivo más cercano
    for (const pos of positions) {
      const device = devices.find(d => d.id === pos.deviceId);
      
      // Ignorar taxis apagados / offline
      if (!device || device.status === 'offline') continue;

      const distance = getDistanceFromLatLonInKm(lat, lng, pos.latitude, pos.longitude);
      if (distance < minDistance) {
        minDistance = distance;
        nearestTaxi = device;
      }
    }

    // Solo asignar si el taxi está a un máximo de 10 km
    if (nearestTaxi && minDistance <= 10) {
      console.log(`[TRACCAR] Taxi más cercano: ${nearestTaxi.name} a ${minDistance.toFixed(2)} km`);
      return { name: nearestTaxi.name, distanceKm: minDistance };
    } else if (nearestTaxi) {
      console.log(`[TRACCAR] Se encontró a ${nearestTaxi.name} pero está muy lejos (${minDistance.toFixed(2)} km). Se descarta.`);
    }
  } catch (e) {
    console.error('[TRACCAR] Error buscando taxi más cercano:', e);
  }
  
  return null;
}
