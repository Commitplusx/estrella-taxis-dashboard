# Base independiente de Stellar Tracking — 29 de octubre de 2026

> Actualización del 31-10-2026: [la ocupación desconocida ya no se convierte en libre y queda excluida del despacho](STELLAR_GPS_OCCUPANCY_20261031.md). Las cifras y versiones anteriores se conservan como historial.

> **Destino posterior confirmado:** [Stellar Tracking en Estrella orgs](STELLAR_ORGS_RELEASE_20261029.md), proyecto `izrsxygazsalfhpaualj`. Esta página y su JSON conservan el historial del primer proyecto en Estrella envios; ya no representan el destino del cliente local. El bot sigue sin activar.

Estado comprobado: **proyecto creado y SQL/Edge publicados; bot sin activar**. Este documento sustituye las notas anteriores de publicación pendiente únicamente para los componentes enumerados aquí. No acredita una conversación, reserva ni notificación real.

> **Aclaración posterior de cuenta:** la nueva sesión CLI sólo accede a **Estrella orgs / App Estrella**, otra app con datos de comida/reparto. [Inspección y elección pendiente de destino](APP_ESTRELLA_ACCOUNT_INSPECTION_20261029.md). No se cambió el destino ni se mezclaron las bases; la publicación descrita aquí sigue perteneciendo a Estrella envios.

## Destino

- Organización elegida por Kaleb: **Estrella envios** (`mbyjnogrvtptsdpgwtqr`), plan Free.
- Proyecto nuevo: **Stellar Tracking** (`ynqphaxvoauzmqsempis`), región `us-east-1`. Cotización devuelta al crearlo: USD 0 mensuales; no es una garantía sobre consumo futuro.
- [Panel del proyecto](https://supabase.com/dashboard/project/ynqphaxvoauzmqsempis).
- Robin’s permanece en su proyecto original. El proyecto existente de operaciones de Estrella envios también permanece separado. No se copiaron clientes, perfiles, pedidos, credenciales de mensajería ni disparadores del checkout.
- El catálogo H3 sí se importó desde una consulta acotada del origen comprobado: **2,541 celdas / 94 nombres de zona**, resolución 10 y precios de 45 a 100. Es catálogo disponible, no cobertura ni tarifas de una base activadas.

## Publicado y verificado

La base nueva contiene **24 tablas con RLS**. Las tablas privadas no conceden acceso a `anon`/`authenticated`; las operaciones del panel pasan por funciones que comprueban sesión de Traccar y alcance. No se añadieron políticas permisivas para hacer funcionar pantallas antiguas.

Se aplicaron, en orden, el bootstrap exclusivo de proyecto vacío, integridad de tracking y los cuatro contratos de taxis, seguidos de dos ajustes de permisos/índices. Supabase MCP registra versiones remotas distintas de los nombres locales; la correspondencia está en el manifiesto de evidencia. No ejecutar todas las migraciones históricas del checkout contra esta base nueva.

Funciones publicadas, versión 1 activa: `ycloud-webhook`, `process-queue`, `taxi-bot-admin`, `ai-insights`, `calculate-driving-scores`. El paquete incluye sólo dependencias transitivas revisadas, sin el router ni arranque del bot de restaurantes. `verify_jwt=false` delega la autenticación en firma HMAC, clave privada del consumidor o sesión de Traccar, según endpoint; no significa acceso anónimo a operaciones de negocio.

Comprobaciones HTTP sin credenciales: webhook y consumidor devuelven `503 taxi_disabled`; una petición inválida al administrador devuelve `400 invalid_admin_request`. La ausencia de canal impide procesar conversaciones. La base tiene una empresa de taxis preparada **inactiva**, cero canales, cero conductores, cero viajes y cero triggers de la cola heredada.

Después de los ajustes, los asesores no mostraron alertas WARN/ERROR. Sólo aparecen avisos INFO: RLS sin políticas en tablas privadas y ausencia de uso de índices en un proyecto recién creado. [Referencia de RLS privado](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) y [referencia de índices sin uso](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

## VPS y GPS

El consumidor revisado está instalado en `/opt/stellar-taxi-bot/releases/20261029-v3/`, **sin arrancar**. Se verificó su hash y `deno check`. No se modificó ni reinició `/opt/bot-worker` ni el proceso de Robin’s. El manifiesto distingue instalación de activación.

La ruta GPS activa comprobada es **Wialon → puente PM2 `wialon-bridge` → OsmAnd 5055 → Traccar**. Traccar conserva sus posiciones en MySQL; separarlo del Supabase de Robin’s no implica duplicar posiciones en otra base. `forward.enable` permanece deshabilitado. La IA consulta sólo las unidades autorizadas mediante la API de Traccar.

El puente activo sigue siendo el anterior; no se sustituyó por el candidato local. La revisión encontró riesgos pendientes: ocupación desconocida convertida en libre, confirmación de envío sin revisar el estado HTTP y 18 elementos declarados frente a 17 dispositivos de Traccar. La correspondencia entre unidades/choferes debe verificarse antes de asignar. Tampoco se debe cambiar la unidad de velocidad hasta comprobar el contrato Wialon/OsmAnd del servicio activo.

## Clientes y configuración pendiente

El cliente web **local** ya exige URL y clave publicable del proyecto nuevo mediante `VITE_STELLAR_SUPABASE_URL` y `VITE_STELLAR_SUPABASE_PUBLISHABLE_KEY`. Rechaza volver a los proyectos de restaurantes/operaciones mediante un override. La clave privada nunca forma parte de `VITE_*`. El build local aprobó; **no se publicó la web**.

Esto no migra automáticamente todas las pantallas históricas: `AuthContext` y páginas heredadas con consultas directas necesitan adaptar sus contratos al acceso autenticado de tracking. No se deben abrir tablas a anónimos para conservar esos accesos. La APK Flutter sigue sin cambiar ni compilar, conforme a la prioridad de trabajar primero la IA.

Para activar faltan:

1. Sesión de CLI con acceso a Estrella envios o configuración administrativa equivalente de secretos. El conector usado para SQL/Edge no expone gestión de secretos ni el correo de la cuenta. No extraer secretos mediante SQL o una función temporal.
2. Claves propias del canal de taxis y de su firma, clave del consumidor, credenciales de consulta de Traccar y proveedores de IA/mapas. No reutilizar la clave YCloud de Robin’s: la comprobación disponible no mostró el número de Pompeyo en esa cuenta.
3. Registrar canal/base exactos y la correspondencia autorizada de unidades, conductores y WhatsApps; configurar sus zonas y tarifas revisadas.
4. Evaluación acotada con el modelo configurado, pruebas de fallo y un recorrido real autorizado con contactos propios; después habilitar canal/empresa y consumidor. Distinguir aceptación del proveedor, entrega/lectura y aceptación del conductor.

No se enviaron mensajes ni se crearon viajes durante esta separación. No se declaró una prueba física por haber pasado simulaciones.

## Reproducción y evidencia

`deployment/stellar/project.json` fija el proyecto y bloquea los tres destinos ajenos. El bootstrap se niega a ejecutar sobre un proyecto con tablas de Robin’s/operaciones. `package-stellar-functions.ts` construye cierres de dependencias por AST para los cinco entrypoints admitidos.

Runner: `estrella-taxis-backend/scripts/test-taxi-bot.ps1`; resultados y hashes en `STELLAR_DATABASE_SEPARATION_EVIDENCE_20261029.json`. Las pruebas sintéticas y de SQL validan contratos, aislamiento y fallos; no miden precisión de IA en producción.
