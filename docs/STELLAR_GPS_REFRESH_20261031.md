# Actualización de GPS al buscar una unidad y prueba 0540

## Estado vigente

Política vigente posterior: [treinta minutos y detención persistente](STELLAR_DISPATCH_IDLE_POLICY_20261031.md). Publicación actual de [conversación con clientes](STELLAR_CUSTOMER_FLOW_FIX_20261031.md): worker/webhook v48 y administrador v37. El puente conserva la detención sin renovarla al importar GPS.

Historial del simulador: su primera integración usó el mismo refresco y selector con worker/webhook v43 y administrador v35; ver [Simulador de asignación](STELLAR_DISPATCH_SIMULATION_20261031.md). La evidencia y prueba física descritas abajo corresponden al despliegue original, anterior a la política vigente.

## Despliegue original de este documento

Publicado en el proyecto independiente `izrsxygazsalfhpaualj`: `process-queue` y `ycloud-webhook` versión **41 ACTIVE**. `taxi-bot-admin` sigue en v34. Se verificaron nuevamente los 29 archivos de ejecución de cada bundle y HTTP 200 a OPTIONS.

Al confirmar un viaje, el selector existente comprueba conductores elegibles y solicita una sincronización al puente **antes** de leer la flota/posiciones de Traccar. Las rondas posteriores siguen la misma ruta. Sin conductores elegibles no se consulta Wialon innecesariamente. El flujo normal de cliente sigue exigiendo su pin de origen, tarifa consultada en el servidor y el botón de confirmación vigente; no se crea otra ruta de compra.

El puente consulta Wialon, importa sus posiciones por OsmAnd y sólo confirma la actualización si todas las unidades con posición fueron aceptadas por Traccar. Después continúa el algoritmo existente de cercanía, orientación, señal libre explícita, GPS válido/reciente, base y turno. La señal desconocida nunca cuenta como libre.

El sondeo sin solicitudes sigue cada **30 segundos**. Un sondeo y varias solicitudes simultáneas comparten una sola operación; se reutiliza un resultado completado hace menos de un segundo. No se abren sesiones Wialon por cada viaje si la sesión actual sigue válida.

La consulta usa [`core/search_items` con `force:1`](https://help.wialon.com/en/api/user-guide/api-reference/core/search_items), que inicia una búsqueda nueva en Wialon. Recupera la última posición disponible allí; no ordena al dispositivo GPS obtener un fix nuevo. Se conserva el timestamp original y se mantienen los filtros de antigüedad.

## Fallos y acceso

`POST https://taxis.estrella-eats.mx/taxi-gps-refresh` llega por Nginx al puerto **127.0.0.1:5295** del mismo puente. Sólo admite solicitudes privadas sin cuerpo y autentica con el `TAXI_WORKER_SECRET` ya usado por el consumidor; no se expone a web/APK. El secreto se carga del archivo privado existente y nunca se imprime. Las comparaciones son de tiempo constante y el endpoint no recibe teléfonos, coordenadas del cliente ni un tenant suministrado por el navegador.

El puente limita cada operación a ocho segundos; el consumidor espera hasta diez dentro del plazo existente de selección. Ante autenticación fallida, timeout, importación parcial o respuesta inválida, no devuelve candidatos basados en un resultado de actualización fallido. El flujo existente conserva la solicitud para las rondas duraderas y sus límites de fallos/caducidad. El proceso conserva sus registros agregados `taxi_gps_sync`; no registra la sesión Wialon en el login nuevo.

## Prueba real de instalación y asignación

Primero se instaló la APK debug **1.0.0+2** conservando datos. Android confirmó instalación, versión y apertura correcta de `com.stellar.tracking/.MainActivity`. No se hizo una navegación física completa de los turnos en la APK.

Se comprobó la unidad Traccar **4, ANA KAREN 0540**, conductor activo, WhatsApp terminado en **1852**, GPS válido/reciente y señal libre. El canal de Pompeyo terminado en **2491** estaba activo. La primera notificación de prueba quedó **read**.

Por petición expresa del administrador se preparó una solicitud manual identificada **PRUEBA TECNICA - SIN PASAJERO**, con puntos de prueba en el centro y tarifa consultada por la RPC H3. No se simuló un mensaje del cliente ni su clic de confirmación: esta prueba verifica despacho y recepción, no el checkout completo de un pasajero.

Se usó `taxi_bot_dispatch_offer` con exclusivamente la unidad 4, sin crear un trabajo de rondas que pudiera contactar a otros taxis. El viaje de prueba es `b2853b50-daea-4d67-b921-a1f73875e3bc`. Su oferta `fd767bbb-e31f-4fb4-a547-bd479c42dd32` fue leída; entraron eventos reales de los botones **Aceptar viaje** y **Finalizar viaje** desde el teléfono del conductor. El estado persistido recorrió `buscando_conductor → en_camino → completado`, y la oferta `offered → accepted → finished`.

Los avisos de asignación al cliente terminado en **9156**, asignación al chofer y finalización al cliente quedaron **read**, sin errores. La autorización temporal del cliente se retiró al terminar: la lista volvió a cero y no quedaron viajes activos. Se conservan el registro marcado de prueba y su auditoría.

La prueba de WhatsApp ocurrió antes de publicar la actualización inmediata. Después de publicarla se hizo una consulta real protegida a Wialon: HTTP 200, **18 unidades con posición**, 260 ms en esa única medición; el acceso sin credencial dio HTTP 401. No representa una garantía de latencia ni otra prueba física de un viaje.

## Validación y publicación

Aprobaron 22,628 pruebas Deno del bot con tipos, 157 pruebas Node/PostgreSQL, ocho pruebas del controlador/HTTP privado y tres recorridos del puente activo revisado con proveedores simulados. Se cubrieron llamadas simultáneas, señal que cambia a ocupado/desconocido, importación parcial, fallo de Wialon, sesión vencida, timeout, autenticación y ausencia de conductores. Los ocho casos del módulo también pasaron en Node 20 del VPS. `deno check` de ambos entrypoints y el control estático de 128 archivos aprobaron.

Una invocación inicial que intentó pasar todo `tests/` a Deno se detuvo al encontrar un import JSON de la web incompatible con ese ejecutor. Se ejecutaron después los archivos Deno del bot y la suite PostgreSQL con su ejecutor Node; no se cambió ni omitió una expectativa para ocultar un fallo del cambio.

El parche del puente se condicionó al SHA-256 activo y se respaldaron fuente/Nginx en `/root/wialon-bridge/backups/refresh-20261031-30a69e3a164a/`. Se validó Nginx antes de recargarlo y se reinició sólo `wialon-bridge`. Los PID/reinicios de los consumidores Stellar y Robin's permanecieron iguales; el consumidor de Stellar siguió reportando cero fallos. Las funciones se empaquetaron a partir de las fuentes activas respaldadas, cambiando sólo `runtime.ts`, `services.ts` y el nuevo `gpsRefresh.ts`; se preservó el módulo de autenticación activo.

[Evidencia resumida de publicación y prueba](STELLAR_GPS_REFRESH_EVIDENCE_20261031.json). Ante una regresión, restaurar el respaldo de puente/Nginx y las funciones v40 respaldadas de esta entrega; no copiar otra carpeta completa ni restaurar turnos/usuarios de la prueba.
