import { coord, phone, record, text } from "./contracts.ts";
import { taxiH3Cell } from "./h3.ts";
import { TrackingError, uuid } from "../../tracking/contracts.ts";
import { validChannelPhone } from './channelPhone.ts';
import { customerPhone } from './customerAccess.ts';
export interface AdminTenant {
  id: string;
  name: string;
  plan?: AdminPlan | null;
}
export interface AdminPlan {
  id: string;
  nombre: string;
  precio_mensual: number;
  incluye_bot: boolean;
  incluye_whatsapp: boolean;
  permisos_sistema: Record<string, boolean>;
}
export function parseAdminPlan(value: unknown): AdminPlan | null {
  if (value === null || value === undefined) return null;
  if (!record(value) || !text(value.nombre, 120) ||
      typeof value.precio_mensual !== "number" || !Number.isFinite(value.precio_mensual) || value.precio_mensual < 0 ||
      typeof value.incluye_bot !== "boolean" || typeof value.incluye_whatsapp !== "boolean" ||
      !record(value.permisos_sistema)) throw new Error("No pudimos comprobar el plan de la base.");
  const permissions: Record<string, boolean> = {};
  for (const [key, flag] of Object.entries(value.permisos_sistema)) {
    if (typeof flag !== "boolean") throw new Error("El plan contiene un permiso no válido.");
    permissions[key] = flag;
  }
  return { id: uuid(value.id), nombre: String(value.nombre), precio_mensual: value.precio_mensual,
    incluye_bot: value.incluye_bot, incluye_whatsapp: value.incluye_whatsapp, permisos_sistema: permissions };
}
export interface AdminChannel {
  tenantId: string;
  waba: string;
  name: string;
  city: string;
  enabled: boolean;
  dispatcher: string | null;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  pricingMode: "h3_zone_max" | "road_distance";
  baseCents: number | null;
  perKmCents: number | null;
  revision: number;
}
export interface AdminZone {
  cell: string;
  label: string;
  cents: number | null;
  source: "base" | "catalog";
  assigned: boolean;
}
export interface AdminConversation {
  customer: string;
  mode: "bot" | "human";
  revision: number;
  updatedAt: string;
  history: { role: "user" | "assistant"; content: string }[];
}
export interface AdminDelivery {
  text: string;
  state: string;
  at: string;
}
export interface AdminTrip {
  id: string;
  customer: string;
  name: string;
  origin: string;
  destination: string;
  state: string;
  cents: number | null;
  at: string;
}
export interface AdminContext {
  actorId: number;
  tenants: AdminTenant[];
  channels: AdminChannel[];
  runtimeReady: boolean;
  canConfigure: boolean;
  catalogVersion?: string;
  accessRole?: 'owner' | 'driver' | 'owner_driver';
  canManageAccounts?: boolean;
}
export interface ZonePage {
  zones: AdminZone[];
  hasMore: boolean;
  totalCells: number;
  totalAreas: number;
  version?: string;
}
export interface OperationsPage {
  sessions: AdminConversation[];
  trips: AdminTrip[];
  deliveries: AdminDelivery[];
}
export type AdminWriteAction =
  | "configure"
  | "rename_channel"
  | "upsert_zones"
  | "assign_catalog"
  | "remove_zones"
  | "takeover"
  | "resume"
  | "send";
