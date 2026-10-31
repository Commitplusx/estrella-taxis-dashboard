# Asignación por rondas y recuperación de WhatsApp

> Actualización del 31-10-2026: [la ocupación desconocida ya no se convierte en libre y queda excluida del despacho](STELLAR_GPS_OCCUPANCY_20261031.md). Las cifras y versiones anteriores se conservan como historial.

Motor `taxi-bot-v22-dispatch-rounds`, proyecto independiente `izrsxygazsalfhpaualj`. Este documento sustituye el estado de publicación del documento anterior de recuperación de conversación en lo relativo a las tres funciones afectadas.

## Flujo y garantías

El botón vigente del cliente sigue siendo la única entrada para crear el viaje. PostgreSQL conserva el viaje, la primera ronda y sus avisos en la misma transacción. Si la consulta de GPS falla después de validar la confirmación, la solicitud confirmada queda guardada para búsqueda posterior; no se inventa una unidad ni se borra la petición.

La selección usa el `headingMatcher` existente con las ubicaciones de Traccar. Antes de elegir las primeras tres unidades, una RPC excluye conductores inactivos, de otra base, sin WhatsApp válido, ocupados en un viaje y previamente contactados en esa solicitud. Se conservan los controles existentes de antigüedad del GPS y orientación. No se promete que cualquier taxi físicamente cercano sea elegible.

Cada solicitud admite hasta cuatro rondas de tres ofertas, sin repetir unidades. Una oferta dura 90 segundos. Cuando todas se rechazan o revocan, la siguiente ronda puede iniciarse antes; si expiran, se buscan otras unidades. La primera aceptación válida gana mediante los bloqueos y transiciones existentes de PostgreSQL. Una aceptación vieja, una cancelación o una asignación previa impiden crear nuevas ofertas.

La cola `taxi_bot_dispatch_jobs` es duradera. El worker reclama hasta dos búsquedas por turno, con lease de dos minutos y consulta GPS acotada a 20 segundos. Un resultado de un lease vencido no crea ofertas. No se reintenta a ciegas un commit cuya respuesta se perdió: se recupera desde el estado persistido. Hay un máximo de doce consultas por solicitud y tres fallos consecutivos de consulta antes de revisión. La caducidad general de doce minutos permanece a cargo de `taxi_bot_maintain`.

Al agotarse los límites, la solicitud pasa a atención de la base y se genera un único aviso al cliente en outbox. No se inventa una notificación enviada a una persona: la revisión aparece en **Bot de WhatsApp → Conversaciones → Asignación de viajes**. El estado de búsqueda también comunica esta situación al cliente cuando pregunta.

## Fallos de WhatsApp

Cada aviso conserva su identidad y resultado en outbox. Aceptación del proveedor, entrega y lectura son estados distintos. Un fallo definitivo de una oferta revoca esa oferta y permite continuar cuando las demás terminan. Un envío incierto nunca vuelve a pendiente ni se reenvía automáticamente.

Errores de conexión, autorización, límite o resultado incierto abren una pausa de dos minutos para el canal. Fallos de una misma tanda no se cuentan como incidentes independientes: hay un intervalo mínimo de 30 segundos entre incrementos. Al alcanzar tres incidentes dentro de la ventana de diez minutos, se exige revisión y reanudación administrativa. Un éxito antiguo en vuelo no borra una pausa posterior.

Antes de iniciar cada envío se vuelve a comprobar el estado. Sólo una reclamación que todavía no se envió puede volver a pendiente cuando el canal se pausa; el permiso excepcional queda limitado a su ID, lease y esa transición. Reanudar requiere permisos de configuración de la base, revisión vigente e identificador idempotente. No altera mensajes inciertos. La interfaz mantiene el mismo identificador si se pierde la respuesta y libera la operación cuando el servidor confirma un conflicto de revisión.

Las nuevas tablas tienen RLS y ningún acceso directo desde clientes públicos. Las seis RPC externas se conceden únicamente a `service_role`; el endpoint administrativo verifica sesión, base, canal y permisos. Las consultas del panel se limitan a 50 solicitudes y se actualizan cada 15 segundos mientras la página es visible. Un error detiene la consulta automática y permite actualizar manualmente.

