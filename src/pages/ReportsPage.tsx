import React, { useState, useEffect, useRef } from 'react';
import { api, type TraccarDevice, type TraccarPosition, type TraccarTrip, type TraccarStop } from '../lib/traccarApi';
import { Calendar, Search, Map as MapIcon, Navigation, Clock, Play } from 'lucide-react';

import { loadGoogleMaps } from '../lib/mapsLoader';

export default function ReportsPage() {
  const [devices, setDevices] = useState<TraccarDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | ''>('');
  
  // Rango de fechas por defecto: Hoy
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [toDate, setToDate] = useState(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.toISOString().slice(0, 16);
  });

  const [loading, setLoading] = useState(false);
  const [route, setRoute] = useState<TraccarPosition[]>([]);
  const [trips, setTrips] = useState<TraccarTrip[]>([]);
  const [stops, setStops] = useState<TraccarStop[]>([]);
  const [events, setEvents] = useState<any[]>([]); // type TraccarEvent
  const [summary, setSummary] = useState<any[]>([]); // type TraccarSummary
  
  const [activeTab, setActiveTab] = useState<'route' | 'events' | 'summary'>('route');
  const [mapsLoaded, setMapsLoaded] = useState(false);

  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  // Un array de polylines — cada segmento entre dos puntos GPS tiene su propio color por velocidad
  const segmentsRef = useRef<google.maps.Polyline[]>([]);
  const startMarkerRef = useRef<google.maps.Marker | null>(null);
  const endMarkerRef = useRef<google.maps.Marker | null>(null);

  // Cargar lista de taxis
  useEffect(() => {
    api.getDevices().then(devs => {
      setDevices(devs);
      
      const queryId = new URLSearchParams(window.location.search).get('deviceId');
      if (queryId && devs.some(d => d.id === Number(queryId))) {
        setSelectedDeviceId(Number(queryId));
      } else if (devs.length > 0) {
        setSelectedDeviceId(devs[0].id);
      }
    });
  }, []);

  // Cargar Google Maps
  useEffect(() => {
    loadGoogleMaps().then(() => setMapsLoaded(true)).catch(console.error);
  }, []);

  // Inicializar mapa
  useEffect(() => {
    if (!mapsLoaded || !mapRef.current || googleMapRef.current) return;
    
    const savedMapType = localStorage.getItem('estrella_map_type') || 'roadmap';

    googleMapRef.current = new window.google.maps.Map(mapRef.current, {
      center: { lat: 16.753, lng: -93.115 }, // Tuxtla por defecto
      zoom: 12,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      mapTypeId: savedMapType,
    });
  }, [mapsLoaded]);

  // Manejar búsqueda
  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!selectedDeviceId) return;

    setLoading(true);
    try {
      const params = {
        deviceIds: [Number(selectedDeviceId)],
        from: new Date(fromDate).toISOString(),
        to: new Date(toDate).toISOString()
      };

      // Solución: Enviar las peticiones una por una.
      // Si las enviamos con Promise.all (al mismo tiempo), el VPS de Traccar
      // puede saturarse tratando de calcular los 3 reportes a la vez y botar la conexión.
      const routeData = await api.getRoute(params);
      const tripsData = await api.getTrips(params);
      const stopsData = await api.getStops(params);
      const eventsData = await api.getEvents(params).catch(() => []);
      const summaryData = await api.getSummary(params).catch(() => []);

      setRoute(routeData);
      setTrips(tripsData);
      setStops(stopsData);
      setEvents(eventsData);
      setSummary(summaryData);
      
      drawRoute(routeData);
    } catch (err) {
      console.error(err);
      alert('Error al obtener el reporte');
    } finally {
      setLoading(false);
    }
  };

  // ─── Colores por velocidad (Coincide con la leyenda) ───────────
  const speedToColor = (knots: number): string => {
    const kmh = knots * 1.852;
    if (kmh <= 0)  return '#94a3b8'; // gris — parado
    if (kmh < 20)  return '#22c55e'; // verde
    if (kmh < 40)  return '#84cc16'; // verde-lima
    if (kmh < 60)  return '#3b82f6'; // azul
    if (kmh < 80)  return '#f59e0b'; // ámbar
    if (kmh < 100) return '#f97316'; // naranja
    return '#ef4444';                // rojo
  };

  const drawRoute = (positions: TraccarPosition[]) => {
    if (!googleMapRef.current) return;

    // 1. Limpiar segmentos anteriores
    segmentsRef.current.forEach(s => s.setMap(null));
    segmentsRef.current = [];
    if (startMarkerRef.current) { startMarkerRef.current.setMap(null); startMarkerRef.current = null; }
    if (endMarkerRef.current) { endMarkerRef.current.setMap(null); endMarkerRef.current = null; }

    if (positions.length === 0) return;

    // 2. Dibujar la ruta como segmentos de colores continuos
    for (let i = 0; i < positions.length - 1; i++) {
      const from = positions[i];
      const to   = positions[i + 1];

      const segment = new window.google.maps.Polyline({
        path: [
          { lat: from.latitude, lng: from.longitude },
          { lat: to.latitude,   lng: to.longitude   },
        ],
        geodesic: true,
        strokeColor: speedToColor(from.speed ?? 0),
        strokeOpacity: 1.0,
        strokeWeight: 5,
        map: googleMapRef.current,
      });
      segmentsRef.current.push(segment);
    }

    // 4. Marcadores A (inicio) y B (fin)
    const path = positions.map(p => ({ lat: p.latitude, lng: p.longitude }));
    startMarkerRef.current = new window.google.maps.Marker({
      position: path[0],
      map: googleMapRef.current,
      label: { text: 'A', color: 'white', fontWeight: 'bold', fontSize: '13px' },
      title: `Inicio: ${new Date(positions[0].fixTime).toLocaleString()}`,
    });
    endMarkerRef.current = new window.google.maps.Marker({
      position: path[path.length - 1],
      map: googleMapRef.current,
      label: { text: 'B', color: 'white', fontWeight: 'bold', fontSize: '13px' },
      title: `Fin: ${new Date(positions[positions.length - 1].fixTime).toLocaleString()}`,
    });

    // 5. Ajustar cámara
    const bounds = new window.google.maps.LatLngBounds();
    path.forEach(p => bounds.extend(p));
    googleMapRef.current.fitBounds(bounds);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] gap-4">
      
      {/* Controles */}
      <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm shrink-0">
        <form onSubmit={handleSearch} className="flex flex-col md:flex-row items-end gap-4">
          <div className="flex-1 w-full">
            <label className="block text-xs font-medium text-gray-600 mb-1">Taxi</label>
            <select
              value={selectedDeviceId}
              onChange={e => setSelectedDeviceId(Number(e.target.value))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
            >
              <option value="" disabled>Selecciona un taxi</option>
              {devices.map(d => (
                <option key={d.id} value={d.id}>{d.name} ({d.uniqueId})</option>
              ))}
            </select>
          </div>
          
          <div className="flex-1 w-full">
            <label className="block text-xs font-medium text-gray-600 mb-1">Desde</label>
            <input
              type="datetime-local"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
            />
          </div>

          <div className="flex-1 w-full">
            <label className="block text-xs font-medium text-gray-600 mb-1">Hasta</label>
            <input
              type="datetime-local"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !selectedDeviceId}
            className="w-full md:w-auto px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition flex items-center justify-center gap-2 h-[42px]"
          >
            {loading ? <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"/> : <Search size={16} />}
            Buscar Ruta
          </button>
        </form>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-gray-200 shrink-0 px-2">
        <button onClick={() => setActiveTab('route')} className={`pb-2 px-2 text-sm font-semibold border-b-2 transition ${activeTab === 'route' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Ruta Histórica</button>
        <button onClick={() => setActiveTab('events')} className={`pb-2 px-2 text-sm font-semibold border-b-2 transition ${activeTab === 'events' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Eventos ({events.length})</button>
        <button onClick={() => setActiveTab('summary')} className={`pb-2 px-2 text-sm font-semibold border-b-2 transition ${activeTab === 'summary' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Resumen</button>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
        
        {/* Tab: Ruta */}
        <div className={`w-full flex flex-col lg:flex-row gap-4 h-full ${activeTab !== 'route' ? 'hidden' : ''}`}>
          <div className="flex-1 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col min-h-[300px]">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 shrink-0">
              <MapIcon size={16} className="text-blue-600" />
              <h2 className="text-sm font-bold text-gray-900">Mapa Histórico</h2>
            </div>
            <div className="flex-1 relative">
              {!mapsLoaded && <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10 text-gray-400 text-sm">Cargando mapa...</div>}
              <div ref={mapRef} className="w-full h-full" />
            </div>
          </div>
          
          <div className="w-full lg:w-96 bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col min-h-[300px]">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 shrink-0">
              <Navigation size={16} className="text-green-600" />
              <h2 className="text-sm font-bold text-gray-900">Resumen de Viajes</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {route.length === 0 && !loading && <div className="text-center text-gray-400 text-sm py-10">Realiza una búsqueda</div>}
              {trips.map((trip, i) => (
                <div key={i} className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-gray-700 uppercase">Viaje {i + 1}</span>
                    <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">{(trip.distance / 1000).toFixed(1)} km</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-start gap-2">
                      <Play size={12} className="text-green-500 mt-0.5 shrink-0" />
                      <div><p className="text-[10px] text-gray-400 font-medium">INICIO</p><p className="text-xs text-gray-700">{new Date(trip.startTime).toLocaleString()}</p></div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Clock size={12} className="text-red-500 mt-0.5 shrink-0" />
                      <div><p className="text-[10px] text-gray-400 font-medium">FIN</p><p className="text-xs text-gray-700">{new Date(trip.endTime).toLocaleString()}</p></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Tab: Eventos */}
        {activeTab === 'events' && (
          <div className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between shrink-0">
              <h2 className="text-sm font-bold text-gray-900">Historial de Eventos</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {events.length === 0 ? (
                <div className="text-center text-gray-400 text-sm py-10">No hay eventos en este período.</div>
              ) : (
                <div className="space-y-2">
                  {events.map((ev, i) => (
                    <div key={i} className="flex items-center justify-between p-3 border-b border-gray-100 hover:bg-gray-50 transition">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xs shrink-0">
                          !
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-800 capitalize">{ev.type.replace(/([A-Z])/g, ' $1').trim()}</p>
                          <p className="text-xs text-gray-500">{new Date(ev.serverTime).toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab: Resumen */}
        {activeTab === 'summary' && summary[0] && (
          <div className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-6">Resumen General</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                <p className="text-xs text-gray-500 font-medium mb-1">Distancia Total</p>
                <p className="text-2xl font-bold text-blue-600">{(summary[0].distance / 1000).toFixed(2)} km</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                <p className="text-xs text-gray-500 font-medium mb-1">Velocidad Promedio</p>
                <p className="text-2xl font-bold text-green-600">{(summary[0].averageSpeed * 1.852).toFixed(0)} km/h</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                <p className="text-xs text-gray-500 font-medium mb-1">Velocidad Máxima</p>
                <p className="text-2xl font-bold text-red-600">{(summary[0].maxSpeed * 1.852).toFixed(0)} km/h</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                <p className="text-xs text-gray-500 font-medium mb-1">Horas de Motor</p>
                <p className="text-2xl font-bold text-gray-800">{(summary[0].engineHours / 3600000).toFixed(1)} h</p>
              </div>
            </div>
          </div>
        )}
        {activeTab === 'summary' && !summary[0] && !loading && (
          <div className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center text-gray-400">
            Realiza una búsqueda para ver el resumen general.
          </div>
        )}
      </div>
    </div>
  );
}
