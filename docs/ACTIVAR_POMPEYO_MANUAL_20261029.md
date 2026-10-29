# Conectar Pompeyo manualmente

**Clientes de prueba:** ya está publicado el [control de autorizados de Pompeyo](STELLAR_AUTHORIZED_CUSTOMERS_20261029.md). Sólo el número del propietario terminado en 9156 está autorizado como cliente; no se abre la IA al público al activar el canal. Se administra en Bot de WhatsApp → Autorizados. No confundir este permiso con el de conductor o dispatcher.

**Mapa web, corrección posterior del propietario:** el mapa principal de seguimiento y el editor H3 usan OpenStreetMap con Leaflet. La integración Mapbox se canceló y se retiró la dependencia recién instalada; esos dos mapas no requieren token de Mapbox ni clave de Google para dibujarse. Esto es un cambio web local. La búsqueda de direcciones escritas del bot es un servicio independiente y conserva por ahora la variable de geocodificación descrita más abajo; no se publicó un cambio de proveedor del backend. Ver [alcance y comprobaciones del mapa](STELLAR_OPENSTREETMAP_20261029.md).

Destino exclusivo: Stellar Tracking, proyecto `izrsxygazsalfhpaualj`, organización Estrella orgs. No ejecutar estos pasos sobre Robin’s, App Estrella ni el primer Stellar de Estrella envios.

Esta guía contiene nombres de configuración y marcadores, ninguna clave real. No reemplaza la comprobación de unidades/ocupación del puente Wialon antes de despachar. La revisión automática rechazó que el agente generara/guardara/configurara claves privadas con «blocked by policy», sin más detalle. Estos son pasos para que el propietario configure sus propios valores directamente; el agente no reintentó esa escritura por otra vía.

## 1. Preparar YCloud

En la cuenta de Pompeyo, comprueba que el teléfono conectado es el esperado. Copia su representación internacional exacta para registrar el canal; el formulario necesita el teléfono, no el WABA ID ni el phone number ID.

La clave se consulta en Developers → API key. Si utilizas una custom app dedicada, su clave se obtiene en API key & permissions y debe poder enviar mensajes de WhatsApp al número de Pompeyo. Custom apps requiere un plan YCloud compatible; no cambies de plan como parte de estos pasos.

Prepara un endpoint de webhook con URL:

```text
https://izrsxygazsalfhpaualj.supabase.co/functions/v1/ycloud-webhook
```

Eventos:

```text
whatsapp.inbound_message.received
whatsapp.message.updated
```

Copia el Signing secret del endpoint para el siguiente paso. Mantén la entrega o app pausada hasta completar la configuración. Los webhooks de Developers → Webhooks son globales a la cuenta; si hay otros números, una custom app permite limitar eventos a Pompeyo. No reemplaces el webhook de otro negocio.

