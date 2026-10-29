# Stellar Tracking en Estrella orgs — 29 de octubre de 2026

> **Publicación posterior vigente:** [clientes autorizados de Pompeyo](STELLAR_AUTHORIZED_CUSTOMERS_20261029.md). Novena migración `20261029165842`, tres tablas privadas nuevas; administrador v10 y webhook/consumidor v9. Un cliente autorizado terminado en 9156, acceso cerrado a clientes no listados. El bot sigue apagado, sin canales/conductores ni viajes. El resto de esta nota conserva el historial de la publicación inicial.

Estado vigente: **SQL y cinco funciones Edge publicados en el proyecto independiente; interfaz web disponible en local; bot sin activar**. Este documento prevalece sobre las notas anteriores de destino pendiente o de Estrella envios. Evidencia: [manifiesto de publicación](STELLAR_ORGS_RELEASE_EVIDENCE_20261029.json).

> **Corrección de presentación posterior:** Kaleb confirmó que las 2,541 celdas H3 son de Pompeyo. El editor local ya dice «Zonas de Pompeyo» y «Todas las zonas»; la demostración deja de limitarse a 37 asignaciones artificiales. El código interno conserva los contratos de lectura y el aislamiento por base. No se aplicaron asignaciones de producción ni cambios a la API con esta corrección de interfaz. Evidencia separada: `STELLAR_POMPEYO_COPY_EVIDENCE_20261029.json`; los hashes/capturas de la publicación inicial conservan su valor histórico.

> **Corrección posterior de visualización:** [mapa completo y colores por zona](STELLAR_ZONES_UI_20261029.md). El frontend ahora carga todas las celdas registradas mediante la API paginada existente y las conserva al alejarse; se eliminó el límite visual de 500. Coloración sin coincidencias entre zonas vecinas del archivo, botón para ver toda la cobertura y siete pruebas nuevas. Sólo código local, sin despliegue de API/SQL ni alteración de tarifas. Evidencia: `STELLAR_POMPEYO_MAP_EVIDENCE_20261029.json`.

## Destino confirmado

