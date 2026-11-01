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
import { useParams } from "react-router-dom";
import {
  AlertCircle,
  CarFront,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Compass,
  Flag,
  MapPin,
  RefreshCw,
  Signal,
} from "lucide-react";
import {
  fetchPublicTaxiTracking,
  PublicTaxiTrackingError,
} from "../lib/publicTaxiTracking";
import type { PublicTaxiTracking } from "../lib/taxiTrackingContracts";
import {
  pickupText,
  trackingAge,
  trackingFresh,
} from "../lib/taxiTrackingPresentation";
import "./customerTrip.css";
const CustomerTripMap = lazy(() => import("../components/CustomerTripMap"));
class MapBoundary
  extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed
      ? (
        <div className="customer-trip-map-placeholder">
          <p>No pudimos cargar el mapa de tu viaje.</p>
          <button onClick={() => window.location.reload()}>Volver a cargar</button>
        </div>
      )
      : this.props.children;
  }
}
function TrackingView({ token }: { token: string | undefined }) {
  const [snapshot, setSnapshot] = useState<PublicTaxiTracking | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [asOf, setAsOf] = useState(Date.now),
    [follow, setFollow] = useState(true),
    [focus, setFocus] = useState(0),
    [tileError, setTileError] = useState(false),
    [expanded, setExpanded] = useState(false),
    [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const retry = useRef<() => void>(() => {}),
    drag = useCallback(() => setFollow(false), []);
  useEffect(() => {
    if (!token) return;
    let disposed = false,
      inFlight = false,
      terminal = false,
      timer: number | undefined,
      controller: AbortController | null = null;
    const stopTimer = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const poll = async () => {
      if (disposed || document.hidden || inFlight) return;
      inFlight = true;
      controller = new AbortController();
      setBusy(true);
      try {
        const next = await fetchPublicTaxiTracking(token, controller.signal);
        if (disposed) return;
        setSnapshot(next);
        setError(null);
        terminal = ["completado", "cancelado", "cancelado_timeout"].includes(
          next.viaje.estado,
        );
      } catch (caught: unknown) {
        if (!disposed && !controller.signal.aborted) {
          setError(
            caught instanceof PublicTaxiTrackingError
              ? caught.message
              : "No pudimos actualizar el viaje. Volveremos a intentarlo.",
          );
        }
      } finally {
        inFlight = false;
        controller = null;
        if (!disposed) {
          setBusy(false);
          setLoaded(true);
          setAsOf(Date.now());
          if (!document.hidden && !terminal) {
            timer = window.setTimeout(() => void poll(), 5000);
          }
        }
      }
    };
    const visible = () => {
      stopTimer();
      if (document.hidden) controller?.abort();
      else if (!terminal) void poll();
    };
    retry.current = () => {
      stopTimer();
      void poll();
    };
    document.addEventListener("visibilitychange", visible);
    void poll();
    return () => {
      disposed = true;
      stopTimer();
      controller?.abort();
      retry.current = () => {};
      document.removeEventListener("visibilitychange", visible);
    };
  }, [token]);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setMobile(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const trip = snapshot?.viaje,
    taxi = snapshot?.taxi,
    completed = trip?.estado === "completado",
    cancelled = trip?.estado === "cancelado" ||
      trip?.estado === "cancelado_timeout",
    terminal = completed || cancelled;
  const fresh = Boolean(taxi && !error && trackingFresh(taxi.lastUpdate, asOf)),
    mapHidden = mobile && expanded;
  const title = completed
    ? "¡Gracias por viajar con nosotros!"
    : cancelled
    ? "Este viaje terminó"
    : trip?.estado === "buscando_conductor"
    ? "Estamos buscando tu taxi"
    : "Tu taxi va por ti";
  useEffect(() => {
    document.title = trip
      ? `${title} · Stellar`
      : "Seguimiento de tu viaje · Stellar";
  }, [title, trip]);
  return (
    <main className="customer-trip-page" data-expanded={expanded}>
      <header className="customer-trip-header">
        <span>
          <CarFront aria-hidden="true" />Stellar
        </span>
        <span>Tu viaje, contigo</span>
      </header>
      {!token || loaded && !snapshot
        ? (
          <section className="customer-trip-empty">
            <AlertCircle aria-hidden="true" size={40} />
            <h1>No pudimos abrir este viaje</h1>
            <p>
              {error ?? "Abre el enlace completo que te enviamos por WhatsApp."}
            </p>
            {token && (
              <button onClick={() => retry.current()} disabled={busy}>
                Volver a intentar
              </button>
            )}
          </section>
        )
        : !snapshot
        ? (
          <section className="customer-trip-empty" role="status">
            <h1>Estamos abriendo tu viaje…</h1>
            <div className="customer-trip-skeleton" />
            <p>En un momento podrás ver tu taxi aquí.</p>
          </section>
        )
        : (
          <>
            <div className="customer-trip-layout">
              <section
                className="customer-trip-map-section"
                aria-label="Seguimiento del taxi"
                aria-hidden={mapHidden}
                inert={mapHidden}
              >
                {!terminal
                  ? (
                    <>
                      <MapBoundary>
                        <Suspense
                          fallback={
                            <div className="customer-trip-map-placeholder">
                              Cargando el mapa de tu viaje…
                            </div>
                          }
                        >
                          <CustomerTripMap
                            snapshot={snapshot}
                            follow={follow}
                            focus={focus}
                            onDrag={drag}
                            onTileError={setTileError}
                          />
                        </Suspense>
                      </MapBoundary>
                      <div className="customer-trip-map-tools">
                        <button
                          onClick={() => {
                            setFollow(true);
                            setFocus((n) => n + 1);
                          }}
                          disabled={!taxi}
                          aria-pressed={follow}
                        >
                          <Compass aria-hidden="true" size={20} />
                          {follow ? "Siguiendo tu taxi" : "Centrar mi taxi"}
                        </button>
                        <button
                          onClick={() => retry.current()}
                          disabled={busy}
                          aria-label="Actualizar ubicación"
                        >
                          <RefreshCw aria-hidden="true" size={20} />
                        </button>
                      </div>
                    </>
                  )
                  : (
                    <div className={'customer-trip-terminal' + (cancelled ? ' is-cancelled' : '')}>
                      {completed ? <CheckCircle2 aria-hidden="true" size={48} /> : <AlertCircle aria-hidden="true" size={48} />}
                      <p>
                        {completed
                          ? "El servicio quedó finalizado."
                          : "Ya no mostramos la ubicación de esta unidad."}
                      </p>
                    </div>
                  )}
                {tileError && !terminal && (
                  <p className="customer-trip-warning" role="status">
                    Algunas calles no se pudieron cargar. Recarga esta página si el mapa sigue vacío.
                  </p>
                )}
              </section>
              <section
                className="customer-trip-details"
                aria-label="Datos de tu viaje"
              >
                <button className="customer-trip-sheet-toggle" aria-expanded={expanded} aria-controls="customer-trip-body" onClick={() => setExpanded(value => !value)}>
                  <span className="customer-trip-sheet-handle" aria-hidden="true" />
                  {expanded ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronUp size={18} aria-hidden="true" />}
                  {expanded ? 'Volver al mapa' : 'Ver detalles del viaje'}
                </button>
                <div className="customer-trip-summary">
                  <h1>{title}</h1>
                  <p className="customer-trip-subtitle">{terminal ? 'Puedes volver a WhatsApp cuando quieras.' : trip?.estado === 'buscando_conductor' ? 'Te avisamos en cuanto una unidad acepte.' : 'Sigue aquí su recorrido hasta donde estás.'}</p>
                <div className="customer-trip-unit">
                  <span className="customer-trip-unit-icon"><CarFront aria-hidden="true" size={24} /></span>
                  <div>
                    <h2>{trip?.unitLabel ?? "Tu taxi"}</h2>
                    {trip?.driverName && <p>Conduce {trip.driverName}</p>}
                  </div>
                </div>
                {!terminal && (
                  <div
                    className={fresh
                      ? "customer-trip-signal"
                      : "customer-trip-signal customer-trip-warning"}
                    role="status"
                  >
                    {fresh
                      ? <Signal aria-hidden="true" />
                      : <Clock3 aria-hidden="true" />}
                    <div>
                      <h2>
                        {fresh
                          ? "Ubicación actualizada"
                          : taxi
                          ? "Esperando una señal más reciente"
                          : "Esperando la ubicación del taxi"}
                      </h2>
                      <p>
                        {taxi
                          ? `Última señal ${
                            trackingAge(taxi.lastUpdate, asOf)
                          }.`
                          : "En cuanto recibamos su GPS, aparecerá en el mapa."}
                      </p>
                    </div>
                  </div>
                )}
                </div>
                <div id="customer-trip-body" className="customer-trip-body" hidden={mobile && !expanded}>
                {error && (
                  <p className="customer-trip-warning" role="status">
                    {error} Mostramos los últimos datos recibidos.
                  </p>
                )}
                <div className="customer-trip-stop">
                  <MapPin aria-hidden="true" />
                  <div>
                    <h2>Pasamos por ti aquí</h2>
                    <p>{pickupText(snapshot.viaje.origen)}</p>
                  </div>
                </div>
                <div className="customer-trip-stop">
                  <Flag aria-hidden="true" />
                  <div>
                    <h2>Y te llevamos a</h2>
                    <p>
                      {snapshot.viaje.destino.trim() ||
                        "Se lo indicas al chofer"}
                    </p>
                  </div>
                </div>
                {!terminal && (
                  <p className="customer-trip-help">
                    El mapa se actualiza automáticamente. Si necesitas ayuda, escríbenos por WhatsApp.
                  </p>
                )}
                </div>
              </section>
            </div>
          </>
        )}
    </main>
  );
}
export default function TrackPage() {
  const { token } = useParams<{ token: string }>();
  return <TrackingView key={token ?? "missing"} token={token} />;
}
