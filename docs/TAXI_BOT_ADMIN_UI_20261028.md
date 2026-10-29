# UI del panel del bot de taxis — 28 de octubre de 2026

**Extensión local del dashboard existente, incluida la pestaña Calidad. Revisión visual final pendiente (`recapture`).** Esta nota describe el código actual; no acredita publicación, conexión de un número real, entrega de WhatsApp ni un viaje físico. Los contratos técnicos y el estado de publicación se conservan en `docs/TAXI_BOT_ADMIN_20261028.md` y `docs/TAXI_BOT_TRACE_STATE_20261028.md`.

## Overview

El modo de esta pantalla es **Operate**: elegir una base y su canal, consultar el catálogo H3, asignar cobertura, establecer tarifas, atender conversaciones y revisar intentos del bot. El mapa ocupa la mayor parte del editor de zonas; Calidad organiza totales, lista de intentos y revisión del caso. La configuración y los estados se expresan con etiquetas y acciones concretas en español.

Es una extensión del sistema visual incumbente, sin una nueva identidad. Se compararon `src/components/Layout.tsx`, `src/components/Sidebar.tsx`, `src/index.css`, `tailwind.config.js` y los patrones de `GeofencesPage.tsx` y `BotPage.tsx`. No había `PRODUCT.md` ni `DESIGN.md` en el proyecto inspeccionado. Este trabajo conserva sus archivos y documenta la pantalla en este alcance; no establece una marca nueva, ni crea un `DESIGN.md` o un sidecar global.

| Patrón existente | Aplicación en el panel de taxis |
| --- | --- |
| Inter, fondo claro, navegación blanca y acento azul | Hereda Inter y el fondo del `Layout`; usa el mismo azul primario para guardar, seleccionar y señalar la pestaña activa. |
| Páginas con título, explicación breve, superficies blancas y bordes grises | Encabezado «Bot de WhatsApp», selectores de base/canal y cuatro pestañas; mapa, formularios y detalle de Calidad en superficies delimitadas. |
| Geocercas combina mapa y panel de edición, con columnas que se apilan | Zonas y tarifas mantiene esa relación, con mapa principal y formulario/lista a la derecha en escritorio. |
| Navegación lateral fija en escritorio y cajón en móvil; página con desplazamiento propio | `/taxi-bot` se monta en el `Outlet` existente y añade «Zonas y bot de WhatsApp» al lateral. Conserva espacio inferior para la navegación móvil del dashboard. |
| Radios suaves y sombras ligeras en páginas existentes | El editor usa radios de 8/12 px, bordes y escasa elevación; las sombras locales se reservan para controles flotantes del mapa. |

## Colors

Los valores siguientes son los declarados en las fuentes; no son mediciones de estilos computados en un navegador final.

| Uso | Valor y fuente |
| --- | --- |
| Fondo del dashboard / superficie | `#F8FAFC` / `#FFFFFF`, en `src/index.css`, `Layout.tsx` y la configuración de Tailwind. |
| Acción principal | `#1D4ED8`, token `primary` de Tailwind y `--ta-blue` de `taxiBotAdmin.css`; hover local `#1E40AF`. |
| Texto / texto secundario / borde del editor | `--ta-ink: #172337`, `--ta-muted: #536176`, `--ta-line: #DCE3EB`. |
| Fondo de selección suave | `--ta-soft: #EFF5FF`; foco visible con contorno `#A9C4FF`. |
| Celda del catálogo sin asignar | Borde `#64748B`, relleno `#94A3B8`. |
| Celda asignada a la base | Borde `#0F766E`, relleno `#0D9488`; se presenta como «Verde: asignada». |
| Celda seleccionada | Borde `#1D4ED8`, relleno `#2563EB`; prevalece sobre los demás estados. |

