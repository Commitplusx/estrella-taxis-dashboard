import { TaxiEngine } from "../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/engine.ts";
import type { TaxiServices } from "../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/coordinator.ts";
import { createTaxiAdminHandler } from "../estrella-taxis-backend/supabase/functions/taxi-bot-admin/handler.ts";
import { FleetApi } from "../estrella-taxis-backend/supabase/functions/_shared/tracking/auth.ts";
import type { TrackingStore } from "../estrella-taxis-backend/supabase/functions/_shared/tracking/store.ts";
import type { Fetcher } from "../estrella-taxis-backend/supabase/functions/_shared/tracking/http.ts";
import { record } from "../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts";
import {
  parseCommand,
  parseZones,
  parseContext,
} from "../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/adminContracts.ts";
import { latLngToCell } from "h3-js";
function assert(v: unknown, message = "Assertion failed"): asserts v {
  if (!v) throw new Error(message);
}
function equal(a: unknown, b: unknown) {
  assert(
    JSON.stringify(a) === JSON.stringify(b),
    `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`,
  );
}
const tenant = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  waba = "+529630000001",
  requestId = "33333333-3333-4333-8333-333333333333",
  cell = latLngToCell(16.25, -92.13, 10);
const channel = {
  tenant_id: tenant,
  waba,
  name: "Base sintética",
  city: "Comitán",
  enabled: false,
  dispatcher: null,
  center_lat: 16.25,
  center_lng: -92.13,
  radius_km: 20,
  pricing_mode: "h3_zone_max",
  base_cents: null,
  per_km_cents: null,
  revision: 0,
};
const zonePayload = { cells: [cell], label: "Centro", cents: 4500 };
function fixture(
  options: {
    admin?: boolean;
    role?: string;
    ready?: boolean;
    whatsapp?: boolean;
    voice?: boolean;
    result?: unknown;
  } = {},
) {
  let reads = 0, writes = 0, modelCalls = 0;
  let planned: { action: string; payload: Record<string, unknown> } | null =
    null;
  const store: TrackingStore = {
    writePackages: async () => { throw new Error('No package writes in this fixture.'); },
    writeCompanyPackage: async () => { throw new Error('No package assignment writes in this fixture.'); },
    writeCompanyStatus: async () => { throw new Error('No base status writes in this fixture.'); },
    read: async (table, q) => {
      reads++;
      if (table === "perfiles") {
        equal(q.get("traccar_user_id"), "eq.42");
        return [{ empresa_id: tenant, rol: options.role ?? "admin_empresa" }];
      }
      if (table === "empresas") {
        return [{
          id: tenant,
          nombre_empresa: "Base sintética",
          tipo_negocio: "taxi",
          activo: true,
          paquete: {
            id: "44444444-4444-4444-8444-444444444444",
            nombre: "Plan sintético",
            precio_mensual: 0,
            permisos_sistema: { score_diario: true },
            activo: true,
            incluye_bot: options.voice ?? true,
            incluye_whatsapp: options.whatsapp ?? true,
          },
        }];
      }
      if (table === "taxi_bot_channels") {
        assert(q.get("tenant_id")?.includes(tenant));
        return [channel];
      }
      throw new Error("Undeclared table " + table);
    },
    writeScores: async () => {
      throw new Error("No driving score writes.");
    },
    rpc: async (name, args) => {
      equal(args.p_tenant, tenant);
      equal(args.p_waba, waba);
      if (name === "taxi_bot_admin_read") {
        equal(args.p_view, "zones");
        return { zones: [], hasMore: false, totalCells: 0, totalAreas: 0 };
      }
      equal(name, "taxi_bot_admin_apply");
      assert(planned, "Every write requires an explicit fixture plan.");
      equal(args.p_actor, 42);
      equal(args.p_action, planned.action);
      equal(args.p_payload, planned.payload);
      writes++;
      return options.result ?? { state: "saved", revision: 1 };
    },
  };
  const fetcher: Fetcher = async (input) => {
    const url = new URL(String(input));
    if (url.host === "api.deepseek.com") {
      modelCalls++;
      throw new Error("No model calls in administration.");
    }
    equal(url.pathname, "/api/session");
    return new Response(
      JSON.stringify({
        id: 42,
        administrator: options.admin ?? false,
        disabled: false,
      }),
      {
        status: 200,
        headers: { "set-cookie": "JSESSIONID=fixture-cookie-123; Secure" },
      },
    );
  };
  const handler = createTaxiAdminHandler({
    store,
    fleet: new FleetApi("https://tracking.test/api", fetcher),
    runtimeReady: options.ready ?? false,
  });
  const request = (body: unknown, authenticated = true) =>
    new Request("https://edge.test/taxi-bot-admin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authenticated ? { "x-traccar-token": "fixture-token-123" } : {}),
      },
      body: JSON.stringify(body),
    });
  const writeBody = {
    action: "upsert_zones",
    tenantId: tenant,
    waba,
    requestId,
    revision: 0,
    payload: zonePayload,
  };
  return {
    handler,
    store,
    request,
    writeBody,
    plan: (action: string, payload: Record<string, unknown>) => {
      planned = { action, payload };
    },
    counts: () => ({ reads, writes, modelCalls }),
  };
}
Deno.test("taxi admin: anonymous requests cannot read private channels or write prices", async () => {
  const f = fixture();
  equal((await f.handler(f.request({ action: "context" }, false))).status, 401);
  equal(f.counts().reads, 0);
  equal(f.counts().writes, 0);
});
Deno.test("taxi admin: context is scoped by server identity and does not load the GPS fleet", async () => {
  const f = fixture(),
    response = await f.handler(f.request({ action: "context" }));
  equal(response.status, 200);
  const body: unknown = await response.json();
  assert(record(body));
  equal(body.canConfigure, true);
  equal(body.runtimeReady, false);
  const context = parseContext(body);
  equal(context.actorId, 42);
  equal(context.tenants.length, 1);
  equal(context.tenants[0].id, tenant);
  equal(context.tenants[0].plan?.permisos_sistema.score_diario, true);
  equal(f.counts().modelCalls, 0);
});
Deno.test("taxi admin: unvalidated plan flags cannot grant client capabilities", () => {
  let rejected = false;
  try { parseContext({actorId:42,tenants:[{id:tenant,name:"Base sintética",plan:{id:tenant,nombre:"Plan",precio_mensual:0,incluye_bot:true,incluye_whatsapp:true,permisos_sistema:{score_diario:"true"}}}],channels:[],runtimeReady:false,canConfigure:true}); }
  catch { rejected = true; }
  assert(rejected);
});
Deno.test("taxi admin: context requires a verified positive actor identifier", () => {
  for (const actorId of [undefined, "42", 0, -1, 1.5]) {
    let rejected = false;
    try { parseContext({ actorId, tenants: [], channels: [], runtimeReady: false, canConfigure: false }); }
    catch { rejected = true; }
    assert(rejected);
  }
});
Deno.test("taxi admin: a browser-supplied tenant or actor cannot expand authority", async () => {
  const f = fixture();
  equal(
    (await f.handler(f.request({ ...f.writeBody, tenantId: other }))).status,
    403,
  );
  equal(
    (await f.handler(f.request({ ...f.writeBody, actor: 999 }))).status,
    400,
  );
  equal(f.counts().writes, 0);
});
Deno.test("taxi admin: an operator can read its zones but cannot edit their prices", async () => {
  const f = fixture({ role: "operador" });
  equal(
    (await f.handler(f.request({ action: "zones", tenantId: tenant, waba })))
      .status,
    200,
  );
  equal((await f.handler(f.request(f.writeBody))).status, 403);
  equal(f.counts().writes, 0);
});
Deno.test("taxi admin: an explicit valid edit reaches one scoped transaction with verified actor and request ID", async () => {
  const f = fixture();
  f.plan("upsert_zones", zonePayload);
  equal((await f.handler(f.request(f.writeBody))).status, 200);
  equal(f.counts().writes, 1);
  equal(f.counts().modelCalls, 0);
});
Deno.test("taxi admin: invalid money, duplicate cells and an out-of-coverage area cannot be persisted", async () => {
  const f = fixture();
  for (
    const payload of [{ ...zonePayload, cents: 12.3 }, {
      ...zonePayload,
      cells: [cell, cell],
    }, { ...zonePayload, cells: [latLngToCell(40, -100, 10)] }]
  ) {
    equal(
      (await f.handler(f.request({ ...f.writeBody, payload }))).status,
      400,
    );
  }
  equal(f.counts().writes, 0);
});
Deno.test("taxi admin: stale and conflicting commands are surfaced as conflicts, never success", async () => {
  const f = fixture({ result: { state: "revision_conflict", revision: 5 } });
  f.plan("upsert_zones", zonePayload);
  const response = await f.handler(f.request(f.writeBody));
  equal(response.status, 409);
  const body: unknown = await response.json();
  assert(record(body));
  equal(body.code, "revision_conflict");
});
Deno.test("taxi admin: a transport that is not ready cannot be activated from the form", async () => {
  const f = fixture(),
    payload = {
      name: "Base sintética",
      city: "Comitán",
      dispatcher: "+529630000099",
      centerLat: 16.25,
      centerLng: -92.13,
      radiusKm: 20,
      pricingMode: "h3_zone_max",
      baseCents: null,
      perKmCents: null,
      enabled: true,
    };
  equal(
    (await f.handler(
      f.request({ ...f.writeBody, action: "configure", payload }),
    )).status,
    409,
  );
  equal(f.counts().writes, 0);
});
Deno.test("taxi admin: unknown persistence response remains uncertain instead of claiming a saved price", async () => {
  const f = fixture({ result: {} });
  f.plan("upsert_zones", zonePayload);
  equal((await f.handler(f.request(f.writeBody))).status, 503);
});
Deno.test("taxi admin: validation boundary rejects excess selection and an extra server configuration field", () => {
  for (
    const raw of [{
      action: "upsert_zones",
      tenantId: tenant,
      waba,
      requestId,
      revision: 0,
      payload: {
        ...zonePayload,
        cells: Array.from({ length: 401 }, () => cell),
      },
    }, {
      action: "configure",
      tenantId: tenant,
      waba,
      requestId,
      revision: 0,
      payload: { serviceRole: "not-accepted" },
    }]
  ) {
    let rejected = false;
    try {
      parseCommand(raw);
    } catch {
      rejected = true;
    }
    assert(rejected);
  }
});

