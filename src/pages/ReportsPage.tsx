import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api, type TraccarDevice } from '../lib/traccarApi';
import { loadGoogleMaps } from '../lib/mapsLoader';
import { exportToExcel } from '../lib/exportExcel';
import {
  Calendar, Search, Map as MapIcon, Navigation, Clock,
  Play, Download, ChevronDown, ChevronRight, Car, Layers, BarChart3,
  MapPin, Zap, AlertTriangle, RefreshCw, X, Sparkles, Activity
} from 'lucide-react';
import { supabase } from '../lib/supabase';

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface Trip {
  deviceId: number; deviceName?: string;
  startTime: string; endTime: string;
  startAddress?: string; endAddress?: string;
  distance: number; averageSpeed: number; maxSpeed: number;
  duration: number; spentFuel?: number;
}
interface Stop {
  deviceId: number; deviceName?: string;
  startTime: string; endTime: string;
  address?: string; latitude: number; longitude: number;
  duration: number; engineHours?: number;
}
interface ReportEvent {
  id: number; deviceId: number; deviceName?: string;
  type: string; serverTime?: string; eventTime?: string; positionId?: number;
  geofenceId?: number; maintenanceId?: number;
}
interface Summary {
  deviceId: number; deviceName?: string;
  distance: number; averageSpeed: number; maxSpeed: number;
  engineHours: number; spentFuel?: number;
  startOdometer?: number; endOdometer?: number;
}
interface RoutePosition {
  id: number; deviceId: number; latitude: number; longitude: number;
  speed: number; course: number; fixTime: string; attributes?: any;
}

type TabType = 'trips' | 'stops' | 'events' | 'summary' | 'route';

