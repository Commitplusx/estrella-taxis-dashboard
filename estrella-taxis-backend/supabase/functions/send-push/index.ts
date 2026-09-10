// supabase/functions/send-push/index.ts
// Edge Function Deno — Envía notificaciones Web Push a todos los dispositivos
// suscritos de un tenant cuando llega un nuevo pedido.
//
// Variables de entorno requeridas en Supabase:
//   VAPID_SUBJECT   = "mailto:admin@estrella-eats.mx"
//   VAPID_PUBLIC_KEY  = "BLzd3BnXb_oxpo92aEa9ocuzVo9LX1Faj7eS1shbZA5H40-uNxRn7KEy8b8ihMWWRxKkFiAV8v-IBK6gQTjRxOA"
//   VAPID_PRIVATE_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgvFzIPV02_TxHTPK7iaquE76axVRwRT6IASY4MWek9-mhRANCAAS83dwZ12_6MaaPdmhGvaHLs1aPS19RWo-3ktbIW2QOR-NPrjcUZ-yhMvG_IoTFlkcSpBYgFfL_iASuoEE40cTg"
//   SUPABASE_URL    = (auto-set by Supabase)
//   SUPABASE_SERVICE_ROLE_KEY = (set in Supabase secrets)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ──────────────────────────────────────────────────────────────────────────────
// VAPID helpers (implementación manual sin dependencias externas)
// ──────────────────────────────────────────────────────────────────────────────

function base64UrlDecode(str: string): Uint8Array {
  const padding = "=".repeat((4 - (str.length % 4)) % 4);
  const b64 = (str + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return new Uint8Array([...raw].map((c) => c.charCodeAt(0)));
}

function base64UrlEncode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function buildVapidJwt(
  audience: string,
  subject: string,
  privateKeyB64: string
): Promise<string> {
  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: audience, exp: now + 12 * 3600, sub: subject };

  const encHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const encPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${encHeader}.${encPayload}`;

  const privateKeyDer = base64UrlDecode(privateKeyB64);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyDer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Envío Web Push individual
// ──────────────────────────────────────────────────────────────────────────────

async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: string,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  vapidSubject: string
): Promise<{ ok: boolean; status: number; endpoint: string }> {
  const url = new URL(subscription.endpoint);
  const audience = `${url.protocol}//${url.host}`;

  const jwt = await buildVapidJwt(audience, vapidSubject, vapidPrivateKey);
  const authHeader = `vapid t=${jwt},k=${vapidPublicKey}`;

  // ── Cifrado del payload con ECDH + AES-GCM (Web Push Encryption RFC 8291) ──
  // Generamos un par de claves efímero
  const ephemeralKey = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );

  const ephemeralPublicKeyRaw = await crypto.subtle.exportKey(
    "raw",
    ephemeralKey.publicKey
  );

  // Importar clave pública del cliente (p256dh)
  const clientPublicKey = await crypto.subtle.importKey(
    "raw",
    base64UrlDecode(subscription.p256dh),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // Derivar secret compartido
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientPublicKey },
    ephemeralKey.privateKey,
    256
  );

  // Auth secret del cliente
  const authSecret = base64UrlDecode(subscription.auth);
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // HKDF para obtener content encryption key y nonce (simplificado)
  const enc = new TextEncoder();

  const prk = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: authSecret, info: enc.encode("") },
      await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveBits"]),
      256
    ),
    "HKDF",
    false,
    ["deriveBits"]
  ).catch(() => null);

  if (!prk) {
    // Fallback: enviar sin cifrado (el navegador lo acepta en modo cleartext para desarrollo)
    const res = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/octet-stream",
        TTL: "86400",
      },
      body: new TextEncoder().encode(payload),
    });
    return { ok: res.ok, status: res.status, endpoint: subscription.endpoint };
  }

  // Construir contexto de info para CEK y nonce
  const clientPublicKeyRaw = base64UrlDecode(subscription.p256dh);

  function buildInfo(type: string, extra: Uint8Array): Uint8Array {
    const label = enc.encode(`Content-Encoding: ${type}\0P-256\0`);
    const clientLenBuf = new Uint8Array(2);
    new DataView(clientLenBuf.buffer).setUint16(0, clientPublicKeyRaw.length);
    const serverLenBuf = new Uint8Array(2);
    new DataView(serverLenBuf.buffer).setUint16(0, ephemeralPublicKeyRaw.byteLength);

    const combined = new Uint8Array(
      label.length + 2 + clientPublicKeyRaw.length + 2 + ephemeralPublicKeyRaw.byteLength + extra.length
    );
    let offset = 0;
    combined.set(label, offset); offset += label.length;
    combined.set(clientLenBuf, offset); offset += 2;
    combined.set(clientPublicKeyRaw, offset); offset += clientPublicKeyRaw.length;
    combined.set(serverLenBuf, offset); offset += 2;
    combined.set(new Uint8Array(ephemeralPublicKeyRaw), offset); offset += ephemeralPublicKeyRaw.byteLength;
    combined.set(extra, offset);
    return combined;
  }

  const cekInfo = buildInfo("aesgcm", new Uint8Array());
  const nonceInfo = buildInfo("nonce", new Uint8Array());

  const cekRaw = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: cekInfo }, prk, 128);
  const nonceRaw = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: nonceInfo }, prk, 96);

  const cek = await crypto.subtle.importKey("raw", cekRaw, "AES-GCM", false, ["encrypt"]);
  const payloadBuf = new TextEncoder().encode(payload);

  // Agregar padding de 0 bytes
  const padded = new Uint8Array(2 + payloadBuf.length);
  padded.set(payloadBuf, 2);

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonceRaw },
    cek,
    padded
  );

  // Headers según RFC 8291 / draft-ietf-httpbis-encryption-encoding-09
  const headers: Record<string, string> = {
    Authorization: authHeader,
    "Content-Type": "application/octet-stream",
    "Content-Encoding": "aesgcm",
    Encryption: `salt=${base64UrlEncode(salt)}`,
    "Crypto-Key": `dh=${base64UrlEncode(ephemeralPublicKeyRaw)};${authHeader.replace("vapid ", "")}`,
    TTL: "86400",
  };

  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers,
    body: encrypted,
  });

  return { ok: res.ok, status: res.status, endpoint: subscription.endpoint };
}

