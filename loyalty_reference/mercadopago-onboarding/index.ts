import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error("Falta token de autorización")

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    
    // Autenticar al usuario
    const supabaseClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } }
    })

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token)
    if (userError || !user) throw new Error(`Usuario no autenticado: ${userError?.message || 'Sin usuario'}. Revisa que tu sesión esté activa.`)

    // Obtener el restaurante del usuario (simplificado, asumiendo 1 a 1 por ahora o recibiendo en el body)
    const { restaurante_id } = await req.json()
    if (!restaurante_id) throw new Error("Falta el ID del restaurante")

    // Generar la URL de OAuth de Mercado Pago
    const mpAppId = Deno.env.get('MP_APP_ID')
    if (!mpAppId) throw new Error("MP_APP_ID no configurado")

    // Generamos un random state para seguridad (podemos mandar el restaurante_id aquí)
    const state = btoa(JSON.stringify({ restaurante_id }))
    
    // La URI debe estar registrada en Mercado Pago
    const redirectUri = `${supabaseUrl}/functions/v1/mercadopago-oauth-callback`

    const url = `https://auth.mercadopago.com/authorization?client_id=${mpAppId}&response_type=code&platform_id=mp&state=${state}&redirect_uri=${redirectUri}`

    return new Response(
      JSON.stringify({ url }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
