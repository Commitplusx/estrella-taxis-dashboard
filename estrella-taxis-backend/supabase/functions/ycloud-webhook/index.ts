import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { resolveLocation } from '../_shared/geo.ts';
import { getNearestTaxi } from '../_shared/traccar.ts';
import { dispatchToHuman, sendWhatsApp, sendWhatsAppCTA } from '../_shared/whatsapp.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || '';
const APP_URL = Deno.env.get('APP_URL') || 'https://stellar.estrella-eats.mx';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Genera un token corto y único para la URL de seguimiento del cliente
function generarToken(len = 10): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    console.log('[YCLOUD WEBHOOK] Recibido payload:', JSON.stringify(payload, null, 2));

    // YCloud Webhook Types (v2) - Buscamos mensajes entrantes de WhatsApp
    // Dependiendo de cómo lo configures, puede venir como 'whatsapp.inbound_message'
    if (payload.type === 'whatsapp.inbound_message' || payload.whatsappInboundMessage) {
      const msgObj = payload.whatsappInboundMessage || payload;
      const fromNumber = msgObj.from; // Teléfono del cliente
      const toNumber = msgObj.to;     // Teléfono de la base (waba_number)
      const textBody = msgObj.text?.body;

      if (!fromNumber || !toNumber || !textBody) {
        return new Response('Ignorado: Faltan datos del mensaje', { status: 200 });
      }

      console.log(`[YCLOUD] Mensaje entrante de ${fromNumber} hacia ${toNumber}: "${textBody}"`);

      // 1. GATEKEEPING: Identificar a la Empresa dueña del "toNumber"
      // Limpiamos los números para buscar en la BD
      const cleanToNumber = toNumber.replace(/\D/g, '');
      const { data: allEmpresas } = await supabase.from('empresas').select('*, paquete:paquetes(permisos_sistema, incluye_bot)');

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

      // 2. RECUPERAR SESIÓN
      let { data: session } = await supabase
        .from('whatsapp_sessions')
        .select('*')
        .eq('phone', fromNumber)
        .eq('waba_number', toNumber)
        .maybeSingle();

      if (!session) {
        const { data: newSession, error: createErr } = await supabase
          .from('whatsapp_sessions')
          .insert({
            phone: fromNumber,
            waba_number: toNumber,
            tenant_id: empresa.id,
            history: [],
            estado: 'bot'
          })
          .select()
          .single();

        if (createErr) throw createErr;
        session = newSession;
      }

      // Si el humano tomó el control, el bot no responde
      if (session.estado === 'human') {
        console.log(`[COEXISTENCE] La sesión de ${fromNumber} está en modo HUMANO. El bot no interviene.`);
        return new Response('Modo humano - ignorado', { status: 200 });
      }

      // 3. ACTUALIZAR HISTORIAL
      let history = session.history || [];
      // Mantenemos solo los últimos 10 mensajes para no exceder tokens
      if (history.length > 10) history = history.slice(-10);

      history.push({ role: 'user', content: textBody });

      // 4. LLAMAR A GROQ (Llama-3)
      const nombreBot = empresa.nombre_bot || 'Asistente';
      const nombreEmpresa = empresa.nombre_empresa || 'la empresa';
      const ciudadTenant = empresa.ciudad || 'Comitán de Domínguez, Chiapas';
      const infoEmpresa = empresa.prompt_personalizado || '';

      let objetivoPrompt = '';
      if (empresa.tipo_negocio === 'taxi') {
        objetivoPrompt = 'OBJETIVO PRINCIPAL: Recolectar ORIGEN y DESTINO. (El teléfono ya lo tienes).';
      } else {
        objetivoPrompt = 'OBJETIVO PRINCIPAL: Recolectar PEDIDO EXACTO y DIRECCIÓN DE ENTREGA. (El teléfono ya lo tienes).';
      }

      const systemPrompt = `Eres el despachador de radio de "${nombreEmpresa}", tu nombre es ${nombreBot}.
Tu trabajo es atender al cliente por WhatsApp de manera súper natural, inteligente y humana, como un despachador real en México.
ESTÁS EN LA CIUDAD DE: ${ciudadTenant}.

REGLAS DE ORO (CRITERIO):
1. TONO: Cálido, ágil y coloquial mexicano ("Claro que sí", "Con mucho gusto", "Enterado").
2. BREVEDAD: Máximo 15-20 palabras por mensaje. Usa 1 o 2 emojis (🚕, 📍). Pide un dato a la vez.
3. CRITERIO GEOGRÁFICO: Si el cliente pide ir a una ciudad o estado diferente, o muy lejos, rechaza amablemente ("Híjole, por ahora solo cubrimos el área metropolitana de ${ciudadTenant}"). Si la dirección es muy vaga (ej. "al centro"), exige una referencia ("¿Cerca de qué calle o parque en el centro?").
4. QUEJAS O PROBLEMAS: Si el cliente está enojado, se queja de un viaje, o hace preguntas que no puedes resolver, NO intentes pedirle origen/destino. Usa la herramienta de "escalar_humano".
5. COTIZACIONES: **MUY IMPORTANTE:** Si el cliente pide un taxi, usa "book_taxi" DE INMEDIATO. **SOLO** usa "cotizar_viaje" si el cliente pregunta EXPLÍCITAMENTE por el precio (ej. "¿Cuánto cobras al centro?"). NUNCA des el precio si no te lo piden.
6. ${objetivoPrompt}
7. INFO EXTRA: ${infoEmpresa}

FORMATO DE HERRAMIENTAS (TOOL CALLS):
Si detectas que debes ejecutar una acción, tu respuesta debe ser ÚNICAMENTE el JSON exacto, sin texto adicional.
- Si ya tienes ORIGEN y DESTINO claros para mandar el taxi:
  {"tool": "book_taxi", "origen": "...", "destino": "..."}
- Si el cliente solo quiere saber el PRECIO antes de confirmar:
  {"tool": "cotizar_viaje", "origen": "...", "destino": "..."}
- Si el cliente se QUEJA, o pide HABLAR CON UN HUMANO:
  {"tool": "escalar_humano", "motivo": "resumen del problema"}
`;

      const messagesForGroq = [
        { role: 'system', content: systemPrompt },
        ...history
      ];

      console.log(`[GEMINI] Consultando Gemini-3.6-Flash para ${fromNumber}...`);
      const geminiRes = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GEMINI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gemini-3.6-flash',
          messages: messagesForGroq,
          temperature: 0.2
        })
      });

      if (!geminiRes.ok) {
        throw new Error(`Gemini API Error: ${await geminiRes.text()}`);
      }

      const geminiData = await geminiRes.json();
      let aiResponse = geminiData.choices[0].message.content.trim();

      // 5. PROCESAR TOOL CALL O ENVIAR RESPUESTA
      let executedTool = null;
      let toolData: any = null;
      let trackingUrlForCTA = null;

      try {
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          toolData = JSON.parse(jsonMatch[0]);
          if (toolData.tool) executedTool = toolData.tool;
        }
      } catch (e) {
        // No es JSON válido, es texto normal
      }

      if (executedTool === 'escalar_humano') {
        console.log(`[BOT] Escalando a humano para ${fromNumber}. Motivo: ${toolData.motivo}`);
        aiResponse = "Te comunico con un despachador humano en un momento para que te apoye con esto. 🧑‍💻";
        // Cambiar estado a human en DB para silenciar al bot
        await supabase.from('whatsapp_sessions').update({ estado: 'human' }).eq('phone', fromNumber).eq('waba_number', toNumber);
        // Notificamos al humano
        dispatchToHuman({
          origen: "No aplica (Escalamiento)", destino: toolData.motivo, telefono: fromNumber,
          dispatcherPhoneOverride: empresa.dispatcher_phone,
          isEscalation: true
        });
      } else if (executedTool === 'cotizar_viaje') {
        console.log(`[BOT] Cotizando viaje para ${fromNumber}. Origen: ${toolData.origen}, Destino: ${toolData.destino}`);
        const locOrigen = await resolveLocation(supabase, toolData.origen, ciudadTenant);
        const locDestino = await resolveLocation(supabase, toolData.destino, ciudadTenant);
        if (locOrigen?.lat && locDestino?.lat) {
          const precioNum = locOrigen.precio || locDestino.precio;
          const precioStr = precioNum ? `$${precioNum}` : "$40 - $60";
          aiResponse = `🚕 El viaje te saldría en aprox ${precioStr} MXN. ¿Te mando la unidad de una vez?`;
        } else {
          aiResponse = `🚕 Híjole, no pude encontrar bien esa dirección en el mapa. ¿Me das una calle de referencia o colonia?`;
        }
      } else if (executedTool === 'book_taxi') {
        console.log(`[BOT] Ejecutando book_taxi para ${fromNumber}. Origen: ${toolData.origen}, Destino: ${toolData.destino}`);

        // Ejecutamos book_taxi (igual que Vapi)
        const locOrigen = await resolveLocation(supabase, toolData.origen, ciudadTenant);

        let nearestTaxi = null;
        if (locOrigen?.lat && locOrigen?.lng) {
          try {
            const nearbyTaxis = await getNearestTaxi(locOrigen.lat, locOrigen.lng, permisosSistema);
            if (nearbyTaxis && nearbyTaxis.length > 0) nearestTaxi = nearbyTaxis[0];
          } catch (err) {
            console.error('[TRACCAR ERROR]', err);
          }
        }

        let trackingUrl = null;
        if (nearestTaxi) {
          const token = generarToken();
          trackingUrl = `${APP_URL}/track/${token}`;

          await supabase.from('viajes').insert({
            token, tenant_id: empresa.id,
            device_id: nearestTaxi.deviceId, taxi_name: nearestTaxi.name,
            cliente_tel: fromNumber, origen: toolData.origen, destino: toolData.destino,
            origen_lat: locOrigen?.lat, origen_lng: locOrigen?.lng,
            estado: 'en_camino',
          });

          trackingUrlForCTA = trackingUrl;
          aiResponse = `🚕 ¡Listo! Tu unidad *${nearestTaxi.name}* ya va en camino.\n\n📍 Sigue tu ruta en vivo tocando el botón abajo:`;
        } else {
          aiResponse = `✅ Tu viaje quedó registrado. En unos momentos te asignaremos una unidad y te avisaremos.`;
        }

        // Notificamos al humano
        dispatchToHuman({
          origen: toolData.origen, destino: toolData.destino, telefono: fromNumber,
          tarifa: locOrigen?.precio || null,
          nearestTaxiName: nearestTaxi?.name, nearestTaxiDist: nearestTaxi?.distanceKm,
          trackingUrl: trackingUrl || undefined, dispatcherPhoneOverride: empresa.dispatcher_phone
        });

      } // End isToolCall

      // Guardamos la respuesta del AI en el historial
      history.push({ role: 'assistant', content: aiResponse });
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
      } else {
        await sendWhatsApp(fromNumber, aiResponse, toNumber);
      }

      return new Response('OK', { status: 200 });
    }

    return new Response('Webhook procesado', { status: 200 });

  } catch (error: any) {
    console.error("[YCLOUD WEBHOOK ERROR]", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
