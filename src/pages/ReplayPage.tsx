import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api, type TraccarDevice, type TraccarPosition } from '../lib/traccarApi';
import {
  Play, Pause, SkipBack, SkipForward, Search,
  ChevronLeft, ChevronRight, Clock, Gauge, Navigation
} from 'lucide-react';
import { loadGoogleMaps } from '../lib/mapsLoader';

// ─── helpers ──────────────────────────────────────────────────────────────────
function knotsToKmh(knots: number) { return (knots * 1.852).toFixed(0); }
function speedColor(knots: number): string {
  const kmh = knots * 1.852;
  if (kmh < 20) return '#22c55e';
  if (kmh < 60) return '#3b82f6';
  if (kmh < 90) return '#f59e0b';
  return '#ef4444';
}

export default function ReplayPage() {
  const [devices, setDevices] = useState<TraccarDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | ''>('');
  const [selectedDate, setSelectedDate] = useState(() => {
    // Retorna YYYY-MM-DD local
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  });

  const [positions, setPositions] = useState<TraccarPosition[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mapsLoaded, setMapsLoaded] = useState(false);

  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Cargar dispositivos ───────────────────────────────────────────────────
  useEffect(() => {
    api.getDevices().then(devs => {
      setDevices(devs);
      if (devs.length > 0) setSelectedDeviceId(devs[0].id);
    });
  }, []);

  // ─── Google Maps ───────────────────────────────────────────────────────────
  useEffect(() => {
    loadGoogleMaps().then(() => setMapsLoaded(true)).catch(console.error);
  }, []);

  // Inicializar mapa
  useEffect(() => {
    if (!mapsLoaded || !mapRef.current || googleMapRef.current) return;
    
    const savedMapType = localStorage.getItem('estrella_map_type') || 'roadmap';

    googleMapRef.current = new window.google.maps.Map(mapRef.current, {
      center: { lat: 16.753, lng: -93.115 },
      zoom: 12,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      gestureHandling: 'greedy',
      mapTypeId: savedMapType,
    });
  }, [mapsLoaded]);

  // ─── Timer de reproducción ─────────────────────────────────────────────────
  useEffect(() => {
    if (playing && positions.length > 0) {
      timerRef.current = setInterval(() => {
        setIndex(prev => {
          if (prev >= positions.length - 1) {
            setPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 400);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [playing, positions]);

  // ─── Dibujar posición actual en el mapa ───────────────────────────────────
  useEffect(() => {
    if (!googleMapRef.current || positions.length === 0) return;
    const pos = positions[index];
    const latLng = { lat: pos.latitude, lng: pos.longitude };

    if (markerRef.current) {
      markerRef.current.setPosition(latLng);
      markerRef.current.setIcon({
        path: 'M 12 2 L 22 22 L 12 17 L 2 22 Z',
        fillColor: speedColor(pos.speed || 0),
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2.5,
        scale: 1.4,
        anchor: new window.google.maps.Point(12, 12),
        rotation: pos.course || 0,
      });
    } else {
      markerRef.current = new window.google.maps.Marker({
        position: latLng,
        map: googleMapRef.current,
        icon: {
          path: 'M 12 2 L 22 22 L 12 17 L 2 22 Z',
          fillColor: speedColor(pos.speed || 0),
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2.5,
          scale: 1.4,
          anchor: new window.google.maps.Point(12, 12),
          rotation: pos.course || 0,
        },
      });
    }

    googleMapRef.current.panTo(latLng);
  }, [index, positions]);

  // ─── Buscar ruta ──────────────────────────────────────────────────────────
  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!selectedDeviceId) return;
    setLoading(true);
    setPlaying(false);
    setIndex(0);
    if (markerRef.current) { markerRef.current.setMap(null); markerRef.current = null; }
    if (polylineRef.current) { polylineRef.current.setMap(null); polylineRef.current = null; }

    try {
      const from = new Date(`${selectedDate}T00:00:00`).toISOString();
      const to = new Date(`${selectedDate}T23:59:59`).toISOString();
      const params = {
        deviceIds: [Number(selectedDeviceId)],
        from,
        to,
      };
      const data = await api.getRoute(params);
      setPositions(data);

      if (googleMapRef.current && data.length > 0) {
        const path = data.map(p => ({ lat: p.latitude, lng: p.longitude }));

        // Trazar línea de ruta coloreada por velocidad
        polylineRef.current = new window.google.maps.Polyline({
          path,
          strokeColor: '#3b82f6',
          strokeOpacity: 0.5,
          strokeWeight: 3,
          map: googleMapRef.current,
        });

        const bounds = new window.google.maps.LatLngBounds();
        path.forEach(p => bounds.extend(p));
        googleMapRef.current.fitBounds(bounds);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const pos = positions[index];
  const progress = positions.length > 0 ? (index / (positions.length - 1)) * 100 : 0;

  return (
    <div className="flex flex-col flex-1 h-full gap-3 lg:gap-4">
      {/* Controles superiores (Filtros) */}
      <div className="bg-white rounded-xl lg:rounded-2xl border border-gray-100 shadow-sm shrink-0 p-3 lg:p-4">
        <form onSubmit={handleSearch} className="flex flex-col lg:flex-row items-end gap-3 lg:gap-4">
          <div className="grid grid-cols-2 gap-3 w-full lg:flex lg:flex-1 lg:gap-4">
            <div className="w-full">
              <label className="block text-[11px] lg:text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Taxi</label>
              <select
                value={selectedDeviceId}
                onChange={e => setSelectedDeviceId(Number(e.target.value))}
                className="w-full border border-gray-200 rounded-lg lg:rounded-xl px-3 py-2 lg:py-2.5 text-xs lg:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 font-medium text-gray-700"
              >
                {devices.map(d => <option key={d.id} value={d.id}>{d.name} ({d.uniqueId})</option>)}
              </select>
            </div>
            <div className="w-full">
              <label className="block text-[11px] lg:text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Día</label>
              <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
                className="w-full border border-gray-200 rounded-lg lg:rounded-xl px-2 lg:px-3 py-2 lg:py-2.5 text-xs lg:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 font-medium text-gray-700" />
            </div>
          </div>
          <button type="submit" disabled={loading || !selectedDeviceId}
            className="w-full lg:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg lg:rounded-xl text-sm font-bold transition flex items-center justify-center gap-2 lg:h-[42px] shadow-sm shadow-blue-600/20 active:scale-[0.98]">
            {loading ? <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" /> : <Search size={16} />}
            {loading ? 'Cargando...' : 'Cargar Ruta'}
          </button>
        </form>
      </div>

      {/* Mapa y Controles de Reproducción */}
      <div className="flex-1 bg-white rounded-xl lg:rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col min-h-[300px]">
        <div className="flex-1 relative">
          {!mapsLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10 text-gray-400 text-sm font-medium">Cargando mapa...</div>
          )}
          <div ref={mapRef} className="w-full h-full" />
        </div>

        {/* Panel de controles de reproducción */}
        {positions.length > 0 && (
          <div className="border-t border-gray-100 bg-white px-3 lg:px-5 pt-3 pb-3 lg:pb-4 shrink-0">
            {/* Info de posición actual */}
            {pos && (
              <div className="flex flex-wrap items-center justify-between lg:justify-start gap-x-4 gap-y-2 mb-3">
                <div className="flex items-center gap-1.5 bg-gray-50 px-2 py-1 rounded-md border border-gray-100">
                  <Clock size={12} className="text-gray-400" />
                  <span className="text-[11px] lg:text-xs font-bold text-gray-700">
                    {new Date(pos.fixTime).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 bg-blue-50/50 px-2 py-1 rounded-md border border-blue-100/50">
                  <Gauge size={12} className="text-blue-500" />
                  <span className="text-[11px] lg:text-xs font-black text-blue-600">{knotsToKmh(pos.speed || 0)} km/h</span>
                </div>
                <div className="flex items-center gap-1.5 bg-gray-50 px-2 py-1 rounded-md border border-gray-100">
                  <Navigation size={12} className="text-gray-400" />
                  <span className="text-[11px] lg:text-xs font-bold text-gray-500">{pos.course?.toFixed(0)}°</span>
                </div>
                <div className="ml-auto text-[10px] lg:text-xs font-bold text-gray-400 bg-gray-50 px-2 py-1 rounded-md">
                  {index + 1} / {positions.length} pts
                </div>
              </div>
            )}

            {/* Slider de posición */}
            <div className="px-1 mb-3">
              <input
                type="range"
                min={0}
                max={positions.length - 1}
                value={index}
                onChange={e => { setPlaying(false); setIndex(Number(e.target.value)); }}
                className="w-full h-2 bg-blue-100 rounded-full appearance-none cursor-pointer accent-blue-600"
              />
            </div>

            {/* Botones de control */}
            <div className="flex items-center justify-center gap-2 lg:gap-4">
              <button onClick={() => { setPlaying(false); setIndex(0); }}
                className="p-2 lg:p-2.5 rounded-xl hover:bg-gray-100 text-gray-500 transition" title="Al inicio">
                <SkipBack size={18} />
              </button>
              <button onClick={() => setIndex(i => Math.max(0, i - 10))} disabled={playing}
                className="p-2 lg:p-2.5 rounded-xl hover:bg-gray-100 text-gray-500 transition disabled:opacity-40" title="Retroceder 10">
                <ChevronLeft size={18} />
              </button>
              
              <button onClick={() => setPlaying(p => !p)} disabled={index >= positions.length - 1 && !playing}
                className="w-12 h-12 lg:w-14 lg:h-14 flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-700 text-white transition-transform active:scale-95 shadow-lg shadow-blue-600/30 disabled:opacity-40 disabled:shadow-none mx-2">
                {playing ? <Pause size={22} className="fill-white" /> : <Play size={22} className="fill-white ml-1" />}
              </button>
              
              <button onClick={() => setIndex(i => Math.min(positions.length - 1, i + 10))} disabled={playing}
                className="p-2 lg:p-2.5 rounded-xl hover:bg-gray-100 text-gray-500 transition disabled:opacity-40" title="Avanzar 10">
                <ChevronRight size={18} />
              </button>
              <button onClick={() => { setPlaying(false); setIndex(positions.length - 1); }}
                className="p-2 lg:p-2.5 rounded-xl hover:bg-gray-100 text-gray-500 transition" title="Al final">
                <SkipForward size={18} />
              </button>
            </div>
          </div>
        )}

        {positions.length === 0 && !loading && (
          <div className="border-t border-gray-100 py-6 lg:py-8 text-center text-gray-400 text-[13px] font-medium shrink-0 bg-gray-50/50">
            Selecciona un taxi y un rango de fechas para reproducir su ruta
          </div>
        )}
      </div>
    </div>
  );
}
