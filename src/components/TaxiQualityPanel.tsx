import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, Check, RefreshCw } from "lucide-react";
import {
  createTaxiQualityPreview,
  taxiQualityClient,
} from "../lib/taxiQualityClient";
import { TrackingClientError } from "../lib/trackingClient";
import type { Interpretation } from "../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts";
import { parseInterpretation } from "../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/policy.ts";
import type {
  QualityDetail,
  QualityLabel,
  QualityOverview,
  QualityPage,
  QualityReviewCommand,
  QualityWindow,
} from "../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/qualityContracts.ts";
import "./taxiQualityPanel.css";
const labels: Record<QualityLabel, string> = {
  correct: "Interpretación correcta",
  interpretation_error: "Error de interpretación",
  policy_error: "Error de reglas del servidor",
  external_failure: "Fallo de un servicio externo",
  incomplete: "No hay información suficiente",
};
const states = {
  running: "En proceso",
  committed: "Procesado",
  superseded: "Sustituido por un mensaje nuevo",
  error: "Falló el intento",
  abandoned: "Intento interrumpido",
};
const phases: Record<string, string> = {
  human: "Atención humana",
  searching: "Buscando unidad",
  en_route: "Unidad en camino",
  location_role: "Aclarar la ubicación",
  origin: "Falta recogida",
  destination: "Falta destino",
  name: "Falta nombre",
  review: "Esperando confirmación",
  review_expired: "Resumen vencido",
  ready_for_review: "Preparar resumen",
};
const intents: { value: Interpretation["intent"]; label: string }[] = [
  { value: "provide", label: "Dar o corregir datos" },
  { value: "quote", label: "Consultar precio" },
  { value: "confirm", label: "Confirmar el viaje" },
  { value: "cancel", label: "Cancelar el viaje" },
  { value: "status", label: "Consultar el estado" },
  { value: "human", label: "Pedir atención humana" },
  { value: "smalltalk", label: "Saludo o conversación" },
  { value: "ambiguous", label: "Hace falta aclarar" },
];
const fields = [{ key: "name", label: "Nombre" }, {
  key: "origin",
  label: "Recogida",
}, { key: "destination", label: "Destino" }] as const;
const emptyPage: QualityPage = { items: [], hasMore: false };
function localDay(date: Date): string {
  return `${date.getFullYear()}-${
    String(date.getMonth() + 1).padStart(2, "0")
  }-${String(date.getDate()).padStart(2, "0")}`;
}
function initialDates() {
  const end = new Date(), start = new Date(end);
  start.setDate(start.getDate() - 6);
  return { from: localDay(start), to: localDay(end) };
}
function windowFor(dates: { from: string; to: string }): QualityWindow {
  const start = new Date(dates.from + "T00:00:00"),
    end = new Date(dates.to + "T00:00:00");
  end.setDate(end.getDate() + 1);
  if (
    !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) ||
    end <= start || end.getTime() - start.getTime() > 31 * 86400000
  ) {
    throw new Error(
      "Elige un periodo de hasta 31 días, con la fecha inicial antes de la final.",
    );
  }
  return { from: start.toISOString(), to: end.toISOString() };
}
const errorText = (e: unknown) =>
  e instanceof Error
    ? e.message
    : "No pudimos completar la consulta. Vuelve a intentar.";
const phase = (value: string | null) =>
  value ? phases[value] ?? value : "Sin cambio confirmado";
