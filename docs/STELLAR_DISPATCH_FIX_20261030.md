# Asignación de taxis: candidatos y aviso — 30-10-2026

## Evidencia

La solicitud mostrada en WhatsApp sí llegó a la confirmación, pero terminó sin unidad: el registro del servidor muestra `candidate_count=0`, `offer_count=0` y cierre por timeout. Por lo tanto, el problema ocurrió antes de crear una oferta; no fue que un conductor la rechazara ni una falla de entrega del mensaje al conductor.

El registro sólo guarda cuántos candidatos hubo, no por qué se excluyó cada unidad. No se puede afirmar cuál de los filtros dejó fuera el taxi cercano. Al revisar la selección vigente se encontraron tres causas que podían reducir candidatos válidos: se limitaba la búsqueda a 10 km aunque la base tenía un radio mayor; se descartaban taxis con el motor apagado; y se rechazaban posiciones marcadas `outdated` antes de comparar la hora real del GPS. Además, sólo se consultan los conductores activos vinculados a unidades y con sus datos de contacto configurados. En el momento de la revisión había 19 unidades vinculadas y 3 conductores activos elegibles; las demás unidades no deben recibir ofertas hasta completar su vínculo con un conductor.

## Cambio

- La selección usa el radio configurado de la base, con el máximo ya validado por el backend.
- Un taxi estacionado puede recibir una oferta. El conductor conserva la decisión final de aceptar o rechazarla.
- Una unidad que Traccar marque `offline` o una posición marcada `outdated` sólo puede entrar si el fix es válido y tiene como máximo dos minutos. La antigüedad general permanece limitada a diez minutos.
- Se siguen excluyendo posiciones inválidas, fixes futuros, taxis confirmados como ocupados, unidades de otra base y vehículos sin conductor activo vinculado.
- La asignación no se considera hecha hasta que el conductor acepte la oferta por su propio WhatsApp.
- Se detectó que el teléfono de atención de la base coincide con el emisor de WhatsApp. Se agregó validación para exigir un teléfono humano diferente en futuras configuraciones. El valor actual se conserva; no se cambió ni se mandó ningún mensaje.

## Verificación y publicación

`test-taxi-bot.ps1` terminó con 4,926 pruebas Deno y 106 pruebas integradas aprobadas; incluye cobertura para radio configurado, motor apagado, fix desconectado reciente y exclusión de GPS viejo. `npm run build` también pasó. La migración `20261030223000` está aplicada y registrada. `process-queue` v14, `ycloud-webhook` v14 y `taxi-bot-admin` v22 aparecen activos; los tres endpoints respondieron al preflight OPTIONS.

El constraint quedó `NOT VALID`: preserva el número de atención que ya estaba guardado, pero impide volver a guardar en el futuro un teléfono de atención igual al emisor del bot. Hay una base que todavía conserva esa configuración heredada; debe cambiarse por el WhatsApp de una persona para que las alertas humanas lleguen a alguien. No se modificó ese dato de producción.

La publicación no comprueba por sí sola que una unidad concreta reciba una oferta. No se repitió el viaje real, no se envió WhatsApp de prueba y no se modificaron contactos ni conductores en producción.
