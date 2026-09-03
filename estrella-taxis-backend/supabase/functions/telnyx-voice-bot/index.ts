import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { resolveLocation } from '../_shared/geo.ts';
import { getNearestTaxi } from '../_shared/traccar.ts';
import { dispatchToHuman } from '../_shared/whatsapp.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────
interface Empresa {
  id: string;
  nombre_empresa: string;
  nombre_bot: string;
  tipo_negocio: string;
  telefono_telnyx: string;
  dispatcher_phone: string | null;
  prompt_personalizado: string | null;
  ciudad: string | null;
  activo: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
const TELNYX_API_KEY            = Deno.env.get('TELNYX_API_KEY') || '';
const GEMINI_API_KEY            = Deno.env.get('GEMINI_API_KEY') || '';
const ELEVENLABS_API_KEY        = Deno.env.get('ELEVENLABS_API_KEY') || '';
const SUPABASE_URL              = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const YCLOUD_API_KEY            = Deno.env.get('YCLOUD_API_KEY') || '';
const YCLOUD_SENDER             = Deno.env.get('YCLOUD_SENDER') || '';
const DISPATCHER_PHONE          = Deno.env.get('DISPATCHER_PHONE') || '';
const GOOGLE_MAPS_API_KEY       = Deno.env.get('GOOGLE_MAPS_API_KEY') || '';

const TELNYX_BASE_URL = 'https://api.telnyx.com/v2/calls';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Voz ElevenLabs en español – "Jessica" (natural y clara)
const ELEVENLABS_VOICE_ID = 'cgSgspJ2msm6clMCkdW9';
// eleven_turbo_v2_5: modelo optimizado para tiempo real (~300ms vs ~1.5s de eleven_multilingual_v2)
const ELEVENLABS_MODEL_ID = 'eleven_turbo_v2_5';

// Bucket de Supabase Storage para los audios temporales del bot
const AUDIO_BUCKET = 'voice-bot-audio';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─────────────────────────────────────────────────────────────────────────────
// Enviar un comando a la API de Telnyx Call Control
// ─────────────────────────────────────────────────────────────────────────────
async function telnyxAction(callControlId: string, action: string, payload: Record<string, unknown> = {}) {
  const url = `${TELNYX_BASE_URL}/${callControlId}/actions/${action}`;
  console.log(`[TELNYX ACTION] ${action}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TELNYX_API_KEY}`,
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error(`[TELNYX ERROR] ${action}:`, errText);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Alertas Críticas (Observabilidad Activa)
// ─────────────────────────────────────────────────────────────────────────────
async function sendAdminAlert(message: string) {
  const ycloudKey = Deno.env.get('YCLOUD_API_KEY');
  if (!ycloudKey) return;

  const adminPhone = Deno.env.get('DISPATCHER_PHONE') || '+529611234567';
  const ycloudSender = Deno.env.get('YCLOUD_SENDER') || '+529631444160';

  try {
    await fetch('https://api.ycloud.com/v2/whatsapp/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': ycloudKey },
      body: JSON.stringify({
        from: ycloudSender,
        to: adminPhone,
        type: 'text',
        text: { body: `🚨 *ALERTA CRÍTICA (BOT DE VOZ)* 🚨\n\n${message}` }
      })
    });
  } catch (err) {
    console.error('[ALERT ERROR] No se pudo enviar alerta de WhatsApp:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bloquear la transcripción mientras el bot está hablando (evitar eco)
// ─────────────────────────────────────────────────────────────────────────────
async function setBotSpeaking(callControlId: string, isSpeaking: boolean) {
  await supabase
    .from('telnyx_active_calls')
    .update({ bot_speaking: isSpeaking })
    .eq('call_control_id', callControlId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Consultar si el bot está hablando
// ─────────────────────────────────────────────────────────────────────────────
async function isBotSpeaking(callControlId: string): Promise<boolean> {
  const { data } = await supabase
    .from('telnyx_active_calls')
    .select('bot_speaking')
    .eq('call_control_id', callControlId)
    .maybeSingle();
  return data?.bot_speaking === true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generar audio con ElevenLabs y subirlo a Supabase Storage
// Devuelve la URL pública del MP3, o null si falla
// ─────────────────────────────────────────────────────────────────────────────
async function generateAndUploadAudio(text: string, callControlId: string, customFileName?: string): Promise<string | null> {
  try {
    const fileName = customFileName ? customFileName : `${callControlId}-${Date.now()}.mp3`;

    // Si pasamos un customFileName (como para las muletillas), verificamos si ya existe para ahorrar tiempo
    if (customFileName) {
      const { data: existingData, error: checkError } = await supabase.storage.from(AUDIO_BUCKET).list('fillers', {
        search: customFileName.replace('fillers/', '')
      });
      if (!checkError && existingData && existingData.length > 0) {
        const { data: publicUrlData } = supabase.storage.from(AUDIO_BUCKET).getPublicUrl(fileName);
        return publicUrlData.publicUrl;
      }
    }

    console.log('[ELEVENLABS] Generando audio...');
    const ttsRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text,
          model_id: ELEVENLABS_MODEL_ID,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      console.error('[ELEVENLABS ERROR]', errText);
      return null;
    }

    const audioBuffer = await ttsRes.arrayBuffer();
    const audioBytes  = new Uint8Array(audioBuffer);

    // NOTA: fileName ya fue declarado en la línea 109, reutilizamos la misma variable.
    const { error: uploadError } = await supabase.storage
      .from(AUDIO_BUCKET)
      .upload(fileName, audioBytes, {
        contentType: 'audio/mpeg',
        upsert: true,
      });

    if (uploadError) {
      console.error('[STORAGE ERROR] Upload failed:', uploadError.message);
      return null;
    }

    const { data: publicUrlData } = supabase.storage
      .from(AUDIO_BUCKET)
      .getPublicUrl(fileName);

    console.log('[ELEVENLABS] Audio listo:', publicUrlData.publicUrl);
    return publicUrlData.publicUrl;

  } catch (err) {
    console.error('[ELEVENLABS] Excepcion:', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Borrar el audio temporal del Storage después de reproducirse
// ─────────────────────────────────────────────────────────────────────────────
async function deleteAudioFile(audioUrl: string) {
  try {
    if (audioUrl.includes('fillers/')) return; // No borrar las muletillas cacheadas

    const parts = audioUrl.split(`/${AUDIO_BUCKET}/`);
    if (parts.length < 2) return;
    const fileName = parts[1];
    await supabase.storage.from(AUDIO_BUCKET).remove([fileName]);
    console.log('[STORAGE] Audio eliminado:', fileName);
  } catch (_e) {
    // No es critico si falla la limpieza
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Enviar texto al VPS por REST API para que haga streaming directo a Telnyx
// ─────────────────────────────────────────────────────────────────────────────
async function speakAndListen(callControlId: string, text: string, hangupNext = false) {
  // BLOQUEO: Le decimos al webhook que el bot está hablando para ignorar las transcripciones de Eco.
  await setBotSpeaking(callControlId, true);

  console.log('[PLAY] Enviando texto al VPS para Google Cloud TTS (Fire and forget)...');

  try {
    // Mandamos el audio al VPS, pero NO ESPERAMOS a que termine. (Fire and forget).
    // Esto es vital para regresar el 200 OK a Telnyx instantáneamente y evitar el deadlock.
    fetch('https://taxis.estrella-eats.mx/ws-voice/speak', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-key': '075728a03c7b37229fe8a9b6d4dad4e6500c833a45ade5fcc6ddae9cf5074f17'
      },
      body: JSON.stringify({
        callControlId,
        text,
        hangupAfter: hangupNext ? Math.max(3000, (text.length / 12) * 1000) : null
      })
    }).catch(err => {
      console.error('[VPS STREAM ERROR]', err);
    });

    console.log(`[VPS SPEAK INICIADO] callControlId=${callControlId}`);
    // No reseteamos bot_speaking aquí. Esperaremos el webhook vps.speak.ended.
  } catch (err) {
    console.error('[VPS STREAM EXCEPTION]', err);
    await setBotSpeaking(callControlId, false);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// La lógica pesada de mapas, tarifas y Traccar ahora vive en el proyecto principal (loyalty-estrella)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Llamar a Gemini con el historial de la conversación
// ─────────────────────────────────────────────────────────────────────────────
async function parseWithGemini(callId: string, transcript: string, injectedSystemMessage?: string, saveHistory = true) {
  if (!GEMINI_API_KEY) {
    return { respuesta_hablada: 'Error: No hay API Key de Gemini configurada.', origen: null, destino: null, viaje_listo: false, cliente_confundido: false };
  }

  const { data: callData } = await supabase
    .from('telnyx_active_calls')
    .select('history, origen_actual, destino_actual, telefono_actual, empresa_id')
    .eq('call_control_id', callId)
    .maybeSingle();

  // Cargar config del tenant. Si no existe o falla, se usan los defaults (comportamiento actual).
  let empresa: Empresa | null = null;
  if (callData?.empresa_id) {
    const { data: emp } = await supabase.from('empresas').select('*').eq('id', callData.empresa_id).maybeSingle();
    empresa = emp;
  }

  const nombreBot      = empresa?.nombre_bot      ?? 'Pompeyo Express';
  const nombreEmpresa  = empresa?.nombre_empresa  ?? 'Pompeyo Express';
  const infoEmpresa    = empresa?.prompt_personalizado ?? 'Servicio 24/7. Mascotas permitidas avisando antes. Pago efectivo/tarjeta. Desde $50 MXN, llega en 5 mins.';

  const history    = callData?.history || '';
  const newHistory = `${history}\nCliente: ${transcript}`;

  const currentOrigen = callData?.origen_actual || 'No proporcionado aún';
  const currentDestino = callData?.destino_actual || 'No proporcionado aún';
  const currentTelefono = callData?.telefono_actual || 'No proporcionado aún';

  let objetivoPrompt = '';
  let camposJsonPrompt = '';
  let validacionListaPrompt = '';

  switch (empresa?.tipo_negocio) {
    case 'taxi':
      objetivoPrompt = 'OBJETIVO: Sacar 3 datos (ORIGEN (CALLE Y COLONIA EXACTA), DESTINO, TELÉFONO). Si da una dirección ambigua, pregunta la colonia o referencia.';
      camposJsonPrompt = `"origen":"la calle y colonia de origen", "destino":"el destino del viaje", "telefono":"teléfono del cliente"`;
      validacionListaPrompt = 'Solo pon "viaje_listo": true cuando el cliente confirme y estés 100% seguro de la COLONIA de origen.';
      break;
    case 'restaurante':
    case 'farmacia':
      objetivoPrompt = 'OBJETIVO: Sacar 3 datos (PEDIDO EXACTO, DIRECCIÓN DE ENTREGA CON COLONIA, TELÉFONO). Si el pedido o la dirección son ambiguos, pide aclaración.';
      camposJsonPrompt = `"origen":"dirección de entrega", "destino":"detalle del pedido", "telefono":"teléfono del cliente"`;
      validacionListaPrompt = 'Solo pon "viaje_listo": true cuando el cliente confirme su pedido y tengas la dirección de entrega exacta.';
      break;
    case 'refaccionaria':
      objetivoPrompt = 'OBJETIVO: Sacar 3 datos (PIEZA O REFACCIÓN REQUERIDA, MARCA/AÑO DEL AUTO, TELÉFONO).';
      camposJsonPrompt = `"origen":"marca y año del auto", "destino":"pieza o refacción requerida", "telefono":"teléfono del cliente"`;
      validacionListaPrompt = 'Solo pon "viaje_listo": true cuando confirmen la pieza y auto buscado para pasar el reporte al mostrador.';
      break;
    default:
      objetivoPrompt = 'OBJETIVO: Atender la consulta del cliente, entender qué necesita exactamente (SOLICITUD) y pedir su TELÉFONO y DIRECCIÓN.';
      camposJsonPrompt = `"origen":"dirección o ubicación", "destino":"solicitud o necesidad del cliente", "telefono":"teléfono del cliente"`;
      validacionListaPrompt = 'Solo pon "viaje_listo": true cuando tengas clara la solicitud y los datos de contacto.';
      break;
  }

  const systemPrompt = `Eres el asistente virtual de voz llamado "${nombreBot}", del servicio "${nombreEmpresa}".
Tu trabajo es atender al cliente de manera súper cálida, rápida y natural. Eres humano, no un robot.

INFORMACIÓN DE LA EMPRESA:
${infoEmpresa}

REGLAS ESTRICTAS PARA QUE SUENES HUMANO Y FLUIDO:
1. SÉ SÚPER CONVERSACIONAL Y RELAJADO. Responde en MÁXIMO 15 palabras por turno. Una sola oración corta. No te explayes.
2. USA MULETILLAS NATURALES. Arranca SIEMPRE tus respuestas con una palabra muy corta de reconocimiento como "Claro,", "Va,", "Ok,", "Sí,", "Oye,". NUNCA empieces directo con la respuesta larga.
3. Sé muy coloquial mexicano ("va que va", "claro que sí", "listísimo", "sale y vale", "órale", "qué onda").
4. ${objetivoPrompt}
5. MANTÉN LA MEMORIA: Usa el ESTADO ACTUAL. Si ya tienes un dato, guárdalo en tu JSON. Si hay uno nuevo, actualízalo.
6. CONFIRMACIÓN Y TELÉFONOS (MUY IMPORTANTE): Cuando tengas los 3 datos, confírmaselos. PARA EL NÚMERO DE TELÉFONO: En el texto hablado, SIEMPRE escribe los números separados por guiones (ej. "9-6-1-1-2-3-4-5-6-7") para que la voz lo lea bien. Dile: "A ver, te confirmo: vas de [Dato 1] a [Dato 2], y tu cel es [T-e-l-e-f-o-n-o], ¿todo bien?" y espera el sí. ${validacionListaPrompt}
7. NO repitas como perico. Si el cliente duda o hace pausas, responde de forma empática y no repitas todo el choro. 
8. CONFUSIÓN: Si el cliente habla tonterías o no se entiende, pon "cliente_confundido": true.
9. NADA de emojis ni asteriscos. Texto plano.
10. Responde ÚNICAMENTE en JSON con este formato estricto:
{"razonamiento":"qué tengo y qué falta","respuesta_hablada":"tu frase súper natural y corta", ${camposJsonPrompt}, "viaje_listo":false,"cliente_confundido":false}

ESTADO ACTUAL (MEMORIA INBORRABLE DE LA BASE DE DATOS):
- Origen: ${currentOrigen}
- Destino: ${currentDestino}
- Teléfono: ${currentTelefono}

HISTORIAL DE LA LLAMADA HASTA AHORA:
${newHistory}

${injectedSystemMessage ? `[⚠️ MENSAJE INTERNO DEL SISTEMA PARA TI (NO LO LEAS LITERAL, ÚSALO PARA RESPONDERLE AL CLIENTE): ${injectedSystemMessage}]` : ''}`;

  // gemini-3.7-flash: último modelo de Google (agosto 2026), optimizado para agentic workflows
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: systemPrompt }] }],
      generationConfig: { 
        temperature: 0.3,
        maxOutputTokens: 800  // Suficiente para JSON completo + respuesta de 1-2 oraciones
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('[GEMINI ERROR]', errText);
    await sendAdminAlert(`Fallo de conexión con Gemini API (Google AI).\nError:\n${errText.slice(0, 200)}`);
    return { respuesta_hablada: 'Tuve un problema técnico. Por favor, llama de nuevo.', origen: null, destino: null, viaje_listo: false, cliente_confundido: true };
  }

  const data    = await res.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

  try {
    const parsed = JSON.parse(cleanJson);
    
    // Normalizar cliente_confundido
    if (typeof parsed.cliente_confundido !== 'boolean') {
      parsed.cliente_confundido = false;
    }

    // Solo guardamos el historial si saveHistory es true. 
    // Actualizamos las columnas de memoria para que el Estado Actual persista
    if (saveHistory) {
      const updatedHistory = `${newHistory}\nPompeyo: ${parsed.respuesta_hablada}`;
      
      const updatePayload: any = { history: updatedHistory };
      if (parsed.origen) updatePayload.origen_actual = parsed.origen;
      if (parsed.destino) updatePayload.destino_actual = parsed.destino;
      if (parsed.telefono) updatePayload.telefono_actual = parsed.telefono;

      await supabase
        .from('telnyx_active_calls')
        .update(updatePayload)
        .eq('call_control_id', callId);
    }
    
    // HARD CAP: cortar respuestas largas para que el audio no pase de ~5 segundos
    if (parsed.respuesta_hablada && parsed.respuesta_hablada.length > 100) {
      const cutoff = parsed.respuesta_hablada.substring(0, 100);
      const lastPunct = Math.max(cutoff.lastIndexOf('.'), cutoff.lastIndexOf(','), cutoff.lastIndexOf('?'));
      parsed.respuesta_hablada = lastPunct > 50 
        ? cutoff.substring(0, lastPunct + 1) 
        : cutoff + '...';
      console.warn('[TRIM] Respuesta truncada a:', parsed.respuesta_hablada);
    }

    return parsed;
  } catch (_e) {
    console.error('[GEMINI PARSE ERROR] Raw text was:', rawText.slice(0, 200));
    
    // INTENTO DE RESCATE: Si el JSON fue truncado, extraer la respuesta_hablada con regex
    const rescueMatch = cleanJson.match(/"respuesta_hablada"\s*:\s*"([^"]+)"/);
    if (rescueMatch) {
      console.warn('[GEMINI RESCUE] Respuesta parcial recuperada:', rescueMatch[1]);
      return { respuesta_hablada: rescueMatch[1], origen: null, destino: null, viaje_listo: false, cliente_confundido: false };
    }
    
    return { respuesta_hablada: 'No te entendí bien. ¿Me lo puedes repetir?', origen: null, destino: null, viaje_listo: false, cliente_confundido: true };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Servidor principal de webhooks
// ─────────────────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method === 'GET') {
    const urlReq = new URL(req.url);
    if (urlReq.searchParams.get('trigger') === 'true') {
      const res = await fetch('https://api.telnyx.com/v2/calls', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          to: '+529631444160',
          from: '+15676031156',
          connection_id: '3039440486772246325',
        }),
      });
      return new Response(await res.text(), { headers: corsHeaders });
    }
  }

  try {
    const bodyText = await req.text();
    if (!bodyText) return new Response('OK', { status: 200 });

    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(bodyText);
    } catch (_e) {
      console.error('[PARSE ERROR] Invalid JSON body');
      return new Response('Bad Request', { status: 400 });
    }

    console.log('[WEBHOOK]', JSON.stringify(body).slice(0, 500));

    const event         = body?.data as Record<string, unknown> | undefined;
    if (!event) return new Response('OK', { status: 200 });

    const eventType     = event.event_type as string;
    const payload       = event.payload as Record<string, unknown> | undefined;
    const callControlId = payload?.call_control_id as string | undefined;

    if (!callControlId) return new Response('OK', { status: 200 });

    switch (eventType) {

      // ── 1. Llamada entrante: contestar ──────────────────────────────────────
      case 'call.initiated':
        if (payload?.direction === 'incoming') {
          await telnyxAction(callControlId, 'answer');
        }
        break;

      // ── 2. Llamada contestada: iniciar transcripción + saludar ─────────────
      case 'call.answered': {
        const callerId   = payload?.from as string || 'Unknown';
        const calledTo   = payload?.to   as string || '';

        // ── Lookup del Tenant (Multi-Tenant) ───────────────────────────────────
        // Buscar la empresa por el número de Telnyx al que llamaron.
        // Si no existe fila → empresa=null → se usan los defaults (sin romper nada).
        let empresa: Empresa | null = null;
        if (calledTo) {
          const { data: emp } = await supabase
            .from('empresas')
            .select('*')
            .eq('telefono_telnyx', calledTo)
            .eq('activo', true)
            .maybeSingle();
          empresa = emp;
          console.log(empresa 
            ? `[TENANT] ${empresa.nombre_empresa} (${empresa.tipo_negocio})` 
            : `[TENANT] Sin registro para ${calledTo}, usando defaults de Pompeyo.`);
        }
        
        // Silent garbage collection: Limpiar llamadas de hace más de 24 horas para no saturar la BD
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        await supabase.from('telnyx_active_calls').delete().lt('created_at', oneDayAgo);

        // Anti-Spam (Rate Limiting): Bloquear si llamaron más de 5 veces en 1 hora
        if (callerId !== 'Unknown') {
          const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
          const { count } = await supabase
            .from('telnyx_active_calls')
            .select('*', { count: 'exact', head: true })
            .eq('caller_id', callerId)
            .gt('created_at', oneHourAgo);

          if (count && count >= 50) {
            console.warn(`[ANTI-SPAM] Bloqueando a ${callerId} por exceder límite (${count} llamadas/hora)`);
            await telnyxAction(callControlId, 'speak', {
              payload: "Has excedido el límite de solicitudes por el momento. Intenta más tarde.",
              voice: 'female',
              language: 'es-MX',
              client_state: btoa('hangup_next')
            });
            break; // Detener flujo, se colgará cuando termine de hablar
          }
        }

        // Smart Resume: look for a previous call in the last 10 minutos
        let previousCall = null;
        if (callerId !== 'Unknown') {
          const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
          const { data } = await supabase
            .from('telnyx_active_calls')
            .select('history, origen_actual, destino_actual, telefono_actual, confusion_count')
            .eq('caller_id', callerId)
            .gt('created_at', tenMinsAgo)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          previousCall = data;
        }

        let welcomeText = `¡Hola! Bienvenido a ${empresa?.nombre_empresa ?? 'Pompeyo Express'}. ¿En qué te puedo ayudar?`;
        let initialHistory = `${empresa?.nombre_bot ?? 'Pompeyo'}: ${welcomeText}`;
        let resumeData = {};

        if (previousCall && (previousCall.origen_actual || previousCall.destino_actual)) {
           console.log(`[SMART RESUME] Retomando llamada de ${callerId}`);
           welcomeText = `¡Hola de nuevo! Creo que se nos cortó la llamada. ¿Seguimos con tu viaje?`;
           initialHistory = `${previousCall.history}\nCliente: [LLAMADA CORTADA]\n${empresa?.nombre_bot ?? 'Pompeyo'}: ${welcomeText}`;
           resumeData = {
             origen_actual: previousCall.origen_actual,
             destino_actual: previousCall.destino_actual,
             telefono_actual: previousCall.telefono_actual,
             confusion_count: previousCall.confusion_count
           };
        }

        await supabase.from('telnyx_active_calls').upsert([{
          call_control_id: callControlId,
          caller_id: callerId,
          history: initialHistory,
          bot_speaking: true,
          empresa_id: empresa?.id ?? null,  // Guarda el tenant para que parseWithGemini lo use
          ...resumeData
        }]);

        console.log('[TRANSCRIPTION] Iniciando transcripción con Deepgram...');
        await telnyxAction(callControlId, 'transcription_start', {
          transcription_engine: 'deepgram',
          language: 'es',
          transcription_tracks: 'inbound',
          // 400ms: detectar fin de frase más rápido para reducir tiempo muerto
          utterance_end_ms: 400,
          smart_format: false,
        });
        
        console.log('[STREAMING] Conectando llamada al servidor VPS WebSocket...');
        await telnyxAction(callControlId, 'streaming_start', {
          stream_url: 'wss://taxis.estrella-eats.mx/media',
          stream_track: 'both_tracks',
          stream_bidirectional_mode: 'rtp'
        });
        
        console.log('[TRANSCRIPTION] transcription_start (deepgram) enviado');

        // Solución directa: el VPS manejará la latencia con su retry loop.
        await speakAndListen(callControlId, welcomeText);

        break;
      }

      // ── 3a. Bot terminó reproducción ElevenLabs (principal) ─────────────────
      case 'call.playback.ended': {
        const clientStateRaw = payload?.client_state as string | undefined;
        const audioUrl       = payload?.media_url as string | undefined;

        let clientState: string | undefined;
        try {
          clientState = clientStateRaw ? atob(clientStateRaw) : undefined;
        } catch (_e) {
          clientState = clientStateRaw;
        }

        // Limpiar el MP3 temporal del Storage
        if (audioUrl) await deleteAudioFile(audioUrl);

        if (clientState === 'hangup_next') {
          console.log('[HANGUP] Colgando llamada después de despedida.');
          await telnyxAction(callControlId, 'hangup');
        } else {
          await setBotSpeaking(callControlId, false);
          console.log('[LISTEN] Bot terminó (ElevenLabs), esperando al cliente...');
        }
        break;
      }

      // ── 3b. Fallback: Bot terminó con TTS nativo de Telnyx ──────────────────
      case 'call.speak.ended': {
        const clientStateRaw = payload?.client_state as string | undefined;
        let clientState: string | undefined;
        try {
          clientState = clientStateRaw ? atob(clientStateRaw) : undefined;
        } catch (_e) {
          clientState = clientStateRaw;
        }

        if (clientState === 'hangup_next') {
          console.log('[HANGUP] Colgando llamada (fallback TTS).');
          await telnyxAction(callControlId, 'hangup');
        } else {
          await setBotSpeaking(callControlId, false);
          console.log('[LISTEN] Bot terminó (Telnyx TTS), esperando al cliente...');
        }
        break;
      }

      // ── 3c. El VPS nos avisa que ElevenLabs terminó de hablar ──────────────────
      case 'vps.speak.ended': {
        console.log('[LISTEN] El VPS terminó de reproducir ElevenLabs. Liberando bloqueo de eco...');
        await setBotSpeaking(callControlId, false);
        break;
      }

      // ── 4. Transcripción recibida: procesar con Gemini ─────────────────────
      case 'call.transcription': {
        const transcriptionData = payload?.transcription_data as Record<string, unknown> | undefined;
        const transcript        = transcriptionData?.transcript as string | undefined;
        const isFinal           = transcriptionData?.is_final as boolean | undefined;

        if (!isFinal || !transcript || transcript.trim().length < 2) break;

        // Solo ignoramos si el bot está activamente hablando en este instante (para evitar eco)
        const { data: lockData } = await supabase
          .from('telnyx_active_calls')
          .select('bot_speaking')
          .eq('call_control_id', callControlId)
          .maybeSingle();

        if (lockData?.bot_speaking) {
          console.log('[SKIP] Transcripción ignorada por ECO (el bot está hablando):', transcript);
          break;
        }

        console.log(`[CLIENT SAID] "${transcript}"`);

        // Procesamos directamente con Gemini sin muletillas intermedias
        // (las muletillas causaban superposición de audio y conversación rota)
        let aiResult = await parseWithGemini(callControlId, transcript, undefined, false);
        console.log('[GEMINI RAW]', JSON.stringify(aiResult));

        // Obtener estado actual para manejar la confusión
        const { data: currentCall } = await supabase.from('telnyx_active_calls').select('confusion_count').eq('call_control_id', callControlId).maybeSingle();
        let confusionCount = currentCall?.confusion_count || 0;

        if (aiResult.cliente_confundido) {
          confusionCount += 1;
          console.warn(`[CONFUSION] Count: ${confusionCount}`);
        } else {
          confusionCount = 0; // Se resetea si lograron avanzar
        }

        // GRACEFUL HANDOVER (Transferencia a humano)
        if (confusionCount >= 3) {
          console.warn('[HANDOVER] Transfiriendo a humano por demasiada confusión.');
          // Desbloquear el bot antes de transferir para evitar que quede en estado locked para siempre
          await setBotSpeaking(callControlId, false);
          await telnyxAction(callControlId, 'speak', {
            payload: "Te voy a comunicar con un operador humano para que te ayude mejor. Por favor, no cuelgues.",
            voice: 'female',
            language: 'es-MX'
          });
          // Esperamos 4 segundos para que se alcance a decir la frase antes de transferir
          await new Promise(r => setTimeout(r, 4000));
          await telnyxAction(callControlId, 'transfer', {
            to: DISPATCHER_PHONE || '+529611234567'
          });
          break;
        }

        // --- FEEDBACK LOOP: Si hay origen, destino, teléfono y el viaje se marcó como listo, 
        // verificamos si existe en el mapa y sacamos su costo H3.
        if (aiResult.origen && aiResult.destino && aiResult.telefono && aiResult.viaje_listo) {
          
          // Llenamos el silencio incómodo mientras procesamos el mapa a través del VPS
          fetch('https://taxis.estrella-eats.mx/ws-voice/speak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': '075728a03c7b37229fe8a9b6d4dad4e6500c833a45ade5fcc6ddae9cf5074f17' },
            body: JSON.stringify({ callControlId, text: "Permíteme un momento, estoy verificando la dirección en el mapa...", hangupAfter: null })
          }).catch(e => {});

          console.log(`[VALIDANDO UBICACION] Buscando coordenadas y tarifas...`);
          
          try {
            // Cargar el tenant del contexto de esta llamada
            const { data: callCtx } = await supabase
              .from('telnyx_active_calls')
              .select('empresa_id')
              .eq('call_control_id', callControlId)
              .maybeSingle();
            
            let callEmpresa: { ciudad: string | null; dispatcher_phone: string | null } | null = null;
            if (callCtx?.empresa_id) {
              const { data: emp } = await supabase.from('empresas').select('ciudad, dispatcher_phone').eq('id', callCtx.empresa_id).maybeSingle();
              callEmpresa = emp;
            }

            const ciudadTenant = callEmpresa?.ciudad || 'San Cristobal de las Casas, Chiapas, Mexico';
            const locOrigen = await resolveLocation(supabase, aiResult.origen, ciudadTenant);
            
            if (locOrigen.error || !locOrigen.lat || !locOrigen.lng) {
              console.log(`[GEO ERROR] No se encontró el origen: ${aiResult.origen}`);
              aiResult = await parseWithGemini(
                callControlId, 
                transcript, 
                `Error geográfico: No reconozco la ubicación "${aiResult.origen}". El viaje NO está listo. Pídele al cliente referencias de la calle o un lugar conocido cerca de su origen.`,
                true
              );
              aiResult.viaje_listo = false;
            } else {
              console.log(`[GEO SUCCESS] Zona: ${locOrigen.nombre_zona} | Precio: ${locOrigen.precio || 'N/A'}`);
              
              // Buscar taxi más cercano en Traccar
              const nearestTaxi = await getNearestTaxi(locOrigen.lat, locOrigen.lng);
              
              // Disparar WhatsApp al despachador ANTES de hablar con el cliente
              await dispatchToHuman({
                origen: aiResult.origen,
                destino: aiResult.destino,
                telefono: aiResult.telefono,
                tarifa: locOrigen.precio,
                nearestTaxiName: nearestTaxi?.name,
                nearestTaxiDist: nearestTaxi?.distanceKm,
                dispatcherPhoneOverride: callEmpresa?.dispatcher_phone ?? undefined,
              });

              let finalInstruction = '';
              const txtPrecio = locOrigen.precio ? `La tarifa H3 validada es $${locOrigen.precio}. SOLO menciónala si el cliente preguntó por el precio, sino no la digas.` : `Tarifa a calcular.`;
              
              if (nearestTaxi) {
                finalInstruction = `INFO DEL SISTEMA: El viaje fue validado y enviado a la base. ${txtPrecio} Taxi asignado: ${nearestTaxi.name} a ${nearestTaxi.distanceKm.toFixed(1)} km. INSTRUCCIÓN: Actúa natural. Confírmale al cliente diciéndole: "Listo, el taxi ${nearestTaxi.name} ya va para allá". Despídete cordialmente.`;
              } else {
                finalInstruction = `INFO DEL SISTEMA: El viaje fue validado y enviado a la base. ${txtPrecio} No hay taxis disponibles en GPS. INSTRUCCIÓN: Confírmale al cliente que ya anotaste su viaje, pero que los taxis están algo ocupados, que le mandaremos uno apenas se desocupe. Despídete.`;
              }

              aiResult = await parseWithGemini(
                callControlId,
                transcript,
                finalInstruction,
                true
              );
              
              aiResult.viaje_listo = true;
            }
          } catch (err) {
             console.error('[API FETCH ERROR]', err);
             aiResult.respuesta_hablada = "Tuvimos un problema al calcular tu tarifa. Por favor espera en la línea o llama de nuevo.";
             aiResult.viaje_listo = false;
          }
          if (aiResult.viaje_listo) {
            // El viaje se completó exitosamente, podemos borrar el estado activo
            await supabase.from('telnyx_active_calls').delete().eq('call_control_id', callControlId);
            await speakAndListen(callControlId, aiResult.respuesta_hablada, true);
          } else {
            // Guardamos manualmente el historial si hubo un error en la API o le faltan datos
            const { data: callData } = await supabase.from('telnyx_active_calls').select('history').eq('call_control_id', callControlId).maybeSingle();
            const newHistory = `${callData?.history || ''}\nCliente: ${transcript}\nPompeyo: ${aiResult.respuesta_hablada}`;
            
            const manualUpdate: any = { 
              history: newHistory,
              confusion_count: confusionCount
            };
            if (aiResult.origen) manualUpdate.origen_actual = aiResult.origen;
            if (aiResult.destino) manualUpdate.destino_actual = aiResult.destino;
            if (aiResult.telefono) manualUpdate.telefono_actual = aiResult.telefono;

            await supabase.from('telnyx_active_calls').update(manualUpdate).eq('call_control_id', callControlId);
            await speakAndListen(callControlId, aiResult.respuesta_hablada);
          }
        } else {
          // Si no hubo validación de mapa, guardamos manualmente el historial porque el primer parse no lo hizo
          const { data: callData } = await supabase.from('telnyx_active_calls').select('history').eq('call_control_id', callControlId).maybeSingle();
          const newHistory = `${callData?.history || ''}\nCliente: ${transcript}\nPompeyo: ${aiResult.respuesta_hablada}`;
          
          const manualUpdate: any = { 
            history: newHistory,
            confusion_count: confusionCount
          };
          if (aiResult.origen) manualUpdate.origen_actual = aiResult.origen;
          if (aiResult.destino) manualUpdate.destino_actual = aiResult.destino;
          if (aiResult.telefono) manualUpdate.telefono_actual = aiResult.telefono;

          await supabase.from('telnyx_active_calls').update(manualUpdate).eq('call_control_id', callControlId);
          await speakAndListen(callControlId, aiResult.respuesta_hablada);
        }
        break;
      }

      // ── 5. Colgar: limpiar memoria ──────────────────────────────────────────
      case 'call.hangup':
        console.log(`[HANGUP] Llamada terminada: ${callControlId}`);
        // NOTA: No borramos la llamada aquí para que funcione el Smart Resume.
        // Las llamadas viejas se pueden limpiar con un cron job en la base de datos.
        break;
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[ERROR] Excepción no manejada:', error);
    return new Response('Internal Server Error', { status: 500, headers: corsHeaders });
  }
});