`TaxiZoneMap.tsx` acompaña los colores con la clave textual «Gris: catálogo», «Verde: asignada», «Azul: selección». La opacidad del relleno es 0.23 para catálogo/asignadas y 0.5 para selección. La cartografía de OpenStreetMap recibe un filtro de escala de grises para mantener visibles las celdas. Recogida y destino tienen etiquetas propias, además de marcadores azul y violeta.

Calidad reutiliza los mismos valores locales `--ta-ink`, `--ta-muted`, `--ta-line`, `--ta-blue` y `--ta-soft`. La fila seleccionada tiene fondo suave y borde azul; el detalle es blanco y el mensaje recibido usa un fondo gris claro (`#F3F6FA`). Los estados conservan texto visible: el color no sustituye «En proceso», «Sin revisar» ni las etiquetas humanas. Estos usos no crean tokens globales.

## Typography

La familia del proyecto es `Inter, sans-serif`. Se conserva su importación global existente; esta extensión no incorpora otra fuente.

| Rol local | Declaración actual |
| --- | --- |
| Título principal | 28 px, línea 1.2, peso 750; pasa a 24 px a 760 px o menos. |
| Encabezado de sección | 21 px, línea 1.3, peso 700. |
| Encabezado de bloque | 17 px, peso 700. |
| Texto de la pantalla | 15 px, línea 1.5. |
| Etiquetas / ayuda | 14 px y peso 600 / 13 px y línea 1.5. |
| Importe destacado | Entrada de 23 px; resultado cotizado de 22 px; cifras tabulares en precios. |

La explicación de cada sección tiene un ancho máximo de aproximadamente 64–65 caracteres. Los nombres y precios de la lista tienen jerarquía propia; la cantidad de celdas y el origen de la tarifa se presentan como información secundaria.

En Calidad, los totales usan 20 px y peso 700; los subtítulos internos, 16 px y peso 700. Fechas, citas y notas usan 13 px; las huellas técnicas usan 12 px. Las cifras conservan números tabulares y los textos/huellas extensos permiten partirse dentro del contenedor. Estas son declaraciones de las fuentes, pendientes de comprobar en el render final.

## Layout

El editor tiene ancho máximo de 1700 px, margen horizontal automático, padding de 28 px y reserva inferior de 110 px. El `Layout` existente mantiene el contenedor de 100dvh, el lateral blanco de 18rem y el desplazamiento vertical de la página. Su encabezado global está oculto en el código actual; el título de la pantalla está dentro del editor.

| Ancho | Comportamiento declarado |
| --- | --- |
| Escritorio | Mapa flexible y lateral de 350 px, separados por 22 px. El mapa mide `min(64vh, 670px)` con mínimo de 420 px. |
| Desde 1600 px | Lateral de 390 px. |
| Hasta 1100 px | Lateral de 310 px, separación de 16 px y padding de página reducido. La barra de canal permite varias líneas. |
| Hasta 760 px | Mapa, formulario y lista se apilan. Mapa de 440 px; herramientas en dos columnas; enlace «Editar … celdas seleccionadas» hacia el formulario. Configuración y conversaciones pasan a una columna. |
| Hasta 700 px | Selector de origen del catálogo y sus totales se apilan. |

La lista de zonas tiene desplazamiento acotado a 460 px, o 420 px en móvil. Las conversaciones usan lista y detalle en escritorio; en móvil la lista queda arriba con altura máxima de 330 px. Estas reglas existen en CSS; el comportamiento de la versión final a 1440, 609 y 390 px todavía requiere capturas válidas.

Calidad tiene reglas propias dentro de este shell. Los cuatro totales ocupan cuatro columnas y pasan a dos a 1100 px o menos. Sin caso seleccionado, la lista ocupa el ancho disponible; con un caso, escritorio muestra lista y detalle en columnas, aproximadamente 1:2. A 1100 px reduce separación y columnas; contexto, campos interpretados y correcciones pasan a una columna.

