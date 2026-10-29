# OpenStreetMap en el mapa principal de Stellar Tracking

Kaleb corrigió la petición de Mapbox: conservar OpenStreetMap en zonas y utilizarlo también en el dashboard. Estado: **código local**, sin publicación GitHub, web, funciones, SQL ni VPS.

## Superficie y comportamiento

- `src/pages/MapPage.tsx`, mostrado por Layout en `/map`, usa Leaflet y la misma fuente de teselas que `TaxiZoneMap`. Se retiró de esta pantalla la inicialización del SDK Google, el ID vectorial y la dependencia recién añadida de Mapbox.
- Conserva datos REST y WebSocket de Traccar, búsqueda por unidad, selección, ficha de escritorio/móvil, seguimiento, zoom, centrar flota, comandos y avisos. La posición y rumbo se actualizan en los marcadores existentes; se retiran los de unidades ausentes o posiciones inválidas. Los nombres se escapan antes de construir HTML.
- El fondo empieza en gris. El botón de capas alterna gris/color sobre el mismo OpenStreetMap. Este visor no ofrece satélite ni Street View.
- La comparación de taxis conserva el selector existente por GPS/disponibilidad/rumbo; la distancia se presenta expresamente **en línea recta**, con trazos discontinuos. No se presenta como ruta vial ni se inventa un ETA.
- Medir dos puntos muestra esa distancia y consulta la tarifa mediante `taxi-bot-admin`, con la base/canal autorizados. Se eliminó de esta herramienta la lectura anónima de celdas cercanas y el importe mínimo/fórmula inventados en el cliente. Cero o varios canales no eligen el primero. Sin cobertura o ante error se informa que no hay tarifa confirmada. La generación y base vigentes invalidan respuestas tardías al reiniciar, desactivar, cambiar base o desmontar.
- La dirección de la ficha procede de Traccar. No se envía cada actualización GPS a un geocodificador público.
- Los listeners, observador de tamaño, timers de avisos y mapa se liberan al desmontar. Los fallos de teselas se muestran sin bloquear los datos GPS; un fallo REST permite reintentar y el aviso desaparece tras recuperar la carga.

El editor mantiene las 2,541 celdas registradas de Pompeyo y sus colores/selección/carga completa; sólo comparte ahora la construcción de la capa OSM y el aviso recuperable de teselas con el dashboard. Sin escrituras de tarifas, viajes, mensajes o cambios de credenciales.

## Proveedor

URL `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, HTTPS, atribución visible, carga de teselas visibles y caché HTTP del navegador; no se agregó precarga ni descarga sin conexión. La cartografía pública es de disponibilidad no garantizada y tiene condiciones de uso; antes de crecer en tráfico hay que dimensionar un proveedor de teselas basado en OSM o una instalación propia. [Política oficial de teselas](https://operations.osmfoundation.org/policies/tiles/). La implementación usa [Leaflet 1.9.4](https://leafletjs.com/reference.html).

## Verificación y límites

Pasaron siete pruebas nuevas de GPS, etiquetas/rotación, aislamiento de tarifa, canales ambiguos, ausencia de cobertura y fallos de autenticación/proveedor; también las siete de cobertura completa y colores H3. Tipos estrictos de esas pruebas y del editor H3 aprobados. Build Vite aprobado. El tipado global conserva errores anteriores fuera de MapPage y los nuevos helpers; no se declaró verde. El lint mantiene advertencias de hooks del mapa y del proyecto, sin supresiones añadidas.

Comandos reproducibles:

```powershell
npx tsc -p tsconfig.fleet-map-tests.json --noEmit
npx tsc -p tsconfig.taxi-admin.json --noEmit
node --experimental-strip-types --test tests/fleet-map.test.ts tests/taxi-coverage.test.ts tests/taxi-zone-colors.test.ts
node --experimental-strip-types estrella-taxis-backend/scripts/check-taxi-bot-quality.ts
npm run build
```

Logs locales `.codex-tmp/stellar-osm-tsc.log`, `stellar-osm-build.log`. El navegador de Work estaba desactivado; queda pendiente recorrer el mapa autenticado en escritorio/móvil y comprobar visualmente las teselas. HTTP 200 y compilación no sustituyen esa prueba.

La migración aquí descrita corresponde al mapa principal y zonas. Geocercas, reportes, replay y la página pública antigua de seguimiento conservan sus integraciones anteriores. Tampoco se cambió la geocodificación/ruteo del bot ni se activó el consumidor. No hace falta un token Mapbox para estas dos pantallas locales.
