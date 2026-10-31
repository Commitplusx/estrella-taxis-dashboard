# Aclaraciones naturales sin mezclar nombre, recogida y destino

Motor: `taxi-bot-v19-semantic-clarification`. Proyecto independiente: `izrsxygazsalfhpaualj`.

## Fallos reproducidos y cambio

Siete regresiones iniciales fallaron antes de editar ejecución. Al esperar una aclaración de Plaza Las Flores, el coordinador omitía al intérprete y añadía respuestas cortas como «Soy Jorge», «Voy para Hospital» o «Estoy en Pilita Seca» a esa plaza. También rechazaba «el nombre es Jorge» y una referencia válida seguida de una corrección de destino. Evidencia local: `.codex-tmp/taxi-semantic-clarification-before.log`.

La interpretación ahora siempre pasa por la ruta existente del modelo. El contexto de una localidad sin resolver se deriva del borrador duradero, sin depender de palabras exactas de la última respuesta del bot. El modelo distingue:

- Una referencia del mismo lugar: `destination.value=“Liverpool”` con evidencia literal y `refines=“Plaza Las Flores”`.
- Otro destino: «Me llevan al Hospital» propone Hospital sin `refines`; sustituye la plaza.
- Un nombre o un cambio de recogida: se aplica al campo correspondiente y conserva el otro extremo.

El servidor sólo combina una referencia si `refines` coincide exactamente con el lugar y extremo que siguen pendientes en esa sesión. Valida el límite combinado antes de aplicar cambios. Una propuesta vencida, otro extremo, un dato inválido o un fallo del modelo no generan consultas inventadas ni cambios parciales. Dar sólo el nombre no resuelve una localidad pendiente ni habilita el resumen. La respuesta puede redactarla la IA desde ese estado, conservando la aclaración que falta.

Las correcciones de campos independientes ya no se anulan entre sí. Tres casos adicionales reprodujeron una corrección mixta que podía rescatar un extremo anterior al contener también un nombre o el otro extremo; el validador comprueba primero si la corrección posterior afecta al propio campo. Evidencia: `.codex-tmp/taxi-mixed-correction-before.log`.

Se conservan GPS nativo obligatorio de recogida, destino opcional, precio verificado por el servidor y visible sólo cuando se solicita, y confirmación únicamente con el botón vigente. Las correcciones renuevan el resumen e invalidan el botón anterior. No cambia el algoritmo de asignación ni la tarifa de la base.

## Trazabilidad y pruebas

`trace-v1` de PostgreSQL conserva su contrato vigente de campos literales: el registro privado guarda `value/evidence`; el paso registra `proposed_destination_refinement` o `proposed_origin_refinement` y su hash abarca la propuesta completa, incluido `refines`. La localidad anterior sigue en la sesión/historial duradero. El texto completo de `refines` no se añade al objeto privado del contrato antiguo. No se amplía el SQL de producción para aceptar propiedades desconocidas.

La prueba SQL recorre destino ambiguo → nombre → referencia → otro destino → corrección de nombre → botón anterior rechazado → botón vigente. Comprueba el pin original, persistencia entre turnos, validez de la traza y cero viajes/ofertas antes del clic; después se crea un viaje y una oferta.

La suite fija `tests/fixtures/taxi-semantic-clarification.ts` tiene doce casos sintéticos. La evaluación final con `deepseek-chat` pasó 12/12, incluyendo referencia y nombre en mensajes separados y la última corrección de destino. Son regresiones de desarrollo con ejemplos relacionados en las instrucciones, no cohorte ciega ni precisión general. Reporte privado: `.codex-tmp/semantic-clarification-eval/model-final.json`. La reproducción local usa `evaluate-taxi-intents.ts --suite=clarification` y variables privadas del entorno, con límite de doce llamadas.

El evaluador remoto temporal sólo hizo interpretaciones sintéticas; no consultó clientes, creó viajes ni envió WhatsApps. Se elimina junto con su capacidad local después de cada evaluación.

## Publicación

Candidato preparado en un directorio aislado a partir del cierre de dependencias de `process-queue` y `ycloud-webhook`. La comparación con las funciones activas sólo encontró los siete archivos de taxis revisados. El mapa de importaciones se conserva. Respaldo previo: `%TEMP%/stellar-v19-semantic-clarification/before`.

Verificación final aprobada: 6,006 pruebas Deno, 128 pruebas Node/SQL, tipos de los entrypoints/panel/pruebas y control estático de 95 archivos. Log privado: `.codex-tmp/taxi-semantic-clarification-final.log`.

`process-queue` y `ycloud-webhook` publicados y activos en versión 33, conservando `verify_jwt=false`. Ambos respondieron HTTP 200 a OPTIONS antes y después. La descarga posterior verificó 50 hashes de dependencias entre ambos cierres, sin diferencias respecto al candidato probado. La ausencia del evaluador temporal se comprobó en la lista de funciones y su capacidad local fue retirada.

SHA-256 de los siete archivos modificados activos:

- `contracts.ts`: `d671f4e0cca7b0050738355d0ea06f7c9ba335055153ab7c741977439f522be6`.
- `coordinator.ts`: `bc9958c1a02eb8564470a574bf44ed05fcde69c71a5ee2b147b28cb4691dc72a`.
- `stateMachine.ts`: `d65f1622a8ec129ca43c1085b2931f2a013b5d6ba5fa6115b3bad7d39035f192`.
- `policy.ts`: `0bb4f5823775d74dfc2d55f21a6c4efa97f7d4373a37a2a647d0188fcc5c9242`.
- `interpreter.ts`: `bd9a3f119908f7be39067ecf408a46f1b2e14909b0667e2e2610533e895d78cf`.
- `conversationTools.ts`: `d9c83adab42195500e26bfa39f30479f55c87a5269ed6f7037df29e5bd86fd0e`.
- `trace.ts`: `ee1645a911029feba84bfd7e4df1c7115f21d9dc8cd775b2e575bbbee0763425`.

No se aplicaron migraciones, cambiaron secretos ni enviaron mensajes reales. Las pruebas sintéticas y de salud no sustituyen una prueba física de WhatsApp.
