# Herramientas de conversación para taxis — 29 de octubre de 2026

> **Destino vigente:** [Stellar Tracking en Estrella orgs](STELLAR_ORGS_RELEASE_20261029.md), `izrsxygazsalfhpaualj`. Sustituye el destino anterior en Estrella envios. Bot deshabilitado; configuración privada bloqueada por revisión automática.

> **Estado posterior:** [Separación de la base y publicación del 29-10-2026](STELLAR_DATABASE_SEPARATION_20261029.md). SQL y cinco funciones están publicados en el proyecto independiente Stellar Tracking; consumidor instalado sin iniciar, canal/credenciales pendientes. Las notas siguientes conservan la evidencia del candidato antes de ese despliegue.

**Candidato local `taxi-bot-v3-tools`, sin publicar ni conectar el worker al canal real.** El número de Pompeyo está conectado al proveedor YCloud por coexistencia, según la comprobación anterior; eso no demuestra que este candidato esté atendiendo mensajes. Esta entrega adapta el patrón de herramientas de Robin’s al coordinador de taxis existente. No copia su carrito, promociones, cocina ni datos, y no crea otro bot o base de viajes.

## Ruta y responsabilidades

`ycloud-webhook` → firma/canal exacto → cola durable → `TaxiEngine` → inicio durable de traza → `createTaxiInterpreter` → `parseTaxiToolCompletion` → `parseInterpretation` → `coordinateTaxi` → `assertTaxiTransition` → `taxi_bot_commit` → viaje/ofertas/outbox.

El proveedor recibe herramientas de función, en vez del JSON libre de intención que usaba el candidato v2. El adaptador convierte **una sola propuesta completa** al contrato de intención/campos ya existente. El coordinador realiza las consultas permitidas y construye la respuesta; el modelo no recibe una herramienta SQL ni un endpoint que reserve directamente. Se conserva una única llamada al modelo por turno: no hay bucle de agentes ni segunda generación libre que pueda cambiar una tarifa o anunciar una unidad sin respaldo.

| Herramienta de la IA | Contrato existente | Ejecución del servidor |
| --- | --- | --- |
| `actualizar_recorrido` | `provide` + campos actuales con evidencia | Actualiza sólo los datos explícitos, resuelve lugares y prepara la revisión |
| `cotizar_viaje` | `quote` + campos actuales opcionales | Consulta la tarifa configurada; puede reutilizar el borrador sin volver a pedirlo |
| `consultar_mi_viaje` | `status` | Consulta el estado del viaje propio; no acepta otro teléfono/ID |
| `escalar_a_base` | `human` | Transfiere la conversación según el flujo persistido de atención humana |
| `saludar` | `smalltalk` | Saludo breve con los datos del canal |
| `aclarar_solicitud` | `ambiguous` | Pide aclaración e invalida el consentimiento pendiente |

El cambio de recogida, destino o pasajero sigue invalidando el resumen anterior. «No en Centro, mejor en Hospital. ¿Cuánto sale?» propone sólo la recogida nueva y consulta tarifa; conserva destino y pasajero. No se busca unidad hasta una confirmación posterior válida. Si cambia la tarifa antes de confirmar, se genera otra revisión. Los servicios especiales, cambios de un viaje activo y errores de flota conservan la derivación a la base existente.

Confirmación, cancelación explícita y botones de conductor siguen comprobándose en servidor, sin delegar el consentimiento al modelo. Los adaptadores antiguos `book_taxi` de `tools.ts` siguen inhabilitados para mutaciones y no fueron reactivados. El contrato de H3 y las transacciones SQL permanecen intactos: esta entrega no redefine qué recorridos tienen precio ni modifica reglas de asignación.

## Validación y límites

- Exactamente una opción de respuesta, terminada en `tool_calls`, rol `assistant` y una función permitida. Texto libre, respuestas truncadas, varias propuestas y herramientas desconocidas se rechazan íntegramente antes de consultar servicios.
- Argumentos como `unknown`; JSON válido, objeto con claves permitidas y evidencia literal de cada campo en el mensaje actual. Se conservan las comprobaciones de negación, condiciones, citas, alternativas y correcciones posteriores. Un campo inválido rechaza la propuesta entera.
- No se aceptan precios, coordenadas, IDs, teléfonos, tokens ni `confirmed` del modelo. No hay herramientas para reservar/cancelar/elegir conductor o ejecutar SQL.
- Mensaje actual de hasta 6,000 caracteres; historial de hasta seis entradas/4,000 caracteres; respuesta del proveedor de hasta 32 KiB; argumentos de hasta 12,000 caracteres; hasta 900 tokens de salida y petición de 15 segundos. Sin reintentos automáticos ni fallback al JSON antiguo.
- El contexto incluye nombre de base, ciudad, borrador, estado del viaje y ubicación pendiente. Omite tenant, WABA, ID de viaje y token de confirmación. Nombres/direcciones/historial siguen siendo contenido privado necesario para interpretar, no datos anonimizados.
- Un fallo usa la aclaración existente, conserva los datos y revoca el resumen vigente; nunca declara una reserva exitosa.

