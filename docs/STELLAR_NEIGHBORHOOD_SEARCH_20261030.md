# GPS H3 y tarifas para direcciones escritas

## Regla del producto

La base mantiene dos fuentes separadas para encontrar y cotizar una recogida:

- **Pin GPS:** el servidor convierte sus coordenadas a H3 y consulta la tarifa del hexágono propio de la base. El mapa y la pantalla **Zonas y tarifas** administran esta cobertura.
- **Dirección escrita:** el bot busca el barrio, fraccionamiento, colonia o punto en `taxi_bot_localities`, pide calle o referencia y usa la tarifa de esa localidad. El pin es opcional. Esta lista no contiene celdas H3.

Una edición del directorio escrito no agrega, quita ni cambia hexágonos. Una tarifa de localidad tampoco sirve de reemplazo si el pasajero envía un pin GPS. En un recorrido con un extremo escrito y otro GPS, cada extremo usa su fuente correspondiente y el servidor valida de nuevo la tarifa antes de registrar el viaje. Una dirección sin localidad/tarifa resuelta no cae por accidente a la tarifa H3. Las referencias del PDF con importes contradictorios quedan sin precio automático hasta que la base los aclare.

## Lista de tarifas

`TARIFAS+LOCALES.pdf` se organiza en categorías independientes: barrios, fraccionamientos, colonias, otros puntos, escuelas, moteles, rancherías, lugares, ejidos, “Cash a” y puntos/rutas. El mismo nombre puede aparecer en categorías distintas y conserva cada precio; si la frase del pasajero no permite distinguirlos, el bot solicita aclaración. Los importes ambiguos, como Rosario Castellanos, se guardan para revisión sin cotizarlos.

El panel `/bot` muestra **Colonias y lugares escritos**, con filtros por categoría, búsqueda por nombre/alias y edición de la tarifa. **Zonas y tarifas** continúa siendo el mapa H3 para GPS. Los cambios de localidad se guardan por base y no disparan recarga ni selección en el mapa.

## Migración y estado

La migración `20261031160000_taxi_written_localities_h3_separation.sql` crea la tabla de localidades por escrito, traslada las antiguas tarifas de referencia y carga las categorías del PDF. También revierte la importación anterior que había aplicado tarifas del PDF a 293 hexágonos, pero sólo si encuentra exactamente los mismos índices, nombres y precios capturados en la revisión; si esas celdas cambiaron, cancela la migración para no sobrescribir ajustes posteriores.

**Estado de datos en producción:** las migraciones de cobertura y localidades ya están aplicadas en el proyecto independiente de Stellar Tracking. La verificación remota encontró 2,541 hexágonos H3 y 191 localidades escritas; conteos, nombres y precios H3 coinciden celda por celda, y las localidades no contienen hexágonos. Las tarifas impresas que se contradicen permanecen sin precio automático.

**Estado de funciones en producción:** `taxi-bot-admin`, `process-queue` y `ycloud-webhook` están activas en versión 2; las tres respondieron 200 a OPTIONS. Las versiones anteriores quedaron respaldadas en `C:/Users/Kaleb/Desktop/pollo-robins-panel/.codex-tmp/stellar-edge-backup-20261030.json`. No se envió WhatsApp real ni se creó un viaje de prueba.

**Estado del panel:** el build local está validado. El proyecto de Vercel no aparece enlazado ni disponible en la sesión; por eso no afirmo que la interfaz ya esté publicada en el dominio.

## Verificación local

- `tests/taxi-neighborhoods.test.ts`: 17 pruebas de contrato, categorías, búsqueda, dirección escrita, GPS y tarifa.
- `tests/taxi-bot-database.test.ts`: 87 pruebas SQL; incluyen restauración exacta de H3, tarifas escritas separadas, mezcla de extremos de fuentes distintas y confirmación vigente.
- `deno check` de `taxi-bot-admin/index.ts` y `ycloud-webhook/index.ts`.
- `npm run build`.

El build conserva avisos existentes sobre tamaño de bundle y carga dinámica de mapas. No se probó una conversación real de WhatsApp, no se enviaron mensajes ni se creó un viaje real.
