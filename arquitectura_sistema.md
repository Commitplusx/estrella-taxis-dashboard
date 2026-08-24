# 🚖 Estrella Taxis - Arquitectura del Sistema
> Documento vivo para desarrolladores y agentes de IA. Última actualización: Agosto 2026.

## 1. Mapa General del Sistema
El sistema de Estrella Taxis está compuesto por tres piezas fundamentales que se comunican entre sí. 

> ⚠️ **¡ADVERTENCIA CRÍTICA PARA DESARROLLADORES Y AGENTES IA!**
> Existen dos repositorios separados localmente. **NUNCA** crees Edge Functions, webhooks o lógica de base de datos dentro de la carpeta del dashboard. Cada cosa va en su directorio exacto:

1. **Dashboard (Frontend React/Vite)**
   - **Ruta Absoluta:** `C:\Users\Kaleb\Desktop\estrella-taxis-dashboard`
   - **Rol:** Panel de control de administradores y concesionarios. Consume la API de Traccar directamente para gestionar usuarios, permisos, ver mapas y configurar geocercas. TODO el código UI vive aquí.
   
2. **Backend y Funciones (Supabase)**
   - **Ruta Absoluta:** `C:\Users\Kaleb\Desktop\estrella-taxis-backend`
   - **Rol:** Repositorio oficial del backend. Aquí vive la configuración de Supabase, la base de datos moderna y TODAS las Edge Functions (como `welcome-email` y `traccar-webhook`). 
   - *Regla:* Si tienes que correr `supabase functions new ...`, TIENES que hacerlo en esta ruta, jamás en el dashboard.

3. **Servidor GPS (Traccar 5.x en VPS)**
   - **IP del Servidor:** `74.208.153.209` (Puerto `8082` para la API).
   - **Rol:** Recibe la data cruda de los GPS físicos instalados en los taxis, emite webhooks, y maneja el sistema central de autenticación y permisos de acceso.

---

## 2. Direccionamiento para Dispositivos GPS (¿A dónde apuntar?)
Cuando se instale un GPS físico en un taxi, debe ser configurado (vía comandos SMS) para reportar a nuestra plataforma:
- **IP / Dominio:** `74.208.153.209`
- **Puerto:** Depende del protocolo del GPS:
  - Dispositivos genéricos (SinoTrack, ST-901): `5013` o `5023`
  - Dispositivos Coban (TK103): `5001` o `5002`
  - Dispositivos Concox (GT06): `5023`
  - App Móvil (Traccar Client): `5055`

---

## 3. Flujos de Datos Principales

### A. Autenticación y Permisos
- El login en el Dashboard (`Login.tsx`) se hace directamente contra Traccar (`POST /api/session`).
- **NO** se usa Supabase Auth para iniciar sesión en el panel.
- Los correos de recuperación de contraseña los envía Traccar nativamente (vía SMTP configurado en `traccar.xml`).
- Los correos de **Bienvenida / Invitación** se envían a través de la Edge Function `welcome-email` alojada en Supabase (repo backend).

### B. Posiciones en Tiempo Real
- El mapa del Dashboard se conecta a Traccar vía **WebSockets** (`ws://74.208.153.209:8082/api/socket`) para pintar los taxis moviéndose en la pantalla sin recargar.
- En paralelo, Traccar envía un **Webhook** cada vez que recibe una posición. Este webhook apunta a la Edge Function `traccar-webhook` en el proyecto backend, la cual procesa la ubicación y actualiza la tabla `repartidores` en Supabase para tener la última lat/lng siempre fresca en la nube.

### C. Almacenamiento de Fotos (Avatares)
- Las fotos de perfil no se guardan en base64 en la base de datos de Traccar.
- Se suben directamente a **Supabase Storage** (bucket `avatars`).
- Únicamente la URL pública (ej. `https://.../avatars/user_1.jpg`) se inyecta en los `attributes` nativos del usuario en la base de datos de Traccar vía `PUT /api/users/{id}`.

---

## 4. Reglas de Desarrollo (⚠️ LECTURA OBLIGATORIA)

