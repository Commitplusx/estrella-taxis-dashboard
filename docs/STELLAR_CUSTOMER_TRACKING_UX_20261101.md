# Seguimiento del cliente, unidad y OpenStreetMap

Solicitud de Kaleb: botón de seguimiento en el aviso, número de taxi en lugar del nombre del chofer, mapa/enlaces OpenStreetMap y conversación más amigable. Proyecto exclusivo Stellar `izrsxygazsalfhpaualj`.

## Corrección

La aceptación guardaba `o.driver_name` en `viajes.taxi_name`. Ahora el número configurado de la unidad se guarda separado del snapshot del chofer (`bot_driver_name`). Los contactos del device4 configuran540: se presenta **Unidad0540**. Números equivalentes540/0540 se normalizan; variantes contradictorias no se adivinan. No se cambia el nombre de Traccar ni de las personas.

El cliente recibe un único aviso amigable con **Ver viaje en vivo** (CTA de longitud compatible), número de unidad y chofer por separado. El enlace conserva el token privado del seguimiento de Stellar. No muestra precio, no agrega otra notificación ordinaria ni permite que el modelo invente botones. Los enlaces de cliente y conductor no se pueden mezclar por categoría.

El seguimiento usa Leaflet/OpenStreetMap, igual que el mapa del panel; los enlaces de recogida y posición también abren OpenStreetMap. Conserva consulta cada5 segundos visible, controles de centrar/actualizar, privacidad de la unidad asignada y cierre al finalizar. No hay suscripción pública a toda la flota. No promete ruta vial ni una ETA inventada.

La pantalla anterior condicionaba ETA a GPS fresco y, cuando no había ETA, afirmaba que faltaba recogida aunque las coordenadas sí estaban. Ahora conserva el punto compartido y muestra la antigüedad real de GPS. Un punto antiguo no se anuncia como actualizado. Ante fallo de conexión mantiene los últimos datos con aviso; el fetch tiene límite15 segundos y no se solapan consultas.

## Validación

-191 pruebas SQL completas y22,666 pruebas Deno con tipos aprobadas; incluyen consentimiento, aceptación única, aviso CTA con presupuesto, separación unidad/chofer, variantes de número, privacidad, caducidad, llegada y finalización.
- Gate163 archivos, tipado estricto de frontend y pruebas SQL, entradas Edge y build aprobados. Los errores globales históricos ajenos a este cambio no se declaran corregidos.
- Navegador con datos sintéticos a390×844 y1280×900: sin errores/desbordamiento/enlaces Google; señal antigua correcta, señal fresca, fallo/recuperación y suspensión al completar. Revisión de diseño ship; se conserva el sistema existente.
- Ensayo de la migración sobre el esquema activo con ROLLBACK; respaldo de los cuerpos SQL y tres funciones Edge. La migración mantiene el hook de prueba dirigido a0540 y no modifica estado, precio ni confirmación del viaje.

## Publicación

Migración `20261101180000_taxi_customer_tracking_ux.sql`: agrega snapshots separados y un gate `customer_tracking_button_enabled=false` por defecto. Se publica el transporte y `track-position` antes de habilitar el CTA en Pompeyo. El backfill corrige solamente viajes bot actualmente asignados usando su oferta aceptada, sin mensajes de QA ni cambios de estado. Versiones/hashes y activación final se registran en la evidencia junto a este documento.

Los mensajes ya entregados no se editan ni se reenvían para aparentar una prueba. Los siguientes avisos usan el botón; el enlace de seguimiento existente abre la página actualizada. La apertura/entrega física del nuevo CTA requiere una aceptación posterior real; una simulación y un estado success de Vercel no la prueban.
