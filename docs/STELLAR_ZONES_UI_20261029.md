# Zonas y tarifas — operación y revisión del 29-10-2026

Extensión del panel existente de Stellar Tracking. Estado: web local y administrador del backend publicado; [destino y límites vigentes](STELLAR_ORGS_RELEASE_20261029.md).

> **Mapa completo y colores — corrección posterior:** se retiró la carga por viewport que rechazaba pantallas de más de 500 celdas y dejaba visible el fragmento anterior. `loadTaxiCoverage` recorre la API existente por cursor, sin búsqueda, con cancelación por base, hasta 100 páginas/10,000 celdas; verifica avance, duplicados, total estable e integridad antes de presentar el mapa completo. Para Pompeyo son 26 páginas y 2,541 celdas, dibujadas en Canvas sin nuevas consultas al acercar/alejar. El encuadre inicial y «Ver toda la cobertura» abarcan todas las celdas registradas. La suma de sus áreas es 40.233 km²; esto no certifica que cubran todos los límites urbanos.

> Cada zona tiene un color, compartido por sus celdas e indicador en la lista. Se reutiliza una paleta de 12 tonos entre zonas separadas, evitando coincidencias entre zonas vecinas: 3,464 comprobaciones de frontera en las 94 zonas, cero coincidencias. La selección conserva el color y lleva borde oscuro; borde discontinuo identifica zonas sin habilitar. Se aprobaron siete pruebas nuevas de carga/color, tipos estrictos y build. No se cambió la API, SQL ni tarifas de producción. La comprobación visual actual sigue pendiente por navegador desactivado en Work; las capturas anteriores no acreditan esta corrección.

> **Corrección posterior de Kaleb:** el archivo H3 corresponde a **Pompeyo**. La interfaz lo presenta como sus zonas y tarifas, con «Todas las zonas», «Listas para cotizar» y «Tarifa registrada»; se retiró «Catálogo existente». El preview identifica la base como Pompeyo y muestra las 2,541 celdas como cobertura de ejemplo, eliminando el subconjunto artificial de 37. Esta corrección no crea asignaciones ni activa un canal en producción. Build y tipos estrictos aprobados; revisión visual de esta última corrección pendiente porque el navegador devuelve «Local browser use is disabled in Work settings». Las capturas anteriores son históricas.

## Uso

1. Entrar con la cuenta de Traccar y abrir **Zonas y tarifas** en el menú. Ruta real `/zonas-tarifas`; el rol y la base se obtienen de la sesión verificada. Una cuenta sin base asignada no recibe una base por defecto.
2. Seleccionar base y canal. Si aún no existe, guardar la configuración con el número correcto y el canal pausado. Esto permite preparar cobertura sin atender conversaciones.
3. Buscar una zona por nombre, tocar celdas o marcar un área. Hay hasta 400 celdas por cambio. El mapa carga la cobertura completa una vez por base/vista y conserva todas las celdas al moverlo. La lista lateral mantiene 100 celdas por página y hasta 500 resultados; su búsqueda no recorta la cobertura dibujada.
4. Escribir nombre e importe MXN y pulsar **Guardar zona y precio**. El servidor valida importe, alcance, revisión y solicitud. La cobertura propia de la base se consulta después de guardar, con búsqueda limpia. Si el servidor guardó pero falla la actualización visual, se informa expresamente y se ofrece actualizar.
5. **Habilitar con la tarifa registrada** conserva nombres/precios registrados y no reemplaza ajustes que ya se guardaron. Quitar celdas afecta únicamente esa base/canal. Ver «Todas las zonas» no activa un canal de WhatsApp.
6. Marcar recogida y destino para comprobar el precio sin solicitar taxi. El cálculo usa la mayor tarifa de los dos extremos cubiertos y se comparte con el backend del bot.

Los cambios aplican sólo a la base elegida, según confirmó Kaleb. No cambian el catálogo compartido ni las tarifas de otra base. La vista DEV `/zonas-tarifas-diseno` contiene datos de demostración, no guarda ni envía mensajes y no se incluye como ruta pública de producción.

## Sistema conservado

- Paleta contrastada en `taxiBotAdmin.css`: tinta `#172337`, secundario `#536176`, borde `#dce3eb`, acción `#1d4ed8` y superficie suave `#eff5ff`.
- Tipografía heredada del panel; escala observada 28/21/17/15/13 px, con títulos diferenciados por peso.
- Mapa Leaflet/H3 como superficie de trabajo; columna de edición en escritorio y apilado bajo 760 px, con acceso a la selección en móvil.
- Botones y campos conservan su lenguaje existente, foco visible y estados deshabilitado/carga/error; radios observados 8 px en controles y 12 px en contenedores.
- El color identifica la zona y coincide con la lista; el borde distingue selección o falta de habilitación. El aviso de vista local permanece visible.

Se contrastaron App.tsx, Sidebar.tsx, TaxiBotAdminPage.tsx, TaxiZoneMap.tsx, la hoja de estilos y ambas capturas finales. Es una extensión ordinaria: no se creó ni sustituyó PRODUCT.md, DESIGN.md ni un sistema visual nuevo. No se canonizaron advertencias de hooks, tamaño de bundle o errores globales heredados como decisiones de diseño.

## Evidencia

Revisor fresco: **ship** para las dos correcciones puntuadas: P1 identidad entre cuentas y P2 recarga con búsqueda antigua. `bindTaxiAccount` descarta la credencial anterior, comprueba actor verificado y falla cerrado; una restauración fallida del contexto no reanuda automáticamente otra cuenta.

Capturas finales `.impeccable/review/zones-desktop.png` y `zones-mobile.png`: cartografía cargada; móvil 390 px sin desbordamiento horizontal, diez celdas seleccionadas, importe 65 y aviso de demostración. Esto no acredita guardado real. Backend nuevo contiene cero canales y perfiles no migrados: falta configurar una cuenta/base real para el recorrido autenticado.

4,840 Deno y 52 Node/SQL aprobadas, tipos estrictos panel/SQL y build aprobados; tipado global con fallos heredados y lint con advertencias. No hubo WhatsApp, viaje físico ni publicación web. El documentador delegado agotó su cuota; esta pasada se completó directamente siguiendo el rol degradado de documentación y preservando el diseño existente.
