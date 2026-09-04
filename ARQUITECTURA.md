# 🚕 Stellar Tracking — Guía de Arquitectura y Troubleshooting

> Última actualización: Septiembre 2026  
> Stack: Vite + React + TypeScript · Supabase (Edge Functions + Postgres) · Traccar · Vapi · YCloud · Google Maps

---

## 📋 Índice

1. [Visión General del Sistema](#1-visión-general-del-sistema)
2. [Mapa de Servicios Externos](#2-mapa-de-servicios-externos)
3. [Frontend — Estructura y Páginas](#3-frontend--estructura-y-páginas)
4. [Backend — Edge Functions de Supabase](#4-backend--edge-functions-de-supabase)
5. [Base de Datos — Tablas y Relaciones](#5-base-de-datos--tablas-y-relaciones)
6. [Flujo Completo de una Llamada (Bot de Voz)](#6-flujo-completo-de-una-llamada-bot-de-voz)
7. [Flujo de Tracking en Tiempo Real](#7-flujo-de-tracking-en-tiempo-real)
8. [Variables de Entorno y Secrets](#8-variables-de-entorno-y-secrets)
9. [Planes y Feature Flags](#9-planes-y-feature-flags)
10. [Guía de Troubleshooting](#10-guía-de-troubleshooting)
11. [Dónde Está Cada Cosa](#11-dónde-está-cada-cosa)

---

## 1. Visión General del Sistema

```
Cliente llama por teléfono
        │
        ▼
   [VAPI] ──────────────────────────────────────────────────────────────┐
   Plataforma de IA de voz                                              │
   Transcribe la llamada y ejecuta herramientas                         │
        │                                                               │
        │ Webhook tool-call (book_taxi)                                 │
        ▼                                                               │
[vapi-webhook] ← Supabase Edge Function                                 │
        │                                                               │
        ├──► [Google Maps API] → Geocodifica el origen del cliente      │
        │                                                               │
        ├──► [Traccar API] → Encuentra taxi más cercano (con heading)   │
        │                                                               │
        ├──► [Supabase DB] → Guarda el viaje + token de tracking        │
        │                                                               │
        ├──► [YCloud WhatsApp] → Manda link de tracking al CLIENTE      │
        │                                                               │
        └──► [YCloud WhatsApp] → Manda resumen del viaje al DESPACHADOR │
                                                                        │
Cliente abre WhatsApp → link /track/:token                             │
        │                                                               │
        ▼                                                               │
[track-position] ← Supabase Edge Function (poll cada 5s)              │
        │                                                               │
        └──► [Traccar API] → Lee posición GPS en tiempo real ──────────┘
```

---

## 2. Mapa de Servicios Externos

| Servicio | Qué hace en el sistema | URL / Panel |
|---|---|---|
| **Traccar** | GPS en tiempo real, historial de rutas, velocidad, heading, ignición | `https://taxis.estrella-eats.mx` |
| **Supabase** | Base de datos, Edge Functions, Auth, Storage | `https://supabase.com/dashboard/project/knghdwpxheenkpuajkxl` |
| **Vapi** | Bot de voz IA, transcripción, manejo de llamadas PSTN | `https://dashboard.vapi.ai` |
| **YCloud** | Envío de WhatsApp Business (al despachador y al cliente) | `https://app.ycloud.com` |
| **Google Maps** | Geocodificación del origen del cliente, mapa en el frontend | `https://console.cloud.google.com` |
| **Telnyx** | Número de teléfono que Vapi usa para recibir llamadas | `https://portal.telnyx.com` |
| **Loyalty Estrella** | Proyecto principal del ecosistema. Conexión vía API para validación de clientes y lógica cruzada. | `https://app-estrella.shop` |
| **Vercel / Hosting** | Sirve el frontend (Vite build) | `https://stellar.estrella-eats.mx` |

---

## 3. Frontend — Estructura y Páginas

```
src/
├── App.tsx                    ← Rutas. /track/:token va ANTES del * catch-all
├── context/
│   └── AuthContext.tsx        ← Sesión Traccar + rol RBAC + empresaId del tenant
├── lib/
│   ├── traccarApi.ts          ← Cliente HTTP para toda la API REST de Traccar
│   ├── supabase.ts            ← Cliente de Supabase (anon key, solo frontend)
│   ├── mapIcons.ts            ← Iconos personalizados para el mapa
│   ├── mapsLoader.ts          ← Carga lazy del SDK de Google Maps
│   └── cache.ts               ← Cache en memoria para reducir peticiones repetidas
├── components/
│   ├── Layout.tsx             ← Shell principal (sidebar + contenido)
│   ├── Sidebar.tsx            ← Navegación lateral con RBAC
│   ├── CommandModal.tsx       ← Modal de comandos rápidos
│   ├── ShareModal.tsx         ← Modal para compartir ubicación de unidad
│   ├── EventsDrawer.tsx       ← Drawer lateral de eventos recientes
│   └── ConfirmDialog.tsx      ← Diálogo de confirmación reutilizable
└── pages/
    ├── Landing.tsx            ← Página de marketing pública
    ├── Login.tsx              ← Autenticación contra la API de Traccar
    ├── ResetPassword.tsx      ← Reset de contraseña
    ├── Dashboard.tsx          ← KPIs y resumen del día
    ├── MapPage.tsx            ← Mapa en tiempo real con todos los taxis (PRINCIPAL)
    ├── DevicesPage.tsx        ← CRUD de unidades/dispositivos GPS
    ├── DriversPage.tsx        ← CRUD de conductores
    ├── GroupsPage.tsx         ← CRUD de grupos de unidades
    ├── GeofencesPage.tsx      ← Zonas de geocercas (alertas de entrada/salida)
    ├── MaintenancePage.tsx    ← Control de mantenimiento por km y tiempo
    ├── ReportsPage.tsx        ← Reportes de kilometraje, velocidad, tiempo activo
    ├── ReplayPage.tsx         ← Reproducción de rutas históricas
    ├── NotificationsPage.tsx  ← Historial de alertas del sistema
    ├── DeviceConnectionsPage.tsx ← Estado de conexión de cada GPS físico
    ├── UsersPage.tsx          ← CRUD de usuarios + vinculación a empresas (tenants)
    ├── BotPage.tsx            ← Configuración del Bot de Voz por empresa (RBAC: superadmin)
    ├── PackagesPage.tsx       ← Gestión de planes de suscripción (superadmin)
    ├── SettingsPage.tsx       ← Cuenta del usuario y plan contratado
    └── TrackPage.tsx          ← 🆕 Página PÚBLICA de seguimiento /track/:token
```

### Autenticación y RBAC

- **Traccar** maneja la sesión del panel (cookie de sesión HTTP).
- **Supabase** (`perfiles` tabla) extiende el usuario con `rol` y `empresa_id`.
- Roles disponibles: `superadmin` | `admin_empresa` | `operador`
- `AuthContext` expone: `user`, `userRole`, `empresaId`

---

## 4. Backend — Edge Functions de Supabase

Todas viven en:
```
estrella-taxis-backend/supabase/functions/
```

### `vapi-webhook` ⭐ La más importante

**Ruta:** `POST /functions/v1/vapi-webhook?tenantId={uuid}`  
**Propósito:** Punto de entrada de toda la IA de voz. Vapi la llama en dos momentos:

| Tipo de mensaje | Qué hace |
|---|---|
| `assistant-request` | Construye el agente dinámico: prompt, voz, herramientas, según la empresa del tenant |
| `tool-calls` (book_taxi) | Geocodifica origen → busca taxi en Traccar → crea viaje → manda WhatsApps → responde a la IA |
| `end-of-call-report` | Guarda el transcript de la llamada en `telnyx_active_calls` |

**Archivos compartidos que usa:**
- `_shared/traccar.ts` → Login + búsqueda del taxi más cercano (incluyendo offline)
- `_shared/geo.ts` → Geocodificación con Google Maps + precios por zona H3
- `_shared/whatsapp.ts` → `dispatchToHuman()` y `sendWhatsApp()`

---

### `track-position` 🆕

**Ruta:** `GET /functions/v1/track-position?token={token}`  
**Propósito:** Sirve la posición en tiempo real del taxi asignado a un viaje. La página `/track/:token` lo llama cada 5 segundos.  
**Caching:** La sesión de Traccar se cachea 10 minutos a nivel de módulo para no hacer login en cada poll.

---

### `traccar-webhook`

**Ruta:** `POST /functions/v1/traccar-webhook`  
**Propósito:** Recibe eventos de Traccar (geofence entrada/salida, velocidad excedida, ignición) y los procesa para guardarlos en Supabase o mandar alertas por WhatsApp.

---

### `whatsapp-webhook`

**Ruta:** `POST /functions/v1/whatsapp-webhook`  
**Propósito:** Recibe notificaciones de entrega/lectura de YCloud. Ignora los webhooks de confirmación de YCloud para no procesarlos como alertas reales.

---

### `calculate-driving-scores`

**Ruta:** `POST /functions/v1/calculate-driving-scores`  
**Propósito:** Calcula el score de manejo diario para cada vehículo (velocidad, frenadas, tiempo activo). Se ejecuta automáticamente cada noche a las 23:45 vía cron configurado en `supabase/config.toml`.  
**Parámetros opcionales:** `{ "date": "2026-08-31" }` o `{ "deviceId": 5 }`

---

### `log-command`

**Ruta:** `POST /functions/v1/log-command`  
**Propósito:** Registra comandos enviados a las unidades GPS (inmovilizador, alarma, etc.) en la tabla `command_logs`.

---

### `ai-insights`

**Ruta:** `POST /functions/v1/ai-insights`  
**Propósito:** Genera análisis inteligentes del comportamiento de la flota usando IA.

---

### `generate-fillers`

**Ruta:** `POST /functions/v1/generate-fillers`  
**Propósito:** Genera frases de espera para el bot de voz mientras procesa.

---

### `welcome-email`

**Ruta:** `POST /functions/v1/welcome-email`  
**Propósito:** Envía el correo de bienvenida cuando se crea un nuevo usuario.

---

## 5. Base de Datos — Tablas y Relaciones

```text
paquetes ──────────────────────────────────────────────┐
  id, nombre, precio_mensual,                          │
  incluye_bot, incluye_whatsapp, features              │
                                                       │ (FK)
empresas ─────────────────────────────────────────────►┤
  id (UUID), nombre_empresa, nombre_bot                │
  tipo_negocio ('taxi'|'restaurante'|...)              │
  telefono_telnyx  ← número que Vapi escucha           │
  dispatcher_phone ← WhatsApp del despachador          │
  ciudad           ← usada para geocodificar origen    │
  prompt_personalizado                                 │
  activo, paquete_id (FK → paquetes)                   │
                                                       │
perfiles ─────────────────────────────────────────────►┤
  traccar_user_id (FK → usuario de Traccar)            │
  empresa_id (FK → empresas)                           │
  rol ('superadmin'|'admin_empresa'|'operador')        │
                                                       │
viajes ───────────────────────────────────────────────►┤  🆕
  id (UUID), token (único para URL pública)            │
  tenant_id (FK → empresas)                            │
  device_id    ← ID del taxi en Traccar                │
  taxi_name, cliente_tel, origen, destino              │
  origen_lat, origen_lng                               │
  estado ('en_camino'|'completado'|'cancelado')        │
  created_at                                           │
                                                       │
telnyx_active_calls ──────────────────────────────────►┘
  call_control_id (ID de Vapi), history (transcript)
  tenant_id, origen_actual, destino_actual
  estado, caller_id, confusion_count
  is_processing

h3_zonas
  h3_index  ← hexágono H3 nivel 10
  precio    ← tarifa en MXN para esa zona
  nombre    ← nombre legible de la zona

command_logs
  device_id, command_type, status, created_at

driving_scores
  device_id, date, score, km_total,
  max_speed, hard_brakes, idle_minutes
```

---

## 6. Flujo Completo de una Llamada (Bot de Voz)

```text
1. Cliente llama al número Telnyx (+15676031156)
   └── Telnyx enruta la llamada a Vapi

2. Vapi envía POST a vapi-webhook?tenantId=... (assistant-request)
   └── Supabase busca la empresa por tenantId
   └── Construye el prompt dinámico con: nombre, ciudad, prompt personalizado
   └── Devuelve configuración del agente a Vapi (voz "Layla", modelo llama-3.1-8b-instant)

3. El bot saluda: "¡Buenas! [Empresa] al habla, soy [Bot], ¿en qué le ayudo?"

4. Conversación: recoge origen → destino → teléfono (uno por turno, fluida)

5. Cuando tiene los 3 datos, el LLM ejecuta book_taxi
   └── Vapi envía POST a vapi-webhook?tenantId=... (tool-calls)

6. book_taxi hace en paralelo:
   a. Google Maps → coordenadas del origen
   b. Traccar → lista de dispositivos + posiciones (incluyendo offline)
   c. Calcula taxi más cercano con Haversine (distancia en línea recta)
   d. Filtra taxis a más de 10 km (se descartan)

7. Si encontró taxi:
   a. Crea registro en tabla `viajes` con token único
   b. Manda WhatsApp al CLIENTE: link de tracking en tiempo real
   c. Manda WhatsApp al DESPACHADOR: resumen + link de tracking

8. El bot responde en la llamada:
   - CON taxi: "¡Listo! La unidad [X] ya va en camino. Te mando WhatsApp para seguirlo."
   - SIN taxi: "¡Listo! En unos momentos te mandamos la unidad."

9. Fin de llamada → Vapi envía end-of-call-report
   └── Se guarda el transcript en telnyx_active_calls
```

---

## 7. Flujo de Tracking en Tiempo Real

```text
1. Cliente recibe WhatsApp con link:
   https://stellar.estrella-eats.mx/track/AbCdEf1234

2. Abre el link en su navegador (sin login requerido)
   └── App.tsx renderiza <TrackPage> (ruta pública, antes del * catch-all)

3. TrackPage hace:
   a. Carga Google Maps en el div del mapa
   b. Inicia polling cada 5 segundos a:
      GET /functions/v1/track-position?token=AbCdEf1234

4. track-position Edge Function:
   a. Busca el viaje por token en tabla `viajes`
   b. Obtiene sesión de Traccar (cacheada 10 min, no hace login cada vez)
   c. Llama a GET /api/positions?deviceId={device_id} en Traccar
   d. Devuelve: lat, lng, speed, course (heading), lastUpdate + info del viaje

5. TrackPage actualiza el marcador del taxi en el mapa con:
   - Flecha apuntando según el heading (course en grados 0-360)
   - Velocidad en km/h
   - Indicador de GPS activo (punto verde parpadeante)
   - Origen del cliente (marcador rojo)
```

---

## 8. Variables de Entorno y Secrets

### Supabase Edge Functions Secrets
Se configuran en: **Supabase Dashboard → Edge Functions → Secrets**

| Secret | Descripción | Dónde se usa |
|---|---|---|
| `TRACCAR_URL` | URL base de la API de Traccar (`https://taxis.estrella-eats.mx/api`) | `traccar.ts`, `track-position`, `calculate-driving-scores` |
| `TRACCAR_EMAIL` | Email de acceso a Traccar | Todos los que hablan con Traccar |
| `TRACCAR_PASSWORD` | Contraseña de Traccar | Todos los que hablan con Traccar |
| `SUPABASE_URL` | URL del proyecto Supabase | Todas las Edge Functions |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (bypass de RLS) | Todas las Edge Functions |
| `GOOGLE_MAPS_API_KEY` | Llave de Google Maps (solo para geocodificar en backend) | `geo.ts` |
| `YCLOUD_API_KEY` | API key de YCloud | `whatsapp.ts` |
| `YCLOUD_SENDER` | Número de WhatsApp Business de YCloud (formato: `+52...`) | `whatsapp.ts` |
| `DISPATCHER_PHONE` | Número global del despachador si la empresa no tiene uno propio | `whatsapp.ts` |
| `APP_URL` | URL pública del frontend (para generar links de tracking) | `vapi-webhook` |

### Frontend `.env`
```
VITE_SUPABASE_URL=https://knghdwpxheenkpuajkxl.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_GOOGLE_MAPS_API_KEY=AIza...   ← Usada en TrackPage y MapPage
```

> ⚠️ El `VITE_GOOGLE_MAPS_API_KEY` del frontend DEBE tener restricción de HTTP referrer en Google Cloud Console para que no se abuse. Agregar `https://stellar.estrella-eats.mx/*`.

---

## 9. Planes y Feature Flags

| Feature | Básico $200 | Pro $1,000 | Enterprise $2,500 |
|---|:---:|:---:|:---:|
| Mapa GPS (ver unidades) | ✅ | ✅ | ✅ |
| Alertas por WhatsApp | ✅ | ✅ | ✅ |
| Historial de rutas 30 días | ✅ | ✅ | ✅ |
| Bot de WhatsApp con IA | ❌ | ✅ | ✅ |
| Bot de Voz (Vapi) | ❌ | ✅ | ✅ |
| Tracking en tiempo real (link al cliente) | ❌ | ✅ | ✅ |
| Heading Matcher (taxi apuntando al cliente) | ❌ | ✅ | ✅ |
| Anti-Fugas (km GPS vs km registrados) | ❌ | ❌ | ✅ |
| Telemetría de Mantenimiento Preventivo | ❌ | ❌ | ✅ |
| Mapa de Calor K-Means (demanda predictiva) | ❌ | ❌ | ✅ |

Los planes se configuran en la tabla `paquetes` de Supabase y se asignan a cada empresa en `empresas.paquete_id`.

---

## 10. Guía de Troubleshooting

### 🔴 El bot no contesta la llamada

1. Verificar que Vapi tenga el webhook apuntando a:  
   `https://knghdwpxheenkpuajkxl.supabase.co/functions/v1/vapi-webhook`
2. Verificar que el número de Telnyx esté asociado al asistente en Vapi.
3. Revisar logs: **Supabase → Edge Functions → vapi-webhook → Logs**
4. Buscar en logs: `[VAPI ASSISTANT REQUEST]` — si no aparece, Vapi no está llegando.
5. Si aparece `NO SE ENCONTRÓ EMPRESA`, el `tenantId` en la URL del webhook de Vapi no coincide con ningún `id` en la tabla `empresas`.

---

### 🔴 No se manda WhatsApp al despachador

1. Revisar logs: buscar `[YCLOUD]` en vapi-webhook logs.
2. Si aparece `[YCLOUD API ERROR]`: el número destino no está registrado en YCloud o la API key expiró.
3. Verificar secrets: `YCLOUD_API_KEY`, `YCLOUD_SENDER`, `DISPATCHER_PHONE`.
4. Verificar que la empresa tenga `dispatcher_phone` configurado en la tabla `empresas` (o que `DISPATCHER_PHONE` global esté seteado en Secrets).
5. YCloud requiere que el número destino haya iniciado conversación en las últimas 24h (para mensajes de texto libre). Usar templates si es la primera vez.

---

### 🔴 Traccar no encuentra taxis (No session cookie)

1. Verificar secret `TRACCAR_URL` — debe incluir `/api` al final:  
   ✅ `https://taxis.estrella-eats.mx/api`  
   ❌ `https://taxis.estrella-eats.mx`
2. Verificar `TRACCAR_EMAIL` y `TRACCAR_PASSWORD` en Secrets.
3. En logs buscar: `[TRACCAR LOGIN] Cookie obtenida: SÍ ✓` o `NO ✗`.
4. Si el status de login es 200 pero no hay cookie, el servidor está devolviendo HTML (URL mal formada).

---

### 🟡 No encuentra taxi aunque hay unidades activas

1. Revisar logs: `[TRACCAR] Dispositivo: X, Status: offline, Distancia: Y km`
2. Si la distancia es > 10 km, el sistema los descarta (radio máximo hardcodeado en `traccar.ts` línea ~119).
3. El sistema **incluye unidades offline** siempre que Traccar tenga su última posición.
4. Si no hay ninguna posición en Traccar (`positions` vacío), no hay nada que hacer.

---

### 🟡 La página /track/:token muestra "Viaje no encontrado"

1. Verificar que el token existe en la tabla `viajes` de Supabase.
2. Si el viaje no se guardó, buscar en logs: `[VIAJE] Error al guardar viaje:` — probable error de RLS o falta de permisos.
3. Verificar que la migración de la tabla `viajes` fue aplicada en producción.
4. Si el link lleva a la página de Landing en vez de al tracker, la ruta `/track/:token` está después del `*` en App.tsx — es el bug crítico de orden de rutas.

---

### 🟡 El scoring de manejo no se actualiza

1. La función `calculate-driving-scores` corre cada noche a las 23:45 (cron en `config.toml`).
2. Para correrla manualmente: `POST /functions/v1/calculate-driving-scores`
3. Acepta body: `{ "date": "2026-09-04" }` para recalcular un día específico.
4. Revisar logs del cron en Supabase Dashboard.

---

### 🟡 Google Maps no carga en /track/:token

1. Verificar `VITE_GOOGLE_MAPS_API_KEY` en el `.env` del frontend.
2. Verificar que la API key tenga habilitada la API **Maps JavaScript API** en Google Cloud Console.
3. Verificar que no haya restricción de referrer que bloquee el dominio de staging.

---

## 11. Dónde Está Cada Cosa

### "Quiero cambiar el mensaje que dice el bot al cliente"
```
estrella-taxis-backend/supabase/functions/vapi-webhook/index.ts
└── Buscar: // 5. Armar el mensaje exacto que leerá el bot
    └── Variables: resultMsg (con taxi) / resultMsg (sin taxi)
```

### "Quiero cambiar el mensaje de WhatsApp al despachador"
```
estrella-taxis-backend/supabase/functions/_shared/whatsapp.ts
└── Buscar: const dispatchMessage = ...
```

### "Quiero cambiar el radio máximo de búsqueda de taxis"
```
estrella-taxis-backend/supabase/functions/_shared/traccar.ts
└── Línea ~119: if (nearestTaxi && minDistance <= 10)
    └── Cambiar 10 por los km que quieras
```

### "Quiero cambiar el prompt del bot"
```
Tabla Supabase: empresas → columna prompt_personalizado
O en BotPage del dashboard: Bot de Voz → Editar empresa → "Instrucciones del Bot"
```

### "Quiero agregar un nuevo plan"
```
Tabla Supabase: paquetes → INSERT
O en el dashboard: Planes → Nuevo Plan
```

### "Quiero agregar una nueva empresa (tenant)"
```
Dashboard → Bot de Voz → Nueva Empresa
Campos importantes:
  - ciudad: para geocodificar en la ciudad correcta
  - dispatcher_phone: WhatsApp del despachador de esa empresa
  - telefono_telnyx: número que Vapi escucha para esta empresa
```

### "Quiero ver todos los viajes registrados por el bot"
```
Supabase Dashboard → Table Editor → viajes
O SQL: SELECT * FROM viajes ORDER BY created_at DESC LIMIT 50;
```

### "Quiero ver los transcripts de las llamadas"
```
Supabase Dashboard → Table Editor → telnyx_active_calls
Columna: history → contiene el transcript completo
```

### "Quiero deployar cambios al backend"
```powershell
cd estrella-taxis-backend
npx supabase functions deploy vapi-webhook --no-verify-jwt
npx supabase functions deploy track-position --no-verify-jwt
# (sin && en PowerShell, usar ; para encadenar)
```

### "Quiero deployar cambios al frontend"
```powershell
cd estrella-taxis-dashboard
npm run build
# El deploy lo hace automáticamente Vercel al hacer push a main, o manualmente
```

---

*Generado automáticamente con base en el estado actual del sistema (Septiembre 2026)*
