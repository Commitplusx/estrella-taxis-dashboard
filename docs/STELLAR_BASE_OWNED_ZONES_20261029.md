# Zonas propias de Pompeyo

Corrección solicitada por Kaleb: los hexágonos y sus precios pertenecen a la base. No se importan, asignan ni habilitan por canal de WhatsApp.

## Contrato vigente

`taxi_bot_base_zones(tenant_id,h3_index,label,price_cents)` es la cobertura usada por el mapa y por `taxi_bot_h3_price`. Dos canales de la misma base leen y editan los mismos precios; otra base no hereda su cobertura. Se mantiene el precio mayor entre recogida y destino, contención exacta H3 y validación de tarifa vigente antes del commit. Una tarifa ausente continúa pendiente; no se inventa un precio ni se usa un vecino.

La migración `20261029195350_taxi_base_owned_zones.sql` reconoce la propiedad de las zonas de la instalación dedicada a Pompeyo. Si quedan zonas sin propietario y hay varias bases, falla para exigir una resolución explícita. Conserva los precios existentes y los ajustes anteriores; si dos canales tienen ajustes incompatibles para una celda, falla sin elegir uno arbitrariamente. No registra IDs generados en el SQL.

La tabla anterior `taxi_bot_h3_cells` queda como historial y deja de usarse para cotizar, administrar zonas o comprobar cobertura al activar el canal. La acción antigua `assign_catalog` devuelve un error explícito de operación retirada, sin escrituras. Los parámetros antiguos `source=base/catalog` se aceptan por compatibilidad, pero ambos devuelven exclusivamente las zonas propias de la base.

La edición y la confirmación de un viaje comparten un bloqueo por base, además del bloqueo existente del canal y las filas. Así la cotización se vuelve a comprobar frente a una modificación de cobertura o precio. Los cambios de zonas invalidan la caché también para los demás canales de la misma base.

## Interfaz

- Se retiran “Todas las zonas / Listas para cotizar”, el botón de habilitación y la leyenda “falta habilitar”.
- El mapa muestra la cobertura de Pompeyo con sus colores y permite editar directamente nombre y tarifa.
- Configuración informa el número de hexágonos de la base, sin pedir vínculos por WhatsApp.
- Registrar conductores y activar el transporte siguen siendo configuraciones independientes; este cambio no crea conductores, activa canales ni envía mensajes.

## Evidencia de publicación

Destino exclusivo: `izrsxygazsalfhpaualj`. Previo: una base, 2 541 zonas sin `tenant_id`, cero vínculos anteriores. Copias de funciones, fuente administrativa y precios en `.codex-tmp/base-zones-before-*`, ignoradas por Git. Se compararon las cinco funciones activas con las fuentes revisadas antes de reemplazarlas.

Las pruebas SQL ejecutan la migración nueva en todas las fixtures operativas. Las fixtures anteriores se usan sólo para probar la migración de datos: propiedad ambigua, ajustes incompatibles y conservación de precios. Se incluyen cobertura completa sin asignación, ediciones entre canales, aislamiento por base, revisión antigua, reentrega y cambio de tarifa antes del commit. El runner conserva la comprobación de tipos.

Esta nota reemplaza las instrucciones de habilitar zonas por canal de `STELLAR_CHANNEL_SETUP_20261029.md` y las notas anteriores del catálogo.

Publicado: migración remota `20261029200052`, administrador v16 activo. Cinco funciones SQL activas coinciden con la migración revisada. Resultado real: 2 541 celdas, 94 nombres, cero zonas sin propietario y cero cambios de nombres/precios originales. Canal permanece en pausa. Advisor de seguridad sin avisos de nivel warn/error. Pruebas: 4 860 Deno, 83 Node/SQL y 18 del handler administrativo; tipos y build aprobados.
