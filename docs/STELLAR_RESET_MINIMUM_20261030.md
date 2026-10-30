# Reinicio de conversación y mínimo de Pompeyo — 30 de octubre de 2026

Estado actual comprobado: motor `taxi-bot-v9.1-panel-attention` publicado en Stellar Tracking, proyecto `izrsxygazsalfhpaualj`. Sustituye v9 y la versión v8 descrita en `STELLAR_LANGUAGE_HARDENING_20261030.md`; conserva su interpretación natural y todas las condiciones de GPS y botón vigente.

## Corrección de recepción v9.1

La prueba real posterior a v9 detectó que un `/reset` nuevo no llegó a la cola. `TaxiEngine.permitted` todavía exigía el teléfono de avisos humanos tanto al recibir mensajes como al procesarlos o enviar respuestas. Con ese teléfono vacío, devolvía `taxi_channel_disabled` antes del guardado, aunque el canal estuviera habilitado. Las pruebas anteriores de administración y SQL no recorrían esta comprobación del motor; OPTIONS 200 y coincidencia de fuentes tampoco acreditaban la recepción funcional.

La validación ahora exige el canal habilitado, transporte privado configurado y plan de WhatsApp activo; el teléfono adicional sigue siendo opcional. No se alteraron números de conductores, tarifas, autorizados ni tablas. Se conservaron las reproducciones fallidas antes de editar.

Una regresión integrada nueva recorre el webhook firmado → cola PostgreSQL → consumidor real → traza y reinicio → salida persistente → solicitud nativa de ubicación → aceptación simulada del proveedor, con teléfono de avisos nulo. Comprueba además reentrega sin duplicar mensajes, rechazo de firma alterada y ausencia de viajes/ofertas. La matriz del motor comprueba el permiso del plan tanto con teléfono adicional como sin él.

La ejecución completa aprobó **5,826 pruebas Deno y 121 Node**, control estático y tipos. Se publicaron y descargaron `ycloud-webhook` **22**, `process-queue` **22** y `taxi-bot-admin` **28**: sus archivos ejecutables coinciden con el paquete revisado. El consumidor está en línea. Sólo cambian `engine.ts` y la versión de `contracts.ts`; no hay otra migración. Los respaldos y manifiestos de esta corrección están en `.codex-tmp/taxi-ingress-20261030/`; las reproducciones están en `.codex-tmp/taxi-reset-20261030/runtime-*-before.log`.

El mensaje rechazado antes de guardarse no se fabrica ni se inserta manualmente. Se solicitó una nueva prueba del pasajero; la aceptación del proveedor o la entrega real se informan únicamente cuando existan sus eventos.

## Conversación

- `/reset`, como mensaje de texto completo, reinicia el borrador, nombre, lugares, precio, confirmación e historial corto entregado al intérprete. Admite mayúsculas y espacios. Una cita, pregunta o texto que incluya el comando no ejecuta el reinicio.
- El servidor exige que el comando exista en un evento nativo del turno. No acepta un reinicio propuesto solamente por el modelo. Conserva los eventos y trazas privadas para auditoría.
- Un reinicio de una conversación sin viaje solicita un **pin GPS nuevo de recogida** mediante el botón nativo. Un pin recibido antes del reinicio y un botón del resumen anterior dejan de ser válidos. Si hay varios mensajes en el turno, el reinicio explícito prevalece sobre sus datos y confirmaciones anteriores.
- Un viaje existente, sus ofertas y la atención humana permanecen vigentes. `/reset` no cancela viajes ni entrega al bot una conversación tomada por una persona.
- Los mensajes de respuesta antiguos aún pendientes pierden permiso de salida por la revisión duradera del reinicio. Esto no retira mensajes ya aceptados por WhatsApp ni invalida las ofertas o avisos de un viaje real.
- «Cancelar», antes de solicitar una unidad, descarta el borrador. Con viaje activo solicita una cancelación inequívoca. «Destino» pregunta el destino concreto y opcional; «Origen» o «Recogida» pide el nuevo GPS, sin repetir la pregunta genérica de corrección.

