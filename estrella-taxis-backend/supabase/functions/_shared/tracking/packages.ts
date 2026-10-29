import { numeric, record, TrackingError, uuid } from "./contracts.ts";

export interface PackageFeature {
  id: string;
  label: string;
  incluido: boolean;
}

export interface PackageWrite {
  nombre: string;
  precio_mensual: number;
  incluye_bot: boolean;
  incluye_whatsapp: boolean;
  activo: boolean;
  features: PackageFeature[];
  limite_vehiculos: number | null;
  permisos_sistema: Record<string, boolean>;
}

export interface PackageRecord extends PackageWrite {
  id: string;
}

function invalid(status: 400 | 502, message: string): never {
  throw new TrackingError(status, status === 400 ? "invalid_package" : "invalid_package_data", message);
}

function parseFeatures(value: unknown, status: 400 | 502): PackageFeature[] {
  if (record(value) && Object.keys(value).length === 0) return [];
  if (!Array.isArray(value) || value.length > 100) {
    return invalid(status, "Las características del plan no son válidas.");
  }
  const ids = new Set<string>();
  return value.map((feature) => {
    if (!record(feature) || typeof feature.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(feature.id) || ids.has(feature.id) ||
      typeof feature.label !== "string" || !feature.label.trim() ||
      feature.label.length > 200 || typeof feature.incluido !== "boolean") {
      return invalid(status, "Una característica del plan no es válida.");
    }
    ids.add(feature.id);
    return { id: feature.id, label: feature.label.trim(), incluido: feature.incluido };
  });
}

function parsePermissions(value: unknown, status: 400 | 502): Record<string, boolean> {
  if (!record(value) || Object.keys(value).length > 100) {
    return invalid(status, "Los permisos del plan no son válidos.");
  }
  const result: Record<string, boolean> = {};
  for (const [key, flag] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || typeof flag !== "boolean") {
      return invalid(status, "Un permiso del plan no es válido.");
    }
    result[key] = flag;
  }
  return result;
}

export function parsePackageWrite(value: unknown): PackageWrite {
  if (!record(value)) return invalid(400, "Completa los datos del plan.");
  const allowed = [
    "nombre", "precio_mensual", "incluye_bot", "incluye_whatsapp", "activo",
    "features", "limite_vehiculos", "permisos_sistema",
  ];
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    return invalid(400, "La solicitud contiene campos que no corresponden al plan.");
  }
  const name = typeof value.nombre === "string" ? value.nombre.trim() : "";
  const price = numeric(value.precio_mensual);
  const limit = value.limite_vehiculos;
  if (!name || name.length > 120 || price === null || price < 0 || price > 10000000 ||
    typeof value.incluye_bot !== "boolean" || typeof value.incluye_whatsapp !== "boolean" ||
    typeof value.activo !== "boolean" ||
    !(limit === null || (typeof limit === "number" && Number.isSafeInteger(limit) && limit >= 0 && limit <= 1000000))) {
    return invalid(400, "Revisa el nombre, precio y límites del plan.");
  }
  return {
    nombre: name,
    precio_mensual: price,
    incluye_bot: value.incluye_bot,
    incluye_whatsapp: value.incluye_whatsapp,
    activo: value.activo,
    features: parseFeatures(value.features, 400),
    limite_vehiculos: limit,
    permisos_sistema: parsePermissions(value.permisos_sistema, 400),
  };
}

export function parsePackageRecord(value: unknown): PackageRecord {
  if (!record(value)) return invalid(502, "Un plan guardado no tiene el formato esperado.");
  let id: string;
  try {
    id = uuid(value.id);
  } catch {
    return invalid(502, "Un plan guardado tiene un identificador no válido.");
  }
  const name = typeof value.nombre === "string" ? value.nombre.trim() : "";
  const price = numeric(value.precio_mensual);
  const limit = value.limite_vehiculos;
  if (!name || name.length > 120 || price === null || price < 0 ||
    typeof value.incluye_bot !== "boolean" || typeof value.incluye_whatsapp !== "boolean" ||
    typeof value.activo !== "boolean" ||
    !(limit === null || (typeof limit === "number" && Number.isSafeInteger(limit) && limit >= 0))) {
    return invalid(502, "Un plan guardado no tiene valores válidos.");
  }
  return {
    id,
    nombre: name,
    precio_mensual: price,
    incluye_bot: value.incluye_bot,
    incluye_whatsapp: value.incluye_whatsapp,
    activo: value.activo,
    features: parseFeatures(value.features, 502),
    limite_vehiculos: limit,
    permisos_sistema: parsePermissions(value.permisos_sistema, 502),
  };
}

export function parsePackageRows(value: unknown): PackageRecord[] {
  if (!Array.isArray(value) || value.length > 100) {
    return invalid(502, "No pudimos cargar la lista de planes.");
  }
  return value.map(parsePackageRecord);
}
