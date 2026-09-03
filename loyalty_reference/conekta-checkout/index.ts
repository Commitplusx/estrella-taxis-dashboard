import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from "../_shared/utils.ts"

serve(async (req) => {
  const cors = getCorsHeaders(req)
  
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    const body = await req.json()
    const { pedidoId, clienteNombre, clienteTel, restauranteNombre, lineItems, returnUrl } = body

    const CONEKTA_KEY = Deno.env.get('CONEKTA_PRIVATE_KEY')?.trim()
    const { rateLimit, rateLimitResponse } = await import('../_shared/utils.ts')
    const supabaseForRL = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    if (clienteTel) {
      const rl = await rateLimit(supabaseForRL, `checkout:${clienteTel}`, 5, 600)
      if (!rl.allowed) return rateLimitResponse(cors, rl.resetAt)
    }

    if (!CONEKTA_KEY) throw new Error('CONEKTA_PRIVATE_KEY is missing')

    const origin = req.headers.get('origin') || 'http://localhost:5173'
    const baseUrl = returnUrl || origin

    // Bug 3 fix: normalizar teléfono — quitar prefijo 52 si ya viene incluido
    const soloDigitos = (clienteTel || '').replace(/\D/g, '')
    const telNormalizado = soloDigitos.startsWith('52') && soloDigitos.length >= 12
      ? soloDigitos.slice(2)   // quitar el 52 inicial si ya tiene 12+ dígitos
      : soloDigitos

    const orderPayload = {
      currency: 'MXN',
      customer_info: {
        name: clienteNombre,
        phone: '+52' + telNormalizado,
        email: `cliente_${telNormalizado}@app-estrella.shop`
      },
      line_items: lineItems.map((item: any) => ({
        name: item.name,
        unit_price: Math.round(item.price * 100), 
        quantity: item.quantity
      })),
      checkout: {
        allowed_payment_methods: ["card", "bank_transfer"], 
        type: "HostedPayment",
        expires_at: Math.floor(Date.now() / 1000) + (3600 * 24), 
        name: `Pedido de ${restauranteNombre}`,
        needs_shipping_contact: false,
        success_url: `${baseUrl}?success=true&pedido=${pedidoId}`,
        failure_url: `${baseUrl}?success=false`
      },
      metadata: {
        pedido_id: pedidoId,
        restaurante: restauranteNombre
      }
    }

    const res = await fetch('https://api.conekta.io/orders', {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.conekta-v2.1.0+json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONEKTA_KEY}`
      },
      body: JSON.stringify(orderPayload)
    })

    const data = await res.json()
    if (!res.ok) {
      console.error('Conekta error:', data)
      throw new Error(data.details?.[0]?.message || 'Error al generar link de Conekta')
    }

    return new Response(JSON.stringify({ 
      checkoutUrl: data.checkout?.url, 
      conektaOrderId: data.id 
    }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error: any) {
    console.error(error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