Deno.test("taxi admin: existing catalog cells use the same tenant, revision and coverage rules", async () => {
  const f = fixture(), payload = { cells: [cell] };
  f.plan("assign_catalog", payload);
  equal(
    (await f.handler(
      f.request({ ...f.writeBody, action: "assign_catalog", payload }),
    )).status,
    200,
  );
  equal(f.counts().writes, 1);
  const denied = fixture({ role: "operador" });
  equal(
    (await denied.handler(
      denied.request({
        ...denied.writeBody,
        action: "assign_catalog",
        payload,
      }),
    )).status,
    403,
  );
  equal(
    (await f.handler(
      f.request({
        ...f.writeBody,
        action: "assign_catalog",
        payload: { cells: [latLngToCell(0, 0, 10)] },
      }),
    )).status,
    400,
  );
  equal(f.counts().writes, 1);
});
Deno.test("taxi admin: catalog selection is explicit and response counts cannot be inferred from one page", async () => {
  const f = fixture();
  equal(
    (await f.handler(
      f.request({ action: "zones", tenantId: tenant, waba, source: "catalog" }),
    )).status,
    200,
  );
  equal(
    (await f.handler(
      f.request({ action: "zones", tenantId: tenant, waba, source: "other" }),
    )).status,
    400,
  );
  const page = parseZones({
    zones: [{
      cell,
      label: "Centro",
      cents: 4500,
      source: "catalog",
      assigned: false,
    }],
    hasMore: true,
    totalCells: 2541,
    totalAreas: 94,
  });
  equal(page.zones.length, 1);
  equal(page.totalCells, 2541);
  equal(page.totalAreas, 94);
  equal(page.zones[0].assigned, false);
  let rejected = false;
  try {
    parseZones({ ...page, totalCells: -1 });
  } catch {
    rejected = true;
  }
  assert(rejected);
});

