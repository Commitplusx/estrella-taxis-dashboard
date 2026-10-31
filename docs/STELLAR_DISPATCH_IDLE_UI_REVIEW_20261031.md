# Revisión de código de la UI: GPS y tiempo detenido — 2026-10-31

El cierre de `dispatch_policy_finish_reviewer` requiere **recaptura**: los dos hallazgos de código están resueltos, pero faltan capturas actuales. Este documento registra evidencia de fuente y pruebas; no concede un **SHIP visual**, una aprobación de toda la superficie ni acredita un despliegue.

## Alcance y política confirmada

La intervención sigue en el comparador existente de `/map`, conforme a `PRODUCT.md` y `.impeccable/surfaces/src-pages-mappage-tsx.md`. El usuario autorizó excluir unidades que lleven **más de 30 minutos continuamente detenidas**, incluso si siguen enviando puntos GPS nuevos. Una unidad libre y elegible puede entrar con GPS de **hasta 30 minutos**, siempre que cumpla las demás condiciones de asignación.

Son dos relojes independientes: la antigüedad del punto se calcula con `fixTime`; la detención continua procede del estado de movimiento. En `dispatchPolicy.ts`, ambos límites son de 1800 segundos y la exclusión usa `>`: exactamente 30 minutos no activa por sí solo ninguna de estas dos exclusiones. La validación compartida exige `valid === true`; una fecha reciente no vuelve utilizable un punto inválido.

El puente tiene un temporizador duradero en `deployment/stellar/wialon-bridge/motion.cjs`, integrado por `patch-motion.cjs`. La fuente conserva el inicio de la detención y persiste el estado mediante escritura sincronizada y renombrado. Reimportar el mismo punto o reiniciar el proceso no debe reiniciar ese intervalo. Esta inspección acredita el mecanismo en código, sin sustituir la evidencia operativa que mantiene la tarea principal.

## Delta de UI comprobado en fuente

| Ruta | Comportamiento actual en código |
| --- | --- |
| `src/components/TaxiSimulationPanel.tsx` | Añade el selector «Tiempo detenido» con 15 minutos, 30 minutos y más de 30 minutos; el caso rápido «Detenido más de 30 minutos» usa GPS recién actualizado, 1801 segundos detenido y velocidad cero. La tabla añade «Detenido al menos». Las opciones de antigüedad distinguen 1800 de 1801 segundos y la explicación separa ambos relojes. |
| `src/lib/fleetMapPresentation.ts` | Consulta la política compartida y representa GPS antiguo, detención excesiva o GPS inválido con gris `#94a3b8`. La etiqueta explica «GPS con más de 30 minutos», «Detenido más de 30 minutos» o «GPS no utilizable» según el motivo. El color no sustituye la explicación. |
| `src/pages/MapPage.tsx`, popup de escritorio | «Último punto GPS» usa `pos.fixTime`. Se muestra el motivo que impide ofertas y la duración «Detenido al menos» cuando existe un inicio conocido. La insignia «EN VIVO» requiere conexión y ausencia de problema de telemetría. |
| `src/pages/MapPage.tsx`, ficha móvil | Usa también `pos.fixTime`, los avisos de exclusión y la duración detenida. «EN VIVO» queda condicionado por la misma comprobación de telemetría. El tiempo de recepción del servidor no se utiliza como edad del punto en esta ficha. |
| `src/pages/MapPage.tsx`, marcadores | Tanto la creación como la actualización imperativa pasan `fixTime`, atributos y el indicador `valid` a `fleetMarkerHtml`; los popups pasan también `pos.valid` al evaluador común. Este solo acepta el valor booleano `true`. |

Las etiquetas de motivos de `simulationContracts.ts` también distinguen GPS de más de 30 minutos y detención de más de 30 minutos. La decisión de asignación continúa perteneciendo al servidor; la UI permite escenarios hipotéticos y presenta razones.

## Hallazgos de código y disposición

| Hallazgo del revisor | Corrección comprobada | Disposición |
| --- | --- | --- |
| La ficha móvil conservaba el texto y la hora anteriores a la política nueva. | Se alineó con escritorio: `fixTime`, «Último punto GPS», aviso de exclusión, duración detenida y supresión de «EN VIVO» cuando la telemetría no es utilizable. | Resuelto en fuente. Render pendiente. |
| Faltaba propagar la validez del punto a la presentación. | Los llamadores pasan `pos.valid`/`p.valid`; `taxiTelemetryIssue` requiere `valid === true` antes de aceptar antigüedad y movimiento. | Resuelto en fuente y cubierto por comprobaciones enfocadas. Render pendiente. |

## Evidencia de pruebas y sus límites

Resultados observados por la tarea principal; esta pasada documental contrastó las fuentes y los resúmenes de logs locales, sin volver a ejecutar las suites:

- Después de las dos correcciones: comprobación estricta de tipos de `MapPage`, 194 pruebas Deno aprobadas y 9 pruebas Node del mapa aprobadas, sin fallos. Resúmenes en `.codex-tmp/idle-review-tests.log` y `.codex-tmp/idle-review-node.log`; la comprobación de tipos está en `.codex-tmp/idle-map-types.log`.
- Antes de esas dos correcciones: suite completa Deno con 22822 aprobadas y 0 fallos, y 50 pruebas Node aprobadas, según la verificación de la tarea principal. El resumen Deno está en `.codex-tmp/idle-full-deno.log`. La secuencia importa: esas ejecuciones completas no se presentan como posteriores a las correcciones finales.

Las pruebas de código no acreditan legibilidad, ajuste visual, ausencia de solapamientos o comportamiento real del navegador en todos los tamaños.

## Herencia y pendiente visual

Se conserva el mundo visual existente: OpenStreetMap, símbolos de vehículos, controles Lucide, Inter, superficies blancas/grises y acciones azules. Las fuentes `taxiBotAdmin.css`, `fleetMap.css`, `taxiSimulation.css` e `index.css` mantienen el lenguaje del administrador y la composición de drawer/hoja inferior. El gris semántico de la telemetría y los textos nuevos se registran como cambios de esta superficie, sin convertirlos en tokens o reglas globales nuevos.

El acceso al navegador estaba **deshabilitado en Work** durante esta verificación y el usuario aún no lo había reactivado. No se obtuvo una captura de la versión actual ni se inspeccionó su render. Las imágenes existentes `.impeccable/review/map-*.png` corresponden al **commit anterior**: conservan su valor histórico y no prueban este delta. El SHIP limitado del documento anterior tampoco se extiende a la política y UI actuales.

Cuando vuelva a estar disponible el navegador, queda pendiente recapturar escritorio, el ancho real del usuario y móvil, incluyendo el selector/caso/columna nuevos, motivos de telemetría, duración detenida y ausencia de «EN VIVO» en datos no utilizables. Debe comprobarse el render de los estados de 30 minutos y más de 30 minutos. Hasta entonces se mantiene la disposición de recaptura, sin aprobación visual global.

Esta pasada documental solo escribe este archivo; no modifica `PRODUCT.md`, la dirección de superficie, el registro visual anterior ni documentación global. `DESIGN.md` y `.impeccable/design.json` continúan ausentes; esa carencia previa no se repara ni se rellena con un sistema inventado. La evidencia de despliegue y operación se documenta por separado en la tarea principal. No se copian capturas, telemetría privada ni datos de clientes a este registro.
