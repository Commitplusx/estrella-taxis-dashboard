import { TaxiEngine } from "../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/engine.ts";
import type { TrackingStore } from "../estrella-taxis-backend/supabase/functions/_shared/tracking/store.ts";
import { TaxiTurnTrace } from "../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/trace.ts";
import { createTaxiInterpreter } from "../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/interpreter.ts";
import {
  emptyDraft,
  type TaxiChannel,
  type TaxiSession,
} from "../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts";
import type { TaxiServices } from "../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/coordinator.ts";
import {
  fingerprint,
  TrackingError,
} from "../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts";
function assert(v: unknown, m = "Assertion failed"): asserts v {
  if (!v) throw new Error(m);
}
function eq(a: unknown, b: unknown) {
  assert(JSON.stringify(a) === JSON.stringify(b));
}
const c: TaxiChannel = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  waba: "+529630000001",
  enabled: true,
  name: "Pruebas",
  city: "Comitán",
  centerLat: 16.25,
  centerLng: -92.13,
  radiusKm: 20,
  dispatcher: null,
  model: "fixture-model",
  baseCents: null,
  perKmCents: null,
  pricingMode: "h3_zone_max",
};
const session = (): TaxiSession => ({
  revision: 0,
  mode: "bot",
  draft: emptyDraft(),
  active: null,
  history: [],
});
const never = async (): Promise<never> => {
  throw new Error("Unplanned service call.");
};
const base: TaxiServices = {
  interpret: never,
  resolve: never,
  quote: never,
  candidates: never,
};
Deno.test("trace: captures version and prompt hash without putting private prompts in metadata", async () => {
  const trace = new TaxiTurnTrace(session(), Date.now()),
    meta = await trace.metadata(c);
  eq(meta.version, "taxi-trace-v1");
  assert(typeof meta.promptHash === "string" && meta.promptHash.length === 64);
  assert(!JSON.stringify(meta).includes(c.waba));
  const current = "Soy Persona Sintética",
    proposal = {
      intent: "provide",
      fields: { name: { value: "Persona Sintética", evidence: current } },
    };
  const interpret = createTaxiInterpreter(
    async () =>
      new Response(
        JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_trace', type: 'function', function: { name: 'actualizar_recorrido', arguments: JSON.stringify({ fields: proposal.fields }) } }] },
          }],
          usage: { prompt_tokens: 105, completion_tokens: 23 },
        }),
        { status: 200 },
      ),
    "fixture-key",
    "fixture-model",
  );
  const services = trace.services({
    ...base,
    interpret: (text, s, channel, signal, observe) =>
      createTaxiInterpreter(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{
                finish_reason: "tool_calls",
                message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_trace', type: 'function', function: { name: 'actualizar_recorrido', arguments: JSON.stringify({ fields: proposal.fields }) } }] },
              }],
              usage: { prompt_tokens: 105, completion_tokens: 23 },
            }),
            { status: 200 },
          ),
        "fixture-key",
        "fixture-model",
        observe,
      )(text, s, channel, signal),
  });
  eq(
    await services.interpret(current, session(), c),
    await interpret(current, session(), c),
  );
  const packet = trace.packet();
  eq(packet.steps.length, 1);
  eq(packet.steps[0].model?.inputTokens, 105);
  eq(packet.steps[0].model?.outputTokens, 23);
  eq(
    packet.steps[0].model?.responseHash,
    await fingerprint({ content: null, toolCalls: [{ id: 'call_trace', type: 'function', function: { name: 'actualizar_recorrido', arguments: JSON.stringify({ fields: proposal.fields }) } }] }),
  );
  assert(!JSON.stringify(packet.steps).includes("Persona Sintética"));
  eq(packet.interpretationPrivate?.fields.name?.value, "Persona Sintética");
});
Deno.test("trace: a rejected model output is an error with observed usage and hash, not a successful interpretation", async () => {
  const trace = new TaxiTurnTrace(session(), Date.now());
  const services = trace.services({
    ...base,
    interpret: (text, s, channel, signal, observe) =>
      createTaxiInterpreter(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{
                finish_reason: "tool_calls",
                message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_trace', type: 'function', function: { name: 'actualizar_recorrido', arguments: 'not valid json' } }] },
              }],
              usage: { prompt_tokens: "bad", completion_tokens: -1 },
            }),
            { status: 200 },
          ),
        "fixture-key",
        "fixture-model",
        observe,
      )(text, s, channel, signal),
  });
  let failed = false;
  try {
    await services.interpret("Un taxi", session(), c);
  } catch {
    failed = true;
  }
  assert(failed);
  const p = trace.packet();
  eq(p.steps[0].outcome, "error");
  eq(p.steps[0].code, "taxi_model_invalid_json");
  eq(p.steps[0].model?.inputTokens, null);
  eq(p.steps[0].model?.responseHash, await fingerprint({ content: null, toolCalls: [{ id: 'call_trace', type: 'function', function: { name: 'actualizar_recorrido', arguments: 'not valid json' } }] }));
  eq(p.interpretationPrivate, null);
});
Deno.test("trace: service failures preserve their category and do not log exception text or precise locations", async () => {
  const trace = new TaxiTurnTrace(session(), Date.now()),
    point = {
      text: "Domicilio sintético",
      lat: 16.25,
      lng: -92.13,
      placeId: null,
    };
  const services = trace.services({
    ...base,
    quote: async () => {
      throw new TrackingError(
        503,
        "storage_unavailable",
        "SECRET fixture payload",
      );
    },
  });
  let failed = false;
  try {
    await services.quote(point, point, c);
  } catch {
    failed = true;
  }
  assert(failed);
  const p = trace.packet();
  eq(p.steps[0].code, "storage_unavailable");
  assert(!JSON.stringify(p).includes("SECRET"));
  assert(!JSON.stringify(p.steps).includes("16.25"));
});
Deno.test("trace: a turn has a hard limit on recorded service calls with no automatic retry loop", async () => {
  let calls = 0;
  const trace = new TaxiTurnTrace(session(), Date.now()),
    services = trace.services({
      ...base,
      resolve: async () => {
        calls++;
        return { kind: "unavailable" };
      },
    });
  for (let i = 0; i < 12; i++) await services.resolve("Referencia " + i, c);
  let failed = false;
  try {
    await services.resolve("Exceso", c);
  } catch {
    failed = true;
  }
  assert(failed);
  eq(calls, 12);
  eq(trace.packet().steps.length, 12);
});