// â”€â”€â”€ Date Presets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getPreset(preset: string): { from: string; to: string } {
  const now = new Date();
  // Formatea como "YYYY-MM-DDTHH:mm" en hora LOCAL (no UTC) para que el input datetime-local
  // lo muestre correctamente y el servidor reciba las horas en el timezone del usuario.
  const pad = (d: Date) => {
    const yyyy = d.getFullYear();
    const MM = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${MM}-${dd}T${hh}:${mm}`;
  };
  switch (preset) {
    case 'today': {
      const s = new Date(now); s.setHours(0, 0, 0, 0);
      const e = new Date(now); e.setHours(23, 59, 59, 0);
      return { from: pad(s), to: pad(e) };
    }
    case 'yesterday': {
      const s = new Date(now); s.setDate(s.getDate() - 1); s.setHours(0, 0, 0, 0);
      const e = new Date(now); e.setDate(e.getDate() - 1); e.setHours(23, 59, 59, 0);
      return { from: pad(s), to: pad(e) };
    }
    case 'week': {
      const s = new Date(now); s.setDate(s.getDate() - 6); s.setHours(0, 0, 0, 0);
      const e = new Date(now); e.setHours(23, 59, 59, 0);
      return { from: pad(s), to: pad(e) };
    }
    case 'month': {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const e = new Date(now); e.setHours(23, 59, 59, 0);
      return { from: pad(s), to: pad(e) };
    }
    default: return { from: '', to: '' };
  }
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const fmtDuration = (ms: number) => {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const fmtDist = (m: number) => `${(m / 1000).toFixed(2)} km`;
const fmtSpeed = (knots: number) => `${(knots * 1.852).toFixed(0)} km/h`;
const fmtTime = (iso: string) => {
  if (!iso) return '';
  let d = new Date(iso);
  let forceParsed = false;

  // Si no trae info de zona horaria (y no es timezone negativo -06:00)
  if (!iso.endsWith('Z') && !iso.includes('+') && iso.indexOf('-', 11) === -1) {
    d = new Date(iso + 'Z');
    forceParsed = true;
  } else if (iso.includes('+00:00') || iso.endsWith('+0000')) {
    d = new Date(iso.substring(0, 19) + 'Z');
    forceParsed = true;
  }

  const result = d.toLocaleString('es-MX', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Mexico_City'
  });
  return result;
};

const EVENT_LABELS: Record<string, { label: string; color: string }> = {
  deviceOnline: { label: 'GPS Conectado', color: 'text-green-600 bg-green-50' },
  deviceOffline: { label: 'GPS Desconectado', color: 'text-gray-600 bg-gray-50' },
  deviceMoving: { label: 'En movimiento', color: 'text-blue-600 bg-blue-50' },
  deviceStopped: { label: 'Detenido', color: 'text-orange-600 bg-orange-50' },
  deviceOverspeed: { label: 'Exceso velocidad', color: 'text-red-600 bg-red-50' },
  geofenceEnter: { label: 'Entrada geocerca', color: 'text-purple-600 bg-purple-50' },
  geofenceExit: { label: 'Salida geocerca', color: 'text-purple-600 bg-purple-50' },
  alarm: { label: 'Alarma', color: 'text-yellow-600 bg-yellow-50' },
  ignitionOn: { label: 'Encendido ON', color: 'text-emerald-600 bg-emerald-50' },
  ignitionOff: { label: 'Encendido OFF', color: 'text-slate-600 bg-slate-50' },
};

// â”€â”€â”€ Filters Bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function FiltersBar({
  devices, groups, selectedDevices, setSelectedDevices,
  selectedGroups, setSelectedGroups, from, setFrom, to, setTo,
  onSearch, loading, activeTab
}: any) {
  const [showDevicePicker, setShowDevicePicker] = useState(false);
  const [deviceSearch, setDeviceSearch] = useState('');

  const filteredDevices = devices.filter((d: TraccarDevice) =>
    d.name.toLowerCase().includes(deviceSearch.toLowerCase())
  );
  const toggleDevice = (id: number) => {
    setSelectedDevices((prev: number[]) =>
      prev.includes(id) ? prev.filter((x: number) => x !== id) : [...prev, id]
    );
  };
  const selectAll = () => setSelectedDevices(devices.map((d: TraccarDevice) => d.id));
  const clearAll = () => setSelectedDevices([]);

  const selectedNames = selectedDevices
    .map((id: number) => devices.find((d: TraccarDevice) => d.id === id)?.name)
    .filter(Boolean);

  const [activePreset, setActivePreset] = useState('today');

  return (
    <div className="bg-white sm:rounded-3xl border-y sm:border border-gray-100 shadow-sm p-4 sm:p-5 flex flex-col gap-4 sm:gap-5 mx-[-16px] sm:mx-0">

      {/* Scrollable Pills sin etiqueta Período */}
      <div className="flex overflow-x-auto scrollbar-hide pb-1 gap-2">
        {[
          { key: 'today', label: 'Hoy' },
          { key: 'yesterday', label: 'Ayer' },
          { key: 'week', label: '7 días' },
          { key: 'month', label: 'Este mes' },
          { key: 'custom', label: 'Personalizado' },
        ].map(p => (
          <button key={p.key}
            onClick={() => {
              setActivePreset(p.key);
              if (p.key !== 'custom') {
                const r = getPreset(p.key);
                setFrom(r.from);
                setTo(r.to);
              }
            }}
            className={`shrink-0 px-5 py-2 text-[13px] font-bold rounded-full transition-all duration-300 ${activePreset === p.key
              ? 'bg-gray-900 text-white shadow-md shadow-gray-900/20'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
            {p.label}
          </button>
        ))}
      </div>

      <div className={`grid grid-cols-1 ${activePreset === 'custom' ? 'sm:grid-cols-2 lg:grid-cols-4' : 'lg:grid-cols-2'} gap-3 items-end`}>
        {/* Selector de dispositivos */}
        <div className="relative lg:col-span-2">
          <button onClick={() => setShowDevicePicker(!showDevicePicker)}
            className={`w-full flex items-center justify-between gap-3 border rounded-2xl px-4 py-3 text-sm transition-all focus:outline-none ${showDevicePicker ? 'bg-white border-blue-400 ring-4 ring-blue-50' : 'bg-gray-50/50 border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}>
            <div className="flex items-center gap-2 min-w-0">
              <Car size={16} className={showDevicePicker ? 'text-blue-500' : 'text-gray-400'} />
              <span className="truncate font-semibold text-gray-800">
                {selectedDevices.length === 0 ? 'Seleccionar Taxis...' :
                  selectedDevices.length === devices.length ? 'Todos los taxis' :
                    selectedDevices.length <= 2 ? selectedNames.join(', ') :
                      `${selectedDevices.length} taxis seleccionados`}
              </span>
            </div>
            <ChevronDown size={16} className={`text-gray-400 shrink-0 transition-transform duration-300 ${showDevicePicker ? 'rotate-180' : ''}`} />
          </button>

          {showDevicePicker && (
            <div className="absolute top-full left-0 right-0 z-50 mt-2 bg-white border border-gray-100 rounded-2xl shadow-2xl overflow-hidden">
              {/* Search */}
              <div className="p-3 border-b border-gray-100 flex gap-2 items-center bg-gray-50/70">
                <Search size={14} className="text-gray-400 shrink-0" />
                <input value={deviceSearch} onChange={e => setDeviceSearch(e.target.value)} readOnly={false}
                  placeholder="Buscar taxi por nombre..." className="flex-1 text-sm outline-none bg-transparent" />
                <div className="flex items-center gap-1">
                  <button onClick={selectAll} className="text-[11px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-lg transition">Todos</button>
                  <button onClick={clearAll} className="text-[11px] font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-lg transition">Limpiar</button>
                  <button onClick={() => setShowDevicePicker(false)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                    <X size={13} className="text-gray-400" />
                  </button>
                </div>
              </div>
              {/* Device grid */}
              <div className="max-h-56 overflow-y-auto p-2.5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {filteredDevices.map((d: TraccarDevice) => {
                  const isSelected = selectedDevices.includes(d.id);
                  return (
                    <button key={d.id} onClick={() => toggleDevice(d.id)}
                      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border-2 text-left transition-all ${isSelected
                        ? 'bg-blue-50 border-blue-400 text-blue-700'
                        : 'bg-white border-gray-100 text-gray-700 hover:border-gray-300 hover:bg-gray-50'}`}>
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isSelected ? 'bg-blue-500' : 'bg-gray-100'}`}>
                        {isSelected
                          ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" /></svg>
                          : <Car size={12} className="text-gray-500" />}
                      </div>
                      <span className="text-xs font-semibold truncate">{d.name}</span>
                    </button>
                  );
                })}
              </div>
              {/* Footer */}
              <div className="px-3 py-2.5 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between">
                <span className="text-xs text-gray-500">{selectedDevices.length} de {devices.length} seleccionados</span>
                <button onClick={() => setShowDevicePicker(false)}
                  className="px-4 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700 transition shadow-sm">
                  Aplicar
                </button>
              </div>
            </div>
          )}
        </div>

        {activePreset === 'custom' && (
          <>
            {/* Fecha desde */}
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Desde</label>
              <input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50" />
            </div>

            {/* Fecha hasta */}
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Hasta</label>
              <input type="datetime-local" value={to} onChange={e => setTo(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50" />
            </div>
          </>
        )}
      </div>

      <div className="flex justify-end mt-1 sm:mt-2">
        <button onClick={onSearch} disabled={loading || selectedDevices.length === 0}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white rounded-2xl text-[15px] font-bold transition-all shadow-lg shadow-blue-600/30 disabled:opacity-50 disabled:active:scale-100 disabled:shadow-none">
          {loading ? <RefreshCw size={18} className="animate-spin" /> : <Search size={18} />}
          Generar Reporte
        </button>
      </div>
    </div>
  );
}

function AddressCell({ stop, mapsLoaded }: { stop: Stop, mapsLoaded: boolean }) {
  const [address, setAddress] = useState(stop.address);
  const [loading, setLoading] = useState(false);
  const cellRef = useRef<HTMLDivElement>(null);

  const fetchAddress = async () => {
    if (!mapsLoaded || !window.google || address || loading) return;
    setLoading(true);
    try {
      const geocoder = new window.google.maps.Geocoder();
      const response = await geocoder.geocode({ location: { lat: Number(stop.latitude), lng: Number(stop.longitude) } });
      if (response.results[0]) {
        setAddress(response.results[0].formatted_address);
      } else {
        setAddress('Dirección no encontrada');
      }
    } catch (e) {
      setAddress('Error al obtener dirección');
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!mapsLoaded || address || !cellRef.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        fetchAddress();
        observer.disconnect();
      }
    }, { threshold: 0.1 });

    observer.observe(cellRef.current);
    return () => observer.disconnect();
  }, [mapsLoaded, address]);

  if (address) return <span ref={cellRef as any}>{address}</span>;

  return (
    <div ref={cellRef} className="flex flex-col gap-1.5">
      <a href={`https://maps.google.com/?q=${stop.latitude},${stop.longitude}`} target="_blank" rel="noreferrer"
        title="Ver en Google Maps"
        className="text-blue-600 hover:underline font-mono text-[11px] flex flex-row items-center gap-1 w-max">
        <MapPin size={10} className="text-blue-400" />
        {Number(stop.latitude).toFixed(5)}, {Number(stop.longitude).toFixed(5)}
      </a>
      <span className="text-[10px] text-gray-500 flex items-center gap-1">
        {loading ? <><RefreshCw size={10} className="animate-spin" /> Traduciendo...</> : (mapsLoaded ? 'Desplázate para geocodificar' : 'Esperando mapas...')}
      </span>
    </div>
  );
}

