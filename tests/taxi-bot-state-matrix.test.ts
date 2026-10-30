import {
  coordinateTaxi,
  type TaxiServices,
} from "../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/coordinator.ts";
import {
  emptyDraft,
  type TaxiChannel,
  type TaxiInbound,
  type TaxiSession,
} from "../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts";
import { parseInterpretation } from "../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/policy.ts";
import { taxiH3Scope } from "../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/h3.ts";
import {
  assertTaxiTransition,
  lifecycleAllows,
  LIFECYCLES,
} from "../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/stateMachine.ts";
function assert(v: unknown, m = "Invariant failed"): asserts v {
  if (!v) throw new Error(m);
}
function eq(a: unknown, b: unknown) {
  assert(
    JSON.stringify(a) === JSON.stringify(b),
    JSON.stringify({ actual: a, expected: b }),
  );
}
const now = Date.parse("2026-10-28T18:00:00Z"),
  token = "33333333-3333-4333-8333-333333333333",
  customer = "+529630000002";
const channel: TaxiChannel = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  waba: "+529630000001",
  enabled: true,
  name: "Base de pruebas",
  city: "Comitán",
  centerLat: 16.25,
  centerLng: -92.13,
  radiusKm: 20,
  dispatcher: "+529630000099",
  model: "fixture",
  baseCents: null,
  perKmCents: null,
  pricingMode: "h3_zone_max",
};
const origin = { text: "Centro", lat: 16.25, lng: -92.13, placeId: null },
  destination = { text: "Terminal", lat: 16.26, lng: -92.14, placeId: null };