Referencia: [Webhooks YCloud](https://docs.ycloud.com/en/documentation/developer/webhooks), [custom apps](https://docs.ycloud.com/en/documentation/developer/create-and-configure-a-custom-app).

## 2. Guardar variables en Supabase

Abre [Stellar Tracking](https://supabase.com/dashboard/project/izrsxygazsalfhpaualj) → Edge Functions → Secrets. Agrega cada nombre y su valor, y pulsa Save. Los valores se introducen directamente en ese panel, no en el chat.

| Nombre | Valor |
| --- | --- |
| `YCLOUD_API_KEY` | Clave de la cuenta/app que puede enviar desde Pompeyo. |
| `TAXI_YCLOUD_WEBHOOK_SECRET` | Signing secret exacto del webhook preparado. |
| `DEEPSEEK_API_KEY` | Clave propia de DeepSeek con servicio disponible. |
| `GOOGLE_MAPS_API_KEY` | Clave de Google Maps con geocodificación habilitada para resolver direcciones escritas; el cálculo por carretera también usa Directions. |
| `TRACCAR_URL` | `https://taxis.estrella-eats.mx/api` |
| `TRACCAR_EMAIL` | Cuenta de Traccar autorizada para consultar las unidades de Pompeyo. |
| `TRACCAR_PASSWORD` | Contraseña vigente de esa cuenta. |
| `TAXI_WORKER_SECRET` | Secreto aleatorio privado nuevo, de al menos 32 caracteres, conservado para usar el mismo valor en el VPS. |
| `TAXI_BOT_ENABLED` | `false` durante la preparación. |

Supabase suministra `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` al runtime; no se deben crear variables nuevas con el prefijo reservado `SUPABASE_` ni poner una clave privada en `VITE_*`.

Referencia: [Edge Function Secrets](https://supabase.com/docs/guides/functions/secrets).

## 3. Cuenta, canal y zonas

Entra al [editor real](http://127.0.0.1:5290/zonas-tarifas) con la cuenta de Traccar autorizada. La ruta terminada en `-diseno` no guarda cambios.

Si la cuenta no tiene base asignada, un administrador debe registrar en `public.perfiles` el `traccar_user_id` real del usuario, el `empresa_id` de Pompeyo y el rol `admin_empresa` u `operador` según su función. No inventes el ID: es el usuario de Traccar, no un UUID de Supabase Auth. El superadministrador de Traccar puede seleccionar bases sin ese perfil específico.

En Configuración → Nuevo canal completa:

- Nombre: Pompeyo.
- WhatsApp: el número internacional exacto que muestra YCloud.
- Ciudad: Comitán.
- Atención de la base: WhatsApp de quien atenderá las solicitudes que pasan a una persona.
- Centro y radio: ubicación y cobertura reales del servicio; los campos tienen valores iniciales que deben revisarse.
- Cálculo: Por zonas H3.
- Canal apagado mientras se prepara.

Guarda. En Zonas y tarifas, habilita las celdas correspondientes con sus tarifas registradas. El mapa completo en la demostración no implica que se hayan persistido asignaciones para el canal real. La selección por cambio admite hasta 400 celdas; no des un único precio a toda la ciudad si las zonas tienen importes diferentes.

## 4. Conductores y disponibilidad

En el Table Editor de Supabase, cada fila de `conductores` debe tener el `tenant_id` de Pompeyo, `device_id` numérico real de Traccar, teléfono WhatsApp internacional del conductor, nombre y `activo` correcto. `device_id` no es el ID de Wialon ni el IMEI.

Antes de activar, contrasta que los dispositivos autorizados estén online, con GPS reciente/válido y una señal de ocupación fiable. La revisión del puente activo todavía debe resolver/comprobar ocupación desconocida, respuesta HTTP, correspondencia de unidades y unidad de velocidad. No marques una ocupación desconocida como libre para hacer pasar la prueba.

La empresa Pompeyo en `empresas` debe tener `activo=true` y paquete activo con `incluye_whatsapp=true` para la activación final. No cambies empresas ajenas.

## 5. Preparar el consumidor en el VPS

En la terminal propia del propietario, conecta:

```powershell
ssh estrella
```

Como root en el VPS, crea un archivo privado:

```bash
install -d -m 700 /opt/stellar-taxi-bot/config
umask 077
nano /opt/stellar-taxi-bot/config/worker.env
```

Escribe estas dos líneas sustituyendo el marcador por el MISMO secreto privado guardado en Supabase. No ejecutes literalmente el marcador:

```dotenv
TAXI_PROCESS_QUEUE_URL=https://izrsxygazsalfhpaualj.supabase.co/functions/v1/process-queue
TAXI_WORKER_SECRET=REEMPLAZAR_POR_EL_MISMO_SECRETO_DE_SUPABASE
```

Guarda en nano con Ctrl+O, Enter y sal con Ctrl+X. Luego:

```bash
chmod 600 /opt/stellar-taxi-bot/config/worker.env
```

No uses `cat`, capturas ni comandos que impriman ese archivo para demostrar que existe.

## 6. Activar y probar, después de validar la flota

Cuando estén revisados los pasos anteriores:

1. En Supabase Secrets cambia `TAXI_BOT_ENABLED` a `true`.
2. En el editor real, activa y guarda el canal Pompeyo. Si indica configuración incompleta, corrige el motivo; no saltes sus validaciones editando flags directamente.
3. Habilita la entrega del webhook/app correspondiente en YCloud.
4. En el VPS, ejecuta `pm2 status` y comprueba si ya existe `stellar-taxi-bot`. Si ya existe, no crees otro proceso: `pm2 restart stellar-taxi-bot`. Para la primera instalación, cuando todavía no existe, usa:

```bash
pm2 start /root/.deno/bin/deno --name stellar-taxi-bot --interpreter none -- run --env-file=/opt/stellar-taxi-bot/config/worker.env --allow-env=TAXI_PROCESS_QUEUE_URL,TAXI_WORKER_SECRET --allow-net=izrsxygazsalfhpaualj.supabase.co /opt/stellar-taxi-bot/releases/20261029-v3/scripts/run-taxi-worker.ts
```

El binario y la ruta del script se comprobaron por lectura en este VPS. El comando de arranque de esta guía no fue ejecutado por el agente. El consumidor instalado no contiene estado de conversaciones local.

5. Revisa `pm2 logs stellar-taxi-bot --lines 20 --nostream`. Debe registrar `taxi_tick` con conteos. Que PM2 diga online por sí solo no acredita procesamiento. Sólo después de comprobar estabilidad, ejecuta `pm2 save`.
6. Desde tu WhatsApp propio escribe al número de Pompeyo y prueba recogida/destino con ubicaciones inequívocas dentro de zonas habilitadas, tarifa, confirmación y asignación a un conductor de prueba informado. Confirmar puede generar una oferta real: no uses un destino o conductor ajeno a la prueba.
7. En YCloud revisa entrega del webhook y respuesta 2xx. En el panel distingue mensaje aceptado por el proveedor de entregado/leído y de aceptación del conductor. El registro del viaje y la respuesta del conductor deben concordar.

Para detener la prueba, apaga primero el canal y devuelve `TAXI_BOT_ENABLED=false`; `pm2 stop stellar-taxi-bot` detiene exclusivamente el consumidor de taxis. No uses `pm2 restart all` ni reinicies el worker de Robin’s para activar Pompeyo.

## Alcance

Esta guía es preparación manual, no evidencia de activación. Al escribirla el webhook/worker devolvían `503 taxi_disabled`, no había proceso PM2 del consumidor de taxis y no se había hecho un viaje real. La web nueva permanece local. Las comprobaciones posteriores deben confirmar esos estados de nuevo.
