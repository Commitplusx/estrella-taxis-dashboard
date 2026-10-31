# Ventana de 15 segundos para mensajes del bot de taxis

**Fecha:** 30 de octubre de 2026

**Proyecto:** Stellar Tracking / Pompeyo Express

**Estado:** publicado y verificado

## Comportamiento

Cuando un cliente manda varios mensajes seguidos, el bot espera 15 segundos desde el mensaje más reciente antes de interpretar el turno. Los textos, ubicaciones GPS y referencias cercanas se entregan juntos al intérprete, conservando el orden. Si llega otro mensaje durante la ventana, el turno se aplaza para incluirlo.

La agrupación vive en PostgreSQL y conserva el aislamiento por tenant, WABA y teléfono del cliente. El worker no vuelve a procesar el mismo turno mientras continúa la ventana. Tras el silencio, la latencia adicional depende del ciclo de consulta del worker (2.5 segundos como máximo en la configuración verificada).

La IA puede reconocer una petición directa como «me puede enviar un taxi» y asociar los pines GPS con el texto que los acompaña. El backend conserva las reglas de negocio: el pin de recogida, la consulta del precio vigente, los datos faltantes y el botón explícito de confirmación antes de crear un viaje.

## Verificación local

- `scripts/test-taxi-bot.ps1`: 5,863 pruebas Deno aprobadas y 124 pruebas Node/SQL aprobadas.
- El control estático del bot pasó para 93 archivos.
- Pasaron las comprobaciones de tipos de los puntos de entrada y las pruebas estrictas afectadas.
- Una prueba integrada entrega juntos cinco textos y dos pines al coordinador; verifica que conserva el nombre, prepara un único resumen y no busca unidad antes del botón.
- La prueba encontró y corrigió un caso donde normalizar el lote borraba los saltos de línea y ocultaba que contenía señales de recogida y destino distintas.

## Publicación

- Migración `20261031200000_taxi_15s_message_batching.sql` aplicada y registrada en el proyecto `izrsxygazsalfhpaualj`.
- Se publicaron `ycloud-webhook`, `process-queue` y `taxi-bot-admin`; después se desplegó la corrección de interpretación de mensajes agrupados.
- Las versiones activas son 25, 25 y 31, respectivamente. La descarga de producción coincide con los archivos revisados; las respuestas OPTIONS fueron 200 y el endpoint administrativo sin sesión devolvió 401.
- Tras la publicación, el worker `stellar-taxi-bot` quedó en estado `online`, sin reinicios reportados en la comprobación.
- La configuración del canal Pompeyo Express permaneció habilitada y sin cambios.

No se envió un mensaje real ni se creó un viaje para esta verificación; una prueba de código no sustituye una prueba conversacional con el número conectado.

## Sondeo de cola mientras la sesión está ocupada

La revisión del 31-10-2026 encontró que `taxi_bot_pending()` podía devolver mensajes nuevos de una conversación que aún tenía un turno en curso. `taxi_bot_begin()` ya respondía `busy` y el commit ya invalidaba el resultado viejo cuando detectaba nueva entrada, así que no se duplicaba el viaje; aun así, el sondeo podía ocupar los espacios de la tanda periódica y retrasar otros chats.

La migración `20261031210000_taxi_pending_lease_polling.sql` excluye del sondeo cualquier conversación con lease activo. Cuando el turno se libera —incluida la ruta de superseded— sus mensajes pendientes vuelven a estar disponibles juntos; si el worker se cae, vuelven al sondeo al vencer el lease. El límite por tenant, el silencio de 15 segundos, la idempotencia y los reintentos acotados no cambian.

La prueba SQL enfocada falló antes del cambio porque una sesión ocupada seguía apareciendo como pendiente; pasa con la migración y confirma que otro contacto continúa programable y que el lote original reaparece al liberar el lease. La suite completa pasó: 5,907 pruebas Deno y 125 pruebas Node/SQL/integración, control estático y tipado de entradas, panel y pruebas.

La migración aún no está aplicada en producción: el conector Supabase rechazó la operación por falta de permiso y el CLI no pudo resolver el estado remoto desde la configuración/red actual. No se modificó ningún dato ni configuración del canal.
