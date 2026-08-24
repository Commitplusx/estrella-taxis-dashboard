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
