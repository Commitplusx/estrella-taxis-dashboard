# Publicación de Stellar / Pompeyo en GitHub — 29 de octubre de 2026

Repositorio: `Commitplusx/estrella-taxis-dashboard`, rama `main`.

Este conjunto incluye el bot transaccional de taxis, acceso por clientes autorizados, panel de zonas y tarifas H3 por base, mapas OpenStreetMap, aislamiento del proyecto independiente y sus pruebas. El bot de esta instalación pertenece a Servicio de Taxis Pompeyo Express.

La configuración del navegador se encuentra en `deployment/stellar/web-public.json`: URL del proyecto independiente y clave **publicable**. Permite compilar desde un checkout limpio sin depender de archivos locales. Las variables `VITE_STELLAR_*` pueden reemplazarla, pero la validación rechaza otros proyectos y claves privadas. Supabase documenta que las claves publicables están diseñadas para código de navegador y repositorios: https://supabase.com/docs/guides/getting-started/api-keys.

No se incluyen archivos `.env`, credenciales privadas, estado de la CLI, carpetas extraídas ni cambios pendientes de comercio ajenos a este conjunto. Las migraciones originales y las tres de arranque del proyecto independiente conservan sus rutas; el empaquetador de Stellar define el conjunto y el orden de publicación. No se debe ejecutar un push indiscriminado de migraciones históricas de otras aplicaciones.

La publicación de código en GitHub es independiente de Supabase, VPS y alojamiento web. El estado remoto comprobado antes de esta subida está documentado en `STELLAR_AUTHORIZED_CUSTOMERS_20261029.md`: funciones publicadas y acceso restringido, bot desactivado, sin canal ni conductor de producción. Subir este commit no activa el bot ni envía mensajes.

Validación aprobada sobre una copia exacta del índice de Git, sin `.env` locales: compilación Vite, control estático de 63 archivos del bot, comprobación Deno de los puntos de entrada, proyectos TypeScript específicos y 4,966 pruebas (4,846 Deno del bot, 67 Node/SQL del bot, 40 Deno de tracking y 13 Node de mapas/tracking). Las evidencias de publicaciones anteriores conservan su fecha y alcance. La comprobación de tipos de todo el repositorio conserva errores previos fuera del conjunto de Stellar; los puntos de entrada del bot y los proyectos TypeScript específicos tienen comprobación separada.

La compilación conserva avisos de tamaño del paquete principal y de importación de mapas en páginas heredadas. No se comprobó visualmente el navegador ni una entrega física de WhatsApp como parte de esta subida.