Kaleb eligió un proyecto independiente en **Estrella orgs** (`zttiaomkvlgbhntgwral`). El destino es **Stellar Tracking**, `izrsxygazsalfhpaualj`, región `us-east-1`, estado ACTIVE_HEALTHY al crearlo. Organización Free y cotización inicial USD 0; esto no garantiza consumos futuros. [Panel del proyecto](https://supabase.com/dashboard/project/izrsxygazsalfhpaualj).

App Estrella (`zqwiqhdvwkvoufkdjbhm`) se inspeccionó de sólo lectura y conserva sus datos de comida/reparto. El primer Stellar de Estrella envios (`ynqphaxvoauzmqsempis`) queda como instalación anterior separada, con bot deshabilitado; no se eliminó. Robin’s, Eats y operaciones de reparto conservan sus proyectos. El cliente local bloquea esos destinos y sólo acepta la URL y clave pública del Stellar seleccionado.

## Base y funciones

Se comprobaron **24 tablas públicas con RLS, 2,541 celdas H3 y 94 nombres de zona**. Hay una empresa de taxis preparada inactiva, cero canales, cero conductores, cero viajes y cero triggers en la cola heredada. No se copiaron clientes, perfiles ni credenciales de restaurantes. Consultar el catálogo no activa cobertura.

Ocho migraciones aplicadas, con correspondencia de fuente, SHA-256 y versión remota en el manifiesto. Sólo se instalaron el bootstrap de proyecto vacío y los contratos revisados de taxis; no ejecutar indiscriminadamente el historial del repositorio.

Durante la tercera migración la API informó un error después de que el SQL ya hubiera quedado aplicado. Un intento controlado confirmó la relación existente. Antes de registrar su historial con el endpoint oficial de migraciones, se comprobaron las **13 funciones** contra sus cuerpos locales, normalizando CRLF para el hash. Se registró la migración existente sin volver a ejecutar su SQL. No se conservó el cuerpo del primer error: no se afirma una causa concreta de ese fallo. Las migraciones siguientes se aplicaron secuencialmente y con lectura posterior del historial.

Funciones activas: `ycloud-webhook`, `process-queue`, `ai-insights` y `calculate-driving-scores` versión 1; `taxi-bot-admin` versión 2. El administrador incluye plan validado y `actorId` de Traccar verificado. Se respaldó la versión anterior y se descargó la versión activa: los SHA-256 de `handler.ts` y `adminContracts.ts` coinciden con las fuentes locales. El empaquetado contiene únicamente dependencias revisadas de cada entrada.

Comprobación HTTP: contexto administrativo sin sesión devuelve **401 missing_session**; webhook y consumidor devuelven **503 taxi_disabled**. `verify_jwt=false` delega en la autenticación específica del endpoint; no autoriza lectura pública de tablas privadas. Los asesores consultados devolvieron «No issues found»; no se presenta esa respuesta como auditoría completa del producto.

## Zonas y tarifas en la web

Ruta autenticada: `http://127.0.0.1:5290/zonas-tarifas`, entrada visible **Zonas y tarifas** en el menú. Se reutiliza el editor existente de `/taxi-bot`. [Uso y revisión visual](STELLAR_ZONES_UI_20261029.md).

El administrador elige base/canal, selecciona hexágonos o un área, cambia nombre y precio y guarda mediante `taxi_bot_admin_apply`. Las tarifas se guardan **sólo para esa base/canal**; el catálogo compartido y las demás bases permanecen separados. Las próximas cotizaciones utilizan esos valores. La operación comprueba identidad, alcance, revisión e identificador de solicitud; un operador puede consultar pero no cambiar precios. La comprobación de identidad del navegador rechaza mezclar la cookie de una cuenta con el token de otra.

Como todavía no se registró un canal real, primero hay que guardar su configuración con el número correcto y dejarlo pausado; después se pueden editar zonas sin activar WhatsApp. No se creó un canal ficticio para aparentar un guardado real. La regla de precio vigente es la mayor tarifa entre recogida y destino, ambos cubiertos; no se usa el hexágono cercano como sustitución de uno sin tarifa.

La vista `http://127.0.0.1:5290/zonas-tarifas-diseno` usa catálogo local y asignaciones de demostración, avisa que no guarda ni envía mensajes y sólo existe en desarrollo. Las capturas de escritorio/móvil acreditan esa vista, no un guardado autenticado. La interfaz React **no se publicó en Vercel ni GitHub** en esta entrega.

## Verificación y límites

Runner `estrella-taxis-backend/scripts/test-taxi-bot.ps1`: **4,840 Deno + 52 Node/SQL aprobadas**, gate de 51 fuentes sin tipos inseguros, comprobación Deno de entradas, tipos estrictos del panel y pruebas SQL aprobados. Se cubren aislamiento, tarifas por base, revisiones, idempotencia, fallos de commit y cuentas cruzadas. Son pruebas sintéticas y PostgreSQL/PGlite, no miles de conversaciones reales ni una medición de precisión.

Build Vite aprobado, con avisos heredados de bundle superior a 500 kB y `mapsLoader`. Lint dirigido sin errores y con advertencias de hooks. El tipado global aún informa errores heredados en AnimatedMapMockup, pushNotifications, traccarApi, BotPage, DevicesPage y GeofencesPage; no se declara limpio.

La revisión fresca resolvió los dos hallazgos concretos: vincular la sesión al actor y evitar recargar con una búsqueda anterior tras guardar. Disposición **ship**, limitada a ese lote. Capturas `.impeccable/review/zones-desktop.png` y `zones-mobile.png`, mapa cargado, sin desbordamiento horizontal a 390 px. El documentador delegado agotó su cuota antes de escribir; se completó la documentación directamente, conservando el sistema visual incumbente.

## VPS, GPS y activación pendiente

Consumidor instalado en `/opt/stellar-taxi-bot/releases/20261029-v3/`, con tipado comprobado y **sin iniciar**. Los archivos públicos de este despliegue se conservan en `/opt/stellar-taxi-bot/docs/`. No se cambió ni reinició el worker de Robin’s. Salud comprobada: `bot-worker` y `wialon-bridge` online sin reinicios, Traccar activo y `/health` del worker HTTP 200.

GPS sigue **Wialon → puente → OsmAnd 5055 → Traccar/MySQL**. No se activó el forward a Supabase. El puente vigente no fue sustituido: quedan pendientes verificar ocupación desconocida, respuesta HTTP, correspondencia de las unidades y contrato de velocidad antes de despachar taxis reales.

**La revisión automática rechazó generar/guardar/configurar las claves privadas con «blocked by policy», sin más motivo. No se reintentó por otra vía.** El bot y consumidor continúan deshabilitados. Faltan configuración privada autorizada, canal exacto, asignación de cuentas/unidades y prueba acotada real antes de habilitar. No se enviaron WhatsApps ni se crearon viajes en esta publicación.
