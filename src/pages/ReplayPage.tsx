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
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString().slice(0, 16);
  });
  const [toDate, setToDate] = useState(() => {
    const d = new Date(); d.setHours(23, 59, 59, 0); return d.toISOString().slice(0, 16);
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
      const params = {
        deviceIds: [Number(selectedDeviceId)],
        from: new Date(fromDate).toISOString(),
        to: new Date(toDate).toISOString(),
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
    <div className="flex flex-col h-[calc(100vh-3rem)] gap-4">
      {/* Controles superiores */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm shrink-0 p-4">
        <form onSubmit={handleSearch} className="flex flex-col md:flex-row items-end gap-4">
          <div className="flex-1 w-full">
            <label className="block text-xs font-medium text-gray-600 mb-1">Taxi</label>
            <select
              value={selectedDeviceId}
              onChange={e => setSelectedDeviceId(Number(e.target.value))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
            >
              {devices.map(d => <option key={d.id} value={d.id}>{d.name} ({d.uniqueId})</option>)}
            </select>
          </div>
          <div className="flex-1 w-full">
            <label className="block text-xs font-medium text-gray-600 mb-1">Desde</label>
            <input type="datetime-local" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50" />
          </div>
          <div className="flex-1 w-full">
            <label className="block text-xs font-medium text-gray-600 mb-1">Hasta</label>
            <input type="datetime-local" value={toDate} onChange={e => setToDate(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50" />
          </div>
          <button type="submit" disabled={loading || !selectedDeviceId}
            className="w-full md:w-auto px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition flex items-center justify-center gap-2 h-[42px]">
            {loading ? <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" /> : <Search size={16} />}
            Cargar Ruta
          </button>
        </form>
      </div>

      {/* Mapa */}
      <div className="flex-1 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col min-h-0">
        <div className="flex-1 relative">
          {!mapsLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10 text-gray-400 text-sm">Cargando mapa...</div>
          )}
          <div ref={mapRef} className="w-full h-full" />
        </div>

        {/* Panel de controles de reproducción */}
        {positions.length > 0 && (
          <div className="border-t border-gray-100 bg-white px-4 pt-3 pb-4 shrink-0">
            {/* Info de posición actual */}
            {pos && (
              <div className="flex items-center gap-6 mb-3">
                <div className="flex items-center gap-1.5">
                  <Clock size={13} className="text-gray-400" />
                  <span className="text-xs font-medium text-gray-700">
                    {new Date(pos.fixTime).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Gauge size={13} className="text-blue-500" />
                  <span className="text-xs font-bold text-blue-600">{knotsToKmh(pos.speed || 0)} km/h</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Navigation size={13} className="text-gray-400" />
                  <span className="text-xs text-gray-500">{pos.course?.toFixed(0)}°</span>
                </div>
                <span className="ml-auto text-xs text-gray-400">
                  {index + 1} / {positions.length} puntos
                </span>
              </div>
            )}

            {/* Slider de posición */}
            <input
              type="range"
              min={0}
              max={positions.length - 1}
              value={index}
              onChange={e => { setPlaying(false); setIndex(Number(e.target.value)); }}
              className="w-full h-2 bg-gray-200 rounded-full appearance-none cursor-pointer accent-blue-600 mb-3"
            />

            {/* Botones de control */}
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => { setPlaying(false); setIndex(0); }}
                className="p-2 rounded-xl hover:bg-gray-100 text-gray-600 transition" title="Al inicio">
                <SkipBack size={18} />
              </button>
              <button onClick={() => setIndex(i => Math.max(0, i - 10))} disabled={playing}
                className="p-2 rounded-xl hover:bg-gray-100 text-gray-600 transition disabled:opacity-40" title="Retroceder 10">
                <ChevronLeft size={18} />
              </button>
              <button onClick={() => setPlaying(p => !p)} disabled={index >= positions.length - 1 && !playing}
                className="p-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white transition shadow-md shadow-blue-200 disabled:opacity-40">
                {playing ? <Pause size={20} /> : <Play size={20} />}
              </button>
              <button onClick={() => setIndex(i => Math.min(positions.length - 1, i + 10))} disabled={playing}
                className="p-2 rounded-xl hover:bg-gray-100 text-gray-600 transition disabled:opacity-40" title="Avanzar 10">
                <ChevronRight size={18} />
              </button>
              <button onClick={() => { setPlaying(false); setIndex(positions.length - 1); }}
                className="p-2 rounded-xl hover:bg-gray-100 text-gray-600 transition" title="Al final">
                <SkipForward size={18} />
              </button>
            </div>
          </div>
        )}

        {positions.length === 0 && !loading && (
          <div className="border-t border-gray-100 py-6 text-center text-gray-400 text-sm shrink-0">
            Selecciona un taxi y un rango de fechas para reproducir su ruta
          </div>
        )}
      </div>
    </div>
  );
}