1. **Sin Parches (No hacky fixes):** Si algo falla en Traccar (como un límite de base de datos de 4000 caracteres), no se parcha la UI ni se altera el esquema de la BD del VPS a la fuerza. Se busca la solución arquitectónica (ej. usar Supabase Storage).
2. **Cero `any` en TypeScript:** En todos los bloques `catch` usar `catch (e: unknown)` y verificar con `e instanceof Error`.
3. **Seguridad de Credenciales:** Nunca incrustar contraseñas SMTP ni tokens de súper-admin en el código React. Toda lógica que requiera secretos debe vivir en `estrella-taxis-backend` usando Deno (Edge Functions).
4. **Respetar la Fuente de la Verdad:** Traccar es la fuente de verdad para dispositivos, usuarios y permisos. Supabase es una extensión para analítica, almacenamiento de archivos y flujos externos. No dupliques tablas maestras.

---

## 5. Arquitectura de Despliegue y CORS (Vercel + Traccar VPS)

### A. Bypass de Límites de Vercel
El frontend de este dashboard está desplegado en **Vercel**. Dado que Vercel Serverless impone límites de tiempo de ejecución (30s max) y no soporta conexiones WebSockets de larga duración mediante rewrites en `vercel.json`, se implementó una **Conexión Directa**:
- Las peticiones REST y la conexión WebSocket (`wss://`) apuntan directamente al dominio del VPS (`https://taxis.estrella-eats.mx/api`).
- Esto evita intermediarios y elimina las caídas de WebSocket por timeout del Serverless.

### B. CORS y JSESSIONID (Autenticación Cross-Domain)
Como el frontend y la API viven en distintos orígenes (Cross-Origin), se requiere configuración especial para que los navegadores modernos (Chrome, Safari) no bloqueen la cookie `JSESSIONID` de Traccar:
1. **Traccar (`traccar.xml`):** Se inyecta `<entry key='web.origin'>*</entry>` para permitir el acceso CORS a los endpoints.
2. **Reverse Proxy (Nginx en VPS):** Para que las cookies viajen en modo `include` durante las llamadas `fetch`, Nginx reescribe la ruta de la cookie de sesión para agregar los flags de seguridad necesarios:
   `proxy_cookie_path / "/; HTTPOnly; Secure; SameSite=None";`

### C. Sistema de Caché Reactivo (`useCachedFetch`)
Para evitar sobrecargar el VPS con peticiones idénticas (como recargar la lista de geocercas cada vez que el usuario cambia de pestaña), se implementó el hook custom `useCachedFetch.ts`. 
- **Memoria Temporal:** Guarda la respuesta de la API durante un `ttl` (ej. 60s).
- **Rendimiento:** Permite navegación instantánea entre vistas (`/reports`, `/geofences`, `/replay`).
- **Resiliencia y Sesión:** Si la sesión caduca o la cookie es rechazada (HTTP 401 Unauthorized), el hook detecta la caída y expulsa al usuario al `/login` automáticamente, previniendo estados inconsistentes en la UI.

---

## 6. Estructura del Código del Dashboard (Frontend)

El repositorio `estrella-taxis-dashboard` sigue una estructura modular orientada a la separación de responsabilidades:

```text
src/
├── components/         # Componentes UI reutilizables (Sidebar, Topbar, Layout, Modals)
├── context/            # Estados globales de React
│   └── AuthContext.tsx # Maneja la sesión del usuario (JSESSIONID) y sus permisos
├── hooks/              # Custom Hooks con lógica de negocio
│   ├── useCachedFetch.ts # Hook central para peticiones GET cacheadas (evita spam al VPS)
│   └── useTraccarSocket.ts # Mantiene viva la conexión WSS para el GPS en tiempo real
├── lib/                # Utilidades puras
│   ├── traccarApi.ts   # Configuración de axios/fetch y `BASE_URL` apuntando al VPS
│   ├── mapsLoader.ts   # Carga dinámica de la API de Google Maps
│   └── cache.ts        # Lógica agnóstica de caché en memoria (Map)
└── pages/              # Vistas completas de la aplicación (Router)
    ├── MapPage.tsx     # Pantalla principal (Mapa en Vivo + Taxis + InfoWindows)
    ├── Login.tsx       # Interfaz de acceso
    ├── GeofencesPage.tsx # CRUD y dibujo poligonal de Geocercas
    └── ReplayPage.tsx  # Visor histórico de rutas
```