// ——————————————————————————————————————————————————————————————————————————————————————————————————
export default function ReportsPage() {
  const [devices, setDevices] = useState<TraccarDevice[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [selectedDevices, setSelectedDevices] = useState<number[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('trips');
  const [loading, setLoading] = useState(false);
  const [showRightScroll, setShowRightScroll] = useState(true);

  const handleTabScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollLeft, scrollWidth, clientWidth } = e.currentTarget;
    // Ocultar la flecha si estamos a 10px del final
    setShowRightScroll(scrollLeft + clientWidth < scrollWidth - 10);
  };
  const [toastMessage, setToastMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3000);
  };

  const [aiReport, setAiReport] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const today = getPreset('today');
  const [from, setFrom] = useState(today.from);
  const [to, setTo] = useState(today.to);

  // Results
  const [trips, setTrips] = useState<Trip[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [events, setEvents] = useState<ReportEvent[]>([]);
  const [summary, setSummary] = useState<Summary[]>([]);
  const [route, setRoute] = useState<RoutePosition[]>([]);

  // Map for route tab
  const [mapsLoaded, setMapsLoaded] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    api.getDevices().then(devs => {
      setDevices(devs);
      if (devs.length > 0) setSelectedDevices([devs[0].id]);
    });
    fetch('/api/groups', { credentials: 'include' }).then(r => r.json()).then(setGroups).catch(() => { });
    loadGoogleMaps().then(() => setMapsLoaded(true)).catch(console.error);
  }, []);

  useEffect(() => {
    if (!mapsLoaded || !mapRef.current || activeTab !== 'route') return;
    if (googleMapRef.current) return;
    googleMapRef.current = new window.google.maps.Map(mapRef.current, {
      center: { lat: 16.2355, lng: -92.1267 },
      zoom: 15,
      mapId: 'DEMO_MAP_ID', // Requerido para mapas vectoriales (Tilt & Rotación)
      tilt: 45,
      heading: 0,
      mapTypeControl: true, streetViewControl: true, fullscreenControl: true, zoomControl: true,
      rotateControl: true,
      gestureHandling: 'greedy',
    });
    setMapReady(true); // <<< Notifica a React que el mapa ya existe
  }, [mapsLoaded, activeTab]);

  const drawRoute = useCallback((positions: RoutePosition[]) => {
    if (!googleMapRef.current || positions.length < 2) return;
    polylinesRef.current.forEach(p => p.setMap(null));
    polylinesRef.current = [];
    const maxSpeed = Math.max(...positions.map(p => p.speed));
    for (let i = 0; i < positions.length - 1; i++) {
      const ratio = maxSpeed > 0 ? positions[i].speed / maxSpeed : 0;
      const r = Math.round(255 * ratio);
      const g = Math.round(255 * (1 - ratio));
      const color = `rgb(${r},${g},50)`;
      const line = new window.google.maps.Polyline({
        path: [
          { lat: positions[i].latitude, lng: positions[i].longitude },
          { lat: positions[i + 1].latitude, lng: positions[i + 1].longitude },
        ],
        strokeColor: color, strokeWeight: 4, strokeOpacity: 0.85,
        map: googleMapRef.current,
      });
      polylinesRef.current.push(line);
    }
    const bounds = new window.google.maps.LatLngBounds();
    positions.forEach(p => bounds.extend({ lat: p.latitude, lng: p.longitude }));
    googleMapRef.current.fitBounds(bounds);
  }, []);

  useEffect(() => {
    if (route.length > 0 && activeTab === 'route' && googleMapRef.current) {
      drawRoute(route);
    }
  }, [route, activeTab, mapReady, drawRoute]);

  const buildParams = (deviceId: number) => {
    const p = new URLSearchParams();
    p.append('deviceId', String(deviceId));
    // El input datetime-local ("YYYY-MM-DDTHH:mm") no trae timezone.
    // Usamos el constructor de Date con partes explícitas para que JS lo interprete como hora LOCAL
    // y toISOString() nos devuelva el UTC correcto automáticamente.
    const toLocalIso = (localStr: string) => {
      const [datePart, timePart] = localStr.split('T');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hour, minute] = (timePart || '00:00').split(':').map(Number);
      return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
    };
    p.append('from', toLocalIso(from));
    p.append('to', toLocalIso(to));
    return p.toString();
  };

  const deviceNameMap = Object.fromEntries(devices.map(d => [d.id, d.name]));

  const handleSearch = async () => {
    if (selectedDevices.length === 0) {
      showToast('Selecciona al menos un taxi', 'error');
      return;
    }
    setLoading(true);
    let successCount = 0;
    try {
      if (activeTab === 'trips') {
        const results: Trip[] = [];
        for (const devId of selectedDevices) {
          const r = await fetch(`/api/reports/trips?${buildParams(devId)}`, { credentials: 'include', headers: { Accept: 'application/json' } });
          if (r.ok) {
            const data: Trip[] = await r.json();
            results.push(...data.map(t => ({ ...t, deviceName: deviceNameMap[t.deviceId] || String(t.deviceId) })));
            successCount++;
          }
        }
        setTrips(results);
      } else if (activeTab === 'stops') {
        const results: Stop[] = [];
        for (const devId of selectedDevices) {
          const r = await fetch(`/api/reports/stops?${buildParams(devId)}`, { credentials: 'include', headers: { Accept: 'application/json' } });
          if (r.ok) {
            const data: Stop[] = await r.json();
            results.push(...data.map(s => ({ ...s, deviceName: deviceNameMap[s.deviceId] || String(s.deviceId) })));
            successCount++;
          }
        }
        setStops(results);
      } else if (activeTab === 'events') {
        const results: ReportEvent[] = [];
        for (const devId of selectedDevices) {
          const r = await fetch(`/api/reports/events?${buildParams(devId)}&type=allEvents`, { credentials: 'include', headers: { Accept: 'application/json' } });
          if (r.ok) {
            const data: ReportEvent[] = await r.json();
            results.push(...data.map(e => ({ ...e, deviceName: deviceNameMap[e.deviceId] || String(e.deviceId) })));
            successCount++;
          }
        }
        setEvents(results.sort((a, b) => new Date(b.eventTime || b.serverTime || '').getTime() - new Date(a.eventTime || a.serverTime || '').getTime()));
      } else if (activeTab === 'summary') {
        const results: Summary[] = [];
        for (const devId of selectedDevices) {
          const r = await fetch(`/api/reports/summary?${buildParams(devId)}`, { credentials: 'include', headers: { Accept: 'application/json' } });
          if (r.ok) {
            const data: Summary[] = await r.json();
            results.push(...data.map(s => ({ ...s, deviceName: deviceNameMap[s.deviceId] || String(s.deviceId) })));
            if (data.length > 0) successCount++;
          }
        }
        setSummary(results);
      } else if (activeTab === 'route') {
        const devId = selectedDevices[0];
        const r = await fetch(`/api/reports/route?${buildParams(devId)}`, { credentials: 'include', headers: { Accept: 'application/json' } });
        if (r.ok) {
          const data: RoutePosition[] = await r.json();
          setRoute(data);
          if (activeTab === 'route' && googleMapRef.current) drawRoute(data);
          successCount++;
        }
      }

      if (successCount > 0) {
        showToast('Reporte generado exitosamente', 'success');
      } else {
        showToast('No se encontraron datos para este período', 'error');
      }
    } catch (error) {
      console.error(error);
      showToast('Error de conexión al generar reporte', 'error');
    } finally {
      setLoading(false);
    }
  };

  const viewTripRoute = async (trip: Trip) => {
    setActiveTab('route');
    setLoading(true);
    try {
      const p = new URLSearchParams();
      p.append('deviceId', String(trip.deviceId));
      p.append('from', trip.startTime);
      p.append('to', trip.endTime);
      const r = await fetch(`/api/reports/route?${p.toString()}`, { credentials: 'include', headers: { Accept: 'application/json' } });
      if (r.ok) {
        const data: RoutePosition[] = await r.json();
        setRoute(data);
        // El useEffect de route se encargará de dibujar cuando el mapa esté listo
        setTimeout(() => {
          if (googleMapRef.current && data.length > 0) drawRoute(data);
        }, 400);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyzeWithAI = async () => {
    if (summary.length === 0 && events.length === 0) return;
    setAiLoading(true);
    setAiReport(null);
    try {
      const response = await supabase.functions.invoke('ai-insights', {
        body: { summary, events }
      });
      if (response.error) throw response.error;
      setAiReport(response.data?.text || 'No se pudo generar el reporte.');
    } catch (err: any) {
      console.error(err);
      setAiReport(`**Error:** ${err.message || 'Error al conectar con la IA.'}`);
    } finally {
      setAiLoading(false);
    }
  };

  // Excel exports
  const exportTrips = () => exportToExcel(trips.map(t => ({
    'Taxi': t.deviceName, 'Inicio': fmtTime(t.startTime), 'Fin': fmtTime(t.endTime),
    'Dirección Inicio': t.startAddress || '', 'Dirección Fin': t.endAddress || '',
    'Distancia (km)': (t.distance / 1000).toFixed(2),
    'Vel. Promedio': fmtSpeed(t.averageSpeed), 'Vel. Máx': fmtSpeed(t.maxSpeed),
    'Duración': fmtDuration(t.duration),
  })), 'reporte_viajes', 'Viajes');

  const exportStops = () => exportToExcel(stops.map(s => ({
    'Taxi': s.deviceName, 'Inicio': fmtTime(s.startTime), 'Fin': fmtTime(s.endTime),
    'Dirección': s.address || '', 'Duración': fmtDuration(s.duration),
  })), 'reporte_paradas', 'Paradas');

  const exportEvents = () => exportToExcel(events.map(e => ({
    'Taxi': e.deviceName, 'Tipo': EVENT_LABELS[e.type]?.label || e.type, 'Hora': fmtTime(e.eventTime || e.serverTime || ''),
  })), 'reporte_eventos', 'Eventos');

  const exportSummary = () => exportToExcel(summary.map(s => ({
    'Taxi': s.deviceName, 'Distancia (km)': (s.distance / 1000).toFixed(2),
    'Vel. Promedio': fmtSpeed(s.averageSpeed), 'Vel. Máx': fmtSpeed(s.maxSpeed),
    'Horas Motor': (s.engineHours / 3600000).toFixed(1),
  })), 'reporte_resumen', 'Resumen');

  const TABS = [
    { id: 'trips' as TabType, label: 'Viajes', icon: <Navigation size={15} /> },
    { id: 'stops' as TabType, label: 'Paradas', icon: <MapPin size={15} /> },
    { id: 'events' as TabType, label: 'Eventos', icon: <Zap size={15} /> },
    { id: 'summary' as TabType, label: 'Resumen', icon: <BarChart3 size={15} /> },
    { id: 'route' as TabType, label: 'Ruta en Mapa', icon: <MapIcon size={15} /> },
  ];

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 fade-in block space-y-4 pb-32 md:pb-10 relative">
      {/* Toast Notification */}
      {toastMessage && (
        <div className={`fixed bottom-24 md:bottom-auto md:top-6 left-1/2 md:left-auto md:right-6 -translate-x-1/2 md:translate-x-0 z-[60] px-4 py-2.5 rounded-full shadow-lg flex items-center gap-2 animate-in fade-in zoom-in-95 duration-300 border ${toastMessage.type === 'success'
          ? 'bg-white border-green-100 text-green-700 shadow-green-900/10'
          : 'bg-white border-red-100 text-red-700 shadow-red-900/10'
          }`}>
          {toastMessage.type === 'success'
            ? <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center shrink-0"><RefreshCw size={12} className="text-green-600 animate-spin-once" /></div>
            : <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center shrink-0"><AlertTriangle size={12} className="text-red-600" /></div>}
          <span className="font-bold text-[13px] tracking-tight whitespace-nowrap">{toastMessage.text}</span>
        </div>
      )}
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold text-gray-900">Reportes</h1>
        <p className="text-sm text-gray-500 mt-0.5">Viajes, paradas, eventos y resúmenes de tu flotilla</p>
      </div>

      {/* Filters */}
      <FiltersBar
        devices={devices} groups={groups}
        selectedDevices={selectedDevices} setSelectedDevices={setSelectedDevices}
        selectedGroups={selectedGroups} setSelectedGroups={setSelectedGroups}
        from={from} setFrom={setFrom} to={to} setTo={setTo}
        onSearch={handleSearch} loading={loading} activeTab={activeTab}
      />

      {/* Tabs */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col shrink-0 mb-10 overflow-hidden">
        <div className="relative border-b border-gray-100">
          <div className="flex overflow-x-auto scrollbar-hide shrink-0 relative z-0" onScroll={handleTabScroll}>
            {TABS.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3.5 text-sm font-bold whitespace-nowrap border-b-2 transition-colors ${activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}>
                {tab.icon}{tab.label}
              </button>
            ))}
          </div>
          {/* Indicador de scroll flotante en móvil */}
          <div className={`absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-white via-white/80 to-transparent pointer-events-none md:hidden flex justify-end items-center pr-1 z-10 transition-opacity duration-500 ease-in-out ${showRightScroll ? 'opacity-100' : 'opacity-0'}`}>
            <ChevronRight size={16} className="text-gray-400 animate-pulse" />
          </div>
        </div>

        {/* ────────────────────────────────────────────────────────── */}
        {activeTab === 'trips' && (
          <div key={`trips-${trips.length}`} className="flex flex-col animate-slide-up">
            {trips.length > 0 && (
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0 bg-gray-50/50">
                <span className="text-sm font-bold text-gray-700">{trips.length} viaje{trips.length !== 1 ? 's' : ''} encontrado{trips.length !== 1 ? 's' : ''}</span>
                <button onClick={exportTrips}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-green-700 bg-green-50 hover:bg-green-100 rounded-xl transition border border-green-200">
                  <Download size={13} /> Exportar Excel
                </button>
              </div>
            )}
            <div className="w-full">
              {loading && <div className="flex items-center justify-center h-40 text-gray-400 text-sm"><RefreshCw size={20} className="animate-spin mr-2" />Cargando viajes...</div>}
              {!loading && trips.length === 0 && <div className="flex flex-col items-center justify-center h-40 text-gray-400 gap-2"><Navigation size={32} className="opacity-30" /><p className="text-sm">Selecciona un período y genera el reporte</p></div>}
              {!loading && trips.length > 0 && (
                <>
                  {/* Mobile cards */}
                  <div className="md:hidden flex flex-col gap-4 p-4">
                    {trips.map((t, i) => (
                      <div key={i} onClick={() => viewTripRoute(t)} className="bg-white rounded-3xl p-4 shadow-sm border border-gray-100 flex flex-col gap-4 relative overflow-hidden transition-all duration-300 active:scale-[0.98] hover:shadow-md cursor-pointer group">
                        <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-blue-500"></div>

                        <div className="flex items-start justify-between pl-2">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-blue-50 flex items-center justify-center shrink-0">
                              <Car size={18} className="text-blue-600" />
                            </div>
                            <div>
                              <span className="text-[15px] font-bold text-gray-900 block leading-tight">{t.deviceName}</span>
                              <span className="text-[11px] font-medium text-gray-500 flex items-center gap-1 mt-0.5">
                                <Clock size={10} /> {fmtTime(t.startTime)}
                              </span>
                            </div>
                          </div>
                          <div className="flex flex-col items-end">
                            <span className="text-xs font-bold text-blue-700 bg-blue-50 px-3 py-1.5 rounded-full">
                              {fmtDuration(t.duration)}
                            </span>
                            <span className="text-[10px] text-gray-400 font-medium mt-1.5 uppercase tracking-wider">Terminó {fmtTime(t.endTime)}</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 mt-1 pl-2">
                          <div className="flex flex-col items-center justify-center bg-gray-50/80 rounded-2xl p-2.5 border border-gray-100/50">
                            <Navigation size={14} className="text-gray-400 mb-1.5" />
                            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold mb-0.5">Dist.</p>
                            <p className="text-sm font-black text-gray-800">{fmtDist(t.distance)}</p>
                          </div>
                          <div className="flex flex-col items-center justify-center bg-gray-50/80 rounded-2xl p-2.5 border border-gray-100/50">
                            <Activity size={14} className="text-gray-400 mb-1.5" />
                            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold mb-0.5">Prom.</p>
                            <p className="text-sm font-black text-gray-800">{fmtSpeed(t.averageSpeed)}</p>
                          </div>
                          <div className="flex flex-col items-center justify-center bg-red-50/50 rounded-2xl p-2.5 border border-red-100/50">
                            <Zap size={14} className="text-red-400 mb-1.5" />
                            <p className="text-[10px] text-red-500 uppercase tracking-widest font-semibold mb-0.5">Máx.</p>
                            <p className="text-sm font-black text-red-600">{fmtSpeed(t.maxSpeed)}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Desktop table */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                        <tr>{['Taxi', 'Inicio', 'Fin', 'Distancia', 'V. Prom', 'V. Máx', 'Duración'].map(h => (
                          <th key={h} className="px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {trips.map((t, i) => (
                          <tr key={i} onClick={() => viewTripRoute(t)}
                            className="hover:bg-blue-50 transition cursor-pointer group" title="Click para ver ruta en mapa">
                            <td className="px-4 py-3 text-sm font-semibold text-gray-900">{t.deviceName}</td>
                            <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{fmtTime(t.startTime)}</td>
                            <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{fmtTime(t.endTime)}</td>
                            <td className="px-4 py-3 text-sm font-bold text-blue-600">{fmtDist(t.distance)}</td>
                            <td className="px-4 py-3 text-sm text-gray-700">{fmtSpeed(t.averageSpeed)}</td>
                            <td className="px-4 py-3 text-sm font-bold text-red-600">{fmtSpeed(t.maxSpeed)}</td>
                            <td className="px-4 py-3 text-sm text-gray-600">{fmtDuration(t.duration)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ────────────────────────────────────────────────────────── */}
        {activeTab === 'stops' && (
          <div key={`stops-${stops.length}`} className="flex flex-col animate-slide-up">
            {stops.length > 0 && (
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0 bg-gray-50/50">
                <span className="text-sm font-bold text-gray-700">{stops.length} parada{stops.length !== 1 ? 's' : ''}</span>
                <button onClick={exportStops}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-green-700 bg-green-50 hover:bg-green-100 rounded-xl transition border border-green-200">
                  <Download size={13} /> Exportar Excel
                </button>
              </div>
            )}
            <div className="w-full">
              {loading && <div className="flex items-center justify-center h-40 text-gray-400 text-sm"><RefreshCw size={20} className="animate-spin mr-2" />Cargando paradas...</div>}
              {!loading && stops.length === 0 && <div className="flex flex-col items-center justify-center h-40 text-gray-400 gap-2"><MapPin size={32} className="opacity-30" /><p className="text-sm">Selecciona un período y genera el reporte</p></div>}
              {!loading && stops.length > 0 && (
                <>
                  <div className="md:hidden flex flex-col gap-4 p-4">
                    {stops.map((s, i) => (
                      <div key={i} className="bg-white rounded-3xl p-4 shadow-sm border border-gray-100 flex flex-col gap-3 relative overflow-hidden transition-all duration-300">
                        <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-orange-500"></div>

                        <div className="flex items-start justify-between pl-2">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-orange-50 flex items-center justify-center shrink-0">
                              <MapPin size={18} className="text-orange-600" />
                            </div>
                            <div>
                              <span className="text-[15px] font-bold text-gray-900 block leading-tight">{s.deviceName}</span>
                              <span className="text-[11px] font-medium text-gray-500 flex items-center gap-1 mt-0.5">
                                <Clock size={10} /> {fmtTime(s.startTime)}
                              </span>
                            </div>
                          </div>
                          <div className="flex flex-col items-end">
                            <span className="text-xs font-bold text-orange-700 bg-orange-50 px-3 py-1.5 rounded-full flex flex-col items-end">
                              <span className="text-[9px] font-bold text-orange-500 uppercase tracking-widest leading-none mb-0.5">Tiempo Estacionado</span>
                              <span>{fmtDuration(s.duration)}</span>
                            </span>
                            <span className="text-[10px] text-gray-400 font-medium mt-1.5 uppercase tracking-wider">Hasta {fmtTime(s.endTime)}</span>
                          </div>
                        </div>

                        <div className="flex items-start gap-2 bg-gray-50/80 px-3 py-3 rounded-2xl border border-gray-100/50 mt-1 ml-2">
                          <Navigation size={14} className="text-gray-400 mt-0.5 shrink-0" />
                          <div className="text-[13px] text-gray-600 font-medium leading-normal">
                            <AddressCell stop={s} mapsLoaded={mapsLoaded} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                        <tr>{['Taxi', 'Inicio', 'Fin', 'T. Estacionado', 'Dirección'].map(h => (
                          <th key={h} className="px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {stops.map((s, i) => (
                          <tr key={i} className="hover:bg-gray-50 transition">
                            <td className="px-4 py-3 text-sm font-semibold text-gray-900">{s.deviceName}</td>
                            <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{fmtTime(s.startTime)}</td>
                            <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{fmtTime(s.endTime)}</td>
                            <td className="px-4 py-3 text-sm font-bold text-orange-600">{fmtDuration(s.duration)}</td>
                            <td className="px-4 py-3 text-xs text-gray-600">
                              <AddressCell stop={s} mapsLoaded={mapsLoaded} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* â”€â”€ EVENTOS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {activeTab === 'events' && (
          <div key={`events-${events.length}`} className="flex flex-col animate-slide-up">
            {events.length > 0 && (
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0 bg-gray-50/50">
                <span className="text-sm font-bold text-gray-700">{events.length} evento{events.length !== 1 ? 's' : ''}</span>
                <button onClick={exportEvents}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-green-700 bg-green-50 hover:bg-green-100 rounded-xl transition border border-green-200">
                  <Download size={13} /> Exportar Excel
                </button>
              </div>
            )}
            <div className="w-full">
              {loading && <div className="flex items-center justify-center h-40 text-gray-400 text-sm"><RefreshCw size={20} className="animate-spin mr-2" />Cargando eventos...</div>}
              {!loading && events.length === 0 && <div className="flex flex-col items-center justify-center h-40 text-gray-400 gap-2"><Zap size={32} className="opacity-30" /><p className="text-sm">Selecciona un período y genera el reporte</p></div>}
              {!loading && events.length > 0 && (
                <>
                  {/* Mobile Cards (Events) */}
                  <div className="md:hidden flex flex-col gap-4 p-4">
                    {events.map((ev, i) => {
                      const meta = EVENT_LABELS[ev.type] || { label: ev.type, color: 'text-gray-600 bg-gray-50' };
                      const isOffline = ev.type === 'deviceOffline';
                      const isOnline = ev.type === 'deviceOnline';
                      return (
                        <div key={i} className="bg-white rounded-3xl p-4 shadow-sm border border-gray-100 flex gap-4 relative overflow-hidden items-center">
                          <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${isOffline ? 'bg-red-500' : isOnline ? 'bg-green-500' : 'bg-blue-500'}`}></div>

                          <div className={`w-12 h-12 shrink-0 rounded-2xl flex items-center justify-center shadow-sm ml-1 ${isOffline ? 'bg-red-50 text-red-500 border border-red-100' :
                            isOnline ? 'bg-green-50 text-green-500 border border-green-100' :
                              'bg-blue-50 text-blue-500 border border-blue-100'
                            }`}>
                            {isOffline ? <Zap size={20} /> :
                              isOnline ? <Car size={20} /> :
                                <AlertTriangle size={20} />}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[15px] font-bold text-gray-900 truncate pr-2 leading-tight">{ev.deviceName}</span>
                              <div className="flex flex-col items-end shrink-0">
                                <span className="text-[10px] font-bold text-gray-400 whitespace-nowrap bg-gray-50 px-2 py-1 rounded-md flex items-center gap-1 border border-gray-100">
                                  <Clock size={10} className="text-gray-400" />
                                  {fmtTime(ev.eventTime || ev.serverTime || '')}
                                </span>
                              </div>
                            </div>
                            <span className={`inline-block text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${meta.color}`}>
                              {meta.label}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Desktop Table (Events) */}
                  <div className="hidden md:block divide-y divide-gray-100">
                    {events.map((ev, i) => {
                      const meta = EVENT_LABELS[ev.type] || { label: ev.type, color: 'text-gray-600 bg-gray-50' };
                      return (
                        <div key={i} className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition">
                          <span className={`text-[11px] font-bold px-2 py-1 rounded-lg whitespace-nowrap ${meta.color}`}>{meta.label}</span>
                          <span className="text-sm font-semibold text-gray-800 flex-1">{ev.deviceName}</span>
                          <span className="text-xs text-gray-400 whitespace-nowrap">{fmtTime(ev.eventTime || ev.serverTime || '')}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* â”€â”€ RESUMEN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {activeTab === 'summary' && (
          <div className="flex flex-col">
            {summary.length > 0 && (
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0 bg-gray-50/50">
                <span className="text-sm font-bold text-gray-700">{summary.length} unidad{summary.length !== 1 ? 'es' : ''}</span>
                <div className="flex gap-2">
                  <button onClick={handleAnalyzeWithAI} disabled={aiLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition border border-indigo-700 disabled:opacity-50">
                    {aiLoading ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
                    {aiLoading ? 'Analizando...' : 'Auditar con IA'}
                  </button>
                  <button onClick={exportSummary}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-green-700 bg-green-50 hover:bg-green-100 rounded-xl transition border border-green-200">
                    <Download size={13} /> Exportar Excel
                  </button>
                </div>
              </div>
            )}
            <div className="w-full p-4">
              {aiReport && (
                <div className="mb-6 bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100 rounded-2xl p-5 shadow-sm relative">
                  <button onClick={() => setAiReport(null)} className="absolute top-3 right-3 text-indigo-300 hover:text-indigo-600 transition">
                    <X size={16} />
                  </button>
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles size={18} className="text-indigo-600" />
                    <h3 className="font-bold text-indigo-900">Auditoría de IA</h3>
                  </div>
                  <div className="text-sm text-indigo-900/80 space-y-3 leading-relaxed">
                    {aiReport.split('\n').map((para, i) => para.trim() ? (
                      <p key={i} dangerouslySetInnerHTML={{ __html: para.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                    ) : <div key={i} className="h-1" />)}
                  </div>
                </div>
              )}
              {loading && <div className="flex items-center justify-center h-40 text-gray-400 text-sm"><RefreshCw size={20} className="animate-spin mr-2" />Cargando resumen...</div>}
              {!loading && summary.length === 0 && <div className="flex flex-col items-center justify-center h-40 text-gray-400 gap-2"><BarChart3 size={32} className="opacity-30" /><p className="text-sm">Selecciona un período y genera el reporte</p></div>}
              {!loading && summary.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {summary.map((s, i) => (
                    <div key={i} className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                          <Car size={18} className="text-blue-600" />
                        </div>
                        <h3 className="font-bold text-gray-900">{s.deviceName}</h3>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-blue-50 rounded-xl p-3 text-center">
                          <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wide">Distancia</p>
                          <p className="text-xl font-bold text-blue-700 mt-1">{fmtDist(s.distance)}</p>
                        </div>
                        <div className="bg-green-50 rounded-xl p-3 text-center">
                          <p className="text-[10px] font-bold text-green-600 uppercase tracking-wide">V. Promedio</p>
                          <p className="text-xl font-bold text-green-700 mt-1">{fmtSpeed(s.averageSpeed)}</p>
                        </div>
                        <div className="bg-red-50 rounded-xl p-3 text-center">
                          <p className="text-[10px] font-bold text-red-600 uppercase tracking-wide">V. Máxima</p>
                          <p className="text-xl font-bold text-red-700 mt-1">{fmtSpeed(s.maxSpeed)}</p>
                        </div>
                        <div className="bg-gray-50 rounded-xl p-3 text-center">
                          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Horas Motor</p>
                          <p className="text-xl font-bold text-gray-800 mt-1">{(s.engineHours / 3600000).toFixed(1)}h</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ────────────────────────────────────────────────────────── */}
        <div className={activeTab === 'route' ? 'flex flex-col animate-slide-up' : 'hidden'}>
          {route.length > 0 && (
            <div className="px-4 py-2 border-b border-gray-100 shrink-0 bg-gray-50/50">
              <span className="text-xs text-gray-500 font-medium">
                {route.length} puntos GPS · Colores: 🟢 lento → 🔴 rápido
              </span>
            </div>
          )}
          <div className="flex-1 min-h-[400px] relative">
            {!mapsLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10 text-gray-400 text-sm">
                Cargando mapa...
              </div>
            )}
            <div ref={mapRef} className="absolute inset-0" />
            {!loading && route.length === 0 && mapsLoaded && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 gap-2 pointer-events-none">
                <MapIcon size={40} className="opacity-20" />
                <p className="text-sm">Genera el reporte para ver la ruta</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
