# Pompeyo: alta de conductores, número y cobertura

> Corrección posterior: [los hexágonos son propios de la base](STELLAR_BASE_OWNED_ZONES_20261029.md). Se retira la habilitación por canal que describía esta nota.

Proyecto independiente: `izrsxygazsalfhpaualj`. Superficie: panel React y `taxi-bot-admin`. No modifica Pollo Robin’s ni su worker.

## Ruta de operación

En **Bot de WhatsApp → Configuración → Conductores de esta base**, elegir una unidad real de Traccar, escribir el nombre y WhatsApp del conductor y guardar. El registro alimenta `conductores`, que consulta el bot. La pantalla general Conductores conserva su función de administración de Traccar; su registro por sí solo no habilita las ofertas del bot.

El alta usa la sesión de Traccar verificada, la empresa de `perfiles` y sus permisos. La API vuelve a consultar las unidades accesibles antes de guardar. Una unidad ya vinculada con otra empresa no se puede tomar. Operadores consultan; administración registra. Datos acotados a 500 conductores y 10 000 unidades, con error ante desbordamiento. Ediciones usan la huella del registro anterior; actor y solicitud hacen durable la repetición tras una respuesta perdida. Una oferta vigente o aceptada impide cambiar los datos del conductor; un WhatsApp activo no se duplica en dos unidades mediante este flujo.

El formulario muestra conductores activos y celdas H3 **guardadas para el canal**. Mostrar la cobertura en el mapa no equivale a guardar sus vínculos. El botón **Ver zonas y tarifas** abre la edición existente. La activación distingue conductor pendiente y zonas pendientes. Para tarifas por carretera, el formulario exige una tarifa base y un precio por kilómetro positivo.

## Corrección de número

País y número se capturan por separado, con una vista del valor que se guardará. México usa `+52`; se conserva el `1` si el identificador de YCloud usa explícitamente `+521`. Esta pantalla no registra un nuevo remitente en YCloud.

La corrección de un canal en pausa y sin conversaciones ni viajes usa `rename_channel`, conserva el mismo registro y mueve los vínculos H3 por FK `ON UPDATE CASCADE`. No altera precios propios, modelo, bloqueo de contactos ni creación del canal. Requiere revisión vigente y conserva la idempotencia después de mover el identificador. Si ya existe historial, exige un canal nuevo en lugar de reescribirlo. No se corrige ni activa automáticamente un número a partir de una suposición del país.

## Caché H3

Sólo se persiste cobertura completa y validada; nunca páginas parciales, fallidas o canceladas. Clave: proyecto, actor verificado, empresa, canal y fuente. La versión combina revisión del canal y UUID del catálogo de zonas, actualizado por trigger incluso cuando un precio cambia sin modificar el número de celdas. Cada página comprueba la misma versión. La sesión y el contexto se validan antes de leer la caché.

Límite: seis entradas, 1 Mi caracteres por entrada y 1.5 Mi caracteres en total, caducidad de siete días. Al cerrar o perder sesión se elimina la caché de cobertura. Si el navegador no permite almacenamiento, se consulta la red y se emite un aviso técnico acotado; no se finge un acierto de caché.

## Publicación y evidencia

- SQL local `20261029193220_taxi_bot_driver_setup.sql`; historial remoto `20261029194100`.
- SQL local `20261029194000_taxi_channel_edit_map_cache.sql`; historial remoto `20261029194000`.
- La API aplicó el segundo SQL pero respondió HTTP 400 sin registrar su historial. Se comprobaron las dos funciones activas contra el candidato y la FK antes de insertar exclusivamente la entrada de historial faltante con sus sentencias completas; no se volvió a ejecutar el DDL.
- Copia previa de funciones y Edge Function en `.codex-tmp/stellar-setup-before*` (archivos locales ignorados).
- `taxi-bot-admin` versión 15 activa, paquete revisado de 20 fuentes. Seguridad de Supabase: sin avisos de nivel warn/error antes y después.
- Pruebas: 4 860 Deno y 80 Node/SQL; 18 pruebas adicionales del handler administrativo; tipado estricto del panel y pruebas, puntos de entrada y build. Prueban contratos y persistencia; no acreditan un viaje físico ni entrega de WhatsApp.

En la comprobación previa de la base publicada había cero conductores y cero celdas vinculadas. No se agregaron conductores ficticios, no se activó el canal ni se enviaron mensajes durante estas comprobaciones.
