import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  let cors: Record<string, string> = corsHeaders
  try {
    const utils = await import('../_shared/utils.ts')
    cors = utils.getCorsHeaders(req)
  } catch(e) {}

  // CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)
    const { rateLimit, rateLimitResponse } = await import('../_shared/utils.ts')

    // Parsear el body
    const { clienteTel, tipo, montoPedido, saldoAUsar, restaurante } = await req.json()

    if (!clienteTel || !tipo) {
      throw new Error('Faltan parámetros requeridos (clienteTel, tipo)')
    }

    // Rate limiting: máx 10 canjes por teléfono por hora
    if (clienteTel) {
      const cleanTel = String(clienteTel).replace(/\D/g, '')
      const rl = await rateLimit(supabase, `canjear:${cleanTel}`, 10, 3600)
      if (!rl.allowed) return rateLimitResponse(cors, rl.resetAt)
    }

    // Ejecutar la función atómica que maneja todo de forma segura
    const { data: result, error: rpcError } = await supabase.rpc('fn_canjear_beneficio', {
      p_cliente_tel: clienteTel,
      p_tipo: tipo, // 'envio_normal' | 'envio_vip' | 'billetera'
      p_monto_pedido: montoPedido || 0,
      p_saldo_a_usar: saldoAUsar || 0,
      p_restaurante: restaurante || null
    })

    if (rpcError) {
      console.error("Error en fn_canjear_beneficio:", rpcError)
      throw rpcError
    }

    // El RPC retorna: { ok: true, codigo: "CANJE-...", valor_pesos: X, ... }
    if (!result || !result.ok) {
      return new Response(
        JSON.stringify({ success: false, error: result?.error || 'Error desconocido al canjear' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Notificar al cliente vía WhatsApp (en background, no bloqueamos la respuesta HTTP)
    const payloadNotificacion = {
      tipo: 'cupon_generado',
      cliente_tel: clienteTel,
      cliente_nombre: result.cliente_nombre || 'Cliente',
      codigo_cupon: result.codigo,
      descuento: result.valor_pesos,
      expires_at: result.expires_at,
      tipo_canje: tipo
    }

    // BUG FIX: Wrap in EdgeRuntime.waitUntil to prevent background task cancellation
    // @ts-ignore
    EdgeRuntime.waitUntil(
      supabase.functions.invoke('notificar-whatsapp', {
        body: payloadNotificacion
      }).catch((err: any) => console.error("Error disparando notificar-whatsapp:", err))
    )

    return new Response(
      JSON.stringify({ success: true, ...result }),
      { headers: { ...cors, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error: any) {
    const { logError } = await import('../_shared/utils.ts')
    console.error("Error Edge Function canjear-puntos:", error)
    await logError('canjear-puntos', `Unhandled error: ${error.message}`, { stack: error.stack }, 'high')
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...cors, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
