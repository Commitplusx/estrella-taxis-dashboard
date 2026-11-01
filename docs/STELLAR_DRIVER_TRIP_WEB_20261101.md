# Viaje del chofer desde WhatsApp — candidato del 1 de noviembre de 2026

Implementación preparada **sólo para Stellar Tracking** (`izrsxygazsalfhpaualj`). Kaleb eligió dejar lista la publicación por ahora: **no se aplicó esta migración, no se desplegó el endpoint ni la web y no se activó el enlace en producción**. Los viajes reales conservan el comportamiento publicado anterior. No se enviaron WhatsApp ni se crearon viajes reales de QA.

## Experiencia

1. El chofer acepta su oferta vigente de la forma habitual. La asignación sigue siendo atómica y la primera aceptación válida gana.
2. Cuando se habilite el canal, su recibo mostrará pasajero/destino y un botón nativo **Ver mi viaje**, sin precio. El cliente conserva su enlace de seguimiento independiente.
3. La página muestra unidad, pasajero, punto de recogida, referencia y destino; si hay coordenadas de destino también aparecen en el mapa. El mapa muestra puntos, no promete ruta vial calculada, navegación ni ETA.
4. **Ya llegué** queda visible abajo. El backend registra la llegada una vez y encola un aviso al cliente para que salga. No finaliza el viaje. La pantalla diferencia aviso pendiente, aceptado por proveedor, entregado/leído o fallo incierto.
5. **Finalizar servicio** pide confirmación explícita y llama a la misma transición SQL usada por el botón de WhatsApp. Termina el viaje y libera su reserva; no obliga a enviar una cortesía fuera del presupuesto existente.

El enlace se abre en el navegador que el usuario tenga configurado para WhatsApp; el bot no puede forzar su navegador interno. No requiere instalar otra aplicación ni introducir contraseña. No hay prueba física de apertura o entrega en WhatsApp todavía.

## Estado y seguridad

- `driver_web_enabled=false` por defecto: desplegar SQL aisladamente no cambia los recibos actuales.
- Token privado de64 caracteres hexadecimales, distinto al del cliente, en el fragmento URL. Se almacena sólo su SHA256 y vence en24horas. La outbox privada conserva el enlace necesario para enviar el mensaje, igual que otros datos de entrega; no se debe publicar en logs.
- Endpoint `driver-trip` POST; el token viaja en JSON. GET, vista previa y carga de página no realizan transiciones. El token es una credencial: quien reciba el enlace puede usarlo mientras siga vigente, por lo que no debe reenviarse.
- Se comprueban tenant/canal/plan activo, oferta aceptada, unidad asignada y teléfono del chofer vigente. Un cambio de turno, vencimiento, cancelación o pausa impide nuevas acciones.
- Tablas privadas con RLS sin acceso directo de anon/authenticated/service_role; únicamente RPC específicas para service_role. Lectura y mutación no aceptan tenant elegido por el navegador.
- Orden de bloqueo viaje→oferta→chofer. Una llegada y una finalización como máximo por enlace, recibos duraderos e idempotencia por UUID; un UUID no puede cambiar de acción.
- Doble clic, recarga o respuesta perdida no duplican el aviso. Tras resultado incierto se comprueba/reintenta con el mismo UUID. Abrir un enlace viejo no reabre viajes terminales.
- El aviso de llegada se registra como cambio operativo adicional al presupuesto ordinario de5 mensajes. Se suprime antes de enviar si el viaje ya se canceló/finalizó. Una pausa no puede retirar un mensaje entregado al proveedor.
- No se muestran teléfono del pasajero ni tarifa en esta página. No existen escrituras optimistas, éxito ficticio ni reintento automático ilimitado.
- La confirmación ahora persiste las coordenadas de destino ya validadas del borrador; antes sólo persistía las del origen. El destino escrito/omitido sigue permitido.

## Verificación local