Los avisos interactivos extensos se conservan como texto completo y control corto en mensajes separados. Comparten las comprobaciones de vigencia de la oferta; no se recortan los datos para hacer pasar el límite del proveedor.

## Verificación

Se agregaron 38 pruebas Deno de contratos, worker y administración y 16 casos transaccionales de PostgreSQL ejecutados localmente con PGlite. Cubren rechazo, expiración, revocación, recuperación de lease, cancelación durante la búsqueda, límites, GPS fallido, pausa, exclusión previa al top tres, permisos, reanudación idempotente y mensajes inciertos. Los dobles de proveedores declaran su resultado; estas pruebas no son llamadas reales a WhatsApp ni una medición de comprensión del modelo.

El control completo aprobó 22,517 pruebas Deno y 152 pruebas Node/PostgreSQL, tipado de los puntos de entrada, panel y pruebas SQL, y control estático de 104 archivos. Evidencia privada: `.codex-tmp/taxi-dispatch-final-full.log`. Después se precisó el caso de tenant inválido para comprobar un UUID malformado, por separado del límite de tamaño del lote; se repitió la suite de 38 contratos con tipado y el control estático, sin fallos. El detector mecánico de interfaz no produjo hallazgos. Se revisó el panel en escritorio y a 390 píxeles, con datos de diseño identificados como ejemplos; capturas en `.codex-tmp/dispatch-proof`.

## Publicación

La migración revisada es `20261031210001_taxi_dispatch_rounds.sql`. Se creó con la CLI y se ordenó después de la migración local anterior para evitar invertir la secuencia. Se ejecutó únicamente este archivo, dentro de su transacción, y después se registró como aplicado en el historial. No se ejecutó un push general de migraciones.

Se respaldaron definiciones y metadatos de PostgreSQL, y las tres funciones activas, en `%TEMP%/stellar-v22-dispatch-rounds/before`. Las definiciones inspeccionadas no cambiaron entre el respaldo y la publicación. El candidato aislado contiene sólo la clausura de dependencias revisada; no incluye cambios ajenos del directorio de trabajo. El endpoint administrativo sincroniza además `policy.ts` y `neighborhoods.ts` con las fuentes ya publicadas en el worker v35.

Estado comprobado en Supabase:

| Función | Versión | Estado |
| --- | --- | --- |
| `process-queue` | 36 | ACTIVE |
| `ycloud-webhook` | 36 | ACTIVE |
| `taxi-bot-admin` | 32 | ACTIVE |

Las tres respondieron HTTP 200 a OPTIONS después del despliegue. Se descargaron de nuevo a directorios separados y coincidieron los 78 hashes SHA-256 de archivos incluidos en sus bundles. La verificación de imports de ejecución confirma que los archivos omitidos sólo eran dependencias de tipos. Evidencia: `.codex-tmp/dispatch-release-verification.json` y `.codex-tmp/dispatch-rounds-release-manifest.json`.

La comprobación posterior confirmó la migración registrada, ambas tablas con RLS, seis RPC de servicio, cero permisos públicos sobre las nuevas tablas/RPC y la integración de la ronda inicial en `taxi_bot_commit`. En ese corte no había trabajos de asignación activos ni canales en pausa. PM2 reportó `stellar-taxi-bot` en línea, sin reinicios; no se cambió el consumidor del VPS.

El cambio de código se subió a `main` como `b550465`. Vercel confirmó el despliegue completado para ese commit. La web pública respondió HTTP 200 y cargó `/assets/TaxiBotAdminPage-BOtH8D2X.js`, con las acciones `dispatch_status`, `dispatch_resume` y el panel nuevo presentes. Su SHA-256 es `456b35b6fcc8354eacb0f7ac03653fd8893121fd1cadb7ef5fb55c91e6560fc4`, idéntico al de la compilación local hecha desde un checkout limpio del commit. Evidencia privada en `.codex-tmp/dispatch-github-status.json`, `.codex-tmp/dispatch-frontend-published.json` y `.codex-tmp/dispatch-frontend-build.log`. El último turno observado del consumidor del VPS reportó cero fallos.

La publicación de Supabase y la del panel se verificaron por separado. No se cambiaron secretos, números, conductores ni autorizados y no se enviaron mensajes de prueba a personas durante esta revisión. Queda pendiente la comprobación física de un viaje y su aceptación desde el WhatsApp de un conductor.
