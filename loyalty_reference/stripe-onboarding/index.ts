import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import Stripe from 'https://esm.sh/stripe@14.10.0'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2023-10-16',
})

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const { restaurante_id } = await req.json()
    if (!restaurante_id) throw new Error("restaurante_id es requerido")

    // Usamos el cliente de service_role para operaciones
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: restData, error: dbError } = await serviceClient
      .from('restaurantes')
      .select('stripe_account_id, admin_id')
      .eq('id', restaurante_id)
      .single()

    if (dbError) throw new Error("Error en DB: " + dbError.message)
    if (!restData) throw new Error("Restaurante no existe en base de datos")

    let accountId = restData.stripe_account_id

    // Si no tiene cuenta, crearla
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'standard',
      });
      accountId = account.id

      // Guardar en DB
      await serviceClient
        .from('restaurantes')
        .update({ stripe_account_id: accountId })
        .eq('id', restaurante_id)
    }

    // Generar link de onboarding
    const origin = req.headers.get('origin') || 'https://restaurantes-app-estrella.shop'
    
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/perfil?tab=pagos&refresh=true`,
      return_url: `${origin}/perfil?tab=pagos&success=true`,
      type: 'account_onboarding',
    });

    return new Response(
      JSON.stringify({ url: accountLink.url }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