A **720 px o menos**, Calidad muestra lista o detalle: abrir un intento oculta la lista y «Volver a los intentos» permite regresar. El detalle reduce su padding de 24 a 18 px; el botón de consultar y la ayuda horaria ocupan líneas completas. Esta navegación no hereda el apilado de lista y detalle de Conversaciones. Falta verificar visualmente tanto la lista como el caso a 390 px y el cambio de composición a 609 px.

## Elevation & Depth

Las superficies del editor se separan con fondo blanco y borde de 1 px. No hay una elevación general nueva para cada bloque. Los elementos superpuestos del mapa usan sombras locales: `0 4px 18px #23344a18` para leyenda/centro y `0 5px 20px #23344a20` para cerrar un área. La navegación y sus sombras siguen perteneciendo al `Layout` y `Sidebar` existentes.

## Shapes

Los campos y botones principales usan radios de 8 px; mapa, barra de canal y formularios usan 12 px. El sistema existente también emplea radios de 12/16 px en páginas y navegación. El editor mantiene esa familia de formas sin convertir sus valores locales en un cambio global de tokens.

## Components

### Entrada y contexto

- Ruta autenticada: `/taxi-bot`, dentro del dashboard y restringida a la superficie de taxis.
- Ruta de desarrollo: `/taxi-bot-diseno`. Se muestra sin el `Layout` autenticado y con un aviso explícito de datos de ejemplo. No guarda ni envía mensajes.
- «Base» y «Canal de WhatsApp» permanecen visibles antes de las pestañas. El estado escrito «Canal activo/apagado» acompaña al indicador de color.
- «Nuevo canal» y las ediciones dependen de permisos. Guardar la configuración y activar la atención son pasos diferenciados; si el servidor no está listo se permite guardar el canal apagado.
- La navegación tiene cuatro pestañas, en este orden: «Zonas y tarifas», «Conversaciones», «Calidad» y «Configuración». Usa el mismo indicador azul de pestaña activa y desplazamiento horizontal cuando falta ancho; no abre otra aplicación. Calidad requiere un canal seleccionado y su estado local se remonta al cambiar base/canal.

### Zonas y tarifas

El selector «Mostrar» comienza en «Catálogo H3 existente» y permite cambiar a «Asignadas a esta base». Ver el catálogo no asigna cobertura. Los totales representan todas las celdas y nombres de la consulta, con independencia de lo cargado en la lista o el mapa.

La instantánea local `src/lib/fixtures/taxiH3Catalog.preview.json` contiene **2,541 celdas y 94 nombres distintos**; se comprobó su conteo durante esta documentación. Procede del archivo H3 del proyecto y no prueba el catálogo activo del servidor. La base, el canal y las 37 asignaciones de la vista de desarrollo son sintéticos. El catálogo de ejemplo se importa sólo en desarrollo.

La lista consulta 100 celdas por página mediante cursor, admite búsqueda por nombre y conserva como máximo 500 resultados. El mapa solicita hasta 500 celdas de la parte visible al acercarse o desplazarse; no pretende renderizar toda la ciudad a la vez. Cada fila indica «celdas en esta página», para no confundir el grupo cargado con toda una zona. Elegir una fila lleva el mapa a su primera celda.

«Elegir celdas» y «Marcar área» preparan una selección de hasta 400 celdas por cambio. «Guardar zona» establece nombre/precio para esta base. «Usar selección en esta base» conserva nombres/precios del catálogo y los overrides existentes. «Quitar selección de la cobertura» pide confirmación y retira sólo la asignación actual. Cambiar de base, canal u origen del catálogo limpia la selección y los datos que ya no corresponden a ese contexto.

«Prueba el precio de un viaje» usa recogida y destino exactos, muestra el resultado o la causa de falta de tarifa y no solicita un taxi. El cálculo H3 usa el precio mayor de los extremos; puede probarse con el canal apagado. No hay una cotización de éxito inventada cuando falta cobertura.

### Configuración y conversaciones

