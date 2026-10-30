# Pompeyo: dirección escrita y cotización opcional

Publicado el 30-10-2026 en `izrsxygazsalfhpaualj`: webhook y consumidor v12 ACTIVE, motor `taxi-bot-v5-natural-requests`. [Evidencia](STELLAR_NATURAL_REQUESTS_EVIDENCE_20261030.json). Reemplaza el recorrido obligatorio de cotización descrito en la nota anterior; la búsqueda semántica de colonias solicitada después aún no forma parte de esta entrega.

## Conversación

- «¿Me mandas un taxi a Calle Primera número 20?» y «Oye bro, ¿me puedes mandar un taxi a…?» se interpretan como recogida escrita. Los signos de pregunta de una petición cortés ya no invalidan la dirección. Las dudas, alternativas, citas, condiciones y correcciones conservan sus validaciones.
- Si la recogida se puede ubicar, pregunta «Va, ¿a dónde vas?», sin volver a exigir el pin. El siguiente punto puede llegar por texto o por ubicación nativa. Un saludo sin dirección conserva el botón nativo como alternativa a escribir.
- El servidor resuelve direcciones; una colonia, calle genérica o varias coincidencias no se presentan como puerta exacta. Si falta precisión pide calle, número y colonia, y ofrece el pin opcional.
- Se pide el nombre que falta y el resumen vigente. Sólo la confirmación solicita una unidad; no se anuncia taxi asignado antes de que el conductor acepte.

## Precio opcional, sin precios inventados

El borrador nuevo inicia con `fareMode=unquoted`. No llama a la cotización ni obliga a tener un precio antes de solicitar el taxi. El viaje guarda `bot_quote_cents=NULL`, sin convertirlo en cero ni en un importe elegido por el modelo. Las ofertas avisan que la tarifa está por confirmar.

Una petición de precio activa `fareMode=quoted`: usa el cálculo H3 de la base y conserva la comprobación de tarifa vigente y la nueva confirmación si cambia. Las revisiones antiguas ya presentadas mantienen su modo cotizado, incluyendo la exigencia de sus celdas; no se convierten silenciosamente en servicios sin cotización.

`taxi_bot_validate_quote` siempre valida tenant, canal y cobertura de ambas coordenadas antes de permitir un servicio sin precio. Rechaza un borrador `unquoted` que contenga precio/celdas de cotización y cualquier modo desconocido. La asignación, transiciones y outbox permanecen en las RPC existentes.

## Direcciones con OpenStreetMap

Se comprobó que no hay `GOOGLE_MAPS_API_KEY` configurada en este proyecto. La resolución conserva primero las referencias exactas de `lugares_frecuentes`; si no hay clave Google, consulta Photon con datos OSM. [Contrato API](https://github.com/komoot/photon/blob/master/docs/api-v1.md), [condiciones y límites del servicio público](https://github.com/komoot/photon#demo-server).

Sólo hay búsquedas a partir de una dirección del pasajero, acotadas al país y caja geográfica de la base. No hay autocompletado, precarga de calles, búsqueda global del usuario ni seguimiento de sus URLs. Acepta una casa con número y calle coincidentes o un POI con nombre suficiente; no escoge el primer resultado ni el centro de una calle/ciudad.

`TAXI_GEOCODER_URL` permite cambiar el endpoint sin editar código; por defecto es el demo oficial Photon. Ese proveedor permite uso moderado y no garantiza disponibilidad. La instalación lo limita a 30 consultas nuevas/minuto y dos simultáneas mediante SQL, con un intento externo de ocho segundos. Caché privada por base/consulta: hasta 500 entradas por base, siete días para resultados precisos, cinco minutos para ambiguos y treinta segundos para indisponibilidad. No se registran direcciones completas en logs del proveedor. OSM/Photon no garantiza que todos los domicilios estén cartografiados.

## Comprobación y publicación

- Migraciones locales `20261030200000_taxi_optional_fare.sql` y `20261030201500_taxi_address_geocoding.sql`; historia remota `20261030160813` y `20261030160814`.
- Candidato respaldado y publicado desde carpetas aisladas de cada función. Dos cuerpos SQL y 38 fuentes de ejecución descargadas coinciden con el candidato. Tablas de caché/budget con RLS y sin acceso público ni lectura directa de clientes.
- Suite final: 4,911 casos Deno tipados y 101 Node/SQL/integración aprobados; gate de 79 fuentes, tipos estrictos y los dos paquetes de publicación comprobados. Después del ajuste de parámetros Photon se repitieron las 18 pruebas afectadas y el tipado del candidato.
- Cinco mensajes sintéticos con el modelo real aprobaron intención y campos esperados, incluyendo petición cortés, coloquial, destino explícito, precio e hipótesis. No son entrenamiento ni una medida de precisión ciega. Se eliminó el endpoint privado temporal de evaluación.
- Dos búsquedas de lugares públicos respondieron HTTP 200 y se conservaron como ambiguas en lugar de elegir lugares distintos. No acreditan geocodificación de todos los domicilios ni un viaje/WhatsApp físico. El ensayo previo detectó un idioma no aceptado por el proveedor; se retiró ese parámetro antes de publicar.
- Permanecen 33 contactos, 19 GPS y las mismas 2,541 celdas/precios. `stellar-taxi-bot`, `bot-worker` y `wialon-bridge` online con cero reinicios. No se modificaron sus configuraciones.

El canal está habilitado y **Autorizados sigue vacío** por instrucción del propietario. Para una prueba física hace falta agregar un número permitido desde el panel; esta entrega no abrió el bot a otros clientes.
