# Simulador de asignación de Pompeyo

Política vigente posterior: [treinta minutos y detención persistente](STELLAR_DISPATCH_IDLE_POLICY_20261031.md), worker/webhook v45 y administrador v37. Sustituye los límites de 10 minutos/2 minutos descritos en esta entrega histórica.

## Superficie y contrato

La herramienta sustituye el comparador existente de **Mapa en Vivo → Comparar taxis** (icono de cerebro). La corrección del usuario ubica las pruebas en ese mapa, sin crear una pestaña adicional del bot. El administrador marca origen, destino opcional y posiciones hipotéticas sobre el mismo mapa; también puede introducir coordenadas. El panel permite cambiar disponibilidad, antigüedad de GPS, velocidad, rumbo, conexión y habilitación hipotética para ofertas. Los cambios no se aplican a las unidades reales.

Sólo superadministradores y administradores de base con permiso de configuración pueden consultar la flota completa de su ámbito. El backend valida rol, base, canal y acceso actual a las unidades de Traccar. Los usuarios personales y operadores no obtienen este acceso por ocultar o mostrar un control de React.

`taxi-bot-admin: dispatch_simulation` refresca el puente privado Wialon, después consulta los dispositivos y posiciones con la sesión verificada del solicitante. Falla explícitamente si la actualización falla. Obtiene el turno, WhatsApp válido, viaje ocupado y elegibilidad de la base mediante `taxi_bot_simulation_fleet`; no devuelve teléfonos de conductores. Los hexágonos se utilizan únicamente para una cotización GPS de referencia de la base; las tarifas por carretera no se inventan ni se calculan aquí.

## Corrección de la selección mostrada en el mapa

El mapa anterior llamaba directamente a `findOptimalTaxi` con opciones predeterminadas: radio de 10 km y exclusión por motor apagado. Tampoco consultaba las condiciones de turno del backend. El bot ya permitía una unidad estacionada con señal libre confirmada, dentro del radio configurado de la base.

El comparador ahora llama al backend. Simulador y despacho comparten `selectTaxiCandidates`, la normalización de ocupación `gpsOccupancy` y el selector por distancia y rumbo. La extracción añade observaciones de decisión sin cambiar la política de producción: coordenadas válidas, señal libre explícita, fix de hasta 10 minutos, tolerancia de 30 segundos futuros, estado offline/atrasado sólo con fix de hasta 2 minutos, motor apagado permitido, distancia dentro del radio de la base, penalización por rumbo sólo cuando se mueve a más de 5 km/h y el rumbo es conocido. La prioridad suma 0, 0.5, 1.2 o 2 km a la distancia en línea recta. No es una ETA ni una ruta vial.

La tabla muestra distancia física, ajuste por rumbo, prioridad, antigüedad y motivo de exclusión incluso para unidades cercanas. Un marcador GPS libre no garantiza turno, WhatsApp ni elegibilidad. La ocupación desconocida se muestra en ámbar y nunca cuenta como libre. No se habilitan automáticamente conductores para hacer aparecer candidatos.

## Resultados y límites

Cada ejecución compara el escenario real y los cambios hipotéticos sobre la **misma foto de GPS**. Proyecta hasta cuatro rondas de tres unidades, suponiendo que nadie acepta, sin repetir unidades. El despacho real vuelve a consultar posiciones en cada ronda; la proyección no promete que se repetirá ese resultado futuro.

El mapa dibuja líneas de comparación en SVG sobre el lienzo existente; no son rutas por carretera. La animación dura 9.6 segundos, se elimina al cambiar el resultado/cerrar y respeta `prefers-reduced-motion`. El encuadre conserva el origen y candidatos visibles junto al panel lateral o encima de la hoja móvil. Las ediciones invalidan el resultado anterior; una nueva selección de mapa aborta una consulta anterior y evita mostrar su respuesta atrasada.

Cerrar y Simular permanecen visibles al recorrer el panel. La navegación móvil respeta el bloqueo explícito de una herramienta abierta; el manejador global de scroll ya no vuelve a mostrarla encima del simulador. Cerrar o salir de la ruta del mapa libera ese bloqueo. El buscador declara su propia dirección de fila y espacio para el icono, sin depender de las reglas generales de formularios.

