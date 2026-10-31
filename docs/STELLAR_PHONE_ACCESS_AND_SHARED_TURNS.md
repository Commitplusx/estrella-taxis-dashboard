# Acceso por número y turnos compartidos

> Actualización: [APK 1.0.0+2 instalada y abierta en Android; prueba real de asignación de la unidad 0540](STELLAR_GPS_REFRESH_20261031.md#prueba-real-de-instalación-y-asignación). El acceso por correo o número descrito aquí sigue vigente.

## Uso

Dueños y conductores entran a la web y la APK con su **WhatsApp registrado y contraseña**. Se aceptan los diez dígitos de México, +52 y el prefijo móvil anterior +521. Una cuenta existente conserva su contraseña y correo anterior. La administración conserva el acceso por correo.

En **Mi taxi y turnos → Agregar chofer**, escribe nombre y WhatsApp. Si ya tiene cuenta en la base, deja la contraseña vacía: se vincula la misma persona. Puede ser otro dueño; conserva la propiedad de su unidad, su rol y sus credenciales. Para una persona nueva, escribe una contraseña inicial de 12 a 128 caracteres. No se envían contraseñas ni invitaciones automáticamente.

El propietario también aparece entre las personas que pueden conducir su taxi, aunque su rol sea Dueño. **Poner en turno** selecciona al único destinatario operativo. Un dueño puede cubrir otra unidad, pero primero tiene que terminar su turno anterior. No se cambia el turno si tiene viaje u oferta pendiente. El cliente recibe la notificación mediante la outbox existente cuando ese conductor acepta; no se crea un segundo algoritmo ni una segunda flota.

## Corrección del problema reportado

El registro anterior intentaba crear otra ficha y comparaba su taxi con el destinatario ya activo del mismo WhatsApp. Al agregar un dueño de otra unidad, devolvía `driver_changed` («Cambió el chofer de la unidad»). La prueba SQL conserva esa reproducción con la función anterior y demuestra el cambio: ahora encuentra el contacto por teléfono y registra una autorización para conducir la otra unidad, sin reemplazar su propietario ni duplicar personas o cuentas.

`taxi_unit_drivers` separa la autorización para conducir de `taxi_base_contacts.device_id`, que sigue identificando el taxi propio o principal. Sus claves foráneas mantienen la misma base. La cuenta de Traccar recibe exclusivamente los GPS de su vínculo principal y autorizaciones explícitas. Al retomar una respuesta perdida se comprueban los permisos existentes antes de volver a enviarlos. El dueño no obtiene administración de usuarios, GPS o comandos.

El cambio de turno conserva las revisiones, recibos y bloqueos actuales. Un conflicto real actualiza el estado visible; una respuesta incierta conserva la misma solicitud para comprobarla. Registrar una autorización no inicia un turno ni retira al chofer de otra unidad. Las altas nuevas incluyen al propietario en el límite de veinte personas de la unidad.

## Autenticación

`phone_login` es una acción pública de `taxi-bot-admin`. El servidor resuelve el teléfono contra el contacto, perfil, base activa y unidades vinculadas. Verifica la contraseña directamente en Traccar y vuelve a comprobar el vínculo y los GPS antes de devolver una sesión personal. No almacena otro hash de contraseña ni devuelve el correo privado o la sesión administrativa. Un número ambiguo entre bases se rechaza.

Hay límites duraderos de ocho intentos por teléfono y 240 globales en una ventana de al menos diez minutos. Los contadores son privados; se limpian por lotes acotados. Los errores de número desconocido, contraseña incorrecta, cuenta deshabilitada y permisos incompatibles usan el mismo mensaje de credenciales. Las respuestas no se almacenan en caché. La web cambia el token personal de diez minutos por su cookie normal; la APK conserva su cookie y no guarda la contraseña del acceso por número.

Los accesos personales nuevos utilizan un identificador interno estable de Traccar. No es un correo de contacto ni un buzón de recuperación. El usuario utiliza su teléfono. La recuperación de una cuenta sin correo real requiere asistencia de la base; este cambio no añade un sistema paralelo de recuperación.

## Fuentes nativas y publicación

Las fuentes Flutter activas están en `C:/Users/Kaleb/Desktop/StellarTracking/flutter_app`. [La copia revisable de los siete archivos](native/STELLAR_PHONE_ACCESS_20261031) conserva esta entrega en GitHub; es una instantánea de los archivos afectados, no un proyecto Flutter completo. La APK debug usa `com.stellar.tracking`, versión 1.0.0, código 2, firma APK v2 y Android mínimo 24.

La APK quedó compilada en `C:/Users/Kaleb/Desktop/StellarTracking/flutter_app/build/app/outputs/flutter-apk/app-debug.apk`. **Esta actualización no está instalada:** ADB no detectó el teléfono y el usuario indicó que avisaría después. La prueba física de inicio con dueño/chofer y cambio de turno continúa pendiente. Las pruebas automatizadas son sintéticas y no acreditan entrega física de WhatsApp.

El estado y hashes de Supabase, GitHub, Vercel, fuentes y APK se registran en [la evidencia de publicación](STELLAR_PHONE_ACCESS_EVIDENCE_20261031.json).

## Verificación de esta entrega

Pasaron 22,583 pruebas Deno y 186 Node/SQL, tipado de las entradas, panel y pruebas SQL y el control estático de 121 archivos. Las 13 pruebas Flutter aprobaron. El análisis Dart de los siete archivos afectados terminó sin errores ni advertencias, con 45 avisos informativos de código existente. La APK debug se compiló y su firma v2 se verificó.

Las dos migraciones se aplicaron en una transacción después de respaldar y comparar ocho funciones activas. Las doce definiciones resultantes coinciden con las instaladas en el fixture SQL; ambas tablas nuevas tienen RLS y no permiten lectura directa ni siquiera a service_role. Los conteos de personas, cuentas, unidades y destinatarios se conservaron.

`taxi-bot-admin` **v34 ACTIVE** quedó publicada y sus 31 archivos runtime descargados coinciden con el paquete revisado. Se corrigió un fallo del empaquetador que omitía el módulo de turnos compartidos; después de normalizar sus imports se repitieron las pruebas de accesos y se verificó que ese módulo sí está activo. El worker y webhook continúan en v39, sin nuevos despliegues. OPTIONS responde 200, el contexto de dueño sin sesión responde 401 y el acceso con teléfono desconocido responde 401 con el error genérico previsto.

La implementación `fb6ec2a` está en `main`; Vercel confirmó la publicación y la web de producción contiene el acceso por número y la vinculación de personas existentes. Se registra el hash de su bundle. Difiere del build local aislado, por lo que esta comprobación no se presenta como reproducción byte por byte ni como prueba física con la contraseña de un dueño.
