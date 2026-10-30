# Destino, Maps y respuestas naturales del bot — 30 de octubre de 2026

## Estado publicado

Stellar Tracking, proyecto `izrsxygazsalfhpaualj`, usa el contrato `taxi-bot-v10-destination-dialogue`. La migración `20261031190000_taxi_destination_dialogue.sql` está aplicada. `ycloud-webhook` y `process-queue` quedaron en versión **23**; `taxi-bot-admin`, en versión **29**. Se descargaron las tres funciones después de publicar: los **25/25/24** archivos ejecutables coinciden con los paquetes revisados. Las tres funciones responden OPTIONS 200; el administrador sin sesión responde 401. El consumidor `stellar-taxi-bot` volvió a quedar en línea.

El canal de Pompeyo permaneció activo, con mínimo de **$55 MXN** y revisión 6. La migración sólo reemplaza las rutinas de fase, confirmación, tarifa y traza necesarias para guardar la elección de destino. El paquete Edge genera el nuevo resumen y diálogo. No cambia tarifas, cobertura H3, localidades, conductores ni autorizados.

## Recogida y enlace de Maps

El resumen conserva el punto compartido con cinco decimales y agrega un enlace clicable construido desde las coordenadas nativas del mensaje:

```text
📍 Pasamos por ti en: Ubicación compartida (16.25637, -92.12810)
🗺️ Ver ubicación en Maps: https://maps.google.com/?q=16.25637,-92.12810
```

Una ubicación escrita no sustituye el GPS obligatorio de recogida. El enlace sólo aparece si el borrador tiene ese punto GPS y apunta a las coordenadas que el servidor recibió y validó.

## Destino y consentimiento

Después del GPS de recogida, el bot pregunta a dónde va el pasajero antes de mostrar la tarifa y el resumen. Puede escribir el destino o compartir otro punto; si todavía no lo sabe, el botón vigente **«Se lo digo al chofer»** deja que continúe sin destino. El backend valida que esa elección corresponda a la pregunta actual y no sea una pregunta, una cita, un botón viejo o una corrección mezclada.

El servidor consulta la tarifa vigente antes del resumen. El viaje sólo comienza al tocar **«Confirmar viaje»** del resumen actual. Una respuesta escrita como «sí» no reserva. Los cambios de destino invalidan el resumen y su consentimiento anteriores.

## Respuestas naturales con estado

El intérprete puede identificar una duda junto con un cambio del recorrido. La etapa de respuesta recibe el historial reciente acotado, la fase persistida y los datos que siguen pendientes. Primero contesta la duda con los hechos disponibles y luego continúa con el siguiente dato necesario: ubicación GPS, destino o nombre. Una respuesta no puede omitir ese paso ni borrar el botón o la ubicación nativa que controla el servidor.

La IA puede explicar reglas conocidas —por ejemplo, que el GPS es necesario para ubicar la puerta o que el destino puede indicarse al chofer— y reconocer cuando un dato no está confirmado. No puede inventar tarifas, horarios, métodos de pago, disponibilidad, llegada o asignación. El servidor conserva precios, estados, cobertura, expiración, idempotencia y confirmación. Si el modelo no responde o produce algo inválido, el coordinador usa una respuesta segura y conserva el paso pendiente; esa vía es recuperación ante una falla del proveedor, no una respuesta normal del modelo.

La traza registra la interpretación validada y la composición de respuesta con hashes, fase y resultado. No almacena razonamiento interno ni la respuesta cruda del proveedor.

## Verificación

- Control estático: **93 archivos**, sin `any`, conversiones dobles ni supresiones.
- Tipado: los cinco puntos de entrada Deno, el panel y las pruebas pasaron sus comprobaciones estrictas.
- Recorrido local completo: **5,852 pruebas Deno y 123 pruebas Node/PostgreSQL**, todas aprobadas; incluye consentimiento de destino, botón vencido, lote mixto, cambio de datos, resumen GPS/Maps y restauración del contexto tras una duda.
- Producción: las cuatro funciones SQL modificadas y el estado del canal se comprobaron antes y después; el historial registra la migración. Los paquetes Edge se descargaron y compararon después del despliegue. El worker quedó en línea.
- No se enviaron mensajes de prueba ni se crearon viajes reales. La evaluación sintética con el modelo real no se ejecutó desde esta PC porque `DEEPSEEK_API_KEY` no está configurada en el entorno local; los tests de conversación verifican los estados y los límites del generador, no miden precisión del modelo. Hace falta revisar el próximo intercambio real de WhatsApp para confirmar el tono generado.

Respaldo y manifiestos privados del despliegue: `.codex-tmp/taxi-dialogue-20261030/` (excluidos de Git), incluidos los paquetes previos/posteriores, instantánea SQL, estado del canal, hashes, manifiesto, logs de publicación y plan de restauración.
