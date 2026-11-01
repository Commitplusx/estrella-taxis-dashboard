# Despacho: treinta minutos de GPS y de detención

Publicación posterior de conversación: [guardado de solicitudes y destino escrito](STELLAR_CUSTOMER_FLOW_FIX_20261031.md), worker/webhook v48. La política de GPS y detención de esta entrega no cambió; las versiones v45 descritas abajo son su publicación original.

La regla solicitada por Pompeyo permite taxis libres con GPS válido de hasta 30 minutos y excluye al taxi que lleva **más de 30 minutos detenido**, aunque siga enviando puntos nuevos. Al observar movimiento puede volver a competir. Siguen siendo obligatorios el turno activo, WhatsApp válido, ausencia de otro viaje, permisos del canal/plan, base y radio. Esta entrega no habilita turnos ni cambia teléfonos.

## Medición duradera

El puente conserva por identificador estable Wialon el último fix, velocidad, ancla y comienzo observado de la detención. `/root/wialon-bridge/state/taxi-motion.json` tiene modo 600; se guarda mediante temporal, fsync y rename. No contiene credenciales y permanece fuera de Git.

Velocidad mayor a 3 km/h o desplazamiento de al menos 50 metros respecto al ancla indica movimiento. No reinician el contador el jitter pequeño, un fix nuevo en el mismo lugar, reimportar un fix ni reiniciar el proceso. Un timestamp regresivo, contradictorio o adelantado más de 30 segundos falla explícitamente. El controlador existente conserva sus límites de tiempo y rechazo de importaciones incompletas; no devuelve sincronización exitosa cuando falla la medición.

El estado admite como máximo 1,000 unidades, elimina entradas no vistas durante siete días y rechaza archivos corruptos o de más de 512 KiB. Los atributos `taxiMotionVersion`, `taxiMotionFixTime`, `taxiMotionState` y `taxiStationarySince` se importan mediante OsmAnd junto al timestamp original `pos.t`. La hora de importación no demuestra movimiento ni señal nueva.

**Inicio de la observación:** no se reconstruyó el historial anterior a esta entrega. El primer fix detenido es el comienzo mínimo demostrable; por eso se muestra «Detenido al menos». Un fix antiguo de más de 30 minutos ya queda excluido. La telemetría anterior sin atributos de movimiento usa su propio fix detenido como límite inferior, nunca la hora de importación. Desde esta publicación la medición continúa y persiste.

## Selector y presentación

`dispatchPolicy.ts` concentra constantes y valida que el estado de movimiento corresponda al fix. El bot y simulador usan `selectTaxiCandidates`, con GPS de hasta 30 minutos tanto online como offline. Una conexión desconocida no autoriza despacho. Los llamadores genéricos de `findOptimalTaxi` conservan sus valores predeterminados; el bot declara su política explícitamente.

La orientación sólo penaliza a un taxi en movimiento si el fix tiene hasta dos minutos. Un rumbo viejo ya no añade 2 km a su prioridad. Se conserva el orden estable por distancia efectiva, distancia física e identificador; no se simulan rutas viales ni ETA. Rondas, aceptación, idempotencia y outbox existentes conservan sus contratos.

Se elige el último fix antes de validar: uno nuevo inválido ya no permite usar silenciosamente un fix válido anterior. No se acepta un falso «libre» sin la señal consistente del puente.

El simulador permite editar tiempo detenido y probar detención mayor a 30 minutos con GPS nuevo; muestra ambos tiempos separados. El mapa pinta en gris puntos vencidos, detenciones excesivas y GPS no válidos. Fichas de escritorio y móvil usan `fixTime`, explican el motivo y suprimen «EN VIVO» si la telemetría no sirve. Se exige `valid === true`. El verde del mapa sigue sin certificar turno ni WhatsApp. Los marcadores envejecen al siguiente corte visual de 30 segundos; el selector revisa el instante exacto de cada ejecución.

## Verificación

- 22,822 pruebas Deno del bot aprobadas con tipos. La nueva matriz cubre GPS/detención, fronteras de 30 minutos, disponibilidad, conexión, ámbito y rumbo antiguo. El caso de retroceso a un fix anterior falló antes de corregir esa causa. Un test anterior de desconexión de tres minutos se actualizó a 31 minutos conforme al nuevo contrato; los casos menores a 30 tienen expectativas positivas explícitas.
- 50 pruebas Node del puente y mapa aprobadas: persistencia/reinicio, 1,000 fixes estacionados, jitter, movimiento y datos contradictorios. La integración del código activo parcheado con proveedores sintéticos conservó la detención a través de dos fixes nuevos.
- Después de dos correcciones de la revisión de fuente: 194 pruebas Deno enfocadas y nueve de mapa aprobadas; TypeScript estricto de MapPage, administrador y pruebas de mapa aprobado. Build limpio aprobado. El control estático cubre 140 archivos. No se declara limpio el chequeo general del repositorio, con errores previos fuera de esta superficie.
- Foto real de las 19 unidades de la base: 18 tenían la nueva medición del puente. Con esa foto y el selector publicado, GPS nuevo/detención de 20 y 30 minutos seleccionaron la unidad; 30 minutos y un segundo produjo `idle_timeout`. Fueron ejecuciones locales con datos reales y cambios hipotéticos; no crearon viajes ni enviaron WhatsApp.
- En el VPS, volver a cargar el archivo conservó el inicio detenido de las 18 unidades y su modo 600. Los conteos de viajes, ofertas, outbox y conductores activos permanecieron iguales. Sólo se reinició `wialon-bridge`; Stellar y Robin's conservaron PID y reinicios.

## Publicación y límites

GitHub `main` y Vercel publicaron los commits `5759a49` y `d3feef6`. Supabase independiente `izrsxygazsalfhpaualj`: `process-queue`/`ycloud-webhook` v45 y `taxi-bot-admin` v37. Se verifican por descarga 31/31/38 módulos y OPTIONS HTTP 200. Cada bundle conserva la variante activa de autenticación. No hubo migración SQL ni cambio en la RPC de elegibilidad. La evidencia agregada junto a este documento registra hashes y estados reales.

El puente se aplicó condicionado al SHA-256 previo `e32748e9a3102db821ce7456e5c77d882ca57ad97fad8d54642314421fe39f12`. Respaldo: `/root/wialon-bridge/backups/motion-20261031-e32748e9a310/`. Fuente nueva: `f0550e294ce06662b01f2847b79a5ad0ae0ccd29a5484d34cb49115d9203d52c`. Refresco privado HTTP 200, 18 unidades; acceso sin credencial HTTP 401. Los snapshots completos, coordenadas y secretos se conservan sólo en rutas privadas ignoradas.

Work desactivó el control local del navegador durante la verificación. No se completó una inspección visual actual. La revisión de fuente resolvió los dos hallazgos (ficha móvil anterior y ausencia de `valid`), pero su disposición sigue siendo **recapture** por falta de capturas nuevas. Las imágenes anteriores no prueban esta entrega ni se reutilizan como evidencia actual.

Ante una regresión, cotejar primero hashes y versiones. Restaurar sólo el `index.js` revisado del respaldo y conservar el estado de movimiento; no borrarlo para aparentar disponibilidad. Las funciones anteriores v43/v43/v35 están respaldadas en `idle-before`, privado. No restaurar datos de conductores/viajes ni copiar carpetas de otro bot.
