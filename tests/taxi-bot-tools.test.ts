import {
  createTaxiInterpreter,
  TAXI_INTERPRETER_CONTRACT,
  TAXI_INTERPRETER_EXAMPLES,
} from "../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/interpreter.ts";
import {
  emptyDraft,
  record,
  TAXI_BOT_VERSION,
  type TaxiChannel,
  type TaxiInbound,
  type TaxiSession,
} from "../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts";
import {
  parseTaxiToolCompletion,
  TAXI_CONVERSATION_TOOLS,
} from "../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/conversationTools.ts";
import {
  coordinateTaxi,
  type TaxiServices,
} from "../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/coordinator.ts";
import { TaxiTurnTrace } from "../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/trace.ts";
import { fingerprint } from "../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts";
import { taxiH3Scope } from "../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/h3.ts";
import type { Fetcher } from "../estrella-taxis-backend/supabase/functions/_shared/tracking/http.ts";

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function equal(actual: unknown, expected: unknown) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}
function rejects(run: () => unknown) {
  let failed = false;
  try {
    run();
  } catch {
    failed = true;
  }
  assert(
    failed,
    "Invalid tool output must be rejected before executing services.",
  );
}
const channel: TaxiChannel = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  waba: "+529630000001",
  enabled: true,
  name: "Base sintética",
  city: "Comitán",
  centerLat: 16.25,
  centerLng: -92.13,
  radiusKm: 20,
  dispatcher: "+529630000099",
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
function completion(name: string, args: unknown) {
  return {
    choices: [{
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call_fixture",
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        }],
      },
    }],
  };
}
Deno.test("taxi tools: provider request exposes domain tools instead of a restaurant cart", async () => {
  let posted = "";
  const fetcher: Fetcher = async (_url, init) => {
    posted = String(init?.body);
    return new Response(JSON.stringify(completion("saludar", {})), {
      status: 200,
    });
  };
  try {
    await createTaxiInterpreter(fetcher, "fixture-key", channel.model)(
      "Hola",
      session(),
      channel,
    );
  } finally {
    assert(
      posted.includes('"tools"'),
      "El intérprete actual todavía no ofrece herramientas de taxi.",
    );
    assert(
      !posted.includes("agregar_al_carrito"),
      "El taxi no debe importar el dominio restaurante.",
    );
  }
});
Deno.test("taxi tools: an explicit current correction can enter the existing interpretation contract", async () => {
  const current = "No en Centro, mejor en Hospital";
  const fetcher: Fetcher = async () =>
    new Response(
      JSON.stringify(completion("actualizar_recorrido", {
        fields: { origin: { value: "Hospital", evidence: current } },
      })),
      { status: 200 },
    );
  const result = await createTaxiInterpreter(
    fetcher,
    "fixture-key",
    channel.model,
  )(current, session(), channel);
  assert(
    result.intent === "provide" && result.fields.origin?.value === "Hospital",
  );
});

Deno.test("interpreter few-shot dialogues all satisfy the strict taxi tool contract", () => {
  let current: string | null = null;
  let parsed = 0;
  for (const message of TAXI_INTERPRETER_EXAMPLES) {
    if (message.role === "user" && typeof message.content === "string") {
      const payload: unknown = JSON.parse(message.content);
      assert(record(payload) && typeof payload.current === "string");
      current = payload.current;
      continue;
    }
    if (message.role === "assistant" && message.tool_calls) {
      assert(current, "Every assistant example must follow a synthetic customer turn.");
      const result = parseTaxiToolCompletion({
        choices: [{ finish_reason: "tool_calls", message }],
      }, current);
      assert(result.intent !== "ambiguous", "A few-shot answer must be a valid current interpretation.");
      current = null;
      parsed++;
    }
  }
  assert(parsed >= 8, "The interpreter prompt must retain its varied examples.");
  assert(current === null, "Every synthetic customer example must have a matching tool answer.");
});