export interface AdminCommand {
  tenantId: string;
  waba: string;
  requestId: string;
  revision: number;
  action: AdminWriteAction;
  payload: Record<string, unknown>;
}
const fail = (message: string): never => {
  throw new TrackingError(400, "invalid_admin_request", message);
};
export function revision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return fail("Actualiza el panel antes de guardar.");
  }
  return value;
}
export function exact(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    fail("La solicitud contiene campos que no corresponden.");
  }
}
export function cells(value: unknown, max = 400): string[] {
  if (!Array.isArray(value) || !value.length || value.length > max) {
    return fail("Selecciona entre 1 y " + max + " celdas.");
  }
  const result: string[] = [];
  for (const cell of value) {
    if (!taxiH3Cell(cell)) return fail("Hay una celda H3 no válida.");
    if (result.includes(cell)) return fail("La selección repite celdas.");
    result.push(cell);
  }
  return result;
}
export function cents(value: unknown, nullable = false): number | null {
  if (nullable && value === null) return null;
  if (
    typeof value !== "number" || !Number.isSafeInteger(value) ||
    value < (nullable ? 0 : 1) || value > 10000000
  ) return fail("Escribe un importe válido, con un máximo de dos decimales.");
  return value;
}
export function channelFromRow(raw: unknown): AdminChannel {
  if (
    !record(raw) || !text(raw.tenant_id, 40) || !phone(raw.waba) ||
    !text(raw.name, 120) || !text(raw.city, 200) ||
    typeof raw.enabled !== "boolean" ||
    !coord(raw.center_lat, raw.center_lng) ||
    typeof raw.center_lng !== "number" ||
    !(raw.dispatcher === null || phone(raw.dispatcher))
  ) {
    throw new TrackingError(
      502,
      "invalid_admin_data",
      "La configuración del canal no es válida.",
    );
  }
  const radius = Number(raw.radius_km);
  if (
    !Number.isFinite(radius) || radius <= 0 || radius > 100 ||
    (raw.pricing_mode !== "h3_zone_max" && raw.pricing_mode !== "road_distance")
  ) {
    throw new TrackingError(
      502,
      "invalid_admin_data",
      "La zona de servicio no es válida.",
    );
  }
  return {
    tenantId: uuid(raw.tenant_id),
    waba: String(raw.waba),
    name: String(raw.name),
    city: String(raw.city),
    enabled: raw.enabled,
    dispatcher: raw.dispatcher === null ? null : String(raw.dispatcher),
    centerLat: raw.center_lat,
    centerLng: raw.center_lng,
    radiusKm: radius,
    pricingMode: raw.pricing_mode,
    baseCents: cents(raw.base_cents, true),
    perKmCents: cents(raw.per_km_cents, true),
    revision: revision(raw.revision),
  };
}
export function parseCommand(raw: unknown): AdminCommand {
  if (!record(raw)) return fail("Faltan los datos para guardar.");
  exact(raw, [
    "action",
    "tenantId",
    "waba",
    "requestId",
    "revision",
    "payload",
  ]);
  const action = raw.action;
  if (
    action !== "configure" && action !== "rename_channel" && action !== "upsert_zones" &&
    action !== "assign_catalog" && action !== "remove_zones" &&
    action !== "takeover" && action !== "resume" && action !== "send"
  ) return fail("Esa operación no está disponible.");
  const waba = phone(raw.waba);
  if (!waba || !record(raw.payload)) {
    return fail("Completa el número de WhatsApp y los datos del cambio.");
  }
  const p = raw.payload;
  let payload: Record<string, unknown>;
  if (action === "configure" || action === 'rename_channel') {
    exact(p, [
      "name",
      "city",
      "dispatcher",
      "centerLat",
      "centerLng",
      "radiusKm",
      "pricingMode",
      "baseCents",
      "perKmCents",
      "enabled",
      ...(action === 'rename_channel' ? ['newWaba'] : []),
    ]);
    const dispatcher = p.dispatcher === null ? null : phone(p.dispatcher);
    if (
      !text(p.name, 120) || !text(p.city, 200) ||
      !coord(p.centerLat, p.centerLng) || typeof p.centerLng !== "number" ||
      typeof p.radiusKm !== "number" || !Number.isFinite(p.radiusKm) ||
      p.radiusKm <= 0 || p.radiusKm > 100 || typeof p.enabled !== "boolean" ||
      !(p.dispatcher === null || dispatcher) ||
      (p.pricingMode !== "h3_zone_max" && p.pricingMode !== "road_distance")
    ) return fail("Revisa el nombre, ciudad, cobertura y teléfono de la base.");
    const target = action === 'rename_channel' ? p.newWaba : waba;
    if (typeof target !== 'string' || !validChannelPhone(target)) return fail('Revisa el código de país y el número de WhatsApp. Para México usa +52 y el número local.');
    if (dispatcher && customerPhone(dispatcher) === customerPhone(target)) return fail('El teléfono de atención debe ser distinto al WhatsApp del bot para que una persona reciba las alertas.');
    if (p.enabled && !dispatcher) {
      return fail(
        "Agrega el teléfono de atención de la base antes de activar.",
      );
    }
    payload = {
      name: String(p.name).trim(),
      city: String(p.city).trim(),
      dispatcher,
      centerLat: p.centerLat,
      centerLng: p.centerLng,
      radiusKm: p.radiusKm,
      pricingMode: p.pricingMode,
      baseCents: cents(p.baseCents, true),
      perKmCents: cents(p.perKmCents, true),
      enabled: p.enabled,
    };
    if (action === 'rename_channel') {
      if (target === waba || p.enabled) return fail('Guarda primero el canal apagado para cambiar su número.');
      payload.newWaba = target;
    }
  } else if (action === "upsert_zones") {
    exact(p, ["cells", "label", "cents"]);
    if (!text(p.label, 100)) return fail("Ponle un nombre a la zona.");
    payload = {
      cells: cells(p.cells),
      label: String(p.label).trim(),
      cents: cents(p.cents),
    };
  } else if (action === "remove_zones" || action === "assign_catalog") {
    exact(p, ["cells"]);
    payload = { cells: cells(p.cells) };
  } else {
    exact(p, action === "send" ? ["customer", "text"] : ["customer"]);
    const customer = phone(p.customer);
    if (!customer) return fail("El contacto no es válido.");
    payload = { customer };
    if (action === "send") {
      const content = text(p.text, 1500);
      if (!content) return fail("Escribe un mensaje de hasta 1500 caracteres.");
      payload.text = content;
    }
  }
  return {
    action,
    tenantId: uuid(raw.tenantId),
    waba,
    requestId: uuid(raw.requestId),
    revision: revision(raw.revision),
    payload,
  };
}
export function parseContext(value: unknown): AdminContext {
  if (
    !record(value) || typeof value.actorId !== "number" || !Number.isSafeInteger(value.actorId) || value.actorId <= 0 || !Array.isArray(value.tenants) ||
    !Array.isArray(value.channels) || typeof value.runtimeReady !== "boolean" ||
    typeof value.canConfigure !== "boolean"
  ) throw new Error("No pudimos leer la configuración.");
  const tenants = value.tenants.map((t) => {
    if (!record(t) || !text(t.id, 40) || !text(t.name, 120)) {
      throw new Error("Base no válida.");
    }
    return { id: uuid(t.id), name: String(t.name), plan: parseAdminPlan(t.plan) };
  });
  const channels = value.channels.map((c) => {
    if (!record(c)) throw new Error("Canal no válido.");
    return channelFromRow({
      tenant_id: c.tenantId,
      waba: c.waba,
      name: c.name,
      city: c.city,
      enabled: c.enabled,
      dispatcher: c.dispatcher,
      center_lat: c.centerLat,
      center_lng: c.centerLng,
      radius_km: c.radiusKm,
      pricing_mode: c.pricingMode,
      base_cents: c.baseCents,
      per_km_cents: c.perKmCents,
      revision: c.revision,
    });
  });
  return {
    actorId: value.actorId,
    tenants,
    channels,
    runtimeReady: value.runtimeReady,
    canConfigure: value.canConfigure,
    canManageAccounts: value.canManageAccounts === true,
    ...(value.accessRole === 'owner' || value.accessRole === 'driver' || value.accessRole === 'owner_driver' ? { accessRole: value.accessRole } : {}),
    ...(value.catalogVersion === undefined ? {} : { catalogVersion: uuid(value.catalogVersion) }),
  };
}
export function parseZones(value: unknown): ZonePage {
  if (
    !record(value) || !Array.isArray(value.zones) || value.zones.length > 501 ||
    typeof value.hasMore !== "boolean"
  ) throw new Error("No pudimos leer las zonas.");
  let version: string | undefined;
  if (value.version !== undefined) {
    if (typeof value.version !== 'string') throw new Error('No pudimos comprobar la versión del mapa.');
    const parts = value.version.split(':');
    if (parts.length !== 2 || !/^\d+$/.test(parts[0])) throw new Error('La versión del mapa no es válida.');
    version = revision(Number(parts[0])) + ':' + uuid(parts[1]);
  }
  return {
    ...(version ? { version } : {}),
    hasMore: value.hasMore,
    totalCells: revision(value.totalCells),
    totalAreas: revision(value.totalAreas),
    zones: value.zones.map((z) => {
      if (
        !record(z) || !taxiH3Cell(z.cell) || !text(z.label, 100) ||
        (z.source !== "base" && z.source !== "catalog") ||
        typeof z.assigned !== "boolean"
      ) throw new Error("Zona no válida.");
      return {
        cell: z.cell,
        label: String(z.label),
        cents: z.cents === null ? null : cents(z.cents),
        source: z.source,
        assigned: z.assigned,
      };
    }),
  };
}
export function parseOperations(value: unknown): OperationsPage {
  if (
    !record(value) || !Array.isArray(value.sessions) ||
    value.sessions.length > 50 || !Array.isArray(value.trips) ||
    value.trips.length > 50 || !Array.isArray(value.deliveries) ||
    value.deliveries.length > 10
  ) throw new Error("No pudimos leer las conversaciones.");
  const sessions = value.sessions.map((s): AdminConversation => {
    if (
      !record(s) || !phone(s.customer) ||
      (s.mode !== "bot" && s.mode !== "human") ||
      typeof s.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(s.updatedAt)) || !Array.isArray(s.history) ||
      s.history.length > 12
    ) throw new Error("Conversación no válida.");
    return {
      customer: String(s.customer),
      mode: s.mode,
      revision: revision(s.revision),
      updatedAt: s.updatedAt,
      history: s.history.map((h) => {
        if (
          !record(h) || (h.role !== "user" && h.role !== "assistant") ||
          !text(h.content, 3000)
        ) throw new Error("Mensaje no válido.");
        return { role: h.role, content: String(h.content) };
      }),
    };
  });
  const trips = value.trips.map((t): AdminTrip => {
    if (
      !record(t) || !text(t.id, 40) || !phone(t.customer) ||
      !text(t.name, 80) || !text(t.origin, 400) || !text(t.destination, 400) ||
      !text(t.state, 40) || typeof t.at !== "string"
    ) throw new Error("Viaje no válido.");
    return {
      id: String(t.id),
      customer: String(t.customer),
      name: String(t.name),
      origin: String(t.origin),
      destination: String(t.destination),
      state: String(t.state),
      cents: cents(t.cents, true),
      at: t.at,
    };
  });
  const deliveries = value.deliveries.map((d): AdminDelivery => {
    if (
      !record(d) || !text(d.text, 4096) || !text(d.state, 30) ||
      typeof d.at !== "string"
    ) throw new Error("Aviso no válido.");
    return { text: String(d.text), state: String(d.state), at: d.at };
  });
  return { sessions, trips, deliveries };
}
