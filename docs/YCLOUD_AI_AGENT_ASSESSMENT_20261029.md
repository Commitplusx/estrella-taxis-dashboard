# YCloud AI Agent para Pompeyo Express

Investigación del 29 de octubre de 2026. Documentación pública del proveedor; sin crear, publicar o asignar agentes, modificar Inbox/webhooks, ejecutar conectores ni contratar planes. No se hicieron inferencias ni se enviaron WhatsApps durante esta investigación.

## Resultado

El AI Agent propio de YCloud sirve como candidato para la conversación y la recopilación flexible de datos, con instrucciones, conocimientos, Skills, conectores y atención humana. Es distinto de Meta Business Agent y también de External Agent. No hay evaluación que demuestre mejor comprensión, velocidad o costo para taxis respecto al intérprete actual. Se recomienda compararlo en Preview con un alcance pequeño antes de asignarlo al número real en coexistencia.

## Opciones documentadas

| Opción | Función documentada | Encaje propuesto |
| --- | --- | --- |
| AI Agent de YCloud | Profile, Skills, Knowledge Base, contexto y acciones configuradas | Probar conversación/recopilación; herramientas llaman backend propio para operaciones reales |
| Rule-based Agent | Flows con pasos, disparadores y ramas explícitas | Menús, formularios y procesos cerrados; por sí solo no sustituye un intérprete flexible |
| External Agent | Nuestro agente corre en nuestra infraestructura; eventos dedicados e Inbox API para responder/transferir | Integrar motor actual con bandeja/propiedad de conversación de YCloud; requiere adaptador, no sólo pegar el webhook anterior |