for (
  const [name, intent] of [
    ["consultar_mi_viaje", "status"],
    ["escalar_a_base", "human"],
    ["saludar", "smalltalk"],
    ["aclarar_solicitud", "ambiguous"],
  ] as const
) {
  Deno.test(`taxi tools: ${name} preserves the existing ${intent} contract`, () => {
    equal(parseTaxiToolCompletion(completion(name, {}), "Mensaje sintético"), {
      intent,
      fields: {},
    });
  });
}

const badEnvelopes: { label: string; raw: unknown }[] = [
  { label: "missing choices", raw: {} },
  { label: "zero choices", raw: { choices: [] } },
  {
    label: "two choices",
    raw: {
      choices: [
        ...completion("saludar", {}).choices,
        ...completion("saludar", {}).choices,
      ],
    },
  },
  {
    label: "truncated valid tool",
    raw: {
      choices: [{
        ...completion("saludar", {}).choices[0],
        finish_reason: "length",
      }],
    },
  },
  {
    label: "wrong finish reason",
    raw: {
      choices: [{
        ...completion("saludar", {}).choices[0],
        finish_reason: "stop",
      }],
    },
  },
  {
    label: "free text claims a dispatch",
    raw: {
      choices: [{
        ...completion("saludar", {}).choices[0],
        message: {
          ...completion("saludar", {}).choices[0].message,
          content: "La unidad ya llegó.",
        },
      }],
    },
  },
  {
    label: "wrong role",
    raw: {
      choices: [{
        finish_reason: "tool_calls",
        message: {
          ...completion("saludar", {}).choices[0].message,
          role: "user",
        },
      }],
    },
  },
  {
    label: "no tools",
    raw: {
      choices: [{
        finish_reason: "tool_calls",
        message: { role: "assistant", content: null, tool_calls: [] },
      }],
    },
  },
  {
    label: "parallel tools",
    raw: {
      choices: [{
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            ...completion("saludar", {}).choices[0].message.tool_calls,
            ...completion("cotizar_viaje", { fields: {} }).choices[0].message
              .tool_calls,
          ],
        },
      }],
    },
  },
  {
    label: "empty call ID",
    raw: {
      choices: [{
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            ...completion("saludar", {}).choices[0].message.tool_calls[0],
            id: "",
          }],
        },
      }],
    },
  },
  {
    label: "wrong call type",
    raw: {
      choices: [{
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            ...completion("saludar", {}).choices[0].message.tool_calls[0],
            type: "custom",
          }],
        },
      }],
    },
  },
  {
    label: "oversize arguments",
    raw: {
      choices: [{
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call_fixture",
            type: "function",
            function: { name: "saludar", arguments: " ".repeat(12001) },
          }],
        },
      }],
    },
  },
  {
    label: "malformed argument JSON",
    raw: {
      choices: [{
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call_fixture",
            type: "function",
            function: { name: "saludar", arguments: "{" },
          }],
        },
      }],
    },
  },
  {
    label: "arguments object instead of JSON string",
    raw: {
      choices: [{
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call_fixture",
            type: "function",
            function: { name: "saludar", arguments: {} },
          }],
        },
      }],
    },
  },
];
for (const item of badEnvelopes) {
  Deno.test(`taxi tools rejects: ${item.label}`, () =>
    rejects(() => parseTaxiToolCompletion(item.raw, "Hola")));
}