const inputs = [
  "assent",
  "old_button",
  "question",
  "correction",
  "decline",
  "unsupported",
] as const;
const fares = ["same", "changed", "uncovered", "failure"] as const;
const reviews = ["current", "expired", "absent", "pending_pin"] as const;
// A complete state/input/failure product, not thousands of model calls or measured language accuracy.
for (let fields = 0; fields < 8; fields++) {
  for (const mode of ["bot", "human"] as const) {
    for (const active of ["none", "searching", "en_route"] as const) {
      for (const input of inputs) {
        for (const fare of fares) {
          for (const review of reviews) {
            Deno.test(`taxi matrix fields=${fields} control=${mode} trip=${active} input=${input} fare=${fare} review=${review}`, async () => {
              const full = fields === 7, pending = review === "pending_pin";
              const s: TaxiSession = {
                revision: 1,
                mode,
                history: [],
                active: active === "none" ? null : {
                  id: "44444444-4444-4444-8444-444444444444",
                  state: active === "searching"
                    ? "buscando_conductor"
                    : "en_camino",
                  taxiName: null,
                },
                draft: {
                  ...emptyDraft(),
                  fareMode: 'quoted',
                  name: fields & 1 ? "Persona Prueba" : null,
                  origin: fields & 2 ? origin : null,
                  destination: fields & 4 ? destination : null,
                  quoteCents: 6500,
                  quoteH3: taxiH3Scope(origin, destination),
                  confirmation: review === "absent" || pending ? null : token,
                  expiresAt: review === "absent" || pending
                    ? null
                    : new Date(now + (review === "expired" ? -1 : 600000))
                      .toISOString(),
                  awaitingLocation: pending ? "choice" : null,
                  pendingLocation: pending
                    ? {
                      place: origin,
                      expiresAt: new Date(now + 600000).toISOString(),
                    }
                    : null,
                },
              };
              const text = input === "assent"
                ? "Sí"
                : input === "question"
                ? "¿Sí, mándalo?"
                : input === "correction"
                ? "Sí, mejor recógeme en Nuevo Centro"
                : input === "decline"
                ? "Todavía no"
                : "";
              const m: TaxiInbound = {
                id: "matrix-message",
                from: customer,
                to: channel.waba,
                at: new Date(now).toISOString(),
                type: input === "old_button"
                  ? "button"
                  : input === "unsupported"
                  ? "unsupported"
                  : "text",
                text,
                button: input === "old_button"
                  ? "txc_55555555-5555-4555-8555-555555555555"
                  : null,
                location: null,
              };
              let model = 0, quoted = 0, candidates = 0;
              const services: TaxiServices = {
                interpret: async (current) => {
                  model++;
                  eq(current, text);
                  assert(
                    input === "question" || input === "correction",
                    "Unexpected model call",
                  );
                  return parseInterpretation(
                    input === "question"
                      ? { intent: "ambiguous", fields: {} }
                      : {
                        intent: "provide",
                        fields: {
                          origin: { value: "Nuevo Centro", evidence: text },
                        },
                      },
                    current,
                  );
                },
                resolve: async (address) => {
                  eq(input, "correction");
                  eq(address, "Nuevo Centro");
                  return {
                    kind: "resolved",
                    place: { ...origin, text: address, lat: 16.251 },
                  };
                },
                quote: async () => {
                  quoted++;
                  if (fare === "failure") {
                    throw new Error("Explicit quote failure");
                  }
                  return fare === "same"
                    ? 6500
                    : fare === "changed"
                    ? 7500
                    : null;
                },
                candidates: async () => {
                  candidates++;
                  return [{ deviceId: 1, name: "Unidad sintética" }];
                },
              };
              const d = await coordinateTaxi([m], s, channel, services, now);
              const authorized = full && mode === "bot" && active === "none" &&
                input === "assent" && review === "current" && fare === "same";
              eq(d.action === "confirm", authorized);
              eq(candidates, authorized ? 1 : 0);
              assert(model <= 1);
              assert(quoted <= 1);
              assertTaxiTransition(s, [m], d, now);
              if (
                d.action === "draft" && input === "correction" &&
                d.draft.origin?.text === "Nuevo Centro"
              ) {
                eq(d.draft.destination, s.draft.destination);
                assert(
                  d.draft.confirmation !== s.draft.confirmation ||
                    d.draft.confirmation === null,
                );
              }
              if (
                review !== "current" || !full || mode === "human" ||
                active !== "none" || input !== "assent"
              ) {
                eq(candidates, 0);
              }
            });
          }
        }
      }
    }
  }
}
// Explicitly forbidden proposals also exercise the guard independently of coordinator control flow.
for (
  const action of [
    "confirm",
    "cancel",
    "driver_accept",
    "driver_reject",
    "driver_finish",
  ] as const
) {
  for (
    const input of ["question", "correction", "decline", "unsupported"] as const
  ) {
    Deno.test(`taxi guard refuses forged ${action} from ${input}`, () => {
      const s: TaxiSession = {
        revision: 0,
        mode: "bot",
        history: [],
        active: null,
        draft: {
          ...emptyDraft(),
          name: "Persona Prueba",
          origin,
          destination,
          confirmation: token,
          expiresAt: new Date(now + 60000).toISOString(),
        },
      };
      const m: TaxiInbound = {
        id: "forged",
        from: customer,
        to: channel.waba,
        at: new Date(now).toISOString(),
        type: input === "unsupported" ? "unsupported" : "text",
        text: input === "question"
          ? "¿Puedes pedirlo?"
          : input === "correction"
          ? "Mejor otra dirección"
          : "Todavía no",
        button: null,
        location: null,
      };
      let rejected = false;
      try {
        assertTaxiTransition(s, [m], {
          action,
          draft: s.draft,
          confirmation: token,
          tripId: "44444444-4444-4444-8444-444444444444",
          offerId: token,
          candidates: [],
          messages: [],
          reason: "forged",
        }, now);
      } catch {
        rejected = true;
      }
      assert(rejected);
    });
  }
}
for (const kind of ["trip", "offer", "delivery"] as const) {
  for (
    const terminal of (kind === "trip"
      ? ["completado", "cancelado", "cancelado_timeout"]
      : kind === "offer"
      ? ["rejected", "revoked", "expired", "finished"]
      : ["read", "failed"])
  ) {
    for (const target of Object.keys(LIFECYCLES[kind])) {
      Deno.test(`terminal ${kind} ${terminal} cannot reopen as ${target}`, () => {
        eq(lifecycleAllows(kind, terminal, target), terminal === target);
        eq(lifecycleAllows(kind, "unknown", target), false);
      });
    }
  }
}
