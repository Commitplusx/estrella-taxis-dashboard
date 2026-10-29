# Evaluación de Meta Business Agent Platform para Pompeyo Express

28 de octubre de 2026. Investigación de documentación pública; sin activar agentes, aceptar términos, cambiar webhooks, configurar facturación ni modificar el canal real. El envío de prueba anterior confirmó entrega por YCloud, no elegibilidad ni integración con Meta Business Agent.

## Hallazgo posterior vigente: YCloud sí expone la integración

Consulta de sólo lectura posterior a los enlaces que no abrieron en la sesión de Kaleb:

- `GET /v2/whatsapp/businessAccounts/312427518624876`: HTTP 200. Identifica el portafolio propietario `490578754128691`; revisión de WABA `APPROVED`, verificación del negocio `not_verified`. Son estados distintos. La falta de verificación no se atribuye como causa del error del navegador.
- El [índice oficial de YCloud](https://docs.ycloud.com/llms.txt) publica el [contrato OpenAPI de Meta Business Agent](https://docs.ycloud.com/openapi/endpoints/meta-business-agent-public.openapi.json). Incluye consultas de elegibilidad/configuración y operaciones de alta, conectores y herramientas. Corrige la incertidumbre anterior sobre si el proveedor expone una integración: sí existen estas APIs autenticadas con clave YCloud. No acredita por sí mismo el control integral del chat ni permisos de escritura en esta cuenta.
- `GET /v2/metaBusinessAgents/366093709915638/settings`: HTTP 404 `MBA_AGENT_NOT_FOUND`.
- `GET /v2/metaBusinessAgents/366093709915638/eligibility`: HTTP 403 `Forbidden`; el proveedor informa que deben aceptarse primero las condiciones de Meta Business AI para esta WABA. No devolvió un booleano de elegibilidad. No se deduce que el número sea elegible ni inelegible.
- Enlace de configuración con ambos identificadores: `https://business.facebook.com/latest/whatsapp_manager/business_ai?business_id=490578754128691&asset_id=312427518624876`. El usuario adjuntó otra captura de «Este contenido no está disponible» después de recibir el enlace completo. El enlace anterior sólo incluía `asset_id`. El apartado de pestaña ausente de [Troubleshooting de Meta](https://developers.facebook.com/documentation/meta-business-agent/troubleshooting) confirma esa ruta y los dos parámetros, pero el error de pantalla por sí solo no distingue permisos, contexto o disponibilidad. No seguir repitiendo enlaces como si la elegibilidad estuviera demostrada.

Siguiente paso: el administrador propietario revisa los términos y el acceso desde el portafolio correcto. Después se repite la consulta de elegibilidad, antes de crear o activar un agente. No se aceptaron términos mediante herramientas ni se hicieron solicitudes POST/PATCH/DELETE. La credencial facilitada no se guardó en este documento ni en el código. Los requisitos de usuario del sistema descritos abajo siguen aplicando a la integración directa con Meta; la API de YCloud proporciona una ruta delegada distinta.

Ante la nueva captura se pidió comprobar si el perfil humano tiene Control total en Usuarios → Personas. Kaleb confirmó que sí; no se verificó la sesión humana mediante herramientas. La verificación del negocio sigue reportada como `not_verified`, pero no se afirmó que completar la verificación resolvería automáticamente el acceso. La documentación de YCloud no expone una operación de aceptación de términos en el contrato consultado: no se intentó forzar el alta para omitirlos. Con Control total confirmado por el propietario y pantalla inaccesible, corresponde una revisión de acceso/habilitación con YCloud o Meta. Se preparó [un borrador de soporte](YCLOUD_META_AGENT_SUPPORT_DRAFT_20261028.md), con WABA, ID del número/portafolio y una nueva consulta GET para aportar `YCloud-Request-ID`: `req_5oUwgBKV8HqYog3u0cJito`, HTTP 403 de términos a las `2026-10-28T19:29:30.663Z`. No se envió ningún caso ni mensaje a soporte.

## Conclusión propuesta

Alternativa investigada el 29-10-2026: [AI Agent propio de YCloud y External Agent](YCLOUD_AI_AGENT_ASSESSMENT_20261029.md). Son productos distintos de Meta Business Agent. Hay conectores HTTP y una vía External Agent documentada para conservar el motor propio en Inbox (Pro o superior), con contratos diferentes al webhook WhatsApp actual. No se creó ni activó ninguno durante la investigación.

Actualización del 29-10-2026: Kaleb confirmó que la conexión se realizó por YCloud mediante WhatsApp Coexistence. Una lectura nueva de números devolvió `CONNECTED`, `isOnBizApp: true` y los mismos identificadores de número/WABA. La consulta GET de elegibilidad continúa en HTTP 403 por términos pendientes, referencia `req_4TLHiOOG1KK1wVp9EFH5Q0`. La coexistencia confirmada debe incluirse en cualquier revisión con soporte. No se afirmó que esa modalidad sea compatible o incompatible con Meta Business Agent Platform para esta cuenta; el rechazo de términos sigue impidiendo obtener la elegibilidad. Para usar nuestro backend mediante YCloud no se necesita crear una app propia de Meta adicional. Eso no activa ni acredita el agente de Meta, y la integración productiva del bot propio sigue pendiente. No hubo altas, desconexiones ni cambios de configuración en esta comprobación.

Vale la pena un piloto privado con Meta como responsable de la conversación y el backend actual como autoridad de viajes, tarifas y asignación. No hace falta rehacer el sistema. No hay evidencia todavía de que comprenda mejor las expresiones locales, responda más rápido o cueste menos que el intérprete actual: esas tres cuestiones requieren medición con los mismos casos.

El agente listo para configurar en la app y la plataforma de APIs son productos distintos. Para este proyecto interesa la plataforma con integración de sistemas propios. La página de [Meta Business Agent Platform](https://ai.meta.com/meta-business-agent/platform/) describe conectores, contexto conversacional, atención humana y APIs para integrarla con infraestructura existente.

## Reparto de responsabilidades que conservaríamos

| Meta, si se adopta | Backend de taxis existente |
| --- | --- |
| Conversación, aclaraciones y propuesta de datos | Validar identidad, base/canal, evidencia y corrección vigente |
| Solicitar una cotización a una herramienta | Resolver ubicaciones, comprobar cobertura H3 y devolver tarifa real |
| Pedir confirmación y llamar una operación autorizada | Exigir el resumen/token vigente y consentimiento comprobable; crear una sola solicitud |
| Comunicar resultados de herramientas | Buscar y asignar conductores mediante transacciones; impedir aceptaciones ajenas y viajes duplicados |
| Solicitar atención humana o informar un estado | Conservar el estado durable, auditoría, permisos, recuperación y estado real del proveedor |

Este reparto es una propuesta arquitectónica, no una integración construida. Los conectores no deben ofrecer escritura genérica a tablas ni permitir que el agente elija el tenant o declare por sí mismo el consentimiento del pasajero. La identidad del consumidor y el mensaje que autoriza una compra deben vincularse a evidencia confiable del canal, no a argumentos inventados por una herramienta.

## Capacidades y cambio de control del chat

La [guía oficial de capacidades](https://developers.facebook.com/documentation/meta-business-agent/capabilities) permite APIs externas mediante conectores, con URL/autenticación y esquemas de herramientas. Incluye texto, imágenes y ubicaciones compartidas; las notas de voz se transcriben cuando están habilitadas para ese número. No asumir esa habilitación en Pompeyo.

Al habilitarlo, Meta pasa a ser el respondedor principal. La app puede observar mediante webhooks en espera, tomar el control al enviar y liberarlo para que el agente continúe. Nuestro worker actual no debe seguir procesando y contestando los mismos turnos de manera independiente. Falta comprobar cómo YCloud expone ese enrutamiento, los eventos en espera y el traspaso en esta cuenta. No se confirmó compatibilidad completa del proveedor.

## Acceso pendiente

La [guía de credenciales](https://developers.facebook.com/documentation/meta-business-agent/get-api-key) exige un usuario del sistema —o BISU para integración delegada— con la app y WABA asignadas, y permisos `whatsapp_business_messaging` y `whatsapp_business_management`. Los términos de Meta Business Agent deben estar aceptados por la WABA; algunos endpoints requieren acceso adicional de Meta. La clave de YCloud ya probada no acredita esos permisos ni sustituye esa credencial. Configurar credenciales en el entorno privado, no en el repositorio ni en el chat.

El [overview oficial](https://developers.facebook.com/documentation/meta-business-agent/overview) admite números de la plataforma administrados por socios, pero exige elegibilidad de país, categoría, confianza/verificación y cuenta en regla; otra integración activa de agente puede bloquear el alta. La categoría taxis no figura en la lista de sectores excluidos publicada, lo cual no demuestra que este número concreto sea elegible. No se consultó la elegibilidad autenticada de Pompeyo ni se cambió su categoría.

## Precio y criterio económico

La [documentación oficial de precios](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages) indica USD 2 por millón de tokens de entrada/salida, con procesamiento y entrega incluidos en el cargo del mensaje de Meta Business Agent; los tokens de caché no se cobran. Su ejemplo típico de 20,000–25,000 tokens equivale a USD 0.04–0.05 por respuesta entregada, no por conversación completa. Es una referencia de Meta, no consumo medido de taxis. Seis respuestas bajo ese supuesto darían USD 0.24–0.30: cálculo ilustrativo, sin impuestos ni posibles cargos separados del proveedor. El consumo real puede variar.

La regla de 24 horas para respuestas sin plantilla sigue vigente. Los avisos de un viaje que necesiten otra vía o plantilla deben diseñarse explícitamente. No activar facturación ni asumir ahorros hasta medir costo por viaje completado.

## Piloto recomendado y evidencia necesaria

La [guía oficial de pruebas](https://developers.facebook.com/documentation/meta-business-agent/test-your-agent) separa Agent Test, Agent Eval y WhatsApp real con lista autorizada. Agent Test no factura tokens y puede ejecutarse con el agente apagado; no acredita entrega real ni control del chat. La lista en vivo permite hasta 20 consumidores por número y debe configurarse expresamente como `ALLOWLISTED_ONLY`; la lista por sí sola no restringe el público si queda `EVERYONE`.

Orden recomendado:

1. Verificar elegibilidad y acceso de Meta para el número confirmado de Pompeyo; comprobar el traspaso con YCloud sin activar respuestas a clientes.
2. Preparar un adaptador que llame las reglas/RPC existentes, con identidad verificada, idempotencia, confirmación vigente y límites; no crear un algoritmo paralelo de asignación.
3. Evaluar mensajes con faltas, recogida/destino ambiguos, correcciones posteriores, dos ubicaciones, tarifa inexistente, cancelación, repetición y fallo de herramientas antes/después del commit.
4. Probar sólo con teléfonos propios autorizados y observar envío, recepción y cambio de control. Evitar publicar el público `EVERYONE` durante el piloto.
5. Comparar resolución de los mismos casos, llamadas inválidas, latencia y costo total. Mantener una cohorte prospectiva sin usar para ajustar instrucciones.

Las pruebas actuales comprueban contratos del motor existente; no evalúan el modelo ni la orquestación de Meta. Si se cambia la interpretación, hace falta validación nueva y adaptar la bitácora para conservar el origen del mensaje, las herramientas y el resultado transaccional verificable. No importar respuestas del agente como etiquetas correctas automáticamente.
