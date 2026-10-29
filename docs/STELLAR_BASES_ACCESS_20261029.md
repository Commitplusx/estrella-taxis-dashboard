# Carga y estado de las bases — 29 de octubre de 2026

## Causa y corrección

La ruta `/bot` conservaba el panel antiguo de comercio/voz. Consultaba `empresas` directamente desde el cliente publicable, aunque el proyecto independiente revoca el acceso de `anon` y `authenticated` a esa tabla. Mostrar el error como texto entendible no corregía la lectura: el `42501` seguía ocurriendo.

La misma ruta ahora administra las bases de taxi mediante `taxi-bot-admin`, con la identidad de Traccar comprobada por el servidor. El menú se llama **Bases y canales**. La pantalla muestra nombre, ciudad, plan y estado real, permite actualizar la consulta y abre la configuración del canal de la base elegida. El formulario heredado de otros giros y sus campos inexistentes en Stellar dejan de presentarse en esta instalación de taxis. Los autorizados y la configuración operativa siguen en el panel existente de WhatsApp.

- `companies_list`: máximo 100 bases, columnas explícitas y filtro por `tipo_negocio=taxi`. El superadministrador ve las bases; una cuenta de empresa sólo recibe la suya. El servidor rechaza registros ajenos al alcance esperado y una sesión ausente no accede a la tabla.
- `companies_set_active`: sólo superadministrador; valida identificador y booleanos. Escribe únicamente `activo` mediante PATCH condicionado por ID, giro y estado anterior. Una repetición con el estado solicitado ya vigente devuelve ese registro comprobado; una carrera de escritura devuelve conflicto. No hay actualización optimista ni éxito sin una representación guardada verificable.
- Los permisos SQL permanecen privados. No se añadieron políticas públicas, migraciones ni claves de servicio al navegador.
- El canal de WhatsApp conserva su activación independiente. Los errores de activación distinguen base inactiva, plan sin acceso a WhatsApp y transporte pendiente. Activar una base no demuestra que haya conductores, cobertura o un canal operativo.

## Publicación comprobada

Proyecto exclusivo: `izrsxygazsalfhpaualj`. Se respaldó la versión 13 de `taxi-bot-admin` en el directorio temporal `stellar-bases-before-20261029` y se publicó únicamente esa función como **versión 14, ACTIVE**, conservando la verificación propia de Traccar y `verify_jwt=false`. El empaquetador incluyó 17 archivos de dependencias; el archivo de tipos de flota sólo declara interfaces. Las fuentes activas descargadas de `handler.ts`, `store.ts` y `companies.ts` coinciden con el código revisado, normalizando CRLF para comparar.

En el navegador local, con la sesión existente del propietario, `/bot` cargó **Servicio de Taxis Pompeyo Express**, **Plan Pro con WhatsApp** y **Base inactiva**, sin error de permisos. El enlace abrió Configuración en el panel de WhatsApp con esa base seleccionada. Se comprobó la presencia del control de activación; esta revisión no activó la base ni guardó cambios del canal, creó viajes o envió mensajes. El canal observado contiene el teléfono local sin el código de país mexicano; debe contrastarse con la representación exacta de YCloud antes de encenderlo. No se sustituyó ese identificador durante esta corrección.

La publicación web se realiza en `main` del repositorio `Commitplusx/estrella-taxis-dashboard`; es independiente de la función Edge. El cambio no requiere desplegar otros workers ni actualizar el VPS.

## Verificación reproducible

- `deno check` de los puntos de entrada del bot y del administrador.
- 18 pruebas del handler, incluidas ocho nuevas de bases; 19 de administración; 5 de calidad; 5 de trazas; 22 de tracking: **69 aprobadas**.
- Runner de taxis: **4,846 pruebas Deno** y **67 pruebas Node/SQL aprobadas**; comprobación de tipos habilitada. Se actualizaron los dobles tipados del almacén para rechazar explícitamente escrituras administrativas no declaradas, sin conceder éxitos automáticos.
- Tipado estricto del panel mediante `tsconfig.taxi-admin.json`, que incluye ahora `/bot` y su cliente privado; tipado de las pruebas SQL.
- Build Vite y lint dirigido. Permanecen los avisos previos de tamaño del paquete/importación de mapas y hooks del editor H3; no acreditan un fallo de esta lectura.

Estas comprobaciones no son una conversación real ni una prueba de despacho de taxis.
