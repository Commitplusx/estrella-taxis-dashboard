// supabase/functions/asignacion-timeout/index.ts
// Esta función es llamada por Upstash QStash 15 segundos después de que se le ofreció un pedido a un repartidor.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, upstash-signature',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const QSTASH_TOKEN = Deno.env.get('QSTASH_TOKEN')!

const WA_TOKEN    = Deno.env.get('WHATSAPP_TOKEN')!
const WA_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID')!
const ADMIN_PHONES_RAW = Deno.env.get('ADMIN_PHONES') ?? Deno.env.get('ADMIN_PHONE') ?? ''
const ADMIN_PHONE_MAIN = (() => {
  const raw = ADMIN_PHONES_RAW.split(',').map(s => s.replace(/\D/g, '').slice(-10)).filter(s => s.length === 10)[0]
  return raw ? `52${raw}` : ''
})()

async function sendWA(to: string, body: string): Promise<void> {
  await fetch(`https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WA_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: body.substring(0, 4096) }
    })
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  // (Opcional) Aquí se podría verificar la firma `upstash-signature` usando @upstash/qstash
  // Para simplificar, confiaremos en que el endpoint es secreto o validaremos un token manual si se desea.

  try {
    const payload = await req.json()
    const { 
      ticket_id, 
      pedido_uuid,
      restaurante, 
      direccion, 
      total, 
      repartidor_actual_id, 
      repartidor_actual_nombre, 
      siguiente_repartidor_id, 
      siguiente_repartidor_nombre, 
      intento 
    } = payload

    if (!ticket_id) {
      return new Response(JSON.stringify({ error: 'ticket_id requerido' }), { status: 400, headers: CORS_HEADERS })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

    // 1. Revisar si el repartidor actual lo aceptó
    // Buscamos por UUID si está disponible, sino por wb_message_id (ticket corto)
    // Determinar si pedido_uuid es realmente un UUID para evitar crash de Supabase
    const isUuid = pedido_uuid && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(pedido_uuid);

    const { data: p } = isUuid
      ? await supabase.from('pedidos').select('repartidor_id, estado').eq('id', pedido_uuid).maybeSingle()
      : await supabase.from('pedidos').select('repartidor_id, estado').eq('wb_message_id', ticket_id).maybeSingle();
    
    // Si ya tiene repartidor y el estado es de alguien que ya lo tomó, IGNORAR (éxito)
    if (p && p.repartidor_id && ['aceptado', 'asignado', 'en_camino', 'recibido'].includes(p.estado)) {
      console.log(`[TIMEOUT IGNORADO] El pedido ${pedido_uuid || ticket_id} ya fue aceptado. Estado: ${p.estado}`);
      return new Response(JSON.stringify({ ok: true, status: 'ya_aceptado' }), { headers: CORS_HEADERS })
    }

    // MEJORA ZERO-WAIT: Si el repartidor de la BD no es el repartidor al que le caducó el tiempo,
    // significa que el pedido ya fue reasignado manualmente a otra persona. Abortamos para no robar el pedido.
    if (p && p.repartidor_id && p.repartidor_id !== repartidor_actual_id) {
      console.log(`[TIMEOUT ABORTADO] El pedido ${pedido_uuid || ticket_id} ya fue re-asignado a ${p.repartidor_id}.`);
      return new Response(JSON.stringify({ ok: true, status: 'ya_reasignado' }), { headers: CORS_HEADERS })
    }

    
    // Si fue cancelado por el cliente, IGNORAR
    if (p && p.estado === 'cancelado') {
      return new Response(JSON.stringify({ ok: true, status: 'cancelado' }), { headers: CORS_HEADERS })
    }

    // Si llegamos aquí, el pedido sigue "pagado", "preparando" o "rechazado". ¡El repartidor lo ignoró o rechazó!
    console.log(`[TIMEOUT] Repartidor ${repartidor_actual_nombre} ignoró/rechazó el pedido ${ticket_id}`);

    // Apagar la alarma del repartidor actual
    await supabase.channel('repartidores_ping').send({
      type: 'broadcast',
      event: 'order_canceled',
      payload: { target_driver_id: repartidor_actual_id, pedido_id: ticket_id }
    });

    // 2. ¿Tenemos un segundo repartidor en la fila?
    if (intento === 1 && siguiente_repartidor_id) {
      console.log(`[ROUND-ROBIN] Turno 2: Mandando a ${siguiente_repartidor_nombre}`);
      
      // Aseguramos que el estado regrese a algo neutro por si el anterior le dio "Rechazar"
      // LOCK / RESERVA INSTANTÁNEA: Bloqueamos el viaje para el Repartidor 2
      await supabase.from('pedidos').update({ 
        estado: 'ofrecido',
        repartidor_id: siguiente_repartidor_id 
      })
      .eq('id', pedido_uuid || ticket_id)
      .eq('repartidor_id', repartidor_actual_id); // <-- EL CANDADO MAGICO

      // Mandar Ping al Repartidor 2
      await supabase.channel('repartidores_ping').send({
        type: 'broadcast',
        event: 'order_offered',
        payload: { 
          target_driver_id: siguiente_repartidor_id, 
          pedido_id: pedido_uuid || ticket_id,
          restaurante: restaurante,
          direccion: direccion,
          total: total
        }
      });

      // FCM para despertar app del segundo repartidor en background
      try {
        const serviceAccountStr = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
        if (serviceAccountStr) {
          const { getMessaging } = await import('npm:firebase-admin@12.1.0/messaging');
          const { initializeApp, cert, getApps } = await import('npm:firebase-admin@12.1.0/app');
          if (getApps().length === 0) {
            initializeApp({ credential: cert(JSON.parse(serviceAccountStr)) });
          }
          await getMessaging().send({
            topic: `driver_${siguiente_repartidor_id}`,
            android: { priority: "high" },
            data: {
              tipo: "pedido_asignado",
              pedido_id: String(pedido_uuid || ticket_id || ''),
              restaurante: String(restaurante || 'Estrella'),
              click_action: "FLUTTER_NOTIFICATION_CLICK",
              target_driver_id: String(siguiente_repartidor_id || '')
            }
          });
        }
      } catch (e) {
        console.error("FCM Error in timeout", e);
      }

      // Programar a QStash de nuevo para otros 15s
      const qstashUrl = `https://qstash-us-east-1.upstash.io/v2/publish/${SUPABASE_URL}/functions/v1/asignacion-timeout`;
      await fetch(qstashUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${QSTASH_TOKEN}`,
          'Content-Type': 'application/json',
          'Upstash-Delay': '25s' // <-- CORREGIDO A 25s
        },
        body: JSON.stringify({
          ...payload,
          repartidor_actual_id: siguiente_repartidor_id,
          repartidor_actual_nombre: siguiente_repartidor_nombre,
          siguiente_repartidor_id: null,
          siguiente_repartidor_nombre: null,
          intento: 2
        })
      });

      return new Response(JSON.stringify({ ok: true, status: 'turno_2_iniciado' }), { headers: CORS_HEADERS })
    }

    // 3. Ya no hay más repartidores (Fallback a Admin)
    console.warn(`[TIMEOUT FATAL] Ningún repartidor aceptó el pedido ${ticket_id}`);
    
    // Limpiamos el bloqueo para que quede libre en la base de datos y vuelva al pool de búsqueda
    await supabase.from('pedidos').update({ 
        estado: 'buscando_repartidor', 
        repartidor_id: null 
    })
    .eq('id', pedido_uuid || ticket_id)
    .eq('repartidor_id', repartidor_actual_id); // <-- EVITA BORRAR ASIGNACIÓN MANUAL

    if (ADMIN_PHONE_MAIN) {
      await sendWA(ADMIN_PHONE_MAIN, `⏰ *Pedido #${ticket_id} sin aceptar*\n\nHan pasado 30s (2 intentos) y ningún repartidor aceptó.\n\n🍽️ ${restaurante}\n📍 ${direccion || 'Sin dirección'}\n💰 $${total}\n\nAsigna manualmente desde la app.`);
    }

    return new Response(JSON.stringify({ ok: true, status: 'fallback_admin_notificado' }), { headers: CORS_HEADERS })

  } catch (err: any) {
    console.error('[ASIGNACION-TIMEOUT] Error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS })
  }
})
