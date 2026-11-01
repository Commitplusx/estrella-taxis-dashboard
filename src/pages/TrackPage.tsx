import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react';
import { useParams } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  CarFront,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Compass,
  ExternalLink,
  LoaderCircle,
  MapPin,
  Navigation,
  RefreshCw,
  Signal,
  SignalZero,
} from 'lucide-react';
import { fetchPublicTaxiTracking, PublicTaxiTrackingError } from '../lib/publicTaxiTracking';
import { loadGoogleMaps } from '../lib/mapsLoader';
import type { PublicTaxiTracking, PublicTaxiTripState } from '../lib/taxiTrackingContracts';

declare global {
  interface Window {
    google?: typeof google;
  }
}

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radians = (degrees: number) => degrees * (Math.PI / 180);
  const deltaLat = radians(lat2 - lat1);
  const deltaLng = radians(lng2 - lng1);
  const haversine = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(deltaLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function estimateArrivalMinutes(position: NonNullable<PublicTaxiTracking['taxi']>, trip: PublicTaxiTracking['viaje']): number | null {
  if (trip.origen_lat === null || trip.origen_lng === null) return null;
  const approximateKm = distanceKm(position.lat, position.lng, trip.origen_lat, trip.origen_lng) * 1.4;
  const averageCitySpeed = position.speedKmh !== null && position.speedKmh > 10 ? position.speedKmh : 30;
  return Math.max(1, Math.min(60, Math.ceil((approximateKm / averageCitySpeed) * 60)));
}

function ageLabel(timestamp: string, now: number): string {
  const ageSeconds = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 1000));
  if (ageSeconds < 60) return `hace ${ageSeconds} s`;
  if (ageSeconds < 3600) return `hace ${Math.floor(ageSeconds / 60)} min`;
  return `hace ${Math.floor(ageSeconds / 3600)} h`;
}

function clockLabel(timestamp: number): string {
  return new Intl.DateTimeFormat('es-MX', { hour: 'numeric', minute: '2-digit' }).format(timestamp);
}

function gpsIsFresh(timestamp: string, now: number): boolean {
  const age = now - Date.parse(timestamp);
  return age >= -30_000 && age <= 60_000;
}

function tripStatus(state: PublicTaxiTripState): { title: string; detail: string } {
  if (state === 'buscando_conductor') return { title: 'Buscando unidad', detail: 'Te avisaremos cuando un taxi acepte el viaje.' };
  if (state === 'completado') return { title: 'Viaje completado', detail: 'Gracias por viajar con nosotros.' };
  if (state === 'cancelado') return { title: 'Viaje cancelado', detail: 'Este seguimiento ya no muestra ubicaciones.' };
  if (state === 'cancelado_timeout') return { title: 'Solicitud cerrada', detail: 'No se encontró una unidad disponible.' };
  return { title: 'Tu taxi va en camino', detail: 'El mapa busca la posición más reciente de tu unidad.' };
}

