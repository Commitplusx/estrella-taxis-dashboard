# Plan de Paridad Total con Traccar (Cero Bugs)

El objetivo es lograr un clon funcional al 100% de la interfaz de Traccar, aplicando su misma lógica y llamadas al API, pero adaptado a la UI moderna (Tailwind + Lucide) del dashboard de Estrella Taxis.

## 🔴 FASE 1: Operación Diaria y Control Geográfico (PRÓXIMO)
Funcionalidades críticas para el rastreo y la gestión logística.

- [ ] **Geocercas (Geofences)**
  - `GET /api/geofences`
  - CRUD de polígonos, líneas y círculos.
  - Integración en el mapa con Google Maps Drawing Manager.
- [ ] **Reporte de Eventos (EventReport)**
  - `GET /api/reports/events`
  - Filtro por tipo de evento (exceso de velocidad, alarmas, geocercas, etc).
- [ ] **Reporte de Paradas y Resumen (Stops & Summary)**
  - `GET /api/reports/stops`
  - `GET /api/reports/summary`
- [ ] **Comandos Remotos (Commands)**
  - `POST /api/commands/send`
  - Enviar comandos en vivo (apagar motor, activar alarma).

## 🟡 FASE 2: Mantenimiento y Reglas de Negocio
Automatizaciones e integraciones para la flotilla.

- [ ] **Mantenimiento (Maintenance)**
  - `GET /api/maintenance`
  - Control de cambios de aceite, llantas (por km, horas de motor o fecha).
- [ ] **Atributos Calculados (Computed Attributes)**
  - Fórmulas matemáticas para sensores (ej. transformar voltaje a % de gasolina).
- [ ] **Calendarios (Calendars)**
  - Restricciones de horarios para notificaciones o geocercas.
- [ ] **Reportes Automáticos (Scheduled Reports)**
  - Envío automático por correo (diario/semanal).
- [ ] **Gráficas (ChartReport)**
  - Visualización de velocidad, altitud o gasolina en gráficas a lo largo del tiempo.

## 🟢 FASE 3: Configuración y Administración (Avanzado)
Herramientas para el dueño/administrador.

- [ ] **Preferencias del Usuario (Preferences)**
  - Unidades de medida (km vs millas), formato de hora, capa de mapa por defecto.
- [ ] **Ajustes de Servidor (Server Settings)**
  - Configuración global, cuotas de registro, mapas.
- [ ] **Conexiones (Permissions/Links)**
  - Asignar choferes a taxis (`POST /api/permissions`)
  - Asignar geocercas a taxis
  - Asignar usuarios a grupos
- [ ] **Auditoría y Logs (Audit & Server Logs)**
  - Registro de quién modificó qué.
  - Ver el log en crudo del servidor Traccar.
- [ ] **Acumuladores (Accumulators)**
  - Ajustar odómetro total y horas de motor de forma manual.
