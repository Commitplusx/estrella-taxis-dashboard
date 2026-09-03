// supabase/functions/whatsapp-bot/index.ts
// WhatsApp AI Bot — Edge Function (Modular Architecture, Refactored)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { extract10Digits } from './db.ts'
import { handleCronEvent } from './cron-handler.ts'
import { sendWATemplate } from './whatsapp.ts'
import { processQueueItem } from './queue-processor.ts'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-auth, x-queue-auth, ycloud-signature',
  }

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  if (req.method === 'GET') {
    const url = new URL(req.url)
    return new Response(url.searchParams.get('hub.challenge') ?? 'Forbidden', {
      headers: corsHeaders,
      status: url.searchParams.has('hub.challenge') ? 200 : 403
    })
  }
  
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })

  // ── INTERNAL QUEUE WORKER (Fondo) ──
  const queueAuth = req.headers.get('x-queue-auth')
  if (queueAuth === SUPABASE_KEY) {
    try {
      const body = JSON.parse(await req.text())
      if (body.event === 'PROCESS_QUEUE' && body.queueId) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
        const { data } = await supabase.from('whatsapp_queue').select('payload').eq('id', body.queueId).single()
        if (data) {
          // Marcar como procesando
          await supabase.from('whatsapp_queue').update({ estado: 'procesando' }).eq('id', body.queueId)
          
          try {
            // EJECUTAR LÓGICA PESADA
            await processQueueItem(supabase, JSON.stringify(data.payload))
            // Marcar como completado
            await supabase.from('whatsapp_queue').update({ estado: 'completado' }).eq('id', body.queueId)
          } catch (e) {
            console.error('[WORKER ERROR]', e)
            await supabase.from('whatsapp_queue').update({ 
              estado: 'error', 
              error_log: String(e) 
            }).eq('id', body.queueId)
          }
        }
        return new Response('Queue Processed', { status: 200, headers: corsHeaders })
      }
    } catch (e) {
      console.error('Queue Processing Error:', e)
      return new Response('Queue Error', { status: 500, headers: corsHeaders })
    }
  }

  // ── CRON JOBS INTERNOS ──
  const cronAuth = req.headers.get('x-cron-auth')
  if (cronAuth !== null) {
    const cronSecret = Deno.env.get('CRON_SECRET')
    if (cronSecret && cronAuth !== cronSecret) {
      return new Response('Unauthorized Cron Call', { status: 401, headers: corsHeaders })
    }
    try {
      const body     = JSON.parse(await req.text())
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
      const cronRes  = await handleCronEvent(supabase, body)
      if (cronRes) {
        for (const [k, v] of Object.entries(corsHeaders)) cronRes.headers.set(k, v)
        return cronRes
      }
      return new Response('Cron Processed', { status: 200, headers: corsHeaders })
    } catch (e) {
      console.error('CRON Error:', e)
      return new Response('Cron Error', { status: 500, headers: corsHeaders })
    }
  }

  // ── APP RPC (FLUTTER) ──
  const authHeader = req.headers.get('Authorization')
  if (authHeader) {
    try {
      const body = JSON.parse(await req.text())
      if (body.action === 'enviar_terminos') {
        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
        const { telefono, nombre } = body
        if (!telefono) return new Response('Missing telefono', { status: 400 })
        const tel10 = extract10Digits(telefono)
        const resTemplate = await sendWATemplate(`52${tel10}`, 'estrella_terminos_condiciones', [nombre ?? 'Cliente Express'])
        if (!resTemplate.ok) return new Response(resTemplate.error, { status: 500 })
        return new Response('OK', { status: 200 })
      }
      if (body.action === 'aprender_ubicacion') {
        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
        const { pedido_id, lat, lng } = body
        const { data: pedido } = await supabase.from('pedidos').select('cliente_tel, direccion').eq('id', pedido_id).single()
        
        if (pedido && pedido.direccion && pedido.cliente_tel) {
          const { data: perfil } = await supabase.from('cliente_perfiles').select('ubicaciones_semanticas').eq('cliente_telefono', pedido.cliente_tel).single()
          let ubicaciones = perfil?.ubicaciones_semanticas || []
          if (!Array.isArray(ubicaciones)) ubicaciones = []
          
          const exists = ubicaciones.find((u: any) => u.nombre?.toLowerCase() === pedido.direccion.toLowerCase())
          if (!exists) {
            ubicaciones.push({
              nombre: pedido.direccion,
              lat: lat,
              lng: lng,
              direccion_oficial: "Ubicación aprendida por el repartidor"
            })
            await supabase.from('cliente_perfiles').upsert({
              cliente_telefono: pedido.cliente_tel,
              ubicaciones_semanticas: ubicaciones,
              updated_at: new Date().toISOString()
            }, { onConflict: 'cliente_telefono' })
          }
        }
        return new Response('OK', { status: 200 })
      }
      return new Response('Unknown Action', { status: 400 })
    } catch (e) {
      console.error('RPC Error:', e)
      return new Response('RPC Error', { status: 500 })
    }
  }

  // ── VALIDACIÓN HMAC (YCloud) ──
  let bodyText = ''
  try { bodyText = await req.text() } catch { return new Response('Bad Request Body', { status: 400, headers: corsHeaders }) }

  const yCloudSecret = Deno.env.get('YCLOUD_WEBHOOK_SECRET')
  if (yCloudSecret) {
    const yCloudSig = req.headers.get('ycloud-signature') || req.headers.get('YCloud-Signature')
    if (!yCloudSig) return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    try {
      const parts     = yCloudSig.split(',')
      const timestamp = parts[0]?.split('=')?.[1] || ''
      const signature = parts[1]?.split('=')?.[1] || ''
      const signedPayload = `${timestamp}.${bodyText}`
      const encoder   = new TextEncoder()
      const key       = await crypto.subtle.importKey('raw', encoder.encode(yCloudSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      const macBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload))
      const computed  = Array.from(new Uint8Array(macBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
      if (computed !== signature) return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    } catch (hmacErr) {
      console.error('[HMAC] Verification error:', hmacErr)
      return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    }
  }

  // ── ENCOLAR MENSAJE (QUEUE) ──
  try {
    const body = JSON.parse(bodyText)
    console.log(`[RAW WEBHOOK] type=${body?.type}, containsInboundMessage=${!!body?.whatsappInboundMessage}`)

    // Solo nos interesan los mensajes entrantes para encolar
    if (body?.object === 'whatsapp_business_account' || body?.type === 'whatsapp.inbound_message.received' || body?.type === 'whatsapp.message.updated' || body?.entry) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
      
      const { data, error } = await supabase.from('whatsapp_queue').insert({
        payload: body,
        estado: 'pendiente'
      }).select('id').single()

      if (error) {
        console.error('Error insertando en whatsapp_queue:', error)
        // Fallback: procesar sincrónicamente si la BD falla
        await processQueueItem(supabase, bodyText)
      } else if (data) {
        // Disparar procesamiento asíncrono en background llamándonos a nosotros mismos
        const workerPromise = fetch(`${SUPABASE_URL}/functions/v1/whatsapp-bot`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-queue-auth': SUPABASE_KEY
          },
          body: JSON.stringify({ event: 'PROCESS_QUEUE', queueId: data.id })
        }).catch(e => console.error('Error disparando worker:', e))

        // Evitar que el Edge Runtime mate el fetch al retornar el 200 OK
        if (typeof (globalThis as any).EdgeRuntime !== 'undefined') {
          (globalThis as any).EdgeRuntime.waitUntil(workerPromise)
        }
      }
    }
  } catch (e) {
    console.error('Error encolando webhook:', e)
  }

  // ── RESPUESTA INMEDIATA ──
  // Meta requiere un 200 OK lo más rápido posible.
  return new Response('EVENT_RECEIVED', { status: 200, headers: corsHeaders })
})
