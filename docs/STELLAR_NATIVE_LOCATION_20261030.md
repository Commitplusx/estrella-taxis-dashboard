# Pompeyo: ubicación nativa y guardado de contactos

> Corrección posterior: [conversación natural, dirección escrita y cotización opcional](STELLAR_NATURAL_REQUESTS_20261030.md). El pin es opcional y el destino se pregunta por texto; las instrucciones siguientes conservan la entrega anterior como historial.

Estado comprobado el 30-10-2026: SQL publicado en el proyecto independiente `izrsxygazsalfhpaualj`; `taxi-bot-admin` v19, `ycloud-webhook` v11 y `process-queue` v11 ACTIVE. Motor identificado en las trazas como `taxi-bot-v4-native-location`. [Evidencia](STELLAR_NATIVE_LOCATION_EVIDENCE_20261030.json).

## Conversación del cliente

1. Un saludo o solicitud sin recogida pide «¿Dónde te recogemos?» con el botón nativo de ubicación de WhatsApp. El estado guarda `awaitingLocation=origin`.
2. El pin recibido se usa como recogida. Después se pregunta el destino: puede escribir la dirección o elegir otro punto con el botón. El estado guarda `awaitingLocation=destination`; no se reutiliza automáticamente la ubicación actual como destino.
3. Una dirección escrita sigue usando la resolución existente; si no se puede resolver con certeza se solicita el pin de ese campo. Si ambos puntos son inciertos o el pin podría cambiar dos campos, se aclara su significado antes de aplicarlo.
4. Con recogida y destino se consulta la tarifa de las zonas H3 propias de la base. Se pide el nombre faltante y se presenta el resumen con «Confirmar viaje». La tarifa desconocida sigue requiriendo revisión; no se inventa un importe.
5. Sólo el consentimiento vigente solicita una unidad. Los avisos de búsqueda, aceptación y finalización siguen en las transacciones existentes; no se anuncia conductor confirmado antes de su aceptación.

No se fuerza este recorrido si el cliente ya proporcionó los datos. Un viaje activo y una conversación tomada por una persona conservan sus estados. Solicitudes especiales y fuera de cobertura siguen su derivación a la base.

## Una sola ruta de salida

`coordinator.ts` → `taxi_bot_commit` → `taxi_bot_outbox` → `engine.ts` → `sendTaxiMessage` → YCloud. El modelo no construye el mensaje de transporte ni reserva por compartir el pin.

`TaxiMessage.locationRequest` declara `origin` o `destination`; es incompatible con botones de respuesta. El commit valida el rol contra el borrador y guarda la revisión de sesión junto al mensaje, dentro de la misma transacción. El transporte produce `interactive.type=location_request_message`, `action.name=send_location` usando el endpoint de encolado existente; no se añadió otro remitente ni una plantilla de Meta.

Antes de reservar una salida y justo antes de enviarla, SQL comprueba revisión, rol pendiente, sesión de atención de 24 horas, ausencia de viaje activo y autorización del destinatario. Una salida reemplazada queda `failed/outdated_before_send`. Un mensaje que pierde permiso después del claim queda `failed/outbox_no_longer_permitted`. Timeout/5xx siguen siendo inciertos, sin reenvío automático; la aceptación del proveedor no acredita entrega física. Los botones ya entregados en WhatsApp no pueden retirarse: la recepción se interpreta con el estado actual y los campos se revisan en el resumen antes de reservar.

Contrato oficial: [YCloud — ejemplos de solicitud de ubicación](https://nndocs.ycloud.com/reference/whatsapp-messaging-examples). El formato sirve tanto al envío directo como al endpoint de cola que utiliza este bot.

## Error al editar contactos importados

Se reprodujo el rechazo `invalid_request_id`: 32 de los 33 identificadores importados son UUID válidos de PostgreSQL que no tienen los bits de versión/variante exigidos a un UUID de solicitud RFC. La lectura ya los admitía; `contact_save` y `account_save` los pasaban incorrectamente al validador de solicitudes.

`parseContactId` valida el mismo formato de entidad admitido por la lectura. Las solicitudes nuevas conservan `uuid(requestId)`, su idempotencia y sus controles de revisión/tenant. No se regeneraron identificadores, contactos ni correos. Las pruebas de edición y de vinculación de acceso ahora usan una entidad sintética con el formato importado; el request mal formado sigue rechazándose. La prueba del fallo original quedó en `.codex-tmp/contact-id-before.log`.

Durante la verificación el hash de contactos cambió y se observaron dos guardados recientes exitosos de identificadores importados en el registro de operaciones. No se revirtieron esas ediciones. Permanecen 33 contactos, 19 unidades GPS y las mismas 2,541 celdas H3/precios.

## Publicación y comprobación

- Migración local `20261030190000_taxi_native_location_request.sql`; historia remota `20261030154004`, nombre `taxi_native_location_request`. Cuatro cuerpos SQL cotejados con el candidato.
- Se respaldaron las fuentes activas y definiciones SQL. Las tres funciones se publicaron desde carpetas aisladas, sustituyendo sólo los archivos revisados; el resto conserva su versión activa por función. 56 fuentes de ejecución descargadas después coinciden con el candidato.
- Gate estático: 76 fuentes sin `any`, conversiones dobles ni supresiones. Entradas y tres paquetes aislados pasan `deno check`; panel y pruebas SQL pasan TypeScript estricto.
- Suite final: 4,893 casos Deno tipados y 97 casos Node/SQL/integración, cero fallos. Incluye cuatro recorridos nuevos con PostgreSQL, transporte nativo, replay, rollback, salidas antiguas, ventana vencida y revocación. El primer ensayo detectó la pérdida de un filtro de autorizados al preparar el claim; se corrigió conservando la versión vigente y se repitió la suite completa antes de publicar. Logs locales ignorados: `location-full-quality.log` y `location-final-quality.log`.
- `stellar-taxi-bot`, `wialon-bridge` y `bot-worker` online, cero reinicios antes y después. No se reinició ni modificó la configuración del VPS.

**Autorizados sigue vacío por instrucción del propietario.** El canal está habilitado, pero no atenderá clientes hasta que se agreguen números permitidos. No se envió una prueba física de WhatsApp ni se creó un viaje real con esta entrega.
