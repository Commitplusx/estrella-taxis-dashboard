import { record, uuid } from "../../tracking/contracts.ts";
import {
  type Interpretation,
  parseStoredInbound,
  type TaxiInbound,
} from "./contracts.ts";
import { parseInterpretation } from "./policy.ts";

export const QUALITY_LABELS = [
  "correct",
  "interpretation_error",
  "policy_error",
  "external_failure",
  "incomplete",
] as const;
export type QualityLabel = typeof QUALITY_LABELS[number];
export type TraceState =
  | "running"
  | "committed"
  | "superseded"
  | "error"
  | "abandoned";
export interface QualityWindow {
  from: string;
  to: string;
}
export interface QualityCursor {
  startedAt: string;
  id: string;
}
export interface QualityOverview extends QualityWindow {
  attempts: number;
  committed: number;
  superseded: number;
  errors: number;
  abandoned: number;
  open: number;
  interpretationAttempts: number;
  interpretationFailures: number;
  handoffSignals: number;
  confirmedInterpretationErrors: number;
  reviewedCases: number;
  deliveryTransitions: Record<string, number>;
}
export interface QualityAttempt extends QualityCursor {
  state: TraceState;
  phaseBefore: string;
  phaseAfter: string | null;
  action: string | null;
  reason: string | null;
  label: QualityLabel | null;
}
export interface QualityPage {
  items: QualityAttempt[];
  hasMore: boolean;
}
export interface QualityStep {
  phase: string;
  outcome: "ok" | "error";
  durationMs: number;
  code: string;
  amountCents: number | null;
  candidateCount: number | null;
}
export interface QualityDetail {
  id: string;
  state: TraceState;
  phaseBefore: string;
  phaseAfter: string | null;
  action: string | null;
  reason: string | null;
  model: string;
  engineVersion: string;
  promptHash: string;
  proposal: Interpretation | null;
  steps: QualityStep[];
  messages: TaxiInbound[];
  sourceHashes: string[];
  history: { role: "user" | "assistant"; content: string }[];
  before: {
    name: string | null;
    origin: string | null;
    destination: string | null;
    quoteCents: number | null;
  };
  cohort: "train" | "validation" | "holdout";
  review: {
    revision: number;
    label: QualityLabel;
    expected: Interpretation | null;
  } | null;
}
export interface QualityReviewCommand {
  action: "quality_review";
  tenantId: string;
  waba: string;
  traceId: string;
  requestId: string;
  revision: number;
  label: QualityLabel;
  expected: Interpretation | null;
}
function invalid(): never {
  throw new Error(
    "La respuesta de calidad no tiene un formato válido. Actualiza la consulta.",
  );
}
function object(v: unknown): Record<string, unknown> {
  return record(v) ? v : invalid();
}
function string(v: unknown, max = 120): string {
  return typeof v === "string" && v.length > 0 && v.length <= max
    ? v
    : invalid();
}
function nullable(v: unknown, max = 120): string | null {
  return v === null ? null : string(v, max);
}
function count(v: unknown): number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0
    ? v
    : invalid();
}
function date(v: unknown): string {
  const s = string(v, 50);
  return Number.isFinite(Date.parse(s)) ? s : invalid();
}
function state(v: unknown): TraceState {
  return v === "running" || v === "committed" || v === "superseded" ||
      v === "error" || v === "abandoned"
    ? v
    : invalid();
}
function label(v: unknown): QualityLabel {
  return v === "correct" || v === "interpretation_error" ||
      v === "policy_error" || v === "external_failure" || v === "incomplete"
    ? v
    : invalid();
}
function cohort(v: unknown): QualityDetail["cohort"] {
  return v === "train" || v === "validation" || v === "holdout" ? v : invalid();
}
function hash(v: unknown): string {
  const s = string(v, 64);
  return /^[a-f0-9]{64}$/.test(s) ? s : invalid();
}
export function parseQualityOverview(raw: unknown): QualityOverview {
  const v = object(raw), transitions = object(v.deliveryTransitions);
  if (
    v.blindAccuracyMeasured !== false ||
    v.reviewSignalsAreConfirmedErrors !== false ||
    Object.keys(transitions).length > 8
  ) invalid();
  return {
    from: date(v.from),
    to: date(v.to),
    attempts: count(v.attempts),
    committed: count(v.committed),
    superseded: count(v.superseded),
    errors: count(v.errors),
    abandoned: count(v.abandoned),
    open: count(v.open),
    interpretationAttempts: count(v.interpretationAttempts),
    interpretationFailures: count(v.interpretationFailures),
    handoffSignals: count(v.handoffSignals),
    confirmedInterpretationErrors: count(v.confirmedInterpretationErrors),
    reviewedCases: count(v.reviewedCases),
    deliveryTransitions: Object.fromEntries(
      Object.entries(transitions).map(([k, n]) => {
        if (
          ![
            "pending",
            "sending",
            "accepted",
            "delivered",
            "read",
            "failed",
            "uncertain",
          ].includes(k)
        ) invalid();
        return [k, count(n)];
      }),
    ),
  };
}
export function parseQualityPage(raw: unknown): QualityPage {
  const v = object(raw);
  if (
    !Array.isArray(v.items) || v.items.length > 20 ||
    typeof v.hasMore !== "boolean"
  ) invalid();
  return {
    hasMore: v.hasMore,
    items: v.items.map((item): QualityAttempt => {
      const r = object(item);
      return {
        id: uuid(r.id),
        startedAt: date(r.startedAt),
        state: state(r.state),
        phaseBefore: string(r.phaseBefore),
        phaseAfter: nullable(r.phaseAfter),
        action: nullable(r.action),
        reason: nullable(r.reason),
        label: r.label === null ? null : label(r.label),
      };
    }),
  };
}
export function parseQualityDetail(raw: unknown): QualityDetail {
  const v = object(raw),
    meta = object(v.meta),
    context = object(v.context),
    draft = object(context.draft);
  if (
    !Array.isArray(v.messages) || v.messages.length < 1 ||
    v.messages.length > 20 || !Array.isArray(v.sourceHashes) ||
    v.sourceHashes.length !== v.messages.length ||
    !Array.isArray(context.history) || context.history.length > 12 ||
    v.blindEligible !== false
  ) invalid();
  const messages = v.messages.map((m: unknown) =>
      parseStoredInbound(m, Date.now())
    ),
    current = messages.map((m) => m.text).filter(Boolean).join("\n");
  const packet = v.packet === null ? null : object(v.packet);
  const steps = packet?.steps ?? [];
  if (!Array.isArray(steps) || steps.length > 12) invalid();
  const review = v.review === null ? null : object(v.review);
  const placeText = (p: unknown) =>
    p === null ? null : string(object(p).text, 400);
  return {
    id: uuid(v.id),
    state: state(v.state),
    phaseBefore: string(v.phaseBefore),
    phaseAfter: nullable(v.phaseAfter),
    action: nullable(v.action),
    reason: nullable(v.reason),
    model: string(meta.model),
    engineVersion: string(meta.engineVersion),
    promptHash: hash(meta.promptHash),
    proposal: packet?.interpretationPrivate
      ? parseInterpretation(packet.interpretationPrivate, current)
      : null,
    messages,
    sourceHashes: v.sourceHashes.map(hash),
    cohort: cohort(v.cohort),
    before: {
      name: nullable(draft.name, 80),
      origin: placeText(draft.origin),
      destination: placeText(draft.destination),
      quoteCents: draft.quoteCents === null ? null : count(draft.quoteCents),
    },
    history: context.history.map((h: unknown) => {
      const r = object(h);
      if (r.role !== "user" && r.role !== "assistant") invalid();
      return { role: r.role, content: string(r.content, 3000) };
    }),
    steps: steps.map((s: unknown) => {
      const r = object(s);
      if (r.outcome !== "ok" && r.outcome !== "error") invalid();
      if (
        !["interpret", "resolve", "quote", "candidates"].includes(
          String(r.phase),
        )
      ) invalid();
      return {
        phase: string(r.phase),
        outcome: r.outcome,
        durationMs: count(r.durationMs),
        code: string(r.code),
        amountCents: r.amountCents == null ? null : count(r.amountCents),
        candidateCount: r.candidateCount === undefined
          ? null
          : count(r.candidateCount),
      };
    }),
    review: review
      ? {
        revision: count(review.revision),
        label: label(review.label),
        expected: review.expected === null
          ? null
          : parseInterpretation(review.expected, current),
      }
      : null,
  };
}
export function parseQualitySaved(
  raw: unknown,
): { revision: number; cohort: QualityDetail["cohort"] } {
  const v = object(raw);
  if (v.state !== "saved") invalid();
  return { revision: count(v.revision), cohort: cohort(v.cohort) };
}
