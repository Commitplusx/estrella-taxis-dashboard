# Dueños, choferes y turnos de Pompeyo

## Uso

El administrador vincula la ficha del dueño a su correo y al taxi real de Traccar desde **Conductores → Ver acceso**. Al entrar con ese correo, el dueño abre **Conductores → Mi taxi y mi acceso** (`/drivers`), agrega sus choferes con nombre, WhatsApp, correo y contraseña inicial y elige **Poner en turno**. Cada chofer obtiene un acceso individual, limitado al mismo taxi. Agregar un chofer no lo pone automáticamente en turno.

Sólo hay un destinatario operativo por unidad. Cambiar el turno actualiza la fila existente de `conductores`; no crea taxis, IMEI, unidades GPS ni otro algoritmo. Las nuevas ofertas siguen el algoritmo de asignación vigente y llegan al WhatsApp del chofer elegido. **Terminar turno** desactiva las ofertas de ese taxi. Un viaje en curso o una oferta pendiente impide cambiar o terminar el turno.

La casilla **Recibe ofertas de viaje** del administrador ya permite marcar personas cuyo rol estaba pendiente o era Dueño. El formulario explica y confirma el rol Conductor o Dueño y conductor; el servidor sigue exigiendo un WhatsApp válido y un taxi vinculado. Para personas con acceso, el cambio de rol conserva el flujo existente de sincronización de permisos.

## Contrato y autorización

`taxi-bot-admin` admite `owner_context`, `owner_driver_save` y `owner_shift` para cuentas personales owner/owner_driver. La identidad se verifica contra Traccar; el taxi y la base se obtienen del vínculo real entre `taxi_base_contacts`, `perfiles` y `taxi_base_units`. El cliente no puede elegir otra base, taxi ni actor. Un conductor regular no puede usar esas operaciones. Se comprueba también que Traccar todavía permite ver la unidad asignada.

Las RPC `taxi_owner_read`, `taxi_owner_contact_save`, `taxi_owner_shift_apply` y `taxi_owner_account_allowed` sólo se conceden a service_role. `taxi_owner_operations` tiene RLS y no admite acceso directo de clientes ni service_role. El servidor usa el servicio administrativo ya configurado mediante `TRACCAR_EMAIL`, `TRACCAR_PASSWORD` y `TRACCAR_URL`; nunca entrega esas credenciales al dueño ni le concede administración nativa de Traccar.

El alta reutiliza `accountRequest` y `taxi_account_begin/finish/activated`: usuario inicialmente suspendido, permisos exactos del taxi, vinculación al mismo contacto y activación comprobada. Conserva el actor del dueño para auditoría. Se vuelve a comprobar su vínculo al reservar, finalizar y antes de solicitar la activación externa; una revocación concurrente al envío externo requiere revisión de la base. Los accesos personales son readonly, sin permisos de crear usuarios, dispositivos o comandos.

Cada operación incluye una solicitud única y revisión. Los bloqueos existentes por taxi y destinatario impiden dos turnos simultáneos y respetan las ofertas/viajes en curso. El dueño puede registrar hasta 20 choferes por taxi; no puede modificar datos de un acceso ya vinculado, reasignar taxis ni adoptar un correo existente. Esas correcciones siguen en la administración de la base.

## Recuperación y límites

Una respuesta perdida conserva la misma solicitud para **Comprobar alta/cambio**. El servidor persiste el recibo y las altas pendientes sin contraseñas. Tras recargar se puede completar el alta original; los datos reservados quedan bloqueados y se pide de nuevo la contraseña inicial. Una cuenta ya creada conserva su contraseña original. Un conflicto real se muestra como error; una operación incierta no se presenta como éxito. Las operaciones en revisión se remiten a la base.

Una cuenta pendiente de activación no puede entrar en turno. Antes de activar un turno se comprueba en Traccar que el acceso del chofer exista, esté habilitado y no sea administrador. No se realizan reintentos automáticos ilimitados. El alta no envía mensajes, invitaciones ni contraseñas por WhatsApp o correo.

## Web y aplicación

La web usa el mismo padrón y un modal nativo accesible, adaptado a escritorio y móvil. La vista DEV `/conductores-diseno?vista=dueno` contiene sólo ejemplos y no guarda. La aplicación Android que abre la web recibe esta pantalla sin recompilarse.

En `C:/Users/Kaleb/Desktop/StellarTracking/flutter_app` se prepararon `taxi_owner_client.dart`, `taxi_owner_screen.dart` y el acceso desde `profile_screen.dart`. Usan estas mismas operaciones del backend. **Flutter no se compiló ni se generó una APK nueva, por indicación del usuario.** La prueba física con dueño/chofer y la compilación quedan pendientes; no se crearon cuentas reales para probar.

## Validación y publicación

- Suite completa: 22,541 pruebas Deno y 163 pruebas Node/SQL aprobadas, tipado estricto de entradas/panel/pruebas y control de calidad del bot aprobados.
- Incluye aislamiento de unidad, conductor sin cuenta, revocación, destinatario único, turno terminado, conflictos de revisión, oferta/viaje pendiente, creación con respuesta perdida y activación incompleta. Los casos usan identidades sintéticas; no acreditan entrega física de WhatsApp.
- Revisión visual local de panel, casilla y formulario en escritorio y móvil, con datos de ejemplo.
- Migración revisada: `20261031220000_taxi_owner_shifts.sql`. La publicación y los hashes activos se registran en la evidencia de este cambio al finalizar el despliegue.

Este documento amplía el flujo de permisos descrito en `STELLAR_PERSON_ACCOUNTS_20261030.md`. Los accesos personales ahora permiten estas operaciones delegadas y acotadas del dueño; las demás operaciones de administración siguen restringidas.
