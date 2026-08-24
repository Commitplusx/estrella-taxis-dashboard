import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api, type TraccarDevice } from '../lib/traccarApi';
import { loadGoogleMaps } from '../lib/mapsLoader';
import { exportToExcel } from '../lib/exportExcel';
import {
  Calendar, Search, Map as MapIcon, Navigation, Clock,
  Play, Download, ChevronDown, Car, Layers, BarChart3,
  MapPin, Zap, AlertTriangle, RefreshCw, X, Sparkles
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
  address?: string; lat: number; lon: number;
  duration: number; engineHours?: number;
}
interface ReportEvent {
  id: number; deviceId: number; deviceName?: string;
  type: string; serverTime: string; positionId?: number;
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
  const pad = (d: Date) => d.toISOString().slice(0, 16);
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
const fmtTime = (iso: string) => new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });

const EVENT_LABELS: Record<string, { label: string; color: string }> = {
  deviceOnline:    { label: 'GPS Conectado',       color: 'text-green-600 bg-green-50' },
  deviceOffline:   { label: 'GPS Desconectado',    color: 'text-gray-600 bg-gray-50' },
  deviceMoving:    { label: 'En movimiento',        color: 'text-blue-600 bg-blue-50' },
  deviceStopped:   { label: 'Detenido',             color: 'text-orange-600 bg-orange-50' },
  deviceOverspeed: { label: 'Exceso velocidad',     color: 'text-red-600 bg-red-50' },
  geofenceEnter:   { label: 'Entrada geocerca',     color: 'text-purple-600 bg-purple-50' },
  geofenceExit:    { label: 'Salida geocerca',      color: 'text-purple-600 bg-purple-50' },
  alarm:           { label: 'Alarma',               color: 'text-yellow-600 bg-yellow-50' },
  ignitionOn:      { label: 'Encendido ON',         color: 'text-emerald-600 bg-emerald-50' },
  ignitionOff:     { label: 'Encendido OFF',        color: 'text-slate-600 bg-slate-50' },
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

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-4">
      {/* Presets rápidos */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold text-gray-500 mr-1">Período:</span>
        {[
          { key: 'today', label: 'Hoy' },
          { key: 'yesterday', label: 'Ayer' },
          { key: 'week', label: '7 días' },
          { key: 'month', label: 'Este mes' },
        ].map(p => (
          <button key={p.key} onClick={() => { const r = getPreset(p.key); setFrom(r.from); setTo(r.to); }}
            className="px-3 py-1 text-xs font-bold rounded-lg bg-gray-50 hover:bg-blue-50 hover:text-blue-600 border border-gray-200 transition">
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
        {/* Selector de dispositivos */}
        <div className="relative lg:col-span-2">
          <label className="block text-xs font-bold text-gray-500 mb-1">Taxis</label>
          <button onClick={() => setShowDevicePicker(!showDevicePicker)}
            className="w-full flex items-center justify-between gap-2 border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-gray-50 hover:bg-white hover:border-blue-300 transition text-left">
            <span className="truncate text-gray-700">
              {selectedDevices.length === 0 ? 'Ninguno seleccionado' :
               selectedDevices.length === devices.length ? 'Todos los taxis' :
               `${selectedDevices.length} taxi${selectedDevices.length > 1 ? 's' : ''} seleccionado${selectedDevices.length > 1 ? 's' : ''}`}
            </span>
            <ChevronDown size={14} className="text-gray-400 shrink-0" />
          </button>

          {showDevicePicker && (
            <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden">
              <div className="p-3 border-b border-gray-100 flex gap-2 items-center">
                <Search size={14} className="text-gray-400" />
                <input autoFocus value={deviceSearch} onChange={e => setDeviceSearch(e.target.value)}
                  placeholder="Buscar taxi..." className="flex-1 text-sm outline-none" />
                <button onClick={() => setShowDevicePicker(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                  <X size={14} className="text-gray-400" />
                </button>
              </div>
              <div className="p-2 flex gap-2 border-b border-gray-100">
                <button onClick={selectAll} className="text-xs font-bold text-blue-600 hover:underline">Todos</button>
                <span className="text-gray-300">|</span>
                <button onClick={clearAll} className="text-xs font-bold text-gray-500 hover:underline">Limpiar</button>
              </div>
              <div className="max-h-48 overflow-y-auto p-2">
                {filteredDevices.map((d: TraccarDevice) => (
                  <label key={d.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded-lg cursor-pointer">
                    <input type="checkbox" checked={selectedDevices.includes(d.id)}
                      onChange={() => toggleDevice(d.id)} className="accent-blue-600" />
                    <Car size={12} className="text-gray-400" />
                    <span className="text-sm text-gray-700">{d.name}</span>
                  </label>
                ))}
              </div>
              <div className="p-3 border-t border-gray-100 flex justify-end">
                <button onClick={() => setShowDevicePicker(false)}
                  className="px-4 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700 transition">
                  Listo
                </button>
              </div>
            </div>
          )}
        </div>

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
      </div>

      <div className="flex justify-end">
        <button onClick={onSearch} disabled={loading || selectedDevices.length === 0}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold transition shadow-sm disabled:opacity-50">
          {loading ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
          Generar Reporte
        </button>
      </div>
    </div>
  );
}

// â”€â”€â”€ Main Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function ReportsPage() {
  const [devices, setDevices] = useState<TraccarDevice[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [selectedDevices, setSelectedDevices] = useState<number[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('trips');
  const [loading, setLoading] = useState(false);

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
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    api.getDevices().then(devs => {
      setDevices(devs);
      if (devs.length > 0) setSelectedDevices([devs[0].id]);
    });
    fetch('/api/groups', { credentials: 'include' }).then(r => r.json()).then(setGroups).catch(() => {});
    loadGoogleMaps().then(() => setMapsLoaded(true)).catch(console.error);
  }, []);

  useEffect(() => {
    if (!mapsLoaded || !mapRef.current || activeTab !== 'route') return;
    if (googleMapRef.current) return;
    googleMapRef.current = new window.google.maps.Map(mapRef.current, {
      center: { lat: 16.2355, lng: -92.1267 },
      zoom: 12,
      mapTypeControl: false, streetViewControl: false, fullscreenControl: true,
      gestureHandling: 'greedy',
    });
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
  }, [route, activeTab, drawRoute]);

  const buildParams = (deviceId: number) => {
    const p = new URLSearchParams();
    p.append('deviceId', String(deviceId));
    p.append('from', new Date(from).toISOString());
    p.append('to', new Date(to).toISOString());
    return p.toString();
  };

  const deviceNameMap = Object.fromEntries(devices.map(d => [d.id, d.name]));

  const handleSearch = async () => {
    if (selectedDevices.length === 0) return;
    setLoading(true);
    try {
      if (activeTab === 'trips') {
        const results: Trip[] = [];
        for (const devId of selectedDevices) {
          const r = await fetch(`/api/reports/trips?${buildParams(devId)}`, { credentials: 'include', headers: { Accept: 'application/json' } });
          if (r.ok) {
            const data: Trip[] = await r.json();
            results.push(...data.map(t => ({ ...t, deviceName: deviceNameMap[t.deviceId] || String(t.deviceId) })));
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
          }
        }
        setEvents(results.sort((a, b) => new Date(b.serverTime).getTime() - new Date(a.serverTime).getTime()));
      } else if (activeTab === 'summary') {
        const results: Summary[] = [];
        for (const devId of selectedDevices) {
          const r = await fetch(`/api/reports/summary?${buildParams(devId)}`, { credentials: 'include', headers: { Accept: 'application/json' } });
          if (r.ok) {
            const data: Summary[] = await r.json();
            results.push(...data.map(s => ({ ...s, deviceName: deviceNameMap[s.deviceId] || String(s.deviceId) })));
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
        }
      }
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
    'Taxi': e.deviceName, 'Tipo': EVENT_LABELS[e.type]?.label || e.type, 'Hora': fmtTime(e.serverTime),
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
    <div className="flex flex-col gap-4 h-full">
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
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col flex-1 min-h-0">
        <div className="flex border-b border-gray-100 overflow-x-auto shrink-0">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3.5 text-sm font-bold whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>

        {/* â”€â”€ VIAJES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {activeTab === 'trips' && (
          <div className="flex flex-col flex-1 min-h-0">
            {trips.length > 0 && (
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0 bg-gray-50/50">
                <span className="text-sm font-bold text-gray-700">{trips.length} viaje{trips.length !== 1 ? 's' : ''} encontrado{trips.length !== 1 ? 's' : ''}</span>
                <button onClick={exportTrips}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-green-700 bg-green-50 hover:bg-green-100 rounded-xl transition border border-green-200">
                  <Download size={13} /> Exportar Excel
                </button>
              </div>
            )}
            <div className="flex-1 overflow-auto">
              {loading && <div className="flex items-center justify-center h-40 text-gray-400 text-sm"><RefreshCw size={20} className="animate-spin mr-2" />Cargando viajes...</div>}
              {!loading && trips.length === 0 && <div className="flex flex-col items-center justify-center h-40 text-gray-400 gap-2"><Navigation size={32} className="opacity-30" /><p className="text-sm">Selecciona un período y genera el reporte</p></div>}
              {!loading && trips.length > 0 && (
                <>
                  {/* Mobile cards */}
                  <div className="md:hidden divide-y divide-gray-100">
                    {trips.map((t, i) => (
                      <div key={i} className="p-4 flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg">{t.deviceName}</span>
                          <span className="text-xs font-bold text-gray-500">{fmtDuration(t.duration)}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mt-1">
                          <div className="text-center bg-gray-50 rounded-xl p-2">
                            <p className="text-xs text-gray-400">Distancia</p>
                            <p className="text-sm font-bold text-gray-800">{fmtDist(t.distance)}</p>
                          </div>
                          <div className="text-center bg-gray-50 rounded-xl p-2">
                            <p className="text-xs text-gray-400">V. Prom</p>
                            <p className="text-sm font-bold text-gray-800">{fmtSpeed(t.averageSpeed)}</p>
                          </div>
                          <div className="text-center bg-gray-50 rounded-xl p-2">
                            <p className="text-xs text-gray-400">V. Máx</p>
                            <p className="text-sm font-bold text-red-600">{fmtSpeed(t.maxSpeed)}</p>
                          </div>
                        </div>
                        <p className="text-[11px] text-gray-400">{fmtTime(t.startTime)} → {fmtTime(t.endTime)}</p>
                      </div>
                    ))}
                  </div>
                  {/* Desktop table */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                        <tr>{['Taxi','Inicio','Fin','Distancia','V. Prom','V. Máx','Duración'].map(h => (
                          <th key={h} className="px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {trips.map((t, i) => (
                          <tr key={i} className="hover:bg-gray-50 transition">
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

        {/* â”€â”€ PARADAS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {activeTab === 'stops' && (
          <div className="flex flex-col flex-1 min-h-0">
            {stops.length > 0 && (
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0 bg-gray-50/50">
                <span className="text-sm font-bold text-gray-700">{stops.length} parada{stops.length !== 1 ? 's' : ''}</span>
                <button onClick={exportStops}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-green-700 bg-green-50 hover:bg-green-100 rounded-xl transition border border-green-200">
                  <Download size={13} /> Exportar Excel
                </button>
              </div>
            )}
            <div className="flex-1 overflow-auto">
              {loading && <div className="flex items-center justify-center h-40 text-gray-400 text-sm"><RefreshCw size={20} className="animate-spin mr-2" />Cargando paradas...</div>}
              {!loading && stops.length === 0 && <div className="flex flex-col items-center justify-center h-40 text-gray-400 gap-2"><MapPin size={32} className="opacity-30" /><p className="text-sm">Selecciona un período y genera el reporte</p></div>}
              {!loading && stops.length > 0 && (
                <>
                  <div className="md:hidden divide-y divide-gray-100">
                    {stops.map((s, i) => (
                      <div key={i} className="p-4 flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-lg">{s.deviceName}</span>
                          <span className="text-sm font-bold text-gray-800">{fmtDuration(s.duration)}</span>
                        </div>
                        {s.address && <p className="text-xs text-gray-600 bg-gray-50 px-3 py-2 rounded-lg">{s.address}</p>}
                        <p className="text-[11px] text-gray-400">{fmtTime(s.startTime)} → {fmtTime(s.endTime)}</p>
                      </div>
                    ))}
                  </div>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                        <tr>{['Taxi','Inicio','Fin','Duración','Dirección'].map(h => (
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
                            <td className="px-4 py-3 text-xs text-gray-600 max-w-xs truncate">{s.address || '—'}</td>
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
          <div className="flex flex-col flex-1 min-h-0">
            {events.length > 0 && (
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0 bg-gray-50/50">
                <span className="text-sm font-bold text-gray-700">{events.length} evento{events.length !== 1 ? 's' : ''}</span>
                <button onClick={exportEvents}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-green-700 bg-green-50 hover:bg-green-100 rounded-xl transition border border-green-200">
                  <Download size={13} /> Exportar Excel
                </button>
              </div>
            )}
            <div className="flex-1 overflow-auto">
              {loading && <div className="flex items-center justify-center h-40 text-gray-400 text-sm"><RefreshCw size={20} className="animate-spin mr-2" />Cargando eventos...</div>}
              {!loading && events.length === 0 && <div className="flex flex-col items-center justify-center h-40 text-gray-400 gap-2"><Zap size={32} className="opacity-30" /><p className="text-sm">Selecciona un período y genera el reporte</p></div>}
              {!loading && events.length > 0 && (
                <div className="divide-y divide-gray-100">
                  {events.map((ev, i) => {
                    const meta = EVENT_LABELS[ev.type] || { label: ev.type, color: 'text-gray-600 bg-gray-50' };
                    return (
                      <div key={i} className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition">
                        <span className={`text-[11px] font-bold px-2 py-1 rounded-lg whitespace-nowrap ${meta.color}`}>{meta.label}</span>
                        <span className="text-sm font-semibold text-gray-800 flex-1">{ev.deviceName}</span>
                        <span className="text-xs text-gray-400 whitespace-nowrap">{fmtTime(ev.serverTime)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* â”€â”€ RESUMEN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {activeTab === 'summary' && (
          <div className="flex flex-col flex-1 min-h-0">
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
            <div className="flex-1 overflow-auto p-4">
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

        {/* â”€â”€ RUTA EN MAPA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {activeTab === 'route' && (
          <div className="flex flex-col flex-1 min-h-0">
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
              <div ref={mapRef} className="w-full h-full" />
              {!loading && route.length === 0 && mapsLoaded && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 gap-2 pointer-events-none">
                  <MapIcon size={40} className="opacity-20" />
                  <p className="text-sm">Genera el reporte para ver la ruta</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
