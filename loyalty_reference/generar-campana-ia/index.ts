import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY') || Deno.env.get('OPENAI_API_KEY')

    if (!DEEPSEEK_API_KEY) {
      throw new Error("Missing AI API Key (DEEPSEEK_API_KEY or OPENAI_API_KEY)")
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    
    let payload = {}
    if (req.method === 'POST') {
       payload = await req.json().catch(() => ({}))
    }
    const action = (payload as any).action

    if (action !== 'GENERATE_CAMPAIGN') {
       return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 1. Obtener datos para la IA
    
    // a) Clientes que han pedido (RFM)
    const { data: clientesData, error: errClientes } = await supabase.from('clientes').select('id, nombre, telefono, puntos, nivel, creado_en')
    if (errClientes) throw errClientes

    const { data: pedidosData, error: errPedidos } = await supabase.from('pedidos').select('cliente_telefono, restaurante_id, total, created_at').neq('estado', 'pendiente_pago')
    if (errPedidos) throw errPedidos

    // b) Restaurantes Activos
    const { data: restaurantesData, error: errRest } = await supabase.from('restaurantes').select('id, nombre, categorias').eq('activo', true)
    if (errRest) throw errRest

    // c) Usuarios con Push habilitado (para la estrategia de Adquisición C)
    const { data: pushData, error: errPush } = await supabase.from('push_subscriptions').select('telefono')
    if (errPush) throw errPush

    // Procesar datos para RFM
    const rfmMap = new Map<string, any>()
    clientesData.forEach((c: any) => {
      rfmMap.set(c.telefono, {
        nombre: c.nombre,
        telefono: c.telefono,
        puntos: c.puntos,
        pedidosCount: 0,
        totalGasto: 0,
        ultimoPedido: null,
        restaurantesFav: {}
      })
    })

    pedidosData.forEach((p: any) => {
      const tel = p.cliente_telefono
      if (rfmMap.has(tel)) {
        const client = rfmMap.get(tel)
        client.pedidosCount++
        client.totalGasto += parseFloat(p.total || 0)
        
        const currentLast = client.ultimoPedido ? new Date(client.ultimoPedido) : null
        const pDate = new Date(p.created_at)
        if (!currentLast || pDate > currentLast) {
           client.ultimoPedido = p.created_at
        }

        if (!client.restaurantesFav[p.restaurante_id]) client.restaurantesFav[p.restaurante_id] = 0
        client.restaurantesFav[p.restaurante_id]++
      }
    })

    // Lista final de clientes existentes con RFM
    const rfmList = Array.from(rfmMap.values()).map(c => {
       // simplificar restaurantes favoritos al más pedido
       let favId = null
       let maxP = 0
       for (const rid in c.restaurantesFav) {
          if (c.restaurantesFav[rid] > maxP) {
             maxP = c.restaurantesFav[rid]
             favId = rid
          }
       }
       const favName = favId ? restaurantesData.find((r:any) => r.id === favId)?.nombre : null
       return {
          telefono: c.telefono,
          nombre: c.nombre,
          pedidos: c.pedidosCount,
          gastoTotal: c.totalGasto,
          diasDesdeUltimoPedido: c.ultimoPedido ? Math.floor((Date.now() - new Date(c.ultimoPedido).getTime()) / (1000*3600*24)) : null,
          restauranteFavorito: favName,
          restauranteFavoritoId: favId
       }
    })

    // Leads (Push activado pero sin pedidos/sin registro en clientes)
    const leadsList: string[] = []
    pushData.forEach((sub: any) => {
       if (sub.telefono && !rfmMap.has(sub.telefono)) {
          leadsList.push(sub.telefono)
       }
    })
    const uniqueLeads = [...new Set(leadsList)]

    // Muestreo para no saturar tokens (solo enviamos max 20 perfiles al prompt para la demo)
    // En producción se haría en lotes o se calcularía la segmentación localmente.
    const sampleRFM = rfmList.slice(0, 15)
    const sampleLeads = uniqueLeads.slice(0, 5)
    const sampleRestaurantes = restaurantesData.map((r:any) => ({ id: r.id, nombre: r.nombre }))

    // 2. Prompt para Gemini/DeepSeek
    const prompt = `Eres el Cerebro de Marketing IA de Estrella Eats.
Tu objetivo es crear cupones y mensajes de retención y adquisición basados en el análisis RFM.

RESTAURANTES ACTIVOS DISPONIBLES:
${JSON.stringify(sampleRestaurantes, null, 2)}

PERFILES RFM DE CLIENTES EXISTENTES:
${JSON.stringify(sampleRFM, null, 2)}

NUEVOS LEADS (Solo tienen notificaciones activas, 0 pedidos):
${JSON.stringify(sampleLeads, null, 2)}

INSTRUCCIONES:
1. Analiza los perfiles RFM.
2. Si un cliente gasta mucho pero no ha pedido hace más de 7 días, dale un 25% de descuento en su restaurante favorito.
3. Si un cliente pide seguido, dale un "Envío Gratis" para un restaurante DIFERENTE a su favorito para que descubra nuevos lugares.
4. Para los NUEVOS LEADS, dales "Envío Gratis (Topado a $50)" en algún restaurante popular.
5. Crea un mensaje persuasivo y corto para cada uno (Push Notification).
6. Genera un "codigo" de cupón único y corto (ej. VIP25, ENVIOFREE, HOLA50).
7. Tipo de cupón debe ser "porcentaje" (valor 25) o "envio_gratis" (valor 50).

Genera un JSON ESTRICTO con la siguiente estructura:
{
  "campanas": [
    {
      "telefono": "10 digitos",
      "mensajePush": "Texto atractivo...",
      "restauranteId": "UUID del restaurante asignado",
      "codigoCupon": "CODIGO",
      "tipoCupon": "porcentaje | envio_gratis",
      "valorCupon": numero
    }
  ]
}
`

    const aiUrl = Deno.env.get('DEEPSEEK_API_KEY') ? 'https://api.deepseek.com/chat/completions' : 'https://api.openai.com/v1/chat/completions'
    const model = Deno.env.get('DEEPSEEK_API_KEY') ? 'deepseek-chat' : 'gpt-4o-mini'

    const resAI = await fetch(aiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2
      })
    })

    if (!resAI.ok) {
       throw new Error("AI API Error: " + await resAI.text())
    }

    const aiJson = await resAI.json()
    let content = aiJson.choices?.[0]?.message?.content?.trim()
    if (!content) throw new Error("Respuesta vacía de IA")

    content = content.replace(/```json/gi, '').replace(/```/g, '')
    const result = JSON.parse(content)

    const campanas = result.campanas || []
    const resultadosPush: any[] = []

    // 3. Crear cupones en la DB y disparar push
    for (const c of campanas) {
       // Insertar en la tabla cupones. 
       const { error: insertErr } = await supabase.from('cupones').insert({
          codigo: c.codigoCupon,
          tipo: c.tipoCupon,
          valor: c.valorCupon,
          restaurante_id: c.restauranteId,
          activo: true
       })

       if (insertErr && insertErr.code !== '23505') { 
          console.error("Error insertando cupon:", insertErr)
       }

       // Llamar a la Edge Function de Push dirigida
       const pushRes = await supabase.functions.invoke('enviar-push-marketing', {
          body: {
             title: '🎁 ¡Un regalo para ti!',
             body: c.mensajePush,
             target_phones: [c.telefono]
          }
       })

       resultadosPush.push({
          telefono: c.telefono,
          codigo: c.codigoCupon,
          pushStatus: pushRes.error ? 'error' : 'ok'
       })
    }

    return new Response(JSON.stringify({ success: true, campanas, resultadosPush }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error: any) {
    console.error(error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
