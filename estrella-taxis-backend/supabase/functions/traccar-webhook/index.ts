import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import * as h3 from "https://esm.sh/h3-js@4.1.0"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

Deno.serve(async (req) => {
  // Manejo de CORS (Preflight request)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const rawText = await req.text()
    if (!rawText) {
      console.log(`Petición sin body: ${req.method} ${req.url}`)
      return new Response("OK", { headers: corsHeaders, status: 200 })
    }

    let payload;
    try {
      payload = JSON.parse(rawText)
    } catch(e) {
      console.log("Payload no es JSON válido:", rawText)
      return new Response("OK", { headers: corsHeaders, status: 200 })
    }

    // Traccar a veces envía un array de eventos/posiciones
    const items = Array.isArray(payload) ? payload : [payload]

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    )

    for (const item of items) {
      const position = item.position || item
      const device = item.device || {}

      if (!position || position.latitude === undefined) continue;

      const deviceId = device.uniqueId || position.deviceUniqueId
      if (!deviceId) continue;

      const lat = position.latitude
      const lng = position.longitude
      const battery = position.attributes?.batteryLevel || null

      const h3Index = h3.latLngToCell(lat, lng, 10)
      console.log(`Upsert taxi ${deviceId}: ${lat}, ${lng} (H3: ${h3Index})`)

      const { error } = await supabaseClient
        .from("taxis")
        .upsert({
          device_id: deviceId,
          lat: lat,
          lng: lng,
          h3_index: h3Index,
          bateria: battery,
          activo: true
        }, { onConflict: "device_id" })

      if (error) console.error("Error BD:", error)
    }

    return new Response(JSON.stringify({ success: true, message: "Procesado" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    })
  } catch (error) {
    console.error("Error fatal en el webhook:", error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    })
  }
})