La simulación no crea viajes, ofertas ni outbox, no envía WhatsApp, no modifica turnos y no cambia posiciones GPS. Su única escritura es un recibo privado de operación para límites, idempotencia y recuperación de respuesta perdida. Se limita a 200 unidades, 30 ejecuciones por actor en 10 minutos, 100 operaciones globales en 10 minutos, cuatro en curso y una por actor. No hay reintentos ilimitados ni éxito fingido después de un commit incierto. Un recibo repetido revalida el acceso actual antes de mostrar GPS guardados. La limpieza oportunista elimina hasta 500 recibos antiguos por operación: simulaciones mayores a 30 minutos; auditorías y scores conservan sus 30 días anteriores. No es un borrado programado al segundo exacto.

## Validación

- Batería completa Deno: 22,655 aprobadas antes de los últimos ajustes de presentación y validación de respuesta; luego 59 pruebas enfocadas aprobadas con comprobación de tipos.
- SQL: 160 aprobadas; después cuatro del nuevo contrato incluyendo retención, todas aprobadas.
- Mapa: ocho pruebas aprobadas; TypeScript estricto del panel y sus dependencias, tipos de pruebas de mapa y puntos de entrada Deno aprobados. El chequeo general del repositorio continúa señalando errores previos fuera de esta superficie (por ejemplo AnimatedMapMockup, pushNotifications y GeofencesPage); no se declara limpio ese chequeo global.
- Comparación sembrada contra el selector anterior: 2,000 combinaciones idénticas de candidatos/distancias/prioridad, excluyendo sólo la medición de rendimiento.
- En la web publicada se comprobó una ejecución con 19 unidades reales: EDDY 0529 y HUGO 1014 fueron primero y segundo para el origen de prueba; DM200 mostró «Sin conductor activo en turno». Esto describe esa captura, no garantiza posiciones futuras.
- Antes/después de la primera ejecución: viajes 3/3, ofertas 1/1, outbox 86/86, conductores activos 13/13, unidades vinculadas 19/19. Sólo aumentó el recibo de simulación, 0/1. No se envió WhatsApp para esta prueba.
- Al completar cuatro ejecuciones, los mismos conteos de negocio seguían intactos; los recibos fueron 0/4. Una prueba posterior mostró 0540 ocupada únicamente en el escenario y sustitución por 1111, usando los mismos GPS para ambos lados. Más tarde el GPS de HUGO rebasó los 10 minutos y quedó excluido con ese motivo explícito.
- En el corte final hubo cinco recibos de simulación; viajes, ofertas, outbox, conductores activos y unidades vinculadas conservaron los valores iniciales. La revisión visual final resolvió los tres hallazgos puntuados (navegación móvil superpuesta, alcance de acciones y alineación del buscador); su dictamen no certifica estados no inspeccionados.
- Se comprobaron tres rutas SVG de comparación. Este equipo tiene movimiento reducido activado, y su estilo calculado desactiva las animaciones conforme a esa preferencia. La configuración de movimiento normal se revisó en CSS; no se declara una prueba física de ese modo.

## Publicación

Proyecto independiente `izrsxygazsalfhpaualj`, migración `20261031235500`. Backend `taxi-bot-admin` v35; `process-queue` y `ycloud-webhook` v43. Se verificaron por descarga 37 archivos de ejecución del administrador y 30 por cada entrada de bot: hashes coincidentes y OPTIONS HTTP 200. La función de elegibilidad SQL de producción permanece idéntica al respaldo.

Los bundles se preparan y publican por función en directorios aislados: el administrador y el worker tienen variantes activas distintas de `tracking/auth.ts`. Se corrigió la carpeta compartida inicial antes del cierre: v42 incluía el método de login no utilizado del administrador; v43 restaura exactamente el archivo activo previo de cada worker y sólo incorpora los tres módulos revisados de selección. No se reinició el VPS: puente y consumidor de Stellar permanecieron online con sus PID y conteos de reinicio anteriores; Robin’s tampoco se reinició.

GitHub y Vercel publican la web por separado. Ver evidencia agregada y revisión visual junto a este documento. Las capturas de GPS reales y respaldos privados quedan en carpetas ignoradas; no se suben al repositorio.
