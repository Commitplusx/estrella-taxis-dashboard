// src/lib/pushNotifications.ts
// Gestión del ciclo de vida de las suscripciones push del navegador

import { supabase } from "./supabase";

// Clave pública VAPID generada para este proyecto
export const VAPID_PUBLIC_KEY =
  "BLzd3BnXb_oxpo92aEa9ocuzVo9LX1Faj7eS1shbZA5H40-uNxRn7KEy8b8ihMWWRxKkFiAV8v-IBK6gQTjRxOA";

/** Convierte una base64url string a Uint8Array (requerido por la Push API) */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map((c) => c.charCodeAt(0)));
}

/** Registra el Service Worker si el navegador lo soporta */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    console.log("[Push] Service Worker registrado:", reg.scope);
    return reg;
  } catch (err) {
    console.error("[Push] Error registrando Service Worker:", err);
    return null;
  }
}

/**
 * Solicita permiso y suscribe al navegador a Web Push.
 * Guarda la suscripción en la tabla push_subscriptions de Supabase.
 */
export async function subscribeToPush(
  empresaId: string,
  userId: number
): Promise<PushSubscription | null> {
  if (!("PushManager" in window)) {
    console.warn("[Push] PushManager no soportado en este navegador.");
    return null;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    console.warn("[Push] Permiso denegado por el usuario.");
    return null;
  }

  const reg = await registerServiceWorker();
  if (!reg) return null;

  try {
    // Obtener suscripción existente o crear una nueva
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    // Persistir en Supabase (upsert por endpoint para evitar duplicados)
    const subJson = sub.toJSON();
    const keys = subJson.keys as Record<string, string> | undefined;
    
    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        tenant_id: empresaId,
        traccar_user_id: userId,
        endpoint: subJson.endpoint,
        p256dh: keys?.p256dh ?? "",
        auth: keys?.auth ?? "",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" }
    );

    if (error) {
      console.error("[Push] Error guardando suscripción:", error);
    } else {
      console.log("[Push] Suscripción activa y guardada en Supabase.");
    }
    return sub;
  } catch (err) {
    console.error("[Push] Error al suscribirse:", err);
    return null;
  }
}

/** Cancela la suscripción push y la elimina de Supabase */
export async function unsubscribeFromPush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  if (!reg) return;

  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
    console.log("[Push] Suscripción cancelada.");
  }
}

/** Devuelve true si el browser ya tiene una suscripción push activa */
export async function isPushSubscribed(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return sub !== null;
}
