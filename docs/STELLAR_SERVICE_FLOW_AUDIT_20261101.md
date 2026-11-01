# Revisión del servicio completo de Stellar — 1 de noviembre de 2026

## Resultado y corrección publicada

Se comprobó la ruta existente desde el ingreso firmado de WhatsApp hasta finalizar el viaje, usando el intérprete con decisiones explícitas de prueba, el selector real, PostgreSQL aislado y el transporte simulado. También se revisaron el consumidor, configuración, colas y resultados agregados reales de Pompeyo. No se enviaron WhatsApps ni se crearon servicios reales de QA.

La revisión encontró una discrepancia en la combinación de fuentes: un reporte físico reciente con `valid=false` y ocupado podía sustituirse por el punto libre del celular. La prueba de regresión reprodujo `true` cuando se esperaba descartar la unidad. `combineTaxiPositions` ahora sólo permite reemplazar un reporte físico ausente o comprobablemente anterior a treinta minutos. Un reporte inválido, reloj desconocido o punto futuro mantiene el descarte del selector; no convierte la unidad en libre. La misma regla se utiliza en el simulador y en la recuperación con fuente móvil cuando falla el refresco físico.

La corrección está publicada en **Stellar Tracking**, Supabase `izrsxygazsalfhpaualj`: `process-queue` **v53** y `taxi-bot-admin` **v40** ACTIVE. `ycloud-webhook` permanece v49 y `track-position` v4. No hubo otra migración SQL, reinicio de consumidor o compilación APK en esta revisión. Los 54 archivos runtime descargados después de publicar coinciden con las fuentes locales, normalizando solamente saltos de línea.

## Contrato del recorrido

| Paso | Comportamiento comprobado |
| --- | --- |
| Solicitud | Firma del proveedor, canal y empresa propios, autorización del contacto, evento duradero y deduplicación. Los mensajes sucesivos se agrupan con el debounce de 15 segundos. |
| Datos | El origen exige pin nativo; nombre y destino se recogen sin perder datos anteriores. Se pregunta por el destino y el cliente puede diferirlo explícitamente. Una corrección invalida el resumen anterior. |
| Resumen | Se consulta y revalida la tarifa del servidor. En Pompeyo el mínimo configurado es $55. No se añade el precio al resumen ordinario; se responde cuando el cliente lo pregunta. El origen incluye Maps y se conserva el destino escrito o GPS. |
| Confirmación | Sólo el botón vigente crea la solicitud. Texto afirmativo, botones antiguos, otro contacto o reentrega no crean otro viaje. El backend vuelve a comprobar pin, cobertura y tarifa. |
| Selección | Turno activo, base, permisos, unidad sin viaje ni oferta incompatibles, disponibilidad explícita, antigüedad y tiempo detenido. GPS físico primero; celular autorizado y reciente después. No se toman puntos físicos inválidos ni se convierten señales desconocidas en libre. |
| Ofertas | Hasta tres unidades simultáneas por ronda, tres minutos de vencimiento común y tres rondas. Las siguientes consultas excluyen a los contactados. Un callback de entrega no extiende la oferta. |
| Sin aceptación | Pregunta única con Seguir esperando / Cancelar, token de cinco minutos y una sola ampliación de búsqueda. No hay reintento infinito. Los fallos de flota/proveedor pueden llevar antes a revisión de la base. |
| Aceptación | La primera aceptación válida gana dentro de PostgreSQL; revoca las restantes. Oferta vencida, chofer de otra unidad, turno cambiado, taxi ya ocupado o botón ajeno no asignan. |
| Avisos | La outbox registra una notificación al cliente con el enlace `/track/<token>` y el aviso al chofer con contacto, Maps y Finalizar viaje. La reentrega no duplica la asignación. |
| Seguimiento | El navegador consulta el endpoint por token cada cinco segundos mientras el viaje está activo y la página visible. No es una suscripción pública a toda la flota. GPS móvil se usa para la unidad asignada cuando corresponde; al terminar se deja de mostrar su ubicación. |
| Finalización | Sólo el chofer vigente de la oferta aceptada puede finalizar. Viaje `completado`, oferta `finished`, cierre del presupuesto y retiro de la reserva. La unidad vuelve a poder seleccionarse si conserva turno, ubicación y señal libre elegibles. Un viaje terminal no se reabre. |

