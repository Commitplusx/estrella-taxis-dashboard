# Recogida, referencias y aclaración del destino

Esta nota conserva la evidencia de la entrega v18/versiones 32. La publicación vigente y su verificación posterior están en [STELLAR_SEMANTIC_CLARIFICATION.md](STELLAR_SEMANTIC_CLARIFICATION.md).

Motor: `taxi-bot-v18-pickup-context`. Corrige la conversación reportada donde «Vendrían por mí / Al centro / Estoy en la fuente» terminó con Centro como destino y luego volvió a pedir el GPS al aclarar «No, me llevarían a plaza, yo estoy en el centro».

## Causas y corrección

- El intérprete leía «Al centro» como destino aislado, sin enlazarlo con «Vendrían por mí». Ahora las instrucciones y tres diálogos de herramientas distinguen recogida, referencia, destino y desplazamiento real en mensajes fragmentados.
- La regla anterior trataba toda afirmación de ubicación como reemplazo. Ahora diferencia reafirmar el lugar del pin de pedir otra recogida. El backend también conserva un GPS verificado cuando se repite exactamente una descripción ya guardada y no hay evidencia de traslado ni petición pendiente de reemplazar el pin. Otra entrada, otro lugar, un traslado explícito o una descripción sólo parecida siguen requiriendo GPS nuevo.
- `pickupReference` se aplicaba antes de `origin`, por lo que «centro» sobrescribía «la fuente». El coordinador valida primero el límite combinado y aplica la referencia después del lugar. Conserva ambos textos y evita duplicar una referencia ya conocida.

El destino corregido vuelve a pasar por resolución y tarifa del servidor. Se genera otro resumen; el botón anterior no crea el viaje. Las coordenadas continúan sujetas a la prueba del evento nativo en PostgreSQL.

## Evidencia

Las regresiones se fijaron antes de editar ejecución. `.codex-tmp/taxi-pickup-context-before.log` conserva los dos fallos de pérdida de referencia y borrado del GPS. La prueba SQL recorre solicitud fragmentada → GPS → nombre → destino → aclaración con reafirmación de recogida → botón anterior rechazado → botón vigente → un viaje y una oferta.

Evaluación acotada con `deepseek-chat`, sobre datos sintéticos: los ocho casos iniciales pasaron de 4/8 a 8/8. Una comprobación posterior añadió una sesión anterior que sólo tenía «la fuente» guardada y terminó en 9/9. Se conservaron las expectativas; los ocho casos de la comparación no cambiaron. Los casos usados como ejemplos son desarrollo, no cohorte ciega ni precisión general del modelo. Reportes privados: `.codex-tmp/pickup-context-eval/model-before.json`, `model-after.json` y `model-final.json`.

El evaluador temporal sólo ejecutó interpretaciones sintéticas, sin acceso a conversaciones ni mutaciones de viajes. Se autenticó con una capacidad temporal independiente y fue eliminado después; la capacidad local también se retiró. No se enviaron WhatsApps.

La suite reproducible local acepta `--suite=pickup` en `estrella-taxis-backend/scripts/evaluate-taxi-intents.ts`; usa exclusivamente `DEEPSEEK_API_KEY` y `TAXI_EVAL_MODEL` desde el entorno privado y mantiene un límite de doce llamadas.

Verificación aprobada: 5,965 pruebas Deno, 127 pruebas Node/SQL, control de calidad de 94 archivos y comprobaciones de tipos. El gate completo se conserva en `.codex-tmp/taxi-pickup-context-final.log`; la repetición final de Deno, con el caso adicional de sesión anterior, en `.codex-tmp/taxi-pickup-context-deno-final.log`.

## Publicación verificada

`process-queue` y `ycloud-webhook` activos en versión 32 en `izrsxygazsalfhpaualj`, con `verify_jwt=false` conservado y HTTP 200 a OPTIONS antes y después. Se descargaron ambas funciones antes y después: sólo diferían los cuatro archivos revisados antes de publicar y no hay diferencias entre la descarga posterior y el candidato probado. Respaldo temporal: `stellar-v18-pickup-context`.

SHA-256 de las fuentes activas:

- `contracts.ts`: `91A0BE2F36261675857F809C0F2F223727D53D598DD9F4A47C34EDAE7A81391F`.
- `coordinator.ts`: `2E9135C6635F88C8A1FD5251994452ACE71A7DB47D27C2DBE51953B5BAB76851`.
- `conversationTools.ts`: `FA30E68F1228002A24EC815A0ED4953C375AA5B075D32A0D513B8B078BEF3DF1`.
- `interpreter.ts`: `93D9744FBE2F6C0E10C647F34BF3DB55492C54783CE51D58992DB50DBD8DD8D9`.

No se aplicaron migraciones ni se enviaron mensajes reales. La ausencia del evaluador temporal se comprobó con la lista de funciones después del despliegue.
