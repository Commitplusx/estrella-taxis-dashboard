// supabase/functions/asignar-repartidor/index.ts
// ══════════════════════════════════════════════════════════════
//  Motor de Asignación Inteligente v2.0
//  Score Multi-Factor (menor = mejor):
//    40% → Proximidad al restaurante (PostGIS + Google Maps)
//    25% → Carga de trabajo (pedidos activos, hard cap en 3)
//    25% → Tasa de aceptación (premia a quien siempre acepta)
//    10% → Tiempo sin pedido (fairness / turno de trabajo)
// ══════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { initializeApp, cert } from "npm:firebase-admin@11.11.1/app";
import { getMessaging } from "npm:firebase-admin@11.11.1/messaging";

let isFirebaseInitialized = false;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const WA_TOKEN    = Deno.env.get('WHATSAPP_TOKEN')!
const WA_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const ADMIN_PHONES_RAW = Deno.env.get('ADMIN_PHONES') ?? Deno.env.get('ADMIN_PHONE') ?? ''
const ADMIN_PHONE_MAIN = (() => {
  const raw = ADMIN_PHONES_RAW.split(',').map(s => s.replace(/\D/g, '').slice(-10)).filter(s => s.length === 10)[0]
  return raw ? `52${raw}` : ''
})()

const WA_BASE = `https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`
const WA_HEADERS = () => ({
  Authorization: `Bearer ${WA_TOKEN}`,
  'Content-Type': 'application/json',
})

async function sendWA(to: string, body: string): Promise<void> {
  await fetch(WA_BASE, {
    method: 'POST',
    headers: WA_HEADERS(),
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: body.substring(0, 4096) }
    })
  })
}