Se conserva el máximo ordinario de cinco mensajes al cliente, con respuestas adicionales por dudas o cambios. Las ofertas al conductor no consumen ese presupuesto. El mensaje de búsqueda y la cortesía final pueden omitirse para reservar el aviso de asignación; la finalización del estado no depende de enviar esa cortesía.

Un acuse del proveedor no prueba entrega o lectura. Una respuesta incierta no se reenvía a ciegas; queda registrada y el circuito puede pausar el canal para revisión. El panel conserva pausa de emergencia y reanudación controlada. Una pausa no puede retirar mensajes que ya recibió el proveedor.

## Comprobaciones de producción

- Canal de Pompeyo habilitado, WABA verificado por sufijo **2491**, mínimo 5500 centavos, regla `h3_zone_max`, radio de 20 km.
- Consumidor `stellar-taxi-bot` online, cero reinicios, fuente idéntica a la local salvo saltos de línea. Últimos doce ciclos observados con `failed=0`. Traccar activo y puente Wialon online; no se cambiaron sus configuraciones.
- Corte de últimas 24 horas: dos viajes completados, ambos con oferta finalizada y aviso de asignación leído; un viaje cerrado por tiempo. Treinta eventos terminados. Cero mensajes pendientes, enviándose o inciertos y cero rondas esperando fuera de plazo.
- Dos salidas fallidas históricas en ese corte: una oferta aceptada por el proveedor pero luego reportada como fallida, y un aviso de cierre bloqueado por autorización del contacto. No se reenvió ninguno. El primero no se contabiliza como entregado; el segundo no elude la lista de autorizados.
- Una de las dos finalizaciones tiene cortesía leída. El contrato permite omitir esa cortesía dentro del límite de mensajes; este conteo no se usa para inventar entrega del servicio ni una tasa de éxito.

## Pruebas y límites

Pasaron **22,910** pruebas de las suites de conversación/backend, **180** de la matriz SQL actual, **3** de entradas Edge y **29** Node de panel, acceso, empaquetado y separación: **23,122** en esta revisión. El gate estático revisa ahora 150 archivos, incluyendo los módulos y pruebas móviles y de seguimiento. `deno check` aprobó las cuatro entradas relevantes.

La matriz SQL completa estaba bloqueada en Windows por CRLF: un parche histórico con guarda buscaba una secuencia LF que el checkout había convertido. El lector de SQL del fixture normaliza los saltos de línea antes de aplicar las migraciones; no se alteran los scripts publicados ni se omiten sus guardas. El fixture incorpora las dos migraciones móviles actuales. Se conserva la prueba de teléfono inválido/rol pendiente y el permiso explícito para que un propietario conduzca.

Tres recorridos integrados usan el ingreso firmado, cola real aislada, decodificador de herramientas, consentimiento, selector real, aceptación, enlace y finalización: GPS físico, celular y celular con fallo del refresco físico. Cubren que no se despacha antes del clic, se crea un solo viaje, el aviso es único, hay Maps para el chofer, vuelve a quedar elegible y no se reenvían salidas completadas.

No se utilizó el modelo real ni el proveedor real para esos casos automatizados. No es una medición de precisión de IA, entrega física de WhatsApp, capacidad bajo carga ni GPS de un teléfono bloqueado. La APK de turnos y ubicación sigue siendo la debug 1.0.0+3 de la entrega anterior; su instalación y prueba física continúan pendientes de dispositivo.

Los cambios están guardados en el checkout aislado de Stellar. La publicación de funciones está verificada por separado; el push a GitHub no se declara completado, ya que la sesión de Git no tenía credenciales disponibles en la entrega anterior. Ver [evidencia de esta revisión](STELLAR_SERVICE_FLOW_AUDIT_20261101.evidence.json).