La solicitud usa Chat Completions de DeepSeek con `thinking.type=disabled` y `tool_choice=required`. La documentación oficial indica que `required` necesita desactivar thinking. No se añadió una dependencia SDK, modo beta ni framework. Referencias verificadas: [Tool Calls](https://api-docs.deepseek.com/guides/tool_calls/) y [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/). La compatibilidad del modelo configurado todavía necesita evaluación real.

## Trazabilidad y calidad

`TAXI_BOT_VERSION` cambia a `taxi-bot-v3-tools`. El campo durable `promptHash` pasa a representar el contrato completo: instrucciones, esquemas, protocolo, elección de herramientas y parámetros versionados. No reutilizarlo como si sólo identificara el texto del prompt v2.

`responseHash` identifica contenido/herramientas observables, incluyendo nombre y argumentos de la propuesta; no incluye `reasoning_content`. La traza conserva intención/campos validados, consultas realmente ejecutadas y resultado del commit con el mismo esquema SQL v1. Las comparaciones entre v2 y v3 deben separar versión/contrato. No se entrenaron pesos ni se usaron respuestas propias como etiquetas.

El evaluador acotado existente sigue usando sus doce fixtures sintéticos conocidos, ahora atravesando las herramientas. Su reporte incluye `contractHash`. Esos fixtures son regresiones, no prueba ciega ni una medida de comprensión real. No se ejecutó contra DeepSeek: no había `DEEPSEEK_API_KEY` en el entorno del proceso; no se leyeron archivos privados para obtenerla.

## Evidencia local

- Antes del cambio: runner completo aprobado, **4,782 Deno + 45 SQL/PGlite**. Log `.codex-tmp/taxi-tools-baseline.log`.
- Discrepancia conservada: dos pruebas fallaban porque el intérprete no ofrecía herramientas y rechazaba una corrección válida en ese protocolo. Log `.codex-tmp/taxi-tools-before.log`.
- Se añadieron **53 pruebas** de contrato/proveedor/coordinador. Incluyen propuestas múltiples, campos inventados, contaminación por historial, consentimiento falso, IDs ajenos, contexto acotado, fallo del proveedor, corrección + precio, estado propio, control humano y trazabilidad.
- Las pruebas previas del intérprete/traza ahora usan el formato de función sin rebajar sus expectativas de truncamiento, evidencia, uso observado y hash. El recorrido SQL existente ahora utiliza el decodificador real de herramientas con proveedor simulado explícito: firma → cola → revisión → confirmación → una reserva → ACK → aceptación del conductor; comprueba además versión/hash persistidos y reentrega sin segunda inferencia/reserva.
- Resultado final del runner: **4,835 Deno + 45 SQL/PGlite = 4,880 aprobados**; gate de 39 archivos y tipado de los entrypoints. Log `.codex-tmp/taxi-tools-final.log`. Son contratos y simulaciones; no 4,880 conversaciones reales ni inferencias del modelo.

Respaldo previo de nueve fuentes y hashes en `.codex-tmp/taxi-tools-before-20261029/`. Manifiesto de esta entrega: `TAXI_BOT_TOOLS_EVIDENCE_20261029.json`. Las fuentes ajenas y cambios previos del checkout se conservaron.

## Publicación pendiente

No se publicaron SQL, Edge, worker, GitHub ni VPS, no se modificó Robin’s ni se enviaron WhatsApps o solicitudes reales. No hay migración adicional; el despliegue sigue requiriendo las cuatro candidatas anteriores en orden: `20261027220000`, `20261027223402`, `20261028145826`, `20261028160342`. Publicar todo el protocolo revisado, incluyendo `conversationTools.ts`, antes de activar el consumidor.

Antes de habilitarlo: comparar esquema/fuentes activos, respaldar y ensayar las cuatro migraciones, configurar base/canal y sus zonas revisadas, ejecutar la evaluación acotada con el modelo elegido y hacer un recorrido autorizado con teléfonos propios. Cambios de prompt y esquemas deben evaluarse conservando procedencia y una cohorte prospectiva separada. La aceptación del proveedor, entrega/lectura y aceptación del conductor siguen siendo evidencias distintas.
