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

export async function resolveLocation(
  supabase: SupabaseClient,
  address: string,
  ciudad = 'San Cristobal de las Casas, Chiapas, Mexico'
): Promise<GeoResolutionResult> {
  const mapsKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
  
  if (!mapsKey) {
    console.error('[GEO] GOOGLE_MAPS_API_KEY no configurada');
    return { error: true, message: 'Falta llave de Google Maps', precio: null, nombre_zona: '', lat: null, lng: null };
  }

  try {
    const searchQuery = encodeURIComponent(`${address}, ${ciudad}`);
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${searchQuery}&key=${mapsKey}`;
    
    const geoRes = await fetch(url);
    const geoData = await geoRes.json();
    
    if (geoData.status !== 'OK' || !geoData.results || geoData.results.length === 0) {
      return { error: true, message: 'No se encontró la dirección en el mapa.', precio: null, nombre_zona: '', lat: null, lng: null };
    }

    const location = geoData.results[0].geometry.location;
    const centerHex = h3.latLngToCell(location.lat, location.lng, 10);
    const nearbyHexes = h3.gridDisk(centerHex, 3);

    const { data: zonas } = await supabase
      .from('h3_zonas')
      .select('precio, nombre, h3_index')
      .in('h3_index', nearbyHexes);

    if (!zonas || zonas.length === 0) {
      return { error: false, precio: null, nombre_zona: 'Desconocida', lat: location.lat, lng: location.lng };
    }

    const bestMatchHex = nearbyHexes.find((hex: string) => zonas.some((z) => z.h3_index === hex));
    const matchedZona = zonas.find((z) => z.h3_index === bestMatchHex);

    if (matchedZona) {
      console.log(`[GEO SUCCESS] Zona H3 encontrada: ${matchedZona.nombre} a $${matchedZona.precio}`);
      return { error: false, precio: matchedZona.precio, nombre_zona: matchedZona.nombre, lat: location.lat, lng: location.lng };
    }

    return { error: false, precio: null, nombre_zona: 'Desconocida', lat: location.lat, lng: location.lng };
  } catch (err) {
    console.error('[GEO ERROR]', err);
    return { error: true, message: 'Error de conexión con mapas.', precio: null, nombre_zona: '', lat: null, lng: null };
  }
}
