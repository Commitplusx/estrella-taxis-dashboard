import { trackingCall } from "./trackingClient";
import {
  parseQualityDetail,
  parseQualityOverview,
  parseQualityPage,
  parseQualitySaved,
  type QualityCursor,
  type QualityDetail,
  type QualityOverview,
  type QualityPage,
  type QualityReviewCommand,
  type QualityWindow,
} from "../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/qualityContracts.ts";
export interface TaxiQualityClient {
  overview: (
    tenantId: string,
    waba: string,
    window: QualityWindow,
    signal?: AbortSignal,
  ) => Promise<QualityOverview>;
  attempts: (
    tenantId: string,
    waba: string,
    window: QualityWindow,
    after?: QualityCursor,
    signal?: AbortSignal,
  ) => Promise<QualityPage>;
  detail: (
    tenantId: string,
    waba: string,
    traceId: string,
    signal?: AbortSignal,
  ) => Promise<QualityDetail>;
  review: (
    command: QualityReviewCommand,
  ) => Promise<{ revision: number; cohort: QualityDetail["cohort"] }>;
}
export const taxiQualityClient: TaxiQualityClient = {
  overview: async (tenantId, waba, window, signal) =>
    parseQualityOverview(
      await trackingCall("taxi-bot-admin", {
        action: "quality",
        tenantId,
        waba,
        ...window,
      }, signal),
    ),
  attempts: async (tenantId, waba, window, after, signal) =>
    parseQualityPage(
      await trackingCall("taxi-bot-admin", {
        action: "quality_attempts",
        tenantId,
        waba,
        ...window,
        ...(after ? { after } : {}),
      }, signal),
    ),
  detail: async (tenantId, waba, traceId, signal) =>
    parseQualityDetail(
      await trackingCall("taxi-bot-admin", {
        action: "quality_trace",
        tenantId,
        waba,
        traceId,
      }, signal),
    ),
  review: async (command) =>
    parseQualitySaved(await trackingCall("taxi-bot-admin", { ...command })),
};
/** Only the design route creates this client; every example is synthetic and writes stay in memory. */
export function createTaxiQualityPreview(): TaxiQualityClient {
  const id = "22222222-2222-4222-8222-222222222222",
    at = new Date().toISOString();
  let review: QualityDetail["review"] = null;
  const proposal = {
    intent: "provide",
    fields: {
      origin: { value: "Centro", evidence: "Recógeme en Centro" },
      destination: { value: "Mercado", evidence: "voy al Mercado" },
    },
  } as const;
  return {
    overview: async (_tenant, _waba, window) => ({
      ...window,
      attempts: 1,
      committed: 1,
      superseded: 0,
      errors: 0,
      abandoned: 0,
      open: 0,
      interpretationAttempts: 1,
      interpretationFailures: 0,
      handoffSignals: 0,
      confirmedInterpretationErrors: review?.label === "interpretation_error"
        ? 1
        : 0,
      reviewedCases: review ? 1 : 0,
      deliveryTransitions: { pending: 1 },
    }),
    attempts: async () => ({
      items: [{
        id,
        startedAt: at,
        state: "committed",
        phaseBefore: "origin",
        phaseAfter: "name",
        action: "draft",
        reason: "missing_name",
        label: review?.label ?? null,
      }],
      hasMore: false,
    }),
    detail: async () => ({
      id,
      state: "committed",
      phaseBefore: "origin",
      phaseAfter: "name",
      action: "draft",
      reason: "missing_name",
      model: "Modelo de ejemplo",
      engineVersion: "taxi-bot-v2",
      promptHash: "0".repeat(64),
      proposal,
      steps: [{
        phase: "interpret",
        outcome: "ok",
        durationMs: 340,
        code: "ok",
        amountCents: null,
        candidateCount: null,
      }],
      messages: [{
        id: "synthetic-message",
        type: "text",
        text: "Recógeme en Centro, voy al Mercado",
        at,
        from: "+529630000002",
        to: "+529630000001",
        button: null,
        location: null,
      }],
      sourceHashes: ["1".repeat(64)],
      history: [],
      before: { name: null, origin: null, destination: null, quoteCents: null },
      cohort: "train",
      review,
    }),
    review: async (command) => {
      review = {
        revision: command.revision + 1,
        label: command.label,
        expected: command.expected,
      };
      return { revision: review.revision, cohort: "train" };
    },
  };
}
