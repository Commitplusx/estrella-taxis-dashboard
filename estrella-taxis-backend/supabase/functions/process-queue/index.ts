import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { reverseGeocode } from '../_shared/geo.ts';
import { getNearestTaxi } from '../_shared/traccar.ts';
import { dispatchToHuman, sendWhatsApp, sendWhatsAppCTA, sendWhatsAppLocationRequest, sendWhatsAppButtons, markAsRead, sendTypingIndicator, sendWhatsAppMediaId } from '../_shared/whatsapp.ts';
import { getToolsForBusiness } from '../_shared/bot/core/toolSchemas.ts';
import { buildSystemPrompt, routeToolCall } from '../_shared/bot/core/router.ts';
import { ToolData, PermisosSistema } from '../_shared/bot/core/types.ts';
import { verifyImageWithGemini, extractFiscalDataFromPdf } from '../_shared/bot/core/geminiVision.ts';
import { encode } from "https://deno.land/std@0.177.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
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

// Handler global — evita que Deno crashee por promesas no capturadas
// Crítico en VPS donde el proceso debe mantenerse vivo indefinidamente
globalThis.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  console.error('[CRITICAL] Promesa no capturada — prevenido crash de Deno:', event.reason);
  event.preventDefault();
});

// Wrapper para reintentos automáticos — solo reintenta en errores de red o 5xx (servidor)
// Usa AbortController manual (más compatible con Deno v2 + serve()) que AbortSignal.timeout()
async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 1): Promise<Response> {
  const TIMEOUT_MS = 45000;

  async function attemptFetch(): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const res = await attemptFetch();
      if (res.ok || (res.status >= 400 && res.status < 500)) return res;
      console.warn(`[API] Intento ${attempt + 1} falló con status ${res.status} (reintentando...)`);
    } catch (err) {
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        console.warn(`[API] Intento ${attempt + 1} TIMEOUT de ${TIMEOUT_MS / 1000}s. Reintentando...`);
      } else {
        console.warn(`[API] Intento ${attempt + 1} falló:`, err);
      }
    }
    attempt++;
    if (attempt < maxRetries) await new Promise(r => setTimeout(r, 1500));
  }
  // Último intento — si falla, el error sube al try-catch del caller
  return attemptFetch();
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

  let queueId: string | null = null;
  let queueStatus = 'done';

  try {
    const rawBody = await req.json();

    const record = rawBody?.record;
    queueId = record?.id || rawBody?.id || null;
    let payload = record ? record.payload : (rawBody?.payload || rawBody);

    // Asegurar que payload sea un objeto y no un string serializado por pg_net
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch (_) {}
    }

    if (queueId) {
      await supabase
        .from('webhook_queue')
        .update({ status: 'processing', processed_at: new Date().toISOString() })
        .eq('id', queueId);
    }

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
        let mediaId = '';
        const msgType = msgObj.type as string;

        if (msgType === 'text') {
          textBody = (msgObj.text as Record<string, string>)?.body || '';
        } else if (msgType === 'image') {
          const img = msgObj.image as Record<string, string>;
          mediaId = img?.id || '';
          textBody = img?.caption || '';
        } else if (msgType === 'document') {
          const doc = msgObj.document as Record<string, string>;
          mediaId = doc?.id || '';
          textBody = doc?.caption || '';
        } else if (msgType === 'interactive') {
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

        if (!fromNumber || !toNumber) {
          return new Response('Ignorado: Faltan from/to', { status: 200 });
        }
        // Si no hay textBody pero hay interactiveId, o es location, o es image/document, el flujo sigue
        if (!textBody && !interactiveId && msgType !== 'location' && msgType !== 'image' && msgType !== 'document') {
          return new Response('Ignorado: Sin contenido procesable', { status: 200 });
        }

        // Log diagnóstico para botones interactivos
        if (interactiveId) {
          console.log(`[INTERACTIVE] ID recibido: "${interactiveId}", textBody: "${textBody}", from: ${fromNumber}`);
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
          // Número desconocido — ignoramos en silencio, sin spam en logs
          return new Response('No tenant match', { status: 200 });
        }

        const paqueteObj = Array.isArray(empresa.paquete) ? empresa.paquete[0] : empresa.paquete;
        const incluyeBot = paqueteObj ? paqueteObj.incluye_bot === true : false;
        const permisosSistema = paqueteObj ? (paqueteObj.permisos_sistema || {}) : {};

        if (!incluyeBot) {
          console.warn(`[GATEKEEPING] La empresa ${empresa.nombre_empresa} NO tiene el plan con Bot activo. Ignorando mensaje.`);
          return new Response('Plan basico - ignorado', { status: 200 });
        }

        // --- 1.2 Intercepción de Facturación (Imágenes y Documentos) ---
        if ((msgType === 'image' || msgType === 'document') && mediaId) {
          // El cliente envía una foto o archivo. Verificamos con Gemini Vision si es un ticket válido.
          console.log(`[FACTURACION] Descargando ${msgType} ${mediaId} para validación visual de Gemini...`);
          try {
            const ycloudKey = Deno.env.get('YCLOUD_API_KEY') || '';
            const mediaObj = (msgType === 'image' ? msgObj.image : msgObj.document) as Record<string, any>;
            const mediaUrl = mediaObj.link || `https://api.ycloud.com/v2/whatsapp/media/${mediaId}`;
            console.log(`[FACTURACION] Objeto media recibido:`, JSON.stringify(mediaObj));
            console.log(`[FACTURACION] Intentando descargar de: ${mediaUrl}`);
            const imgRes = await fetch(mediaUrl, {
              headers: { 'X-API-Key': ycloudKey }
            });
            if (imgRes.ok) {
              const mimeType = imgRes.headers.get('content-type') || '';
              let buffer: ArrayBuffer;
              let actualMime = mimeType;
              
              // Manejo seguro por si YCloud devuelve JSON con URL o el stream binario directo
              if (mimeType.includes('application/json')) {
                const meta = await imgRes.json();
                console.log(`[FACTURACION] YCloud devolvió JSON. Redirigiendo a: ${meta.url}`);
                if (meta.url) {
                  const binRes = await fetch(meta.url);
                  if (!binRes.ok) throw new Error(`Fallo descargando la URL redireccionada: HTTP ${binRes.status}`);
                  buffer = await binRes.arrayBuffer();
                  actualMime = binRes.headers.get('content-type') || 'image/jpeg';
                } else {
                  throw new Error('YCloud retornó JSON sin URL válida.');
                }
              } else {
                buffer = await imgRes.arrayBuffer();
              }
              
              const base64Data = encode(new Uint8Array(buffer));
              const isTicket = await verifyImageWithGemini(base64Data, actualMime);
              
              const originalText = textBody ? ` (Texto original del cliente: "${textBody}")` : '';

              if (isTicket) {
                // Subir a Supabase Storage inmediatamente
                let uploadedMediaUrl: string | null = null;
                try {
                  const extension = msgType === 'document' ? 'pdf' : 'jpg';
                  const fileName = `${empresa.id}/${Date.now()}_${mediaId}.${extension}`;
                  const { data: uploadData, error: uploadErr } = await supabase.storage
                    .from('facturas_media')
                    .upload(fileName, buffer, { contentType: actualMime });
                  
                  if (!uploadErr) {
                    const { data } = supabase.storage.from('facturas_media').getPublicUrl(fileName);
                    uploadedMediaUrl = data.publicUrl;
                    console.log(`[FACTURACION] Archivo subido exitosamente a Storage: ${uploadedMediaUrl}`);
                  } else {
                    console.error('[FACTURACION] Error subiendo archivo a Storage:', uploadErr);
                  }
                } catch (upErr) {
                  console.error('[FACTURACION] Exception subiendo a Storage:', upErr);
                }

                // Si es un PDF, intentar extraer datos fiscales automáticamente con Gemini
                let datosFiscalesExtraidos: string | null = null;
                if (msgType === 'document' && actualMime.includes('pdf')) {
                  console.log('[FACTURACION] Intentando extraer datos fiscales del PDF con Gemini...');
                  datosFiscalesExtraidos = await extractFiscalDataFromPdf(base64Data);
                  if (datosFiscalesExtraidos) {
                    console.log('[FACTURACION] Datos fiscales extraídos exitosamente del PDF.');
                  } else {
                    console.log('[FACTURACION] PDF no contiene datos fiscales (es un ticket de compra).');
                  }
                }

                if (datosFiscalesExtraidos) {
                  // El PDF tenía datos fiscales (ej. Constancia de Situación Fiscal del SAT)
                  textBody = `[SISTEMA: El cliente ha enviado su documento fiscal (Constancia del SAT o similar) y la IA ha extraído sus datos fiscales:\n${datosFiscalesExtraidos}\n\nGUARDA ESTOS DATOS EN TU MEMORIA. Revisa el historial de la conversación: ¿el cliente YA envió la foto/imagen de su TICKET DE COMPRA? \nSi SÍ: Llama a la herramienta enviar_ticket_facturacion usando esos datos fiscales. Pon en "media_id" el ID_IMAGEN de la foto del ticket de compra, y pon en "pdf_media_id" el ID de este documento fiscal (${mediaId}). Pon en "pdf_url" la URL: ${uploadedMediaUrl || ''}. \nSi NO ha enviado la foto del ticket de compra: Pídesela amablemente. \nNUNCA llames a la herramienta usando el ID de este documento fiscal (${mediaId}) como "media_id", el contador necesita ver la foto del ticket.]`;
                } else {
                  // Es un ticket de compra (no contiene datos fiscales) — pedir datos normalmente
                  textBody = `[SISTEMA: El cliente ha enviado la foto de su TICKET DE COMPRA. ID_IMAGEN: ${mediaId} TIPO_MEDIA: ${msgType}.${originalText} Revisa el historial: ¿ya tienes sus datos fiscales completos (ya sea porque envió su Constancia en PDF o los escribió en texto)? \nSi SÍ: Llama a la herramienta enviar_ticket_facturacion usando este ID_IMAGEN (${mediaId}) como "media_id", los datos fiscales que ya tienes, e incluye su URL pública: ${uploadedMediaUrl || ''} en el campo "media_url". Si envió un PDF, incluye su ID como "pdf_media_id" y su URL en "pdf_url". \nSi NO tienes los datos fiscales: Pídele amablemente que te escriba sus datos o te envíe su Constancia de Situación Fiscal en PDF.]`;
                }
              } else {
                textBody = `[SISTEMA: El cliente envió una imagen/documento (ID_IMAGEN: ${mediaId} TIPO_MEDIA: ${msgType}), pero la IA visual ha determinado que NO es un ticket de consumo (puede ser una receta médica, selfie, meme, billete, etc).${originalText} Evalúa el contexto: si pidió factura, indícale que el archivo no es un ticket válido. Si es otro negocio (ej. farmacia) y mandó una receta, procésala normalmente como receta.]`;
              }
            } else {
              const errorText = await imgRes.text();
              console.error(`[FACTURACION] Error descargando imagen. HTTP ${imgRes.status}:`, errorText);
              textBody = `[SISTEMA: El cliente envió una imagen (ID_IMAGEN: ${mediaId}), pero hubo un error descargándola para verificarla. Texto del cliente: "${textBody}"]`;
            }
          } catch (e) {
            console.error('[FACTURACION] Error en Gemini Vision:', e);
            textBody = `[SISTEMA: El cliente envió una imagen (ID_IMAGEN: ${mediaId}), pero falló la validación visual por red. Texto del cliente: "${textBody}"]`;
          }
          // NO hacemos return early. Dejamos que el bot procese el texto (history) con el resultado de la visión.
        }

        if (msgType === 'document' && mediaId && (textBody || '').toLowerCase().includes('#factura')) {
          // El contador envía el PDF terminado de vuelta
          const match = textBody.match(/#factura\s+(\+?\d+)/i);
          if (match && match[1]) {
            const targetClientPhone = match[1].trim();
            console.log(`[FACTURACION] Reenviando PDF de factura del contador ${fromNumber} al cliente ${targetClientPhone}`);
            
            const caption = `✅ *¡Tu factura está lista!*\n\nAquí tienes el documento PDF correspondiente a tu consumo en *${empresa.nombre_empresa || 'el restaurante'}*. ¡Gracias por tu preferencia!`;
            
            await sendWhatsAppMediaId(targetClientPhone, 'document', mediaId, caption, toNumber);
            await sendWhatsApp(fromNumber, `✅ Factura entregada con éxito al cliente ${targetClientPhone}.`, toNumber);
            
            return new Response('Factura enviada al cliente', { status: 200 });
          }
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
        let lockAcquired = false;
        if (session) {
          const myStartTime = new Date().toISOString();
          const rawIncomingText = textBody;

          // Append atómico: la función SQL usa array_append() que es thread-safe
          try {
            await supabase.rpc('append_pending_message', {
              p_phone: fromNumber,
              p_waba: toNumber,
              p_message: textBody,
              p_timestamp: myStartTime
            });
          } catch (rpcErr) {
            console.warn('[DEBOUNCE] Error en rpc append_pending_message:', rpcErr);
          }

          console.log(`[DEBOUNCE] ${fromNumber} - Esperando 2 segundos para acumular mensajes...`);
          await new Promise(r => setTimeout(r, 2000));

          const { data: checkSession } = await supabase
            .from('whatsapp_sessions')
            .select('last_user_msg_at, pending_messages, estado, updated_at')
            .eq('phone', fromNumber).eq('waba_number', toNumber)
            .maybeSingle();

          // Si llegó un mensaje MÁS RECIENTE que el nuestro, este webhook no es el último de la ráfaga.
          if (checkSession && checkSession.last_user_msg_at && checkSession.last_user_msg_at > myStartTime) {
            console.log(`[DEBOUNCE] ${fromNumber} - Llegó otro mensaje después. Abortando este webhook.`);
            return new Response('Debounced', { status: 200 });
          }

          // SPIN-LOCK: Si la sesión está siendo procesada por otro webhook, esperamos hasta 15 segundos
          let sessionEstado = checkSession?.estado;
          let lastUpdatedAt = checkSession?.updated_at;
          let waitCount = 0;
          while (sessionEstado === 'procesando' && waitCount < 15) {
            // Verificar si el lock está congelado (>30 segundos desde el ÚLTIMO refresh) para romper deadlock
            const isStale = lastUpdatedAt && (Date.now() - new Date(lastUpdatedAt).getTime() > 30000);
            if (isStale) {
              console.warn(`[LOCK] ${fromNumber} - Lock estancado (>30s sin actualizarse). Rompiendo lock.`);
              break;
            }

            console.log(`[LOCK] ${fromNumber} - Sesión 'procesando', esperando... (${waitCount}s)`);
            await new Promise(r => setTimeout(r, 1000));
            const { data: refreshSession } = await supabase
              .from('whatsapp_sessions')
              .select('estado, pending_messages, updated_at')
              .eq('phone', fromNumber).eq('waba_number', toNumber)
              .maybeSingle();

            sessionEstado = refreshSession?.estado;
            lastUpdatedAt = refreshSession?.updated_at; // CRÍTICO: actualizar con el valor más reciente
            if (refreshSession?.pending_messages && checkSession) {
              checkSession.pending_messages = refreshSession.pending_messages;
            }
            waitCount++;
          }

          // Adquirimos el lock para que nadie más procese mientras llamamos al LLM
          await supabase.from('whatsapp_sessions')
            .update({ estado: 'procesando', pending_messages: [], updated_at: new Date().toISOString() })
            .eq('phone', fromNumber).eq('waba_number', toNumber);
          lockAcquired = true;

          const joinedTextBody = (checkSession?.pending_messages || []).join('\n').trim();
          // CRÍTICO: Si joinedTextBody está vacío, SIEMPRE usar rawIncomingText para jamás perder el mensaje
          textBody = joinedTextBody || rawIncomingText;
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

        try {
          // IMPORTANTE: Recuperar estado e historia FRESCA después del lock
          const { data: freshSession } = await supabase.from('whatsapp_sessions').select('*').eq('phone', fromNumber).eq('waba_number', toNumber).maybeSingle();
          if (freshSession) session = freshSession;

          // DEDUPLICACIÓN ROBUSTA CROSS-ISOLATE (BASE DE DATOS)
          // Los message_ids ya vistos se guardan en session.seen_message_ids (separado del historial)
          // para que el historial quede limpio {role, content} sin campos extra.
          const seenIds: string[] = Array.isArray(session.seen_message_ids) ? session.seen_message_ids : [];
          if (inboundMessageId && seenIds.includes(inboundMessageId)) {
            console.log(`[DEDUPE-DB] Retransmisión de YCloud cruzó isolates. Descartando ID: ${inboundMessageId}`);
            return new Response('Duplicated in DB', { status: 200 });
          }

          if (textBody.toLowerCase().includes('/reset')) {
            await supabase.from('whatsapp_sessions').update({ estado: 'bot', history: [] }).eq('phone', fromNumber).eq('waba_number', toNumber);
            await sendWhatsApp(fromNumber, "🔄 Memoria borrada. ¡Empecemos de nuevo! ¿En qué te ayudo?", toNumber);
            return new Response('Reset ok', { status: 200 });
          }

          // Comando /bot: El despachador humano devuelve el control al bot
          if (textBody.toLowerCase().trim() === '/bot') {
            await supabase.from('whatsapp_sessions').update({ estado: 'bot' }).eq('phone', fromNumber).eq('waba_number', toNumber);
            await sendWhatsApp(fromNumber, "🤖 Modo bot reactivado. El asistente retomará la conversación con el cliente.", toNumber);
            console.log(`[COEXISTENCE] Sesión ${fromNumber} devuelta a modo BOT por comando /bot.`);
            return new Response('Bot mode restored', { status: 200 });
          }

          // Bug Fix: VERIFICAR MODO HUMANO ANTES de cualquier procesamiento de LLM
          // (Antes esto estaba DESPUÉS de adquirir el lock, lo que causaba que el bot
          // procesara el mensaje igualmente si el humano contestaba durante el debounce)
          if (session.estado === 'human') {
            console.log(`[COEXISTENCE] La sesión de ${fromNumber} está en modo HUMANO. El bot no interviene.`);
            return new Response('Human mode - silenced', { status: 200 });
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
            return new Response('Configurar ok', { status: 200 });
          }

          // UX: Marcar mensaje como leído (palomitas azules) para restaurantes
          const tipoNegocio = empresa.tipo_negocio || 'taxi';
          if (tipoNegocio === 'restaurante' || tipoNegocio === 'comida') {
            // Fire & forget — no bloqueamos el flujo principal
            if (inboundMessageId) markAsRead(inboundMessageId).catch(() => {});
            // sendTypingIndicator toma (fromNumber=destino del typing, toNumber=numero WABA)
            sendTypingIndicator(fromNumber, toNumber).catch(() => {});
          }

          // 3. ACTUALIZAR HISTORIAL
          let history = session.history || [];
          // Poda inteligente de contexto (basada en tokens aproximados)
          history = pruneContext(history);

          // Historial estrictamente limpio: solo {role, content}
          history.push({ role: 'user', content: textBody });

          // Registrar el message_id como visto (en campo separado, no en el historial)
          if (inboundMessageId) {
            seenIds.push(inboundMessageId);
            // Mantener solo los últimos 50 IDs para no crecer indefinidamente
            if (seenIds.length > 50) seenIds.splice(0, seenIds.length - 50);
          }

          // 4. LLAMAR A OPENAI
          const ciudadTenant = empresa.ciudad || 'Comitán de Domínguez, Chiapas';

          // 3. GENERAR PROMPT (Estrategia por Dominio)
          const { data: currentViaje } = await supabase.from('viajes').select('estado, origen, destino, taxi_name').eq('cliente_tel', fromNumber).in('estado', ['buscando_conductor', 'en_camino']).maybeSingle();

          let infoViajeActivo = '';
          if (currentViaje) {
            infoViajeActivo = `[INFO DEL SISTEMA: El cliente tiene un viaje activo en estado '${currentViaje.estado}'. Origen: ${currentViaje.origen}, Destino: ${currentViaje.destino}. Unidad asignada: ${currentViaje.taxi_name || 'Buscando'}].`;
          }

          // ══════════════════════════════════════════════════════════
          // SHORTCUT OBLIGATORIO DE MENÚ — SIN PASAR POR OPENAI
          // Si el cliente pide el menú, ejecutamos por código directamente.
          // Esto es 100% determinístico: nunca puede responder en texto.
          // ══════════════════════════════════════════════════════════
          const esRestaurante = (empresa.tipo_negocio === 'restaurante' || empresa.tipo_negocio === 'comida');
          const msgLower = textBody.toLowerCase().trim();
          const esConsultaMenu = esRestaurante && (
            msgLower === 'ver menú' || msgLower === 'ver menu' ||
            msgLower === 'menú' || msgLower === 'menu' ||
            msgLower === 'carta' || msgLower === 'lista' ||
            msgLower === 'opciones' || msgLower === 'ver opciones' ||
            msgLower.startsWith('ver el menú') || msgLower.startsWith('ver el menu') ||
            msgLower.startsWith('qué tienen') || msgLower.startsWith('que tienen') ||
            msgLower.startsWith('qué hay') || msgLower.startsWith('que hay') ||
            msgLower.startsWith('cuál es el menú') || msgLower.startsWith('cual es el menu') ||
            msgLower.startsWith('muéstrame') || msgLower.startsWith('muestrame') ||
            msgLower.includes('ver menú') || msgLower.includes('ver menu') ||
            (msgLower.includes('menú') && msgLower.length < 40) ||
            (msgLower.includes('menu') && msgLower.length < 40)
          );

          if (esConsultaMenu) {
            console.log(`[MENU SHORTCUT] Solicitud de menú detectada. Ejecutando flujo directo sin OpenAI.`);
            try {
              // Query directo a catalogos — obtenemos todos (hasta 100) para ver el tamaño real
              const { data: catalogItems, error: catError } = await supabase
                .from('catalogos')
                .select('nombre, precio, detalles, tipo_item')
                .eq('tenant_id', empresa.id)
                .eq('disponible', true)
                .order('tipo_item', { ascending: true, nullsFirst: false })
                .order('nombre', { ascending: true })
                .limit(100);

              console.log(`[MENU SHORTCUT] Catálogo: ${catalogItems?.length ?? 0} items. Error: ${catError?.message || 'ninguno'}`);

              if (catalogItems && catalogItems.length > 0) {
                const { handleMostrarMenuLista } = await import('../_shared/bot/restaurante/tools.ts');
                
                if (catalogItems.length <= 10) {
                  // Caben todos en una sola lista
                  const items = catalogItems.map(item => ({
                    nombre: item.nombre,
                    descripcion: item.precio != null ? `$${item.precio}` : (item.detalles?.descripcion || item.detalles?.descripcion_corta || ''),
                    categoria: item.tipo_item || 'Menú'
                  }));
                  await handleMostrarMenuLista(
                    { items, mensaje: '¡Aquí está nuestro menú! 🍗 Toca un producto para seleccionarlo:', boton: 'Ver Menú 🍽️' },
                    fromNumber,
                    toNumber,
                    undefined
                  );
                  console.log(`[MENU SHORTCUT] ✅ Lista de ${items.length} productos enviada (menú pequeño).`);
                } else {
                  // Son más de 10 productos (WhatsApp rechazaría la lista si mandamos todos).
                  // Solución: Mandar la lista de CATEGORÍAS primero.
                  const categoriasSet = new Set<string>();
                  catalogItems.forEach(item => {
                    categoriasSet.add(item.tipo_item || 'Menú');
                  });
                  
                  const categoriasUnicas = Array.from(categoriasSet).slice(0, 10); // Máximo 10 categorías
                  const itemsCategoria = categoriasUnicas.map(cat => ({
                    nombre: cat,
                    descripcion: `Ver opciones de ${cat}`,
                    categoria: 'Categorías'
                  }));

                  await handleMostrarMenuLista(
                    { items: itemsCategoria, mensaje: 'Tenemos muchas opciones deliciosas 😋. Por favor, selecciona una categoría para ver los productos:', boton: 'Categorías 📋' },
                    fromNumber,
                    toNumber,
                    undefined
                  );
                  console.log(`[MENU SHORTCUT] ✅ Lista de ${categoriasUnicas.length} categorías enviada (menú grande).`);
                }
              } else {
                // Fallback: catálogo vacío o sin tenant configurado
                await sendWhatsApp(fromNumber, '¡Hola! 😊 Tenemos muchas opciones deliciosas. Escríbeme qué se te antoja y te ayudo directamente.', toNumber);
              }
            } catch (menuErr) {
              console.error('[MENU SHORTCUT] Error:', menuErr);
              await sendWhatsApp(fromNumber, '¡Hola! 😊 ¿En qué te puedo ayudar hoy?', toNumber);
            }


            // Guardar en historial y salir sin llamar a OpenAI
            history.push({ role: 'assistant', content: '¡Aquí está nuestro menú! 🍗' });
            await supabase.from('whatsapp_sessions').update({
              history,
              seen_message_ids: seenIds,
              estado: 'bot',  // Liberar lock explícitamente
              updated_at: new Date().toISOString()
            }).eq('phone', fromNumber).eq('waba_number', toNumber);
            console.log(`[MENU SHORTCUT] ✅ Historial guardado y lock liberado. Saliendo sin OpenAI.`);
            return new Response(JSON.stringify({ success: true, processed: true, via: 'menu_shortcut' }), {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          // ══════════════════════════════════════════════════════════

          const systemPrompt = buildSystemPrompt(empresa, infoViajeActivo);

          const messagesForOpenAI = [
            { role: 'system', content: systemPrompt },
            ...history
          ];

          const openaiApiKey = Deno.env.get('OPENAI_API_KEY') || '';
          if (!openaiApiKey) {
            console.error('[OPENAI] ⚠️ OPENAI_API_KEY no está definida en las variables de entorno!');
          }

          console.log(`[OPENAI] Consultando OpenAI (gpt-4o) para ${fromNumber}...`);
          const botTools = getToolsForBusiness(empresa.tipo_negocio || 'taxi');
          const openaiRes = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openaiApiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: 'gpt-4o',
              messages: messagesForOpenAI,
              temperature: 0.2,
              tools: botTools,
              tool_choice: 'auto',
              max_tokens: 1000  // Aumentado: evita truncar JSON de tool calls con muchos items
            })
          });

          if (!openaiRes.ok) {
            const errText = await openaiRes.text();
            console.error(`[OPENAI] Error ${openaiRes.status}:`, errText);
            throw new Error(`OpenAI API Error: ${errText}`);
          }

          const aiData = await openaiRes.json();
          console.log(`[OPENAI] ✅ Respuesta recibida. finish_reason: ${aiData.choices[0].finish_reason}, tool_calls: ${aiData.choices[0].message.tool_calls?.length || 0}`);
          let aiResponse = aiData.choices[0].message.content?.trim() || '';

          // 5. PROCESAR NATIVE TOOL CALL
          let executedTool = '';
          let toolData: ToolData = {};

          if (aiData.choices[0].message.tool_calls && aiData.choices[0].message.tool_calls.length > 0) {
            const tCall = aiData.choices[0].message.tool_calls[0];
            executedTool = tCall.function.name;
            console.log(`[TOOLS] Ejecutando tool: ${executedTool}`);
            try {
              toolData = safeParseToolData(executedTool, JSON.parse(tCall.function.arguments));
            } catch (e) {
              console.error("[TOOLS] Error parseando argumentos:", e);
            }
          }

          let trackingUrlForCTA = null;

          if (executedTool) {
            console.log(`[TOOLS] Llamando a routeToolCall para: ${executedTool}`);
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
            console.log(`[TOOLS] routeToolCall completado. Response: ${routeResult.finalResponse?.substring(0, 50)}...`);
            aiResponse = routeResult.finalResponse;
            trackingUrlForCTA = routeResult.trackingUrl;

            // Bug Fix: Para herramientas RAG (consultar_catalogo), el resultado NO va directo al cliente.
            // Se inyecta de vuelta al LLM para que redacte una respuesta natural, concisa y sin spam.
            if (executedTool === 'consultar_catalogo') {
              const ragContext = routeResult.finalResponse;
              // Resetear aiResponse — si el segundo pass falla, mandaremos un fallback limpio
              // y NO el catálogo RAW que llegó de la BD
              aiResponse = '';
              // Truncar contexto RAG para evitar prompts gigantes
              const ragContextTruncated = ragContext.length > 1500
                ? ragContext.substring(0, 1500) + '\n...(más resultados disponibles)'
                : ragContext;
              const secondPassMessages = [
                messagesForOpenAI[0], // CRÍTICO: Siempre mantener el System Prompt
                ...messagesForOpenAI.slice(1).slice(-15), // Últimos 15 mensajes de contexto para no olvidar imágenes
                { role: 'assistant', content: `[Consultando catálogo...]` },
                {
                  role: 'user',
                  content:
                    `CONTEXTO INTERNO (NO lo repitas al cliente): ${ragContextTruncated}\n\n` +
                    `TAREA: El cliente preguntó: "${textBody}". Basándote en el contexto anterior Y en tus REGLAS PRINCIPALES de sistema, responde de forma breve y amable en máximo 2 oraciones. ` +
                    `Si hay más de 2 opciones relevantes, usa la herramienta "mostrar_menu_lista" en lugar de listarlas en texto. ` +
                    `NUNCA copies ni reproduzcas el contexto literal. NUNCA uses viñetas ni listas de texto.`
                }
              ];
              try {
                const secondRes = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${openaiApiKey}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    model: 'gpt-4o',
                    messages: secondPassMessages,
                    temperature: 0.2,
                    tools: botTools,         // ← CRÍTICO: sin esto OpenAI no puede llamar mostrar_menu_lista
                    tool_choice: 'auto',
                    max_tokens: 600
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
                console.error('[RAG SECOND PASS] Error en segunda llamada a OpenAI:', ragErr);
                aiResponse = 'Tenemos opciones deliciosas en el menú. ¿Qué te gustaría ordenar hoy?';
              }
            }
          }

          // Sanitización final para WhatsApp (solo para texto libre, NO para mensajes de confirmación de herramientas)
          // IMPORTANTE: Los mensajes entre corchetes como '[El menú fue enviado]' son intencionales y
          // DEBEN preservarse para el historial. Solo sanitizamos bloques de código o JSON raw.
          const isToolConfirmationMsg = executedTool !== '' && aiResponse.startsWith('[') && aiResponse.endsWith(']');
          if (!isToolConfirmationMsg) {
            aiResponse = aiResponse
              .replace(/```(?:json)?[\s\S]*?```/gi, '')
              .replace(/\{[\s\S]*?"tool"[\s\S]*?\}/g, '')
              .replace(/```/g, '')
              .replace(/^\[SISTEMA\]\s*/gi, '')  // Solo elimina el prefijo [SISTEMA], no todo [...]  
              .replace(/^\[Asistente\]\s*/gi, '') // Solo elimina [Asistente]
              .replace(/\n{3,}/g, '\n\n')
              .trim();
          }

          // Guardamos en historial si la respuesta no está vacía.
          // CRÍTICO: Los mensajes de confirmación de herramientas (placeholders internos) NO deben
          // guardarse literalmente en el historial — el LLM los leería y los repetiría como respuesta.
          // En su lugar guardamos un marcador limpio y neutro.
          if (isToolConfirmationMsg) {
            // NO guardar el marcador interno en el historial de 'assistant'.
            // Si lo guardamos, OpenAI lo lee y lo REPITE al cliente en el siguiente turno.
            // Simplemente lo ignoramos — el tool result ya fue guardado como 'tool' role implícitamente.
          } else if (aiResponse.length > 0) {
            history.push({ role: 'assistant', content: aiResponse });
          } else if (executedTool) {
            // Tool sin confirmation message — tampoco guardamos nada para no contaminar el historial
          }

          // Fallback: si después de todo el proceso no hay nada que enviar, mandamos un mensaje genérico
          // para que el usuario no quede en silencio absoluto.
          if (aiResponse.length === 0 && !isToolConfirmationMsg && !trackingUrlForCTA) {
            console.warn(`[FALLBACK] aiResponse vacío sin tool activo. Enviando mensaje de fallback a ${fromNumber}.`);
            aiResponse = 'Lo siento, no entendí bien tu mensaje. ¿Me puedes decir en qué te puedo ayudar? 😊';
          }

          // SIEMPRE guardamos el historial para que los mensajes del usuario no se pierdan
          // y el bot sepa que ya no es el "primer mensaje"
          console.log(`[DB] Guardando historial... aiResponse.length: ${aiResponse.length}`);
          const updateResult = await supabase.from('whatsapp_sessions').update({
            history,
            seen_message_ids: seenIds,
            updated_at: new Date().toISOString()
          }).eq('phone', fromNumber).eq('waba_number', toNumber);
          console.log(`[DB] Historial guardado. Error: ${updateResult.error?.message || 'ninguno'}`);

          // Enviamos el WhatsApp al cliente
          console.log(`[SEND] Evaluando envío. trackingUrl: ${!!trackingUrlForCTA}, executedTool: '${executedTool}', aiResponse.length: ${aiResponse.length}`);
          if (trackingUrlForCTA) {
            // Si hay URL de tracking, siempre mandar CTA aunque aiResponse esté vacío
            if (aiResponse.length > 0) {
              console.log(`[SEND] Enviando CTA con tracking URL...`);
              await sendWhatsAppCTA(
                fromNumber,
                aiResponse,
                "📍 Seguir Viaje",
                trackingUrlForCTA,
                toNumber
              );
              console.log(`[SEND] CTA enviado.`);
            }
          } else if (aiResponse.includes('Hubo un error procesando tu solicitud')) {
            console.log(`[SEND] Enviando mensaje de error al cliente...`);
            await sendWhatsApp(fromNumber, aiResponse, toNumber);
            console.log(`[SEND] Mensaje de error enviado.`);
          } else if (executedTool === 'mostrar_menu_lista' && aiResponse.includes('No encontré opciones')) {
            // Si la lista estaba vacía, mandamos el mensaje de error como texto normal
            console.log(`[SEND] Enviando fallback de lista vacía...`);
            await sendWhatsApp(fromNumber, aiResponse, toNumber);
            console.log(`[SEND] Fallback enviado.`);
          } else if (
            // No enviar texto cuando la herramienta ya mandó el mensaje interactivo directamente
            // Estas herramientas envían su propio mensaje por YCloud — cualquier texto extra es ruido
            executedTool !== 'pedir_ubicacion' &&
            executedTool !== 'preguntar_tipo_entrega' &&
            executedTool !== 'mostrar_menu_lista' &&
            executedTool !== 'escalar_humano'
          ) {
            // BugFix: antes si executedTool === '' y aiResponse vacío, se saltaba silenciosamente
            // Ahora: si aiResponse tiene contenido, siempre lo mandamos
            if (aiResponse.length > 0 && !isToolConfirmationMsg) {
              console.log(`[SEND] Enviando respuesta de texto al cliente...`);
              await sendWhatsApp(fromNumber, aiResponse, toNumber);
              console.log(`[SEND] ✅ Respuesta enviada.`);
            } else {
              console.log(`[SEND] Sin mensaje que enviar. aiResponse vacío o es tool confirmation.`);
            }
          }

        } finally {
          // Liberar el lock de sesión siempre, haya error o no
          if (lockAcquired) {
            console.log(`[LOCK] Liberando lock de sesión...`);
            await supabase.from('whatsapp_sessions').update({ estado: 'bot', updated_at: new Date().toISOString() }).eq('phone', fromNumber).eq('waba_number', toNumber);
            console.log(`[LOCK] Lock liberado.`);
          }
        }
      } // Fin de if (payload.type === 'whatsapp.inbound_message' || payload.whatsappInboundMessage)

      return new Response(JSON.stringify({ success: true, processed: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

  } catch (error: unknown) {
    queueStatus = 'error';
    const err = error as Error;
    console.error("[PROCESS QUEUE ERROR]", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  } finally {
    // ESTE FINALLY SE EJECUTA SIEMPRE, INCLUSO CON CUALQUIER RETURN TEMPRANO
    if (queueId) {
      try {
        console.log(`[QUEUE] Actualizando estado a '${queueStatus}'...`);
        await supabase
          .from('webhook_queue')
          .update({ status: queueStatus, processed_at: new Date().toISOString() })
          .eq('id', queueId);
        console.log(`[QUEUE] Estado actualizado.`);
      } catch (qErr) {
        console.error('[PROCESS QUEUE] Error actualizando status en finally:', qErr);
      }
    }
  }
}, { port: parseInt(Deno.env.get('PORT') || '8000'), hostname: '0.0.0.0' });
