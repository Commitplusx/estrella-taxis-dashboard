# Oferta de taxi: uno a la vez y un minuto para responder

> Sustituido por la última instrucción: [tres unidades simultáneas por ronda, tres minutos y decisión del cliente tras tres rondas](STELLAR_THREE_ROUND_BATCHES_20261031.md). Este documento conserva la entrega secuencial anterior como historial.

Publicado en Supabase independiente `izrsxygazsalfhpaualj`: migración `20261101001000_taxi_sequential_offers`, código `d963fbd` en `main`. Es un cambio SQL: worker/webhook permanecen en v48 y administrador en v37; no hace falta reinstalar la APK.

## Comportamiento

La ronda anterior creaba hasta tres ofertas simultáneas a partir de los candidatos ordenados por GPS. La ruta existente ahora elige sólo el primer candidato que siga siendo elegible. El viaje queda bloqueado frente a otra oferta mientras exista una vigente. Al vencer o rechazar, el siguiente ciclo vuelve a consultar GPS y excluye las unidades ya contactadas; no repite al mismo taxi para ese viaje.

Cada oferta nueva tiene 60 segundos de vigencia. El primer acuse satisfactorio del proveedor inicia un minuto completo para responder. Se usa el bloqueo del mismo viaje al actualizar ese plazo para coordinarlo con la ronda siguiente. Un callback posterior de entrega o lectura no prolonga el tiempo, no revive una oferta vencida ni acredita aceptación del chofer. Si el primer acuse llega después de vencer, la oferta no se reactiva.

Un rechazo explícito o un fallo definitivo de destinatario permite avanzar sin consumir el resto del minuto. Un resultado incierto o un fallo de conexión conserva la pausa del proveedor existente; no dispara reenvíos a ciegas. Las ofertas vigentes de otros viajes excluyen temporalmente a esa unidad de la selección. El bloqueo de filas de conductor se conserva para revalidar esta condición al crear la oferta.

Se conservan los límites de cuatro rondas, doce consultas y doce minutos de vida de la búsqueda. Ahora cada ronda exitosa contacta una unidad, por lo que hay como máximo cuatro unidades nuevas por búsqueda. Al agotar los intentos queda para revisión de la base; no se fabrica una asignación. Sólo el botón válido de aceptación del chofer asigna la unidad y genera el aviso al cliente.

## Mensaje al conductor

La oferta utiliza un solo mensaje interactivo con nombre del pasajero, enlace de Google Maps de recogida, referencia escrita si existe, destino y los botones **Aceptar viaje** / **No puedo**. Indica el minuto disponible para responder. Ya no muestra precio ni la descripción redundante «Ubicación compartida (coordenadas)». El enlace usa el GPS guardado; un destino escrito se conserva como texto, sin inventarle un punto de Maps.

Nombre, referencia y destino tienen límites de presentación para mantener el mensaje por debajo de 1,024 caracteres, con sus botones en el mismo envío. El cálculo interno de tarifa permanece intacto y el resumen normal al cliente sigue sin importe. No se modificaron mensajes que ya habían sido enviados antes de publicar.

## Evidencia y recuperación

Tres regresiones iniciales reprodujeron el envío a varios taxis y la falta de un plazo completo al recibir el acuse. Cinco casos finales cubren orden GPS, oferta única incluso ante una llamada repetida, espera hasta vencer, rechazo, primer acuse, callbacks repetidos, acuse tardío y texto acotado sin precio. También se ejecutaron 24 regresiones SQL de despacho/aceptación y 275 pruebas Deno del selector, bot y conversación, con tipos; control estático de 142 archivos aprobado. Las pruebas usan datos sintéticos y no enviaron WhatsApp ni crearon viajes en producción.

La suite SQL completa final terminó con **168 aprobadas y cero fallidas**, incluyendo confirmación, aceptación, avisos al cliente, turnos, roles, aislamiento e idempotencia. Las expectativas históricas de dos ofertas simultáneas se sustituyeron por una oferta y un intento de aceptación desde otro conductor, que debe rechazarse. La tarifa interna sigue comprobándose y almacenándose, mientras la oferta ya no expone su importe.

La migración se ensayó contra las definiciones activas en una transacción terminada en ROLLBACK. La publicación cambió únicamente cinco funciones, condicionada a sus hashes originales: oferta, inicio, finalización de ronda, elegibilidad y acuse de entrega. El readback coincide con el ensayo y conserva sus firmas y permisos. Consumidor y puente Wialon continúan activos; worker y webhook responden OPTIONS 200. Las ofertas previas no se recrearon ni se alteraron sus plazos.

Se evaluó la expresión exacta de la plantilla activa con el viaje más reciente, mediante SELECT sin llamar al emisor: 208 caracteres, enlace de recogida presente, plazo de un minuto presente e importe ausente. Esta comprobación no envió otro mensaje al conductor ni demuestra su entrega en un teléfono.

Respaldos privados: `sequential-offer-before-private.json` y `sequential-rollback.sql`. Comparar primero hashes del sistema activo. Revertir sólo esas funciones y considerar que la versión anterior volvería a ofrecer a varios taxis. No restaurar viajes, contactos, turnos ni sesiones. La evidencia agregada está en `STELLAR_SEQUENTIAL_OFFERS_20261031.evidence.json`. La asignación física con la política nueva queda pendiente de una prueba del administrador.
