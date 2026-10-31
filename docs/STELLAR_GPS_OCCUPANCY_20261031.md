# Switch de libre/ocupado: señal desconocida

> Estado posterior: [actualización inmediata de Wialon al buscar una unidad, publicación v41 y prueba real de la 0540](STELLAR_GPS_REFRESH_20261031.md). Se conserva la regla de ocupación de este documento.

## Comportamiento vigente

El puente activo consulta `prms.io_3.v` de Wialon. Se conserva la polaridad configurada: 0 es ocupado y 1 es libre; se admiten esos números y sus representaciones exactas `"0"`/`"1"`. Cualquier otro valor, campo ausente, booleano o estructura inválida es **desconocido**.

Cada posición emitida lleva `taxiAvailability=free|occupied|unknown`. `occupied` es true, false o el texto `unknown`, respectivamente. Enviar el desconocido explícito evita conservar un false anterior por copia de atributos. [El decodificador OsmAnd de Traccar](https://github.com/traccar/traccar/blob/master/src/main/java/org/traccar/protocol/OsmAndProtocolDecoder.java) admite parámetros adicionales con valores booleanos o de texto; también se comprobó en la base real que las nuevas posiciones contienen los campos agregados.

El bot exige coincidencia entre el estado explícito y el atributo de ocupación. Sólo `free` junto con `occupied=false` permite entrar al cálculo de candidatos. Se rechazan estados contradictorios y datos del puente anterior, porque aquel false podía haberse inventado ante un `io_3` ausente. El selector común también deja de aceptar una ocupación nula o inválida. Permanecen los filtros de GPS reciente/válido, base, conductor en turno, viajes y ofertas. Un taxi libre estacionado sigue siendo elegible; la oferta requiere aceptación del conductor.

No se cambian viajes confirmados ni se cancelan ofertas existentes por esta publicación. La nueva regla se aplica al seleccionar candidatos. No se modifican credenciales, identificadores GPS, velocidad, coordenadas, ignición, batería, precios ni turnos.

## Causa y pruebas

El puente anterior ejecutaba `prms.io_3?.v === 0`; cuando faltaba el campo, emitía false. El asignador también permitía ocupaciones ausentes. Se conservaron cinco fallos de regresión antes de editar: cuatro estados desconocidos aceptados y un false heredado aceptado por el servicio.

La suite completa pasó 22,629 pruebas Deno y 186 Node/SQL. Además aprobaron 29 pruebas del módulo/parche del switch y nueve casos ejecutando el bucle activo revisado con Wialon/OsmAnd simulados, incluida la reproducción del falso libre anterior y la conservación de todos los campos GPS. El módulo CJS pasó comprobación de tipos. Los cinco casos del candidato local de protocolo también aprobaron; ese candidato completo no fue publicado.

Las pruebas de tracking ahora se ejecutan en la suite del bot. Se corrigieron dos referencias de fixture fuera de alcance y se declararon las señales libres de los casos positivos; se conservaron los rechazos esperados. No se omitió la comprobación de tipos.

## Despliegue

En Supabase se publicaron únicamente las funciones del bot que usan la selección de candidatos, con tres módulos runtime revisados: `headingMatcher.ts`, `services.ts` y `gpsOccupancy.ts`. El módulo de autenticación del worker se conserva byte por byte: el nuevo acceso por teléfono corresponde a `taxi-bot-admin` y no necesita desplegarse otra vez dentro de los consumidores. Las fuentes activas descargadas se contrastan con su manifiesto.

En `/root/wialon-bridge/index.js` se aplicó un parche condicionado al SHA-256 de la fuente activa, con copia privada previa en `/root/wialon-bridge/backups/occupancy-20261031-6d8a9726f1e4/`. Se agregó `occupancy.cjs` y un contador agregado `taxi_occupancy_observed`; el resto del bucle existente se conserva. Las fuentes se validaron antes del reemplazo y se reinició únicamente `wialon-bridge`.

La consulta posterior observó 18 posiciones con los campos nuevos: siete libres y once ocupadas; una posición de otra procedencia no tiene el marcador y queda fuera del bot. Entre los diez fixes recientes y válidos había cuatro libres explícitos y seis ocupados. Es una instantánea, no una cantidad fija de unidades elegibles: faltan los otros filtros del despacho. Los dos ciclos inspeccionados reportaron la misma distribución sin valores desconocidos. La ausencia de señal se verificó con casos sintéticos; todavía no se hizo una prueba física desconectando o moviendo el switch.

Los dos consumidores existentes del VPS mantuvieron PID y contador de reinicios; el puente quedó online con un reinicio previsto. Esta entrega no necesita recompilar ni instalar la APK.

La polaridad física de cada instalación sigue pendiente de contrastarse al accionar el switch de una unidad conocida. No se invirtió a ciegas el significado que ya usa Pompeyo.

[Evidencia de hashes, versiones y comprobaciones](STELLAR_GPS_OCCUPANCY_EVIDENCE_20261031.json). Las fuentes del módulo, pruebas y aplicador condicionado están en `deployment/stellar/wialon-bridge/`.
