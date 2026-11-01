# Siguiente confirmación de prueba → Ana Karen 0540

Actualización posterior del mismo día: la página y el backend del conductor ya se publicaron por autorización posterior; ver `STELLAR_DRIVER_TRIP_WEB_20261101.md`. La excepción de asignación descrita aquí se conservó armada y sin consumirse al activar el enlace. La nota inferior documenta la etapa inicial de armado.

Por solicitud expresa de Kaleb se armó una excepción de **un solo servicio** para el cliente terminado en9156, canal de Pompeyo terminado en2491, tenant `4cf9acf1-f07e-4a01-9396-eb5bde3e7411`, proyecto Stellar `izrsxygazsalfhpaualj`. La unidad0540 es el device4 y su chofer actual tiene WhatsApp terminado en1852.

Publicación: únicamente el hook SQL revisado `deployment/stellar/target-next-test-trip.sql` y una fila privada de configuración. No se publicó la página del conductor, la migración `20261101160000`, funciones Edge, web, APK ni otro proyecto. No se creó un viaje ni se envió una oferta durante la preparación. El resumen anterior del cliente ya estaba vencido: necesita obtener uno vigente y tocar su botón normal de confirmación.

La regla se armó a2026-11-01T14:36:41.40864Z y admite una siguiente confirmación hasta2026-11-01T15:06:41.40864Z. Sin consumirse, después vence y deja de afectar al selector. Se vincula atómicamente al primer viaje confirmado de ese cliente creado después de armarla. No crea viajes antes del consentimiento, no cambia precios, no acepta por el conductor, no modifica turnos ni inventa GPS.

El hook sustituye los candidatos sólo para ese servicio y conserva los controles nativos de conductor activo, oferta vigente, teléfono, reserva y viaje ocupado. La oferta sigue durando3 minutos y Ana Karen debe aceptarla. Las rondas posteriores del mismo viaje permanecen limitadas a esa unidad: nunca se expande a otros taxis. Cuando el servicio termina o se cancela, la regla consumida no se aplica al siguiente servicio. Las demás personas y canales conservan el algoritmo habitual.

La tabla `taxi_bot_test_targets` y el helper `taxi_bot_test_candidates` son privados, sin grants para anon/authenticated/service_role. Sólo la administración de mantenimiento puede armar reglas. Es una operación puntual registrada, no una migración aplicada al historial ni un nuevo endpoint público.

Verificación:3 pruebas PostgreSQL aisladas con tipos (consentimiento, destino único, rondas, finalización nativa y segundo servicio normal; vencimiento/permisos; unidad no disponible sin fallback). Tipado estricto de pruebas SQL y gate157 archivos aprobados. Ensayo sobre esquema real con ROLLBACK y hashes conservados. Al armar: chofer activo, sin viaje u oferta vigentes de0540, cliente autorizado y sin otro viaje activo. Lectura posterior: armado/no consumido, device4, RLS/grants privados y cero salidas pendientes/inciertas.

Función original `taxi_bot_dispatch_offer`: MD5 `a4af3771f318b245c16cccfde36fe601`; activa con hook: `cb595438742cb4aa1a32d370594d45d6`. Respaldo local de definición original: `C:/Users/Kaleb/AppData/Local/Temp/stellar-targeted-test-before.sql`. No reemplazarla sin volver a comparar el hash: otra publicación posterior puede haber cambiado su lógica. Tras el COMMIT, una consulta auxiliar intentó leer una columna inexistente de metadatos; no se repitió la instalación. Una consulta independiente confirmó que la transacción ya estaba aplicada y la regla correctamente armada.

Pendiente: confirmación real del cliente, recepción y aceptación del chofer, finalización y limpieza controlada del hook. No se declaran esos pasos ejecutados por haber preparado la excepción. Conservar el vínculo y recibos hasta revisar el resultado; no cambiar el estado del viaje directamente para dar una prueba por terminada.
