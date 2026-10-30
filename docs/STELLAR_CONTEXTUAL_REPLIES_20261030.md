# Conversación contextual del taxi

**Actualización vigente:** [GPS obligatorio de recogida y confirmación sólo por botón](STELLAR_GPS_BUTTON_FLOW_20261030.md). La última indicación del usuario sustituyó la recogida sólo por dirección escrita. Los ejemplos y versiones siguientes documentan la etapa anterior.

## Incidente y causa

En el canal de Pompeyo, el turno de `2026-10-30T19:32:58Z` esperaba el origen, sin viaje activo ni origen o destino resueltos. La respuesta «Pilita seca» se clasificó como `ambiguous`; el coordinador respondió con una pregunta sobre cambiar o cancelar un viaje. El contrato anterior tenía hash `da637618ef3e6372dd496efed8dc4c5579528cdc517174cf7d0da5d942bba533`.

La regresión se reprodujo antes del cambio: seis pruebas de aclaración contextual/nombre fallaban. La evidencia local privada conserva sólo los datos necesarios para diagnosticar el estado, sin publicar contacto ni conversación completa.

## Interpretación y autoridad

La IA recibe la fase derivada del estado persistido, `expectedField`, el borrador y el historial reciente acotado. Puede proponer recogida, destino y nombre en cualquier orden, interpretar respuestas cortas, corregir datos y consultar tarifa o estado. Cada propuesta nueva debe citar evidencia literal del mensaje actual. Las instrucciones incluyen ejemplos de colonia, referencia, nombre coloquial, dos extremos juntos, corrección posterior y alternativas sin resolver.

Ejemplos:

- Si el bot preguntó dónde recoger, «Pilita seca» propone el origen. Si sólo ubica el barrio, el backend pide calle o referencia antes de asignar; el pin es opcional.
- Después de «Ubico Pilita Seca, ¿qué referencia?», «frente a la cancha» complementa ese extremo sin borrar el destino.
- Si espera origen y el pasajero dice «Voy a Terminal», el destino explícito prevalece y el origen sigue pendiente.
- Si espera el nombre, «para Mariana» responde esa pregunta sin exigir «A nombre de…».
- «Centro o Terminal, todavía no sé» exige aclaración; no elige un lugar.

La IA no tiene herramientas para reservar, asignar, cobrar, cancelar o terminar viajes. El coordinador, la máquina de estados y las RPC siguen validando resumen vigente, consentimiento, tarifa, cobertura, aislamiento de base, disponibilidad del conductor e idempotencia. Sólo el conductor con la oferta aceptada puede finalizar mediante la acción vigente; los estados terminales no se reabren. Los cierres por vencimiento y límites de búsqueda permanecen a cargo del backend. Una consulta de precio no confirma un taxi.

Si falla el intérprete o no distingue el dato, el coordinador conserva lo capturado y pregunta por el campo pendiente; no cambia a una pregunta genérica sobre cancelar. Invalida el resumen anterior antes de pedir aclaración. La búsqueda semántica recibe también la categoría de cada localidad para distinguir nombres repetidos.

## Verificación

- 4,936 pruebas Deno de conversación, herramientas, estado, proveedores y contratos aprobaron con tipos habilitados.
- 24 pruebas enfocadas de respuestas contextuales y localidades aprobaron, incluido el catálogo semántico con categorías.
- 87 pruebas transaccionales SQL y 22 contratos de separación, cobertura, caché, sesión y configuración aprobaron; también el tipado estricto del panel y de las pruebas, el control estático y el build.
- Ocho casos sintéticos con el modelo real `deepseek-chat` aprobaron. Esto es una evaluación funcional de ejemplos conocidos, no entrenamiento de pesos ni una medida ciega de precisión.
- Nuevo hash del contrato: `0da2ba84f613bcb181b93e6f24a55e091c4ed7e31d763482caf67daadd380e11`.
- La evaluación real usó una función temporal con casos fijos y autenticación del worker. Se eliminó al terminar. No creó viajes ni envió WhatsApps.

## Destino y publicación

El destino de producción es exclusivamente `izrsxygazsalfhpaualj`, fijado en `deployment/stellar/project.json`. El proyecto `ynqphaxvoauzmqsempis` es antiguo e inactivo y figura entre los destinos bloqueados. El dominio público y los eventos reales se comprobaron en el destino correcto antes de preparar la publicación.

Los respaldos de las tres funciones activas y las tarifas previas están en `.codex-tmp/taxi-context-20261030/`. Sólo se empaqueta el cierre de dependencias revisado de `ycloud-webhook`, `process-queue` y `taxi-bot-admin`. El manifiesto compara los archivos con los descargados de producción; no incluye el worker de Robin’s ni otras funciones del monorepo.

Publicado el 30 de octubre de 2026: `ycloud-webhook` v17 y `process-queue` v17, `taxi-bot-admin` v24. Los 24 archivos ejecutables de cada función, descargados después de publicar, coinciden con el paquete revisado. OPTIONS respondió 200 en las tres funciones; el administrador sin credenciales respondió 401. La migración `20261031160000` se aplicó y registró: 191 localidades escritas, cobertura de 2,541 hexágonos y restauración exacta de las 293 tarifas afectadas por el antiguo cruce de fuentes. El canal de Pompeyo continúa activo.

Evidencia local: `published-verification.json`, `after-evidence.json`, `model-eval.json`, `sql-checks.log`, `node-contracts.log`, `contextual-final.log` y `full-checks.log` en la carpeta de respaldos indicada. El primer recorrido completo detectó una incompatibilidad del montaje de pruebas con la importación histórica; se corrigió la preparación del escenario, conservando intacta esa migración y ejecutando de nuevo las 87 pruebas. Una prueba aprobada no acredita un envío físico de WhatsApp.
