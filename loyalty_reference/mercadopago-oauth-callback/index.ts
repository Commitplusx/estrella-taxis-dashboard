import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

serve(async (req) => {
  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')

    if (!code || !state) {
      return new Response("Falta code o state", { status: 400 })
    }

    // Decodificar el state para obtener el restaurante_id
    const stateData = JSON.parse(atob(state))
    const restaurante_id = stateData.restaurante_id

    const mpAppId = Deno.env.get('MP_APP_ID')
    const mpClientSecret = Deno.env.get('MP_CLIENT_SECRET')
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    if (!mpAppId || !mpClientSecret) throw new Error("Faltan credenciales de MP en el servidor")

    const redirectUri = `${supabaseUrl}/functions/v1/mercadopago-oauth-callback`

    // Intercambiar código por token
    const tokenResponse = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: new URLSearchParams({
        client_secret: mpClientSecret,
        client_id: mpAppId,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri
      })
    })

    const tokenData = await tokenResponse.json()

    if (!tokenResponse.ok) {
      console.error("Error obteniendo token:", tokenData)
      throw new Error("No se pudo completar la vinculación con Mercado Pago")
    }

    // Guardar tokens en la base de datos
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    const { error: dbError } = await supabaseAdmin
      .from('restaurantes')
      .update({
        mp_access_token: tokenData.access_token,
        mp_refresh_token: tokenData.refresh_token,
        mp_user_id: tokenData.user_id.toString(),
        acepta_pago_online: true
      })
      .eq('id', restaurante_id)

    if (dbError) throw new Error(`Error guardando credenciales: ${dbError.message}`)

    // Redirigir al dashboard con éxito
    // Asumimos que el dashboard está en el dominio principal
    // Para no quemar el dominio en código, podemos usar una variable de entorno o regresar al origen de la request.
    const clientUrl = Deno.env.get('CLIENT_URL') || 'https://restaurantes-app-estrella.shop'
    
    return Response.redirect(`${clientUrl}/dashboard?mp_success=true`, 302)

  } catch (error: any) {
    console.error('OAuth Callback Error:', error)
    return new Response(
      `Error de vinculación: ${error.message}. Por favor contacta a soporte.`,
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }
})