// ──────────────────────────────────────────────────────────────────────────────
// Handler principal
// ──────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  try {
    const body = await req.json();
    console.log("[send-push] Request recibida. Body parsing exitoso:", JSON.stringify(body).slice(0, 200) + '...');
    
    const { tenant_id, pedido } = body;

    if (!tenant_id || !pedido) {
      console.warn("[send-push] Bad request: tenant_id o pedido faltantes.", body);
      return new Response("Bad request", { status: 400 });
    }

    console.log(`[send-push] Procesando notificación para tenant_id: ${tenant_id} (Pedido ID: ${pedido.id || 'desconocido'})`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY")!;
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY")!;
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@estrella-eats.mx";

    const db = createClient(supabaseUrl, supabaseServiceKey);

    // Obtener todas las suscripciones del tenant
    const { data: subs, error: subsError } = await db
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("tenant_id", tenant_id);

    if (subsError) {
      console.error("[send-push] Error al consultar supabase (push_subscriptions):", subsError);
      throw subsError;
    }

    if (!subs || subs.length === 0) {
      console.log(`[send-push] No hay suscripciones activas para notificar al tenant ${tenant_id}. Terminando.`);
      return new Response(JSON.stringify({ sent: 0, total: 0 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    console.log(`[send-push] Encontradas ${subs.length} suscripciones para enviar push.`);

    // Construir payload de notificación
    const cliente = pedido?.cliente_nombre || "Cliente";
    const detalle = (pedido?.detalle_pedido || "").slice(0, 80);
    const direccion = (pedido?.direccion_entrega || "").toLowerCase();
    const esRecoger = direccion.includes("recoger");

    const notificationPayload = JSON.stringify({
      title: `Nuevo Pedido — ${esRecoger ? "🏬 Recoger" : "🛵 Domicilio"}`,
      body: `${cliente}: ${detalle}${detalle.length >= 80 ? "..." : ""}`,
      url: "/orders",
      tag: `pedido-${pedido?.id || Date.now()}`,
      pedidoId: pedido?.id || null,
    });

    // Enviar a todas las suscripciones en paralelo
    const results = await Promise.allSettled(
      subs.map((sub) =>
        sendWebPush(sub, notificationPayload, vapidPublic, vapidPrivate, vapidSubject)
      )
    );

    // Limpiar suscripciones caducadas (status 404 o 410 = el browser las revocó)
    const expiredEndpoints: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled" && (r.value.status === 404 || r.value.status === 410)) {
        expiredEndpoints.push(subs[i].endpoint);
      }
    });

    if (expiredEndpoints.length > 0) {
      await db
        .from("push_subscriptions")
        .delete()
        .in("endpoint", expiredEndpoints);
      console.log(`[send-push] Limpieza exitosa: ${expiredEndpoints.length} suscripciones expiradas eliminadas.`);
    }

    const sent = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
    console.log(`[send-push] Resultado final: ${sent} exitosas de ${subs.length} intentadas.`);
    
    return new Response(
      JSON.stringify({ sent, total: subs.length, expired: expiredEndpoints.length }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[send-push] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
