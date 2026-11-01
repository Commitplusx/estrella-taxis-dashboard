# Piloto abierto de Pompeyo y corrección del mapa

Kaleb autorizó abrir la IA a los clientes reales de Pompeyo como prueba piloto. Antes de este cambio el canal estaba habilitado, pero la admisión permanecía restringida a un solo número de prueba. Activar el canal por sí solo no abría esa lista.

## Admisión y controles

La migración `20261101190000_taxi_public_pilot.sql` agrega `taxi_bot_customer_access.public_enabled`, falso por defecto. Sólo la base seleccionada se abre al activar el piloto. Los teléfonos deben ser válidos y el modo público exige una empresa de taxis activa. Se mantienen el control del canal, el bloqueo de contactos, la admisión en cola, el límite por contacto, el debounce de 15 segundos, la revisión antes del commit y la comprobación antes de enviar.

El panel `/taxi-bot#autorizados` muestra el modo real y permite guardar **Todos los clientes (piloto)** o **Sólo números autorizados**. El guardado de modo/lista es atómico, tiene revisión e idempotencia y utiliza al administrador autenticado. Las peticiones antiguas que sólo editan la lista conservan el modo; sus reentregas históricas siguen siendo reconocidas. Los propietarios, choferes y operadores no pueden abrir el acceso de la base. La lista de prueba se conserva para volver a ella.

Para una emergencia usa **Pausar bot** en la barra superior de `/taxi-bot`. Detiene nuevas respuestas y ofertas, conserva el estado y la cola; un envío ya iniciado aún puede llegar. Ahora la pausa sigue disponible mientras hay cambios sin guardar o un guardado pendiente en otra sección. La reactivación sí exige resolver esos cambios. El canal puede estar pausado aunque el modo de admisión siga siendo público.

Abrir la admisión no confirma ni asigna viajes: sigue siendo obligatorio el pin GPS de recogida y el botón vigente de confirmación. Destino opcional, precio consultado en servidor y oculto salvo pregunta, presupuesto normal de cinco mensajes con las excepciones existentes. La titularidad de las ofertas, las tres rondas y la aceptación atómica no se modifican.

## Leaflet y OpenStreetMap

El seguimiento ya usaba Leaflet. Las imágenes de OpenStreetMap eran bloqueadas porque el documento privado tenía `Referrer-Policy: no-referrer` y las peticiones de las imágenes heredaban esa política. La [política oficial de OSM](https://operations.osmfoundation.org/policies/tiles/) exige que las páginas envíen un Referer válido.

Los dos mapas privados ahora declaran `referrerPolicy="strict-origin"` en su capa Leaflet y usan la URL canónica de tiles. Así las imágenes identifican sólo el origen del sitio, sin ruta, token, consulta ni fragmento. El documento conserva `no-referrer` para el resto de peticiones. No se cambió a Google, no hay proxy anónimo, descarga masiva, cache-busting ni reintentos ilimitados. Se respeta la caché normal del proveedor y su atribución.

La comprobación anterior sólo verificaba una imagen cargada en el DOM; no distinguía una imagen de rechazo del mapa real. La nueva comprobación de navegador verifica el estado HTTP de cada imagen visible y que todos sus Referer sean sólo el origen. El ensayo local confirmó nueve imágenes HTTP 200 sin exponer el token.

## Validación y publicación

196 pruebas SQL con tipos y 5,563 pruebas Deno de contratos/estado aprobadas. Incluyen admisión pública aislada por base, números inválidos, cierre durante interpretación, pausa de emergencia, guardados repetidos y servicio completo de un cliente nuevo con rechazo de aceptación ajena. Tipado estricto del panel, mapas y pruebas, control estático de 163 archivos y build aprobados.

Se respalda el esquema activo y `taxi-bot-admin` antes de publicar. La migración se ensaya contra producción dentro de ROLLBACK; la activación real se realiza después de publicar web y API. El backend del trabajador y webhook no requiere reemplazo: consulta la política SQL existente. La evidencia agregada registra versiones, hashes y estado final. No se envían mensajes ni se crean viajes de QA en producción.
