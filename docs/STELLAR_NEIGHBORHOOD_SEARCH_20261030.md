# Colonias y tarifas de Pompeyo

Importación de la lista local de tarifas, 30 de octubre de 2026. La fuente entregada fue `TARIFAS+LOCALES.pdf`; el PDF no se copia al repositorio.

## Datos guardados

La tarifa se guarda en la base de Pompeyo, sin crear un catálogo de tarifas separado. Se conservaron las 2,541 celdas H3 y las 94 zonas que ya tenía la base.

Se actualizaron 16 grupos de colonias que ya tenían H3, es decir, 293 celdas:

- **$55:** 1ro de mayo, Infonavit, Colonia Miguel Aleman, Fovisste, Popular, Los pinos, Mariano N Ruiz y Centro.
- **$65:** El brasilito, Jacarandas, Las brisas y Valle Balun Canan.
- **$80:** Junchavin, Bugambilias primera seccion, Bugambilias segunda seccion y Paraiso comiteco.

Se añadieron 11 nombres con una tarifa de referencia y sin celdas H3. El panel los identifica como pendientes de ubicar en el mapa:

- **$55:** La Esmeralda, Campo de la Mariano N. Ruiz, San Juan y 27 de Junio.
- **$80:** Manuel Velasco, Reforma, La Esperanza, Chula Vista y Monte Cristo.
- **$160:** Chichima Sabinal y Chichima Acapetahua.

Los valores de referencia aparecen en Colonias y ayudan a cotizar una dirección; por sí solos no representan un punto de recogida ni asignan un taxi. Cuando se configure su ubicación en el mapa, podrán ligarse a la cobertura H3 de la base.

## Búsqueda y cotización

- El buscador compara nombre y alias de las 94 zonas H3 y las 11 localidades de referencia. La búsqueda semántica sólo puede proponer nombres del mismo conjunto.
- Mencionar una colonia no basta para asignar el servicio: se pide una calle o referencia. El pin sigue siendo opcional.
- La tarifa de una localidad pendiente sólo se usa cuando la dirección escrita se geocodifica con precisión dentro de la cobertura real de Pompeyo. Una dirección ambigua o sin coordenadas precisas no produce ubicación aproximada, precio inventado ni despacho.
- Si el origen o destino ya usa H3 sin una tarifa de referencia, la cotización conserva el algoritmo existente de la base.

## Panel y publicación

La pestaña **Colonias de la base** en `/bot` muestra 105 nombres: las 94 zonas con H3 y las 11 tarifas pendientes de mapa. Los grupos existentes conservan su identidad y cobertura; editar su tarifa actualiza todas sus celdas H3. Las referencias nuevas pueden editarse, pero no asignárseles hexágonos hasta ubicarlas.

Se aplicó y registró la migración `20261031120000_taxi_document_local_fares` en el proyecto de Supabase de Stellar Tracking. La respuesta del RPC de lectura contiene 105 entradas; el conteo de H3 permanece en 2,541 celdas y 94 grupos, 293 celdas coinciden con los nuevos precios y las 11 referencias siguen sin celdas. Una cotización sintética al RPC de referencia devolvió el estado `priced` a $55. No se creó un viaje ni se envió WhatsApp de prueba.

Funciones de Supabase activas: `ycloud-webhook` v16, `process-queue` v16 y `taxi-bot-admin` v23. OPTIONS respondió 200 en las tres funciones.

Validación local: pruebas de colonias 16/16, pruebas de base del bot 87/87, `deno check` de las tres funciones, control estático de calidad del bot y `npm run build` aprobados. El build conserva los avisos preexistentes de tamaño del bundle y carga del mapa. No se probó una conversación real con WhatsApp.
