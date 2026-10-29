# Stellar Tracking: integridad del análisis y telemetría

Estado al 27 de octubre de 2026: candidato local en desarrollo. No se ha publicado SQL, Edge, GitHub, Vercel ni VPS. No se llamó a un modelo real ni se enviaron comandos a vehículos.

## Fuentes y superficies

- Dashboard React: `C:\Users\Kaleb\Desktop\estrella-taxis-dashboard`.
- Backend del tracking: `estrella-taxis-backend/supabase/functions` dentro del dashboard. El backend homónimo situado directamente en Desktop es una copia parcial; no es la fuente de esta entrega.
- Flutter y puente Wialon: `C:\Users\Kaleb\Desktop\StellarTracking`.
- La documentación `ARQUITECTURA.md` anterior mezcla periodos del bot de restaurantes con tracking. Las referencias antiguas a modelos, cron y funciones predictivas no acreditan publicación ni precisión.

## Contrato de acceso

El tracking usa sesión de Traccar, no una sesión Supabase intercambiable. Edge valida el token/cookie con Traccar, obtiene las unidades visibles para esa cuenta y rechaza IDs ajenos. Las sesiones se revalidan en cada consulta; no se conserva una autorización indefinida en caché. Un administrador Traccar puede ver su alcance administrativo. Las demás cuentas necesitan perfil de empresa activo, paquete activo y el permiso correspondiente.

`ai-insights` recibe únicamente `requestId`, `deviceIds`, `from` y `to`. El servidor consulta reportes reales: el navegador no manda cifras para que el modelo las tome como evidencia. `auditoria_ia` es un permiso explícito nuevo, desactivado para empresas hasta configurarlo por el administrador. `score_diario` sigue controlando los cálculos y la lectura del historial.

La migración candidata `20261027190000_tracking_ai_integrity.sql` conserva las calificaciones anteriores con marca `legacy-v1`, cierra lectura/escritura REST pública y obliga a consultar mediante Edge con alcance validado. La APK anterior lee REST directamente: actualizar clientes, Edge y SQL de forma coordinada es obligatorio antes de activar esta entrega.

## IA de revisión

Los hallazgos de velocidad, desconexión y poca distancia con motor activo se calculan con reglas auditables. Son señales de revisión y no acusaciones. La IA recibe esos hechos agregados, sin nombre de conductor, contacto ni ruta cruda. Debe responder JSON y citar los hallazgos existentes. HTML, citas inventadas, respuestas truncadas y formatos inválidos se descartan. Si falla o falta la clave, el panel conserva los hechos y dice que la interpretación de IA no se generó.

El panel React dibuja texto seguro, sin `dangerouslySetInnerHTML`. El resultado conserva periodo, unidades, versión y evidencia. Límites: 25 unidades, 7 días, 10,000 eventos y tamaño máximo de respuesta. El modelo es configurable con `DEEPSEEK_MODEL`; conserva el alias anterior como valor por defecto y debe verificarse en el proveedor antes de publicar.

Las solicitudes usan reserva duradera en PostgreSQL, usuario, UUID, huella de parámetros y lease. Una reentrega devuelve el resultado guardado; una solicitud vencida queda incierta y no llama de nuevo automáticamente al proveedor. Se permiten tres auditorías por usuario cada diez minutos, una operación activa por usuario, cuatro operaciones globales y cien inicios globales por diez minutos. Retención de solicitudes: treinta días; poda acotada a quinientas entradas por inicio.

## Score de manejo

Un solo algoritmo, `tracking-score-v2`, reside en el servidor. Flutter dejó de calcular y sobrescribir resultados por su cuenta. Se distinguen datos faltantes, limitados y suficientes. La falta de telemetría nunca se convierte en 100.