Deno.test("taxi admin: WhatsApp activation needs its own plan feature, not voice service", async () => {
  const payload = {
    name: "Base sintética",
    city: "Comitán",
    dispatcher: "+529630000099",
    centerLat: 16.25,
    centerLng: -92.13,
    radiusKm: 20,
    pricingMode: "h3_zone_max",
    baseCents: null,
    perKmCents: null,
    enabled: true,
  };
  const allowed = fixture({ ready: true, whatsapp: true, voice: false });
  allowed.plan("configure", payload);
  equal(
    (await allowed.handler(
      allowed.request({ ...allowed.writeBody, action: "configure", payload }),
    )).status,
    200,
  );
  const denied = fixture({ ready: true, whatsapp: false, voice: true });
  equal(
    (await denied.handler(
      denied.request({ ...denied.writeBody, action: "configure", payload }),
    )).status,
    409,
  );
  equal(denied.counts().writes, 0);
});
for (const whatsapp of [true, false]) {
  Deno.test(
    "taxi engine: channel plan checks WhatsApp " + whatsapp +
      " independently from voice",
    async () => {
      const f = fixture({ whatsapp, voice: !whatsapp });
      let enqueued = 0;
      const store: TrackingStore = {
        ...f.store,
        read: async (table, q) =>
          table === "taxi_bot_channels"
            ? [{
              ...channel,
              enabled: true,
              dispatcher: "+529630000099",
              model: "fixture",
            }]
            : f.store.read(table, q),
        rpc: async (name, args) => {
          equal(name, "taxi_bot_enqueue");
          equal(args.p_tenant, tenant);
          equal(args.p_waba, waba);
          enqueued++;
          return { ignored: false };
        },
      };
      const never = async (): Promise<never> => {
        throw new Error(
          "This plan fixture cannot call model, Maps or dispatch.",
        );
      };
      const services: TaxiServices = {
        interpret: never,
        resolve: never,
        quote: never,
        candidates: never,
      };
      const now = Date.parse("2026-10-28T18:00:00Z"),
        secret = "fixture-signature-secret-not-real";
      const engine = new TaxiEngine(store, services, {
        webhookSecret: secret,
        workerSecret: "fixture-worker-secret-at-least-32-characters",
        ycloudKey: "fixture-key",
        now: () => now,
      }, never);
      const raw = JSON.stringify({
        type: "whatsapp.inbound_message",
        createTime: new Date(now).toISOString(),
        whatsappInboundMessage: {
          id: "fixture-message",
          from: "+529630000002",
          to: waba,
          createTime: new Date(now).toISOString(),
          type: "text",
          text: { body: "Un taxi" },
        },
      });
      const timestamp = String(now / 1000),
        key = await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(secret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        );
      const signature = [
        ...new Uint8Array(
          await crypto.subtle.sign(
            "HMAC",
            key,
            new TextEncoder().encode(timestamp + "." + raw),
          ),
        ),
      ].map((b) => b.toString(16).padStart(2, "0")).join("");
      if (whatsapp) {
        equal(
          (await engine.inbound(raw, "t=" + timestamp + ",s=" + signature))
            ?.status,
          200,
        );
        equal(enqueued, 1);
      } else {
        let denied = false;
        try {
          await engine.inbound(raw, "t=" + timestamp + ",s=" + signature);
        } catch (e: unknown) {
          denied = record(e) && e.code === "taxi_plan_forbidden";
        }
        assert(denied);
        equal(enqueued, 0);
      }
    },
  );
}

Deno.test('taxi quality API: another tenant and an operator cannot inspect private trace content or train exports',async()=>{
 const f=fixture({role:'operador'});
 for(const action of['quality_attempts','quality_trace','training_export','quality_review'])equal((await f.handler(f.request({action,tenantId:tenant,waba,traceId:requestId}))).status,403);
 equal((await f.handler(f.request({action:'quality',tenantId:other,waba,from:'2026-10-01',to:'2026-10-02'}))).status,403);
 equal(f.counts().writes,0);
});
Deno.test('taxi quality API: invalid dates cannot trigger an unbounded report query',async()=>{
 const f=fixture();for(const range of[{from:'2020-01-01',to:'2026-10-28'},{from:'bad',to:'2026-10-28'},{from:'2026-10-28',to:'2026-10-01'}])equal((await f.handler(f.request({action:'quality',tenantId:tenant,waba,...range}))).status,400);equal(f.counts().writes,0);
});
