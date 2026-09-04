// supabase/functions/track-position/index.ts
// Endpoint público que la página /track/:token consulta cada 5 segundos
// Devuelve la posición actual del taxi asignado al viaje, sin exponer credenciales de Traccar

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const TRACCAR_BASE = Deno.env.get('TRACCAR_URL') || 'https://taxis.estrella-eats.mx/api';
const TRACCAR_EMAIL = Deno.env.get('TRACCAR_EMAIL')!;
const TRACCAR_PASSWORD = Deno.env.get('TRACCAR_PASSWORD')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Cacheamos la sesión de Traccar a nivel de módulo para no hacer login en cada poll de 5 segundos
// El Edge Function reutiliza el mismo proceso mientras esté caliente, así que esto funciona bien
let cachedCookie: string | null = null;
let cookieExpiry: number = 0;
const COOKIE_TTL_MS = 10 * 60 * 1000; // Renovamos sesión cada 10 minutos

async function getTraccarSession(): Promise<string> {
  if (cachedCookie && Date.now() < cookieExpiry) return cachedCookie;

  const loginRes = await fetch(`${TRACCAR_BASE}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(TRACCAR_EMAIL)}&password=${encodeURIComponent(TRACCAR_PASSWORD)}`,
  });

  const cookie = loginRes.headers.get('set-cookie');
  if (!cookie) throw new Error('Sin sesión de Traccar');

  cachedCookie = cookie;
  cookieExpiry = Date.now() + COOKIE_TTL_MS;
  return cookie;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token');

    if (!token) {
      return new Response(JSON.stringify({ error: 'Token requerido' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    // Buscar el viaje por su token
    const { data: viaje, error } = await supabase
      .from('viajes')
      .select('device_id, taxi_name, origen, destino, origen_lat, origen_lng, estado, cliente_tel, created_at')
      .eq('token', token)
      .maybeSingle();

    if (error || !viaje) {
      return new Response(JSON.stringify({ error: 'Viaje no encontrado' }), {
        status: 404, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    // Obtener sesión de Traccar (reutiliza la misma por 10 minutos para no hacer login en cada poll)
    const cookie = await getTraccarSession();

    // Obtener solo la posición del dispositivo asignado a este viaje
    const posRes = await fetch(`${TRACCAR_BASE}/positions?deviceId=${viaje.device_id}`, {
      headers: { 'Cookie': cookie }
    });

    const positions = posRes.ok ? await posRes.json() : [];
    const pos = positions[0] || null;

    return new Response(JSON.stringify({
      taxi: {
        name: viaje.taxi_name,
        lat: pos?.latitude ?? null,
        lng: pos?.longitude ?? null,
        speed: pos?.speed ?? 0,
        course: pos?.course ?? 0,
        lastUpdate: pos?.fixTime ?? null,
      },
      viaje: {
        origen: viaje.origen,
        destino: viaje.destino,
        origen_lat: viaje.origen_lat,
        origen_lng: viaje.origen_lng,
        estado: viaje.estado,
        createdAt: viaje.created_at,
      }
    }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    console.error('[TRACK] Error:', err?.message);
    return new Response(JSON.stringify({ error: err?.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
});
