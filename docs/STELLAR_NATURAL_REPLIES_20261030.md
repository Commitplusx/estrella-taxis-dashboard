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

## Ampliación de lenguaje natural, 30-10-2026

El intérprete ahora tiene diez diálogos guiados: combina solicitud coloquial, recogida y destino en cualquier orden; conserva la última corrección; trata preguntas sobre el servicio sin perder los datos del recorrido; reconoce respuestas cortas y errores comunes; y consulta el estado sin afirmar una asignación inexistente. Se añadieron casos sintéticos de solicitud informal, GPS, destino opcional, precio junto con corrección y nombre del pasajero.

El redactor de respuestas usa diez ejemplos situacionales para saludar, explicar por qué necesita el pin, contestar una duda de tarifa sin inventarla, preguntar el destino de forma opcional, aclarar el propósito de un pin, solicitar el nombre, informar una búsqueda sin unidad confirmada y acompañar el botón actual de confirmación. Sus diez salidas pasan por el mismo validador que filtra respuestas del modelo. Los ejemplos no reemplazan el siguiente paso que fija el estado del servidor.

Verificación local de esta ampliación: 5,903 pruebas Deno y 124 pruebas Node/SQL/integración aprobadas; el control de tipos y el control de calidad del bot también pasaron. Los ejemplos son un conjunto sintético de desarrollo y no prueban la precisión de un modelo en vivo; no se mandó un WhatsApp real.

Versión del motor: `taxi-bot-v13-conversational-examples`. Publicado el 30-10-2026 en `izrsxygazsalfhpaualj`: `process-queue` v28 y `ycloud-webhook` v28. Descargué las funciones activas después de publicar: SHA-256 confirma que los tres archivos de ejecución revisados coinciden con el candidato y que no cambió ningún otro archivo ejecutable. OPTIONS respondió 200 en ambos endpoints. No se envió una conversación de prueba por WhatsApp.

## Aclaraciones de destinos ambiguos, 30-10-2026

Si el servidor mostró opciones para un lugar y el pasajero responde con un comercio o una referencia breve (por ejemplo, «Liverpool» después de «Plaza Las Flores»), el estado pendiente adjunta esa respuesta al lugar consultado y lo vuelve a resolver. No la reinicia como una pregunta de destino opcional. Si aún hay varias tarifas posibles, mantiene el lugar y pregunta cuál opción corresponde; una corrección explícita («mejor voy al Hospital») sustituye el lugar anterior. La respuesta de precio sigue siendo del servidor.

El redactor natural no reescribe las listas de colonias/tarifas, para conservar sus categorías exactas. El nombre de categoría «Cash A» mantiene sus mayúsculas. Las pruebas reproducen tanto un «Liverpool» resoluble como uno que sigue ambiguo, y verifican que una corrección reemplace el destino.

Verificación local de esta corrección: 5,906 pruebas Deno y 124 pruebas Node/SQL/integración aprobadas; control de tipos y calidad aprobados. La resolución de mapas real depende de los servicios y datos configurados para la base; no se envió un WhatsApp real.

## Tarifa sólo cuando se solicita, 31-10-2026

El resumen de confirmación ya no muestra el precio por defecto. El servidor conserva la cotización verificada y la vuelve a comprobar al confirmar; cuando el pasajero pregunta cuánto cuesta, la respuesta incluye la tarifa y el resumen de esa consulta sí la muestra. La operación y el botón de confirmación no dependen de que se enseñe el precio en el resumen ordinario.

Motor: `taxi-bot-v15-asked-fare-summary`. Verificación local: 5,907 pruebas Deno, 124 pruebas Node/SQL/integración, control de calidad del bot y tipos aprobados.

Publicado el 31-10-2026 en `izrsxygazsalfhpaualj`: `process-queue` v29 y `ycloud-webhook` v29, ambos conservan `verify_jwt=false`. Después del despliegue, descargué el código activo a una carpeta temporal y comprobé SHA-256 de los cuatro archivos compartidos modificados: `contracts.ts` `4E4935443FE8625098B569B783FA36BE7EC244FCFC62DF2328AC607D1F2E39FA`, `coordinator.ts` `0F2F71436407AAD8B25A2EAB6C143944C1970661E679A97706669E06E9D06A17`, `interpreter.ts` `56482B4F85DD1A6EF1AE3E4679622A27372CD162890327FACF0F25292FCBF5E5` y `neighborhoods.ts` `DAEF9445359CDC779F361D17CF1DDCBB818BAE532C8E437D432FB5248A95A5A0`; coinciden con el candidato. OPTIONS respondió 200 en ambos endpoints. No se envió una conversación de prueba por WhatsApp.
