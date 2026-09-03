import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Manejar CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Obtener los datos del pedido desde el cliente
    const { 
      pedidoId,
      items, 
      costo_envio,
      descuento,
      total,
      originUrl,
      returnUrl,
      idempotencyKey
    } = await req.json()

    // Preparar el payload para Mercado Pago
    // 1. Intentar obtener el token del restaurante
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    let mpAccessToken = null

    // Obtenemos el ID del restaurante del pedido original para buscar su token
    const { data: pedidoData } = await supabaseClient
      .from('pedidos')
      .select('restaurante')
      .eq('wb_message_id', pedidoId)
      .single()

    let comisionPorcentaje = 0

    if (pedidoData?.restaurante) {
      const { data: restData } = await supabaseClient
        .from('restaurantes')
        .select('mp_access_token, comision_porcentaje')
        .eq('nombre', pedidoData.restaurante)
        .single()
      
      if (restData?.mp_access_token) {
        mpAccessToken = restData.mp_access_token
      }
      if (restData?.comision_porcentaje) {
        comisionPorcentaje = Number(restData.comision_porcentaje)
      }
    }

    // 2. Fallback al token global si el restaurante no ha vinculado su cuenta
    if (!mpAccessToken) {
      mpAccessToken = Deno.env.get('MP_ACCESS_TOKEN')
    }

    if (!mpAccessToken) throw new Error("MP_ACCESS_TOKEN no configurado. El restaurante debe vincular su cuenta de Mercado Pago.")

    const mpItems = items.map((item: any) => ({
      title: item.item.nombre,
      description: item.item.opcionesSeleccionadas?.map((o: any) => o.opcion).join(', ') || '',
      quantity: item.cantidad,
      unit_price: Number(item.item.precio),
      currency_id: "MXN"
    }))

    // Agregar costo de envío como un item extra si existe
    if (costo_envio > 0) {
      mpItems.push({
        title: "Costo de Envío",
        quantity: 1,
        unit_price: Number(costo_envio),
        currency_id: "MXN"
      })
    }

    // Para simplificar y evitar problemas con MP si el cupón causa precios negativos, mandamos un solo item condensado si hay descuento.
    let preferenceItems = mpItems;
    if (descuento > 0) {
      preferenceItems = [{
        title: `Pedido en Estrella Eats (Descuento aplicado -$${descuento})`,
        quantity: 1,
        unit_price: Number(total), // El total final calculado en el frontend y validado
        currency_id: "MXN"
      }];
    }

    // MP requiere HTTPS para back_urls, si es localhost usamos la URL de prod
    const isLocalhost = originUrl.includes('localhost') || originUrl.includes('127.0.0.1');
    const safeOriginUrl = isLocalhost ? 'https://restaurantes-app-estrella.shop' : originUrl;
    const safeReturnUrl = returnUrl || safeOriginUrl;
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://jdrrkpvodnqoljycixbg.supabase.co';

    // Cálculo de Marketplace Fee (Split de Pagos)
    // El restaurante absorbe los descuentos: Subtotal Productos = Total final - costo de envío
    const subtotalProductos = total - costo_envio; 
    const gananciaPlataforma = subtotalProductos * (comisionPorcentaje / 100);
    const marketplaceFee = costo_envio + gananciaPlataforma;

    const payload: any = {
      items: preferenceItems,
      back_urls: {
        success: `${safeOriginUrl}/success?pedido=${pedidoId}`,
        failure: `${safeReturnUrl}?error=pago_cancelado`,
        pending: `${safeReturnUrl}?error=pago_pendiente`
      },
      notification_url: `${supabaseUrl}/functions/v1/mercadopago-webhook?pedido=${pedidoId}`,
      auto_return: "approved",
      external_reference: pedidoId.toString(),
      statement_descriptor: "ESTRELLA EATS"
    }

    // Inyectar el marketplace_fee solo si el cobro se hace con el token del restaurante
    // (Si estamos usando el token fallback de la plataforma, todo el dinero cae a la plataforma de todos modos)
    if (marketplaceFee > 0 && mpAccessToken !== Deno.env.get('MP_ACCESS_TOKEN')) {
      payload.marketplace_fee = Number(marketplaceFee.toFixed(2));
    }

    // Configurar Headers, incluyendo Idempotency-Key si fue provisto
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${mpAccessToken}`,
      'Content-Type': 'application/json'
    }
    
    if (idempotencyKey) {
      headers['X-Idempotency-Key'] = idempotencyKey
    }

    // Llamar a la API de Mercado Pago
    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    })

    const mpData = await mpResponse.json()

    if (!mpResponse.ok) {
      console.error("Mercado Pago Error:", mpData)
      throw new Error(`Mercado Pago Error: ${mpData.message || mpData.error || 'Desconocido'}`)
    }

    // Retornar la URL de inicio
    return new Response(
      JSON.stringify({ 
        url: mpData.init_point, 
        sandbox_url: mpData.sandbox_init_point
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Error en mercadopago-checkout:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
