# Seguimiento del cliente, unidad y OpenStreetMap

Solicitud de Kaleb: botón de seguimiento en el aviso, número de taxi en lugar del nombre del chofer, mapa/enlaces OpenStreetMap y conversación más amigable. Proyecto exclusivo Stellar `izrsxygazsalfhpaualj`.

## Corrección

La aceptación guardaba `o.driver_name` en `viajes.taxi_name`. Ahora el número configurado de la unidad se guarda separado del snapshot del chofer (`bot_driver_name`). Los contactos del device 4 configuran 540: se presenta **Unidad 0540**. Números equivalentes 540/0540 se normalizan; variantes contradictorias no se adivinan. No se cambia el nombre de Traccar ni de las personas.

El cliente recibe un único aviso amigable con **Ver viaje en vivo** (CTA de longitud compatible), número de unidad y chofer por separado. El enlace conserva el token privado del seguimiento de Stellar. No muestra precio, no agrega otra notificación ordinaria ni permite que el modelo invente botones. Los enlaces de cliente y conductor no se pueden mezclar por categoría.

El seguimiento usa Leaflet/OpenStreetMap, igual que el mapa del panel. La pantalla mantiene el mapa y los detalles dentro de Stellar; quitamos los botones y enlaces de acción que sacaban al cliente a OpenStreetMap. Solo queda la atribución pequeña del proveedor dentro del mapa. Conserva consulta cada 5 segundos mientras está visible, controles de centrar/actualizar, privacidad de la unidad asignada y cierre al finalizar. No hay suscripción pública a toda la flota. No promete ruta vial ni una ETA inventada.

La pantalla anterior condicionaba ETA a GPS fresco y, cuando no había ETA, afirmaba que faltaba recogida aunque las coordenadas sí estaban. Ahora conserva el punto compartido y muestra la antigüedad real de GPS. Un punto antiguo no se anuncia como actualizado. Ante fallo de conexión mantiene los últimos datos con aviso; el fetch tiene límite15 segundos y no se solapan consultas.

## Validación

- 191 pruebas SQL completas y 22,666 pruebas Deno con tipos aprobadas; incluyen consentimiento, aceptación única, aviso CTA con presupuesto, separación unidad/chofer, variantes de número, privacidad, caducidad, llegada y finalización.
- Gate de 163 archivos, tipado estricto de frontend y pruebas SQL, entradas Edge y build aprobados. Los errores globales históricos ajenos a este cambio no se declaran corregidos.
- Navegador con datos sintéticos a 390×844 y 1280×900: sin errores/desbordamiento/enlaces Google; señal antigua correcta, señal fresca, fallo/recuperación y suspensión al completar. Revisión de diseño ship; se conserva el sistema existente.
- Revisión de la nueva presentación con datos sintéticos a 390×844, 1280×900 y 1919×915: el mapa domina, los detalles se abren en la misma página, el panel no desborda y no hay botones de acción externos. En móvil, el mapa cubierto no conserva controles enfocables. La atribución del mapa se conserva.
- Ensayo de la migración sobre el esquema activo con ROLLBACK; respaldo de los cuerpos SQL y tres funciones Edge. La migración mantiene el hook de prueba dirigido a0540 y no modifica estado, precio ni confirmación del viaje.

## Publicación

Publicado y habilitado en producción el 1 de noviembre de 2026. Código en `main`: `caa40bd95fe5a874eb99996c4c5bb455626aacf7`. Vercel confirmó success en [el proyecto existente de Stellar](https://vercel.com/deiffs-projects/estrella-taxis-dashboard/8sFYzvMwRKN8n1QHYH1EP17Rv4Za).

Migración `20261101180000_taxi_customer_tracking_ux.sql` aplicada y registrada después del ensayo con ROLLBACK. Agrega snapshots separados y el gate `customer_tracking_button_enabled=false` por defecto. El backfill corrige solamente viajes bot actualmente asignados usando su oferta aceptada, sin mensajes de QA ni cambios de estado.

Supabase Stellar: `process-queue` v55, `ycloud-webhook` v51 y `track-position` v5, todos ACTIVE. Sus fuentes descargadas después del despliegue coinciden con los 33, 32 y 9 módulos runtime preparados respectivamente. `driver-trip` v1 permanece activo. Se conservaron las variantes activas de cada consumidor y el hook de prueba dirigido; no se copió el backend completo.

Después de publicar web, API y transporte se activó el botón exclusivamente en Pompeyo, WABA terminado en 2491, revisión 8. El canal y la página del conductor siguen habilitados. Lectura posterior: cola pendiente/enviando/incierta en cero; consumidor `stellar-taxi-bot` online, cero reinicios. La función nativa de ofertas conserva el hash MD5 de su definición `cb595438742cb4aa1a32d370594d45d6`.

El API del viaje real, consultado sin mutarlo, devuelve HTTP 200, `Unidad 0540`, chofer separado y recogida presente. La página publicada pasó una comprobación con respuesta sintética: mapa OSM cargado, sin solicitudes/enlaces Google, sin errores ni desbordamiento y texto de GPS antiguo correcto. Versiones, resultados y hashes están en `STELLAR_CUSTOMER_TRACKING_UX_20261101.evidence.json`.

Los mensajes ya entregados no se editan ni se reenvían para aparentar una prueba. Los siguientes avisos usan el botón; el enlace de seguimiento existente abre la página actualizada. La apertura/entrega física del nuevo CTA requiere una aceptación posterior real; una simulación y un estado success de Vercel no la prueban.
