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
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    )

    const { restaurante_id, ticket_id, items, costo_envio = 0 } = await req.json()
    
    if (!restaurante_id || !items || items.length === 0) {
      throw new Error("Faltan parámetros requeridos")
    }

    // Obtener cuenta conectada de Stripe
    const { data: restData, error: dbError } = await supabaseClient
      .from('restaurantes')
      .select('stripe_account_id, nombre')
      .eq('id', restaurante_id)
      .single()

    if (dbError || !restData) throw new Error("Restaurante no encontrado")
    if (!restData.stripe_account_id) {
      throw new Error("El restaurante aún no puede recibir pagos con tarjeta (Cuenta no vinculada)")
    }

    const lineItems = items.map((item: any) => ({
      price_data: {
        currency: 'mxn',
        product_data: {
          name: item.nombre,
          description: item.variante ? `Opción: ${item.variante}` : undefined,
        },
        unit_amount: Math.round(item.precio * 100),
      },
      quantity: item.cantidad,
    }))

    // Agregar el costo de envío como un item (si es > 0 y si no es un cargo directo que sume la comision en otra parte)
    // En Direct Charges, el cliente le paga todo al restaurante. 
    // Luego Stripe toma el application_fee_amount del pago total y se lo da a la plataforma.
    if (costo_envio > 0) {
      lineItems.push({
        price_data: {
          currency: 'mxn',
          product_data: { name: 'Costo de envío' },
          unit_amount: Math.round(costo_envio * 100),
        },
        quantity: 1,
      })
    }

    const applicationFee = Math.round(costo_envio * 100) // La ganancia de la plataforma es exactamente el costo de envío

    const origin = req.headers.get('origin') || 'https://restaurantes-app-estrella.shop'

    const sessionConfig: any = {
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}&ticket=${ticket_id}`,
      cancel_url: `${origin}/menu/${restaurante_id}?cancel=true`,
      client_reference_id: ticket_id,
    }

    // Solo cobramos application_fee si es mayor a 0
    if (applicationFee > 0) {
      sessionConfig.payment_intent_data = {
        application_fee_amount: applicationFee,
      }
    }

    // Crear la sesión de checkout EN LA CUENTA DEL RESTAURANTE (Direct Charge)
    const session = await stripe.checkout.sessions.create(sessionConfig, {
      stripeAccount: restData.stripe_account_id,
    });

    return new Response(
      JSON.stringify({ url: session.url, sessionId: session.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
