import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { resolveLocation, reverseGeocode } from '../_shared/geo.ts';
import { getNearestTaxi } from '../_shared/traccar.ts';
import { dispatchToHuman, sendWhatsApp, sendWhatsAppCTA, sendWhatsAppLocationRequest, sendWhatsAppButtons } from '../_shared/whatsapp.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || '';
const APP_URL = Deno.env.get('APP_URL') || 'https://stellar.estrella-eats.mx';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

declare const EdgeRuntime: any;

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

    if (payload.type === 'whatsapp.message.updated') {
      return new Response('Status update received', { status: 200 });
    }

    const doWork = async () => {
    // YCloud Webhook Types (v2) - Buscamos mensajes entrantes de WhatsApp
    if (payload.type === 'whatsapp.inbound_message' || payload.whatsappInboundMessage) {
      const msgObj = (payload.whatsappInboundMessage || payload) as Record<string, unknown>;
      const fromNumber = msgObj.from as string; // Teléfono del cliente
      const toNumber = msgObj.to as string;     // Teléfono de la base (waba_number)

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

      // 1.5. ¿Es un Chofer respondiendo a una oferta (botón interactivo o texto '1')?
      // OJO: Como ahora leemos teléfonos de Traccar también, el teléfono entrante podría NO estar en la tabla 'conductores'.
      // Sin embargo, si el botón apretado empieza con "accept_", sabemos exactamente qué taxi es (accept_DEVICEID)
      let isDriverAccepting = false;
      let acceptingDeviceId = null;
      let acceptingDriverName = "Taxi";

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

      if (interactiveId.startsWith('reject_')) {
        await sendWhatsApp(fromNumber, `❌ Has rechazado el viaje. Se buscará otra unidad.`, toNumber);
        return new Response('Viaje rechazado por chofer', { status: 200 });
      }

      if (isDriverAccepting && acceptingDeviceId) {
        console.log(`[DEBUG_ASSIGN] Driver accepting! deviceId: ${acceptingDeviceId}, type: ${typeof acceptingDeviceId}`);
        // Buscar los últimos viajes pendientes y filtrar en JS para evitar problemas de tipos con arrays en Supabase
        const { data: pendingTrips, error: tripsErr } = await supabase.from('viajes')
          .select('id, token, origen, destino, cliente_nombre, cliente_tel, origen_lat, origen_lng, conductores_contactados')
          .eq('tenant_id', empresa.id)
          .eq('estado', 'buscando_conductor')
          .order('created_at', { ascending: false })
          .limit(10);

        console.log(`[DEBUG_ASSIGN] pendingTrips fetch error:`, tripsErr);
        console.log(`[DEBUG_ASSIGN] pendingTrips length:`, pendingTrips?.length);
        if (pendingTrips) {
          pendingTrips.forEach(t => {
            console.log(`[DEBUG_ASSIGN] Trip ${t.id} - contactados: ${JSON.stringify(t.conductores_contactados)}`);
          });
        }

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
        console.log(`[DEBUG_ASSIGN] Found matching trip?`, !!pendingTrip);

        let assigned = false;
        let assignErr: any = null;

        if (pendingTrip) {
          console.log(`[DEBUG_ASSIGN] Executing assign_taxi_to_trip RPC...`);
          // Asignación atómica mediante RPC
          const res = await supabase.rpc('assign_taxi_to_trip', {
            v_id: pendingTrip.id,
            p_device_id: acceptingDeviceId,
            p_taxi_name: acceptingDriverName || null
          });
          assigned = res.data;
          assignErr = res.error;
          console.log(`[DEBUG_ASSIGN] RPC Result: assigned=${assigned}, error=${JSON.stringify(assignErr)}`);

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

        const dbgInfo = `\n\n[DBG: pTrip=${pendingTrip ? pendingTrip.id : 'null'}, assigned=${assigned}, err=${assignErr ? JSON.stringify(assignErr) : 'null'}]`;
        console.log(`[DEBUG_ASSIGN] Fallback: Sending Lo siento message`);
        await sendWhatsApp(fromNumber, `❌ Lo siento, este viaje ya fue asignado a otra unidad que aceptó primero o fue cancelado.${dbgInfo}`, toNumber);
        return new Response('Viaje ganado por otro', { status: 200 });
      }

      // 2. RECUPERAR SESIÓN DE CLIENTE
      const { data: sessionData } = await supabase.from('whatsapp_sessions').select('*').eq('phone', fromNumber).eq('waba_number', toNumber).maybeSingle();
      let session = sessionData;

      if (!session) {
        const { data: newSession, error: sErr } = await supabase.from('whatsapp_sessions').insert({
          phone: fromNumber, waba_number: toNumber, tenant_id: empresa.id, estado: 'bot', history: [], pending_messages: []
        }).select().single();
        if (sErr) console.warn('[YCLOUD] Error creando sesión:', sErr);
        session = newSession;
      }

      // 2.5 DEBOUNCE LOGIC (5 SEGUNDOS)
      if (session) {
        const myRequestTime = new Date().toISOString();
        const currentPending = session.pending_messages || [];
        const newPending = [...currentPending, textBody];

        await supabase.from('whatsapp_sessions')
          .update({
            pending_messages: newPending,
            last_user_msg_at: myRequestTime
          })
          .eq('phone', fromNumber).eq('waba_number', toNumber);

        console.log(`[DEBOUNCE] ${fromNumber} - Esperando 2 segundos para acumular mensajes...`);
        await new Promise(r => setTimeout(r, 2000));

        const { data: checkSession } = await supabase.from('whatsapp_sessions').select('last_user_msg_at, pending_messages').eq('phone', fromNumber).eq('waba_number', toNumber).single();

        const checkLen = checkSession?.pending_messages?.length || 0;
        const myLen = newPending.length;

        if (checkSession && checkLen !== myLen) {
          console.log(`[DEBOUNCE] ${fromNumber} - Llegó otro mensaje después (len: ${checkLen} vs ${myLen}). Abortando este webhook.`);
          return new Response('Debounced', { status: 200 });
        }

        // Somos el último webhook (el mensaje más reciente)
        const joinedTextBody = (checkSession?.pending_messages || []).join('\n');
        await supabase.from('whatsapp_sessions').update({ pending_messages: [] }).eq('phone', fromNumber).eq('waba_number', toNumber);

        textBody = joinedTextBody.trim();
        if (!textBody) {
          console.log(`[DEBOUNCE] ${fromNumber} - textBody vacío tras debounce. Abortando.`);
          return new Response('Empty text', { status: 200 });
        }
        console.log(`[DEBOUNCE] ${fromNumber} - Procesando mensaje consolidado: "${textBody}"`);
      }

      if (!session) {
        return new Response('No session', { status: 200 });
      }

      if (textBody.toLowerCase().includes('/reset')) {
        await supabase.from('whatsapp_sessions').update({ estado: 'bot', history: [] }).eq('phone', fromNumber).eq('waba_number', toNumber);
        await sendWhatsApp(fromNumber, "🔄 Memoria borrada. ¡Empecemos de nuevo! ¿En qué te ayudo?", toNumber);
        return;
      }

      // Si el humano tomó el control, el bot no responde
      if (session.estado === 'human') {
        console.log(`[COEXISTENCE] La sesión de ${fromNumber} está en modo HUMANO. El bot no interviene.`);
        return;
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
        objetivoPrompt = 'OBJETIVO PRINCIPAL: Recolectar NOMBRE DEL CLIENTE, ORIGEN y DESTINO. (El teléfono ya lo tienes).';
      } else {
        objetivoPrompt = 'OBJETIVO PRINCIPAL: Recolectar NOMBRE DEL CLIENTE, PEDIDO EXACTO y DIRECCIÓN DE ENTREGA. (El teléfono ya lo tienes).';
      }

      // Revisar si el cliente tiene un viaje activo
      const { data: activeTrips } = await supabase.from('viajes')
        .select('estado, taxi_name')
        .eq('cliente_tel', fromNumber)
        .in('estado', ['buscando_conductor', 'en_camino'])
        .order('created_at', { ascending: false })
        .limit(1);

      let infoViajeActivo = '';
      if (activeTrips && activeTrips.length > 0) {
        const viaje = activeTrips[0];
        const estadoHumano = viaje.estado === 'buscando_conductor' ? 'buscando unidad cercana' : `unidad en camino (${viaje.taxi_name || 'Asignada'})`;
        infoViajeActivo = `\n\n🚨 ¡ATENCIÓN! EL CLIENTE YA TIENE UN VIAJE ACTIVO ACTUALMENTE. Estado del viaje: ${estadoHumano}. \n- NO le ofrezcas mandar otro taxi a menos que te lo pida explícitamente.\n- Si pregunta por su taxi, tranquilízalo diciéndole el estado actual de su viaje en curso.\n`;
      }

      const systemPrompt = `Eres el despachador de radio de "${nombreEmpresa}", tu nombre es ${nombreBot}.
Tu trabajo es atender al cliente por WhatsApp de manera súper natural, inteligente y humana, como un despachador real en México.
ESTÁS EN LA CIUDAD DE: ${ciudadTenant}.
${infoViajeActivo}
REGLAS DE ORO (CRITERIO):
1. TONO: Cálido, ágil y coloquial mexicano ("Claro que sí", "Con mucho gusto", "Enterado").
2. PRESENTACIÓN: Si el cliente solo dice "Hola" o es su primer mensaje, preséntate brevemente (Ej: "¡Hola! Soy el asistente de ${nombreEmpresa}, ¿te mando un taxi?").
3. BREVEDAD: Máximo 15-20 palabras por mensaje. Usa 1 o 2 emojis (🚕, 📍). Pide un dato a la vez.
4. CRITERIO GEOGRÁFICO: Si el cliente pide ir a una ciudad o estado diferente, o muy lejos, rechaza amablemente. Si la dirección es muy vaga, exige una referencia.
5. QUEJAS O PROBLEMAS: Si el cliente está enojado, se queja de un viaje, o hace preguntas que no puedes resolver, NO intentes pedirle origen/destino. Usa la herramienta de "escalar_humano".
6. COTIZACIONES: **MUY IMPORTANTE:** Si el cliente pide un taxi, usa "book_taxi" DE INMEDIATO. **SOLO** usa "cotizar_viaje" si el cliente pregunta EXPLÍCITAMENTE por el precio.
7. ${objetivoPrompt} ANTES de confirmar cualquier viaje o pedido, DEBES preguntarle su nombre si aún no lo ha dicho (Ej: "¿A nombre de quién mando el taxi?").
8. NUNCA des tiempos de llegada (minutos) ni digas que el taxi "ya va en camino". Cuando vayas a usar "book_taxi", dile solamente algo como: "Perfecto, permíteme un momento, estoy buscando tu unidad..." porque el sistema apenas va a empezar a buscar.
9. INFO EXTRA: ${infoEmpresa}

FORMATO DE HERRAMIENTAS (TOOL CALLS):
Si detectas que debes ejecutar una acción, incluye el JSON exacto al final de tu mensaje.
- SIEMPRE que preguntes al cliente en dónde recogerlo (ej. "¿A dónde te mando el taxi?"), DEBES incluir OBLIGATORIAMENTE al final de tu mensaje:
  {"tool": "pedir_ubicacion"}
- Si ya tienes NOMBRE, ORIGEN y DESTINO claros para mandar el taxi (el ORIGEN puede ser una coordenada):
  {"tool": "book_taxi", "nombre": "...", "origen": "...", "destino": "..."}
- Si el cliente solo quiere saber el PRECIO antes de confirmar:
  {"tool": "cotizar_viaje", "origen": "...", "destino": "..."}
- Si el cliente pide explícitamente CANCELAR su viaje actual:
  {"tool": "cancelar_viaje"}
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
      let toolData: Record<string, string> | null = null;
      let trackingUrlForCTA = null;

      try {
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          toolData = JSON.parse(jsonMatch[0]);
          if (toolData.tool) executedTool = toolData.tool;
          // Extraer el texto limpio quitando el JSON
          aiResponse = aiResponse.replace(/\{[\s\S]*\}/, '').trim();
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
      }

      // 5.0 PEDIR UBICACIÓN (Botón Nativo)
      else if (executedTool === 'pedir_ubicacion') {
        const combinedText = aiResponse
          ? `${aiResponse}\n\n📍 Si lo prefieres, solo toca este botón para enviarnos tu GPS exacto:`
          : `📍 Si lo prefieres, solo toca este botón para enviarnos tu GPS exacto:`;

        await sendWhatsAppLocationRequest(fromNumber, combinedText, empresa.waba_number || '');
        aiResponse = combinedText;
      }

      // 5.0.1 CANCELAR VIAJE
      else if (executedTool === 'cancelar_viaje') {
        console.log(`[BOT] Cancelando viaje para ${fromNumber}`);
        // 1. Buscar el viaje activo del cliente
        const { data: activeTrip } = await supabase.from('viajes')
          .select('id, device_id, taxi_name, estado')
          .eq('cliente_tel', fromNumber)
          .in('estado', ['buscando_conductor', 'en_camino'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (activeTrip) {
          // 2. Marcarlo como cancelado
          await supabase.from('viajes').update({ estado: 'cancelado' }).eq('id', activeTrip.id);

          // 3. Avisar al conductor asignado (si lo hay)
          if (activeTrip.device_id) {
            const { data: conductor } = await supabase.from('conductores').select('telefono_whatsapp').eq('device_id', activeTrip.device_id).maybeSingle();
            if (conductor && conductor.telefono_whatsapp) {
              await sendWhatsApp(conductor.telefono_whatsapp, `❌ *VIAJE CANCELADO* ❌\n\nEl pasajero ha cancelado el viaje. Ya no es necesario que te dirijas al punto.`, toNumber);
            }
          }

          // 4. Avisar al despachador humano
          dispatchToHuman({
            origen: "Cancelación",
            destino: `El cliente canceló su viaje. Unidad afectada: ${activeTrip.taxi_name || 'Ninguna (Estaba buscando)'}.`,
            telefono: fromNumber,
            dispatcherPhoneOverride: empresa.dispatcher_phone,
            isEscalation: true
          });

          aiResponse = "✅ Tu viaje ha sido cancelado exitosamente. Quedo a tus órdenes para cuando necesites otro taxi.";
        } else {
          aiResponse = "No encontré ningún viaje en curso para cancelar en este momento. ¿Te puedo ayudar pidiendo un taxi?";
        }
      }

      // 5.1 BOOK_TAXI
      else if (executedTool === 'book_taxi') {
        console.log(`[BOT] Ejecutando book_taxi para ${fromNumber}. Origen: ${toolData.origen}, Destino: ${toolData.destino}`);

        // Ejecutamos book_taxi (igual que Vapi)
        const locOrigen = await resolveLocation(supabase, toolData.origen, ciudadTenant);
        const locDestino = await resolveLocation(supabase, toolData.destino, ciudadTenant);
        const maxPrecio = Math.max(locOrigen?.precio || 0, locDestino?.precio || 0) || null;

        let nearbyTaxis: Array<{ name: string; distanceKm: number; deviceId: number; phone?: string }> | null = null;
        if (locOrigen?.lat && locOrigen?.lng) {
          try {
            nearbyTaxis = await getNearestTaxi(locOrigen.lat, locOrigen.lng, permisosSistema);
          } catch (err) {
            console.error('[TRACCAR ERROR]', err);
          }
        }

        let assignedTaxi = null;
        let newViajeId = null;
        if (nearbyTaxis && nearbyTaxis.length > 0) {
          const token = generarToken();

          const { data: newViaje, error: insertErr } = await supabase.from('viajes').insert({
            token, tenant_id: empresa.id,
            cliente_tel: fromNumber, cliente_nombre: toolData.nombre, origen: toolData.origen, destino: toolData.destino,
            origen_lat: locOrigen?.lat, origen_lng: locOrigen?.lng,
            estado: 'buscando_conductor',
            conductores_contactados: []
          }).select().single();

          if (!insertErr && newViaje) {
            newViajeId = newViaje.id;
            trackingUrlForCTA = `${APP_URL}/track/${token}`;

            // Cascada robusta
            const topTaxis = nearbyTaxis.slice(0, 3);
            for (const taxi of topTaxis) {
              try {
                const { data: conductor, error: condErr } = await supabase.from('conductores').select('telefono_whatsapp').eq('device_id', taxi.deviceId).maybeSingle();

                // Usar el número de Supabase o caer en el de Traccar directamente
                const telefonoDestino = conductor?.telefono_whatsapp || taxi.phone;

                if (!telefonoDestino) {
                  console.log(`[YCLOUD] Taxi ${taxi.deviceId} no tiene teléfono registrado ni en Supabase ni en Traccar.`);
                  continue;
                }

                const { error: rpcErr } = await supabase.rpc('array_append_viaje_conductores', { v_id: newViajeId, d_id: taxi.deviceId });
                if (rpcErr) console.warn('[YCLOUD] Error RPC:', rpcErr);

                const wabaNumber = empresa.waba_number || '';
                try {
                  const tarifa = maxPrecio ? `$${maxPrecio}` : "A consultar";
                  // @ts-ignore
                  const { sendWhatsAppButtons } = await import('../_shared/whatsapp.ts');
                  await sendWhatsAppButtons(
                    telefonoDestino,
                    `🚕 *¡NUEVA SOLICITUD DE VIAJE!* 🚕\n\n📍 *Origen:* ${locOrigen.nombre_zona || toolData.origen}\n🏁 *Destino:* ${locDestino.nombre_zona || toolData.destino}\n💵 *Tarifa (aprox):* ${tarifa}`,
                    [{ id: `accept_${taxi.deviceId}_${taxi.name}`, title: '✅ Aceptar Viaje' }],
                    wabaNumber
                  );
                } catch (waErr) {
                  console.error('[YCLOUD] Error WA al chofer:', waErr);
                  continue;
                }

                let accepted = false;
                for (let i = 0; i < 5; i++) {
                  await new Promise(res => setTimeout(res, 1000));
                  try {
                    const { data: checkViaje } = await supabase.from('viajes').select('estado, taxi_name').eq('id', newViaje.id).single();
                    if (checkViaje && checkViaje.estado === 'en_camino') {
                      accepted = true;
                      assignedTaxi = { name: checkViaje.taxi_name, distanceKm: taxi.distanceKm };
                      break;
                    }
                  } catch (e) { }
                }
                if (accepted) break;
              } catch (e) {
                console.error('[YCLOUD] Fallo en ciclo de taxi:', e);
              }
            }
          }
        }

        // Revisar si hubo taxis contactados para alertar al despachador si faltan en BD
        let numTaxisContactados = 0;
        if (newViajeId) {
          const { data: checkViaje } = await supabase.from('viajes').select('conductores_contactados').eq('id', newViajeId).maybeSingle();
          if (checkViaje && checkViaje.conductores_contactados) {
            numTaxisContactados = checkViaje.conductores_contactados.length;
          }
        }

        if (assignedTaxi) {
          aiResponse = `🚕 ¡Listo! Tu unidad *${assignedTaxi.name}* ya va en camino.\n\n📍 Sigue tu ruta en vivo tocando el botón abajo:`;
        } else {
          aiResponse = `Listo, ya estamos contactando a las unidades más cercanas. Dame un momentito mientras me confirman quién va por ti.`;
          trackingUrlForCTA = null;
        }

        // Notificamos al humano
        const dispatchTaxiName = assignedTaxi ? assignedTaxi.name : (
          nearbyTaxis && nearbyTaxis.length > 0 && numTaxisContactados === 0
            ? `Por confirmar ⚠️ (Hay taxis a ${nearbyTaxis[0].distanceKm.toFixed(1)}km pero NO tienen WhatsApp registrado en BD)`
            : 'Por confirmar'
        );
        const dispatchTaxiDist = assignedTaxi ? assignedTaxi.distanceKm : (nearbyTaxis && nearbyTaxis.length > 0 ? nearbyTaxis[0].distanceKm : undefined);

        dispatchToHuman({
          origen: toolData.origen, destino: toolData.destino, telefono: fromNumber,
          tarifa: maxPrecio,
          nearestTaxiName: dispatchTaxiName, nearestTaxiDist: dispatchTaxiDist,
          trackingUrl: trackingUrlForCTA || undefined, dispatcherPhoneOverride: empresa.dispatcher_phone
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
      } else if (executedTool !== 'pedir_ubicacion') {
        await sendWhatsApp(fromNumber, aiResponse, toNumber);
      }

      return new Response('OK', { status: 200 });
    }

    return new Response('Webhook procesado', { status: 200 });
    }; // end doWork

    if (typeof EdgeRuntime !== 'undefined' && typeof EdgeRuntime.waitUntil === 'function') {
      EdgeRuntime.waitUntil(doWork());
      return new Response('Background OK', { status: 200 });
    } else {
      doWork().catch(console.error);
      return new Response('Sync OK', { status: 200 });
    }

  } catch (error: unknown) {
    const err = error as Error;
    console.error("[YCLOUD WEBHOOK ERROR]", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