- Matriz SQL completa:185 pruebas aprobadas con la migración candidata; después se agregó y aprobó una sexta prueba específica de vinculación tenant/chofer/acción nula. Las6 específicas también se ejecutaron juntas. Son186 casos SQL únicos verificados; no se afirma otra ejecución completa después de agregar el último caso.
-22,708 pruebas tipadas de conversación/backend/entradas y contratos de la nueva API/CTA, sin proveedor ni modelo real.
- Tipado estricto del nuevo frontend y de pruebas SQL; `deno check` del endpoint y entradas del worker/webhook. Gate estático157 archivos sin any, conversiones dobles ni supresiones.
- Build Vite correcto. El `tsc -b` global sigue fallando en archivos anteriores ajenos a esta entrega (mapa animado, push, Devices/Geofences/Notifications/Orders/Settings); los archivos nuevos pasan su proyecto estricto. No se ocultan esos errores ni se declara sano todo el panel.
- Navegador headless:390×844 y1280×900, sin errores de página ni desbordamiento. Llegada con respuesta perdida reutiliza UUID, apertura sólo lee, finalización confirma y la confirmación no desaparece al sondear. Vista de enlace inválido a320px sin desbordamiento. Capturas con datos sintéticos y tiles públicos de OSM.
- Revisión de diseño: ambos ajustes solicitados quedaron resueltos (`ship` limitado a esos ajustes): botón de llegada accesible en el primer viewport y metadatos debajo del título. Se conserva el sistema visual existente; no se reescribe DESIGN.md.

## Publicación preparada, todavía pendiente

1. Confirmar el proyecto de Supabase anterior y la cuenta de Vercel que administra **deiffs-projects/estrella-taxis-dashboard**, dominio `stellar.estrella-eats.mx`. La sesión CLI disponible sólo tiene acceso a PIEDAD: no vincular ni crear un proyecto allí. No se publicó por GitHub.
2. Respaldar/descargar y comparar funciones activas `process-queue` y `ycloud-webhook`, además de los cuerpos SQL que toca la migración. Conservar las variantes de autenticación activas. Revisar sólo los archivos de esta entrega.
3. Ensayar la migración `20261101160000_taxi_driver_trip_web.sql` con ROLLBACK sobre el esquema activo; sus guardas deben coincidir. Aplicar sólo esa migración revisada a Stellar con gate desactivado. No copiar todo el historial de otros proyectos al workspace enlazado.
4. Publicar `driver-trip` con `verify_jwt=false` (capacidad privada validada dentro del handler). Publicar los consumidores revisados `process-queue`/`ycloud-webhook` con el nuevo transporte CTA, manteniendo sus opciones activas de autenticación. El runner VPS actual sólo llama a `process-queue`: se comprobó que no contiene un segundo runtime de envío; no necesita copiar toda la carpeta ni reiniciarse por este cambio.
5. Publicar la web revisada en el proyecto Stellar correcto. Verificar `/driver-trip`, headers no-store/no-referrer/noindex y bundle; token falso debe dar404 sin escribir. Verificar métodos, RLS/grants, pausa y salud del consumidor.
6. Sólo cuando web/API/transporte estén comprobados, habilitar `driver_web_enabled` para el tenant/WABA de Pompeyo verificado (sufijo2491), con revisión de canal incrementada. No cambiar el teléfono, tenant, allowlist ni plan. No activar todos los canales con un UPDATE sin filtro.
7. Prueba física coordinada con cliente/chofer autorizados: aceptación, botón, mapa, llegada única, aviso realmente recibido y finalización. Guardar hashes/versiones/salud y evidencia de entrega separada del acuse del proveedor.

Si hace falta suspender, la pausa existente del canal bloquea nuevas acciones/avisos. Desactivar sólo `driver_web_enabled` devuelve los recibos futuros al flujo anterior y deja las páginas existentes pausadas; no borrar tablas, viajes ni recibos para revertir.
