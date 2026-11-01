# Ofertas en tres rondas de tres unidades

La última instrucción del administrador sustituye la oferta secuencial: cada ronda contacta **hasta tres unidades elegibles simultáneamente**, con **tres minutos de vigencia compartida**. Si no hay aceptación válida, la siguiente ronda consulta GPS de nuevo y excluye a todas las unidades ya contactadas. Son tres rondas, hasta nueve taxis distintos y aproximadamente nueve minutos más el procesamiento del consumidor. Con menos candidatos se ofrecen los disponibles; nunca se inventan unidades.

Publicado: código bfb17a1 en main; migración 20261101002000 aplicada y registrada en Supabase independiente izrsxygazsalfhpaualj. Worker y webhook v49 ACTIVE; administrador v37 sin cambios. Las trece funciones SQL coinciden con el ensayo y los 62 archivos Edge descargados coinciden con la entrega revisada. El JavaScript público del panel contiene los nuevos textos. La evidencia adjunta conserva hashes y resultados agregados.

## Reglas de aceptación y tiempo

La primera aceptación válida gana dentro de la transacción existente de PostgreSQL. Las demás ofertas se revocan. Una oferta vencida de la primera ronda no permite aceptar durante la segunda: devuelve «Esta oferta ya no está disponible: venció la ronda o una unidad ya aceptó el viaje». La identidad del conductor, su turno, la base y los bloqueos de viaje/unidad conservan las comprobaciones existentes.

Las tres ofertas reciben exactamente la misma fecha de vencimiento, calculada al crear la ronda. Los acuses de aceptación del proveedor, entrega y lectura no prolongan esa fecha ni reactivan ofertas vencidas. La aceptación del proveedor sigue siendo distinta de la aceptación del conductor. Incluso si todas las unidades rechazan antes, se respeta el plazo de la ronda antes de expandirla.

Los filtros GPS conservan la disponibilidad confirmada, antigüedad máxima de treinta minutos y exclusión tras más de treinta minutos detenido. El consumidor sigue consultando Wialon/Traccar por la ruta existente. No se agregó enrutamiento por calles ni otra selección paralela.

## Decisión del cliente

Al terminar las rondas o agotar los límites de búsqueda sin una oferta vigente, la solicitud se pausa y recibe una sola pregunta con **Seguir esperando** / **Cancelar solicitud**. La pregunta pertenece al presupuesto de mensajes por dudas, mantiene la reserva de la notificación de asignación y no se repite en cada ciclo del consumidor.

La elección usa un token UUID duradero, ligado al viaje, base, canal y cliente; vence en cinco minutos. El mensaje explica que la solicitud se cerrará si no hay respuesta. Solamente el botón nativo vigente de la conversación en modo bot permite continuar o cancelar. Texto que imite el botón, un token antiguo, otro cliente o una propuesta del modelo no reanudan búsquedas. Cancelar utiliza la transición existente de cancelación.

Seguir esperando permite **una ampliación** de hasta otras tres rondas / nueve minutos, con unidades nuevas. El mismo viaje conserva su identidad y el historial de unidades contactadas; se admiten hasta dieciocho exclusiones. Agotada la ampliación pasa a revisión de la base; no se reinicia indefinidamente. Se conservan doce consultas de flota y tres fallos consecutivos como límites de cada bloque, además del circuito del proveedor.

El mantenimiento ya no aplica el antiguo cierre a los doce minutos sobre una ampliación vigente o una elección pendiente. Si vence la elección, cierra por tiempo. Las solicitudes antiguas sin trabajo de despacho conservan su recuperación previa. Un mensaje de elección que quedó en cola pierde permiso de envío al cancelarse, asignarse, vencer o consumirse el token; esto también protege las respuestas que vuelven a mostrar esos botones.

## Mensajes y superficies

La oferta al conductor contiene nombre, enlace verificado de Maps para la recogida, referencia, destino y botones. No muestra tarifa ni importe. La búsqueda normal del cliente conserva su resumen sin precio. El panel indica tres rondas y distingue «Esperando al cliente» de la revisión de la base.

Las funciones Edge necesitan sólo tres módulos revisados: contratos de sesión, coordinación de botones y límite de exclusiones del consumidor. La publicación se prepara desde copias activas aisladas y preserva la autenticación activa. No se compila ni instala Flutter. El administrador es compatible con las firmas SQL existentes.

## Verificación y recuperación

Resultado final: 178 pruebas SQL y 218 pruebas Deno aprobadas, tipos comprobados y control estático de 142 archivos. La compilación web se hizo desde una copia del commit con sólo los archivos revisados; el detector de la interfaz no encontró incidencias.

La evidencia inicial reprodujo la discrepancia: la política anterior creó una oferta, frente a las tres esperadas. Las pruebas transaccionales cubren vencimiento común, primera aceptación, expansión, botones viejos, fallo tardío del proveedor, cancelación, aislamiento, continuación limitada, presupuesto de mensajes y permiso de envío. Las expectativas anteriores de una unidad y cuatro rondas se ajustaron a la nueva instrucción, manteniendo las comprobaciones de identidad, idempotencia y estado.

La migración se ensaya en el sistema activo dentro de una transacción terminada en ROLLBACK, con guardas de hash de las doce funciones existentes y comprobación de permisos. Se agrega una función privada de elección; las tablas siguen sin acceso público. El respaldo privado contiene las definiciones anteriores y los metadatos. Una reversión debe considerar los trabajos con elecciones ya emitidas; no borrar sus tokens, viajes o contactos.

Las pruebas locales y consultas de comprobación no envían WhatsApp ni crean viajes de prueba en producción. La verificación visual permanece pendiente por preferencia del administrador; se comprueban código, compilación y backend. Una prueba física con teléfonos es una comprobación distinta.