Los campos de configuración tienen etiquetas visibles. El número de un canal existente es de sólo lectura; otro número requiere un canal nuevo. «Por zonas H3» y «Base + distancia por carretera» muestran los campos que corresponden al modo elegido.

Conversaciones comunica el intervalo de 30 días y el límite de 50 contactos por consulta; el detalle contiene hasta 12 mensajes. La atención manual y el envío tienen acciones explícitas. «Poner mensaje en cola» no equivale a entrega: se presentan por separado cola, envío, aceptación del proveedor, entrega, lectura, fallo y resultado incierto. El borrador está ligado a tenant/canal/contacto; el formulario de configuración también se remonta con una clave que incluye el tenant.

### Calidad: consultar un periodo

«Revisar y aprender» permite consultar hasta 31 días, con los últimos siete días como periodo inicial y la aclaración «Horario de esta computadora». «Consultar periodo» aplica las fechas; «Datos consultados» muestra el corte realmente devuelto, aunque después se editen los campos sin aplicar otra consulta. El estado de carga dice «Consultando…»; una consulta fallida muestra el error y «Volver a consultar». La lista vacía explica que no hay intentos en esas fechas.

Los cuatro totales distinguen intentos procesados, intentos con fallo/interrumpidos, solicitudes de atención humana y errores de interpretación revisados. El desplegable adicional separa fallos del intérprete, intentos sustituidos/en proceso y transiciones de mensajes. Los intentos se cuentan por inicio, las revisiones por fecha de revisión y los reintentos por separado. Las solicitudes de atención son señales para revisar; no acreditan errores. Los estados de mensajes son transiciones observadas, no mensajes únicos; aceptación del proveedor, entrega y lectura permanecen separados. No se calcula precisión ciega, conversión, abandono ni costo a partir de estos contadores.

El operador puede consultar los agregados de su base/canal autorizado. La cuenta administradora puede además listar, abrir y revisar casos privados. La UI recibe ese permiso desde el contexto autenticado; el servidor valida identidad y alcance por separado y no acepta un revisor elegido por el navegador. El cliente reutiliza `taxi-bot-admin` mediante `quality`, `quality_attempts`, `quality_trace` y `quality_review`; valida las respuestas externas antes de presentarlas. Este panel no añade una exportación masiva de mensajes ni acceso directo a las tablas privadas.

### Calidad: lista y caso privado

La lista consulta hasta 20 intentos por página, conserva como máximo 100 en pantalla y ofrece «Ver intentos anteriores». El cursor usa fecha e ID, conservando la precisión de la fecha del servidor. Cada fila muestra hora, estado, fases anterior/posterior y etiqueta o «Sin revisar»; no incluye texto del cliente, teléfonos ni partición de contacto. Consultar la lista no marca contactos como inspeccionados.

Los estados se presentan como «En proceso», «Procesado», «Sustituido por un mensaje nuevo», «Falló el intento» e «Intento interrumpido». Un estado posterior ausente se presenta como «Sin cambio confirmado». Abrir un caso muestra «Abriendo el caso…» y, si falla, permite «Volver a abrir el caso». La selección mueve el foco al detalle una vez cargado. Abrirlo muestra contenido privado y marca el contacto como inspeccionado; la advertencia explica que ya no puede contar como evidencia ciega futura.

El detalle sigue el orden mensaje recibido → contexto anterior desplegable → interpretación y citas → consultas/validación → resultado confirmado por el servidor → revisión. Un caso admite hasta 20 mensajes actuales, 12 entradas de historial y 12 pasos. El contexto incluye datos previos y precio registrado cuando existen; los pasos exponen resultado, duración, código y, si corresponde, tarifa o cantidad de candidatas. Una propuesta válida no se confunde con el estado persistido. La ausencia de interpretación o consultas tiene una explicación explícita. El panel no muestra razonamiento interno del modelo.

### Calidad: revisión y procedencia

