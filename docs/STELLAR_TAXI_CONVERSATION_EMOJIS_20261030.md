# Emojis por estado en la conversación de taxis — 30-10-2026

El bot usa emojis breves para que el pasajero identifique el momento del servicio sin cambiar botones, tarifas ni decisiones del backend.

| Estado | Mensaje |
| --- | --- |
| Saludo y captura del origen | Saludo cálido con 😊 y el contexto del taxi con 🚕. |
| Resumen previo a confirmar | 🚕 antes del resumen; el botón conserva su texto e identificador. |
| Solicitud en búsqueda | 🚕 y estado explícito de búsqueda, sin afirmar que ya hay unidad. |
| Unidad asignada | 🚕 y 😊 junto al aviso confirmado por la aceptación del conductor. |
| Viaje terminado | 🚕 y 😊 en el agradecimiento. |
| Cancelación o cierre sin unidad | Mensaje claro del resultado y una carita amable 🙂. |
| Agradecimiento o cortesía | 😊 sólo en respuestas de cortesía. |

Los textos de transición salen de PostgreSQL, que registra la asignación y el cierre; las respuestas de conversación salen del coordinador existente. La migración `20261030234500_taxi_conversation_emojis.sql` actualiza únicamente el texto de salida de las funciones `taxi_bot_commit` y `taxi_bot_maintain`. No altera destinatarios, botones, idempotencia, tarifas ni transiciones.

Las pruebas cubren saludo, resumen, estado activo y cortesía, además de los mensajes persistidos de solicitud, asignación, finalización y timeout. Pasar una prueba local no equivale a recibir un WhatsApp físico.

Estado de publicación: migración `20261030234500` registrada en el proyecto de Pompeyo; `ycloud-webhook` v15 y `process-queue` v15 activos. Las definiciones SQL contienen los mensajes actualizados y ambos endpoints respondieron OPTIONS 200 antes y después. No se mandó un WhatsApp de prueba.
