import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { sendWhatsApp } from '../_shared/whatsapp.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Almacén en memoria para deduplicar retries de YCloud
const processedMessageIds = new Set<string>();

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    console.log('[YCLOUD WEBHOOK] Recibido payload:', JSON.stringify(payload, null, 2));

    if (payload.type === 'whatsapp.message.updated') {
      return new Response('Status update received', { status: 200, headers: corsHeaders });
    }

    // --- Acción desde el Dashboard Web: Notificar cambio de estado al cliente por WhatsApp ---
    if (payload.action === 'notify_order_status') {
      const { pedido_id, nuevo_estado } = payload;
      console.log(`[NOTIFY_STATUS] Solicitud desde Web: pedido=${pedido_id}, estado=${nuevo_estado}`);

      if (!pedido_id || !nuevo_estado) {
        return new Response(JSON.stringify({ error: 'Faltan parámetros' }), { status: 400, headers: corsHeaders });
      }

      const { data: pedidoInfo, error: pErr } = await supabase
        .from('pedidos')
        .select('*')
        .eq('id', pedido_id)
        .maybeSingle();

      if (pErr || !pedidoInfo) {
        console.error('[NOTIFY_STATUS] Pedido no encontrado:', pedido_id, pErr);
        return new Response(JSON.stringify({ error: 'Pedido no encontrado' }), { status: 404, headers: corsHeaders });
      }

      const { data: empresa } = await supabase
        .from('empresas')
        .select('*')
        .eq('id', pedidoInfo.tenant_id)
        .maybeSingle();

      const nombreEmpresa = empresa?.nombre_empresa || 'el restaurante';
      const toNumber = empresa?.telefono_whatsapp || empresa?.whatsapp_waba || '';
      const clientPhone = pedidoInfo.cliente_tel.startsWith('+') ? pedidoInfo.cliente_tel : `+${pedidoInfo.cliente_tel}`;
      const isPickup = (pedidoInfo.direccion_entrega || '').toLowerCase().includes('recoger');

      let mensajeCliente = '';

      if (nuevo_estado === 'preparando' || nuevo_estado === 'confirmado') {
        if (isPickup) {
          mensajeCliente = `👨‍🍳 *¡Tu pedido ha sido aceptado!* 🔥\n\nEn *${nombreEmpresa}* ya estamos preparando tu orden:\n📋 _${pedidoInfo.detalle_pedido}_\n\n🏬 *Modalidad:* Pasar a recoger en tienda\n⏳ *Estado:* En preparación en cocina\n\nTe avisaremos por aquí en cuanto esté listo y empacado para que pases a recogerlo. ¡Muchas gracias! 🙌`;
        } else {
          mensajeCliente = `👨‍🍳 *¡Tu pedido ha sido aceptado!* 🔥\n\nEn *${nombreEmpresa}* ya estamos preparando tu orden:\n📋 _${pedidoInfo.detalle_pedido}_\n\n🛵 *Modalidad:* Entrega a domicilio\n⏳ *Estado:* En preparación en cocina\n\nTe avisaremos por aquí en cuanto tu repartidor salga en camino. ¡Muchas gracias! 🙌`;
        }
      } else if (nuevo_estado === 'en_camino') {
        mensajeCliente = `🛵 *¡TU PEDIDO VA EN CAMINO!* 💨\n\nTu orden en *${nombreEmpresa}* acaba de salir de la cocina rumbo a tu domicilio.\n\n¡Ten listo tu método de pago! Buen provecho 😋`;
      } else if (nuevo_estado === 'entregado') {
        if (isPickup) {
          mensajeCliente = `🎉 *¡TU PEDIDO YA ESTÁ LISTO!* 🛍️\n\nTu orden en *${nombreEmpresa}* ya está lista y empacada.\n\n📍 Ya puedes pasar a recogerla a la sucursal cuando gustes.\n\n¡Te esperamos, buen provecho! 😋`;
        } else {
          mensajeCliente = `✅ *¡Pedido Entregado con Éxito!* 🎉\n\nEsperamos que disfrutes mucho tu comida de *${nombreEmpresa}*. ¡Gracias por tu preferencia y que tengas un excelente día! 😋`;
        }
      } else if (nuevo_estado === 'cancelado') {
        mensajeCliente = `❌ *Actualización de tu pedido*\n\nTu orden en *${nombreEmpresa}* fue cancelada por la cocina.\n\nSi deseas hacer algún cambio o pedir otra cosa, escríbenos por aquí con gusto.`;
      }

      if (mensajeCliente && clientPhone) {
        await sendWhatsApp(clientPhone, mensajeCliente, toNumber);
        console.log(`[NOTIFY_STATUS] WhatsApp enviado exitosamente a ${clientPhone} con estado: ${nuevo_estado}`);
      }

      return new Response(JSON.stringify({ success: true, notified: !!mensajeCliente }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // --- Acción administrativa: Cargar / sincronizar menú completo de un tenant ---
    if (payload.action === 'seed_menu') {
      const { tenant_id, items, prompt_personalizado } = payload;
      if (!tenant_id || !Array.isArray(items)) {
        return new Response(JSON.stringify({ error: 'Faltan tenant_id o items' }), { status: 400, headers: corsHeaders });
      }

      await supabase.from('catalogos').delete().eq('tenant_id', tenant_id);

      const { data: inserted, error: insErr } = await supabase.from('catalogos').insert(items).select('id');
      if (insErr) {
        console.error('[SEED_MENU ERROR]', insErr);
        return new Response(JSON.stringify({ error: insErr.message }), { status: 500, headers: corsHeaders });
      }

      if (prompt_personalizado) {
        await supabase.from('empresas').update({ prompt_personalizado }).eq('id', tenant_id);
      }

      return new Response(JSON.stringify({ success: true, count: inserted?.length }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // --- Mensajes entrantes de WhatsApp: Encolar de inmediato y responder 200 OK (< 200ms) ---
    if (payload.type === 'whatsapp.inbound_message' || payload.whatsappInboundMessage) {
      const msgObj = (payload.whatsappInboundMessage || payload) as Record<string, unknown>;
      const inboundMessageId = (msgObj.id as string) || '';

      if (inboundMessageId) {
        if (processedMessageIds.has(inboundMessageId)) {
          console.log(`[DEDUPE] Webhook ignorado (Retry duplicado): ${inboundMessageId}`);
          return new Response('Duplicated retry', { status: 200, headers: corsHeaders });
        }
        processedMessageIds.add(inboundMessageId);
        if (processedMessageIds.size > 2000) processedMessageIds.clear();
      }

      // Encolar mensaje en la tabla webhook_queue
      const { data: queueItem, error: queueErr } = await supabase
        .from('webhook_queue')
        .insert({ payload, status: 'pending' })
        .select('id')
        .single();

      if (queueErr) {
        console.error('[QUEUE ERROR] Error al encolar en webhook_queue:', queueErr);
        return new Response(JSON.stringify({ error: queueErr.message }), { status: 500, headers: corsHeaders });
      }

      console.log(`[QUEUE] Mensaje encolado exitosamente con ID: ${queueItem?.id}`);
      return new Response(JSON.stringify({ success: true, queued: true, id: queueItem?.id }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response('Ignored event', { status: 200, headers: corsHeaders });

  } catch (error: unknown) {
    const err = error as Error;
    console.error("[YCLOUD WEBHOOK ERROR]", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