La revisión requiere elegir explícitamente «Interpretación correcta», «Error de interpretación», «Error de reglas del servidor», «Fallo de un servicio externo» o «No hay información suficiente». No se puede aprobar una interpretación inexistente ni revisar un intento aún en proceso. Al reabrir se conserva la etiqueta y la expectativa de la revisión existente.

«Error de interpretación» abre intención y campos de nombre, recogida y destino con el fragmento literal que respalda cada dato. Los campos ausentes se dejan vacíos; una corrección posterior prevalece. La corrección usa la validación estructurada del intérprete antes de enviarse. Guardar liga la etiqueta al mensaje, contexto y cuenta verificada; no modifica automáticamente instrucciones, pesos ni partición del contacto.

Durante «Guardando…» se bloquean fechas, lista, revisión, base, canal y pestañas. El comando conserva UUID de solicitud y revisión para mantener idempotencia. Un fallo de transporte deja «No se confirmó el guardado» y «Comprobar revisión», que reenvía el mismo comando; no presenta éxito ni permite cambiar de contexto mientras falta comprobarlo. Un rechazo definitivo o conflicto obliga a «Actualizar el caso antes de revisar». Un guardado confirmado informa «Revisión guardada» y vuelve a consultar los totales/lista. El comando pendiente sólo vive en memoria y activa un aviso al cerrar/recargar; no hay persistencia del formulario privado en almacenamiento local ni promesa de recuperarlo tras cerrar la pestaña.

«Origen y versión del caso» despliega la partición fija —entrenamiento, validación o reserva—, modelo, versión del motor, huella de instrucciones y huellas de origen. Las huellas permiten relacionar versiones/fuentes; no acreditan exactitud del modelo ni anonimato del texto. Abrir o etiquetar no mueve el contacto entre particiones.

En la ruta **sólo DEV** `/taxi-bot-diseno`, Calidad declara que mensajes y cifras son inventados. Usa un caso sintético, un modelo de ejemplo, huellas de ejemplo y una revisión guardada únicamente en memoria de esa vista. Permite recorrer consulta, apertura, formulario y confirmación local; no consulta conversaciones reales ni envía una revisión al servidor. Esta vista no demuestra los fallos de transporte, permisos reales, estados del proveedor ni una inferencia real del modelo.

### Estados, foco y tamaños de interacción

Hay estados de carga, falta de base/canal, lista vacía, error, guardado confirmado y guardado pendiente de comprobar. Errores usan `role="alert"`; avisos y ayuda del mapa usan `role="status"`. Las herramientas indican selección mediante `aria-pressed`; la pestaña activa usa `aria-current`. El foco local tiene contorno de 3 px y separación de 3 px. Las transiciones de color de 0.18 s se desactivan con `prefers-reduced-motion`.

Los campos, botones principales/secundarios, selector de catálogo y acción del centro del mapa declaran un mínimo de 44 px. **El objetivo de controles de al menos 44 px no se cumple todavía en todos los auxiliares:** botones de texto, quitar cobertura y herramientas de escritorio declaran 42 px; cerrar/cancelar el área, 40 px; cerrar el aviso, 32 px. Las herramientas móviles sí declaran 44 px. Los controles propios de Leaflet no se han medido en un render final. Estas diferencias quedan registradas sin reparar código fuera del alcance documental.

Calidad conserva ese mínimo declarado de 44 px en campos y acciones heredadas, filas de intento y desplegables. Sus errores usan `role="alert"`, carga/confirmación usan `role="status"`, el caso anuncia `aria-busy` y la fila seleccionada usa `aria-pressed`. Los desplegables tienen foco visible y se desactiva la transición de botones con movimiento reducido. Esto documenta el código; aún no certifica navegación por teclado, anuncio de lectores de pantalla ni dimensiones computadas del conjunto.

## Do's and Don'ts

