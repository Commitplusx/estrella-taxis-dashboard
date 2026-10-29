import {
  parsePackageRecord,
  parsePackageWrite,
  type PackageWrite,
} from "./packages.ts";

Deno.test("paquete valida y normaliza el default JSON vacío de características", () => {
  const value = parsePackageRecord({
    id: "5b27f946-ecf1-4d52-8778-17ff60619804",
    nombre: "Básico",
    precio_mensual: "299.00",
    incluye_bot: false,
    incluye_whatsapp: false,
    activo: true,
    features: {},
    limite_vehiculos: null,
    permisos_sistema: {},
  });
  if (value.features.length !== 0 || value.precio_mensual !== 299) {
    throw new Error("El plan válido no se normalizó correctamente.");
  }
});

Deno.test("paquete rechaza propiedades no declaradas", () => {
  let rejected = false;
  try {
    parsePackageWrite({
      nombre: "Básico",
      precio_mensual: 299,
      incluye_bot: false,
      incluye_whatsapp: false,
      activo: true,
      features: [],
      limite_vehiculos: null,
      permisos_sistema: {},
      empresa_id: "otro-tenant",
    });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("La escritura aceptó un campo no previsto.");
});

Deno.test("paquete conserva el contrato de escritura del panel", () => {
  const payload: PackageWrite = {
    nombre: "Flota",
    precio_mensual: 799,
    incluye_bot: true,
    incluye_whatsapp: true,
    activo: true,
    features: [{ id: "gps", label: "GPS en tiempo real", incluido: true }],
    limite_vehiculos: 20,
    permisos_sistema: { mapa_calor: true },
  };
  const parsed = parsePackageWrite(payload);
  if (parsed.features[0]?.id !== "gps" || parsed.permisos_sistema.mapa_calor !== true) {
    throw new Error("La escritura válida perdió campos del paquete.");
  }
});
