# Ventana de 15 segundos para mensajes del bot de taxis

**Fecha:** 30 de octubre de 2026

**Proyecto:** Stellar Tracking / Pompeyo Express

**Estado:** publicado y verificado

## Comportamiento

Cuando un cliente manda varios mensajes seguidos, el bot espera 15 segundos desde el mensaje más reciente antes de interpretar el turno. Los textos, ubicaciones GPS y referencias cercanas se entregan juntos al intérprete, conservando el orden. Si llega otro mensaje durante la ventana, el turno se aplaza para incluirlo.

La agrupación vive en PostgreSQL y conserva el aislamiento por tenant, WABA y teléfono del cliente. El worker no vuelve a procesar el mismo turno mientras continúa la ventana. Tras el silencio, la latencia adicional depende del ciclo de consulta del worker (2.5 segundos como máximo en la configuración verificada).

La IA puede reconocer una petición directa como «me puede enviar un taxi» y asociar los pines GPS con el texto que los acompaña. El backend conserva las reglas de negocio: el pin de recogida, la consulta del precio vigente, los datos faltantes y el botón explícito de confirmación antes de crear un viaje.

## Verificación local

- `scripts/test-taxi-bot.ps1`: 5,861 pruebas Deno aprobadas y 124 pruebas Node/SQL aprobadas.
- El control estático del bot pasó para 93 archivos.
- Pasaron las comprobaciones de tipos de los puntos de entrada y las pruebas estrictas afectadas.

## Publicación

- Migración `20261031200000_taxi_15s_message_batching.sql` aplicada y registrada en el proyecto `izrsxygazsalfhpaualj`.
- Se publicaron `ycloud-webhook`, `process-queue` y `taxi-bot-admin`.
- La descarga de producción coincide con los archivos revisados; las respuestas OPTIONS fueron 200 y el endpoint administrativo sin sesión devolvió 401.
- Tras la publicación, el worker `stellar-taxi-bot` quedó en estado `online`, PID 52853, sin reinicios reportados en la comprobación.
- La configuración del canal Pompeyo Express permaneció habilitada y sin cambios.

No se envió un mensaje real ni se creó un viaje para esta verificación; una prueba de código no sustituye una prueba conversacional con el número conectado.
