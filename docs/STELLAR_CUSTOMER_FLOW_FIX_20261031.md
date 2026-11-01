# Atención del cliente: guardado de solicitudes y destino escrito

Despacho posterior: [tres unidades simultáneas, tres minutos por ronda y elección de esperar o cancelar](STELLAR_THREE_ROUND_BATCHES_20261031.md). La recepción y el resumen de esta entrega se conservan.

Estado publicado: código `6eb1712` en `main`; `process-queue` y `ycloud-webhook` **v48 ACTIVE** en el proyecto independiente `izrsxygazsalfhpaualj`. El administrador continúa en v37. Migración puntual `20261031235900_taxi_trace_current_intents` aplicada y registrada.

## Silencio al pedir taxi

El mensaje y el pin habían entrado, pero el turno seguía en procesamiento sin respuesta en outbox. La consulta de producción demostró que `taxi_bot_trace_packet_valid` rechazaba `request`, una intención ya admitida por el intérprete. Tres regresiones reprodujeron el rechazo, incluido `taxi_bot_commit` con `invalid trace packet`, antes de corregirlo. El intento de registrar ese fallo usaba el mismo paquete incompatible; la sesión debía esperar a que venciera su lease.

El validador ahora admite `request` tanto en el paso de interpretación como en su propuesta privada. También admite `reference_conflict`, resultado existente del resolvedor. Se mantienen las validaciones de datos, límites, firma y permisos: valores inventados siguen rechazados y el validador conserva ejecución sólo para su propietario. La aplicación comprobó el hash de la función activa contra el respaldo y cambió únicamente esas listas; no reescribió sesiones ni viajes. La última respuesta de `/reset` del incidente se entregó por el procesamiento normal.

## Destino sin interrogatorio de tarifas

Se verificó en la traza que «Voy para plaza / En Liverpool» separaba erróneamente Liverpool como referencia de recogida. El intérprete debe asociar el complemento al destino que acaba de mencionar, conservando las palabras del cliente. Se añadieron ejemplos de nombre con destino fragmentado, detalle posterior al resumen y destino con una referencia explícita de recogida distinta.

Un destino escrito ya permite continuar al resumen. No se pide al pasajero escoger categorías internas como Cash A, ejidos o fraccionamientos. Si catálogo o geocodificador no ofrecen un resultado único, se conserva el destino literal y no se inventan coordenadas ni se elige una categoría arbitraria. La tarifa sigue consultándose en servidor: sin tarifa única de destino se verifica la de recogida y se registra `quoteBasis=pickup`, sin presentarla como precio total del recorrido. No se muestra importe salvo pregunta del cliente.

Un detalle posterior puede precisar el destino escrito vigente y sustituye el botón anterior. Se conservan el pin obligatorio de recogida, nombre, cobertura comprobable y confirmación exclusiva con el botón actual. Un destino GPS comprobado fuera de cobertura requiere revisión de la base. La ambigüedad entre dos puntos GPS o una corrección que no identifica qué extremo cambiar sigue necesitando aclaración.

## Verificación

- Antes del arreglo SQL: tres regresiones fallidas; después: las tres aprobadas y readback de producción aceptando los resultados soportados.
- Suite SQL completa del cambio del validador: **160 aprobadas**. Tras el ajuste de destino se ejecutaron **19 regresiones SQL** dirigidas, con el coordinador y los commits reales en PostgreSQL embebido. Incluyen destino ambiguo, proveedor sin resultado y conflicto de referencia; conservan texto, tarifa consultada y creación única sólo al tocar el botón actual.
- Suite Deno final: **22,838 aprobadas**, con comprobación de tipos. Entradas worker/webhook, prueba SQL y control estático de **142 archivos** aprobados.
- Modelo real `deepseek-chat`: **27/27** casos de lenguaje, incluidos tres nuevos, y **8/8** casos anteriores de recepción. Son casos sintéticos de desarrollo utilizados para ajustar instrucciones; no constituyen precisión ciega ni prueba física de atención.
- Se descargaron de nuevo ambas funciones: los **31 módulos** de ejecución de cada una coinciden por SHA-256 y ambas responden OPTIONS 200. Sólo cambiaron coordinador, intérprete y máquina de estados; se conservó la variante activa de autenticación de cada paquete.
- El evaluador temporal se eliminó y se verificó su ausencia. Estas comprobaciones no enviaron WhatsApp ni crearon viajes reales. El acceso continúa restringido al único autorizado terminado en **9156**.

Comprobación real posterior: el administrador confirmó que el resumen ya aparece correctamente. La lectura de backend conservó pin y nombre, Liverpool como destino y ninguna referencia de recogida con Liverpool. El resumen tenía el botón vigente, no mostraba categorías internas ni importe y WhatsApp lo reportó leído. Esta comprobación cubre recepción y resumen; no acredita una prueba nueva de oferta, aceptación del chofer ni asignación del viaje.

El algoritmo de asignación, el refresco de Wialon, el puente y la APK no cambiaron. Al confirmar se revalida la tarifa y se consulta la flota; sólo la aceptación real del chofer acredita asignación y habilita el aviso al cliente.

## Recuperación

Respaldos privados de v47: `destination-before`, aislados por función. La definición SQL anterior y la reversión están en `client-silence-trace-validator-before.sql` y `client-silence-trace-rollback.sql`. Antes de revertir, cotejar las funciones activas: restaurar el validador antiguo sin retirar el uso de `request` volvería a causar el silencio. No restaurar sesiones, listas de autorizados ni viajes para revertir código. Evidencia agregada en `STELLAR_CUSTOMER_FLOW_FIX_20261031.evidence.json`.