Deno.test("trace: missing durable start stops before model, tools and commit rather than claiming an unrecorded success", async () => {
  let writes = 0;
  const store: TrackingStore = {
    writePackages: never,
    writeCompanyPackage: never,
    writeCompanyStatus: never,
    read: async (table) => {
      if (table === "taxi_bot_channels") {
        return [{
          tenant_id: c.tenantId,
          waba: c.waba,
          name: c.name,
          city: c.city,
          enabled: true,
          dispatcher: "+529630000099",
          center_lat: c.centerLat,
          center_lng: c.centerLng,
          radius_km: c.radiusKm,
          model: c.model,
          base_cents: null,
          per_km_cents: null,
          pricing_mode: c.pricingMode,
        }];
      }
      if (table === "empresas") {
        return [{
          activo: true,
          tipo_negocio: "taxi",
          paquete: { activo: true, incluye_whatsapp: true },
        }];
      }
      throw new Error("Unexpected table");
    },
    writeScores: never,
    rpc: async (name) => {
      if (name === "taxi_bot_begin") {
        return {
          state: "proceed",
          eventId: "22222222-2222-4222-8222-222222222222",
          lease: "33333333-3333-4333-8333-333333333333",
          tenantId: c.tenantId,
          waba: c.waba,
          session: session(),
          messages: [{
            id: "m",
            from: "+529630000002",
            to: c.waba,
            at: new Date().toISOString(),
            type: "text",
            text: "Hola",
            button: null,
            location: null,
          }],
        };
      }
      if (name === "taxi_bot_trace_start") return false;
      writes++;
      throw new Error("No commit may occur without trace start");
    },
  };
  const engine = new TaxiEngine(store, base, {
    webhookSecret: "fixture-signature-secret",
    workerSecret: "fixture-worker-secret-at-least-32-characters",
    ycloudKey: "fixture-key",
    now: () => Date.now(),
  }, never);
  let failed = false;
  try {
    await engine.process("22222222-2222-4222-8222-222222222222");
  } catch (e: unknown) {
    failed = e instanceof TrackingError && e.code === "taxi_trace_unavailable";
  }
  assert(failed);
  eq(writes, 0);
});
