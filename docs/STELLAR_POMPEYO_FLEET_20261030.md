# Flota y contactos de Pompeyo — 30 de octubre de 2026

Destino: proyecto independiente `izrsxygazsalfhpaualj`, web `https://stellar.estrella-eats.mx`. Esta nota reemplaza los estados anteriores de canal apagado y consumidor sin iniciar.

## Estado comprobado

El canal de Pompeyo terminado en 2491 está habilitado, revisión 5. Se corrigió el prefijo mexicano con el número exacto devuelto por YCloud, conectado y con calidad GREEN. El endpoint de YCloud está activo y apunta a `ycloud-webhook` del proyecto independiente. Los hashes de clave de proveedor y firma coinciden con la configuración que introdujo el propietario en Supabase. No se cambiaron esos secretos.

La empresa y su plan están activos e incluyen WhatsApp. Se conserva el acceso cerrado: un cliente autorizado, terminado en 9156. Activar el canal no abre el bot a todos los contactos importados. No se enviaron mensajes, ofertas ni viajes de prueba durante esta entrega.

Se registraron las **19 unidades reales de Traccar** en `taxi_base_units`, con pertenencia única por ID de dispositivo y FK de `conductores`. El vínculo con la base no exige inventar un WhatsApp. El IMEI no interviene en esta relación. No se copiaron los teléfonos de chips GPS a conductores. El vínculo histórico de un solo conductor Traccar con todas las unidades no se tomó como evidencia de quién conduce cada taxi.

El consumidor dedicado `stellar-taxi-bot` está online en PM2, con ciclos `taxi_tick` exitosos, sin errores ni reinicios en la comprobación. Arranque guardado con `pm2 save`. Configuración privada en `/opt/stellar-taxi-bot/config/worker.env`, modo 0600, directorio 0700. Release `/opt/stellar-taxi-bot/releases/20261030-pompeyo`, tres fuentes verificadas por SHA-256 y `deno check`. Endpoint exclusivo del proyecto correcto. Robin’s y `wialon-bridge` conservaron sus procesos/PID durante la activación.

Una sonda firmada sin identidad ni contenido de cliente llegó hasta `parseInbound` y fue rechazada con HTTP 400 `invalid_taxi_message`, después de comprobar firma, canal activo, transporte y plan. La expectativa inicial de la sonda decía `invalid_taxi_event`; se corrigió la interpretación contrastando el punto exacto de validación. No creó evento, sesión, outbox ni viaje y no demuestra una conversación física.

## Importación y edición

Fuente proporcionada por Kaleb: `OPERADORES.xlsx`, hoja `Hoja1`, filas 2–34. **33 contactos / 21 números económicos**, teléfonos y nombres comprobados fila por fila tras importación. El original se conserva sin modificar; se eliminaron espacios de los teléfonos al capturarlos y se guardan huella de archivo y fila de origen. No se agregan nombres ni teléfonos privados al repositorio.

La fuente no diferencia dueños, conductores y otros empleados. **32 contactos quedan “Por confirmar”**, sin ofertas. Un contacto coincide exactamente por teléfono con el conductor que el propietario ya había registrado para la unidad GPS 4; se conserva ese vínculo y su condición de conductor. Un teléfono de origen tiene nueve dígitos y queda incompleto, visible para corregirlo. Las 21 unidades económicas del Excel no son los 19 IDs GPS: los demás cruces requieren identificación explícita en el panel, no una aproximación por nombres repetidos.

Ruta: **Bot de WhatsApp → Configuración → Conductores y dueños**. Busca nombre o número de unidad y pulsa **Editar**. Puedes corregir nombre, número económico, teléfono, rol y GPS; añadir un contacto y elegir quién recibe ofertas. Roles: Por confirmar, Conductor, Dueño, Dueño y conductor, Otro empleado. Sólo Conductor/Dueño y conductor con teléfono válido y GPS propio pueden recibir ofertas. Registrar al dueño no lo convierte en destinatario de viajes.

El guardado usa la sesión real de Traccar, los permisos de base y RPC privada con revisión e idempotencia. Otra base no puede tomar el contacto o el GPS. Cambiar quién recibe ofertas usa el mismo `taxi_bot_driver_apply` y conserva sus controles de oferta/servicio pendiente. La modificación del contacto y del conductor se confirma en una sola transacción; un conflicto revierte ambos. El Excel no cambia la asignación activa existente ni las 2,541 celdas H3/tarifas de Pompeyo.

## Publicación y verificación

- `20261030134513_taxi_base_fleet.sql`: historial remoto `20261030135107`.
- `20261030135906_taxi_base_contacts.sql`: historial remoto `20261030141448`.
- `taxi-bot-admin` v17 ACTIVE. Paquete cerrado de 21 archivos; 19 fuentes runtime descargadas coinciden, el bundler elimina una importación sólo de tipos. Cinco funciones SQL de contactos y tres de flota comprobadas contra fuentes revisadas.
- RLS y privilegios privados en las tablas nuevas; sin alertas WARN/ERROR del asesor de seguridad después del despliegue.
- 67 pruebas SQL/integración, 28 pruebas del handler de conductores/contactos y 18 del administrador aprobadas. Tipado estricto del panel/pruebas/entrada y gate de 70 fuentes aprobados. Pruebas de UI con contactos sintéticos en escritorio y móvil, sin desbordamiento horizontal. No acreditan un guardado autenticado físico ni recepción de WhatsApp.
- Respaldo local privado antes de cada mutación, IDs de solicitudes, inventario verificado, importación por huella y lecturas posteriores bajo `.codex-tmp/`, excluido de Git.

La recepción física, la sesión efectiva del usuario de servicio de Traccar y un viaje completo siguen sin prueba real. Se conservaron los contratos del puente GPS activo; esta entrega no certifica sensores de ocupación ni sus unidades de velocidad. Las pruebas no autorizan ofertas a contactos sin rol y unidad confirmados.
