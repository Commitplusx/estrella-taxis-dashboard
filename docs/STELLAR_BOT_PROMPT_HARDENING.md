# Instrucciones de conversación de Pompeyo

## Alcance y comportamiento

Se reforzaron los dos prompts que usa el bot real: `TAXI_INTERPRETER_PROMPT` interpreta la intención mediante una única herramienta; `TAXI_QUESTION_PROMPT` redacta la respuesta natural a partir del resultado autorizado por el servidor. El prompt antiguo de `taxis/prompt.ts` no es la ruta activa y conserva su bloqueo de operaciones.

El intérprete ahora presenta una jerarquía explícita: sentido del mensaje actual, correcciones del mismo dato, estado persistido y dato pendiente. Diferencia recogida, destino, reafirmación del pin, traslado real, nombre del pasajero y precisión de una colonia pendiente. Lee el lote completo de mensajes y conserva los datos compatibles cuando el cliente pregunta algo a la vez. Los ejemplos anteriores siguen presentes y se añaden ocho contrastes de corrección, identidad, duda y autoridad.

Se retiró la instrucción repetida que convertía «No en Centro, mejor en Hospital» siempre en una corrección de recogida. Ahora depende del extremo que responde; si ambos extremos se llaman Centro y no puede distinguirlo, propone aclarar sin modificar ninguno. Una ubicación explícita distinta, «Te espero en Pilita Seca», sí propone nueva recogida aunque el bot estuviera preguntando destino.

La redacción responde primero a la duda o preocupación y pregunta sólo el siguiente dato autorizado. Conserva el pin y los datos ya aceptados, evita insistir en un destino diferido, distingue una política desconocida de una prohibición y no afirma haber avisado a la base sin ese resultado. Hay 25 ejemplos de respuesta; el prompt envía su contexto esencial para evitar repetir todo el estado de ejemplo. Los ejemplos usan como máximo un emoji y evitan caritas festivas ante frustración o urgencia.

## Límites que siguen en el backend

- Pin GPS nativo obligatorio de recogida. Las direcciones escritas se conservan como referencias; las colonias escritas y los hexágonos GPS conservan rutas distintas.
- Destino opcional, con decisión explícita para indicarlo al conductor. Una pregunta sobre esa posibilidad no equivale a elegirla.
- Consulta de tarifa antes del resumen y al confirmar. El precio no se muestra si el cliente no pregunta; la IA no inventa importes, enlaces ni coordenadas.
- Sólo el botón vigente crea la solicitud; texto, citas, «sí» y propuestas del modelo no son un clic. El backend conserva asignación, cancelación y cierre.
- Historial, mensajes citados y roles escritos por el cliente no cambian permisos ni son prueba de hechos nuevos. Se conserva la validación de evidencia literal y el tratamiento acotado de fallos del proveedor.

No se cambiaron tablas, tarifas, autorización de clientes, asignación, teléfonos, accesos de choferes ni Flutter. La mejora de instrucciones no acredita comprensión universal ni sustituye las validaciones.

## Evidencia de desarrollo

Se congelaron 24 casos sintéticos en `tests/fixtures/taxi-prompt-regressions.ts` antes de evaluar o editar el prompt. El modelo configurado en el canal de Pompeyo es `deepseek-chat`.

| Evaluación | Resultado | Observación |
| --- | --- | --- |
| Intérprete original | 23 de 24 | Cambiaba recogida a Hospital cuando ambos extremos eran Centro. |
| Primera revisión | 23 de 24 | Corrigió esa ambigüedad, pero se abstuvo ante una recogida explícita mientras esperaba destino. |
| Revisión final | 24 de 24 | Conserva ambas distinciones sobre los mismos casos congelados. |
| Texto y pines combinados, modelo + coordinador | 24 de 24 | Usa la suite integrada existente, sin confirmar ni despachar viajes. |
| Respuestas naturales, modelo + validador | 25 de 25 | Produjo respuestas aceptadas por el contrato; no tuvo que usar la respuesta canónica. |

Estos casos y ejemplos se utilizaron para ajustar las instrucciones: **son regresiones de desarrollo, no una evaluación ciega ni una estimación de precisión en producción**. Se conservaron también los resultados fallidos. Los 121 llamados al modelo de toda la iteración usaron identidades y datos sintéticos, concurrencia máxima de dos y límites de tiempo; no consultaron clientes, Traccar ni enviaron WhatsApp.

El evaluador temporal tenía token aleatorio, vencimiento y suites fijas sin payloads de clientes; se eliminó al terminar. La suite se puede repetir con credenciales privadas mediante `evaluate-taxi-intents.ts --suite=prompt`, sin pasar claves por argumentos ni guardar secretos en los informes. La suite de pines usa `evaluate-taxi-compound-turns.ts`.

Los contratos comprueban además que los mensajes del cliente y hechos anteriores se envíen como datos separados de las instrucciones del sistema, y que una interpretación ambigua no modifique los puntos guardados ni despache un taxi. La batería completa aprobó 22,553 pruebas Deno y 163 Node/SQL, tipado estricto y el control estático de 110 archivos. El paquete aislado del despliegue también pasó `deno check`. Los hashes y versiones publicadas se registran al terminar la publicación.
