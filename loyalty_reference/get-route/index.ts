// supabase/functions/get-route/index.ts
// Proxy seguro para obtener Polyline desde Google Maps Directions API

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GOOGLE_MAPS_KEY = Deno.env.get('VITE_GOOGLE_MAPS_API_KEY') || Deno.env.get('GOOGLE_MAPS_KEY')

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  try {
    const { originLat, originLng, destLat, destLng } = await req.json()

    if (!originLat || !originLng || !destLat || !destLng) {
      return new Response(JSON.stringify({ error: 'Coordenadas faltantes' }), { status: 400, headers: CORS_HEADERS })
    }

    if (!GOOGLE_MAPS_KEY) {
      throw new Error('Google Maps API Key no configurada en los secrets')
    }

    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${originLat},${originLng}&destination=${destLat},${destLng}&key=${GOOGLE_MAPS_KEY}`

    const res = await fetch(url)
    const data = await res.json()

    if (data.status !== 'OK') {
      throw new Error(`Error de Google Maps: ${data.status} - ${data.error_message || ''}`)
    }

    const polyline = data.routes[0].overview_polyline.points
    const distanceText = data.routes[0].legs[0].distance.text
    const durationText = data.routes[0].legs[0].duration.text

    return new Response(JSON.stringify({ 
      ok: true, 
      polyline,
      distance: distanceText,
      duration: durationText
    }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })

  } catch (err: any) {
    console.error('[GET-ROUTE] Error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  }
})
