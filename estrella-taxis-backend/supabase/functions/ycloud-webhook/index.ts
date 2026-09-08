import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { reverseGeocode } from '../_shared/geo.ts';
import { getNearestTaxi } from '../_shared/traccar.ts';
import { dispatchToHuman, sendWhatsApp, sendWhatsAppCTA, sendWhatsAppLocationRequest, sendWhatsAppButtons, markAsRead, sendTypingIndicator } from '../_shared/whatsapp.ts';
import { getToolsForBusiness } from '../_shared/bot/core/toolSchemas.ts';
import { buildSystemPrompt, routeToolCall } from '../_shared/bot/core/router.ts';
import { ToolData, PermisosSistema } from '../_shared/bot/core/types.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || '';
const APP_URL = Deno.env.get('APP_URL') || 'https://stellar.estrella-eats.mx';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

import { safeParseToolData } from '../_shared/bot/core/zodSchemas.ts';

// Almacén en memoria para deduplicar retries de YCloud
// Supabase reutiliza el contenedor, por lo que esto atrapará la mayoría de los reintentos
const processedMessageIds = new Set<string>();

// Genera un token corto y único para la URL de seguimiento del cliente
function generarToken(len = 10): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// Wrapper para reintentos automáticos — solo reintenta en errores de red o 5xx (servidor)
// Los errores 4xx (Bad Request, Unauthorized) NO se reintentan ya que son errores del cliente.
async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const res = await fetch(url, options);
      // 4xx = error del cliente. No tiene sentido reintentar.
      if (res.ok || (res.status >= 400 && res.status < 500)) return res;
      console.warn(`[API] Intento ${attempt + 1} falló con status ${res.status} (error de servidor, reintentando...)`);
    } catch (err) {
      console.warn(`[API] Intento ${attempt + 1} falló por error de red:`, err);
    }
    attempt++;
    if (attempt < maxRetries) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1))); // Backoff: 1s, 2s
  }
  return fetch(url, options); // Último intento — deja que explote si sigue fallando
}

// Interfaz para un mensaje de historial del LLM
interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Poda inteligente de contexto (máximo aprox. 2500 tokens = 10,000 chars)
function pruneContext(history: ChatMessage[], maxTokensEstimate = 2500): ChatMessage[] {
  const pruned: ChatMessage[] = [];
  let currentLength = 0;
  // Recorremos de más reciente a más antiguo para conservar los mensajes más relevantes
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    const msgLength = msg.content ? msg.content.length : 0;
    if (currentLength + msgLength > maxTokensEstimate * 4) { // ~4 chars por token
      break;
    }
    pruned.unshift(msg);
    currentLength += msgLength;
  }
  // Garantizar siempre al menos los 2 mensajes más recientes para dar contexto mínimo
  if (pruned.length === 0 && history.length > 0) return history.slice(-2);
  return pruned;
}