Fuentes: [What is AI Agent](https://docs.ycloud.com/en/documentation/agents/ai-agent/what-is-ai-agent), [Create an agent](https://docs.ycloud.com/en/documentation/agents/create-an-agent), [External Agent](https://docs.ycloud.com/en/documentation/agents/external-agent).

## Conversación, instrucciones y conocimientos

La [guía de configuración](https://docs.ycloud.com/en/documentation/agents/ai-agent/how-to-create-and-configure-an-ai-agent) ofrece rol personalizado, perfil, tono/idioma, acciones de etiquetado/contacto, cierre y atención humana. Un agente nuevo queda en borrador; se prueba en Preview, se publica y después se asigna al número. Cambios de Profile/Skills requieren publicación; los conocimientos se actualizan inmediatamente y se comparten entre versiones. Un agente nuevo separado evita alterar conocimientos de uno activo al ensayar.

Las [Skills](https://docs.ycloud.com/en/documentation/agents/ai-agent/ai-skills) definen cuándo iniciar un proceso, pasos, campos requeridos, conectores y condiciones de parada. Son instrucciones interpretadas por IA; no convierten una confirmación, tarifa o asignación en una garantía transaccional. La guía exige probar éxito, campos inválidos, resultados vacíos y fallos.

La [Knowledge Base](https://docs.ycloud.com/en/documentation/agents/ai-agent/ai-knowledge-base) indexa documentos, sitios y Q&A. Eso es recuperación de información del negocio; no acredita entrenamiento de pesos ni corrección automática de errores. No subir el catálogo de tarifas como si fuera la autoridad actual: precio/cobertura H3 deben consultarse al backend.

No se halló en las guías inspeccionadas una especificación pública suficiente del modelo exacto usado por esta cuenta, tamaño/límites de contexto, tratamiento de cada ubicación/nota de voz ni garantía de cumplimiento de instrucciones. No se extrapolan capacidades de Meta Business Agent al AI Agent propio de YCloud.

## Integración con el sistema de taxis

Los [Data connectors](https://docs.ycloud.com/en/documentation/integrations/data-connectors) permiten HTTPS, métodos HTTP, headers y cuerpo JSON, con lectura o escritura en sistemas externos. El conector debe prepararse y activarse antes de usarlo desde una Skill. El botón de prueba ejecuta la petición real; no se usó para realizar operaciones en este trabajo.

Posible adaptador, todavía no construido:

- Resolver origen/destino con las reglas y geocodificación existentes.
- Consultar cobertura/precio H3 y devolver cotización con su revisión/token y caducidad.
- Crear o cancelar sólo con identidad confiable del canal y confirmación vigente comprobable.
- Consultar estado real del viaje, sin afirmar asignación si PostgreSQL no la confirmó.
- Mantener búsqueda/asignación de unidad, idempotencia, aislamiento y ciclo de vida en las RPC existentes.

No exponer SQL genérico ni una clave de servicio Supabase al agente. La integración requiere comprobar cómo se vincula la identidad del consumidor y su mensaje original a cada herramienta; un teléfono, tenant, token o `confirmed=true` propuesto por el modelo no es evidencia suficiente. También falta comprobar que las ubicaciones compartidas lleguen con coordenadas utilizables a la herramienta en este modo de agente.

La [asignación de conversaciones](https://docs.ycloud.com/en/documentation/channels/whatsapp-accounts-management/phone-number-management/conversation-assignment-rules) requiere Inbox habilitado; propietario del contacto y último agente disponible pueden prevalecer sobre el AI Agent elegido. La asignación de chats de YCloud no es el algoritmo de conductores. El consumidor actual del bot no debe responder simultáneamente a una conversación manejada por otro agente; el traspaso y la cancelación de trabajo pendiente necesitan pruebas.

## External Agent: alternativa para conservar nuestro motor

La guía específica exige Pro o superior. Envía `inbox.message.created`, asignación/cierre y estados de mensajes; el servicio propio verifica firma, persiste, deduplica y responde mediante Inbox API. El cuerpo de respuesta del webhook no se convierte en una respuesta al usuario.

Hay contratos distintos de la ruta WhatsApp actual: deduplicación `(botId,event.id)`, trabajo por `dialogId`, dirección inbound y `actionable`, control de propietario actual y errores si el agente ya cedió la conversación. Eventos tardíos no autorizan continuar después de una transferencia. No conectar el endpoint actual sin adaptar esos contratos. La API/Webhooks normal que ya usa nuestro motor es una ruta separada; la restricción Pro de External Agent no demuestra que nuestro bot normal necesite ese plan.

## Precio observado y límites

[Pricing de YCloud](https://www.ycloud.com/pricing), consultado el 29-10-2026:

- Free muestra 500,000 créditos de IA generativa, un usuario y dos canales. No son 500,000 mensajes ni una estimación de viajes atendidos.
- Growth muestra USD 39/mes con factura anual de USD 468; Pro USD 89/mes con factura anual de USD 1,068. Son equivalentes mensuales de contratación anual, no precio confirmado de una suscripción mes a mes.
- Adicional de IA publicado: USD 10 por cinco millones de créditos, no disponible para Free. Mensajes WhatsApp e impuestos aparte.
- Las guías inspeccionadas no permiten traducir esos créditos a costo cierto por viaje/modelo. Verificar plan, disponibilidad de conectores y consumo real de la cuenta antes de contratar o prometer ahorros.
- La elegibilidad/alta del AI Agent propio no se acredita por el bloqueo 403 de Meta Business Agent: son productos distintos. No se configuró ni probó el primero en Pompeyo en este trabajo.

## Piloto propuesto

Crear un borrador independiente de agente personalizado Pompeyo, cargar información estática aprobada y preparar Skills separadas para solicitud, consulta de tarifa, estado, cancelación y atención humana. Probar primero con herramientas sintéticas sin crear viajes. Recorrer faltas, correcciones posteriores, origen/destino ambiguos, pines, falta de tarifa/unidad, consentimiento vencido, duplicados y fallo antes/después del commit. Registrar las discrepancias y comparar con el motor actual usando los mismos casos.

Sólo después de validar identidad/conectores, revisar consumo y demostrar traspaso/ausencia de doble respuesta, preparar un piloto privado en WhatsApp con teléfonos propios. El backend actual permanece como autoridad de los viajes. La investigación no autoriza publicar un agente para todos los clientes.