- Conservar Inter, el shell y la navegación incumbentes cuando se amplíe esta pantalla; sus estilos locales no autorizan un rediseño del dashboard.
- Mantener base/canal, origen del catálogo y estados explícitos antes de una acción. Conservar la distinción entre consultar catálogo y asignarlo a una base.
- Mantener los límites de lista, viewport y edición, y explicar los resultados parciales. El total completo no equivale al contenido actualmente renderizado.
- Conservar las etiquetas, las ayudas y las causas de error; no convertir cola, guardado incierto o vista de ejemplo en éxito confirmado.
- En Calidad, mantener el corte temporal, los permisos y la advertencia de inspección antes de abrir contenido privado. Conservar el mismo comando al comprobar un guardado incierto y las citas literales al corregir una interpretación.
- No convertir solicitudes de atención o estados del proveedor en errores confirmados, ni una revisión del caso en entrenamiento automático.
- No atribuir aprobación visual final a las capturas históricas ni al detector estático.

### Evidencia comprobada y pendientes

Se leyeron las fuentes actuales `TaxiBotAdminPage.tsx`, `taxiBotAdmin.css`, `TaxiZoneMap.tsx` y `TaxiChannelForm.tsx`, el enrutado de `src/App.tsx`, el cliente/vista de ejemplo, las fuentes incumbentes indicadas arriba y `docs/TAXI_BOT_ADMIN_20261028.md`. Se contó la instantánea local y se comprobó que `.impeccable/review/taxi-detect.json` contiene `[]`.

Esta ampliación documental cotejó `TaxiQualityPanel.tsx`, `taxiQualityPanel.css`, `taxiQualityClient.ts`, `qualityContracts.ts`, su integración/permisos en `TaxiBotAdminPage.tsx`, el límite DEV de `src/App.tsx` y `docs/TAXI_BOT_TRACE_STATE_20261028.md`. `.impeccable/review/taxi-quality-detect.json` contiene `[]`. El resultado estático no comprueba composición, legibilidad ni interacción en un navegador.

El detector inicial `taxi-detect.json` precede a dos correcciones funcionales de aislamiento: borrador por tenant/canal/contacto y clave del formulario con tenant. La revisión fresca de esas dos correcciones las dio por resueltas; esto no constituye una aprobación visual del conjunto. El manifiesto técnico complementario es `docs/TAXI_BOT_ADMIN_EVIDENCE_20261028.json`.

Se inspeccionaron los logs existentes `.codex-tmp/taxi-quality-panel-tests.log` y `.codex-tmp/taxi-quality-panel-build.log`: **4,782 pruebas Deno + 45 casos PostgreSQL/PGlite = 4,827 aprobados**, gate de 37 archivos, comprobación de tipos de entradas y panel/pruebas estrictos; build de Vite aprobado. El build mantiene los avisos preexistentes de importación de Maps y tamaño del bundle global. Este pase documental no volvió a ejecutar esas comprobaciones. Los casos sintéticos y contratos no son inferencias reales ni una medida de comprensión del modelo.

`.impeccable/review/taxi-desktop.png`, `taxi-mobile.png` y `taxi-user-609.png` son capturas históricas de 1440, 390 y 609 px anteriores a Calidad y a las adiciones actuales del catálogo. No certifican su carga, totales, controles, desbordamiento, cartografía ni composición final. No se presentan como capturas nuevas en esta nota.

La disposición formal vigente del revisor fresco es **`recapture`**. Requiere capturas finales a 1440 px, 390 px con lista y caso, y 609 px; las capturas anteriores no incluyen Calidad. La adquisición del navegador fue rechazada automáticamente por la política de URL; no se intentó otra ruta para eludirla. Falta obtener esas capturas válidas y someterlas a una revisión completa. También quedan pendientes la comprobación con una cuenta/base reales, navegación/foco y tamaños computados en el render final. Las pruebas funcionales, el build y el detector no sustituyen esta evidencia. Este pase documental no ejecutó nuevas pruebas ni abrió un navegador, y no publicó, conectó WABA, activó canales ni probó el modelo real.
