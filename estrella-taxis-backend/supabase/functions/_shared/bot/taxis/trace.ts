import { TAXI_BOT_VERSION } from "./contracts.ts";
import type {
  Interpretation,
  TaxiChannel,
  TaxiDecision,
  TaxiSession,
} from "./contracts.ts";
import type { TaxiServices } from "./coordinator.ts";
import { fingerprint, TrackingError } from "../../tracking/contracts.ts";
import { conversationPhase } from "./stateMachine.ts";
import { TAXI_INTERPRETER_CONTRACT } from "./interpreter.ts";
import{TAXI_QUESTION_PROMPT}from'./conversationReply.ts';
export const TAXI_TRACE_VERSION = "taxi-trace-v1";
export interface ModelMetadata {
  inputTokens: number | null;
  outputTokens: number | null;
  responseHash: string | null;
}
export interface TraceStep {
  phase: "interpret" | "resolve" | "quote" | "candidates" | 'compose';
  outcome: "ok" | "error";
  durationMs: number;
  inputHash: string;
  outputHash: string | null;
  code: string;
  intent?: string;
  fields?: string[];
  resolution?: string;
  amountCents?: number | null;
  candidateCount?: number;
  model?: ModelMetadata;
}
export interface TracePacket {
  version: string;
  steps: TraceStep[];
  phaseBefore: string;
  phaseProposed: string | null;
  interpretationPrivate: Interpretation | null;
  decision: string | null;
  reason: string | null;
  durationMs: number;
}
const duration = (start: number) =>
  Math.min(120000, Math.max(0, Math.round(performance.now() - start)));
export const safeErrorCode = (error: unknown): string =>
  error instanceof TrackingError && /^[a-z0-9_]{1,80}$/.test(error.code)
    ? error.code
    : error instanceof Error && error.name === "AbortError"
    ? "aborted"
    : "external_failure";
export class TaxiTurnTrace {
  private readonly started = performance.now();
  private readonly steps: TraceStep[] = [];
  private interpretation: Interpretation | null = null;
  private readonly session: TaxiSession;
  private readonly now: number;
  constructor(session: TaxiSession, now: number) {
    this.session = session;
    this.now = now;
  }
  async metadata(c: TaxiChannel): Promise<Record<string, unknown>> {
    return {
      version: TAXI_TRACE_VERSION,
      engineVersion: TAXI_BOT_VERSION,
      model: c.model,
      promptHash: await fingerprint(TAXI_INTERPRETER_CONTRACT),
      phaseBefore: conversationPhase(this.session, this.now),
    };
  }
  private async run<T>(
    phase: TraceStep["phase"],
    input: unknown,
    execute: () => Promise<T>,
    summarize: (value: T) => Partial<TraceStep>,
  ): Promise<T> {
    if (this.steps.length >= 12) {
      throw new TrackingError(
        500,
        "taxi_trace_limit",
        "El turno superó su límite de consultas.",
      );
    }
    const step: TraceStep = {
      phase,
      outcome: "error",
      durationMs: 0,
      inputHash: await fingerprint(input),
      outputHash: null,
      code: "interrupted",
    };
    this.steps.push(step);
    const started = performance.now();
    try {
      const value = await execute();
      const summary=summarize(value);
      Object.assign(step, summary, {
        outcome: "ok",
        code: summary.code??"ok",
        outputHash: await fingerprint(value),
      });
      return value;
    } catch (error: unknown) {
      step.code = safeErrorCode(error);
      throw error;
    } finally {
      step.durationMs = duration(started);
    }
  }
  services(base: TaxiServices): TaxiServices {
    const compose=base.question;
    return {
      ...(compose?{question:(kind,current,channel,signal,context)=>this.run('compose',{kind,current,context,contract:TAXI_QUESTION_PROMPT},()=>compose(kind,current,channel,signal,context),value=>({code:value?'generated':'canonical'}))}:{}),
      interpret: async (text, session, channel, signal) => {
        let model: ModelMetadata | undefined;
        try {
          return await this.run(
            "interpret",
            { text, session },
            () =>
              base.interpret(text, session, channel, signal, (value) => {
                model = value;
              }),
            (value) => {
              // Keep the SQL trace-v1 literal-field contract. The proposal hash above includes
              // refines; a bounded step code records its presence without silently widening SQL.
              const fields:Interpretation['fields']={};
              for(const key of ['name','origin','destination','pickupReference'] as const){const field=value.fields[key];if(field)fields[key]={value:field.value,evidence:field.evidence};}
              this.interpretation = {...value,fields};
              return {
                intent: value.intent,
                fields: Object.keys(value.fields),
                ...(value.fields.destination?.refines!==undefined?{code:'proposed_destination_refinement'}:value.fields.origin?.refines!==undefined?{code:'proposed_origin_refinement'}:{}),
              };
            },
          );
        } finally {
          const step = this.steps.at(-1);
          if (step?.phase === "interpret" && model) step.model = model;
        }
      },
      resolve: async (text, channel, signal, area) => {
        let model:ModelMetadata|undefined;
        try{return await this.run('resolve',{text,area},()=>base.resolve(text,channel,signal,area,value=>{model=value;}),value=>({resolution:value.kind}));}
        finally{const step=this.steps.at(-1);if(step?.phase==='resolve'&&model)step.model=model;}
      },
      quote: (origin, destination, channel, signal, destinationArea) =>
        this.run(
          "quote",
          { origin, destination, mode: channel.pricingMode },
          () => base.quote(origin, destination, channel, signal, destinationArea),
          (value) => ({ amountCents: value }),
        ),
      candidates: (origin, channel, signal) =>
        this.run(
          "candidates",
          { origin },
          () => base.candidates(origin, channel, signal),
          (value) => ({ candidateCount: value.length }),
        ),
    };
  }
  packet(decision?: TaxiDecision): TracePacket {
    const projected = decision
      ? {
        ...this.session,
        mode: decision.action === "human"
          ? "human" as const
          : this.session.mode,
        draft: decision.draft,
      }
      : null;
    return {
      version: TAXI_TRACE_VERSION,
      steps: this.steps,
      phaseBefore: conversationPhase(this.session, this.now),
      interpretationPrivate: this.interpretation,
      phaseProposed: projected ? conversationPhase(projected, this.now) : null,
      decision: decision?.action ?? null,
      reason: decision?.reason ?? null,
      durationMs: duration(this.started),
    };
  }
}