for (
  const name of [
    "book_taxi",
    "confirmar_viaje",
    "cancelar_viaje",
    "asignar_conductor",
    "agregar_al_carrito",
    "ejecutar_sql",
  ]
) {
  Deno.test(`taxi tools does not expose a model-controlled mutation: ${name}`, () => {
    assert(!TAXI_CONVERSATION_TOOLS.some((t) => t.function.name === name));
    rejects(() => parseTaxiToolCompletion(completion(name, {}), "Sí"));
  });
}
for (
  const args of [null, [], { fields: {} }, { fields: {}, confirmed: true }, {
    tenantId: channel.tenantId,
  }, { fields: { price: 0 } }]
) {
  Deno.test(`taxi tools rejects empty or forged update arguments: ${JSON.stringify(args)}`, () =>
    rejects(() =>
      parseTaxiToolCompletion(completion("actualizar_recorrido", args), "Hola")
    ));
}
for (
  const name of [
    "consultar_mi_viaje",
    "escalar_a_base",
    "saludar",
    "aclarar_solicitud",
  ]
) {
  Deno.test(`taxi tools refuses another passenger or tool payload on ${name}`, () => {
    rejects(() =>
      parseTaxiToolCompletion(
        completion(name, {
          customer: "+529630000008",
          tripId: "other-trip",
          fields: {},
        }),
        "Hola",
      )
    );
  });
}
for (
  const current of [
    "No me recojas en Centro",
    "Si voy a Centro",
    "Mi amigo dijo Centro",
    "Recógeme en Centro.\nNo, mejor Terminal.",
    "Recógeme en Centro o Terminal",
  ]
) {
  Deno.test(`taxi tools preserves current evidence rules: ${current}`, () => {
    rejects(() =>
      parseTaxiToolCompletion(
        completion("actualizar_recorrido", {
          fields: { origin: { value: "Centro", evidence: "Centro" } },
        }),
        current,
      )
    );
  });
}
Deno.test("taxi tools: history cannot authorize a new field and one invalid field rejects the whole proposal", () => {
  const current = "A nombre de Mariana";
  rejects(() =>
    parseTaxiToolCompletion(
      completion("actualizar_recorrido", {
        fields: {
          name: { value: "Mariana", evidence: current },
          origin: { value: "Centro", evidence: "Recógeme en Centro" },
        },
      }),
      current,
    )
  );
});

