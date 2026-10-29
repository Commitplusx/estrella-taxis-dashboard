import { taxiQualityRequest } from "../estrella-taxis-backend/supabase/functions/taxi-bot-admin/quality.ts";
import type { TrackingStore } from "../estrella-taxis-backend/supabase/functions/_shared/tracking/store.ts";
import { record } from "../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts";
import {
  parseQualityDetail,
  parseQualityOverview,
  parseQualityPage,
  parseQualitySaved,
} from "../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/qualityContracts.ts";
import { emptyDraft } from "../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts";
function assert(v: unknown, m = "Assertion failed"): asserts v {
  if (!v) throw new Error(m);
}
function eq(a: unknown, b: unknown) {
  assert(JSON.stringify(a) === JSON.stringify(b));
}
const tenant = "11111111-1111-4111-8111-111111111111",
  waba = "+529630000001",
  traceId = "22222222-2222-4222-8222-222222222222",
  requestId = "33333333-3333-4333-8333-333333333333";
const expected = {
  intent: "provide",
  fields: { name: { value: "Persona Prueba", evidence: "Soy Persona Prueba" } },
};
function fixture() {
  let reads = 0, writes = 0;
  const store: TrackingStore = {
    read: async () => {
      throw new Error("No direct table reads.");
    },
    writeScores: async () => {
      throw new Error("No score writes.");
    },
    rpc: async (name, args) => {
      eq(args.p_tenant, tenant);
      eq(args.p_waba, waba);
      if (name === "taxi_bot_quality_read") {
        reads++;
        eq(args.p_view, "trace");
        return {
          state: "committed",
          messages: [{ text: "Soy Persona Prueba" }],
          packet: { interpretationPrivate: expected },
        };
      }
      eq(name, "taxi_bot_quality_review");
      eq(args.p_actor, 42);
      eq(args.p_expected, expected);
      writes++;
      return { state: "saved", revision: 1, cohort: "holdout" };
    },
  };
  return { store, counts: () => ({ reads, writes }) };
}
Deno.test("quality labels: verified reviewer and literal expected interpretation reach one scoped write", async () => {
  const f = fixture();
  const response = await taxiQualityRequest(
    {
      action: "quality_review",
      tenantId: tenant,
      waba,
      traceId,
      requestId,
      revision: 0,
      label: "correct",
    },
    tenant,
    waba,
    42,
    true,
    f.store,
  );
  assert(response);
  eq(response.status, 200);
  const result: unknown = await response.json();
  assert(record(result));
  eq(result.cohort, "holdout");
  eq(f.counts(), { reads: 1, writes: 1 });
});

Deno.test("quality listing: authorized cursor preserves microseconds and one bounded date window", async () => {
  let calls = 0;
  const store: TrackingStore = {
    read: async () => {
      throw new Error("No direct reads");
    },
    writeScores: async () => {
      throw new Error("No score writes");
    },
    rpc: async (name, args) => {
      calls++;
      eq(name, "taxi_bot_quality_read");
      eq(args.p_tenant, tenant);
      eq(args.p_waba, waba);
      eq(args.p_view, "attempts");
      eq(args.p_input, {
        from: "2026-10-01T00:00:00.000Z",
        to: "2026-10-02T00:00:00.000Z",
        after: { startedAt: "2026-10-01T12:00:00.123456+00:00", id: traceId },
      });
      return { items: [], hasMore: false };
    },
  };
  const raw = {
    action: "quality_attempts",
    tenantId: tenant,
    waba,
    from: "2026-10-01",
    to: "2026-10-02",
    after: { startedAt: "2026-10-01T12:00:00.123456+00:00", id: traceId },
  };
  assert(await taxiQualityRequest(raw, tenant, waba, 42, true, store));
  for (
    const after of [false, {}, { startedAt: "bad", id: traceId }, {
      startedAt: "2026-10-01",
      id: "bad",
    }, { ...raw.after, private: true }]
  ) {
    let rejected = false;
    try {
      await taxiQualityRequest(
        { ...raw, after },
        tenant,
        waba,
        42,
        true,
        store,
      );
    } catch {
      rejected = true;
    }
    assert(rejected);
  }
  eq(calls, 1);
});

