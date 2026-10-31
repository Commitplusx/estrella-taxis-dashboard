# Recuperación de la conversación de taxis

Motor: `taxi-bot-v17-destination-recovery`. Alcance: cliente de WhatsApp de Stellar Tracking; sin cambios de esquema SQL.

## Fallos reproducidos y cambios

1. Tras preguntar un destino aún no indicado, una interpretación ambigua o una caída del proveedor borraba el token de «Se lo digo al chofer». La siguiente respuesta de aplazamiento no podía avanzar. Ahora el estado de destino crea una opción vigente con vencimiento nuevo, conserva el pin nativo y el nombre y sigue sin ofrecer confirmación hasta consultar la tarifa.
2. Un botón de destino vencido o sustituido sólo daba una respuesta sin salida. Ahora renueva la pregunta si la sesión todavía espera ese destino vacío. El clic antiguo no elige aplazar ni confirma; si ya hay destino o viaje activo, conserva los datos.
3. Una consulta de precio antes del nombre producía un importe del servidor que el redactor natural podía borrar. Las respuestas con importes calculados o enlaces del servidor conservan su texto; una pregunta de servicio puede seguir precediendo un resumen protegido sin reescribirlo.
4. El validador de respuestas de servicio exige conservar el carácter opcional del destino cuando el estado lo está preguntando. Se corrigió también un ejemplo cuyo texto de solicitud de recogida se describía equivocadamente como destino.

## Evidencia

Los estados iniciales y resultados esperados se fijaron antes de corregir la ejecución. Los registros privados `.codex-tmp/taxi-recovery-before.log`, `taxi-fare-before.log` y `taxi-optional-reply-before.log` conservan los fallos: cuatro recuperaciones, un importe perdido y dos respuestas que exigían destino.

La prueba SQL atraviesa cola, sesión restaurada, fallo de interpretación, opción sustituida, aplazamiento, nombre, asentimiento por texto, botón vigente y reentrega del commit. Sólo el botón actual crea un viaje y una oferta; el replay conserva uno de cada uno.

La batería completa aprobó 5,948 pruebas Deno, 126 pruebas Node/SQL, el control de calidad de 93 archivos y las comprobaciones de tipos de puntos de entrada, panel y pruebas. Registro privado: `.codex-tmp/taxi-robustness-final.log`. Las pruebas usan datos y proveedores sintéticos; no acreditan una conversación física por WhatsApp ni precisión general del modelo.

## Publicación comprobada

`process-queue` y `ycloud-webhook` están activos en versión 31 en el proyecto `izrsxygazsalfhpaualj`, conservando `verify_jwt=false`. Los endpoints respondieron HTTP 200 a OPTIONS antes y después. El respaldo previo y la descarga posterior están en el directorio temporal `stellar-v17-destination-recovery`; la comparación previa sólo encontró los tres archivos revisados y la comparación posterior no encontró diferencias en los archivos descargados.

SHA-256 de las fuentes activas verificadas:

- `contracts.ts`: `D84A44F876470D49A7982385209194301A5E41ECC29AA449E703BACE4DE44625`.
- `coordinator.ts`: `9A15A4EABBBF20566EA4967724265C05FED4A40D49A0C43752095AA22EE2717C`.
- `conversationReply.ts`: `C529FE1E6AFBD81D33489E50C8778EA96FB6729D748E683C069EB15556B564B1`.

No se envió WhatsApp real ni se aplicaron migraciones en esta entrega.