Crear un viaje sigue exigiendo el botón nativo **Confirmar viaje** del resumen vigente. Ni el intérprete ni el texto afirmativo pueden confirmar por su cuenta.

## Precio

El canal de Pompeyo terminado en 2491 tiene `base_cents=5500`, revisión 6 y continúa habilitado. En el modo H3 ese valor actúa como mínimo: la cotización de recogida, del recorrido GPS y del destino escrito reconocido usa al menos **$55 MXN**, conservando los importes superiores. La validación del servidor vuelve a comprobar ese mínimo al reservar; un resumen anterior con otro precio exige nueva revisión.

No se reescriben las tarifas fuente de hexágonos o localidades, ni se mezclan sus directorios. Un punto sin tarifa válida sigue requiriendo atención de la base: el mínimo no inventa cobertura ni una cotización para un lugar desconocido.

## Destinatarios y atención de la base

Las ofertas de viaje siguen usando el WhatsApp del conductor vinculado a la unidad, a través de las RPC y la salida persistente existentes. No se usa el número del chip GPS ni un teléfono general de atención para sustituir al conductor.

El teléfono adicional de avisos humanos es opcional: la sesión, mensajes y traza de atención quedan disponibles en **Bot de WhatsApp → Conversaciones**. Si se configura un teléfono adicional, debe pertenecer a una persona y ser distinto del remitente del bot, incluidas las variantes mexicanas +52/+521.

La publicación inicial se detuvo sin cambios parciales: una regla antigua exigía ese teléfono para habilitar el canal y otra impedía usar el propio número del bot. La nueva migración retira únicamente la exigencia obsoleta de teléfono adicional; mantiene la validación de número distinto, los permisos del plan, transporte, conductores, cobertura y aislamiento por base. Para Pompeyo elimina la referencia inválida al mismo remitente y mantiene activo el canal. No asigna un número personal inventado.

## Verificación y publicación inicial v9

- 5,824 pruebas Deno y 120 pruebas Node, incluidas transacciones SQL y contratos, aprobadas con tipos. También aprobaron el control estático de 91 archivos, los puntos de entrada y el tipado estricto del panel y pruebas.
- Las regresiones nuevas reproducen el conflicto con el canal **habilitado**, comprueban atención humana persistida sin teléfono adicional y ofertas destinadas al conductor. Se conservaron los fallos previos a la corrección.
- La migración `20261031180000_taxi_conversation_reset_minimum.sql` se aplicó y registró. Las ocho definiciones SQL activas coinciden con las revisadas.
- Funciones descargadas después del despliegue: `ycloud-webhook` versión **21**, `process-queue` versión **21** y `taxi-bot-admin` versión **27**. Coinciden sus 25/25/24 archivos ejecutables con el manifiesto revisado. OPTIONS respondió 200 y administración sin credenciales respondió 401.
- La consulta remota bajo `service_role` devuelve `5500` centavos en recogida, recorrido GPS y destino escrito de la comprobación; la celda fuente conserva `4500`. El canal sigue habilitado y el consumidor `stellar-taxi-bot` volvió a estar en línea.
- La compilación React se ejecutó en un checkout aislado de `main` más los cambios revisados. La web pública respondió 200 y sirve el nuevo formulario en `TaxiBotAdminPage-Cp3IA-ST.js`; su contenido coincide con esa compilación. La migración registrada y las siete RPC de datos mantienen acceso exclusivo del rol servidor.

Los respaldos SQL, configuración privada previa, fuentes Edge anteriores y posteriores, hashes y resultados están en `.codex-tmp/taxi-reset-20261030/`, excluido de Git. Los paquetes se prepararon desde las dependencias de las funciones y sólo incorporaron los cinco archivos de lógica revisados; no se copió toda la carpeta local. El consumidor se pausó durante la migración y se reinició incluso en los intentos fallidos.

Estas pruebas no enviaron mensajes a personas ni crearon viajes reales. Falta el recorrido físico de WhatsApp con pasajero y conductor. Se comprobaron por separado la publicación web, SQL/Edge y el consumidor del VPS.
