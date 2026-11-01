# Turnos personales y ubicación móvil de Stellar — 2026-11-01

Actualización posterior: la [revisión del servicio completo](STELLAR_SERVICE_FLOW_AUDIT_20261101.md) publica v53/v40 y endurece la autoridad del GPS físico ante puntos inválidos o relojes no verificables. También desbloquea y aprueba la matriz SQL completa con las migraciones actuales. Los números de versiones y el fallo de fixture descritos abajo conservan el estado de esta entrega inicial.

## Uso

Los dueños y conductores entran con su número registrado y contraseña. En **Mi taxi y turnos**, el conductor elige una unidad autorizada y toca **Encender mi turno**. Se pide permiso de ubicación; si se rechaza, la pantalla explica cómo habilitarlo. **Terminar mi turno** detiene el envío. No se permite desplazar al conductor activo de otra persona ni cerrar un turno con viaje u oferta pendiente.

Se crearon 26 cuentas ausentes con la contraseña inicial solicitada por el usuario y se comprobó su acceso por `phone_login`. Se preservaron las tres cuentas anteriores: 29 cuentas vinculadas en total. Seis fichas incompletas siguen pendientes de teléfono válido o definición de rol. No se publican teléfonos ni contraseñas en esta evidencia. Diez cuentas de propietarios conservan sus vínculos con conductores. La unidad 0509, sin dispositivo GPS previo, queda vinculada al dispositivo móvil virtual 25; no se inventó una ubicación ni se dejó el turno de prueba activo.

## Selección y seguimiento

Se reutilizan el turno, las ofertas, las RPC y el algoritmo existentes. Los puntos del teléfono participan después de los dispositivos físicos elegibles, manteniendo cercanía y dirección dentro de cada grupo. Un reporte físico válido de hasta 30 minutos mantiene autoridad, incluidos ocupado, desconocido y detenido; el teléfono no elude esos descartes. Cuando no existe un reporte físico utilizable, un punto del teléfono puede participar si corresponde a su turno actual y tiene hasta dos minutos de antigüedad.

La APK solicita puntos aproximadamente cada 15 segundos. El servidor valida coordenadas, precisión de hasta 100 metros, fecha, velocidad y señal de ubicación simulada. Rechaza puntos de otro turno, fuera de orden y con más de 90 segundos al recibirlos. Limita escrituras a una cada diez segundos por unidad y conserva solamente el punto actual. La deriva GPS no reinicia el reloj detenido: se exige desplazamiento superior a 60 metros o a la suma de las precisiones. Sigue vigente el descarte tras más de 30 minutos sin desplazarse.

El refresco físico previo a asignar se conserva. Si ese proveedor falla de forma transitoria, pueden participar puntos móviles actuales e independientes; no se autoriza asignar con datos físicos almacenados por ese fallo. Se registra el evento `taxi_dispatch_source_degraded` con fuente `mobile_only`. Sin puntos móviles válidos, el error se mantiene visible. El simulador utiliza la misma mezcla y ranking. El seguimiento por token usa la ubicación móvil de la unidad asignada cuando falta un reporte físico vigente.

La ubicación continúa entre pantallas mediante un único servicio y notificación Android. No se garantiza ejecución después de forzar el cierre del proceso o de restricciones del fabricante. Si se detiene el envío, la caducidad de dos minutos excluye el celular. Salir de sesión cancela el emisor local; cada cambio relevante del turno rota su versión en PostgreSQL y elimina el punto previo.

## Publicación y pruebas

Proyecto Supabase: **Stellar Tracking**, `izrsxygazsalfhpaualj`. Migraciones `20261101140000` y `20261101140100` aplicadas. Funciones activas: `taxi-bot-admin` v39, `process-queue` v52 y `track-position` v4. La función temporal de altas fue eliminada al terminar. Las tablas nuevas tienen RLS y sólo permiten operaciones por las RPC privadas del servidor.

Se respaldaron las funciones anteriores y se compararon con la revisión base `4378a97` antes de publicar desde un checkout aislado. No se publicaron archivos de otros proyectos. Ver hashes del paquete descargado y del artefacto en [la evidencia](STELLAR_DRIVER_MOBILE_20261101.evidence.json).

Pasaron 314 pruebas Deno de accesos, selección, conflictos, turnos SQL, caducidad, simulación, cuentas, propietarios y seguimiento. `deno check` aprobó las tres entradas afectadas. Las 17 pruebas Flutter aprobaron; el análisis de los cuatro archivos principales no reportó incidencias. Una transacción de producción con `ROLLBACK` comprobó iniciar turno, escribir ubicación, ver candidato y cerrarlo; no creó viajes ni envió WhatsApp. Después había cero puntos móviles y el turno de la unidad de prueba seguía apagado. No se presenta esta comprobación como prueba física del GPS ni de WhatsApp.

La suite histórica completa no se declara aprobada: existe un fallo previo de fixture en `taxi-bot-db` («Review current offer loop»), descrito en la revisión de base. Los 314 casos indicados son las suites pertinentes de esta entrega.

APK debug **1.0.0+3**, `com.stellar.tracking`, Android mínimo 24. Artefacto local: `C:/Users/Kaleb/Desktop/StellarTracking/releases/20261101-driver-mobile/Stellar-debug.apk`. Esta APK **no está instalada**: ADB no detecta dispositivos. La instalación y comprobación de ubicación real en segundo plano quedan pendientes. [Fuentes nativas revisables](native/STELLAR_DRIVER_MOBILE_20261101/README.md).
