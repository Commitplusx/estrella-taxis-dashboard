// public/sw.js
// Service Worker para notificaciones push de nuevos pedidos
// Se mantiene activo incluso cuando el navegador está cerrado

// Push recibido desde el servidor
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Nuevo Pedido", body: event.data?.text() || "" };
  }

  const title = data.title || "Nuevo Pedido — Estrella";
  const options = {
    body: data.body || "Tienes un nuevo pedido esperando.",
    icon: "/logo.png",
    badge: "/favicon.svg",
    vibrate: [200, 100, 200, 100, 200],
    tag: data.tag || "nuevo-pedido",
    renotify: true,
    requireInteraction: true,
    data: {
      url: data.url || "/orders",
      pedidoId: data.pedidoId || null,
    },
    actions: [
      { action: "ver", title: "Ver Comanda" },
      { action: "cerrar", title: "Cerrar" },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Clic en la notificacion
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "cerrar") return;

  const targetUrl = event.notification.data?.url || "/orders";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            client.focus();
            if ("navigate" in client) client.navigate(targetUrl);
            return;
          }
        }
        if (clients.openWindow) return clients.openWindow(targetUrl);
      })
  );
});

// Instalacion y activacion
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});
