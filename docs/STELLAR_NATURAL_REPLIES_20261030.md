# Respuestas naturales del bot de taxis

## Cambio

La IA ahora redacta también aclaraciones y respuestas conversacionales que antes quedaban como frases fijas. Recibe el lote reciente del cliente, el historial breve, la respuesta autorizada por el servidor y el siguiente dato pendiente. Para una ubicación nativa recibe una descripción del evento, no las coordenadas.

La IA sólo redacta texto. El coordinador conserva el estado del diálogo, el GPS obligatorio de recogida, el destino opcional, la tarifa consultada, los enlaces del resumen y el botón vigente. Los resúmenes de confirmación nunca se reescriben. Una respuesta inválida o una falla del proveedor conserva el mensaje seguro del servidor. El motor queda identificado como `taxi-bot-v12-natural-replies`.

## Verificación local

- `node --experimental-strip-types estrella-taxis-backend/scripts/check-taxi-bot-quality.ts`: 93 archivos, sin tipos inseguros ni supresiones.
- Gate `estrella-taxis-backend/scripts/test-taxi-bot.ps1`: 5,868 pruebas Deno y 124 pruebas Node/SQL/integración aprobadas; incluye tipado de los puntos de entrada, panel y pruebas.
- Casos añadidos: respuesta contextual ante ubicaciones ambiguas, lenguaje natural guiado por el siguiente paso, coordenadas fuera del texto enviado al modelo y resúmenes/tarifas/enlaces/botón preservados por el servidor.

Las pruebas usan respuestas sintéticas para validar el contrato y los límites. No representan una medición de calidad ciega ni una conversación enviada por WhatsApp.

## Publicación

Publicado el 30-10-2026 en el proyecto `izrsxygazsalfhpaualj`: `process-queue` v27 y `ycloud-webhook` v27. La descarga posterior a la publicación confirma que los tres archivos de ejecución modificados coinciden por SHA-256 con el candidato revisado; el resto del código ejecutable conserva el contenido anterior. OPTIONS respondió 200 en ambos endpoints. No se envió un WhatsApp de prueba.
