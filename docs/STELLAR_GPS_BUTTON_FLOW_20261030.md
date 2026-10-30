# Conversación natural, GPS de recogida y confirmación explícita

**Actualización posterior:** [Comprensión natural y conservación de datos](STELLAR_LANGUAGE_HARDENING_20261030.md), motor v8, modelo evaluado con 58 casos y funciones v20/v20/v26. Las reglas de GPS y confirmación descritas aquí se mantienen; los hashes y versiones siguientes registran la publicación anterior.

## Regla vigente

La última decisión del usuario exige **pin GPS nativo de recogida**. Una dirección escrita se conserva como referencia y no sustituye ese pin. El destino es opcional: puede enviarse por escrito, por ubicación o indicarse después al conductor. Esta decisión sustituye las instrucciones anteriores que permitían recoger sólo con calle y referencia.

El viaje se registra exclusivamente al recibir el botón nativo **Confirmar viaje** correspondiente al resumen vigente. «Sí», «mándalo», una intención propuesta por el modelo, un botón anterior o un lote que mezcle clic y corrección no autorizan la reserva. La confirmación caduca a los diez minutos. Cada cambio invalida el resumen anterior.

## Conversación y estado

La IA interpreta los mensajes en cualquier orden usando la última pregunta, el borrador y el estado persistido. «Voy a / voy pa la Pilita Seca» propone el destino; «mándame un taxi a / estoy en / te espero en El Piedrón» propone el lugar de recogida escrito. Una referencia visual como «es el portón azul» complementa un pin recibido; cambiar la dirección de recogida exige un pin nuevo. Cada dato propuesto debe citar evidencia literal del mensaje actual, respetando correcciones posteriores y alternativas aún sin resolver.

La máquina de estados deriva la fase: recogida, aclaración del pin, nombre, revisión, búsqueda, viaje activo o atención humana. `taxiProgress` entrega al intérprete los hechos actuales y los faltantes: GPS de recogida, nombre del pasajero y tarifa verificada del servidor. El modelo no elige la fase ni puede reservar, asignar o cerrar viajes.

La IA también puede redactar una pregunta breve para el dato que el servidor ya determinó que falta. Esa llamada no tiene herramientas de negocio; su respuesta se valida, tiene un único intento de cinco segundos y vuelve a la pregunta canónica si falla o incluye precios, promesas o afirmaciones de reserva. Las preguntas canónicas también exigen el pin de recogida. El resumen, los importes, los botones y los mensajes de estado siguen generados por el servidor.

Ejemplo:

1. «Oye, voy a la Pilita Seca» conserva el destino y pide el pin de recogida.
2. El pasajero comparte el pin; si falta su nombre, el bot lo pregunta.
3. El servidor consulta la tarifa y presenta el resumen con el botón vigente.
4. Escribir «sí, mándalo» vuelve a mostrar el resumen; tocar el botón inicia la búsqueda una sola vez.

## Tarifas y GPS

Antes del resumen y de confirmar, el backend consulta y valida el precio. La recogida usa su H3; un destino escrito reconocido usa el directorio de localidades propio de la base, sin modificar hexágonos. Los precios se vuelven a comprobar al pulsar el botón. Un precio ausente, inválido o no consultable deriva a la base, conservando los datos capturados y sin crear viaje.

Cuando sólo se conoce la recogida, se muestra expresamente una **estimación de la zona de recogida** y que el destino se confirma con el conductor. Un destino escrito aún sin resolver se conserva como texto y no se presenta como un recorrido ya cotizado. No se inventan coordenadas para un destino opcional.

PostgreSQL comprueba que el pin procede de un evento nativo del mismo canal, base y pasajero, con el mismo identificador del proveedor y coordenadas; el evento debe estar en proceso o completado y no tener más de 24 horas. La RPC de confirmación comprueba además el clic actual, revisión, tarifa y alcance antes de crear viaje, oferta o notificación. Conserva las protecciones existentes de concurrencia, reentrega e idempotencia.

