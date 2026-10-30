# Búsqueda de colonias y referencias de Pompeyo

Implementación desplegada el 30-10-2026 para la única base de esta instalación. Las colonias describen los nombres, alias y referencias de los hexágonos que ya pertenecen a la base; no existe un catálogo tarifario paralelo.

## Cómo encuentra el lugar

- Primero busca coincidencias normalizadas en el nombre o los alias existentes de la base. Para una referencia escrita intenta obtener una dirección precisa con el geocodificador configurado.
- Si hace falta, el buscador semántico propone sólo etiquetas literales de esas 94 zonas. Las propuestas ajenas al conjunto se rechazan; si quedan varias opciones, el bot pide elegir y no selecciona una por su cuenta.
- Mencionar una colonia por sí sola no identifica la puerta ni dispara un viaje. El bot pide una calle o referencia; el pin sigue siendo opcional.
- Si la dirección geocodificada cae fuera de los hexágonos de la colonia indicada, se descarta el punto y se pide corregir colonia o referencia. Si no se puede geocodificar y la persona aporta una referencia suficiente, el punto se marca expresamente como aproximado y usa un hexágono existente de esa zona.
- Una tarifa aproximada sólo se muestra cuando el área tiene un precio uniforme; si sus hexágonos difieren, la cotización queda pendiente. Un pin o una dirección precisa usa las tarifas H3 vigentes de la base.

## Edición desde el panel

La pestaña “Colonias de la base” en `/bot` permite buscar por nombre, alias o significado, abrir el mapa y editar el nombre, aliases, referencias y precio de una zona. Las referencias describen lugares que ayudan al modelo a reconocer el área; no sustituyen la calle o el pin que necesita el conductor.

El administrador se limita al `tenant_id` seleccionado. Cambiar el precio actualiza en una transacción todos los hexágonos existentes bajo esa etiqueta y avanza la versión de cobertura para invalidar cotizaciones viejas. El servidor exige rol de administración, revisión de versión e idempotencia. Los RPC y metadatos no son accesibles directamente desde clientes `anon` o `authenticated`.

Al desplegar, Pompeyo conservó sus 2,541 hexágonos y las 94 zonas existentes: 71 grupos con precio uniforme, 23 con precios distintos entre celdas y cero grupos sin precio. No se modificaron las tarifas existentes. Para esos 23 grupos mixtos, la pantalla muestra el rango; una edición de precio aplica el nuevo importe a todas sus celdas.

## Publicación y verificación

- Migración `20261030210000_taxi_neighborhoods`, aplicada y registrada en la historia de Supabase.
- Funciones activas: `ycloud-webhook` v13, `process-queue` v13 y `taxi-bot-admin` v20. Se publicaron desde fuentes activas descargadas antes del cambio, con sólo los archivos de esta entrega superpuestos; los respaldos y hashes están en `.codex-tmp/neighborhood-live-backup`.
- El panel guarda metadatos por base y tarifas en los hexágonos base. `Autorizados` continúa vacío; no se envió ningún WhatsApp ni se probó un viaje real.
- Validación: control estático del bot sin `any`/supresiones; `deno check` de las tres funciones; 4,926 pruebas Deno y 105 de PostgreSQL simulado aprobadas. Después del último endurecimiento de referencias se repitieron las 15 pruebas de colonias, 4 pruebas SQL de colonias y el control estático. `npm run build` terminó correctamente. El build conserva avisos existentes de tamaño de bundle y carga de mapas.
- No se ejecutó una evaluación conversacional en vivo con DeepSeek ni una revisión visual autenticada: el navegador de Work estaba deshabilitado. Las respuestas semánticas se verificaron con propuestas sintéticas tipadas; la web no se declara validada por una captura del preview.
