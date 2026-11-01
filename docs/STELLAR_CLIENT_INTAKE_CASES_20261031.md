# Recepción de clientes: pin, nombre y referencias por mensajes separados

Se ampliaron los recorridos de Pompeyo a partir de ejemplos de atención aportados por el administrador. Las pruebas usan pasajeros, cuentas y coordenadas sintéticos; no reproducen conversaciones privadas completas ni contactan clientes o choferes.

## Comportamiento publicado

- Saludo y petición en burbujas distintas producen una petición agrupada de los datos que faltan, con el botón nativo de ubicación.
- Pin y «A nombre de…» conservan ambos datos; sólo se pregunta por el destino, que puede indicarse al chofer.
- Un nombre personal completo en su propia burbuja puede acompañar al primer pin, antes o después de éste, aunque aún no se haya preguntado el nombre. El intérprete lo propone y el backend exige evidencia literal, nombre completo y contexto de primer pin de recogida. Una plaza, dirección, instrucción o cita no se acepta como nombre por acompañar un pin.
- «En la fábrica…» y «A un costado…» describen la recogida cuando acompañan al pin o éste ya está guardado. Se conservan las referencias compatibles y no se convierten en destino ni borran el pin. «Ya me moví, ahora recógeme…» sigue invalidando el punto anterior y exige otro pin.
- La primera referencia añadida a una recogida GPS ya verificada cuenta como aclaración permitida. No dispara la derivación por presupuesto normal aunque llegue en un turno posterior al nombre. Se conservan el límite ordinario y las excepciones existentes por dudas/cambios.

El agrupamiento de 15 segundos se mantiene. También se cubren mensajes que llegan en turnos diferentes, conservando la sesión e historial del servidor. No se crea viaje por «sí», «mándalo» ni «enseguida»: sólo el botón vigente **Confirmar viaje** permite buscar. El precio se consulta en servidor y sigue oculto salvo pregunta del cliente. Sólo la aceptación real del conductor acredita una asignación.

## Evidencia

Los ocho casos nuevos incluyen petición fragmentada, pin con nombre explícito, pin con nombre completo y dos referencias, nombre antes del pin, continuación en otro turno, referencia sin destino, destino escrito y traslado real. Dos regresiones de nombres fallaron antes de corregir el coordinador: el backend perdía nombre y pin al interpretar el nombre como ambiguo.

Evaluación acotada con `deepseek-chat` y el pipeline real de interpretación/coordinación, sustituyendo sólo resolución, tarifa y consulta de candidatos por contratos sintéticos sin efectos:

| Evaluación | Resultado |
| --- | --- |
| Ocho casos con las fuentes activas anteriores | 4/8 |
| Los mismos ocho recorridos con la corrección | 8/8 |
| Regresiones de lenguaje ya existentes | 24/24 |
| Respuestas naturales y sus límites de estado | 30/30 |

En la versión anterior, dos casos confundieron el nombre con ambigüedad del pin y dos convirtieron referencias en destino. Los casos se utilizaron para desarrollo y ejemplos del prompt: **no son una cohorte ciega ni una medición de precisión poblacional**. Los timestamps de prueba se inicializan al arrancar; la fuente de los casos se mantuvo igual entre las comparaciones.

Posteriormente un test independiente demostró la derivación prematura al añadir una referencia tras tres mensajes ordinarios: falló antes del ajuste y aprobó después. Suite final Deno: **22,835 aprobadas**, con tipos. Puntos de entrada del worker/webhook y control estático de **142 archivos** aprobados. Las simulaciones nunca llamaron a WhatsApp ni crearon viajes reales. No se declara una prueba física con un pasajero.

El evaluador temporal sólo admitió suites fijas, autenticación privada y caducidad de 15 minutos. No aceptó datos de clientes ni llamó a las RPC de compra. Se eliminó al terminar y se verificó su ausencia en el proyecto.

## Publicación y acceso

GitHub `main`: `b92eaf2` (nombres, referencias y ejemplos) y `0053aad` (aclaración de referencias en el presupuesto). Supabase independiente `izrsxygazsalfhpaualj`: `process-queue` y `ycloud-webhook` **v47 ACTIVE**. Se descargaron los 31 módulos de ejecución de cada función, cotejando SHA-256 y OPTIONS HTTP 200. Sólo cambiaron `coordinator.ts`, `interpreter.ts`, `conversationReply.ts` y `messageBudget.ts`; las variantes activas de autenticación se conservaron. `taxi-bot-admin` permanece en v37. No se modificaron precios, asignación GPS, esquema SQL, VPS ni APK.

Por instrucción expresa del administrador se añadió únicamente el teléfono terminado en **9156**, normalizado con el prefijo de México. Se verificó al administrador existente y se usó `taxi_bot_customer_access_apply`, preservando los números que pudieran existir, revisión, auditoría e idempotencia de la ruta. La consulta final mostró canal activo, un autorizado y acceso permitido para ese teléfono. La atención sigue restringida; otros clientes deben añadirse en Autorizados. No se publicó el número completo en esta documentación.

Ante una regresión, las funciones v45 anteriores a esta intervención se conservaron en `intake-before`, privado. Restaurar sólo las fuentes revisadas y verificar salud; no deshacer la autorización solicitada ni restaurar datos de viajes para revertir código. Evidencia agregada: `STELLAR_CLIENT_INTAKE_CASES_20261031.evidence.json`.
