# Revisión visual del simulador en Mapa en Vivo — 2026-10-31

El dictamen final de la revisión de correcciones es **SHIP**, limitado a los tres hallazgos puntuados de esta intervención. Los tres quedaron resueltos. Este registro no declara aprobada toda la superficie, la totalidad de sus estados ni una publicación en producción.

## Alcance y autoridad

La superficie es `/map`, mediante el botón existente de comparación con icono de cerebro. La corrección explícita del usuario sobre su ubicación prevalece: el simulador extiende Mapa en Vivo y utiliza su mismo mapa; no constituye otra pestaña del Bot. La autoridad de producto y composición está en `PRODUCT.md` y `.impeccable/surfaces/src-pages-mappage-tsx.md`.

Se contrastaron los archivos heredados `src/pages/MapPage.tsx`, `src/pages/fleetMap.css` y `src/pages/taxiBotAdmin.css` con `src/components/FleetSimulationPanel.tsx`, `src/components/TaxiSimulationPanel.tsx`, `src/components/taxiSimulation.css` y la corrección de navegación de `src/components/Layout.tsx`. `src/index.css` aporta la fuente global. Esta revisión documenta la integración terminada y la disposición final del revisor; no amplía la tarea a una auditoría o reparación general del panel.

## Evidencia de herencia visual

| Aspecto | Fuente existente | Aplicación observada en la extensión |
| --- | --- | --- |
| Paleta | `taxiBotAdmin.css`: tinta `#172337`, texto secundario `#536176`, borde `#dce3eb`, azul `#1d4ed8` y fondo suave `#eff5ff`. El mapa mantiene controles blancos y grises. | El drawer lleva `taxi-admin`, reutiliza esas variables y los botones `taxi-primary`/`taxi-secondary`. El azul destaca ejecución, selección y comparación. Las capturas conservan el mapa y la barra lateral existentes. |
| Tipografía | `index.css`: Inter con respaldo sans-serif. `taxiBotAdmin.css`: base de 15 px/1.5, títulos de 21 y 17 px y etiquetas de 14 px. `fleetMap.css`: etiquetas de unidad de 11 px, peso 600. | No se introduce una familia nueva. El panel emplea controles y resultados de 13–15 px, subtítulos de 17 px y título interno de 19 px; ese título permanece accesible aunque su bloque se oculte visualmente en la variante integrada. La barra superior visible identifica la comparación. |
| Espaciado y forma | El administrador ya utiliza controles de al menos 44 px, campos y botones de radio 8 px, contenedores de radio 14 px y separación de 7–24 px. | Se mantienen esos tamaños y radios. El drawer usa 16 px de margen interior para contenido y una barra de cierre de 44 × 44 px. Las divisiones suaves y el espacio agrupan recorrido, escenario y resultados. No se declara una nueva escala global. |
| Mapa e iconos | `MapPage.tsx` y `fleetMap.css`: OpenStreetMap, vehículos existentes, controles Lucide y fondo cartográfico gris. | El panel recibe `externalMap`: origen, destino y posición hipotética se editan sobre el mapa existente, sin duplicarlo en el drawer. Los enlaces de candidatos son azules; el texto de decisión explica la elegibilidad y no la deduce del verde de un marcador GPS. |
| Adaptación | El lienzo de Mapa en Vivo y la navegación siguen siendo los existentes. | En escritorio el drawer se sitúa a la derecha, con ancho máximo de 570 px y desplazamiento propio. A 1100 px o menos pasa a hoja inferior de hasta el 58 % de la altura, dejando mapa visible arriba. Los controles compactos de cierre y ejecución permanecen fijos dentro del desplazamiento. |

No existían `DESIGN.md` ni `.impeccable/design.json` al documentar este cambio. Es una carencia previa de documentación, no autorización para crear una identidad visual global. Esta extensión ordinaria no aprueba un mundo visual nuevo ni un cambio duradero del sistema; por ello se registra la herencia aquí y se preserva esa ausencia, sin inventar tokens, metáforas o prohibiciones globales.

## Disposición final de los hallazgos

| Hallazgo puntuado | Corrección y evidencia | Disposición |
| --- | --- | --- |
| La navegación inferior móvil podía reaparecer sobre el simulador al desplazar. | `MapPage.tsx` solicita ocultarla mientras la herramienta está abierta en móvil. `Layout.tsx` conserva un bloqueo explícito y evita que el manejador de scroll lo revierta. Las capturas móviles finales muestran la hoja sin navegación superpuesta, tanto al inicio como en resultados desplazados. | Resuelto. |
| Cerrar y ejecutar dejaban de estar al alcance al bajar a resultados. | En `taxiSimulation.css` la barra superior usa `position: sticky; top: 0` y el encabezado con ejecución usa `position: sticky; top: 65px`. Las capturas finales de resultados conservan ambos controles visibles en escritorio y móvil. | Resuelto. |
| El icono de búsqueda y su campo quedaban desalineados por el estilo de etiquetas heredado. | La regla específica restituye la fila, centra el SVG verticalmente y reserva 37 px a la izquierda del campo. Las capturas finales de resultados muestran el icono y el texto alineados, incluido el estado de foco. | Resuelto. |

El **SHIP** corresponde a esta disposición de tres correcciones. No convierte otros componentes, estados o comportamientos no puntuados en aprobados por extensión.

## Evidencia visual y límites de verificación

Se inspeccionaron las siguientes capturas finales locales de `/map`:

- `.impeccable/review/map-desktop.png`: 1440 × 1000, drawer y mapa compartido.
- `.impeccable/review/map-user-1830.png`: 1830 × 981, ancho real del usuario.
- `.impeccable/review/map-mobile.png`: 390 × 844, hoja inferior y mapa visible arriba.
- `.impeccable/review/map-desktop-results.png`: 1440 × 1000, resultados desplazados, controles fijos y búsqueda con foco.
- `.impeccable/review/map-mobile-results.png`: 390 × 844, resultados desplazados y búsqueda con foco, sin navegación inferior superpuesta.

Estas imágenes contienen GPS real y datos privados de la flota. Permanecen como evidencia local: no se copian, incrustan ni incorporan al commit mediante este documento. Tampoco se transcriben sus coordenadas, nombres de unidades o datos personales.

La sesión de verificación tenía `prefers-reduced-motion: true` a nivel del sistema. Por ello la reproducción normal de las animaciones no se observó físicamente. En fuente, las líneas de candidatos tienen una duración de 1.2 s por ocho repeticiones, 9.6 s en total, y se desactivan con movimiento reducido; la entrada del drawer dura 0.22 s y también se desactiva. El ajuste del mapa y el desplazamiento hacia el editor consultan esa preferencia. Esto prueba el límite declarado en código, no una observación de la animación normal en ejecución.

El detector automático se ejecutó una sola vez antes de trasladar la herramienta a Mapa en Vivo y devolvió `[]`. No se repitió después del traslado: ese resultado previo no certifica la integración final. Las capturas y la revisión de los tres hallazgos constituyen la evidencia visual final disponible.

No se canonizan defectos heredados, estilos aislados ni valores usados para ocultar hallazgos. La ausencia de documentación global queda registrada y sin reparar porque no forma parte del cambio autorizado. La evidencia operativa y de publicación se mantiene aparte, en `docs/STELLAR_DISPATCH_SIMULATION_20261031.md`.
