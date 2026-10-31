# Recuperación del flujo de atención

Estado posterior de asignación y publicación: [rondas y recuperación de WhatsApp](STELLAR_DISPATCH_ROUNDS.md). Las versiones y hashes de este documento corresponden a la publicación v21 descrita aquí.

Motor `taxi-bot-v21-state-recovery`. Proyecto independiente `izrsxygazsalfhpaualj`.

## Problemas reproducidos

La recuperación del coordinador terminaba en preguntas abiertas aunque el estado ya indicaba qué dato faltaba. Ante una interpretación fallida, una propuesta vacía, un comentario sin datos nuevos o un «sí» escrito, el cliente podía recibir otra pregunta de recogida teniendo ya GPS, quedarse sin la opción de omitir destino o perder el botón de revisión después de completar los datos. Un botón de confirmación vencido sólo remitía a un resumen anterior, igualmente vencido.

Se congeló una matriz de siete estados, ocho entradas y dos fallos del redactor antes de corregirla. La primera ejecución dejó 90 fallos entre 131 pruebas; evidencia local privada en `.codex-tmp/taxi-recovery-before.log`. Los dobles declaran sus propuestas o errores; no interpretan el texto ni aprueban automáticamente decisiones.

También se reprodujo la pérdida de los mensajes legibles de un lote si contenía un archivo no admitido. Por separado, cinco pruebas reprodujeron resúmenes demasiado largos y ausencia de validación en la frontera del proveedor: `.codex-tmp/taxi-long-review-before.log`. [YCloud documenta un máximo de 1024 caracteres en el cuerpo interactivo](https://nndocs.ycloud.com/reference/whatsapp_message-send-directly); el cuerpo de texto ordinario admite un límite distinto.

## Comportamiento corregido

- Se reutiliza la máquina de estados existente para retomar GPS, destino opcional, nombre o papel de un pin, conservando los datos guardados.
- Un recorrido completo recupera un resumen utilizable: se vuelve a consultar la tarifa y se emite un botón nuevo. Si el último mensaje no pudo interpretarse, se explica que ese cambio **no se aplicó** y se muestran los datos conservados para revisión.
- Un clic vencido nunca solicita una unidad: recupera el paso pendiente o renueva el resumen. Un clic anterior, cuando ya existe otro resumen vigente, reenvía ese resumen sin invalidarlo ni volver a cotizarlo. El clic posterior sobre el botón vigente conserva la ruta de confirmación habitual.
- Una pregunta renueva una opción de destino vencida y retoma el nombre cuando falta. Una pregunta de servicio con resumen vigente conserva sus datos, precio y consentimiento; no vuelve a cotizar por hablar con el cliente.
- La validación del redactor exige el siguiente paso elegido por el backend también en conversación casual y dudas de servicio. Si falla el proveedor o su respuesta omite ese paso, se conserva la respuesta segura del servidor. No se agregaron reintentos.
- Los textos y pines del lote siguen procesándose cuando también llega un archivo no admitido. Se avisa del contenido que no pudo leerse. Un archivo por sí solo retoma el paso pendiente. La atención humana y los viajes activos conservan su control.
- Un resumen largo se guarda en dos mensajes de outbox: texto completo y botón corto con el mismo token. No se recortan referencias, nombre, destino ni enlaces. El transporte rechaza cuerpos interactivos fuera de límite antes de llamar al proveedor; cada mensaje se mantiene como una entrega duradera independiente.

Las propuestas inválidas no modifican campos. Una referencia que intenta completar un lugar distinto al pendiente debe aclarar el extremo correspondiente, sin geocodificarla ni aplicarla parcialmente. Mostrar otro resumen no acepta una propuesta inválida ni constituye una confirmación.

Permanecen GPS nativo de recogida obligatorio, destino opcional, tarifa del backend con mínimo configurado, precio visible sólo cuando se pide y creación del viaje únicamente mediante el botón vigente. No se cambian autorizados, bases, conductores ni algoritmo de asignación.

## Verificación

La suite nueva contiene 144 pruebas deterministas: recuperación por estado/entrada, fallos de ambos componentes de IA, conservación de datos y serialización, límites de llamadas, controles vencidos, formatos mezclados, control humano, viajes activos, cotización inválida y frontera del proveedor.

Cuatro recorridos de PostgreSQL verifican recuperación por botón vencido, fallo del intérprete, propuesta vacía y resumen largo. Comprueban sesión persistida, traza válida, GPS conservado, orden de mensajes, cero viajes/ofertas antes del clic, conservación del botón vigente al repetir uno anterior, una sola asignación con el clic correcto e idempotencia al repetir el commit. El recorrido largo verifica que el texto y el botón se guardan separados, en orden, sin recortar datos.

Estos casos son regresiones de desarrollo y pruebas de contratos, no una medición ciega de comprensión del lenguaje ni una prueba física de WhatsApp. No se modificaron instrucciones del modelo ni se ejecutaron llamadas nuevas al modelo real en esta revisión.

La ejecución completa aprobó **22,479 pruebas Deno y 136 pruebas Node/PostgreSQL**, sin fallos. Pasaron el control estático de 99 archivos, tipado de los puntos de entrada, evaluadores, panel y pruebas SQL. Evidencia local privada: `.codex-tmp/taxi-recovery-final-full.log`. Los 144 casos nuevos forman parte de ese total; no son llamadas al modelo real.

## Publicación comprobada

Se respaldaron ambas funciones activas en `%TEMP%/stellar-v21-state-recovery/before`. El candidato aislado se comparó con la fuente activa y sólo difería en los cuatro archivos de taxi revisados: contratos, coordinador, validación del redactor y transporte. Se conservó el mapa de importación.

`process-queue` y `ycloud-webhook` están **ACTIVE en versión 35**, con `verify_jwt=false`, en el proyecto independiente indicado arriba. Ambas respondieron HTTP 200 a OPTIONS antes y después. La comprobación de salud no constituye una reserva ni una prueba física de WhatsApp.

Se descargó cada función publicada a un directorio distinto bajo `%TEMP%/stellar-v21-state-recovery/after` y se compararon **50 hashes SHA-256** contra el candidato probado, sin diferencias. El manifiesto y la evidencia local están en `.codex-tmp/state-recovery-release-manifest.json` y `.codex-tmp/state-recovery-published-evidence.json`.

Hashes de los cuatro archivos activos:

- `contracts.ts`: `adb89dddb5066b83bdbcc4ee1e7f40862332ce3d416e0ffc65bed885b1b64880`.
- `coordinator.ts`: `5e7f50e4ed06d0fc3e96c21b1697cbc7a2dc0d5c6182cf786966471c72d6c9c1`.
- `conversationReply.ts`: `b7a07d7dd5b5c869974baf875c2e1d22a2a21dffda0a8e57260d36751fcbacd8`.
- `transport.ts`: `3736d49b46c86900a527e7a7661487b65625095a9b0b790d52e3ca2955858a18`.

No se aplicaron migraciones, cambiaron secretos, publicaron pantallas ni enviaron mensajes reales. Esta revisión endurece la recuperación y los mensajes del flujo de cliente; las pruebas de contratos no garantizan ausencia de todos los fallos de servicios externos.
