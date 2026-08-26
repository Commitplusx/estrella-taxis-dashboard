// =====================================================
//  Cliente central de la API de Traccar
//  Todas las llamadas pasan por aquí con credentials
// =====================================================

export const BASE_URL = '/api'; // Usa el proxy de Vite en Local y el de Vercel en Producción

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const hasBody = options.body !== undefined;
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Accept': 'application/json',
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      // Sesión expirada o inválida: limpiar y redirigir al login
      window.location.href = '/login';
      throw new Error('Sesión expirada. Por favor, inicia sesión de nuevo.');
    }
    const error = await response.text();
    throw new Error(error || `HTTP ${response.status}`);
  }

  if (response.status === 204) return {} as T;

  return response.json();
}

// ── Sesión / Auth ──────────────────────────────────
export const api = {
  login: (email: string, password: string) =>
    fetch(`${BASE_URL}/session`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email, password }),
    }).then(res => {
      if (!res.ok) throw new Error('Credenciales incorrectas');
      return res.json();
    }),

  getSession: () => request<TraccarUser>('/session'),

  logout: async () => {
    const res = await fetch(`${BASE_URL}/session`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    if (!res.ok) throw new Error('Logout failed');
  },

  resetPassword: (email: string) =>
    fetch(`${BASE_URL}/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email }),
    }).then(res => {
      if (!res.ok) throw new Error('Error al solicitar recuperación');
    }),

  // ── Dispositivos (Taxis) ──────────────────────────
  getDevices: () => request<TraccarDevice[]>('/devices'),

  getDevice: (id: number) => request<TraccarDevice>(`/devices/${id}`),

  // ── Posiciones actuales ───────────────────────────
  getPositions: (deviceId?: number) =>
    request<TraccarPosition[]>(deviceId ? `/positions?deviceId=${deviceId}` : '/positions'),

  // ── Reportes ──────────────────────────────────────
  getTrips: (params: ReportParams) =>
    request<TraccarTrip[]>(`/reports/trips?${buildReportQuery(params)}`),

  getStops: (params: ReportParams) =>
    request<TraccarStop[]>(`/reports/stops?${buildReportQuery(params)}`),

  getSummary: (params: ReportParams) =>
    request<TraccarSummary[]>(`/reports/summary?${buildReportQuery(params)}`),

  getEvents: (params: ReportParams & { type?: string }) => {
    const q = buildReportQuery(params);
    const types = params.type || 'allEvents';
    return request<TraccarEvent[]>(`/reports/events?${q}&type=${types}`);
  },

  getRoute: (params: ReportParams) =>
    request<TraccarPosition[]>(`/reports/route?${buildReportQuery(params)}`),

  // ── Usuarios (solo Admin) ─────────────────────────
  getUsers: () => request<TraccarUser[]>('/users'),

  // GET /api/devices?userId=X → taxis asignados a ese usuario
  getUserDevices: (userId: number) =>
    request<TraccarDevice[]>(`/devices?userId=${userId}&excludeAttributes=true`),

  // GET /api/devices?all=true → todos los taxis (solo Admin)
  getAllDevices: () => request<TraccarDevice[]>('/devices?all=true&excludeAttributes=true'),

  createUser: (user: Partial<TraccarUser>) =>
    request<TraccarUser>('/users', {
      method: 'POST',
      body: JSON.stringify(user),
    }),

  updateUser: (id: number, user: Partial<TraccarUser>) =>
    request<TraccarUser>(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(user),
    }),

  deleteUser: (id: number) =>
    request<void>(`/users/${id}`, { method: 'DELETE' }),

  // ─── Permisos (vincular/desvincular taxis a usuarios o conductores) ───
  // POST /api/permissions  { userId, deviceId } → vincula
  // DELETE /api/permissions { userId, deviceId } → desvincula
  linkDeviceToUser: (userId: number, deviceId: number) =>
    request<void>('/permissions', {
      method: 'POST',
      body: JSON.stringify({ userId, deviceId }),
    }),

  unlinkDeviceFromUser: (userId: number, deviceId: number) =>
    request<void>('/permissions', {
      method: 'DELETE',
      body: JSON.stringify({ userId, deviceId }),
    }),

  linkGroupToUser: (userId: number, groupId: number) =>
    request<void>('/permissions', {
      method: 'POST',
      body: JSON.stringify({ userId, groupId }),
    }),

  unlinkGroupFromUser: (userId: number, groupId: number) =>
    request<void>('/permissions', {
      method: 'DELETE',
      body: JSON.stringify({ userId, groupId }),
    }),

  linkDeviceToDriver: (driverId: number, deviceId: number) =>
    request<void>('/permissions', {
      method: 'POST',
      // Traccar resuelve el nombre de la tabla SQL basado en el primer parámetro del JSON.
      // tc_device_driver requiere que deviceId vaya primero.
      body: JSON.stringify({ deviceId, driverId }),
    }),

  unlinkDeviceFromDriver: (driverId: number, deviceId: number) =>
    request<void>('/permissions', {
      method: 'DELETE',
      body: JSON.stringify({ deviceId, driverId }),
    }),

  getDriverDevices: (driverId: number) =>
    request<TraccarDevice[]>(`/devices?driverId=${driverId}`),

  // ── Grupos ────────────────────────────────────────
  // ?all=true: Traccar devuelve TODOS los grupos del sistema (solo funciona para admins,
  // para usuarios normales Traccar lo ignora y devuelve sus grupos asignados igualmente).
  getGroups: () => request<TraccarGroup[]>('/groups?all=true'),

  // Grupos vinculados a un usuario específico
  getUserGroups: (userId: number) => 
    request<TraccarGroup[]>(`/groups?userId=${userId}`),
};

// ── Helper para params de reportes ────────────────
function buildReportQuery(params: ReportParams): string {
  const q = new URLSearchParams();
  q.append('from', params.from);
  q.append('to', params.to);
  params.deviceIds?.forEach(id => q.append('deviceId', String(id)));
  params.groupIds?.forEach(id => q.append('groupId', String(id)));
  return q.toString();
}

// ── Types de la API de Traccar ─────────────────────
export type TraccarUser = {
  id: number;
  name: string;
  email: string;
  password?: string;
  administrator: boolean;
  readonly: boolean;
  disabled?: boolean;
  deviceLimit: number;
  attributes: Record<string, unknown>;
};

export type TraccarDevice = {
  id: number;
  name: string;
  uniqueId: string;
  phone?: string;
  model?: string;
  category?: string;
  status: 'online' | 'offline' | 'unknown';
  lastUpdate: string;
  positionId: number;
  groupId: number;
  attributes: Record<string, unknown>;
};

export type TraccarPosition = {
  id: number;
  deviceId: number;
  deviceUniqueId?: string;
  serverTime: string;
  fixTime: string;
  latitude: number;
  longitude: number;
  altitude: number;
  speed: number;      // En nudos
  course: number;
  address: string;
  attributes: {
    batteryLevel?: number;
    motion?: boolean;
    [key: string]: unknown;
  };
};

export type TraccarTrip = {
  deviceId: number;
  deviceName: string;
  startTime: string;
  endTime: string;
  startAddress: string;
  endAddress: string;
  distance: number;
  duration: number;
  maxSpeed: number;
  averageSpeed: number;
  spentFuel: number;
};

export type TraccarStop = {
  deviceId: number;
  deviceName: string;
  startTime: string;
  endTime: string;
  address: string;
  duration: number;
  engineHours: number;
  latitude: number;
  longitude: number;
};

export type TraccarSummary = {
  deviceId: number;
  deviceName: string;
  distance: number;
  averageSpeed: number;
  maxSpeed: number;
  engineHours: number;
  spentFuel: number;
};

export type TraccarEvent = {
  id: number;
  deviceId: number;
  type: string;
  eventTime: string;
  positionId: number;
  geofenceId: number;
  attributes: Record<string, any>;
  maintenanceId: number;
};

export type TraccarGroup = {
  id: number;
  name: string;
  groupId: number;
};

export type TraccarMaintenance = {
  id: number;
  name: string;
  type: string;
  start: number;
  period: number;
  attributes: Record<string, any>;
};

export type ReportParams = {
  from: string;
  to: string;
  deviceIds?: number[];
  groupIds?: number[];
};
