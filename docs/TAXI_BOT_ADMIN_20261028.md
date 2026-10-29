# Panel del bot de taxis y catálogo H3 — 28 de octubre de 2026

> **Actualización 29-10-2026:** [Zonas y tarifas con entrada propia](STELLAR_ZONES_UI_20261029.md) y [publicación en Estrella orgs](STELLAR_ORGS_RELEASE_20261029.md). API v2 publicada, SQL y catálogo comprobados; React local, bot pausado. Las notas siguientes conservan el candidato anterior.

> **Actualización local v2 — 28-10-2026:** [Trazabilidad, máquinas de estados y revisión supervisada](TAXI_BOT_TRACE_STATE_20261028.md). Nueva cuarta migración `20261028160342`, necesaria antes de ejecutar el motor nuevo. Sin publicar ni conectar un canal real. Las notas de pruebas anteriores se conservan como historial.

**Candidato local. Sin publicar, activar canales ni enviar mensajes reales.** La base y el número definitivo todavía no fueron proporcionados. Las capturas anteriores a la incorporación del catálogo son históricas; la comprobación visual final quedó pendiente por rechazo automático del navegador (política de URL). No se intentó eludirlo.

## Entrada y uso

- Panel autenticado: `/taxi-bot`, dentro del dashboard existente, apartado «Zonas y bot de WhatsApp».
- La pestaña **Calidad** consulta los agregados del periodo y, con permisos de administración, permite abrir un intento y revisar su interpretación. Lista acotada a 20 por página, revisión con UUID/revisión, sin aprendizaje automático ni mensajes reales en la vista de diseño. Contrato y comprobaciones actuales en [trazabilidad y revisión supervisada](TAXI_BOT_TRACE_STATE_20261028.md).
- Vista local: `http://127.0.0.1:5290/taxi-bot-diseno`. Sólo existe en desarrollo, no guarda cambios ni envía mensajes. La base, canal y sus 37 asignaciones son sintéticos.
- La vista local lee una instantánea de `supabase/h3_limpio.sql`: **2,541 celdas H3 distintas, resolución 10, 94 nombres de zona**. No es una lectura de producción. La instantánea no se incluye en el build de producción.
- «Catálogo H3 existente» muestra el catálogo del servidor. «Asignadas a esta base» muestra sólo cobertura del tenant/canal elegidos. Sus totales cuentan todas las celdas/nombres, independientemente de la página o viewport actual.
- Lista de 100 celdas por página mediante cursor; buscador por nombre. El cliente conserva hasta 500 resultados de lista y el mapa carga hasta 500 celdas de la parte visible. Acercarse o desplazarse solicita otro viewport, no toda la ciudad.
- Elegir celdas o dibujar un área (hasta 400 por cambio). «Usar selección en esta base» conserva los nombres/precios del catálogo; no reemplaza tarifas propias ya existentes ni asigna automáticamente todas las zonas globales.
- «Guardar zona» establece nombre y precio particulares de esta base. Las celdas nuevas no requieren crear/modificar una zona global. «Quitar selección» retira sólo asignaciones de esta base.
- Prueba de precio con recogida/destino exactos: usa el mismo cálculo H3 del bot (mayor precio entre ambos extremos), sin solicitar taxi. Funciona también con el canal pausado. Ambos extremos deben estar asignados y dentro de la cobertura configurada.
- Conversaciones: últimos 30 días, hasta 50 contactos/viajes por consulta; muestra hasta 12 mensajes al elegir un contacto. Atención manual invalida el consentimiento anterior y detiene una respuesta del bot en curso. Mensaje manual sólo en modo humano, canal activo y ventana de 24 horas. «En cola», aceptación del proveedor, entrega y lectura son estados diferentes.

## Contratos y aislamiento

React → `taxi-bot-admin` → identidad Traccar verificada → perfil/tenant del servidor → `taxi_bot_admin_read` o `taxi_bot_admin_apply`. No se descarga la flota para autenticar este panel.