async function initFirebase() {
  if (isFirebaseInitialized) return true;
  const serviceAccountStr = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  if (!serviceAccountStr) {
    console.warn(`[FCM] ⚠️ No se encontró FIREBASE_SERVICE_ACCOUNT.`);
    return false;
  }
  initializeApp({ credential: cert(JSON.parse(serviceAccountStr)) });
  isFirebaseInitialized = true;
  return true;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  try {
    const rawPayload = await req.json();
    console.log("[ASIGNAR v2.0] Payload recibido:", JSON.stringify(rawPayload));

    // Soporta tanto webhook (record.id) como llamada directa (id)
    const payload = rawPayload.record || rawPayload;
    const pedido_uuid = payload.id;
    const excluir_id = payload.excluir; // ID del repartidor que rechazó

    if (!pedido_uuid) {
      return new Response(JSON.stringify({ error: 'id requerido' }), { status: 400, headers: CORS_HEADERS })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

    // ── 1. LEER PEDIDO DE LA BD ─────────────────────────────────────
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(pedido_uuid);
    const searchColumn = isUuid ? 'id' : 'wb_message_id';

    const { data: dbPedido, error: dbError } = await supabase
      .from('pedidos')
      .select('id, wb_message_id, restaurante, direccion, total, lat, lng, lat_entrega, lng_entrega, metodo_pago, estado, tipo_pedido, repartidor_id, ofertas_rechazadas')
      .eq(searchColumn, pedido_uuid)
      .single();

    if (dbError || !dbPedido) {
      console.error(`[ASIGNAR v2.0] Pedido no encontrado (${searchColumn}=${pedido_uuid}):`, dbError);
      return new Response(JSON.stringify({ error: 'Pedido no existe en BD' }), { status: 404, headers: CORS_HEADERS })
    }

    // Tipos de pedido que requieren repartidor para entrega a domicilio.
    // 'tienda' y 'recoger' son retiro en mostrador — el cliente va por su pedido.
    const TIPOS_CON_REPARTIDOR = ['domicilio', 'mandadito', 'restaurante_delivery']
    if (!TIPOS_CON_REPARTIDOR.includes(dbPedido.tipo_pedido)) {
      console.log(`[ASIGNAR v2.0] tipo_pedido='${dbPedido.tipo_pedido}' no requiere repartidor. Abortando.`);
      return new Response(JSON.stringify({ ok: true, message: `tipo_pedido '${dbPedido.tipo_pedido}' no requiere repartidor` }), { headers: CORS_HEADERS })
    }

    // ── 2. GUARDIANES DE IDEMPOTENCIA ────────────────────────────────
    // Evitan procesar el mismo evento dos veces (webhook duplicado, etc.)
    if (dbPedido.estado !== 'buscando_repartidor') {
      console.log(`[ASIGNAR v2.0] Estado '${dbPedido.estado}' no es buscando_repartidor. Ignorando.`);
      return new Response(JSON.stringify({ ok: true, message: 'Estado ignorable' }), { headers: CORS_HEADERS })
    }
    if (dbPedido.repartidor_id) {
      console.log("[ASIGNAR v2.0] Pedido ya tiene repartidor. Ignorando.");
      return new Response(JSON.stringify({ ok: true, message: 'Ya asignado' }), { headers: CORS_HEADERS })
    }

    const ticket_id  = dbPedido.wb_message_id || dbPedido.id;
    const restaurante = dbPedido.restaurante || "Estrella";
    const direccion   = dbPedido.direccion || "";
    const total       = dbPedido.total || "0";
    const lat         = dbPedido.lat;
    const lng         = dbPedido.lng;

    // ── 3. BUSCAR CANDIDATOS VÍA RPC INTELIGENTE ─────────────────────
    // El nuevo RPC ya incorpora: pedidos_activos, tasa_aceptacion, minutos_sin_pedido
    // y aplica el hard cap de 3 pedidos activos.
    let repartidoresValidos: any[] = [];
    let driversLockedCount = 0;

    if (lat && lng) {
      const { data: rpcData, error: rpcErr } = await supabase.rpc('buscar_repartidores_cercanos', {
        p_lat: lat,
        p_lng: lng,
        p_radio_metros: 5000,
        p_cliente_lat: dbPedido.lat_entrega,
        p_cliente_lng: dbPedido.lng_entrega
      });

      if (rpcErr) {
        console.error('[RPC ERROR]', rpcErr);
        throw new Error(`Error en RPC PostGIS: ${rpcErr.message}`);
      }

      repartidoresValidos = (rpcData || []).map((r: any) => ({
        ...r,
        repartidor_id: r.user_id || r.repartidor_id
      }));

      console.log(`[ASIGNAR v2.0] Candidatos del RPC (score multi-factor):`,
        repartidoresValidos.map(r =>
          `${r.nombre || r.repartidor_id}: score=${Math.round(r.score)} | activos=${r.pedidos_activos} | aceptacion=${r.tasa_aceptacion} | idle=${Math.round(r.minutos_sin_pedido)}min`
        )
      );

      // ── 3a. EXCLUIR RECHAZADORES PREVIOS ─────────────────────
      const currentRechazos = Array.isArray(dbPedido.ofertas_rechazadas) 
                              ? dbPedido.ofertas_rechazadas 
                              : [];
      if (excluir_id && !currentRechazos.includes(excluir_id)) {
        currentRechazos.push(excluir_id);
      }
      if (currentRechazos.length > 0) {
        repartidoresValidos = repartidoresValidos.filter((r: any) => !currentRechazos.includes(r.repartidor_id));
        console.log(`[ZERO-WAIT] Excluyendo ${currentRechazos.length} repartidores que ya rechazaron.`);
      }

      // ── 3b. CANDADO: Excluir a quien ya tiene un pedido 'ofrecido' sonando ──
      if (repartidoresValidos.length > 0) {
        const repIds = repartidoresValidos.map((r: any) => r.repartidor_id);
        const { data: ofrecidos } = await supabase
          .from('pedidos')
          .select('repartidor_id')
          .in('repartidor_id', repIds)
          .eq('estado', 'ofrecido');

        if (ofrecidos && ofrecidos.length > 0) {
          const lockedIds = new Set(ofrecidos.map((p: any) => p.repartidor_id));
          driversLockedCount += lockedIds.size;
          repartidoresValidos = repartidoresValidos.filter((r: any) => !lockedIds.has(r.repartidor_id));
          console.log(`[LOCK] Excluidos ${lockedIds.size} repartidores con oferta activa en pantalla.`);
        }
      }

      // ── 3c. REFINAMIENTO CON GOOGLE MAPS (Top 5 candidatos) ───────
      // Solo refinamos el ETA de los mejores 5 para no gastar la cuota de la API
      const googleMapsKey = Deno.env.get('GOOGLE_MAPS_KEY');
      if (googleMapsKey && repartidoresValidos.length > 0) {
        try {
          const top5 = repartidoresValidos.slice(0, 5);
          const repIds = top5.map((r: any) => r.repartidor_id);
          const { data: repCoords } = await supabase
            .from('repartidores')
            .select('id, user_id, lat, lng')
            .in('user_id', repIds);

          if (repCoords && repCoords.length > 0) {
            const validCoords = repCoords.filter((r: any) => r.lat && r.lng);
            if (validCoords.length > 0) {
              const destinations = validCoords.map((r: any) => `${r.lat},${r.lng}`).join('|');
              const gmapUrl = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${lat},${lng}&destinations=${destinations}&key=${googleMapsKey}`;
              const gmapRes = await fetch(gmapUrl);
              const gmapData = await gmapRes.json();

              if (gmapData.status === 'OK') {
                const elements = gmapData.rows[0].elements;
                validCoords.forEach((coord: any, idx: number) => {
                  if (elements[idx]?.status === 'OK') {
                    const etaMinutos = elements[idx].duration.value / 60;
                    const driverId = coord.user_id || coord.id;
                    const rep = repartidoresValidos.find((r: any) => r.repartidor_id === driverId);
                    if (rep) {
                      rep.eta_minutos = Math.round(etaMinutos);
                      // Re-calcular score reemplazando la distancia lineal con el ETA real de Google
                      // Mantenemos los factores de carga, aceptación y fairness del RPC
                      const tasa = rep.tasa_aceptacion || 0.8;
                      const idle = rep.minutos_sin_pedido || 0;
                      const activos = rep.pedidos_activos || 0;
                      rep.score = (etaMinutos * 60 * 0.40)       // ETA como distancia equivalente
                                + (activos * 2500)                 // carga de trabajo
                                - (tasa * 3000)                    // tasa de aceptación
                                - (Math.min(idle, 120) * 5.0)      // fairness
                                - ((rep.bateria || 0) * 8.0);      // batería
                    }
                  }
                });
                // Re-ordenar con ETA real de Google Maps
                repartidoresValidos.sort((a: any, b: any) => (a.score || 0) - (b.score || 0));
                console.log('[GOOGLE MAPS] Re-ordenados con ETA real:',
                  repartidoresValidos.map((r: any) => `${r.nombre}: ${r.eta_minutos}min, score=${Math.round(r.score)}`)
                );
              }
            }
          }
        } catch (err) {
          console.error('[GOOGLE MAPS ERROR]', err);
          // Fallback: usar el score del RPC (distancia Haversine)
        }
      }

    } else {
      // ── Fallback sin coordenadas: cualquier repartidor activo ─────
      console.warn('[ASIGNAR v2.0] Pedido sin lat/lng. Usando fallback sin geolocalización.');
      const { data: todos } = await supabase
        .from('repartidores')
        .select('id, user_id, nombre, lat, lng, bateria, meta_envios, total_ofertas, total_aceptaciones')
        .eq('activo', true);

      repartidoresValidos = (todos || [])
        .filter((r: any) => (r.bateria === null || r.bateria >= 15))
        .filter((r: any) => r.repartidor_id !== excluir_id)
        .map((r: any) => ({ ...r, repartidor_id: r.user_id || r.id }));
    }

    // ── 4. ¿HAY CANDIDATOS? ──────────────────────────────────────────
    if (!repartidoresValidos || repartidoresValidos.length === 0) {
      if (driversLockedCount > 0) {
        // Hay repartidores pero están decidiendo otro pedido → reintentar en 10s
        console.log(`[RETRY] ${driversLockedCount} repartidor(es) bloqueados. Reintentando en 10s.`);
        const QSTASH_TOKEN = Deno.env.get('QSTASH_TOKEN');
        if (QSTASH_TOKEN) {
          await fetch(`https://qstash-us-east-1.upstash.io/v2/publish/${SUPABASE_URL}/functions/v1/asignar-repartidor`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${QSTASH_TOKEN}`,
              'Content-Type': 'application/json',
              'Upstash-Delay': '10s'
            },
            body: JSON.stringify(payload)
          }).catch(e => console.error("Error QStash Retry", e));
        }
        return new Response(JSON.stringify({ ok: true, reason: 'retrying_due_to_locks' }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      // No hay nadie disponible → alertar al admin
      console.warn(`[ASIGNAR v2.0] Sin repartidores disponibles para pedido ${ticket_id}`);
      if (ADMIN_PHONE_MAIN) {
        await sendWA(ADMIN_PHONE_MAIN,
          `⚠️ *Pedido #${ticket_id} sin repartidor*\n\nNo hay repartidores activos cerca o todos están al tope de carga.\n📦 ${restaurante}\n📍 ${direccion}\n\nAsigna manualmente.`
        );
      }
      return new Response(JSON.stringify({ ok: false, reason: 'no_drivers' }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    // ── 5. ASIGNACIÓN ATÓMICA AL MEJOR CANDIDATO ─────────────────────
    // El #1 ya es el ganador del score multi-factor. Intentamos asignárselo
    // atómicamente en la BD para prevenir race conditions.
    const mejorCandidato = repartidoresValidos[0];
    const segundoCandidato = repartidoresValidos[1] ?? null;
    const mejorId = mejorCandidato.repartidor_id;

    const { data: atomicSuccess, error: atomicErr } = await supabase.rpc('asignar_pedido_atomico', {
      p_pedido_id: dbPedido.id,
      p_repartidor_id: mejorId
    });

    if (atomicErr) {
      console.error('[ATOMIC ERROR]', atomicErr);
      return new Response(JSON.stringify({ ok: false, reason: 'atomic_err', error: atomicErr }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    if (!atomicSuccess) {
      // El pedido ya no está disponible (otro proceso lo tomó en el mismo milisegundo)
      console.log('[ATOMIC] El pedido ya no está disponible. Otro proceso lo tomó.');
      return new Response(JSON.stringify({ ok: true, reason: 'already_taken' }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    // ── 6. ACTUALIZAR MÉTRICAS DEL REPARTIDOR ────────────────────────
    // Incrementar total_ofertas (para calcular tasa de aceptación futura)
    supabase
      .from('repartidores')
      .update({ total_ofertas: (mejorCandidato.total_ofertas || 0) + 1 })
      .eq('user_id', mejorId)
      .then(({ error }) => {
        if (error) console.error('[METRICS] Error incrementando total_ofertas:', error);
        else console.log(`[METRICS] total_ofertas++ para repartidor ${mejorId}`);
      });

    // ── 7. GENERAR PIN DE RECOLECCIÓN ────────────────────────────────
    const pickupPin = Math.floor(1000 + Math.random() * 9000).toString();
    supabase
      .from('pedidos')
      .update({ pickup_pin: pickupPin })
      .eq('id', dbPedido.id)
      .then(({ error }) => {
        if (error) console.error('[PIN ERROR]', error);
        else console.log(`[PIN] ${pickupPin} generado para pedido ${dbPedido.id}`);
      });

    // ── 8. NOTIFICAR AL REPARTIDOR ───────────────────────────────────
    // Canal 1: Realtime Broadcast (app en primer plano)
    await new Promise((resolve) => {
      const pingChannel = supabase.channel('repartidores_ping');
      pingChannel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await pingChannel.send({
            type: 'broadcast',
            event: 'order_offered',
            payload: {
              target_driver_id: mejorId,
              pedido_id: String(dbPedido.id),
              restaurante,
              direccion,
              total,
              viaje_apilado: mejorCandidato.viaje_apilado || false,
              eta_minutos: mejorCandidato.eta_minutos || null
            }
          });
          supabase.removeChannel(pingChannel);
          resolve(true);
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          resolve(false);
        }
      });
      // Fallback timeout in case subscribe hangs
      setTimeout(() => resolve(false), 2000);
    });

    // Canal 2: FCM Data Push (app en background/cerrada)
    try {
      const fbOk = await initFirebase();
      if (fbOk) {
        await getMessaging().send({
          topic: `driver_${mejorId}`,
          android: { priority: "high", ttl: 0 },
          data: {
            tipo: "pedido_asignado",
            pedido_id: String(dbPedido.id),
            restaurante: String(restaurante),
            click_action: "FLUTTER_NOTIFICATION_CLICK",
            target_driver_id: String(mejorId),
            viaje_apilado: String(mejorCandidato.viaje_apilado || false)
          }
        });
        console.log(`[FCM] ✅ Push enviado a driver_${mejorId}`);
      }
    } catch (fcmErr) {
      console.error("[FCM] ❌ Error:", fcmErr);
    }

    console.log(`[ASIGNAR v2.0] ✅ Pedido ${ticket_id} ofrecido a ${mejorCandidato.nombre || mejorId} | score=${Math.round(mejorCandidato.score)} | activos=${mejorCandidato.pedidos_activos} | aceptacion=${mejorCandidato.tasa_aceptacion}`);

    // ── 9. PROGRAMAR TIMEOUT CON QSTASH ─────────────────────────────
    // Si el repartidor no acepta en 15s, asignacion-timeout se encarga de rotar al siguiente
    const QSTASH_TOKEN = Deno.env.get('QSTASH_TOKEN');
    if (QSTASH_TOKEN) {
      const timeoutPayload = {
        ticket_id,
        pedido_uuid: dbPedido.id,
        restaurante,
        direccion,
        total,
        repartidor_actual_id: mejorId,
        repartidor_actual_nombre: mejorCandidato.nombre,
        siguiente_repartidor_id: segundoCandidato ? (segundoCandidato.repartidor_id) : null,
        siguiente_repartidor_nombre: segundoCandidato?.nombre ?? null,
        intento: payload.intento || 1
      };

      fetch(`https://qstash-us-east-1.upstash.io/v2/publish/${SUPABASE_URL}/functions/v1/asignacion-timeout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${QSTASH_TOKEN}`,
          'Content-Type': 'application/json',
          'Upstash-Delay': '25s'
        },
        body: JSON.stringify(timeoutPayload)
      }).then(async (r) => {
        if (!r.ok) console.error('[QSTASH ERROR]', await r.text());
        else console.log(`[QSTASH] Timeout de 25s programado para ${ticket_id}`);
      }).catch(e => console.error('[QSTASH FETCH ERROR]', e));
    } else {
      console.warn('[QSTASH] Token no configurado. El pedido flotará si no lo aceptan.');
    }

    return new Response(
      JSON.stringify({
        ok: true,
        assigned_to: mejorId,
        score: Math.round(mejorCandidato.score),
        pedidos_activos: mejorCandidato.pedidos_activos,
        tasa_aceptacion: mejorCandidato.tasa_aceptacion,
        eta_minutos: mejorCandidato.eta_minutos ?? null,
        fallback_driver: segundoCandidato ? (segundoCandidato.repartidor_id) : null
      }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error('[ASIGNAR v2.0] Error crítico:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    })
  }
})
