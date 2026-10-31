# Accesos, personas y taxis de Pompeyo — 30 de octubre de 2026

Actualización: [dueños, choferes y turnos](STELLAR_OWNER_SHIFTS.md) amplía los permisos del dueño para dar acceso a sus choferes y elegir su turno. Las restricciones descritas abajo corresponden al despliegue original; el documento nuevo define el contrato vigente para esas operaciones.

## Un solo padrón

`/users` y `/drivers` usan la misma ficha de `taxi_base_contacts` y el mismo editor. La lista anterior de Conductores consultaba `/api/drivers`: identificadores de Traccar, no las personas del Excel ni las cuentas de acceso. Se retiraron de esa pantalla las altas paralelas de identificadores GPS. No se crean taxis ni IMEI.

Traccar sigue siendo dueño del correo, contraseña y permisos sobre dispositivos. `taxi_base_contacts.traccar_user_id` enlaza una persona existente con un único usuario real de Traccar. `perfiles` conserva el vínculo a Pompeyo. El número económico y el ID GPS no se igualan por aproximación. La importación original conserva sus 33 personas; no se deduce un correo de un nombre o un teléfono. El administrador debe seleccionar qué cuenta corresponde a cada persona.

Ruta: **Usuarios o Conductores → Crear acceso / Ver acceso → Correo y acceso**. El administrador selecciona una cuenta existente o crea una nueva con correo y contraseña inicial; asigna rol, taxi real y si conduce/recibe ofertas. Cambiar rol o taxi de una persona con acceso se hace en esa misma pestaña para mantener sincronizados los permisos. Nombre y WhatsApp se corrigen en Datos y taxi.

Un dueño y su conductor son personas distintas que pueden referirse al mismo taxi; cada una puede tener su correo. Sólo el contacto conductor que recibe ofertas alimenta el registro operativo existente de `conductores`. Las ofertas siguen usando el WhatsApp del chofer y el mismo algoritmo de asignación. No se agrega un segundo algoritmo ni se envían ofertas al dueño por tener acceso al panel.

## Permisos

Sólo el administrador global autenticado de Traccar crea o vincula accesos. `owner`, `driver`, `owner_driver` son roles personales: el backend sólo permite contexto mínimo y su propio perfil, y Traccar concede únicamente el dispositivo seleccionado. No administran usuarios ni agregan choferes. `staff` representa al operador de la base y conserva `operador`, con lectura de las unidades de Pompeyo; la interfaz lo indica antes de guardar.

Las cuentas personales se crean/configuran con `administrator=false`, `readonly=true`, `userLimit=0`, `deviceLimit=0`, `deviceReadonly=true`, `limitCommands=true` y `fixedEmail=true`. Las cuentas de administración y de otra base no pueden convertirse en cuentas personales. Los grupos se retiran antes de verificar que el conjunto de taxis concedidos coincide exactamente con la asignación. No basta con ocultar botones: el servidor rechaza las operaciones de base desde una cuenta personal.

La lista de **Autorizados permanece vacía por indicación de Kaleb**. Dar acceso a un dueño o conductor no autoriza su número como cliente. El canal conserva su estado activo y seguirá sin atender clientes hasta que el administrador autorice números.

## Guardado y recuperación

`taxi_account_begin` reserva una solicitud y una persona/correo durante 90 segundos; las llamadas externas tienen un límite total de 60 segundos. `taxi_account_operations` conserva la solicitud, estado y recibo, sin contraseñas. Los reintentos son explícitos y usan la misma solicitud; una respuesta perdida al crear usuario se recupera por la marca de solicitud en Traccar y no duplica el correo.

La cuenta se suspende mientras se cambian sus permisos. `taxi_account_finish` comprueba revisiones, guarda el vínculo en `perfiles`, actualiza la misma persona y utiliza `taxi_bot_contact_apply_core`/`taxi_bot_driver_apply` para modificar el destinatario operativo dentro de una transacción. Sólo después se activa el acceso y se confirma `taxi_account_activated`. Un fallo no muestra éxito ni deja entrar una cuenta con permisos pendientes. Un recibo ya confirmado no vuelve a activar una cuenta deshabilitada después por el administrador.

Las altas pendientes se recuperan desde el mismo panel incluso después de recargar. Si todavía no se creó el usuario, se pide otra vez la contraseña inicial; nunca se persiste ni se manda por correo. Si cambió la versión durante el alta, la operación pasa a revisión y debe iniciarse otra asignación explícita usando la cuenta existente; no se adivina un destinatario ni se reintenta sin límite.

El editor es un `<dialog>` nativo, centrado en escritorio y adaptado como hoja en móvil, con scroll interno, encabezado y acciones visibles. Conserva foco, Escape, confirmación local al descartar cambios, transición de entrada/salida y modo de movimiento reducido. La vista DEV `/conductores-diseno` contiene sólo datos sintéticos y no guarda cambios.

## Verificación y publicación

- 71 pruebas SQL/integración aprobadas; cuatro de accesos vuelven a pasar después del ajuste final de concurrencia. Cubren usuario único, revisión, lease, repetición, separación por base, cuenta propia y cambio de taxi/WhatsApp sin duplicar personas.
- 56 pruebas de handlers aprobadas, nueve de cuentas: creación con respuesta perdida, reutilización de correo, permisos exactos, conflicto SQL, recibo antiguo y bloqueo de cuentas personales.
- Tipado estricto del panel y entrada Deno aprobados; control de calidad de 75 fuentes y detector visual sin hallazgos. Build completado con avisos existentes de tamaño de bundle/importaciones dinámicas.
- Inspección local con datos sintéticos en escritorio y móvil; modal dentro del viewport, acciones visibles, sin desbordamiento horizontal. La prueba no acredita creación/entrada con una cuenta física ni entrega real de WhatsApp.
- Migración candidata `20261030180000_taxi_person_accounts.sql` publicada en el proyecto independiente `izrsxygazsalfhpaualj`; historial remoto y hashes en evidencia local excluida de Git. `taxi-bot-admin` v18 ACTIVE. Sólo se publica el administrador; no se reinician el puente GPS, el worker ni otros negocios.
- Publicación final: implementación `066fb99` en `main`; historial SQL `20261030151720`. Ocho cuerpos SQL comprobados (incluido el núcleo original conservado) y veinte fuentes runtime descargadas coinciden con lo revisado. La web sirve `/assets/index-KckVZQm2.js` con SHA-256 idéntico al build aislado. Se recorrió **Usuarios** con la sesión real: 33 contactos, 19 unidades y tres cuentas no administrativas disponibles; el modal muestra los taxis reales y las cuentas existentes, sin errores. No se guardó una asignación real. [Evidencia agregada sin datos personales](STELLAR_PERSON_ACCOUNTS_EVIDENCE_20261030.json).

No se crean cuentas reales ni se vinculan automáticamente los 33 contactos: faltan las correspondencias de correo/rol/GPS que debe confirmar la administración. Los datos personales, respaldos y credenciales no se incluyen en este documento ni en Git.
