import { exact, revision } from "../_shared/bot/taxis/adminContracts.ts";
import { parseInterpretation } from "../_shared/bot/taxis/policy.ts";
import { record, TrackingError, uuid } from "../_shared/tracking/contracts.ts";
import type { TrackingStore } from "../_shared/tracking/store.ts";
import { json } from "../_shared/tracking/http.ts";
/** Caller has already verified the Traccar identity, taxi company and channel. */
export async function taxiQualityRequest(
  raw: Record<string, unknown>,
  tenant: string,
  waba: string,
  actor: number,
  configure: boolean,
  store: TrackingStore,
): Promise<Response | null> {
  if (
    ![
      "quality",
      "quality_attempts",
      "quality_trace",
      "quality_review",
      "training_export",
    ].includes(
      String(raw.action),
    )
  ) return null;
  if (raw.action === "quality" || raw.action === "quality_attempts") {
    const listing = raw.action === "quality_attempts";
    if (listing && !configure) {
      throw new TrackingError(
        403,
        "quality_review_forbidden",
        "Sólo la administración de esta base puede revisar casos.",
      );
    }
    exact(raw, [
      "action",
      "tenantId",
      "waba",
      "from",
      "to",
      ...(listing ? ["after"] : []),
    ]);
    const from = typeof raw.from === "string" ? Date.parse(raw.from) : NaN,
      to = typeof raw.to === "string" ? Date.parse(raw.to) : NaN;
    if (
      !Number.isFinite(from) || !Number.isFinite(to) || to <= from ||
      to - from > 31 * 86400000
    ) {
      throw new TrackingError(
        400,
        "invalid_quality_window",
        "Elige un periodo de hasta 31 días.",
      );
    }
    let after: { startedAt: string; id: string } | undefined;
    if (raw.after !== undefined) {
      if (!record(raw.after)) {
        throw new TrackingError(
          400,
          "invalid_quality_cursor",
          "Actualiza la lista de casos.",
        );
      }
      exact(raw.after, ["startedAt", "id"]);
      if (
        typeof raw.after.startedAt !== "string" ||
        raw.after.startedAt.length > 50 ||
        !Number.isFinite(Date.parse(raw.after.startedAt))
      ) {
        throw new TrackingError(
          400,
          "invalid_quality_cursor",
          "Actualiza la lista de casos.",
        );
      }
      // Preserve PostgreSQL microseconds; a Date round-trip would lose keyset precision.
      after = { startedAt: raw.after.startedAt, id: uuid(raw.after.id) };
    }
    return json(
      await store.rpc("taxi_bot_quality_read", {
        p_tenant: tenant,
        p_waba: waba,
        p_view: listing ? "attempts" : "overview",
        p_input: {
          from: new Date(from).toISOString(),
          to: new Date(to).toISOString(),
          ...(after ? { after } : {}),
        },
      }),
    );
  }
  if (!configure) {
    throw new TrackingError(
      403,
      "quality_review_forbidden",
      "Sólo la administración de esta base puede revisar casos o exportarlos para entrenamiento.",
    );
  }
  if (raw.action === "training_export") {
    exact(raw, ["action", "tenantId", "waba", "after"]);
    const input: Record<string, unknown> = {};
    if (raw.after !== undefined) input.after = uuid(raw.after);
    return json(
      await store.rpc("taxi_bot_quality_read", {
        p_tenant: tenant,
        p_waba: waba,
        p_view: "export",
        p_input: input,
      }),
    );
  }
  const traceId = uuid(raw.traceId);
  if (raw.action === "quality_trace") {
    exact(raw, ["action", "tenantId", "waba", "traceId"]);
    return json(
      await store.rpc("taxi_bot_quality_read", {
        p_tenant: tenant,
        p_waba: waba,
        p_view: "trace",
        p_input: { traceId },
      }),
    );
  }
  exact(raw, [
    "action",
    "tenantId",
    "waba",
    "traceId",
    "requestId",
    "revision",
    "label",
    "expected",
  ]);
  if (
    typeof raw.label !== "string" ||
    ![
      "correct",
      "interpretation_error",
      "policy_error",
      "external_failure",
      "incomplete",
    ].includes(raw.label)
  ) {
    throw new TrackingError(
      400,
      "invalid_quality_label",
      "Elige una etiqueta de revisión válida.",
    );
  }
  const source = await store.rpc("taxi_bot_quality_read", {
    p_tenant: tenant,
    p_waba: waba,
    p_view: "trace",
    p_input: { traceId },
  });
  if (!record(source) || source.state === "not_found") {
    throw new TrackingError(
      404,
      "quality_case_missing",
      "El caso no está disponible en esta base.",
    );
  }
  if (
    !Array.isArray(source.messages) || source.messages.length > 20 ||
    source.messages.some((m) =>
      !record(m) || typeof m.text !== "string" || m.text.length > 3000
    )
  ) {
    throw new TrackingError(
      502,
      "invalid_quality_source",
      "No se pudo reconstruir el mensaje de origen.",
    );
  }
  const current = source.messages.map((m: unknown) =>
    record(m) ? String(m.text) : ""
  ).filter(Boolean).join("\n");
  const observed = record(source.packet)
    ? source.packet.interpretationPrivate
    : null;
  const candidate = raw.expected ?? (raw.label === "correct" ? observed : null);
  if (
    (raw.label === "correct" || raw.label === "interpretation_error") &&
    !candidate
  ) {
    throw new TrackingError(
      400,
      "expected_interpretation_required",
      "Revisa e indica la interpretación correcta antes de etiquetar este caso.",
    );
  }
  const expected = candidate ? parseInterpretation(candidate, current) : null;
  const result = await store.rpc("taxi_bot_quality_review", {
    p_tenant: tenant,
    p_waba: waba,
    p_trace: traceId,
    p_actor: actor,
    p_request: uuid(raw.requestId),
    p_revision: revision(raw.revision),
    p_label: raw.label,
    p_expected: expected,
  });
  if (!record(result) || typeof result.state !== "string") {
    throw new TrackingError(
      503,
      "quality_result_uncertain",
      "No se confirmó la revisión. Comprueba la misma solicitud.",
    );
  }
  if (result.state !== "saved") {
    throw new TrackingError(
      409,
      "quality_" + result.state,
      "La revisión cambió. Actualiza el caso antes de guardarlo.",
    );
  }
  return json(result);
}
