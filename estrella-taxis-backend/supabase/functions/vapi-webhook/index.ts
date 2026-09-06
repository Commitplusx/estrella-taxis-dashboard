import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { resolveLocation } from '../_shared/geo.ts';
import { getNearestTaxi } from '../_shared/traccar.ts';
import { dispatchToHuman, sendWhatsApp, sendWhatsAppTemplate } from '../_shared/whatsapp.ts';

// Genera un token corto y único para la URL de seguimiento del cliente
function generarToken(len = 10): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

const APP_URL = Deno.env.get('APP_URL') || 'https://stellar.estrella-eats.mx';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EmpresaRow {
  id: string;
  nombre_empresa?: string;
  nombre_bot?: string;
  tipo_negocio?: string;
  prompt_personalizado?: string;
  telefono_telnyx?: string;
  dispatcher_phone?: string;
  waba_number?: string;
  paquete?: {
    permisos_sistema?: Record<string, boolean>;
    incluye_bot?: boolean;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    console.log('[VAPI WEBHOOK] Recibido payload:', JSON.stringify(payload, null, 2));

    const message = payload.message;
    if (!message) {
      return new Response(JSON.stringify({ error: "No message found in payload" }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 0. Petición Inicial del Asistente (Inbound Call)
    // ─────────────────────────────────────────────────────────────────────────
    if (message.type === 'assistant-request') {
      const urlObj = new URL(req.url);
      const tenantId = urlObj.searchParams.get('tenantId');

      let inboundNumber = message.phoneNumber?.number || message.call?.phoneNumber?.number || '';
      console.log(`[VAPI ASSISTANT REQUEST] Llamada entrante al número: ${inboundNumber}, tenantId en URL: ${tenantId}`);

      let empresa: EmpresaRow | null = null;

      // 1. Intentar buscar por tenantId si viene en la URL
      if (tenantId) {
        const { data } = await supabase.from('empresas').select('*').eq('id', tenantId).maybeSingle();
        if (data) empresa = data;
      }

      // 2. Si no, intentar buscar por teléfono (limpiando el + y espacios)
      if (!empresa && inboundNumber) {
        const cleanInbound = inboundNumber.replace(/\D/g, ''); // Deja solo números (ej: 529631234567)

        // Buscamos todas y filtramos en código por si en la DB está con o sin +
        const { data: allEmpresas } = await supabase.from('empresas').select('*');
        if (allEmpresas) {
          empresa = allEmpresas.find(emp => {
            const cleanDb = (emp.telefono_telnyx || '').replace(/\D/g, '');
            return cleanDb && (cleanInbound.endsWith(cleanDb) || cleanDb.endsWith(cleanInbound));
          });
        }
      }

      if (!empresa) {
        console.warn(`[VAPI ERROR CRÍTICO] NO SE ENCONTRÓ EMPRESA EN LA BASE DE DATOS PARA ESTA LLAMADA.`);
        console.warn(`[VAPI FALLBACK] Se dejará que Vapi use su configuración por defecto del dashboard.`);
        // Devolvemos objeto vacío para que Vapi use su configuración del panel web
        return new Response(JSON.stringify({}), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        });
      }

      // Generar el prompt dinámico 100% de la BD
      const nombreBot = empresa.nombre_bot || 'Agente';
      const nombreEmpresa = empresa.nombre_empresa || 'la empresa';
      const infoEmpresa = empresa.prompt_personalizado || '';

      let objetivoPrompt = '';
      let mensajeInicial = '';
      if (empresa.tipo_negocio === 'taxi') {
        objetivoPrompt = 'OBJETIVO: Recolectar ORIGEN, DESTINO y TELÉFONO. (Origen puede ser un punto de referencia, no obligues calle exacta).';
        mensajeInicial = `¡Buenas! ${nombreEmpresa} al habla, soy ${nombreBot}, ¿en qué le ayudo?`;
      } else {
        objetivoPrompt = 'OBJETIVO: Recolectar PEDIDO EXACTO, DIRECCIÓN DE ENTREGA y TELÉFONO.';
        mensajeInicial = `¡Buenas! ${nombreEmpresa} al habla, soy ${nombreBot}, ¿en qué le ayudo?`;
      }

      const systemPrompt = `Eres el despachador de radio de "${nombreEmpresa}", tu nombre es ${nombreBot}.
Tu trabajo es atender la llamada de manera súper natural y humana, como un despachador real de radio-taxi en México.

1. TONO: Cálido, ágil y coloquial mexicano. Usa frases como "Claro que sí", "Con mucho gusto", "Enterado", "Perfecto".
2. BREVEDAD: Máximo 15 palabras por turno. Sin rodeos.
3. FLUJO NATURAL: Ya te presentaste, así que cuando el cliente diga para qué llama, ve directo a recopilar los datos uno por uno (origen, luego destino, luego teléfono). No los preguntes todos de un jalón.
4. ${objetivoPrompt}
5. INFO EXTRA: ${infoEmpresa}

PROCESO DE RESERVA:
Cuando tengas ORIGEN, DESTINO y TELÉFONO, EJECUTA INMEDIATAMENTE la función (herramienta) \`book_taxi\`.
IMPORTANTE: NO digas "usando herramienta", ni "déjame checar", ni generes NINGÚN texto adicional antes de llamar a la función. SOLO ejecuta la función.
El sistema hablará automáticamente el mensaje de espera mientras procesa.
Cuando la herramienta devuelva el resultado, léelo tal cual al cliente y despídete amablemente.`;

      console.log(`[VAPI ASSISTANT CONFIG] Construyendo agente para BD: ${nombreEmpresa} (Bot: ${nombreBot}, Tel: ${empresa.telefono_telnyx})`);
      console.log(`[VAPI ASSISTANT CONFIG] Mensaje Inicial: "${mensajeInicial}"`);

      // Devolver a Vapi la configuración exacta del Asistente para esta llamada
      return new Response(JSON.stringify({
        assistant: {
          firstMessage: mensajeInicial,
          transcriber: {
            model: "stt-rt-v5",
            language: "es",
            provider: "soniox"
          },
          model: {
            provider: "groq",
            model: "llama-3.1-8b-instant",
            temperature: 0.2,
            messages: [
              {
                role: "system",
                content: systemPrompt
              }
            ],
            tools: [
              {
                type: "function",
                async: false,
                messages: [
                  {
                    type: "request-start",
                    content: "Excelente. Dame un segundito en lo que proceso esto, no me cuelgues."
                  }
                ],
                function: {
                  name: "book_taxi",
                  description: "Registra el viaje o pedido en el sistema cuando ya se tienen todos los datos del cliente.",
                  parameters: {
                    type: "object",
                    properties: {
                      origen: { type: "string" },
                      destino: { type: "string" },
                      telefono: { type: "string" }
                    },
                    required: ["origen", "destino", "telefono"]
                  }
                },
                server: {
                  url: `https://knghdwpxheenkpuajkxl.supabase.co/functions/v1/vapi-webhook?tenantId=${empresa.id}`
                }
              }
            ]
          },
          voice: {
            version: "2",
            voiceId: "Layla",
            provider: "vapi"
          }
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. Manejo de Tool Calls (book_taxi)
    // ─────────────────────────────────────────────────────────────────────────
    if (message.type === 'tool-calls') {
      const toolCallInfo = message.toolWithToolCallList?.[0];
      if (toolCallInfo && toolCallInfo.toolCall.function.name === 'book_taxi') {
        const args = toolCallInfo.toolCall.function.arguments;
        const callId = message.call?.id || 'unknown';
        const customerNumber = message.call?.customer?.number || args.telefono || 'Desconocido';

        console.log(`[VAPI TOOL] Ejecutando book_taxi para Origen: ${args.origen}, Destino: ${args.destino}`);

        // Recuperamos la empresa para saber en qué ciudad operar y a dónde mandar el WhatsApp
        const urlObj = new URL(req.url);
        const tenantId = urlObj.searchParams.get('tenantId');
        let empresa: EmpresaRow | null = null;
        let permisosSistema: Record<string, boolean> = {};

        if (tenantId) {
          const { data } = await supabase
            .from('empresas')
            .select('*, paquete:paquetes(permisos_sistema, incluye_bot)')
            .eq('id', tenantId)
            .maybeSingle();

          if (data) {
            empresa = data as Record<string, unknown>;
            
            // ── GATEKEEPING: Validación estricta del Plan ──
            const paqueteObj = Array.isArray(data.paquete) ? data.paquete[0] : data.paquete;
            if (paqueteObj && typeof paqueteObj === 'object') {
              const incluyeBot = (paqueteObj as Record<string, unknown>).incluye_bot === true;
              if (!incluyeBot) {
                console.warn(`[GATEKEEPING] Intento de uso de Vapi (Bot de Voz) en empresa sin plan autorizado. TenantID: ${tenantId}`);
                return new Response(JSON.stringify({
                  results: [{
                    toolCallId: toolCallInfo.toolCall.id,
                    result: "Tu plan actual no incluye el servicio de despacho automático por bot. Comunícate con soporte."
                  }]
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                  status: 200
                });
              }
              permisosSistema = (paqueteObj.permisos_sistema as Record<string, boolean>) ?? {};
            }
          }
        }

        // Cada empresa puede estar en una ciudad diferente, usamos la suya o Comitán de respaldo
        const ciudadTenant = (empresa?.ciudad as string) || 'Comitán de Domínguez, Chiapas';

        // 1. Geocodificar el origen con la ciudad correcta
        console.log(`[GEOLOCALIZACION] Buscando coordenadas para: ${args.origen}, ${ciudadTenant}`);
        const locOrigen = await resolveLocation(supabase, args.origen, ciudadTenant);

        // 2. Solo conectamos a Traccar si Google Maps nos dio coordenadas válidas
        // 2. Solo conectamos a Traccar si Google Maps nos dio coordenadas válidas
        let nearbyTaxis: { name: string; distanceKm: number; deviceId: number }[] | null = null;
        let nearestTaxi = null;

        if (locOrigen && locOrigen.lat !== null && locOrigen.lng !== null) {
          console.log(`[TRACCAR] Coordenadas encontradas (Lat: ${locOrigen.lat}, Lng: ${locOrigen.lng}). Conectando a Traccar para buscar unidades...`);
          try {
            nearbyTaxis = await getNearestTaxi(locOrigen.lat, locOrigen.lng, permisosSistema);
            if (nearbyTaxis && nearbyTaxis.length > 0) {
              nearestTaxi = nearbyTaxis[0];
              console.log(`[TRACCAR EXITO] Unidades cercanas encontradas. Asignando la más cercana: ${nearestTaxi.name} a ${Math.round(nearestTaxi.distanceKm * 1000)} metros.`);
            } else {
              console.log(`[TRACCAR FALLO] No se encontraron unidades cercanas con GPS activo.`);
            }
          } catch (traccarErr: unknown) {
            console.error(`[TRACCAR ERROR] Falló conexión a Traccar, continuando sin GPS:`, traccarErr instanceof Error ? traccarErr.message : String(traccarErr));
          }
        } else {
          console.log(`[GEOLOCALIZACION] No se pudieron resolver las coordenadas del origen.`);
        }

        // 3. Si encontramos un taxi, creamos el registro del viaje y generamos el link de seguimiento
        let trackingUrl: string | null = null;
        if (nearestTaxi) {
          const token = generarToken();
          trackingUrl = `${APP_URL}/track/${token}`;

          // Guardamos el viaje en Supabase para que la página de tracking lo encuentre
          await supabase.from('viajes').insert({
            token,
            tenant_id: tenantId || null,
            device_id: nearestTaxi.deviceId,
            taxi_name: nearestTaxi.name,
            cliente_tel: customerNumber,
            origen: args.origen,
            destino: args.destino,
            origen_lat: locOrigen?.lat ?? null,
            origen_lng: locOrigen?.lng ?? null,
            estado: 'en_camino',
          }).then(({ error }) => {
            if (error) console.error('[VIAJE] Error al guardar viaje:', error.message);
            else console.log(`[VIAJE] Viaje creado con token: ${token}`);
          });

          // Mandamos el link de tracking al cliente por WhatsApp usando plantilla aprobada de Meta
          if (customerNumber && customerNumber !== 'Desconocido') {
            const cleanCustomer = customerNumber.startsWith('+') ? customerNumber : `+${customerNumber}`;
            const fallbackBody = `🚕 ¡Tu taxi *${nearestTaxi.name}* ya va en camino!\n\nSigue tu unidad en tiempo real aquí:\n${trackingUrl}\n\n📍 *Origen:* ${args.origen}\n🏁 *Destino:* ${args.destino}`;

            sendWhatsAppTemplate({
              to: cleanCustomer,
              templateName: 'seguimiento_viaje',
              languageCode: 'es_MX',
              bodyParameters: [nearestTaxi.name, trackingUrl],
              fromOverride: empresa?.waba_number || undefined,
              fallbackText: fallbackBody,
            }).catch(err => console.error('[YCLOUD CLIENTE TEMPLATE ERROR]', err));
          }
        }

        // 4. Notificar al despachador humano — si la empresa tiene su propio número de WhatsApp, usamos ese
        dispatchToHuman({
          origen: args.origen,
          destino: args.destino,
          telefono: customerNumber,
          tarifa: locOrigen ? locOrigen.precio : null,
          nearestTaxiName: nearestTaxi ? nearestTaxi.name : undefined,
          nearestTaxiDist: nearestTaxi ? nearestTaxi.distanceKm : undefined,
          trackingUrl: trackingUrl || undefined,
          dispatcherPhoneOverride: empresa?.dispatcher_phone || undefined
        }).catch(err => console.error('[YCLOUD BACKGROUND ERROR]', err));

        // 5. Armar el mensaje exacto que leerá el bot al cliente en la llamada
        let resultMsg = "";
        if (nearbyTaxis && nearbyTaxis.length > 0) {
          // [MODO DE PRUEBA / DEMO]
          // Esta lógica se agregó temporalmente para la demostración con los taxis de Wialon.
          // La IA mencionará dinámicamente varios taxis cercanos para dar la impresión
          // de que está escaneando la zona en tiempo real.
          
          // Asumimos velocidad urbana de 30 km/h -> 2 mins por km
          const getMins = (km: number) => Math.max(1, Math.round(km * 2));
          
          if (nearbyTaxis.length === 1) {
             const mins = getMins(nearbyTaxis[0].distanceKm);
             resultMsg = `¡Listo! Tu viaje quedó registrado. La unidad ${nearbyTaxis[0].name} es la más cercana y llegará en aproximadamente ${mins} minutos. Ya va en camino. Te acabo de mandar un mensaje de WhatsApp para que puedas seguir su ruta en tiempo real. ¡Que tengas buen viaje!`;
          } else {
             const mins1 = getMins(nearbyTaxis[0].distanceKm);
             const mins2 = getMins(nearbyTaxis[1].distanceKm);
             resultMsg = `¡Listo! Tu viaje quedó registrado. Encontré a la unidad ${nearbyTaxis[1].name} a ${mins2} minutos, pero te he asignado la unidad ${nearbyTaxis[0].name} que está aún más cerca, a solo ${mins1} minutos. Ya va en camino. Te acabo de mandar un WhatsApp con el enlace para seguirlo en el mapa. ¡Que te vaya muy bien!`;
          }
        } else {
          resultMsg = `¡Listo! Tu viaje quedó registrado. En unos momentos te mandamos la unidad. ¡Que te vaya muy bien!`;
        }

        return new Response(JSON.stringify({
          results: [
            {
              toolCallId: toolCallInfo.toolCall.id,
              result: resultMsg
            }
          ]
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        });
      }

      // Si Vapi manda una herramienta que no reconocemos, respondemos vacío para que no se quede esperando
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Reporte de Fin de Llamada
    // ─────────────────────────────────────────────────────────────────────────
    if (message.type === 'end-of-call-report') {
      const call = message.call;
      const callId = call.id;
      const transcript = message.transcript || call.transcript || '';

      console.log(`[VAPI END CALL] Guardando reporte para ${callId}`);

      const urlObj = new URL(req.url);
      const tenantId = urlObj.searchParams.get('tenantId') || '13a48e7b-c3bd-4ff2-bc17-ec30fb2a1884';

      // Insertar en la BD para historial
      await supabase.from('telnyx_active_calls').insert({
        call_control_id: callId,
        history: transcript,
        tenant_id: tenantId,
        origen_actual: 'N/A',
        destino_actual: 'N/A',
        estado: 'completed',
      });

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      });
    }

    // Retorno por defecto
    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[VAPI WEBHOOK ERROR]", errMsg);
    return new Response(JSON.stringify({ error: errMsg }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
