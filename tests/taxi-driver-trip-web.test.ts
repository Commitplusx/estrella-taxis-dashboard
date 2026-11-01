import assert from "node:assert/strict";
import { createDriverTripHandler } from "../estrella-taxis-backend/supabase/functions/driver-trip/handler.ts";
import {
  type DriverTripView,
  parseDriverTrip,
} from "../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/driverTripContracts.ts";
import {
  parseOutgoing,
  sendTaxiMessage,
} from "../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/transport.ts";
import type { TrackingStore } from "../estrella-taxis-backend/supabase/functions/_shared/tracking/store.ts";
import {
  pickupText,
  trackingFresh,
  trackingPointUrl,
} from "../src/lib/taxiTrackingPresentation.ts";
const tenant = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222",
  requestId = "33333333-3333-4333-8333-333333333333";
const token = "a".repeat(64), origin = "https://stellar.estrella-eats.mx";
const trip: DriverTripView = {
  id,
  status: "en_camino",
  passenger: "Persona de prueba",
  unit: "Unidad de prueba",
  origin: { text: "Punto de prueba", lat: 16.25, lng: -92.13 },
  destination: { text: "Centro", lat: null, lng: null },
  arrivedAt: null,
  paused: false,
  canArrive: true,
  canFinish: true,
  arrivalNotice: null,
};
interface Options {
  state?: string;
  plan?: boolean;
  companyTenant?: string;
  replyTrip?: unknown;
  throwRead?: boolean;
  applyTenant?: string;
}
function fixture(options: Options = {}) {
  const calls: { rpc: string; params: Record<string, unknown> }[] = [],
    queries: URLSearchParams[] = [];
  const store: Pick<TrackingStore, "read" | "rpc"> = {
    read: async (table, query) => {
      assert.equal(table, "empresas");
      queries.push(query);
      return [{
        id: options.companyTenant ?? tenant,
        activo: true,
        tipo_negocio: "taxi",
        paquete: { activo: true, incluye_whatsapp: options.plan ?? true },
      }];
    },
    rpc: async (name, params) => {
      calls.push({ rpc: name, params });
      if (options.throwRead) throw new Error("Private storage detail");
      if (name === "taxi_driver_trip_read") {
        return {
          state: options.state ?? "ready",
          tenantId: tenant,
          trip: options.replyTrip ?? trip,
        };
      }
      assert.equal(name, "taxi_driver_trip_apply");
      return {
        state: "ready",
        tenantId: options.applyTenant ?? tenant,
        trip: {
          ...trip,
          arrivedAt: "2026-11-01T19:00:00Z",
          canArrive: false,
          arrivalNotice: "pending",
        },
      };
    },
  };
  return { handler: createDriverTripHandler(store), calls, queries };
}
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + "/api", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, ...headers },
    body: JSON.stringify(body),
  });
}
Deno.test("Driver web reads require a private capability, reveal no tenant and cannot mark arrival", async () => {
  const f = fixture(),
    res = await f.handler(request({ action: "read", token }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-store, max-age=0");
  assert.equal(res.headers.get("Referrer-Policy"), "no-referrer");
  assert.deepEqual(await res.json(), { trip });
  assert.deepEqual(f.calls, [{
    rpc: "taxi_driver_trip_read",
    params: { p_token: token },
  }]);
  assert.equal(f.queries[0].get("id"), "eq." + tenant);
});
Deno.test("Driver web mutations pass explicit action and durable request id only after the plan check", async () => {
  const f = fixture(),
    res = await f.handler(request({ action: "arrive", token, requestId }));
  assert.equal(res.status, 200);
  assert.deepEqual(f.calls.map((c) => c.rpc), [
    "taxi_driver_trip_read",
    "taxi_driver_trip_apply",
  ]);
  assert.deepEqual(f.calls[1].params, {
    p_token: token,
    p_request: requestId,
    p_action: "arrive",
  });
  const blocked = fixture({ plan: false });
  assert.equal(
    (await blocked.handler(request({ action: "finish", token, requestId })))
      .status,
    403,
  );
  assert.equal(blocked.calls.length, 1);
});
Deno.test("Driver web rejects customer tracking keys, caller-selected tenants and malformed request ids", async () => {
  for (
    const body of [
      { action: "read", token: "a".repeat(32) },
      { action: "read", token, tenantId: tenant },
      { action: "arrive", token },
      { action: "arrive", token, requestId: "invalid" },
      { action: "read", token, requestId },
      { action: "cancel", token, requestId },
    ]
  ) {
    const f = fixture();
    assert.equal((await f.handler(request(body))).status, 400);
    assert.equal(f.calls.length, 0);
  }
});
Deno.test("Driver web rejects expired/unknown capabilities and disabled/mismatched tenant plans", async () => {
  for (
    const [state, status] of [["not_found", 404], ["expired", 410], [
      "paused",
      409,
    ]] as const
  ) {
    const f = fixture({ state });
    assert.equal(
      (await f.handler(request({ action: "arrive", token, requestId }))).status,
      status,
    );
    assert.equal(f.calls.length, 1);
    assert.equal(f.queries.length, 0);
  }
  const wrong = fixture({ companyTenant: id });
  assert.equal(
    (await wrong.handler(request({ action: "finish", token, requestId })))
      .status,
    403,
  );
  assert.equal(wrong.calls.length, 1);
});
Deno.test("Driver web denies cross-origin writes, GET/query operations and oversized JSON", async () => {
  const f = fixture();
  assert.equal(
    (await f.handler(
      request({ action: "arrive", token, requestId }, {
        Origin: "https://another.example",
      }),
    )).status,
    403,
  );
  assert.equal(
    (await f.handler(new Request(origin + "?action=arrive&token=" + token)))
      .status,
    405,
  );
  assert.equal(
    (await f.handler(
      request({ action: "read", token, noise: "a".repeat(3000) }),
    )).status,
    413,
  );
  assert.equal(f.calls.length, 0);
});
Deno.test("Driver web does not expose storage failures or accept invalid backend data", async () => {
  for (
    const options of [{ throwRead: true }, {
      replyTrip: { ...trip, canArrive: true, paused: true },
    }, { applyTenant: id }]
  ) {
    const f = fixture(options);
    const res = await f.handler(
      request({ action: "arrive", token, requestId }),
    );
    assert.equal(res.status, 503);
    assert.ok(!JSON.stringify(await res.json()).includes("Private storage"));
  }
});
Deno.test("Driver web read contract forbids impossible action states and incomplete coordinates", () => {
  for (
    const value of [
      { ...trip, status: "completado" },
      { ...trip, arrivedAt: "2026-11-01T00:00:00Z" },
      { ...trip, origin: { text: "X", lat: 91, lng: 0 } },
      { ...trip, origin: { text: "X", lat: 16, lng: null } },
      { ...trip, id: "-".repeat(36) },
      { ...trip, arrivalNotice: "imagined" },
    ]
  ) assert.throws(() => parseDriverTrip(value));
  assert.equal(
    parseDriverTrip({
      ...trip,
      status: "completado",
      canArrive: false,
      canFinish: false,
    }).status,
    "completado",
  );
});
const url = origin + "/driver-trip#" + token;
const raw = {
  id,
  lease: requestId,
  tenant_id: tenant,
  waba: "+529630000001",
  destination: "+529630000002",
  dedupe_key: "driver-assigned:" + id,
  body: {
    text: "Viaje de prueba asignado.",
    buttons: null,
    urlButton: { title: "Ver mi viaje", url },
  },
};
Deno.test("Driver assignment URL becomes exactly one native WhatsApp CTA without fare or reply-button mixing", async () => {
  let calls = 0;
  const outgoing = parseOutgoing(raw),
    res = await sendTaxiMessage(outgoing, "fixture-key", async (_url, init) => {
      calls++;
      const body: unknown = JSON.parse(String(init?.body));
      assert.deepEqual(body, {
        from: raw.waba,
        to: raw.destination,
        externalId: "taxi:" + id,
        type: "interactive",
        interactive: {
          type: "cta_url",
          body: { text: raw.body.text },
          action: {
            name: "cta_url",
            parameters: { display_text: "Ver mi viaje", url },
          },
        },
      });
      return Response.json({ id: "synthetic-provider-id" }, { status: 202 });
    });
  assert.equal(res.state, "accepted");
  assert.equal(calls, 1);
});
Deno.test("Driver CTA cannot be supplied by another output category or an untrusted URL", async () => {
  for (
    const body of [
      {
        ...raw.body,
        urlButton: {
          title: "Ver mi viaje",
          url: "https://another.example/" + token,
        },
      },
      {
        ...raw.body,
        urlButton: {
          title: "Ver mi viaje",
          url: origin + "/driver-trip?token=" + token,
        },
      },
      { ...raw.body, buttons: [{ id: "reply", title: "Reply" }] },
      { ...raw.body, locationRequest: "origin" },
      { ...raw.body, text: "X".repeat(1025) },
    ]
  ) assert.throws(() => parseOutgoing({ ...raw, body }));
  assert.throws(() => parseOutgoing({ ...raw, dedupe_key: "reply:" + id }));
  let calls = 0;
  const outgoing = parseOutgoing(raw);
  outgoing.message.buttons = [{ id: "finish", title: "Finalizar" }];
  assert.deepEqual(
    await sendTaxiMessage(outgoing, "fixture", async () => {
      calls++;
      return Response.json({ id: "must-not-send" });
    }),
    { state: "failed", code: "invalid_taxi_url_button" },
  );
  assert.equal(calls, 0);
});
Deno.test("Driver CTA provider timeout remains uncertain and is not blindly resent", async () => {
  let calls = 0;
  assert.deepEqual(
    await sendTaxiMessage(parseOutgoing(raw), "fixture-key", async () => {
      calls++;
      throw new Error("timeout after submit");
    }),
    { state: "uncertain", code: "provider_result_unknown" },
  );
  assert.equal(calls, 1);
});
Deno.test("Customer tracking CTA uses its own public link and cannot be mixed with a driver link or output category", async () => {
  const customerRaw = {
    ...raw,
    dedupe_key: "trip-assigned:" + id,
    body: {
      text: "Tu taxi va por ti. Unidad 0540",
      buttons: null,
      urlButton: {
        title: "Ver viaje en vivo",
        url: origin + "/track/" + "b".repeat(32),
      },
    },
  };
  const outgoing = parseOutgoing(customerRaw);
  let calls = 0;
  assert.equal(
    (await sendTaxiMessage(outgoing, "fixture", async (_url, init) => {
      calls++;
      const value: unknown = JSON.parse(String(init?.body));
      assert.ok(
        typeof value === "object" && value !== null && "interactive" in value,
      );
      return Response.json({ id: "synthetic-customer-cta" });
    })).state,
    "accepted",
  );
  assert.equal(calls, 1);
  for (
    const changed of [{ ...customerRaw, dedupe_key: "driver-assigned:" + id }, {
      ...customerRaw,
      body: {
        ...customerRaw.body,
        urlButton: { title: "Ver viaje en vivo", url },
      },
    }, { ...raw, body: { ...raw.body, urlButton: customerRaw.body.urlButton } }]
  ) assert.throws(() => parseOutgoing(changed));
});
Deno.test("Customer tracking presentation uses OpenStreetMap and does not confuse stale GPS with a missing pickup", () => {
  assert.equal(
    trackingPointUrl(16.25, -92.13),
    "https://www.openstreetmap.org/?mlat=16.25&mlon=-92.13#map=17/16.25/-92.13",
  );
  assert.equal(trackingPointUrl(null, -92.13), null);
  assert.equal(trackingPointUrl(91, 0), null);
  assert.equal(trackingPointUrl(NaN, 0), null);
  const now = Date.parse("2026-11-01T15:00:00Z");
  assert.equal(trackingFresh("2026-11-01T14:35:00Z", now), false);
  assert.equal(trackingFresh("2026-11-01T14:59:45Z", now), true);
  assert.equal(
    pickupText("Ubicación compartida (16.25, -92.13)\nReferencia: portón azul"),
    "El punto que compartiste por WhatsApp\nReferencia: portón azul",
  );
});