Administrador Traccar consulta bases de taxis; `admin_empresa` administra su empresa; `operador` consulta la suya y puede tomar/responder conversaciones, pero no editar configuración/zonas. El navegador no decide actor ni amplía tenant. WABA y empresa se verifican antes de consultar o mutar. RPC privadas sólo para `service_role`; no se expone esa clave al cliente.

Guardados con UUID duradero, revisión esperada y una transacción. Reentrega idéntica devuelve el resultado previo; datos distintos con el mismo UUID o revisión antigua no escriben. Un resultado incierto conserva la solicitud exacta y bloquea otras ediciones hasta comprobarla. El modo de diseño nunca presenta éxito ficticio. Sin reintentos ilimitados.

`taxi_bot_h3_cells.label` / `price_cents` son overrides por tenant/WABA. Si no hay override, se lee `h3_zonas`; no se duplica el catálogo ni se cambia su precio al asignarlo. La cotización usa contención exacta, sin vecino ni precio por defecto. El commit vuelve a bloquear/revisar canal, cobertura y tarifa; un cambio incompatible revierte viaje, ofertas y outbox.

## Publicación pendiente

Todo sigue local: React, Edge y estas tres migraciones candidatas se publican por separado y de forma revisada:

1. `20261027220000_taxi_bot_transactions.sql`.
2. `20261027223402_taxi_bot_h3_pricing.sql`.
3. `20261028145826_taxi_bot_admin_zones.sql`.

No activar el consumidor entre migraciones. Comparar primero esquema/fuentes activos, respaldar y ensayar la secuencia completa. Configuración Edge `verify_jwt=false` usa autenticación privada Traccar explícita; no equivale a acceso anónimo. Activación además exige runtime configurado, plan activo con WhatsApp (`incluye_whatsapp`; la función de voz `incluye_bot` es independiente), conductor activo y cobertura H3. No introducir claves privadas desde el formulario. La disponibilidad real del transporte requiere prueba posterior, no queda acreditada por tener variables configuradas.

La lectura remota del catálogo no fue autorizada por MCP: no se declara verificado el número activo de celdas ni se sustituyó por otra ruta. Sin VPS, APK, cambios al bot de Robin’s ni publicación a GitHub.

## Verificación local

- Runner `estrella-taxis-backend/scripts/test-taxi-bot.ps1`: 89 pruebas Deno + 32 PostgreSQL/PGlite/integración, **121 aprobadas**; gate de tipado seguro, entrypoints Deno y tipos estrictos del panel/SQL aprobados.
- 40 regresiones de tracking aprobadas por compartir la autenticación.
- Build Vite aprobado. Avisos heredados de bundle mayor de 500 kB y carga dinámica inefectiva de `mapsLoader`; no se atribuye optimización global del dashboard a este panel.
- Catálogo completo recorrido con cursor, buscador y viewport; no activa cobertura al consultarlo. Asignación original, override conservado, aislamiento, pérdida de respuesta/reentrega, revisión antigua, permisos y cambio de cobertura antes del commit comprobados en PostgreSQL aislado.
- Tres regresiones de permisos conservan el fallo previo y la corrección: WhatsApp autorizado sin voz puede recibir/activarse; voz sin WhatsApp no puede.
- La revisión fresca encontró dos cruces de borrador al cambiar contacto/base; se corrigieron y el revisor verificó ambos resueltos por fuente. Falta comprobación interactiva final.
- Lint dirigido sin errores, con advertencias React de dependencias/ref y estado sincronizado en efectos; no se suprimieron ni se declara lint limpio.
- Detector UI dirigido sin hallazgos. Primera ronda visual histórica revisada en 1440, 609 y 390 px; actualización final del catálogo pendiente de captura/revisión por bloqueo del navegador. No hay prueba con cuenta/base reales, modelo real, entrega/lectura de WhatsApp ni viaje físico.

Evidencia y hashes: `TAXI_BOT_ADMIN_EVIDENCE_20261028.json`. Logs locales en `.codex-tmp/taxi-admin-final.log`, `taxi-admin-tracking.log`, `taxi-admin-build.log`.