function TrackingView({ token }: { token: string | undefined }) {
  const [snapshot, setSnapshot] = useState<PublicTaxiTracking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResponseAt, setLastResponseAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [followTaxi, setFollowTaxi] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const taxiMarkerRef = useRef<google.maps.Marker | null>(null);
  const pickupMarkerRef = useRef<google.maps.Marker | null>(null);
  const hasFitBoundsRef = useRef(false);
  const followTaxiRef = useRef(true);
  const touchStartYRef = useRef<number | null>(null);
  const retryRef = useRef<() => void>(() => undefined);
  const hasSnapshotRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let dragListener: google.maps.MapsEventListener | null = null;
    const initialize = () => {
      if (disposed) return;
      const maps = window.google?.maps;
      if (!maps || !mapRef.current || mapInstanceRef.current) return;
      const map = new maps.Map(mapRef.current, {
        center: { lat: 16.25, lng: -92.13 },
        zoom: 15,
        mapTypeId: 'roadmap',
        disableDefaultUI: true,
        zoomControl: false,
        clickableIcons: false,
        styles: [
          { featureType: 'poi', stylers: [{ visibility: 'off' }] },
          { featureType: 'transit', stylers: [{ visibility: 'off' }] },
        ],
      });
      mapInstanceRef.current = map;
      dragListener = map.addListener('dragstart', () => {
        followTaxiRef.current = false;
        setFollowTaxi(false);
      });
      setMapReady(true);
      setMapError(null);
    };

    void loadGoogleMaps().then(initialize).catch(() => {
      if (!disposed) setMapError('No pudimos cargar el mapa. La ubicación sigue disponible en el enlace de Google Maps.');
    });

    return () => {
      disposed = true;
      dragListener?.remove();
      taxiMarkerRef.current?.setMap(null);
      pickupMarkerRef.current?.setMap(null);
      taxiMarkerRef.current = null;
      pickupMarkerRef.current = null;
      mapInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapReady || !snapshot || !mapInstanceRef.current || !window.google?.maps) return;
    const maps = window.google.maps;
    const map = mapInstanceRef.current;
    const taxi = snapshot.taxi;
    const trip = snapshot.viaje;

    if (trip.origen_lat !== null && trip.origen_lng !== null && !pickupMarkerRef.current) {
      pickupMarkerRef.current = new maps.Marker({
        position: { lat: trip.origen_lat, lng: trip.origen_lng },
        map,
        title: 'Punto de recogida',
        icon: { path: maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#10B981', fillOpacity: 1, strokeColor: '#FFFFFF', strokeWeight: 2 },
      });
    }

    if (taxi) {
      const position = { lat: taxi.lat, lng: taxi.lng };
      const icon: google.maps.Symbol = {
        path: maps.SymbolPath.FORWARD_CLOSED_ARROW,
        scale: 7,
        fillColor: '#2455E8',
        fillOpacity: 1,
        strokeColor: '#FFFFFF',
        strokeWeight: 2,
        rotation: taxi.course ?? 0,
      };
      if (!taxiMarkerRef.current) {
        taxiMarkerRef.current = new maps.Marker({ position, map, title: taxi.name, icon, zIndex: 10 });
      } else {
        taxiMarkerRef.current.setPosition(position);
        taxiMarkerRef.current.setIcon(icon);
      }

      if (followTaxiRef.current) map.panTo(position);
      if (!hasFitBoundsRef.current) {
        if (pickupMarkerRef.current) {
          const bounds = new maps.LatLngBounds();
          bounds.extend(position);
          bounds.extend(pickupMarkerRef.current.getPosition() ?? position);
          map.fitBounds(bounds, { bottom: 260, top: 100, left: 35, right: 35 });
        } else {
          map.setCenter(position);
          map.setZoom(16);
        }
        hasFitBoundsRef.current = true;
      }
    } else if (!hasFitBoundsRef.current && pickupMarkerRef.current) {
      const pickupPosition = pickupMarkerRef.current.getPosition();
      if (pickupPosition) {
        map.setCenter(pickupPosition);
        map.setZoom(16);
        hasFitBoundsRef.current = true;
      }
    }
  }, [mapReady, snapshot]);

  useEffect(() => {
    if (snapshot?.viaje.estado) document.title = `${tripStatus(snapshot.viaje.estado).title} · Seguimiento Stellar`;
    return () => { document.title = 'Stellar Tracking'; };
  }, [snapshot?.viaje.estado]);

  useEffect(() => {
    if (!token) {
      return;
    }

    let disposed = false;
    let inFlight = false;
    let stopPolling = false;
    let timer: number | null = null;
    let activeController: AbortController | null = null;

    const clearTimer = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };

    const schedule = () => {
      if (disposed || document.hidden || stopPolling) return;
      timer = window.setTimeout(() => { void poll(); }, 5000);
    };

    const poll = async () => {
      if (disposed || document.hidden || inFlight) return;
      inFlight = true;
      activeController = new AbortController();
      setRefreshing(true);
      if (!hasSnapshotRef.current) setLoading(true);
      try {
        const next = await fetchPublicTaxiTracking(token, activeController.signal);
        if (disposed) return;
        setSnapshot(next);
        hasSnapshotRef.current = true;
        setLastResponseAt(Date.now());
        setError(null);
        stopPolling = next.viaje.estado === 'completado' || next.viaje.estado === 'cancelado' || next.viaje.estado === 'cancelado_timeout';
      } catch (caught: unknown) {
        if (!disposed && !(caught instanceof DOMException && caught.name === 'AbortError')) {
          setError(caught instanceof PublicTaxiTrackingError ? caught.message : 'No pudimos actualizar el seguimiento. Volveremos a intentar.');
        }
      } finally {
        inFlight = false;
        activeController = null;
        if (!disposed) {
          setLoading(false);
          setRefreshing(false);
          schedule();
        }
      }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        clearTimer();
        activeController?.abort();
      } else if (!stopPolling) {
        clearTimer();
        void poll();
      }
    };

    retryRef.current = () => {
      stopPolling = false;
      clearTimer();
      void poll();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    void poll();
    return () => {
      disposed = true;
      clearTimer();
      activeController?.abort();
      document.removeEventListener('visibilitychange', handleVisibility);
      retryRef.current = () => undefined;
    };
  }, [token]);

  const retry = useCallback(() => retryRef.current(), []);
  const snapshotTrip = snapshot?.viaje ?? null;
  const taxi = snapshot?.taxi ?? null;
  const currentError = token ? error : 'Este enlace no tiene un código de seguimiento.';
  const currentMapError = mapError;
  const status = snapshotTrip ? tripStatus(snapshotTrip.estado) : null;
  const isTerminal = snapshotTrip !== null && ['completado', 'cancelado', 'cancelado_timeout'].includes(snapshotTrip.estado);
  const gpsFresh = taxi !== null && lastResponseAt !== null && gpsIsFresh(taxi.lastUpdate, lastResponseAt);
  const eta = taxi && snapshotTrip && gpsFresh ? estimateArrivalMinutes(taxi, snapshotTrip) : null;
  const lastGpsCheck = taxi && lastResponseAt !== null ? lastResponseAt : taxi ? Date.parse(taxi.lastUpdate) : 0;
  const mapLink = taxi ? `https://maps.google.com/?q=${taxi.lat},${taxi.lng}` : null;
  const pickupLink = snapshotTrip?.origen_lat !== null && snapshotTrip?.origen_lat !== undefined &&
    snapshotTrip.origen_lng !== null && snapshotTrip.origen_lng !== undefined
    ? `https://maps.google.com/?q=${snapshotTrip.origen_lat},${snapshotTrip.origen_lng}` : null;

  const enableFollow = () => {
    followTaxiRef.current = true;
    setFollowTaxi(true);
    if (taxi && mapInstanceRef.current) mapInstanceRef.current.panTo({ lat: taxi.lat, lng: taxi.lng });
  };

  const handleTouchStart = (event: TouchEvent<HTMLButtonElement>) => {
    touchStartYRef.current = event.touches[0]?.clientY ?? null;
  };

  const handleTouchEnd = (event: TouchEvent<HTMLButtonElement>) => {
    if (touchStartYRef.current === null) return;
    const delta = event.changedTouches[0].clientY - touchStartYRef.current;
    if (delta > 40) setExpanded(false);
    if (delta < -40) setExpanded(true);
    touchStartYRef.current = null;
  };

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-slate-100 font-sans text-slate-900">
      <div className="absolute inset-0 z-0" aria-label="Mapa en vivo de tu taxi">
        <div ref={mapRef} className="h-full w-full" />
      </div>

      <div className="absolute right-3 top-3 z-10 flex max-w-[calc(100%-24px)] items-center gap-2 sm:right-5 sm:top-5">
        {taxi && (
          <button
            type="button"
            onClick={enableFollow}
            aria-pressed={followTaxi}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white bg-white/95 px-4 text-sm font-semibold shadow-lg shadow-slate-900/10 transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <Compass size={17} className={followTaxi ? 'text-blue-600' : 'text-slate-500'} />
            <span>{followTaxi ? 'Siguiendo taxi' : 'Seguir taxi'}</span>
          </button>
        )}
        <div className="flex min-h-12 items-center gap-3 rounded-full border border-white bg-white/95 px-3.5 shadow-lg shadow-slate-900/10 sm:px-4">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${gpsFresh ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
            <CarFront size={19} />
          </span>
          <span className="min-w-0">
            <span className="block max-w-40 truncate text-sm font-bold sm:max-w-56">{taxi?.name ?? 'Seguimiento de viaje'}</span>
            <span className="block text-xs font-medium text-slate-500">
              {gpsFresh ? 'Ubicación actualizada' : taxi ? 'Última ubicación conocida' : status?.title ?? 'Conectando con el viaje'}
            </span>
          </span>
          {taxi && (
            <span className="border-l border-slate-200 pl-3 text-right text-[11px] leading-tight text-slate-500">
              {ageLabel(taxi.lastUpdate, lastGpsCheck)}
            </span>
          )}
        </div>
      </div>

      {currentMapError && (
        <div role="status" className="absolute left-3 top-[76px] z-10 flex max-w-[min(460px,calc(100%-24px))] items-center gap-2 rounded-xl bg-white/95 px-3.5 py-2.5 text-sm text-slate-700 shadow-lg sm:left-5 sm:top-[84px]">
          <AlertCircle size={17} className="shrink-0 text-amber-600" />
          <span>{currentMapError}</span>
          {mapLink && <a className="shrink-0 font-semibold text-blue-700 underline underline-offset-2" href={mapLink} target="_blank" rel="noreferrer">Abrir mapa</a>}
        </div>
      )}

      <section
        aria-label="Estado y ruta del viaje"
        className={`absolute bottom-0 left-0 z-20 w-full transition-[height] duration-300 ease-out md:bottom-auto md:left-5 md:top-5 md:w-[min(410px,calc(100%-40px))] ${expanded ? 'h-[82dvh]' : 'h-auto max-h-[49dvh]'} md:h-auto md:max-h-[calc(100dvh-40px)]`}
      >
        <div className="flex max-h-full flex-col overflow-hidden rounded-t-[26px] border border-b-0 border-slate-200 bg-white shadow-[0_-10px_45px_rgba(15,23,42,0.18)] md:rounded-[24px] md:border-b md:shadow-[0_16px_56px_rgba(15,23,42,0.16)]">
          <button
            type="button"
            className="flex min-h-10 w-full items-center justify-center text-slate-400 md:hidden"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onClick={() => setExpanded(current => !current)}
            aria-label={expanded ? 'Contraer información del viaje' : 'Ampliar información del viaje'}
            aria-expanded={expanded}
          >
            <span className="h-1 w-10 rounded-full bg-slate-300" />
            {expanded ? <ChevronDown className="ml-2" size={19} /> : <ChevronUp className="ml-2" size={19} />}
          </button>

          <div className="overflow-y-auto px-5 pb-5 pt-1 sm:px-6 md:px-6 md:pb-6 md:pt-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-xl font-bold tracking-[-0.02em] sm:text-2xl">{status?.title ?? 'Cargando tu viaje'}</h1>
                <p className="mt-1 text-sm leading-5 text-slate-600">{status?.detail ?? 'Estamos conectando con el servidor de seguimiento.'}</p>
              </div>
              <button
                type="button"
                onClick={retry}
                disabled={refreshing}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                aria-label="Actualizar ubicación"
              >
                <RefreshCw size={17} className={refreshing ? 'animate-spin' : ''} />
              </button>
            </div>

            {currentError && (
              <div role="status" aria-live="polite" className="mb-4 flex items-start gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-5 text-amber-900">
                <AlertCircle size={18} className="mt-0.5 shrink-0 text-amber-700" />
                <span className="min-w-0 flex-1">{currentError}</span>
                <button type="button" onClick={retry} className="shrink-0 font-semibold underline underline-offset-2">Reintentar</button>
              </div>
            )}

            {loading && token && !snapshot && (
              <div className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-600" role="status" aria-live="polite">
                <LoaderCircle size={19} className="animate-spin text-blue-600" />
                <span>Conectando con el seguimiento…</span>
              </div>
            )}

            {snapshotTrip && !isTerminal && (
              <div className="mb-4 rounded-2xl bg-slate-50 p-4">
                {eta !== null ? (
                  <div className="flex items-end gap-2">
                    <span className="text-5xl font-bold leading-none tracking-[-0.04em] tabular-nums">~{eta}</span>
                    <span className="pb-1 text-base font-semibold text-slate-500">min</span>
                    <span className="ml-auto max-w-32 text-right text-xs leading-4 text-slate-500">estimado al punto de recogida</span>
                  </div>
                ) : snapshotTrip.estado === 'en_camino' ? (
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    {taxi ? <SignalZero size={18} className="text-amber-600" /> : <LoaderCircle size={18} className="animate-spin text-blue-600" />}
                    <span>{taxi ? 'El GPS no tiene un punto de recogida para calcular la llegada.' : 'Esperando la primera ubicación GPS de la unidad…'}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <Clock3 size={18} className="text-blue-600" />
                    <span>Te avisaremos cuando alguna unidad acepte.</span>
                  </div>
                )}
                <p className="mt-2 text-xs text-slate-500">El tiempo es aproximado; el mapa se actualiza cada 5 segundos.</p>
              </div>
            )}

            {isTerminal && snapshotTrip && (
              <div className={`mb-4 flex items-start gap-3 rounded-2xl p-4 ${snapshotTrip.estado === 'completado' ? 'bg-emerald-50 text-emerald-900' : 'bg-slate-100 text-slate-700'}`}>
                {snapshotTrip.estado === 'completado' ? <CheckCircle2 size={21} className="mt-0.5 shrink-0 text-emerald-700" /> : <AlertCircle size={20} className="mt-0.5 shrink-0" />}
                <p className="text-sm font-medium leading-5">{status?.detail}</p>
              </div>
            )}

            {snapshotTrip && (
              <div className="space-y-4">
                <div className="flex gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><MapPin size={17} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Punto de recogida</div>
                    <div className="mt-0.5 break-words text-sm font-semibold leading-5 text-slate-900">{snapshotTrip.origen}</div>
                    {pickupLink && <a className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-blue-700 underline underline-offset-2" href={pickupLink} target="_blank" rel="noreferrer">Ver punto en Maps <ExternalLink size={14} /></a>}
                  </div>
                </div>

                <div className="flex gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700"><Navigation size={17} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Destino</div>
                    <div className="mt-0.5 break-words text-sm font-semibold leading-5 text-slate-900">{snapshotTrip.destino.trim() || 'Se lo indicas al conductor'}</div>
                  </div>
                </div>
              </div>
            )}

            {taxi && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${gpsFresh ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {gpsFresh ? <Signal size={17} /> : <SignalZero size={17} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-800">{gpsFresh ? 'GPS actualizado' : 'Último punto GPS'}</span>
                    <span className="block text-xs text-slate-500">{ageLabel(taxi.lastUpdate, lastGpsCheck)}</span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {taxi.speedKmh !== null && gpsFresh && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                      <Activity size={14} />{Math.round(taxi.speedKmh)} km/h
                    </span>
                  )}
                  {mapLink && (
                    <a className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-blue-600 px-3.5 text-xs font-semibold text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2" href={mapLink} target="_blank" rel="noreferrer">
                      <ExternalLink size={14} />Abrir Maps
                    </a>
                  )}
                </div>
              </div>
            )}

            {!taxi && !loading && snapshotTrip?.estado === 'en_camino' && !error && (
              <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4 text-sm text-slate-600" role="status" aria-live="polite">
                <LoaderCircle size={17} className="animate-spin text-blue-600" />
                <span>La unidad aceptó. En cuanto recibamos GPS aparecerá en el mapa.</span>
              </div>
            )}

            {lastResponseAt !== null && !isTerminal && (
              <div className="mt-4 flex items-center gap-1.5 text-[11px] text-slate-400">
                {refreshing ? <LoaderCircle size={13} className="animate-spin" /> : <Clock3 size={13} />}
                <span>{refreshing ? 'Actualizando…' : `Última consulta ${clockLabel(lastResponseAt)}`}</span>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

export default function TrackPage() {
  const { token } = useParams<{ token: string }>();
  return <TrackingView key={token ?? 'missing-token'} token={token} />;
}
