import {
  Component,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  CarFront,
  CheckCircle2,
  Flag,
  MapPin,
  RefreshCw,
} from "lucide-react";
import {
  type DriverTripAction,
  DriverTripError,
  driverTripToken,
  type DriverTripView,
  loadDriverTrip,
} from "../lib/driverTripClient";
import "./driverTrip.css";
const DriverTripMap = lazy(() => import("../components/DriverTripMap"));
type Pending = { action: DriverTripAction; requestId: string };
class MapBoundary
  extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed
      ? (
        <div className="driver-trip-map-placeholder">
          No pudimos cargar el mapa. Los datos del viaje siguen disponibles.
        </div>
      )
      : this.props.children;
  }
}
function pointLabel(text: string) {
  return text.replace(
    /^Ubicación compartida\s*\([^)]*\)/i,
    "Ubicación compartida por el pasajero",
  ).replace(/\nReferencia:\s*/, "\nReferencia: ");
}
function notice(trip: DriverTripView): string {
  if (trip.arrivalNotice === "delivered" || trip.arrivalNotice === "read") {
    return "El pasajero recibió el aviso. Ya sabe que estás en el punto.";
  }
  if (trip.arrivalNotice === "accepted") {
    return "Aviso enviado. Estamos esperando la confirmación de entrega.";
  }
  if (trip.arrivalNotice === "failed" || trip.arrivalNotice === "uncertain") {
    return "No pudimos confirmar el aviso al pasajero. Contacta a la base para que te ayuden.";
  }
  return "Estamos avisando al pasajero que ya puede salir.";
}
export default function DriverTripPage() {
  const [token, setToken] = useState(() =>
    driverTripToken(window.location.hash)
  );
  useEffect(() => {
    document.title = "Tu servicio · Stellar";
    const changed = () => setToken(driverTripToken(window.location.hash));
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  return <DriverTripContent key={token ?? "invalid"} token={token} />;
}
function DriverTripContent({ token }: { token: string | null }) {
  const [trip, setTrip] = useState<DriverTripView | null>(null);
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [confirmFinish, setConfirmFinish] = useState(false),
    [pending, setPending] = useState<Pending | null>(null);
  const mounted = useRef(false),
    activeRequest = useRef<AbortController | null>(null),
    controllers = useRef(new Set<AbortController>()),
    pendingRef = useRef<Pending | null>(null),
    stopPolling = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const activeControllers = controllers.current;
    return () => {
      mounted.current = false;
      for (const controller of activeControllers) controller.abort();
    };
  }, []);
  const refresh = useCallback(async (command?: Pending) => {
    if (
      !token || activeRequest.current && !activeRequest.current.signal.aborted
    ) return;
    setBusy(true);
    const controller = new AbortController();
    activeRequest.current = controller;
    controllers.current.add(controller);
    try {
      const next = await loadDriverTrip(token, controller.signal, command);
      if (!mounted.current || controller.signal.aborted) return;
      setTrip(next);
      stopPolling.current = next.status !== "en_camino";
      const current = pendingRef.current,
        settled = Boolean(
          command ||
            current &&
              (current.action === "arrive" && next.arrivedAt !== null ||
                next.status !== "en_camino"),
        );
      if (settled) {
        pendingRef.current = null;
        setPending(null);
        setConfirmFinish(false);
      }
      if (!current || settled) setError(null);
    } catch (caught: unknown) {
      if (!mounted.current || controller.signal.aborted) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "No pudimos comprobar el viaje. Actualiza para intentarlo otra vez.",
      );
      if (
        caught instanceof DriverTripError &&
        [400, 403, 404, 410].includes(caught.status)
      ) {
        setTrip(null);
        stopPolling.current = true;
        pendingRef.current = null;
        setPending(null);
      } else if (caught instanceof DriverTripError && caught.status === 409) {
        pendingRef.current = null;
        setPending(null);
        setConfirmFinish(false);
      }
    } finally {
      controllers.current.delete(controller);
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        if (mounted.current) {
          setBusy(false);
          setLoaded(true);
        }
      }
    }
  }, [token]);
  useEffect(() => {
    if (!token) return;
    void refresh();
    const poll = () => {
      if (!document.hidden && !stopPolling.current) void refresh();
    };
    const timer = window.setInterval(poll, 8000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [token, refresh]);
  const act = (action: DriverTripAction) => {
    if (activeRequest.current && !activeRequest.current.signal.aborted) return;
    const command = pendingRef.current ??
      { action, requestId: crypto.randomUUID() };
    pendingRef.current = command;
    setPending(command);
    void refresh(command);
  };
  const completed = trip?.status === "completado",
    cancelled = trip?.status === "cancelado" ||
      trip?.status === "cancelado_timeout";
  return (
    <main className="driver-trip-page">
      <div className="driver-trip-shell">
        <header className="driver-trip-header">
          <span className="driver-trip-brand">
            <CarFront aria-hidden="true" size={28} /> Stellar
          </span>
          <span>Servicio de taxi</span>
        </header>
        {!token
          ? (
            <section className="driver-trip-empty">
              <AlertCircle size={40} aria-hidden="true" />
              <h1>Abre el enlace de tu viaje</h1>
              <p>
                Vuelve al mensaje de WhatsApp y toca{" "}
                <strong>Ver mi viaje</strong>.
              </p>
            </section>
          )
          : !loaded && !trip
          ? (
            <section className="driver-trip-loading" aria-live="polite">
              <h1>Cargando tu viaje…</h1>
              <div />
              <div />
              <p>Un momento, estamos comprobando los datos.</p>
            </section>
          )
          : trip
          ? (
            <>
              <section className="driver-trip-intro">
                <h1>
                  {completed
                    ? "Servicio finalizado"
                    : cancelled
                    ? "Este viaje se canceló"
                    : trip.arrivedAt
                    ? "Ya estás en el punto"
                    : "Tu viaje está asignado"}
                </h1>
                <p className="driver-trip-unit">{trip.unit}</p>
                <p>
                  {completed
                    ? "Gracias por atender el servicio."
                    : cancelled
                    ? "Ya no te dirijas al punto de recogida."
                    : (
                      <>
                        Pasajero: <strong>{trip.passenger}</strong>
                      </>
                    )}
                </p>
              </section>
              {!completed && !cancelled && (
                <>
                  <section
                    className="driver-trip-route"
                    aria-label="Datos del viaje"
                  >
                    <div className="driver-trip-stop">
                      <MapPin aria-hidden="true" />
                      <div>
                        <h2>Pasas por el pasajero aquí</h2>
                        <p>{pointLabel(trip.origin.text)}</p>
                      </div>
                    </div>
                    <div className="driver-trip-stop driver-trip-destination">
                      <Flag aria-hidden="true" />
                      <div>
                        <h2>Lo llevas a</h2>
                        <p>{pointLabel(trip.destination.text)}</p>
                      </div>
                    </div>
                  </section>
                  <section
                    className="driver-trip-map-section"
                    aria-label="Mapa del viaje"
                  >
                    <MapBoundary>
                      <Suspense
                        fallback={
                          <div className="driver-trip-map-placeholder">
                            Cargando el mapa…
                          </div>
                        }
                      >
                        <DriverTripMap trip={trip} />
                      </Suspense>
                    </MapBoundary>
                    <p>
                      El punto azul es la
                      recogida.{trip.destination.lat !== null
                        ? " El verde es el destino."
                        : ""}
                    </p>
                  </section>
                  {trip.paused && (
                    <div className="driver-trip-warning" role="status">
                      <AlertCircle aria-hidden="true" />
                      <p>
                        La base pausó las acciones de este viaje. Contacta a la
                        base para continuar.
                      </p>
                    </div>
                  )}
                  {trip.arrivedAt && (
                    <div
                      className={`driver-trip-notice ${
                        ["failed", "uncertain"].includes(
                            trip.arrivalNotice ?? "",
                          )
                          ? "driver-trip-warning"
                          : ""
                      }`}
                      role="status"
                    >
                      <CheckCircle2 aria-hidden="true" />
                      <div>
                        <h2>Llegada registrada</h2>
                        <p>{notice(trip)}</p>
                      </div>
                    </div>
                  )}
                </>
              )}
              {completed && (
                <div className="driver-trip-complete">
                  <CheckCircle2 aria-hidden="true" size={56} />
                  <p>Puedes cerrar esta ventana y volver a WhatsApp.</p>
                </div>
              )}
            </>
          )
          : (
            <section className="driver-trip-empty">
              <AlertCircle aria-hidden="true" size={40} />
              <h1>No pudimos abrir el viaje</h1>
              <p>
                Comprueba tu conexión o vuelve a abrir el enlace del mensaje.
              </p>
            </section>
          )}
        {error && (
          <div className="driver-trip-error" role="alert">
            <AlertCircle aria-hidden="true" />
            <p>{error}</p>
          </div>
        )}
        {token && (
          <div className="driver-trip-actions">
            {pending && (
              <button
                className="driver-trip-primary"
                disabled={busy}
                onClick={() => void refresh(pending)}
              >
                {busy ? "Comprobando el cambio…" : "Comprobar el cambio"}
              </button>
            )}
            {trip?.canArrive && !pending && !confirmFinish && (
              <div
                className="driver-trip-arrival-control"
                role="group"
                aria-label="Avisar llegada"
              >
                <p>Cuando estés en el punto, avisa al pasajero.</p>
                <button
                  className="driver-trip-primary"
                  disabled={busy}
                  onClick={() => act("arrive")}
                >
                  <MapPin aria-hidden="true" />
                  {busy ? "Comprobando…" : "Ya llegué"}
                </button>
              </div>
            )}
            {trip?.canFinish && !pending && !confirmFinish && (
              <button
                className={trip.arrivedAt
                  ? "driver-trip-primary"
                  : "driver-trip-secondary"}
                disabled={busy}
                onClick={() => setConfirmFinish(true)}
              >
                Finalizar servicio
              </button>
            )}
            {trip?.canFinish && confirmFinish && !pending && (
              <section
                className="driver-trip-confirm"
                aria-label="Confirmar finalización"
              >
                <h2>¿Ya dejaste al pasajero en su destino?</h2>
                <p>Confirma sólo cuando hayas terminado el servicio.</p>
                <button
                  className="driver-trip-primary"
                  disabled={busy}
                  onClick={() => act("finish")}
                >
                  Sí, finalizar servicio
                </button>
                <button
                  className="driver-trip-secondary"
                  disabled={busy}
                  onClick={() => setConfirmFinish(false)}
                >
                  Seguir con el viaje
                </button>
              </section>
            )}
            {!completed && !cancelled && (
              <button
                className="driver-trip-refresh"
                disabled={busy}
                onClick={() => void refresh()}
              >
                <RefreshCw size={20} aria-hidden="true" />
                {busy ? "Comprobando viaje…" : "Actualizar viaje"}
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
