# Pompeyo: conversación breve y accesos personales

## Conversación del cliente

El flujo normal tiene un presupuesto duradero de **cinco mensajes al cliente por servicio**. Ubicación GPS de recogida, nombre y destino se piden juntos cuando faltan varios datos. Se conserva el debounce de 15 segundos: las burbujas del cliente se interpretan como un lote.

El resumen ocupa un único mensaje con los enlaces de Maps y el botón vigente. Las referencias extensas se abrevian sólo en el texto mostrado; sus valores completos siguen en el borrador y en el viaje. El importe se consulta en el servidor y sólo se muestra cuando el cliente pregunta. El mínimo de Pompeyo sigue siendo $55.

El servidor cuenta las solicitudes persistidas en la outbox, incluyendo las notificaciones. Si ya usó cuatro mensajes antes de confirmar, omite el acuse separado de búsqueda y el aviso intermedio de revisión y reserva el quinto para avisar quién aceptó o que no se consiguió unidad. La despedida al terminar sólo se envía si queda espacio. No elimina la asignación ni deja de avisar que una unidad aceptó para ahorrar un mensaje.

Las dudas, aclaraciones y cambios pueden generar respuestas adicionales, conforme a la decisión del usuario. Tienen su propio contador. Una cortesía aislada como «gracias» no dispara otro envío. Si se consumieron tres turnos normales de recopilación y sigue sin poder preparar un resumen, utiliza la ruta existente de atención de la base; no entra en un ciclo de preguntas ni crea un viaje incompleto.

`taxi_bot_message_budgets` guarda el servicio, contador normal, contador extra, cierre y avisos opcionales omitidos. Es una tabla privada, sin permisos directos para clientes o service_role. Sus bloqueos ocurren al emitir la salida y se separan de la fila de sesión para evitar invertir el orden sesión → viaje durante las notificaciones del asignador. Los reintentos de la misma clave de outbox cuentan una sola vez. Las ofertas y respuestas del chofer y los avisos a la base no consumen el presupuesto del cliente.

Un nuevo servicio tras el cierre o un `/reset` sin viaje activo empieza otro presupuesto. Descartar un borrador también cierra su presupuesto para poder empezar otro. Reiniciar una conversación con viaje activo no cancela el viaje ni repone su presupuesto. Un texto inequívoco para decir el destino al chofer también se acepta antes del GPS; un botón de destino siempre necesita su token vigente.

El pin de recogida sigue siendo obligatorio. Ningún texto, «sí» o salida del modelo sustituye el clic en *Confirmar viaje*. El backend conserva la cotización, consentimiento, asignación, cancelación y cierre.

## Dueños y choferes

Se conectan los accesos y turnos existentes, sin crear otra flota ni otro algoritmo de asignación.

| Cuenta | Funciones |
| --- | --- |
| Propietario / Dueño y conductor | Su taxi, mapa, seguimiento, reportes, repetición de ruta, avisos y gestión de sus choferes y turno. |
| Conductor | Su unidad, mapa, perfil y consulta de su turno. |
| Administración de la base | Conserva sus permisos actuales. Los comandos nativos del GPS requieren la administración verificada de Traccar. |

El propietario utiliza **Mi taxi y choferes** para crear el acceso del chofer con correo y contraseña inicial y elegir quién está en turno. El conductor tiene su propia cuenta. Cambiar turno modifica el destinatario del registro existente de `conductores`; las ofertas llegan al WhatsApp de esa persona. Para manejar él mismo, el dueño necesita el rol *Dueño y conductor* y ponerse en turno.

La aceptación sigue usando los botones de WhatsApp existentes. El commit guarda la asignación y la notificación al cliente en la misma transacción. Se corrigió la recuperación de una aceptación completada: repetir el mismo evento recupera su recibo aun cuando la oferta ya salió de `offered`, sin duplicar asignación o notificación. No autoriza eventos nuevos ni otras personas.

En Flutter se consulta el rol del servidor al iniciar y al volver a la app; se descarta el rol anterior al cambiar cuenta o cerrar sesión. Si no puede comprobarse, bloquea el contenido y permite comprobar de nuevo o entrar con otra cuenta. Se ocultan las opciones de administración a cuentas personales. El código nativo está preparado en el proyecto local: **no se compiló Flutter ni se generó/publicó una APK**. El [parche revisable](patches/STELLAR_FLUTTER_ROLES_20261031.patch) registra los cambios sobre las fuentes previamente preparadas; no es un proyecto Flutter completo.

## Validación y publicación

- 22,560 pruebas Deno y 183 Node/SQL aprobadas; tipado de las entradas, pruebas SQL y panel, y control estático de 116 archivos. Después del último ajuste del aviso intermedio se repitieron 26 casos de presupuesto y despacho sobre el SQL final.
- Los seis órdenes de GPS/nombre/destino recorren recopilación → resumen → botón → aceptación → cierre en SQL y comprueban un máximo de cinco solicitudes reales de outbox al cliente. También comprueban que la aceptación repetida genera un solo aviso.
- La nueva redacción pasó 28 de 28 casos con el modelo configurado y el intérprete 24 de 24 regresiones. Son ejemplos sintéticos de desarrollo, no precisión ciega ni prueba física de WhatsApp.
- Análisis Dart de siete archivos: cero errores, una advertencia de código previo y avisos informativos. Sin compilación ni prueba física de la APK.

Supabase independiente: `process-queue` y `ycloud-webhook` **v39 ACTIVE**; `taxi-bot-admin` permanece en v33. Migraciones `20261031230000` y `20261031233000` aplicadas en una transacción con comprobación de las tres definiciones activas y respaldo. La revisión `20261031234000` añade recuperación de borradores descartados y presupuesto del aviso intermedio de atención, con sus dos funciones comparadas y respaldadas antes de aplicar. Se descargaron ambos despliegues: sus 27 archivos runtime coinciden con el paquete revisado. OPTIONS respondió 200 antes y después; el evaluador temporal quedó eliminado. No se modificaron contactos, turnos, unidades ni autorizados de producción durante las pruebas. El hash del build web aislado se registra en la evidencia; la publicación web se comprueba por separado con Vercel y la URL pública.

## Facturación

El presupuesto cuenta solicitudes reservadas; no calcula una factura. El estado `accepted` del proveedor no demuestra entrega ni cobro. [YCloud documenta que desde el 1 de octubre de 2026 hay 1,000 mensajes de servicio entregados gratuitos por número al mes y después cobro por entrega](https://www.ycloud.com/blog/whatsapp-api-message-pricing-update-effective-october-1-2026). La tarifa efectiva y cualquier cargo de YCloud deben comprobarse en esa cuenta. No se deduce un costo mensual sólo por el número de turnos de la IA.

[Evidencia y hashes](STELLAR_BRIEF_FLOW_EVIDENCE_20261031.json).