El cálculo descarta fechas, coordenadas y unidades no válidas; no suma distancia a través de huecos largos o saltos imposibles. El ralentí requiere ignición confirmada. Ventanas útiles y cooldown evitan contar eventos repetidos. La calidad incluye cobertura, observaciones, huecos y ventanas de aceleración. Los resultados anteriores siguen marcados como históricos sin validar; no se atribuye el día de un vehículo a un conductor por coincidencia de nombre.

Los días usan Chiapas UTC-6 y límites de día explícitos. La tarea programada requiere `TRACKING_JOB_SECRET`, credenciales privadas de Traccar y llamadas autenticadas. El secreto no viaja a React ni a Flutter. Esta entrega no acredita ni crea todavía un cron remoto; la nota antigua de 23:45 es insuficiente para afirmarlo.

## Asignación y actividad

El comparador del mapa utiliza el mismo Heading Matcher del backend. Valida fecha GPS, ignición, ocupación, posición y disponibilidad. El orden tiene desempate estable. Los ETA vienen de Google Directions; la comparación no crea viajes ni finge aceptación del conductor. Se retiró la tarifa inventada de $14/km del simulador.

K-Means está conectado al mapa de actividad: muestreo de una observación por unidad cada quince minutos, hasta veinticinco unidades y siete días. Se dibujan zonas agrupadas con círculos de Google Maps, sin depender de HeatmapLayer. Es actividad histórica de los vehículos; no se presenta como demanda de pasajeros ni entrenamiento predictivo.

El mantenimiento toma como base el último servicio registrado; alcanzar el intervalo conserva el aviso de vencimiento. La ausencia de historial de servicio requiere registrar ese dato, no suponer que el vehículo se mantuvo automáticamente.

## Puente Wialon local

Se retiró la credencial del código. Configurar `WIALON_TOKEN` en el entorno del servicio. El destino OsmAnd usa HTTPS o loopback local; no se envían posiciones en texto claro a un host remoto. Se preservan ceros válidos de ignición/batería y se omiten sensores desconocidos. Se detectan identificadores ambiguos, posiciones imposibles y fechas futuras. Cuatro transferencias simultáneas, timeout y confirmación HTTP; no se vuelve a inyectar la misma observación ya aceptada durante el proceso. Un ACK HTTP no acredita almacenamiento físico posterior.

La recuperación tiene backoff y se detiene tras seis ciclos fallidos consecutivos. Las sesiones y tokens no se imprimen. No se accedió al VPS ni se rotó la credencial real: el servicio remoto aún requiere migración y rotación revisadas.

## Verificación en curso

Reproducción inicial: tres pruebas fallaron antes de corregir fecha GPS, cantidad de clusters y vencimiento de mantenimiento. Después pasan esas regresiones.

Comprobado hasta ahora: 36 pruebas Deno con tipos, cinco escenarios SQL aislados y cinco pruebas del protocolo Wialon. Las funciones Edge pasan `deno check`. El análisis completo previo del dashboard ya tenía errores de tipos en otras pantallas; se conserva esa evidencia y no se suprime. La validación final de UI, Flutter y release sigue pendiente durante esta etapa.

El SDK Flutter configurado apuntaba a una carpeta eliminada en Downloads. Dart aún funciona. Se está preparando una copia oficial aislada de Flutter 3.47.0 en AppData para comprobar la APK sin alterar otros proyectos.

## Trabajo que no debe presentarse como terminado

Entrenamiento supervisado, predicción de demanda, comparación de ETA contra llegadas reales y conexión operativa de Anti-Fugas todavía necesitan datos, etiquetado y evaluación. No se declara precisión ni aprendizaje autónomo. La IA no ejecuta inmovilizadores ni modifica viajes por una interpretación de texto.

## Referencias primarias

- [Autenticación de Traccar](https://www.traccar.org/traccar-api/).
- [JSON estructurado de DeepSeek](https://api-docs.deepseek.com/guides/json_mode/).
- [Archivo oficial del SDK Flutter](https://docs.flutter.dev/install/archive).