## Memoria y revisión

Los eventos entrantes, la sesión y las decisiones se guardan en el backend por base/canal/contacto. La sesión mantiene los últimos doce mensajes de contexto; cada interpretación recibe hasta seis, con un máximo de 4,000 caracteres, además del borrador y los faltantes estructurados. El historial extenso de eventos y las trazas privadas permiten revisar el recorrido sin cargar toda la conversación en cada llamada.

La traza registra fase anterior y propuesta, intención validada, campos, consultas, errores, tiempos, hashes y versión del contrato. No registra razonamiento interno del modelo. El apartado de calidad conserva revisión supervisada; las respuestas del bot no se convierten automáticamente en entrenamiento.

## Verificación

- El paquete completo aprobó 5,734 pruebas Deno con tipos y 111 pruebas Node, incluidos contratos y transacciones SQL; también el tipado estricto del panel y pruebas, los puntos de entrada y el control estático.
- La revisión final añadió una prueba de permisos reales del rol servidor para el destino escrito geocodificado. Primero reprodujo el fallo; después comprobó la cotización sin conceder lectura directa de localidades ni ejecución a `anon`/`authenticated`.
- Tras corregir la pregunta canónica de respaldo, aprobaron 73 pruebas de GPS, conversación, localidades y flujo natural, además del control de calidad y los tres puntos de entrada. La regresión se conservó en `gps-canonical-before.log`.
- 26 casos sintéticos declarados con el modelo real y dos preguntas naturales aprobaron. Se usaron durante el ajuste de instrucciones: **no son una cohorte ciega, una medida de precisión general ni entrenamiento de pesos**.
- Contrato evaluado: `e4430118a424026ab166a7ac4d2b7e4fe01f92d246034149a835c9c3bc4b31a7`. Casos: `73be89aece1b2877122d3b8e3554de2c1b30952fb2f3fe31297a2af525207354`.

## Publicación comprobada

Producción: `izrsxygazsalfhpaualj` (Stellar Tracking). Migraciones aplicadas y registradas:

- `20261031170000_taxi_gps_pickup_button_booking.sql`: prueba de pin, tarifa obligatoria, destino opcional, botón exclusivo, fase y traza.
- `20261031173000_taxi_reference_quote_private_reads.sql`: cotización privada con referencias mediante RPC `SECURITY DEFINER`, `search_path` vacío y ejecución exclusiva para el rol servidor.

Funciones activas verificadas el 30 de octubre de 2026:

| Función | Versión | SHA-256 del paquete |
| --- | --- | --- |
| `ycloud-webhook` | 19 | `c06ef722d7ba620947c0616f8e85457b2cd4c796e2ec7cec3d4634e6bb5b52d1` |
| `process-queue` | 19 | `5719e96a5563847acd8f8c0e25d5de9c7e76bce1382de2f3824fd3cffc38088c` |
| `taxi-bot-admin` | 25 | `8e64de3ea04b61e79463974f071356ecbda995bcc27eeea15999d1ec05cf299f` |

Los 25 archivos ejecutables del webhook y consumidor, y los 24 del administrador, se descargaron y coinciden con el código revisado. OPTIONS respondió 200 en las tres funciones; el administrador sin credenciales respondió 401. El consumidor PM2 `stellar-taxi-bot` está en línea. La consulta remota con `service_role` devolvió la tarifa configurada de recogida y la del destino Pilita Seca, incluida su variante geocodificada con referencia.

Respaldos y evidencia local privada: `.codex-tmp/taxi-context-20261030/`. Incluyen definiciones SQL anteriores, descargas de funciones previas y finales, manifiesto de dependencias, `booking-release-checks.log`, `booking-model-final.json`, `final-function-versions.json` y `final-published-verification.json`. La función temporal de evaluación y su ejecutor remoto se eliminaron al terminar. Estas verificaciones no enviaron WhatsApps ni crearon viajes reales; falta un recorrido físico con pasajero y conductor.
