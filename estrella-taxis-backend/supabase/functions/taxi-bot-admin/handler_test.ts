import { FleetApi } from "../_shared/tracking/auth.ts";
import type { TrackingStore } from "../_shared/tracking/store.ts";
import { createTaxiAdminHandler } from "./handler.ts";

const packageRow = {
  id: "5b27f946-ecf1-4d52-8778-17ff60619804",
  nombre: "Básico",
  precio_mensual: 299,
  incluye_bot: false,
  incluye_whatsapp: false,
  activo: true,
  features: [],
  limite_vehiculos: null,
  permisos_sistema: {},
};

class PackageStore implements TrackingStore {
  readonly reads: string[] = [];
  writeCount = 0;

  async read(table: string): Promise<unknown[]> {
    this.reads.push(table);
    if (table === "paquetes") return [packageRow];
    if (table === "perfiles") return [{ empresa_id: "5b27f946-ecf1-4d52-8778-17ff60619804", rol: "admin_empresa" }];
    return [];
  }

  async writeScores(): Promise<void> {}

  async writePackages(): Promise<unknown[]> {
    this.writeCount += 1;
    return [packageRow];
  }

  async rpc(): Promise<unknown> {
    return null;
  }
}

function fleet(isAdmin: boolean): FleetApi {
  return new FleetApi("https://traccar.test/api", async (input) => {
    const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
    if (url.pathname !== "/api/session") return new Response("Not found", { status: 404 });
    return new Response(JSON.stringify({ id: 42, administrator: isAdmin }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": "JSESSIONID=0123456789abcdef; Path=/",
      },
    });
  });
}

function request(body: Record<string, unknown>): Request {
  return new Request("https://stellar.test/functions/v1/taxi-bot-admin", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-traccar-token": "valid-test-token" },
    body: JSON.stringify(body),
  });
}

Deno.test("paquetes: superadmin puede leer la lista a través del servicio privado", async () => {
  const store = new PackageStore();
  const handler = createTaxiAdminHandler({ fleet: fleet(true), store, runtimeReady: false });
  const response = await handler(request({ action: "packages_list" }));
  const body: unknown = await response.json();
  if (response.status !== 200 || store.reads.join(",") !== "paquetes" ||
    !JSON.stringify(body).includes('"nombre":"Básico"')) {
    throw new Error("El superadmin no pudo leer los planes desde el backend privado.");
  }
});

Deno.test("paquetes: admin de empresa no obtiene acceso de superadmin", async () => {
  const store = new PackageStore();
  const handler = createTaxiAdminHandler({ fleet: fleet(false), store, runtimeReady: false });
  const response = await handler(request({ action: "packages_list" }));
  if (response.status !== 403 || store.reads.includes("paquetes")) {
    throw new Error("El acceso a planes se extendió fuera del superadmin.");
  }
});

Deno.test("paquetes: admin de empresa no puede crear planes", async () => {
  const store = new PackageStore();
  const handler = createTaxiAdminHandler({ fleet: fleet(false), store, runtimeReady: false });
  const response = await handler(request({
    action: "packages_create",
    requestId: "5b27f946-ecf1-4d52-8778-17ff60619804",
    package: {
      nombre: "Prueba",
      precio_mensual: 0,
      incluye_bot: false,
      incluye_whatsapp: false,
      activo: true,
      features: [],
      limite_vehiculos: null,
      permisos_sistema: {},
    },
  }));
  if (response.status !== 403 || store.writeCount !== 0) {
    throw new Error("Un administrador de empresa pudo intentar crear un plan.");
  }
});

Deno.test("paquetes: superadmin puede crear con un identificador idempotente", async () => {
  const store = new PackageStore();
  const handler = createTaxiAdminHandler({ fleet: fleet(true), store, runtimeReady: false });
  const response = await handler(request({
    action: "packages_create",
    requestId: "5b27f946-ecf1-4d52-8778-17ff60619804",
    package: {
      nombre: "Prueba",
      precio_mensual: 0,
      incluye_bot: false,
      incluye_whatsapp: false,
      activo: true,
      features: [],
      limite_vehiculos: null,
      permisos_sistema: {},
    },
  }));
  if (response.status !== 200 || store.writeCount !== 1) {
    throw new Error("El superadmin no pudo guardar el plan mediante el backend privado.");
  }
});