const dateTime = (value: string) =>
  new Date(value).toLocaleString("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  });

export default function TaxiQualityPanel(
  { tenantId, waba, canReview, preview, onLockChange }: {
    tenantId: string;
    waba: string;
    canReview: boolean;
    preview: boolean;
    onLockChange: (locked: boolean) => void;
  },
) {
  const client = useMemo(
    () => preview ? createTaxiQualityPreview() : taxiQualityClient,
    [preview],
  );
  const [dates, setDates] = useState(initialDates),
    [window, setWindow] = useState(() => windowFor(initialDates())),
    [refresh, setRefresh] = useState(0);
  const [overview, setOverview] = useState<QualityOverview | null>(null),
    [page, setPage] = useState<QualityPage>(emptyPage),
    [loading, setLoading] = useState(true),
    [moreLoading, setMoreLoading] = useState(false);
  const [detail, setDetail] = useState<QualityDetail | null>(null),
    [detailLoading, setDetailLoading] = useState(false),
    [selectedId, setSelectedId] = useState("");
  const [label, setLabel] = useState<QualityLabel | "">(""),
    [expected, setExpected] = useState<Interpretation>({
      intent: "ambiguous",
      fields: {},
    });
  const [pending, setPending] = useState<QualityReviewCommand | null>(null),
    [saving, setSaving] = useState(false),
    [stale, setStale] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const detailAbort = useRef<AbortController | null>(null),
    pageAbort = useRef<AbortController | null>(null),
    writeBusy = useRef(false),
    detailElement = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (detail?.id) detailElement.current?.focus();
  }, [detail?.id]);
  useEffect(() => {
    const abort = new AbortController();
    Promise.all([
      client.overview(tenantId, waba, window, abort.signal),
      canReview
        ? client.attempts(tenantId, waba, window, undefined, abort.signal)
        : Promise.resolve(emptyPage),
    ]).then(([summary, list]) => {
      if (!abort.signal.aborted) {
        setOverview(summary);
        setPage(list);
      }
    }).catch((e: unknown) => {
      if (!abort.signal.aborted) setError(errorText(e));
    }).finally(() => {
      if (!abort.signal.aborted) setLoading(false);
    });
    return () => {
      abort.abort();
      pageAbort.current?.abort();
      detailAbort.current?.abort();
    };
  }, [client, tenantId, waba, canReview, window, refresh]);
  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    globalThis.addEventListener("beforeunload", warn);
    return () => globalThis.removeEventListener("beforeunload", warn);
  }, [pending]);
  function reload() {
    setLoading(true);
    setOverview(null);
    setPage(emptyPage);
    setError("");
    setRefresh((v) => v + 1);
  }
  async function more() {
    const last = page.items.at(-1);
    if (!last || moreLoading || pending) return;
    const abort = new AbortController();
    pageAbort.current?.abort();
    pageAbort.current = abort;
    setMoreLoading(true);
    setError("");
    try {
      const next = await client.attempts(tenantId, waba, window, {
        startedAt: last.startedAt,
        id: last.id,
      }, abort.signal);
      if (!abort.signal.aborted) {
        setPage((old) => ({
          ...next,
          items: [...old.items, ...next.items].slice(-100),
        }));
      }
    } catch (e: unknown) {
      if (!abort.signal.aborted) setError(errorText(e));
    } finally {
      if (!abort.signal.aborted) setMoreLoading(false);
    }
  }
  async function open(id: string) {
    if (pending) return;
    const abort = new AbortController();
    detailAbort.current?.abort();
    detailAbort.current = abort;
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    setLabel("");
    setStale(false);
    setError("");
    setNotice("");
    try {
      const result = await client.detail(tenantId, waba, id, abort.signal);
      if (!abort.signal.aborted) {
        setDetail(result);
        setLabel(result.review?.label ?? "");
        setExpected(
          result.review?.expected ?? result.proposal ??
            { intent: "ambiguous", fields: {} },
        );
      }
    } catch (e: unknown) {
      if (!abort.signal.aborted) setError(errorText(e));
    } finally {
      if (!abort.signal.aborted) setDetailLoading(false);
    }
  }
  async function save(command: QualityReviewCommand) {
    if (writeBusy.current) return;
    writeBusy.current = true;
    setSaving(true);
    setPending(command);
    onLockChange(true);
    setError("");
    setNotice("");
    try {
      const result = await client.review(command);
      setDetail((old) =>
        old?.id === command.traceId
          ? {
            ...old,
            review: {
              revision: result.revision,
              label: command.label,
              expected: command.expected,
            },
          }
          : old
      );
      setPending(null);
      onLockChange(false);
      setNotice(
        preview
          ? "Revisión de ejemplo guardada sólo en esta vista."
          : "Revisión guardada. El bot no cambia sus instrucciones automáticamente.",
      );
      reload();
    } catch (e: unknown) {
      if (
        e instanceof TrackingClientError &&
        [400, 401, 403, 404, 409, 422].includes(e.status)
      ) {
        setPending(null);
        onLockChange(false);
        setStale(true);
      }
      setError(errorText(e));
    } finally {
      writeBusy.current = false;
      setSaving(false);
    }
  }
  function submitReview() {
    if (!detail || !label || pending || stale) return;
    try {
      const candidate = label === "correct"
        ? detail.proposal
        : label === "interpretation_error"
        ? expected
        : null;
      if (
        (label === "correct" || label === "interpretation_error") && !candidate
      ) {
        throw new Error(
          "No hay una interpretación para aprobar. Elige otra etiqueta o indica la interpretación correcta.",
        );
      }
      const checked = candidate
        ? parseInterpretation(
          candidate,
          detail.messages.map((m) => m.text).filter(Boolean).join("\n"),
        )
        : null;
      void save({
        action: "quality_review",
        tenantId,
        waba,
        traceId: detail.id,
        requestId: crypto.randomUUID(),
        revision: detail.review?.revision ?? 0,
        label,
        expected: checked,
      });
    } catch (e: unknown) {
      setError(errorText(e));
    }
  }
  function updateField(
    key: "name" | "origin" | "destination",
    part: "value" | "evidence",
    value: string,
  ) {
    setExpected((old) => {
      const next = {
          ...(old.fields[key] ?? { value: "", evidence: "" }),
          [part]: value,
        },
        updated = { ...old.fields };
      if (!next.value && !next.evidence) delete updated[key];
      else updated[key] = next;
      return { ...old, fields: updated };
    });
  }
  return (
    <section className="taxi-quality" aria-label="Calidad del bot">
      <div className="taxi-quality-heading">
        <div>
          <h2>Revisar y aprender</h2>
          <p>
            Encuentra fallos, revisa lo que pasó y deja una corrección con su
            contexto.
          </p>
        </div>
      </div>
      {preview && (
        <p className="taxi-demo">
          Los mensajes y cifras de esta pestaña son ejemplos inventados. Ninguna
          revisión se envía al servidor.
        </p>
      )}
      <form
        className="taxi-quality-period"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const next = windowFor(dates);
            setLoading(true);
            setOverview(null);
            setPage(emptyPage);
            setSelectedId("");
            setDetail(null);
            setError("");
            setWindow(next);
          } catch (failure: unknown) {
            setError(errorText(failure));
          }
        }}
      >
        <label>
          Desde<input
            type="date"
            required
            value={dates.from}
            disabled={Boolean(pending) || loading || moreLoading}
            onChange={(e) => setDates((v) => ({ ...v, from: e.target.value }))}
          />
        </label>
        <label>
          Hasta<input
            type="date"
            required
            value={dates.to}
            disabled={Boolean(pending) || loading || moreLoading}
            onChange={(e) => setDates((v) => ({ ...v, to: e.target.value }))}
          />
        </label>
        <button
          className="taxi-secondary"
          disabled={Boolean(pending) || loading || moreLoading}
        >
          <RefreshCw size={17} />
          {loading ? "Consultando…" : "Consultar periodo"}
        </button>
        <small>Hasta 31 días. Horario de esta computadora.</small>
      </form>
      {error && (
        <div className="taxi-error" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="taxi-notice" role="status">
          <Check size={18} />
          {notice}
        </div>
      )}
      {pending && !saving && (
        <div className="taxi-uncertain">
          <p>
            No se confirmó el guardado. Comprueba esta misma revisión antes de
            cambiar de base o salir.
          </p>
          <button className="taxi-primary" onClick={() => void save(pending)}>
            Comprobar revisión
          </button>
        </div>
      )}
      {loading && (
        <p className="taxi-quality-loading" role="status">
          Consultando los intentos de este periodo…
        </p>
      )}
      {!loading && !overview && (
        <button className="taxi-secondary" onClick={reload}>
          Volver a consultar
        </button>
      )}
      {overview && (
        <>
          <p className="taxi-quality-caption">
            Datos consultados:{" "}
            {new Date(overview.from).toLocaleDateString("es-MX")} al{" "}
            {new Date(Date.parse(overview.to) - 1).toLocaleDateString("es-MX")}.
          </p>
          <dl className="taxi-quality-summary">
            <div>
              <dt>Intentos procesados</dt>
              <dd>
                {overview.committed}{" "}
                <span>de {overview.attempts} intentos</span>
              </dd>
            </div>
            <div>
              <dt>Intentos con fallo</dt>
              <dd>
                {overview.errors}{" "}
                <span>{overview.abandoned} interrumpidos</span>
              </dd>
            </div>
            <div>
              <dt>Solicitudes de atención humana</dt>
              <dd>
                {overview.handoffSignals} <span>señales para revisar</span>
              </dd>
            </div>
            <div>
              <dt>Errores de interpretación revisados</dt>
              <dd>
                {overview.confirmedInterpretationErrors}{" "}
                <span>de {overview.reviewedCases} casos revisados</span>
              </dd>
            </div>
          </dl>
          <p className="taxi-quality-caption">
            Los intentos se cuentan por inicio; las revisiones, por fecha de
            revisión. Un reintento cuenta aparte. Las solicitudes de atención no
            prueban un error. No se ha medido precisión con casos ciegos.
          </p>
          <details className="taxi-quality-metrics">
            <summary>Ver fallos del intérprete y estados de mensajes</summary>
            <p>
              {overview.interpretationFailures} fallos en{" "}
              {overview.interpretationAttempts} llamadas al intérprete.{" "}
              {overview.superseded} intentos sustituidos por mensajes nuevos;
              {" "}
              {overview.open} en proceso.
            </p>
            <dl>
              {Object.entries(overview.deliveryTransitions).map(([key, n]) => (
                <div key={key}>
                  <dt>
                    {{
                      pending: "En cola",
                      sending: "Enviando",
                      accepted: "Aceptados por el proveedor",
                      delivered: "Entregados",
                      read: "Leídos",
                      failed: "Fallidos",
                      uncertain: "Por comprobar",
                    }[key] ?? key}
                  </dt>
                  <dd>{n}</dd>
                </div>
              ))}
            </dl>
            <small>
              Son cambios de estado, no mensajes únicos. Aceptado por el
              proveedor no acredita entrega ni lectura.
            </small>
          </details>
        </>
      )}
      {!canReview && (
        <div className="taxi-empty">
          <h3>Tu cuenta puede consultar los totales</h3>
          <p>
            La administración de la base puede abrir los mensajes y revisar cada
            caso.
          </p>
        </div>
      )}
      {canReview && !loading && overview && (
        <div
          className={"taxi-quality-workspace" +
            (selectedId ? " has-detail" : "")}
        >
          <section className="taxi-quality-list" aria-label="Intentos del bot">
            <h3>Intentos del periodo</h3>
            <p>
              Abrir un caso muestra contenido privado y excluye a ese contacto
              de futuras pruebas ciegas.
            </p>
            {page.items.length === 0
              ? (
                <div className="taxi-empty">
                  <h3>No hay intentos en estas fechas</h3>
                  <p>Cuando este canal procese mensajes, aparecerán aquí.</p>
                </div>
              )
              : (
                <ol>
                  {page.items.map((item) => (
                    <li key={item.id}>
                      <button
                        className={selectedId === item.id ? "is-selected" : ""}
                        aria-pressed={selectedId === item.id}
                        disabled={Boolean(pending)}
                        onClick={() => void open(item.id)}
                      >
                        <time dateTime={item.startedAt}>
                          {dateTime(item.startedAt)}
                        </time>
                        <strong>{states[item.state]}</strong>
                        <span>
                          {phase(item.phaseBefore)} → {phase(item.phaseAfter)}
                        </span>
                        <small>
                          {item.label ? labels[item.label] : "Sin revisar"}
                        </small>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            {page.hasMore && (
              <button
                className="taxi-secondary"
                disabled={Boolean(pending) || moreLoading}
                onClick={() => void more()}
              >
                {moreLoading ? "Cargando…" : "Ver intentos anteriores"}
              </button>
            )}
            <small>Se conservan hasta 100 intentos en pantalla.</small>
          </section>
          {selectedId && (
            <section
              ref={detailElement}
              tabIndex={-1}
              className="taxi-quality-detail"
              aria-label="Revisión del caso"
              aria-busy={detailLoading}
            >
              <button
                className="taxi-secondary taxi-quality-back"
                disabled={Boolean(pending)}
                onClick={() => {
                  detailAbort.current?.abort();
                  setSelectedId("");
                  setDetail(null);
                }}
              >
                <ArrowLeft size={17} />Volver a los intentos
              </button>
              {detailLoading && <p role="status">Abriendo el caso…</p>}
              {!detailLoading && !detail && (
                <button
                  className="taxi-secondary"
                  onClick={() => void open(selectedId)}
                >
                  Volver a abrir el caso
                </button>
              )}
              {detail && (
                <>
                  <div className="taxi-quality-heading">
                    <div>
                      <h3>Lo que pasó en este intento</h3>
                      <p>
                        {states[detail.state]} · {phase(detail.phaseBefore)} →
                        {" "}
                        {phase(detail.phaseAfter)}
                      </p>
                    </div>
                  </div>
                  <h4>Mensaje recibido</h4>
                  <div className="taxi-quality-messages">
                    {detail.messages.map((m) => (
                      <div key={m.id}>
                        <time dateTime={m.at}>{dateTime(m.at)}</time>
                        <p>
                          {m.text || (m.type === "location"
                            ? "El cliente compartió una ubicación."
                            : m.type === "button"
                            ? "El cliente pulsó un botón."
                            : "Contenido sin texto compatible.")}
                        </p>
                        {m.button && <small>Botón: {m.button}</small>}
                      </div>
                    ))}
                  </div>
                  <details className="taxi-quality-context">
                    <summary>Ver contexto anterior</summary>
                    <dl>
                      <div>
                        <dt>Nombre</dt>
                        <dd>{detail.before.name ?? "Sin dato"}</dd>
                      </div>
                      <div>
                        <dt>Recogida</dt>
                        <dd>{detail.before.origin ?? "Sin dato"}</dd>
                      </div>
                      <div>
                        <dt>Destino</dt>
                        <dd>{detail.before.destination ?? "Sin dato"}</dd>
                      </div>
                      <div>
                        <dt>Precio registrado</dt>
                        <dd>
                          {detail.before.quoteCents === null
                            ? "Sin cotización"
                            : (detail.before.quoteCents / 100).toLocaleString(
                              "es-MX",
                              { style: "currency", currency: "MXN" },
                            )}
                        </dd>
                      </div>
                    </dl>
                    {detail.history.map((h, index) => (
                      <p key={index}>
                        <strong>
                          {h.role === "user" ? "Cliente" : "Bot"}:
                        </strong>{" "}
                        {h.content}
                      </p>
                    ))}
                  </details>
                  <h4>Lo que entendió la IA</h4>
                  {detail.proposal
                    ? (
                      <>
                        <p>
                          {intents.find((i) =>
                            i.value === detail.proposal?.intent
                          )?.label}
                        </p>
                        <dl className="taxi-quality-fields">
                          {fields.map((f) => {
                            const v = detail.proposal?.fields[f.key];
                            return (
                              <div key={f.key}>
                                <dt>{f.label}</dt>
                                <dd>
                                  {v
                                    ? (
                                      <>
                                        {v.value}
                                        <q>{v.evidence}</q>
                                      </>
                                    )
                                    : "No extrajo un dato"}
                                </dd>
                              </div>
                            );
                          })}
                        </dl>
                      </>
                    )
                    : (
                      <p>
                        Este intento no dejó una interpretación válida. Puede
                        haber seguido una regla directa o fallado antes de
                        obtenerla.
                      </p>
                    )}
                  <h4>Consultas y validación del servidor</h4>
                  {detail.steps.length
                    ? (
                      <ol className="taxi-quality-steps">
                        {detail.steps.map((s, i) => (
                          <li key={i}>
                            <strong>
                              {{
                                interpret: "Interpretar el mensaje",
                                resolve: "Resolver una ubicación",
                                quote: "Consultar la tarifa",
                                candidates: "Buscar unidades",
                              }[s.phase] ?? s.phase}
                            </strong>
                            <span>
                              {s.outcome === "ok" ? "Completado" : "Falló"} ·
                              {" "}
                              {s.durationMs} ms
                            </span>
                            {s.code !== "ok" && <code>{s.code}</code>}
                            {s.amountCents !== null && (
                              <span>
                                {(s.amountCents / 100).toLocaleString("es-MX", {
                                  style: "currency",
                                  currency: "MXN",
                                })}
                              </span>
                            )}
                            {s.candidateCount !== null && (
                              <span>
                                {s.candidateCount} unidades candidatas
                              </span>
                            )}
                          </li>
                        ))}
                      </ol>
                    )
                    : (
                      <p>
                        No hubo consultas registradas a servicios en este
                        intento.
                      </p>
                    )}
                  <p>
                    Resultado del servidor:{" "}
                    <code>{detail.action ?? "Sin acción confirmada"}</code>
                    {detail.reason && (
                      <>
                        · <code>{detail.reason}</code>
                      </>
                    )}
                  </p>
                  <form
                    className="taxi-quality-review"
                    onSubmit={(e) => {
                      e.preventDefault();
                      submitReview();
                    }}
                  >
                    <h4>Tu revisión</h4>
                    <p>
                      La etiqueta queda ligada a este mensaje, al contexto y a
                      tu cuenta.
                    </p>
                    <label>
                      ¿Qué ocurrió?<select
                        required
                        value={label}
                        disabled={Boolean(pending) || stale ||
                          detail.state === "running"}
                        onChange={(e) => {
                          const next = Object.keys(labels).find((v) =>
                            v === e.target.value
                          );
                          if (
                            next &&
                            (next === "correct" ||
                              next === "interpretation_error" ||
                              next === "policy_error" ||
                              next === "external_failure" ||
                              next === "incomplete")
                          ) setLabel(next);
                        }}
                      >
                        <option value="" disabled>Elige una etiqueta</option>
                        {Object.entries(labels).map(([value, title]) => (
                          <option
                            key={value}
                            value={value}
                            disabled={value === "correct" && !detail.proposal}
                          >
                            {title}
                          </option>
                        ))}
                      </select>
                    </label>
                    {label === "interpretation_error" && (
                      <fieldset disabled={Boolean(pending) || stale}>
                        <legend>Interpretación que debió obtener</legend>
                        <label>
                          Intención<select
                            value={expected.intent}
                            onChange={(e) => {
                              const chosen = intents.find((i) =>
                                i.value === e.target.value
                              );
                              if (chosen) {
                                setExpected((v) => ({
                                  ...v,
                                  intent: chosen.value,
                                }));
                              }
                            }}
                          >
                            {intents.map((i) => (
                              <option key={i.value} value={i.value}>
                                {i.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <p>
                          Copia las palabras del mensaje. Deja ambos campos
                          vacíos si ese dato no se proporcionó. Una corrección
                          posterior prevalece.
                        </p>
                        {fields.map((f) => (
                          <div className="taxi-quality-edit-field" key={f.key}>
                            <label>
                              {f.label}
                              <input
                                value={expected.fields[f.key]?.value ?? ""}
                                maxLength={f.key === "name" ? 80 : 400}
                                onChange={(e) =>
                                  updateField(f.key, "value", e.target.value)}
                              />
                            </label>
                            <label>
                              Fragmento del mensaje que lo respalda<textarea
                                value={expected.fields[f.key]?.evidence ?? ""}
                                maxLength={3000}
                                rows={2}
                                onChange={(e) =>
                                  updateField(
                                    f.key,
                                    "evidence",
                                    e.target.value,
                                  )}
                              />
                            </label>
                          </div>
                        ))}
                      </fieldset>
                    )}
                    {stale
                      ? (
                        <button
                          type="button"
                          className="taxi-secondary"
                          onClick={() => void open(detail.id)}
                        >
                          Actualizar el caso antes de revisar
                        </button>
                      )
                      : (
                        <button
                          className="taxi-primary"
                          disabled={!label || Boolean(pending) ||
                            detail.state === "running"}
                        >
                          {saving ? "Guardando…" : "Guardar revisión"}
                        </button>
                      )}
                    {detail.state === "running" && (
                      <p>
                        Espera a que termine el intento y vuelve a abrirlo para
                        revisarlo.
                      </p>
                    )}
                  </form>
                  <details className="taxi-quality-provenance">
                    <summary>Origen y versión del caso</summary>
                    <dl>
                      <div>
                        <dt>Partición fija</dt>
                        <dd>
                          {{
                            train: "Entrenamiento",
                            validation: "Validación",
                            holdout: "Reserva",
                          }[detail.cohort]}
                        </dd>
                      </div>
                      <div>
                        <dt>Modelo</dt>
                        <dd>{detail.model}</dd>
                      </div>
                      <div>
                        <dt>Motor</dt>
                        <dd>{detail.engineVersion}</dd>
                      </div>
                      <div>
                        <dt>Huella de instrucciones</dt>
                        <dd>
                          <code>{detail.promptHash}</code>
                        </dd>
                      </div>
                      {detail.sourceHashes.map((h, i) => (
                        <div key={i}>
                          <dt>Huella de origen {i + 1}</dt>
                          <dd>
                            <code>{h}</code>
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <p>
                      Abriste este caso; su contacto ya no cuenta como evidencia
                      ciega. Guardar la revisión no modifica el bot ni mueve el
                      contacto a otra partición.
                    </p>
                  </details>
                </>
              )}
            </section>
          )}
        </div>
      )}
    </section>
  );
}
