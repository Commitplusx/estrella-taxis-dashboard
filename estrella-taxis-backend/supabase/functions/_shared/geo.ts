import * as h3 from 'https://esm.sh/h3-js@4.1.0';
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

export interface GeoResolutionResult {
  error: boolean;
  message?: string;
  precio: number | null;
  nombre_zona: string;
  lat: number | null;
  lng: number | null;
}

interface LugarFrecuente {
  nombre: string;
  lat: number;
  lng: number;
  precio_fijo: number | null;
}

interface H3Zona {
  precio: number;
  nombre: string;
  h3_index: string;
}

// Adv 6 Fix: Caché de bias de ciudad para evitar 1 llamada extra a Google Maps por request.
// Las coordenadas de una ciudad no cambian. TTL de 1 hora por si acaso.
const _cityBiasCache = new Map<string, { lat: number; lng: number; ts: number }>();
const CITY_BIAS_TTL_MS = 60 * 60 * 1000;

export async function resolveLocation(
  supabase: SupabaseClient,
  address: string,
  ciudad = 'San Cristobal de las Casas, Chiapas, Mexico',
  tenantId?: string
): Promise<GeoResolutionResult> {
  const mapsKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
  
  if (!mapsKey) {
    console.error('[GEO] GOOGLE_MAPS_API_KEY no configurada');
    return { error: true, message: 'Falta llave de Google Maps', precio: null, nombre_zona: '', lat: null, lng: null };
  }

  try {
    let location = { lat: 0, lng: 0 };
    let isExactGPS = false; // Bug fix: variable estaba sin declarar
    let localPlaceName = '';
    let localPrecioFijo: number | null = null;
    const gpsMatch = address.match(/([+-]?\d{1,3}\.\d+),\s*([+-]?\d{1,3}\.\d+)/);

    if (gpsMatch) {
      location.lat = parseFloat(gpsMatch[1]);
      location.lng = parseFloat(gpsMatch[2]);
      isExactGPS = true;
      console.log(`[GEO] El origen es una coordenada GPS directa: ${location.lat}, ${location.lng}`);
    } else {
      // ── PASO 1: Diccionario Local ──────────────────────────────────────────────
      // Antes de llamar a Google Maps, buscamos si el cliente menciono
      // un apodo local registrado en la tabla lugares_frecuentes del tenant.
      // Esto resuelve frases como "el OXXO de la plaza", "la terminal", etc.
      let resolvedFromDictionary = false;

      if (tenantId) {
        const cleanAlias = address.toLowerCase().trim();
        const { data: localMatches } = await supabase
          .from('lugares_frecuentes')
          .select('nombre, lat, lng, precio_fijo')
          .eq('tenant_id', tenantId)
          .eq('activo', true)
          .ilike('alias', `%${cleanAlias}%`)
          .limit(1);

        if (localMatches && localMatches.length > 0) {
          const lugar = localMatches[0] as LugarFrecuente;
          location.lat = lugar.lat;
          location.lng = lugar.lng;
          localPlaceName = lugar.nombre;
          localPrecioFijo = lugar.precio_fijo;
          resolvedFromDictionary = true;
          console.log(`[GEO DICCIONARIO] Lugar local encontrado: "${lugar.nombre}" (${lugar.lat}, ${lugar.lng})`);
        }
      }

      // ── PASO 2: Google Maps (solo si el diccionario no resolvio) ─────────────
      if (!resolvedFromDictionary) {
        let biasLat = 16.2517;
        let biasLng = -92.1333;

        const cached = _cityBiasCache.get(ciudad);
        if (cached && (Date.now() - cached.ts) < CITY_BIAS_TTL_MS) {
          biasLat = cached.lat;
          biasLng = cached.lng;
          console.log(`[GEO] Bias de ciudad "${ciudad}" desde caché: ${biasLat}, ${biasLng}`);
        } else {
          try {
            const cityUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(ciudad)}&key=${mapsKey}`;
            const cityRes = await fetch(cityUrl);
            const cityData = await cityRes.json();
            if (cityData.status === 'OK' && cityData.results.length > 0) {
              biasLat = cityData.results[0].geometry.location.lat;
              biasLng = cityData.results[0].geometry.location.lng;
              _cityBiasCache.set(ciudad, { lat: biasLat, lng: biasLng, ts: Date.now() });
              console.log(`[GEO] Bias de ciudad "${ciudad}" resuelto y cacheado: ${biasLat}, ${biasLng}`);
            } else {
              console.warn(`[GEO] No se pudo geocodificar la ciudad "${ciudad}", usando Comitan como fallback.`);
            }
          } catch (cityErr) {
            console.warn('[GEO] Error geocodificando ciudad, usando fallback:', cityErr);
          }
        }

        const searchQuery = encodeURIComponent(`${address}`);
        const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${searchQuery}%20en%20${encodeURIComponent(ciudad)}&location=${biasLat},${biasLng}&radius=15000&key=${mapsKey}`;

        const geoRes = await fetch(url);
        const geoData = await geoRes.json();

        if (geoData.status !== 'OK' || !geoData.results || geoData.results.length === 0) {
          return { error: true, message: 'No se encontro la direccion en el mapa.', precio: null, nombre_zona: '', lat: null, lng: null };
        }
        location = geoData.results[0].geometry.location;
      }
    } // end else (no GPS, lookup via dictionary or Google Maps)

    const centerHex = h3.latLngToCell(location.lat, location.lng, 10);
    const nearbyHexes = h3.gridDisk(centerHex, 3);

    const { data: zonas } = await supabase
      .from('h3_zonas')
      .select('precio, nombre, h3_index')
      .in('h3_index', nearbyHexes);


    // Si el lugar tenia un precio fijo en el diccionario, lo usamos de prioridad
    if (localPrecioFijo !== null) {
      console.log(`[GEO DICCIONARIO] Usando precio fijo del diccionario: $${localPrecioFijo}`);
      return {
        error: false,
        precio: localPrecioFijo,
        nombre_zona: localPlaceName || 'Lugar local',
        lat: location.lat,
        lng: location.lng
      };
    }

    if (!zonas || zonas.length === 0) {
      return { error: false, precio: null, nombre_zona: localPlaceName || 'Desconocida', lat: location.lat, lng: location.lng };
    }

    const bestMatchHex = nearbyHexes.find((hex: string) => (zonas as H3Zona[]).some((z) => z.h3_index === hex));
    const matchedZona = (zonas as H3Zona[]).find((z) => z.h3_index === bestMatchHex);

    if (matchedZona) {
      console.log(`[GEO SUCCESS] Zona H3 encontrada: ${matchedZona.nombre} a $${matchedZona.precio}`);
      return { error: false, precio: matchedZona.precio, nombre_zona: localPlaceName || matchedZona.nombre, lat: location.lat, lng: location.lng };
    }

    return { error: false, precio: null, nombre_zona: localPlaceName || 'Desconocida', lat: location.lat, lng: location.lng };
  } catch (err) {
    console.error('[GEO ERROR]', err);
    return { error: true, message: 'Error de conexión con mapas.', precio: null, nombre_zona: '', lat: null, lng: null };
  }
}

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const mapsKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
  if (!mapsKey) return `${lat},${lng}`;

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${mapsKey}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status === 'OK' && data.results && data.results.length > 0) {
      return data.results[0].formatted_address;
    }
    return `${lat},${lng}`;
  } catch (err) {
    console.error('[REVERSE GEOCODE ERROR]', err);
    return `${lat},${lng}`;
  }
}
