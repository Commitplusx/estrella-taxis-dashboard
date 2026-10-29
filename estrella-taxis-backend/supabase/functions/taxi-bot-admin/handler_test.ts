import { FleetApi } from "../_shared/tracking/auth.ts";
import type { TrackingStore } from "../_shared/tracking/store.ts";
import { RestTrackingStore } from "../_shared/tracking/store.ts";
import { createTaxiAdminHandler } from "./handler.ts";
import { parseTaxiBaseList } from '../_shared/tracking/companies.ts';

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
  readonly readQueries: { table: string; query: URLSearchParams }[] = [];
  writeCount = 0;
  companyPackageId: string | null = null;
  assignmentWriteCount = 0;
  packageActive = true;
  companyActive = false;
  statusWriteCount = 0;
  statusRace = false;
  missingProfile = false;

  async read(table: string, query: URLSearchParams): Promise<unknown[]> {
    this.reads.push(table);
    this.readQueries.push({ table, query });
    if (table === "paquetes") return [{ ...packageRow, activo: this.packageActive }];
    if (table === "empresas") return [{
      id: "5b27f946-ecf1-4d52-8778-17ff60619804",
      nombre_empresa: "Base de prueba",
      ciudad: "Comitán",
      activo: this.companyActive,
      tipo_negocio: "taxi",
      paquete_id: this.companyPackageId,
      paquete: this.companyPackageId ? { nombre: packageRow.nombre, activo: this.packageActive, incluye_whatsapp: true } : null,
    }];
    if (table === "perfiles") return this.missingProfile ? [] : [{ empresa_id: "5b27f946-ecf1-4d52-8778-17ff60619804", rol: "admin_empresa" }];
    return [];
  }

  async writeScores(): Promise<void> {}

  async writePackages(): Promise<unknown[]> {
    this.writeCount += 1;
    return [packageRow];
  }

  async writeCompanyPackage(_companyId: string, expectedPackageId: string | null, packageId: string | null): Promise<unknown[]> {
    if (this.companyPackageId !== expectedPackageId) return [];
    this.assignmentWriteCount += 1;
    this.companyPackageId = packageId;
    return [{
      id: "5b27f946-ecf1-4d52-8778-17ff60619804",
      nombre_empresa: "Base de prueba",
      ciudad: "Comitán",
      activo: true,
      paquete_id: packageId,
    }];
  }

  async writeCompanyStatus(companyId: string, expectedActive: boolean, active: boolean): Promise<unknown[]> {
    this.statusWriteCount++;
    if (this.statusRace || this.companyActive !== expectedActive) return [];
    this.companyActive = active;
    return this.read('empresas', new URLSearchParams({ id: 'eq.' + companyId }));
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

Deno.test('bases: lista autenticada conserva bases inactivas y devuelve permisos explícitos', async () => {
  const store = new PackageStore();
  const handler = createTaxiAdminHandler({ fleet: fleet(true), store, runtimeReady: false });
  const response = await handler(request({ action: 'companies_list' }));
  const list = parseTaxiBaseList(await response.json());
  const query = store.readQueries[0]?.query;
  if (response.status !== 200 || !list.canManage || list.bases.length !== 1 || list.bases[0]?.activo !== false ||
    query?.get('limit') !== '101' || query.get('tipo_negocio') !== 'eq.taxi' || query.get('select')?.includes('*')) {
    throw new Error('No se devolvió una lista acotada con el estado real de la base.');
  }
});

Deno.test('bases: la administración de una empresa sólo consulta su base', async () => {
  const store = new PackageStore();
  const handler = createTaxiAdminHandler({ fleet: fleet(false), store, runtimeReady: false });
  const response = await handler(request({ action: 'companies_list' }));
  const list = parseTaxiBaseList(await response.json());
  const query = store.readQueries.find(item => item.table === 'empresas')?.query;
  if (response.status !== 200 || list.canManage || query?.get('id') !== 'eq.5b27f946-ecf1-4d52-8778-17ff60619804') {
    throw new Error('La consulta no se aisló por la base de la cuenta autenticada.');
  }
});

Deno.test('bases: sin sesión o sin asignación no hay lectura de empresas', async () => {
  for (const loggedIn of [false, true]) {
    const store = new PackageStore();
    store.missingProfile = true;
    const handler = createTaxiAdminHandler({ fleet: fleet(false), store, runtimeReady: false });
    const req = request({ action: 'companies_list' });
    if (!loggedIn) req.headers.delete('x-traccar-token');
    const response = await handler(req);
    if (response.status !== (loggedIn ? 403 : 401) || store.reads.includes('empresas')) throw new Error('Se leyeron bases sin una cuenta autorizada.');
  }
});

Deno.test('bases: sólo superadmin cambia el estado, sin escribir ante un rechazo', async () => {
  const store = new PackageStore();
  const handler = createTaxiAdminHandler({ fleet: fleet(false), store, runtimeReady: false });
  const response = await handler(request({ action: 'companies_set_active', companyId: packageRow.id, expectedActive: false, active: true }));
  if (response.status !== 403 || store.statusWriteCount !== 0 || store.reads.includes('empresas')) throw new Error('Una cuenta de empresa pudo activar una base.');
});

Deno.test('bases: activación explícita y repetición del mismo estado son idempotentes', async () => {
  const store = new PackageStore();
  const handler = createTaxiAdminHandler({ fleet: fleet(true), store, runtimeReady: false });
  const body = { action: 'companies_set_active', companyId: packageRow.id, expectedActive: false, active: true };
  const first = await handler(request(body));
  const repeated = await handler(request(body));
  if (first.status !== 200 || repeated.status !== 200 || !store.companyActive || store.statusWriteCount !== 1) throw new Error('La repetición escribió otra vez o no se confirmó el estado real.');
});

Deno.test('bases: una carrera al guardar se informa sin éxito ficticio', async () => {
  const store = new PackageStore();
  store.statusRace = true;
  const handler = createTaxiAdminHandler({ fleet: fleet(true), store, runtimeReady: false });
  const response = await handler(request({ action: 'companies_set_active', companyId: packageRow.id, expectedActive: false, active: true }));
  if (response.status !== 409 || store.companyActive) throw new Error('Se afirmó un estado que no se guardó.');
});

Deno.test('bases: rechaza tipos inválidos antes de leer o escribir', async () => {
  const store = new PackageStore();
  const handler = createTaxiAdminHandler({ fleet: fleet(true), store, runtimeReady: false });
  const response = await handler(request({ action: 'companies_set_active', companyId: packageRow.id, expectedActive: 'false', active: true }));
  if (response.status !== 400 || store.reads.length || store.statusWriteCount) throw new Error('Se aceptó un estado sin validar.');
});

Deno.test('bases: PATCH limita tenant, tipo y estado anterior, y sólo cambia activo', async () => {
  let requestUrl = '', requestMethod = '', requestBody = '';
  const store = new RestTrackingStore('https://tracking.test', 'test-service-key', async (input, init) => {
    requestUrl = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
    requestMethod = init?.method ?? 'GET';
    requestBody = typeof init?.body === 'string' ? init.body : '';
    return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
  });
  await store.writeCompanyStatus(packageRow.id, false, true);
  const query = new URL(requestUrl).searchParams;
  if (requestMethod !== 'PATCH' || query.get('id') !== 'eq.' + packageRow.id || query.get('tipo_negocio') !== 'eq.taxi' || query.get('activo') !== 'eq.false' || requestBody !== '{"activo":true}') {
    throw new Error('El cambio de estado no quedó limitado a la base y valor esperado.');
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

Deno.test("asignación: superadmin consulta las bases en la pantalla de planes", async () => {
  const store = new PackageStore();
  const handler = createTaxiAdminHandler({ fleet: fleet(true), store, runtimeReady: false });
  const response = await handler(request({ action: "packages_assignments_list" }));
  const body: unknown = await response.json();
  if (response.status !== 200 || !JSON.stringify(body).includes('"nombre_empresa":"Base de prueba"')) {
    throw new Error("No se devolvió la lista centralizada de bases para asignación.");
  }
});

Deno.test("asignación: superadmin asigna un plan activo con control de concurrencia", async () => {
  const store = new PackageStore();
  const handler = createTaxiAdminHandler({ fleet: fleet(true), store, runtimeReady: false });
  const response = await handler(request({
    action: "packages_assign",
    companyId: "5b27f946-ecf1-4d52-8778-17ff60619804",
    expectedPackageId: null,
    packageId: packageRow.id,
  }));
  const body: unknown = await response.json();
  if (response.status !== 200 || store.assignmentWriteCount !== 1 ||
    !JSON.stringify(body).includes(`"paquete_id":"${packageRow.id}"`)) {
    throw new Error("No se confirmó la asignación del plan a la base.");
  }
});

Deno.test("asignación: no permite asignar un plan inactivo", async () => {
  const store = new PackageStore();
  store.packageActive = false;
  const handler = createTaxiAdminHandler({ fleet: fleet(true), store, runtimeReady: false });
  const response = await handler(request({
    action: "packages_assign",
    companyId: "5b27f946-ecf1-4d52-8778-17ff60619804",
    expectedPackageId: null,
    packageId: packageRow.id,
  }));
  if (response.status !== 409 || store.assignmentWriteCount !== 0) {
    throw new Error("Se permitió asignar un plan inactivo.");
  }
});

Deno.test("asignación: rechaza una edición concurrente sin sobrescribirla", async () => {
  const store = new PackageStore();
  store.companyPackageId = packageRow.id;
  const handler = createTaxiAdminHandler({ fleet: fleet(true), store, runtimeReady: false });
  const response = await handler(request({
    action: "packages_assign",
    companyId: "5b27f946-ecf1-4d52-8778-17ff60619804",
    expectedPackageId: null,
    packageId: null,
  }));
  if (response.status !== 409 || store.assignmentWriteCount !== 0 || store.companyPackageId !== packageRow.id) {
    throw new Error("La asignación obsoleta sobrescribió el plan actual.");
  }
});

Deno.test("asignación: admin de empresa no puede administrar planes de las bases", async () => {
  const store = new PackageStore();
  const handler = createTaxiAdminHandler({ fleet: fleet(false), store, runtimeReady: false });
  const response = await handler(request({
    action: "packages_assignments_list",
  }));
  if (response.status !== 403 || store.reads.includes("empresas")) {
    throw new Error("Un administrador de empresa pudo consultar la asignación global de planes.");
  }
});

Deno.test("asignación: PATCH exige que el plan anterior siga vigente", async () => {
  let requestUrl = "";
  let requestMethod = "";
  let requestBody = "";
  const store = new RestTrackingStore("https://tracking.test", "test-service-key", async (input, init) => {
    requestUrl = input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
    requestMethod = init?.method ?? "GET";
    requestBody = typeof init?.body === "string" ? init.body : "";
    return new Response(JSON.stringify([{
      id: "5b27f946-ecf1-4d52-8778-17ff60619804",
      nombre_empresa: "Base de prueba",
      ciudad: "Comitán",
      activo: true,
      paquete_id: packageRow.id,
    }]), { headers: { "Content-Type": "application/json" } });
  });
  await store.writeCompanyPackage(
    "5b27f946-ecf1-4d52-8778-17ff60619804",
    null,
    packageRow.id,
  );
  const parsedUrl = new URL(requestUrl);
  if (requestMethod !== "PATCH" ||
    parsedUrl.searchParams.get("paquete_id") !== "is.null" ||
    parsedUrl.searchParams.get("id") !== "eq.5b27f946-ecf1-4d52-8778-17ff60619804" ||
    requestBody !== JSON.stringify({ paquete_id: packageRow.id })) {
    throw new Error("La escritura no protegió la asignación con el valor esperado anterior.");
  }
});
