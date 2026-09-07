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
        objetivoPrompt = 'OBJETIVO PRINCIPAL: Recolectar NOMBRE DEL CLIENTE, ORIGEN y DESTINO. (El teléfono ya lo tienes).';
      } else {
        objetivoPrompt = 'OBJETIVO PRINCIPAL: Recolectar NOMBRE DEL CLIENTE, PEDIDO EXACTO y DIRECCIÓN DE ENTREGA. (El teléfono ya lo tienes).';
      }
      mensajeInicial = `¡Hola! te estas comunicando a  ${nombreEmpresa}, soy ${nombreBot}, ¿en qué te puedo ayudar?`;

      const systemPrompt = `Eres el despachador de radio de "${nombreEmpresa}", tu nombre es ${nombreBot}.
Tu trabajo es atender la llamada de manera súper natural y humana, como un despachador real de radio-taxi en México.

1. TONO: Cálido, ágil y coloquial mexicano. Usa frases como "Claro que sí", "Con mucho gusto", "Enterado", "Perfecto".
2. BREVEDAD: Máximo 15 palabras por turno. Sin rodeos.
3. FLUJO NATURAL: Ya te presentaste, así que cuando el cliente diga para qué llama, ve directo a recopilar los datos uno por uno.
4. ${objetivoPrompt} 
5. ANTES de confirmar cualquier viaje o pedido, DEBES preguntarle su nombre si aún no lo ha dicho (Ej: "¿A nombre de quién mando el taxi?").
6. INFO EXTRA: ${infoEmpresa}

PROCESO DE RESERVA:
Cuando tengas NOMBRE, ORIGEN, DESTINO y TELÉFONO, EJECUTA INMEDIATAMENTE la función (herramienta) \`book_taxi\`.
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
                      nombre: { type: "string" },
                      origen: { type: "string" },
                      destino: { type: "string" },
                      telefono: { type: "string" }
                    },
                    required: ["nombre", "origen", "destino", "telefono"]
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
          let assignedTaxi = null;
          let aiResponse = "";
          let trackingUrlForCTA = "";

          if (nearbyTaxis && nearbyTaxis.length > 0) {
            // 1. Crear el viaje en estado buscando_conductor
            const token = generarToken();
            const { data: newViaje, error: insertErr } = await supabase.from('viajes').insert({
              token, tenant_id: empresa.id,
              cliente_tel: customerNumber, cliente_nombre: args.nombre, 
              origen: args.origen, destino: args.destino,
              origen_lat: locOrigen?.lat, origen_lng: locOrigen?.lng,
              estado: 'buscando_conductor'
            }).select().single();

            if (!insertErr && newViaje) {
              trackingUrlForCTA = `${APP_URL}/track/${token}`;
              
              // 2. Cascada robusta: Iterar sobre los 3 taxis más cercanos
              const topTaxis = nearbyTaxis.slice(0, 3);
              for (const taxi of topTaxis) {
                try {
                  // Obtener teléfono del conductor
                  const { data: conductor, error: condErr } = await supabase.from('conductores').select('telefono_whatsapp').eq('device_id', taxi.deviceId).maybeSingle();
                  if (condErr || !conductor) continue;

                  // Agregar a contactados (RPC Atómico robusto)
                  const { error: rpcErr } = await supabase.rpc('array_append_viaje_conductores', { v_id: newViaje.id, d_id: taxi.deviceId });
                  if (rpcErr) console.warn('[VAPI] Error en RPC array_append:', rpcErr);

                  // Enviar oferta por WA al chofer (Manejo de fallos de red)
                  const wabaNumber = empresa.waba_number || '';
                  try {
                    await sendWhatsApp(conductor.telefono_whatsapp, `🚨 *NUEVO VIAJE (A ${taxi.distanceKm.toFixed(1)} km)* 🚨\n\nRecoger a: ${args.nombre || 'Cliente'}\nOrigen: ${args.origen}\nDestino: ${args.destino}\n\nResponde *1* rápido para aceptar.`, wabaNumber);
                  } catch (waErr) {
                    console.error('[VAPI] Error enviando WhatsApp al chofer, saltando...', waErr);
                    continue;
                  }

                  // Polling Seguro (esperar 5 segundos max por chofer = 15s total max)
                  let accepted = false;
                  for (let i = 0; i < 5; i++) {
                    await new Promise(res => setTimeout(res, 1000)); // Esperar 1 segundo
                    try {
                      const { data: checkViaje } = await supabase.from('viajes').select('estado, taxi_name').eq('id', newViaje.id).single();
                      if (checkViaje && checkViaje.estado === 'en_camino') {
                        accepted = true;
                        assignedTaxi = { name: checkViaje.taxi_name };
                        break;
                      }
                    } catch (dbErr) {
                      console.warn('[VAPI] Error de red en polling, reintentando...', dbErr);
                    }
                  }

                  if (accepted) break; // Si aceptó, salimos del ciclo principal
                } catch (generalErr) {
                  console.error('[VAPI] Excepcion no controlada en cascada:', generalErr);
                }
              }
            }
          }

          if (assignedTaxi) {
            aiResponse = `¡Listo! El taxista ${assignedTaxi.name} ya confirmó y va para allá. Te mandé un mensaje de texto con el link del mapa. ¡Gracias por llamar!`;
          } else {
            aiResponse = `Nuestros conductores están tardando un poquito en responder. Pero no te preocupes, en cuanto uno confirme te mandaremos el link por mensaje. ¡Muchas gracias por llamar!`;
          }

          // Notificar al cliente si tenemos número
          if (customerNumber && customerNumber !== 'Desconocido' && trackingUrlForCTA) {
            const cleanCustomer = customerNumber.startsWith('+') ? customerNumber : `+${customerNumber}`;
            const tName = assignedTaxi ? assignedTaxi.name : 'Unidad por confirmar';
            const fallbackBody = assignedTaxi 
              ? `🚕 ¡Tu taxi *${tName}* ya va en camino!\n\nSigue tu unidad en tiempo real aquí:\n${trackingUrlForCTA}\n\n📍 *Origen:* ${args.origen}\n🏁 *Destino:* ${args.destino}`
              : `🚕 Estamos asignando tu unidad...\n\nSigue tu viaje en tiempo real aquí para ver qué taxi toma tu servicio:\n${trackingUrlForCTA}\n\n📍 *Origen:* ${args.origen}\n🏁 *Destino:* ${args.destino}`;
            
            sendWhatsAppTemplate({
              to: cleanCustomer,
              templateName: 'seguimiento_viaje',
              languageCode: 'es_MX',
              bodyParameters: [tName, trackingUrlForCTA],
              fromOverride: empresa?.waba_number || undefined,
              fallbackText: fallbackBody,
            }).catch(err => console.error('[YCLOUD CLIENTE TEMPLATE ERROR]', err));
          }

        // 4. Notificar al despachador humano
        const dispatchTaxiName = assignedTaxi ? assignedTaxi.name : 'Por confirmar';
        const dispatchTaxiDist = assignedTaxi ? assignedTaxi.distanceKm : (nearbyTaxis && nearbyTaxis.length > 0 ? nearbyTaxis[0].distanceKm : undefined);
        dispatchToHuman({
          origen: args.origen,
          destino: args.destino,
          telefono: customerNumber,
          tarifa: locOrigen ? locOrigen.precio : null,
          nearestTaxiName: dispatchTaxiName,
          nearestTaxiDist: dispatchTaxiDist,
          trackingUrl: trackingUrlForCTA || undefined,
          dispatcherPhoneOverride: empresa?.dispatcher_phone || undefined
        }).catch(err => console.error('[YCLOUD BACKGROUND ERROR]', err));

        // 5. Retornar a VAPI
        return new Response(JSON.stringify({
          results: [
            {
              toolCallId: toolCallInfo.toolCall.id,
              result: aiResponse
            }
          ]
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        });
      } // Fin de book_taxi

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