// El extractor JSON (extractToolCallAndSanitize) ha sido eliminado por migración a Tools Nativos de Gemini.
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    console.log('[YCLOUD WEBHOOK] Recibido payload:', JSON.stringify(payload, null, 2));

    if (payload.type === 'whatsapp.message.updated') {
      return new Response('Status update received', { status: 200 });
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

      // Obtener datos de la empresa para remitente y nombre comercial
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

      // Eliminar menú previo para no duplicar
      await supabase.from('catalogos').delete().eq('tenant_id', tenant_id);

      // Insertar los nuevos items con service role key
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

    const doWork = async () => {
      // YCloud Webhook Types (v2) - Buscamos mensajes entrantes de WhatsApp
      if (payload.type === 'whatsapp.inbound_message' || payload.whatsappInboundMessage) {
        const msgObj = (payload.whatsappInboundMessage || payload) as Record<string, unknown>;
        const fromNumber = msgObj.from as string; // Teléfono del cliente
        const toNumber = msgObj.to as string;     // Teléfono de la base (waba_number)
        const inboundMessageId = (msgObj.id as string) || '';  // ID para markAsRead

        // Deduplicación rápida para evitar que YCloud mande el mismo mensaje múltiples veces
        // si nuestra IA tarda más de 5 segundos en responder.
        if (inboundMessageId) {
          if (processedMessageIds.has(inboundMessageId)) {
            console.log(`[DEDUPE] Mensaje duplicado de YCloud ignorado (Retry): ${inboundMessageId}`);
            return new Response('Duplicated retry', { status: 200 });
          }
          processedMessageIds.add(inboundMessageId);
          // Prevenir fugas de memoria
          if (processedMessageIds.size > 2000) processedMessageIds.clear();
        }

        let textBody = '';
        let interactiveId = '';
        if (msgObj.type === 'text') {
          textBody = (msgObj.text as Record<string, string>)?.body || '';
        } else if (msgObj.type === 'interactive') {
          const interactive = msgObj.interactive as Record<string, unknown>;
          if (interactive?.type === 'button_reply') {
            const btn = interactive.button_reply as Record<string, string>;
            interactiveId = btn?.id || '';
            textBody = btn?.title || interactiveId;

            if (interactiveId === 'order_type_domicilio') {
              textBody = `🛵 A Domicilio [INSTRUCCIÓN DEL SISTEMA: El cliente seleccionó entrega a domicilio. Pídele amablemente su calle y colonia (o usa la herramienta pedir_ubicacion para pedirle su GPS)]`;
            } else if (interactiveId === 'order_type_recoger') {
              textBody = `🏬 Pasar a Recoger [INSTRUCCIÓN DEL SISTEMA: El cliente seleccionó pasar a recoger en tienda. NO le pidas dirección ni cobres envío. En "direccion" pon "Recoger en tienda". Si ya tienes su nombre y su pedido, ejecuta enviar_pedido inmediatamente con direccion: "Recoger en tienda" y tipo_entrega: "recoger"]`;
            } else if (interactiveId === 'restart_order') {
              textBody = `[INSTRUCCIÓN DEL SISTEMA: El cliente quiere hacer un nuevo pedido. Salúdalo brevemente con empatía y usa la herramienta mostrar_menu_lista para mostrarle el menú de nuevo.]`;
            }
          } else if (interactive?.type === 'list_reply') {
            const listReply = interactive.list_reply as Record<string, string>;
            interactiveId = listReply?.id || '';
            textBody = listReply?.title || interactiveId;
            // Quitamos el emoji inicial para que el LLM entienda mejor qué producto es (ej. "🍗 Pollo Bañado" -> "Pollo Bañado")
            textBody = textBody.replace(/^[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]\s*/g, '').trim();
          }
        }

        // 0. Procesar Ubicación Nativa (GPS)
        if (msgObj.type === 'location' && msgObj.location) {
          const loc = msgObj.location as Record<string, number>;
          const lat = loc.latitude;
          const lng = loc.longitude;
          console.log(`[YCLOUD] Ubicación nativa recibida: ${lat}, ${lng}`);
          const address = await reverseGeocode(lat, lng);
          textBody = `Mi ubicación GPS exacta es: ${lat},${lng} (${address}). [INSTRUCCIÓN PARA EL SISTEMA: El usuario ha enviado su ubicación GPS exacta. DEBES usar exactamente la cadena "${lat},${lng}" como el campo 'origen' en la herramienta book_taxi]`;
        }
        // 0.5. Procesar Links de Google Maps en el texto
        else if (textBody.includes('maps.app.goo.gl') || textBody.includes('google.com/maps')) {
          textBody = textBody + " [El usuario envió un link de mapa como su origen]";
        }

        if (!fromNumber || !toNumber || !textBody) {
          return new Response('Ignorado: Faltan datos del mensaje o no es texto/ubicacion', { status: 200 });
        }

        console.log(`[YCLOUD] Mensaje entrante de ${fromNumber} hacia ${toNumber}: "${textBody}"`);

        // 1. GATEKEEPING: Identificar a la Empresa dueña del "toNumber"
        // Limpiamos los números para buscar en la BD
        const cleanToNumber = toNumber.replace(/\D/g, '');
        const { data: allEmpresas, error: empresasErr } = await supabase.from('empresas').select('*, paquete:paquetes(permisos_sistema, incluye_bot)');

        if (empresasErr) {
          console.error('[GATEKEEPING] Error fatal conectando a Supabase:', empresasErr);
        }

        let empresa = null;
        if (allEmpresas) {
          empresa = allEmpresas.find(emp => {
            const waba = (emp.telefono_whatsapp || emp.whatsapp_waba || '').replace(/\D/g, '');
            const telnyx = (emp.telefono_telnyx || '').replace(/\D/g, '');
            const dispatcher = (emp.dispatcher_phone || '').replace(/\D/g, '');

            return (waba && (cleanToNumber.endsWith(waba) || waba.endsWith(cleanToNumber))) ||
              (telnyx && (cleanToNumber.endsWith(telnyx) || telnyx.endsWith(cleanToNumber))) ||
              (dispatcher && (cleanToNumber.endsWith(dispatcher) || dispatcher.endsWith(cleanToNumber)));
          });
        }

        if (!empresa) {
          console.warn(`[GATEKEEPING] No se encontró empresa para el número receptor ${toNumber}. Ignorando.`);
          return new Response('No tenant match', { status: 200 });
        }

        const paqueteObj = Array.isArray(empresa.paquete) ? empresa.paquete[0] : empresa.paquete;
        const incluyeBot = paqueteObj ? paqueteObj.incluye_bot === true : false;
        const permisosSistema = paqueteObj ? (paqueteObj.permisos_sistema || {}) : {};

        if (!incluyeBot) {
          console.warn(`[GATEKEEPING] La empresa ${empresa.nombre_empresa} NO tiene el plan con Bot activo. Ignorando mensaje.`);
          return new Response('Plan basico - ignorado', { status: 200 });
        }

        // 1.5. ¿Es un Chofer respondiendo a una oferta (botón interactivo o texto '1')?
        // OJO: Como ahora leemos teléfonos de Traccar también, el teléfono entrante podría NO estar en la tabla 'conductores'.
        // Sin embargo, si el botón apretado empieza con "accept_", sabemos exactamente qué taxi es (accept_DEVICEID)
        let isDriverAccepting = false;
        let acceptingDeviceId = null;
        let acceptingDriverName = "Taxi";

        // --- 1.4 Restaurante: Interacciones de la Cocina ---
        if (interactiveId && interactiveId.startsWith('order_accept_')) {
          const pedidoId = interactiveId.replace('order_accept_', '').trim();
          const { data: pedidoInfo } = await supabase.from('pedidos').select('*').eq('id', pedidoId).maybeSingle();
          if (pedidoInfo && (pedidoInfo.estado === 'pendiente' || pedidoInfo.estado === 'confirmado')) {
            await supabase.from('pedidos').update({ estado: 'preparando' }).eq('id', pedidoId);

            const isPickup = (pedidoInfo.direccion_entrega || '').toLowerCase().includes('recoger');
            const nombreEmpresa = empresa.nombre_empresa || 'el restaurante';

            // 1. Avisar a la cocina con botón de "Pedido Listo"
            await sendWhatsAppButtons(
              fromNumber,
              `👨‍🍳 *Pedido Confirmado*\n\nHas aceptado la orden de *${pedidoInfo.cliente_nombre || 'Cliente'}*.\n\nCuando la comida esté lista, presiona el botón abajo para avisarle al cliente:`,
              [
                { id: `order_ready_${pedidoId}`, title: '🔔 ¡Pedido Listo!' }
              ],
              toNumber
            );

            // 2. Avisar al cliente con UX clara y adaptada
            if (pedidoInfo.cliente_tel) {
              const clientPhone = pedidoInfo.cliente_tel.startsWith('+') ? pedidoInfo.cliente_tel : `+${pedidoInfo.cliente_tel}`;
              let mensajeCliente = '';
              if (isPickup) {
                mensajeCliente = `👨‍🍳 *¡Tu pedido ha sido aceptado!* 🔥\n\nEn *${nombreEmpresa}* ya estamos preparando tu orden:\n📋 _${pedidoInfo.detalle_pedido}_\n\n🏬 *Modalidad:* Pasar a recoger en tienda\n⏳ *Estado:* En preparación\n\nTe mandaremos un mensaje por aquí en cuanto esté listo y empacado para que pases a recogerlo. ¡Muchas gracias! 🙌`;
              } else {
                mensajeCliente = `👨‍🍳 *¡Tu pedido ha sido aceptado!* 🔥\n\nEn *${nombreEmpresa}* ya estamos preparando tu orden:\n📋 _${pedidoInfo.detalle_pedido}_\n\n🛵 *Modalidad:* Entrega a domicilio\n⏳ *Estado:* En preparación\n\nTe avisaremos por aquí en cuanto tu repartidor salga en camino. ¡Muchas gracias! 🙌`;
              }
              await sendWhatsApp(clientPhone, mensajeCliente, toNumber);
            }
            return new Response('Pedido confirmado', { status: 200 });
          } else {
            await sendWhatsApp(fromNumber, `❌ Este pedido ya fue gestionado o no existe.`, toNumber);
            return new Response('Pedido no válido', { status: 200 });
          }
        }

        if (interactiveId && interactiveId.startsWith('order_ready_')) {
          const pedidoId = interactiveId.replace('order_ready_', '').trim();
          const { data: pedidoInfo } = await supabase.from('pedidos').select('*').eq('id', pedidoId).maybeSingle();
          if (pedidoInfo) {
            await supabase.from('pedidos').update({ estado: 'listo' }).eq('id', pedidoId);

            if (pedidoInfo.cliente_tel) {
              const clientPhone = pedidoInfo.cliente_tel.startsWith('+') ? pedidoInfo.cliente_tel : `+${pedidoInfo.cliente_tel}`;
              const isPickup = (pedidoInfo.direccion_entrega || '').toLowerCase().includes('recoger');
              const nombreEmpresa = empresa.nombre_empresa || 'el restaurante';

              let msgListo = '';
              if (isPickup) {
                msgListo = `🎉 *¡TU PEDIDO YA ESTÁ LISTO!* 🛍️\n\nTu orden en *${nombreEmpresa}* ya está lista y empacada.\n\n📍 Ya puedes pasar a recogerla a la sucursal cuando gustes.\n\n¡Te esperamos, buen provecho! 😋`;
              } else {
                msgListo = `🛵 *¡TU PEDIDO VA EN CAMINO!* 💨\n\nTu orden en *${nombreEmpresa}* ya salió de la cocina rumbo a tu dirección:\n📍 *${pedidoInfo.direccion_entrega}*\n\n¡Ten a la mano tu método de pago! Buen provecho 😋`;
              }
              await sendWhatsApp(clientPhone, msgListo, toNumber);

              // Hoja de ruta para el DISPATCHER (el repartidor)
              if (!isPickup) {
                const direccionEntrega = pedidoInfo.direccion_entrega || '';
                const wazeUrl = `https://waze.com/ul?q=${encodeURIComponent(direccionEntrega)}&navigate=yes`;
                const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccionEntrega)}`;
                const hojaRuta =
`🛵 *¡A ENTREGAR!*
━━━━━━━━━━━━━━━━━━━━
👤 *Cliente:* ${pedidoInfo.cliente_nombre || 'Cliente'}
📞 *Tel:* ${clientPhone}
━━━━━━━━━━━━━━━━━━━━
📋 *Pedido:*
${pedidoInfo.detalle_pedido}
━━━━━━━━━━━━━━━━━━━━
📍 *Dirección de entrega:*
${direccionEntrega}
━━━━━━━━━━━━━━━━━━━━
🗺️ Navegar:
• Waze: ${wazeUrl}
• Maps: ${mapsUrl}`;
                await sendWhatsApp(fromNumber, hojaRuta, toNumber);
              } else {
                await sendWhatsApp(fromNumber, `✅ El cliente fue notificado de que su pedido está listo para recoger.`, toNumber);
              }
            } else {
              await sendWhatsApp(fromNumber, `✅ Pedido marcado como listo.`, toNumber);
            }
            return new Response('Pedido listo', { status: 200 });
          } else {
            await sendWhatsApp(fromNumber, `❌ Este pedido no fue encontrado.`, toNumber);
            return new Response('Pedido no válido', { status: 200 });
          }
        }

        if (interactiveId && interactiveId.startsWith('order_reject_')) {
          const pedidoId = interactiveId.replace('order_reject_', '').trim();
          const { data: pedidoInfo } = await supabase.from('pedidos').select('*').eq('id', pedidoId).maybeSingle();
          if (pedidoInfo && pedidoInfo.estado === 'pendiente') {
            await supabase.from('pedidos').update({ estado: 'cancelado' }).eq('id', pedidoId);
            await sendWhatsApp(fromNumber, `❌ Has rechazado el pedido. El cliente ha sido notificado.`, toNumber);
            if (pedidoInfo.cliente_tel) {
              const clientPhone = pedidoInfo.cliente_tel.startsWith('+') ? pedidoInfo.cliente_tel : `+${pedidoInfo.cliente_tel}`;
              const nombreEmpresa = empresa.nombre_empresa || 'el restaurante';
              await sendWhatsAppButtons(
                clientPhone,
                `❌ *Actualización de tu pedido en ${nombreEmpresa}*\n\nLamentamos mucho el inconveniente. Por alta demanda o disponibilidad de productos, no podemos procesar tu orden en este momento. 🙏\n\n¿Te gustaría intentarlo de nuevo o pedir algo diferente?`,
                [{ id: 'restart_order', title: '🛒 Hacer Nuevo Pedido' }],
                toNumber
              );
            }
            return new Response('Pedido cancelado', { status: 200 });
          } else {
            await sendWhatsApp(fromNumber, `❌ Este pedido ya fue gestionado o no existe.`, toNumber);
            return new Response('Pedido no válido', { status: 200 });
          }
        }

        if (interactiveId && interactiveId.startsWith('finish_')) {
          const viajeId = interactiveId.replace('finish_', '').trim();
          const { data: viajeFin } = await supabase.from('viajes').select('*').eq('id', viajeId).maybeSingle();
          if (viajeFin && viajeFin.estado === 'en_camino') {
            // Marcar completado
            await supabase.from('viajes').update({ estado: 'completado' }).eq('id', viajeId);
            // Avisar al conductor
            await sendWhatsApp(fromNumber, `✅ ¡Gracias! Has finalizado este viaje con éxito. Quedas libre para la próxima solicitud.`, toNumber);
            // Avisar al cliente
            if (viajeFin.cliente_tel) {
              const clientPhone = viajeFin.cliente_tel.startsWith('+') ? viajeFin.cliente_tel : `+${viajeFin.cliente_tel}`;
              await sendWhatsApp(clientPhone, `🏁 *¡Viaje finalizado!* 🎉\n\nGracias por viajar con nosotros. ¡Esperamos verte pronto!`, toNumber);
            }
            // Avisar al operador
            if (empresa.dispatcher_phone) {
              await sendWhatsApp(empresa.dispatcher_phone, `🏁 *VIAJE FINALIZADO*\n\nLa unidad ${viajeFin.taxi_name || 'asignada'} terminó su viaje exitosamente con el cliente +${viajeFin.cliente_tel}.`, toNumber);
            }
            return new Response('Viaje finalizado', { status: 200 });
          } else {
            await sendWhatsApp(fromNumber, `❌ Este viaje ya fue finalizado o no existe.`, toNumber);
            return new Response('Viaje no válido', { status: 200 });
          }
        }

        if (interactiveId && interactiveId.startsWith('accept_')) {
          isDriverAccepting = true;
          const parts = interactiveId.replace('accept_', '').split('_');
          acceptingDeviceId = parseInt(parts[0], 10);
          const taxiNameFromButton = parts.slice(1).join('_');
          // Obtener el nombre del conductor desde la base de datos
          const { data: cond } = await supabase.from('conductores').select('nombre').eq('device_id', acceptingDeviceId).maybeSingle();
          acceptingDriverName = cond?.nombre || taxiNameFromButton || "Taxi";
        } else if (textBody.trim() === '1') {
          // Fallback legado si contesta '1' en texto y sí está en la tabla
          const { data: conductorInfo } = await supabase.from('conductores').select('*').eq('telefono_whatsapp', fromNumber).maybeSingle();
          if (conductorInfo) {
            isDriverAccepting = true;
            acceptingDeviceId = conductorInfo.device_id;
            acceptingDriverName = conductorInfo.nombre;
          }
        }

        if (interactiveId && interactiveId.startsWith('reject_')) {
          // Extraer device_id del botón (reject_DEVICEID_TAXINAME)
          const rejectParts = interactiveId.replace('reject_', '').split('_');
          const rejectingDeviceId = parseInt(rejectParts[0], 10);

          await sendWhatsApp(fromNumber, `❌ Has rechazado el viaje. Buscando otra unidad...`, toNumber);

          // Buscar el viaje pendiente que tiene a este chofer en conductores_contactados
          const { data: pendingForReject } = await supabase
            .from('viajes')
            .select('id, origen, destino, origen_lat, origen_lng, cliente_tel, cliente_nombre, token, conductores_contactados, tarifa')
            .eq('tenant_id', empresa.id)
            .eq('estado', 'buscando_conductor')
            .order('created_at', { ascending: false })
            .limit(5);

          const tripToReassign = pendingForReject?.find((t) => {
            const contacted = (t.conductores_contactados as Array<number | { device_id: number }>) || [];
            return contacted.some((c) =>
              typeof c === 'object' && 'device_id' in c
                ? String(c.device_id) === String(rejectingDeviceId)
                : String(c) === String(rejectingDeviceId)
            );
          });

          if (tripToReassign && tripToReassign.origen_lat && tripToReassign.origen_lng) {
            console.log(`[REJECT] Reasignando viaje ${tripToReassign.id} tras rechazo de device ${rejectingDeviceId}`);

            // Buscar taxis cercanos excluyendo al que rechazó y a todos los ya contactados
            const nearbyForReassign = await getNearestTaxi(
              tripToReassign.origen_lat,
              tripToReassign.origen_lng,
              permisosSistema
            );

            const alreadyContacted = (tripToReassign.conductores_contactados as Array<number | { device_id: number }> || []).map((c) =>
              typeof c === 'object' && 'device_id' in c ? String(c.device_id) : String(c)
            );

            const nextTaxis = (nearbyForReassign || [])
              .filter((t: any) => !alreadyContacted.includes(String(t.deviceId)))
              .slice(0, 2);

            if (nextTaxis.length > 0) {
              for (const taxi of nextTaxis) {
                const { data: conductorNext } = await supabase
                  .from('conductores')
                  .select('telefono_whatsapp')
                  .eq('device_id', taxi.deviceId)
                  .maybeSingle();

                const telefonoNext = conductorNext?.telefono_whatsapp || taxi.phone;
                if (!telefonoNext) continue;

                await supabase.rpc('array_append_viaje_conductores', { v_id: tripToReassign.id, d_id: taxi.deviceId });

                const tarifaStr = tripToReassign.tarifa ? `$${tripToReassign.tarifa}` : 'A consultar';
                await sendWhatsAppButtons(
                  telefonoNext,
                  `🚕 *¡NUEVA SOLICITUD DE VIAJE!* 🚕\n\n📍 *Origen:* ${tripToReassign.origen}\n🏁 *Destino:* ${tripToReassign.destino}\n💵 *Tarifa (aprox):* ${tarifaStr}`,
                  [{ id: `accept_${taxi.deviceId}_${taxi.name}`, title: '✅ Aceptar Viaje' }],
                  empresa.waba_number || ''
                );
              }
              console.log(`[REJECT] Reasignación enviada a ${nextTaxis.length} conductores alternativos.`);
            } else {
              console.warn(`[REJECT] No hay más conductores disponibles para reasignar viaje ${tripToReassign.id}.`);
              // Notificar al cliente que tardará un poco más
              if (tripToReassign.cliente_tel) {
                const cp = tripToReassign.cliente_tel.startsWith('+') ? tripToReassign.cliente_tel : `+${tripToReassign.cliente_tel}`;
                await sendWhatsApp(cp, `⏳ Seguimos buscando tu unidad. Por favor espera un momento más.`, toNumber);
              }
            }
          }

          return new Response('Viaje rechazado - reasignacion iniciada', { status: 200 });
        }

        if (isDriverAccepting && acceptingDeviceId) {


          // Buscar los últimos viajes pendientes y filtrar en JS para evitar problemas de tipos con arrays en Supabase
          const { data: pendingTrips, error: tripsErr } = await supabase.from('viajes')
            .select('id, token, origen, destino, cliente_nombre, cliente_tel, origen_lat, origen_lng, conductores_contactados, tarifa')
            .eq('tenant_id', empresa.id)
            .eq('estado', 'buscando_conductor')
            .order('created_at', { ascending: false })
            .limit(10);

          if (tripsErr) console.error('[ASSIGN] Error buscando viajes pendientes:', tripsErr);

          let pendingTrip = null;
          if (pendingTrips && pendingTrips.length > 0) {
            pendingTrip = pendingTrips.find(t => {
              const contacted = t.conductores_contactados as Array<number | { device_id: number, name: string }> || [];
              return contacted.some(c => {
                if (typeof c === 'object' && c !== null && 'device_id' in c) {
                  return String(c.device_id) === String(acceptingDeviceId);
                }
                return String(c) === String(acceptingDeviceId);
              });
            });
          }
          console.log(`[ASSIGN] Viaje encontrado para conductor ${acceptingDeviceId}:`, !!pendingTrip);

          let assigned = false;
          let assignErr: Error | null = null;

          if (pendingTrip) {
            // Asignación atómica mediante RPC
            const res = await supabase.rpc('assign_taxi_to_trip', {
              v_id: pendingTrip.id,
              p_device_id: acceptingDeviceId,
              p_taxi_name: acceptingDriverName || null
            });
            assigned = !!res.data;
            assignErr = res.error as Error | null;
            console.log(`[ASSIGN] RPC Result: assigned=${assigned}${assignErr ? `, error=${assignErr.message}` : ''}`);

            if (assigned) {
              const passengerName = pendingTrip.cliente_nombre || 'Cliente';
              const passengerPhone = pendingTrip.cliente_tel || '';
              const tarifa = pendingTrip.tarifa ? `$${pendingTrip.tarifa} MXN` : 'A calcular';
              const wazeLink = `https://waze.com/ul?ll=${pendingTrip.origen_lat},${pendingTrip.origen_lng}&navigate=yes`;
              const mapsLink = `https://www.google.com/maps?q=${pendingTrip.origen_lat},${pendingTrip.origen_lng}`;

              const uxMessage = `✅ *¡VIAJE ASIGNADO CON ÉXITO!* 🚕💨

👤 *Pasajero:* ${passengerName}
📞 *Teléfono:* +${passengerPhone}
💵 *Tarifa (aprox):* ${tarifa}

📍 *Punto de encuentro:*
${pendingTrip.origen}

🏁 *Destino:*
${pendingTrip.destino}

🗺️ *Navegar al origen:*
• Waze: ${wazeLink}
• Maps: ${mapsLink}

⚠️ *Por favor conduce con precaución.*`;

              await sendWhatsAppButtons(
                fromNumber,
                uxMessage,
                [{ id: `finish_${pendingTrip.id}`, title: '🏁 Finalizar Viaje' }],
                toNumber
              );

              // Notify the client!
              if (passengerPhone) {
                const clientMsg = `🚕 ¡Listo! Tu unidad *${acceptingDriverName || 'Asignada'}* ya va en camino.\n\n📍 Sigue tu ruta en vivo tocando el botón abajo:`;
                const trackingUrl = `${APP_URL}/track/${pendingTrip.token}`;
                // Make sure to prepend + if it's not there, but passengerPhone might already have it or we assume it's just numbers
                const clientPhone = passengerPhone.startsWith('+') ? passengerPhone : `+${passengerPhone}`;
                await sendWhatsAppCTA(clientPhone, clientMsg, '📍 Rastrear Viaje', trackingUrl, toNumber);
              }

              return new Response('Viaje asignado', { status: 200 });
            }
          }

          console.warn(`[ASSIGN] Conductor ${acceptingDeviceId} llegó tarde o viaje ya asignado. pendingTrip=${pendingTrip ? pendingTrip.id : 'null'}, assigned=${assigned}`);
          await sendWhatsApp(fromNumber, `❌ Lo siento, este viaje ya fue asignado a otra unidad que aceptó primero o fue cancelado.`, toNumber);
          return new Response('Viaje ganado por otro', { status: 200 });
        }

        // 2. RECUPERAR SESIÓN DE CLIENTE
        // Buscamos solo por phone porque es la llave primaria.
        const { data: sessionData } = await supabase.from('whatsapp_sessions').select('*').eq('phone', fromNumber).maybeSingle();
        let session = sessionData;

        if (!session) {
          const { data: newSession, error: sErr } = await supabase.from('whatsapp_sessions').insert({
            phone: fromNumber, waba_number: toNumber, tenant_id: empresa.id, estado: 'bot', history: [], pending_messages: []
          }).select().single();
          if (sErr) console.warn('[YCLOUD] Error creando sesión:', sErr);
          session = newSession;
        } else if (session.waba_number !== toNumber) {
          // Si el cliente interactuó con un número viejo y ahora escribe al nuevo, migramos su sesión.
          console.log(`[YCLOUD] Actualizando waba_number de ${session.waba_number} a ${toNumber} para ${fromNumber}`);
          const { data: updatedSession } = await supabase.from('whatsapp_sessions').update({
            waba_number: toNumber,
            tenant_id: empresa.id,
            estado: 'bot',
            history: [],
            pending_messages: []
          }).eq('phone', fromNumber).select().single();
          if (updatedSession) session = updatedSession;
        }

        // 2.5 DEBOUNCE LOGIC (2 SEGUNDOS)
        // Bug Fix: Usa append atómico vía RPC + comparación de timestamp para evitar
        // race condition donde dos webhooks paralelos se sobreescriben mutuamente.
        if (session) {
          let lockAcquired = false;
          const myStartTime = new Date().toISOString();

          // Append atómico: la función SQL usa array_append() que es thread-safe
          await supabase.rpc('append_pending_message', {
            p_phone: fromNumber,
            p_waba: toNumber,
            p_message: textBody,
            p_timestamp: myStartTime
          });

          console.log(`[DEBOUNCE] ${fromNumber} - Esperando 2 segundos para acumular mensajes...`);
          await new Promise(r => setTimeout(r, 2000));

          const { data: checkSession } = await supabase
            .from('whatsapp_sessions')
            .select('last_user_msg_at, pending_messages, estado')
            .eq('phone', fromNumber).eq('waba_number', toNumber)
            .single();

          // Si llegó un mensaje MAS RECIENTE que el nuestro, este webhook no es el último.
          if (checkSession && checkSession.last_user_msg_at > myStartTime) {
            console.log(`[DEBOUNCE] ${fromNumber} - Llegó otro mensaje después. Abortando este webhook.`);
            return new Response('Debounced', { status: 200 });
          }

          // Somos el último webhook de esta ráfaga.
          // SPIN-LOCK: Si la sesión está siendo procesada por otro webhook, esperamos hasta 15 segundos
          let sessionEstado = checkSession?.estado;
          let waitCount = 0;
          while (sessionEstado === 'procesando' && waitCount < 15) {
            console.log(`[LOCK] ${fromNumber} - Sesión 'procesando', esperando... (${waitCount}s)`);
            await new Promise(r => setTimeout(r, 1000));
            const { data: refreshSession } = await supabase
              .from('whatsapp_sessions')
              .select('estado, pending_messages')
              .eq('phone', fromNumber).eq('waba_number', toNumber)
              .single();
            sessionEstado = refreshSession?.estado;
            // Actualizamos los pending messages por si se agregaron más durante la espera
            if (refreshSession && checkSession) {
              checkSession.pending_messages = refreshSession.pending_messages;
            }
            waitCount++;
          }

          // Adquirimos el lock para que nadie más procese mientras llamamos al LLM
          await supabase.from('whatsapp_sessions')
            .update({ estado: 'procesando', pending_messages: [] })
            .eq('phone', fromNumber).eq('waba_number', toNumber);
          lockAcquired = true;

          const joinedTextBody = (checkSession?.pending_messages || []).join('\n');
          textBody = joinedTextBody.trim();
          if (!textBody) {
            console.log(`[DEBOUNCE] ${fromNumber} - textBody vacío tras debounce. Liberando lock y abortando.`);
            await supabase.from('whatsapp_sessions').update({ estado: 'bot' }).eq('phone', fromNumber).eq('waba_number', toNumber);
            return new Response('Empty text', { status: 200 });
          }
          console.log(`[DEBOUNCE] ${fromNumber} - Procesando mensaje consolidado: "${textBody}"`);
        }

        if (!session) {
          return new Response('No session', { status: 200 });
        }

        // IMPORTANTE: Recuperar estado e historia FRESCA después del lock
        const { data: freshSession } = await supabase.from('whatsapp_sessions').select('*').eq('phone', fromNumber).eq('waba_number', toNumber).maybeSingle();
        if (freshSession) session = freshSession;

        try {
          if (textBody.toLowerCase().includes('/reset')) {
            await supabase.from('whatsapp_sessions').update({ estado: 'bot', history: [] }).eq('phone', fromNumber).eq('waba_number', toNumber);
            await sendWhatsApp(fromNumber, "🔄 Memoria borrada. ¡Empecemos de nuevo! ¿En qué te ayudo?", toNumber);
            return new Response('Reset ok', { status: 200 });
          }

          // Comando /bot: El despachador humano devuelve el control al bot
          // Solo funciona si el mensaje viene de la misma sesión que está en modo humano
          if (textBody.toLowerCase().trim() === '/bot') {
            await supabase.from('whatsapp_sessions').update({ estado: 'bot' }).eq('phone', fromNumber).eq('waba_number', toNumber);
            await sendWhatsApp(fromNumber, "🤖 Modo bot reactivado. El asistente retomará la conversación con el cliente.", toNumber);
            console.log(`[COEXISTENCE] Sesión ${fromNumber} devuelta a modo BOT por comando /bot.`);
            return new Response('Bot mode restored', { status: 200 });
          }

          // Comando /configurar (Easter egg para impresionar)
          if (textBody.toLowerCase().trim() === '/configurar') {
            await sendWhatsApp(fromNumber, "⚙️ *Configurando todos los sistemas...*", toNumber);
            await new Promise(r => setTimeout(r, 1200));
            await sendWhatsApp(fromNumber, "Conectando con base de datos principal... 🟢", toNumber);
            await new Promise(r => setTimeout(r, 1200));
            await sendWhatsApp(fromNumber, "Actualizando Inteligencia Artificial a la última versión... 🟢", toNumber);
            await new Promise(r => setTimeout(r, 1200));
            await sendWhatsApp(fromNumber, "✅ *¡Sistemas listos y operando al 100%!* El restaurante está preparado para procesar las órdenes a la velocidad de la luz. 🚀", toNumber);
            
            // Liberamos el lock y salimos
            await supabase.from('whatsapp_sessions').update({ estado: 'bot' }).eq('phone', fromNumber).eq('waba_number', toNumber);
            return new Response('Configurar ok', { status: 200 });
          }

          // Si el humano tomó el control, el bot no responde — sin haber adquirido el lock
          if (session.estado === 'human') {
            console.log(`[COEXISTENCE] La sesión de ${fromNumber} está en modo HUMANO. El bot no interviene.`);
            return new Response('Human mode - silenced', { status: 200 });
          }

          // === A partir de aquí, se adquiere el lock ===

          // UX: Marcar mensaje como leído (palomitas azules) para restaurantes
          const tipoNegocio = empresa.tipo_negocio || 'taxi';
          if (tipoNegocio === 'restaurante' || tipoNegocio === 'comida') {
            // Fire & forget — no bloqueamos el flujo principal
            markAsRead(inboundMessageId).catch(() => {});
            await sendTypingIndicator(fromNumber, toNumber);
          }

          // 3. ACTUALIZAR HISTORIAL
          let history = session.history || [];
          // Poda inteligente de contexto (basada en tokens aproximados)
          history = pruneContext(history);

          history.push({ role: 'user', content: textBody });

          // 4. LLAMAR A GROQ (Llama-3) / GEMINI
          const nombreBot = empresa.nombre_bot || 'Asistente';
          const nombreEmpresa = empresa.nombre_empresa || 'la empresa';
          const ciudadTenant = empresa.ciudad || 'Comitán de Domínguez, Chiapas';
          const infoEmpresa = empresa.prompt_personalizado || '';

          // 3. GENERAR PROMPT (Estrategia por Dominio)
          const { data: currentViaje } = await supabase.from('viajes').select('estado, origen, destino, taxi_name').eq('cliente_tel', fromNumber).in('estado', ['buscando_conductor', 'en_camino']).maybeSingle();

          let infoViajeActivo = '';
          if (currentViaje) {
            infoViajeActivo = `[INFO DEL SISTEMA: El cliente tiene un viaje activo en estado '${currentViaje.estado}'. Origen: ${currentViaje.origen}, Destino: ${currentViaje.destino}. Unidad asignada: ${currentViaje.taxi_name || 'Buscando'}].`;
          }

          const systemPrompt = buildSystemPrompt(empresa, infoViajeActivo);

          const messagesForGroq = [
            { role: 'system', content: systemPrompt },
            ...history
          ];

          console.log(`[GEMINI] Consultando Gemini-3.6-Flash para ${fromNumber}...`);
          const botTools = getToolsForBusiness(empresa.tipo_negocio || 'taxi');
          const geminiRes = await fetchWithRetry('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${GEMINI_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: 'gemini-3.6-flash',
              messages: messagesForGroq,
              temperature: 0.2,
              tools: botTools,
              tool_choice: "auto"
            })
          });

          if (!geminiRes.ok) {
            throw new Error(`Gemini API Error: ${await geminiRes.text()}`);
          }

          const geminiData = await geminiRes.json();
          let aiResponse = geminiData.choices[0].message.content?.trim() || '';

          // 5. PROCESAR NATIVE TOOL CALL
          let executedTool = '';
          let toolData: ToolData = {};

          if (geminiData.choices[0].message.tool_calls && geminiData.choices[0].message.tool_calls.length > 0) {
            const tCall = geminiData.choices[0].message.tool_calls[0];
            executedTool = tCall.function.name;
            try {
              toolData = safeParseToolData(executedTool, JSON.parse(tCall.function.arguments));
            } catch (e) {
              console.error("[TOOLS] Error parseando argumentos:", e);
            }
          }

          let trackingUrlForCTA = null;

          if (executedTool) {
            const routeResult = await routeToolCall(
              supabase,
              executedTool,
              toolData,
              empresa,
              fromNumber,
              toNumber,
              ciudadTenant,
              aiResponse,
              permisosSistema,
              APP_URL
            );
            aiResponse = routeResult.finalResponse;
            trackingUrlForCTA = routeResult.trackingUrl;

            // Bug Fix: Para herramientas RAG (consultar_catalogo), el resultado NO va directo al cliente.
            // Se inyecta de vuelta al LLM para que redacte una respuesta natural, concisa y sin spam.
            if (executedTool === 'consultar_catalogo') {
              const ragContext = routeResult.finalResponse;
              // Truncar contexto RAG para evitar prompts gigantes
              const ragContextTruncated = ragContext.length > 1500
                ? ragContext.substring(0, 1500) + '\n...(más resultados disponibles)'
                : ragContext;
              const secondPassMessages = [
                messagesForGroq[0], // CRÍTICO: Siempre mantener el System Prompt
                ...messagesForGroq.slice(1).slice(-5), // Últimos 5 mensajes de contexto
                { role: 'assistant', content: `[Consultando catálogo...]` },
                {
                  role: 'user',
                  content: `[SISTEMA]: Resultados de la base de datos:\n${ragContextTruncated}\n\n` +
                    `REGLAS DE RESPUESTA:\n` +
                    `1. SÉ CLARO Y BREVE. Si el cliente pide el menú general, usa "mostrar_menu_lista" con las categorías. Si el cliente pregunta por una categoría específica (ej. "Pollo", "Bebidas"), usa la herramienta para mostrarle los PRODUCTOS ESPECÍFICOS de esa categoría.\n` +
                    `2. CERO SPAM: No envíes listas largas en texto. Usa la herramienta interactiva siempre que haya más de 2 opciones.\n` +
                    `3. Haz solo UNA pregunta directa para que el cliente decida.\n` +
                    `4. NO PREGUNTES sobre entrega o dirección hasta que el cliente decida qué va a comer.`
                }
              ];
              try {
                const secondRes = await fetchWithRetry('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${GEMINI_API_KEY}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ 
                    model: 'gemini-3.6-flash', 
                    messages: secondPassMessages, 
                    temperature: 0.2,
                    tools: botTools,
                    tool_choice: "auto"
                  })
                });
                if (secondRes.ok) {
                  const secondData = await secondRes.json();
                  aiResponse = secondData.choices[0].message.content?.trim() || '';

                  // Extraer native tool call en segunda pasada
                  if (secondData.choices[0].message.tool_calls && secondData.choices[0].message.tool_calls.length > 0) {
                    const tCall = secondData.choices[0].message.tool_calls[0];
                    if (tCall.function.name !== 'consultar_catalogo') {
                      executedTool = tCall.function.name;
                      try {
                        toolData = safeParseToolData(executedTool, JSON.parse(tCall.function.arguments));
                      } catch (e) {
                        console.error("[TOOLS] Error parseando argumentos second pass:", e);
                      }
                      
                      const secondRouteResult = await routeToolCall(
                      supabase,
                      executedTool,
                      toolData,
                      empresa,
                      fromNumber,
                      toNumber,
                      ciudadTenant,
                      aiResponse,
                      permisosSistema,
                      APP_URL
                    );
                    aiResponse = secondRouteResult.finalResponse;
                    if (secondRouteResult.trackingUrl) {
                      trackingUrlForCTA = secondRouteResult.trackingUrl;
                    }
                  }
                }
              }
            } catch (ragErr) {
              console.error('[RAG SECOND PASS] Error en segunda llamada a Gemini:', ragErr);
              aiResponse = 'Tenemos opciones deliciosas en el menú. ¿Qué te gustaría ordenar hoy?';
            }
          }
          }

          // Sanitización final para WhatsApp (garantía 100% libre de JSON o código)
          aiResponse = aiResponse
            .replace(/```(?:json)?[\s\S]*?```/gi, '')
            .replace(/\{[\s\S]*?"tool"[\s\S]*?\}/g, '')
            .replace(/```/g, '')
            .replace(/^\[.*?\]\s*/g, '') // Elimina prefijos como [SISTEMA] o [Asistente] generados por el LLM
            .replace(/\n{3,}/g, '\n\n')
            .trim();

          // Guardamos en historial si la respuesta no está vacía.
          // CRÍTICO: Los mensajes como '[El menú interactivo... fue enviado]' DEBEN guardarse
          // para que el LLM sepa que ya mandó el menú y no repita el saludo.
          if (aiResponse.length > 0) {
            history.push({ role: 'assistant', content: aiResponse });
          }

          // SIEMPRE guardamos el historial para que los mensajes del usuario no se pierdan
          // y el bot sepa que ya no es el "primer mensaje"
          await supabase.from('whatsapp_sessions').update({ history, updated_at: new Date().toISOString() }).eq('phone', fromNumber).eq('waba_number', toNumber);

          // Enviamos el WhatsApp al cliente
          if (trackingUrlForCTA) {
            await sendWhatsAppCTA(
              fromNumber,
              aiResponse,
              "📍 Seguir Viaje",
              trackingUrlForCTA,
              toNumber
            );
          } else if (executedTool === 'mostrar_menu_lista' && aiResponse.includes('No encontré opciones')) {
            // Si la lista estaba vacía, mandamos el mensaje de error como texto normal
            await sendWhatsApp(fromNumber, aiResponse, toNumber);
          } else if (executedTool !== 'pedir_ubicacion' && executedTool !== 'preguntar_tipo_entrega' && executedTool !== 'mostrar_menu_lista') {
            if (aiResponse.length > 0) {
              await sendWhatsApp(fromNumber, aiResponse, toNumber);
            }
          }

        } finally {
          // Liberar el lock siempre, haya error o no.
          await supabase.from('whatsapp_sessions').update({ estado: 'bot' }).eq('phone', fromNumber).eq('waba_number', toNumber);
        }

        return new Response('OK', { status: 200 });
      }

      return new Response('Webhook procesado', { status: 200 });
    }; // end doWork

    // En Supabase Edge Functions, usar EdgeRuntime.waitUntil a menudo provoca 
    // que el contenedor se congele (shutdown) si la API de Gemini tarda un poco.
    // Es mucho más seguro y confiable hacer await de doWork() antes de devolver el 200 OK,
    // ya que esto mantiene viva la ejecución hasta que el bot termina de enviar el WhatsApp.
    await doWork();
    return new Response('Sync OK', { status: 200 });

  } catch (error: unknown) {
    const err = error as Error;
    console.error("[YCLOUD WEBHOOK ERROR]", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
