# Clientes autorizados de Pompeyo

**Publicado el 29 de octubre de 2026 en Stellar Tracking `izrsxygazsalfhpaualj`.** Migración `20261029165842_taxi_customer_access`; funciones `taxi-bot-admin` v10, `ycloud-webhook` v9 y `process-queue` v9. El apartado web está disponible en local: [Autorizados](http://127.0.0.1:5290/taxi-bot#autorizados). No se publicó la web en GitHub ni hosting.

Kaleb confirmó que este bot es exclusivo de Pompeyo y solicitó probar con su número. La base tiene **un solo cliente autorizado, terminado en 9156**, registrado por esa petición, sin inventar una identidad de Traccar para atribuir el alta. La lista pertenece a Pompeyo y se aplica a sus canales; se puede preparar antes de registrar el canal. No se modificaron datos ni workers de restaurantes.

## Uso

En **Bot de WhatsApp → Autorizados**, la administración puede agregar o quitar teléfonos y guardar. Para México acepta diez dígitos; el panel muestra el número internacional. `+52` y el prefijo mexicano antiguo `+521` coinciden en la autorización sin cambiar el remitente que reportó YCloud. Todos entran al flujo de cliente y conservan las validaciones de viaje, confirmación, precio y asignación del backend.

No hay selector para abrir el bot al público. Una lista vacía bloquea a todos los clientes. Los teléfonos fuera de la lista se ignoran sin responder, crear sesión ni encolar trabajo de IA. Un operador puede consultar su lista; sólo la administración de esa base puede cambiarla. La API valida el actor real, el alcance, hasta cien números, formato, duplicados, revisión e identificador idempotente. La web bloquea el cambio de base o pestaña con ediciones o un guardado incierto; reintenta la misma solicitud para comprobar el resultado.

Las notificaciones operativas de la base y las ofertas al conductor conservan su flujo. Un conductor que no está autorizado como cliente sólo puede responder al botón de una oferta propia válida y con su unidad activa; su texto normal no abre una conversación de cliente. Ser dispatcher tampoco agrega un permiso de cliente automáticamente.

## Control en el servidor

Tres tablas privadas con RLS guardan revisión, clientes y operaciones auditadas. No tienen acceso público ni lectura directa desde el navegador. Los cambios pasan por `taxi-bot-admin` con identidad de Traccar verificada. La lista es una regla explícita del servidor; el modelo no puede autorizar números.

`taxi_bot_enqueue` rechaza la entrada no autorizada; `taxi_bot_begin` vuelve a comprobarla antes de interpretar y finaliza un evento pendiente si se revocó el acceso. `taxi_bot_commit` comprueba el permiso bajo bloqueo compartido de la revisión antes de efectuar cambios. La cola de salida descarta mensajes pendientes para destinatarios no autorizados y el worker consulta de nuevo el permiso de una salida reclamada antes de llamar al proveedor. No puede retirarse un mensaje que ya fue enviado o aceptado externamente antes de una revocación; tampoco quitar un número cancela por sí solo un viaje activo.

La regla de conductores usa oferta, empresa, canal, teléfono y unidad; se corrigieron ambas comparaciones del prefijo mexicano en la aceptación para no permitir la entrada del botón y rechazar después a su dueño.

## Publicación y comprobaciones

- Respaldo previo de las tres funciones Edge y de las cuatro funciones SQL sustituidas en `.codex-tmp/stellar-access-before/`. Sus cuerpos activos coincidieron con las fuentes previas antes de publicar. No se copió la carpeta local completa.
- [Migración oficial de Management API](https://supabase.com/docs/reference/api/v1-apply-a-migration) aplicada una vez y registrada en historial. El archivo local lleva la versión real generada por Supabase; el contenido revisado conservó su SHA-256.
- Las once funciones SQL publicadas coinciden con la fuente. Se descargaron las tres funciones Edge y se compararon los archivos runtime con el paquete revisado; los módulos formados exclusivamente por interfaces no se devuelven en ese bundle y se identifican por separado.
- Lectura real: un autorizado, coincidencia del propietario y prefijo antiguo, número no listado bloqueado, todas las tablas con RLS y función de consulta inaccesible a `anon`. La comprobación privilegiada fue SELECT mediante la cuenta administradora; el rol de sólo lectura de Management también recibió el rechazo esperado de las funciones privadas.
- **4,846 Deno + 66 Node/SQL aprobadas**, controles de tipos y calidad, y build Vite aprobados. Incluyen trece casos nuevos: seis de contratos/HTTP y siete PostgreSQL de autorización, revocación, cola y conductores. En la primera pasada tres fixtures anteriores usaban contactos sin autorización: se declararon expresamente sus autorizaciones, sin quitar ni rebajar sus expectativas. Una nueva prueba del prefijo del conductor detectó la segunda comparación exacta; se corrigió la causa y pasó la regresión completa.
- Webhook y consumidor continúan `503 taxi_disabled`; administrador sin sesión devuelve `401 missing_session`. No se enviaron WhatsApps ni se crearon viajes para verificar este cambio. Sigue sin canal ni conductores registrados y la empresa permanece inactiva. No se cambiaron secretos ni se arrancó el consumidor del VPS.

La revisión visual autenticada sigue pendiente porque el control del navegador de Work estaba desactivado. Compilación y HTTP 200 no acreditan ese recorrido. Evidencia de publicación: `STELLAR_AUTHORIZED_CUSTOMERS_EVIDENCE_20261029.json`. Los fallos globales heredados de tipado y advertencias de bundle/hooks permanecen documentados; no se declara una auditoría total de la aplicación.