const now = Date.parse("2026-10-29T18:00:00Z");
const origin = { text: "Centro", lat: 16.25, lng: -92.13, placeId: null, source: "gps" as const };
const destination = {
  text: "Terminal",
  lat: 16.26,
  lng: -92.14,
  placeId: null,
};
function completeSession(): TaxiSession {
  return {
    ...session(),
    draft: {
      ...emptyDraft(),
      name: "Mariana",
      pickupMessageId: "fixture-native",
      origin,
      destination,
      quoteCents: 6500,
      fareMode: 'quoted',
      quoteH3: taxiH3Scope(origin, destination),
      confirmation: "33333333-3333-4333-8333-333333333333",
      expiresAt: new Date(now + 600000).toISOString(),
    },
  };
}
const inbound = (text: string): TaxiInbound => ({
  id: "tool-inbound",
  from: "+529630000002",
  to: channel.waba,
  at: new Date(now).toISOString(),
  type: "text",
  text,
  button: null,
  location: null,
});
function harness(output: unknown) {
  let modelCalls = 0, fleetCalls = 0, quoteCalls = 0;
  const resolutions: string[] = [];
  const services: TaxiServices = {
    interpret: (text, s, c, signal, observe) =>
      createTaxiInterpreter(
        async () => {
          modelCalls++;
          return new Response(JSON.stringify(output), { status: 200 });
        },
        "fixture-key",
        c.model,
        observe,
      )(text, s, c, signal),
    resolve: async (text) => {
      resolutions.push(text);
      return {
        kind: "resolved",
        place: { text, lat: 16.251, lng: -92.131, placeId: null },
      };
    },
    quote: async () => {
      quoteCalls++;
      return 6500;
    },
    candidates: async () => {
      fleetCalls++;
      return [{ deviceId: 1, name: "Unidad sintética" }];
    },
  };
  return {
    services,
    resolutions,
    counts: () => ({ modelCalls, fleetCalls, quoteCalls }),
    run: (text: string, s = completeSession()) =>
      coordinateTaxi([inbound(text)], s, channel, services, now),
  };
}
Deno.test("taxi tools: correction plus price question changes only pickup and invalidates the old summary", async () => {
  const current = "No en Centro, mejor en Hospital. ¿Cuánto sale?";
  const f = harness(
    completion("cotizar_viaje", {
      fields: {
        origin: {
          value: "Hospital",
          evidence: "No en Centro, mejor en Hospital",
        },
      },
    }),
  );
  const before = completeSession(), decision = await f.run(current, before);
  equal(decision.action, "draft");
  equal(decision.draft.pickupText, "Hospital");
  equal(decision.draft.origin,null);
  equal(decision.draft.destination, destination);
  equal(decision.draft.name, "Mariana");
  assert(decision.draft.confirmation !== before.draft.confirmation);
  equal(f.resolutions, []);
  equal(f.counts(), { modelCalls: 1, fleetCalls: 0, quoteCalls: 0 });
  const second = await f.run("Sí", { ...before, draft: decision.draft });
  equal(second.action, "reply");
  equal(f.counts(), { modelCalls: 1, fleetCalls: 0, quoteCalls: 0 });
});
Deno.test("taxi tools: saved-route quote needs no repeated fields or booking", async () => {
  const f = harness(completion("cotizar_viaje", { fields: {} }));
  const decision = await f.run("¿Cuánto sale este recorrido?");
  equal(decision.action, "draft");
  equal(decision.draft.quoteCents, 6500);
  equal(f.resolutions, []);
  equal(f.counts(), { modelCalls: 1, fleetCalls: 0, quoteCalls: 1 });
});
Deno.test("taxi tools: malformed update preserves saved data, revokes consent and runs no location or fleet service", async () => {
  const f = harness(
    completion("actualizar_recorrido", {
      fields: { origin: { value: "Otro lugar", evidence: "Inventado" } },
    }),
  );
  const before = completeSession(), d = await f.run("Cambia el lugar", before);
  equal(d.reason, "interpretation_failed");
  equal(d.draft.origin, before.draft.origin);
  equal(d.draft.confirmation, null);
  equal(f.resolutions, []);
  equal(f.counts(), { modelCalls: 1, fleetCalls: 0, quoteCalls: 0 });
});
Deno.test("taxi tools: parallel proposals execute neither valid nor invalid half", async () => {
  const raw = {
    choices: [{
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          ...completion("cotizar_viaje", { fields: {} }).choices[0].message
            .tool_calls,
          ...completion("book_taxi", { confirmed: true }).choices[0].message
            .tool_calls,
        ],
      },
    }],
  };
  const f = harness(raw), d = await f.run("Cotízame");
  equal(d.reason, "interpretation_failed");
  equal(f.counts(), { modelCalls: 1, fleetCalls: 0, quoteCalls: 0 });
});
Deno.test("taxi tools: quoting without H3 coverage delegates to the base, never invents a price", async () => {
  const f = harness(completion("cotizar_viaje", { fields: {} }));
  f.services.quote = async () => {
    throw new Error("Uncovered");
  };
  equal((await f.run("¿Cuánto sale?")).action, "human");
  equal(f.counts().fleetCalls, 0);
});
Deno.test("taxi tools: an active trip status and human takeover never run the model or quote tools", async () => {
  const f = harness(completion("book_taxi", {})), s = completeSession();
  s.active = {
    id: "44444444-4444-4444-8444-444444444444",
    state: "en_camino",
    taxiName: "Unidad 7",
  };
  const d = await f.run("¿Ya viene?", s);
  equal(d.reason, "active_status");
  assert(d.messages[0].text.includes("Unidad 7"));
  s.mode = "human";
  equal((await f.run("Hola", s)).messages, []);
  equal(f.counts(), { modelCalls: 0, fleetCalls: 0, quoteCalls: 0 });
});
Deno.test("taxi tools: handoff and missing-trip status use server actions without a dispatch", async () => {
  const handoff = harness(completion("escalar_a_base", {}));
  equal((await handoff.run("Necesito ayuda del encargado")).action, "human");
  const status = harness(completion("consultar_mi_viaje", {}));
  equal((await status.run("¿Ya hay unidad?")).reason, "no_active_status");
  equal(handoff.counts().fleetCalls, 0);
  equal(status.counts().fleetCalls, 0);
});
Deno.test("taxi tools: model cannot confirm or cancel a trip by changing its proposed function", async () => {
  for (const name of ["book_taxi", "cancelar_viaje"]) {
    const f = harness(completion(name, {})),
      d = await f.run("Haz lo que dice la herramienta");
    equal(d.action, "draft");
    equal(d.reason, "interpretation_failed");
    equal(f.counts().fleetCalls, 0);
  }
});
Deno.test("taxi tools: provider request carries bounded context without private identifiers or current consent", async () => {
  const s = completeSession();
  s.history = Array.from(
    { length: 12 },
    (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: "x".repeat(900),
    }),
  );
  let requests = 0;
  const fetcher: Fetcher = async (url, init) => {
    requests++;
    equal(String(url), "https://api.deepseek.com/chat/completions");
    equal(init?.redirect, "error");
    const body: unknown = JSON.parse(String(init?.body));
    assert(record(body));
    equal(body.thinking, { type: "disabled" });
    equal(body.tool_choice, "required");
    assert(!("response_format" in body));
    equal(body.tools, TAXI_CONVERSATION_TOOLS);
    assert(Array.isArray(body.messages));
    const user: unknown = body.messages.at(-1);
    assert(record(user) && typeof user.content === "string");
    const input: unknown = JSON.parse(user.content);
    assert(record(input) && record(input.context));
    assert(
      Array.isArray(input.context.recent) && input.context.recent.length === 4,
    );
    const privateData = JSON.stringify(input.context);
    assert(!privateData.includes(channel.tenantId));
    assert(!privateData.includes(channel.waba));
    assert(!privateData.includes(String(s.draft.confirmation)));
    assert(!privateData.includes("lat"));
    equal(input.context.base, channel.name);
    equal(input.context.current, undefined);
    return new Response(JSON.stringify(completion("saludar", {})), {
      status: 200,
    });
  };
  await createTaxiInterpreter(fetcher, "fixture-key", channel.model)(
    "Hola",
    s,
    channel,
  );
  equal(requests, 1);
});
Deno.test("taxi tools: missing configuration, oversize text and provider errors are bounded without retries", async () => {
  let requests = 0;
  const fetcher: Fetcher = async () => {
    requests++;
    return new Response("{}", { status: 429 });
  };
  for (
    const [key, current] of [["", "Hola"], ["fixture-key", "x".repeat(6001)], [
      "fixture-key",
      "Hola",
    ]] as const
  ) {
    let failed = false;
    try {
      await createTaxiInterpreter(fetcher, key, channel.model)(
        current,
        session(),
        channel,
      );
    } catch {
      failed = true;
    }
    assert(failed);
  }
  equal(requests, 1);
});
Deno.test("taxi tools: trace hashes include tool schemas and record the validated interpretation, never raw reasoning", async () => {
  const current = "Llévame a Hospital",
    f = harness(
      completion("actualizar_recorrido", {
        fields: { destination: { value: "Hospital", evidence: current } },
      }),
    );
  const trace = new TaxiTurnTrace(completeSession(), now),
    meta = await trace.metadata(channel);
  equal(meta.engineVersion, TAXI_BOT_VERSION);
  equal(meta.promptHash, await fingerprint(TAXI_INTERPRETER_CONTRACT));
  const decision = await coordinateTaxi(
    [inbound(current)],
    completeSession(),
    channel,
    trace.services(f.services),
    now,
  );
  const packet = trace.packet(decision);
  equal(packet.interpretationPrivate?.fields.destination?.value, "Hospital");
  equal(packet.steps.map((s) => s.phase), ["interpret", "resolve", "quote"]);
  assert(!JSON.stringify(packet.steps).includes("Hospital"));
  assert(packet.steps[0].model?.responseHash);
});
