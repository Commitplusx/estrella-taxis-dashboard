# Mensajes y ubicaciones en el mismo turno

Motor: `taxi-bot-v20-compound-turns`. Proyecto independiente: `izrsxygazsalfhpaualj`.

## Qué se comprobó

Se añadió una suite determinista de 16,326 casos, además de la matriz previa de estados, consentimiento y fallos. Su producto principal cruza dos papeles de ubicación, cuatro formas de indicar cada papel, ocho nombres, ocho lugares/referencias, seis órdenes de texto y cinco formas de recibir el pin. Otras 768 combinaciones cubren dos pines, etiquetas antes/después, orden inverso, posición del nombre y borrador previo. También verifica control humano, viaje activo, fallos del intérprete, negaciones, preguntas, citas y correcciones posteriores al pin.

Cada doble declara la propuesta exacta del intérprete. Las aserciones verifican nombre, extremos, identificador de GPS, estado pendiente, cotización, resumen nuevo, ausencia de asignación y conservación del estado al serializar. Esto comprueba el protocolo y sus invariantes; no representa miles de llamadas al modelo ni mide precisión de lenguaje natural.

La suite completa aprobó 22,335 pruebas Deno y 132 pruebas Node/PostgreSQL, incluidos los casos nuevos. El control estático revisó 98 archivos sin `any`, conversiones dobles ni supresiones. Pasaron también las comprobaciones de tipos de entrypoints, evaluadores, panel y pruebas SQL. Evidencia local: `.codex-tmp/taxi-compound-full.log`.

## Fallos encontrados y correcciones

- **Datos descartados junto al pin.** La ruta salía al reconocer un papel de ubicación y omitía el nombre, destino o referencia adyacentes. Ahora sólo una respuesta compuesta exclusivamente por el papel puede omitir la interpretación. Se conserva el pin reconocido y se interpretan los demás datos. Reproducción previa: `.codex-tmp/taxi-combinations-before.log`.
- **Etiquetas después del pin.** La segmentación sólo asociaba bien ciertos órdenes. Ahora acepta una etiqueta antes o después cuando existe exactamente una por pin y las parejas no cruzan otro pin. Ante una asociación incierta pide aclarar sin intercambiar los extremos. Reproducción: `.codex-tmp/taxi-two-pin-combinations-before.log`, 384 casos fallidos antes del arreglo.
- **Preguntas, negaciones y citas.** No pueden elegir el papel de un pin ni ocultar datos en una frase larga. La coincidencia que omite la IA debe cubrir la cláusula completa. Una corrección discursiva «No, ese es el origen» sigue siendo una elección explícita; «No me recoges aquí» no lo es.
- **Una corrección posterior perdía frente a un pin anterior.** Se ubica el valor dentro de su evidencia literal y del mensaje correspondiente; un punto recibido antes no sobrescribe la corrección textual posterior de ese mismo extremo. Cambiar la recogida deja pendiente un GPS nuevo. Evidencia previa: `.codex-tmp/taxi-late-pin-correction-before.log`, cuatro fallos.
- **La IA no veía los pines del lote actual.** El contrato interno pasa ahora una lista acotada de papeles y posiciones de los pines a través de servicios y trazas hasta el proveedor. No envía en ese campo coordenadas, teléfonos ni identificadores. El backend sigue asignando los puntos y comprobando cobertura.
- **«Esta dirección» borraba un pin pendiente ya identificado.** Una referencia deíctica al punto que acaba de elegirse no se geocodifica como dirección escrita. Al elegir el destino nativo se retiran texto anterior y omisión de destino que hayan quedado guardados.

Se mantienen pin nativo obligatorio para pasar por el pasajero, destino opcional, tarifa del servidor, precio visible sólo cuando se solicita, lista de autorizados y creación del viaje únicamente con el botón vigente. Ninguno de los miles de casos crea solicitudes reales.

## Modelo real y PostgreSQL

Se congelaron 24 recorridos sintéticos antes de consultar el modelo. La primera ejecución pasó 18/24: seis casos de dos pines perdían los datos porque el intérprete sólo veía texto. Al pasar el contexto del lote, pasó 23/24; el restante evidenció la pérdida del pin pendiente por «esta dirección». Tras esa corrección del backend, los mismos recorridos y expectativas pasaron 24/24 con `deepseek-chat`.

Reportes privados: `.codex-tmp/compound-turn-eval/model-first.json`, `model-context.json`, `model-final.json`. Son regresiones de desarrollo relacionadas con las instrucciones y casos inspeccionados, no una cohorte ciega ni una medida de precisión general. La reproducción local está en `estrella-taxis-backend/scripts/evaluate-taxi-compound-turns.ts`: 24 llamadas como máximo, dos simultáneas, una por caso y plazo acotado. Lee las claves exclusivamente del entorno privado y guarda resultados sintéticos en una ruta JSON indicada.

Cuatro recorridos adicionales de PostgreSQL verifican el lote con dos pines, la elección de un pin guardado y las correcciones posteriores de cada extremo. Se comprueba persistencia, prueba nativa del GPS, trazas válidas, cero viajes/ofertas antes del clic, rechazo de botones anteriores, un viaje/una oferta con el botón actual e idempotencia al repetir el commit.

El evaluador temporal remoto sólo ejecutó los recorridos sintéticos con autenticación independiente; no accedió a clientes ni envió WhatsApps. Se eliminó y su capacidad local se retiró después de evaluar.

## Publicación

Respaldo previo en `%TEMP%/stellar-v20-compound-turns/before`. El candidato aislado se construye con el cierre de dependencias de `process-queue` y `ycloud-webhook`. La comparación con producción sólo encontró los seis archivos de taxi revisados; se conserva el mapa de importación. No requiere migraciones, secretos nuevos ni cambios en el panel o el algoritmo de asignación.

`process-queue` y `ycloud-webhook` están activos en versión 34, conservando `verify_jwt=false`. Respondieron HTTP 200 a OPTIONS antes y después. Se descargaron las funciones publicadas y se verificaron 50 hashes de dependencias entre ambos cierres sin diferencias contra el candidato probado. La lista de funciones confirma la ausencia de `taxi-compound-eval` y su capacidad local fue retirada.

SHA-256 de los seis archivos modificados activos:

- `contracts.ts`: `e883b63a3c99f7f6d8e0c80ec4c947a8f7a80fa66d56aa410b274788180f4622`.
- `coordinator.ts`: `8e9a07cef9f63ddc85083e32fea56443f31d0cdea0f1f93b936abce8e1c68c02`.
- `policy.ts`: `7e05a4ee8a4f165b705ad1023c753584b67d289bc3253b3765be1816311a53ee`.
- `interpreter.ts`: `ce7f8ef3e2e148b3877761538bc36d3129664fdad55cfd2d83cc1f7700e2b25b`.
- `services.ts`: `a21b5abd2b5da5c7b7be64918bb1d4c443e9d7c9dcfe4b460c3c462fe78dc606`.
- `trace.ts`: `b253725de91377d5e0b62baa44cb5608b588359b5c1760226c753bf6a7b3e86f`.

No se aplicaron migraciones, cambiaron secretos ni enviaron mensajes reales. Las pruebas sintéticas y de salud no equivalen a una prueba física de WhatsApp.