Deno.test("quality client contracts: invalid counts, false precision claims and oversized pages fail closed", () => {
  const summary = {
    from: "2026-10-01",
    to: "2026-10-02",
    attempts: 1,
    committed: 1,
    superseded: 0,
    errors: 0,
    abandoned: 0,
    open: 0,
    interpretationAttempts: 1,
    interpretationFailures: 0,
    handoffSignals: 0,
    confirmedInterpretationErrors: 0,
    reviewedCases: 0,
    deliveryTransitions: { accepted: 1 },
    blindAccuracyMeasured: false,
    reviewSignalsAreConfirmedErrors: false,
  };
  eq(parseQualityOverview(summary).attempts, 1);
  const row = {
    id: traceId,
    startedAt: "2026-10-01T00:00:00.123456Z",
    state: "error",
    phaseBefore: "origin",
    phaseAfter: null,
    action: null,
    reason: "external_failure",
    label: null,
  };
  eq(
    parseQualityPage({ items: [row], hasMore: false }).items[0].startedAt,
    row.startedAt,
  );
  const invalid: (() => unknown)[] = [
    () => parseQualityOverview({ ...summary, errors: -1 }),
    () => parseQualityOverview({ ...summary, blindAccuracyMeasured: true }),
    () =>
      parseQualityOverview({
        ...summary,
        deliveryTransitions: { invented: 1 },
      }),
    () =>
      parseQualityPage({
        items: Array.from({ length: 21 }, () => row),
        hasMore: true,
      }),
    () =>
      parseQualityPage({
        items: [{ ...row, state: "success" }],
        hasMore: false,
      }),
    () => parseQualitySaved({ state: "saved", revision: -1, cohort: "train" }),
    () => parseQualitySaved({ state: "queued", revision: 1, cohort: "train" }),
  ];
  for (const run of invalid) {
    let rejected = false;
    try {
      run();
    } catch {
      rejected = true;
    }
    assert(rejected);
  }
});

Deno.test("quality detail contracts: only literal interpreted fields and bounded original context reach the screen", () => {
  const raw = {
    id: traceId,
    state: "committed",
    phaseBefore: "origin",
    phaseAfter: "destination",
    action: "draft",
    reason: "fixture",
    meta: {
      model: "fixture-model",
      engineVersion: "taxi-bot-v2",
      promptHash: "a".repeat(64),
    },
    context: { draft: emptyDraft(), history: [] },
    messages: [{
      id: "fixture",
      from: "+529630000002",
      to: waba,
      at: new Date().toISOString(),
      type: "text",
      text: "Soy Persona Prueba",
      button: null,
      location: null,
    }],
    sourceHashes: ["a".repeat(64)],
    cohort: "holdout",
    blindEligible: false,
    review: { revision: 1, label: "correct", expected },
    packet: { steps: [], interpretationPrivate: expected },
  };
  eq(parseQualityDetail(raw).review?.expected, expected);
  for (
    const malformed of [
      { ...raw, sourceHashes: [] },
      { ...raw, blindEligible: true },
      { ...raw, cohort: "public" },
      {
        ...raw,
        context: {
          ...raw.context,
          history: Array.from(
            { length: 13 },
            () => ({ role: "user", content: "hello" }),
          ),
        },
      },
      {
        ...raw,
        packet: {
          ...raw.packet,
          interpretationPrivate: {
            ...expected,
            fields: {
              name: { value: "Otra persona", evidence: "Soy Persona Prueba" },
            },
          },
        },
      },
    ]
  ) {
    let rejected = false;
    try {
      parseQualityDetail(malformed);
    } catch {
      rejected = true;
    }
    assert(rejected);
  }
});
Deno.test("quality labels: invented or model-proposed prices cannot become reviewed training truth", async () => {
  for (
    const proposal of [
      {
        intent: "provide",
        fields: {
          name: { value: "Otra persona", evidence: "Soy Persona Prueba" },
        },
      },
      { ...expected, total: 1 },
      {
        intent: "confirm",
        fields: {
          origin: { value: "Terminal", evidence: "Soy Persona Prueba" },
        },
      },
    ]
  ) {
    const f = fixture();
    let rejected = false;
    try {
      await taxiQualityRequest(
        {
          action: "quality_review",
          tenantId: tenant,
          waba,
          traceId,
          requestId,
          revision: 0,
          label: "interpretation_error",
          expected: proposal,
        },
        tenant,
        waba,
        42,
        true,
        f.store,
      );
    } catch {
      rejected = true;
    }
    assert(rejected);
    eq(f.counts().writes, 0);
  }
});