### 6.1. Patrón de Obtención de Datos (Data Fetching)
Nunca se hacen llamadas `fetch` desnudas en los componentes.
- Para consultas de lectura (GET), se utiliza **exclusivamente** `useCachedFetch('/api/endpoint')`.
- Para mutaciones (POST, PUT, DELETE), se utiliza `fetch` importando `BASE_URL` o envolviendo en funciones helper.
- Tras una mutación exitosa, se invalida el caché usando `dataCache.invalidate('/api/endpoint')` seguido de un `refetch()` local.

---

## 7. Configuración de Nginx en el VPS (Guía de Referencia)

Si el servidor VPS es reinstalado, esta es la configuración **crítica y exacta** que debe llevar el archivo `/etc/nginx/sites-available/default` (o el `.conf` de dominio) para que la comunicación con Vercel no se rompa por problemas de CORS/SSL.

> ⚠️ **IMPORTANTE:** Nunca escribas el bloque `server { listen 443 ssl; }` manualmente. Usa siempre `certbot --nginx -d taxis.estrella-eats.mx` para que Certbot inyecte los certificados. Luego, solo modifica el bloque `location /api/` que Certbot generó.

```nginx
server {
    server_name taxis.estrella-eats.mx;

    location /api/socket {
        proxy_pass http://127.0.0.1:8082/api/socket;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400; # Fundamental para que el WebSocket no se caiga
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8082/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        
        # 🔑 LA CLAVE DEL CROSS-DOMAIN: Inyectar SameSite=None y Secure a la cookie
        proxy_cookie_path / "/; HTTPOnly; Secure; SameSite=None";
    }

    # ... configuraciones SSL inyectadas por Certbot ...
}
```

---

## 8. Configuración Crítica de `traccar.xml`

El archivo maestro del VPS (`/opt/traccar/conf/traccar.xml`) requiere estos parámetros clave para aceptar a nuestro Dashboard de Vercel y operar correctamente:

```xml
<!-- Permitir que Vercel / Localhost consulte la API (CORS) -->
<entry key='web.origin'>*</entry>

<!-- Configuraciones SMTP para recuperación de contraseña -->
<entry key='mail.smtp.host'>smtp.spacemail.com</entry>
<entry key='mail.smtp.port'>465</entry>
<entry key='mail.smtp.ssl.enable'>true</entry>
<entry key='mail.smtp.from'>soporte@estrella-eats.mx</entry>
<entry key='mail.smtp.auth'>true</entry>
<entry key='mail.smtp.username'>soporte@estrella-eats.mx</entry>
<entry key='mail.smtp.password'>LA_PASSWORD_CORRECTA</entry>
```

---

## 9. Flujo del Mapa y WebSockets (`useTraccarSocket.ts` & `MapPage.tsx`)

El "Mapa en Vivo" es la pantalla más compleja y está diseñada para rendimiento ultra-rápido:

1. **Gestión de Memoria (Anti-Leaks):** 
   - `useTraccarSocket` intercepta el evento de desmontaje (`unmount`) para ejecutar `ws.close()` y limpiar `ws.onclose = null`.
   - Si no se limpia, el socket intenta reconectarse en un bucle infinito en segundo plano, consumiendo RAM y tirando el navegador.
   
2. **Dibujo Reactivo (Google Maps API):**
   - El estado de React `positions` es masivo y cambia cada segundo.
   - Para no volver a dibujar todo el mapa desde cero, el componente muta **referencias directas** (`google.maps.Marker.setPosition()`) en un `useEffect`.
   
3. **InfoWindows Persistentes:**
   - La ventana de información de un taxi abierto (InfoWindow) no se cierra y vuelve a abrir cuando el taxi avanza. 
   - El componente localiza la instancia actual de `InfoWindow` y ejecuta `.setContent(htmlString)` para actualizar su batería/velocidad inyectando HTML puro al vuelo.
   
4. **Gesture Handling:**
   - En dispositivos móviles, `gestureHandling` está seteado en `'greedy'` para que los usuarios puedan arrastrar el mapa con 1 solo dedo (sin que se quede atorado intentando hacer scroll a la página).
