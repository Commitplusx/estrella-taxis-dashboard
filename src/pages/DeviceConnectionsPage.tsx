import React, { useState, useEffect } from 'react';
import { api, BASE_URL, type TraccarDevice } from '../lib/traccarApi';
import { Wifi, WifiOff, Activity, Search, Download, Calendar } from 'lucide-react';
import { exportToExcel } from '../lib/exportExcel';
import toast from 'react-hot-toast';

interface ConnectionEvent {
  id: number;
  deviceId: number;
  type: string;
  serverTime?: string;
  eventTime?: string;
}

export default function DeviceConnectionsPage() {
  const [devices, setDevices] = useState<TraccarDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | ''>('');
  const [events, setEvents] = useState<ConnectionEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState({
    from: new Date(Date.now() - 24 * 3600000).toISOString().slice(0, 16),
    to: new Date().toISOString().slice(0, 16)
  });

  useEffect(() => {
    api.getDevices().then(setDevices);
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDeviceId) return toast.error('Selecciona un taxi');

    setLoading(true);
    try {
      const fromIso = new Date(dateRange.from).toISOString();
      const toIso = new Date(dateRange.to).toISOString();

      const params = new URLSearchParams();
      params.append('deviceId', selectedDeviceId.toString());
      params.append('from', fromIso);
      params.append('to', toIso);
      params.append('type', 'deviceOnline');
      params.append('type', 'deviceOffline');
      params.append('type', 'deviceUnknown');

      const res = await fetch(`${BASE_URL}/reports/events?${params.toString()}`, { 
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) throw new Error('Error al obtener eventos');
      
      const data = await res.json();
      const getTime = (e: any) => new Date(e.eventTime || e.serverTime || Date.now()).getTime();
      setEvents(data.sort((a: any, b: any) => getTime(b) - getTime(a)));
    } catch (err) {
      toast.error('Error al consultar historial de conexiones');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    const data = events.map(e => {
      const time = e.eventTime || e.serverTime || Date.now();
      return {
        Fecha: new Date(time).toLocaleDateString(),
        Hora: new Date(time).toLocaleTimeString(),
        Evento: e.type === 'deviceOnline' ? 'Conectado' : e.type === 'deviceOffline' ? 'Desconectado' : 'Desconocido',
      };
    });
    exportToExcel(data, `Conexiones_${selectedDeviceId}`);
  };

  const device = devices.find(d => d.id === selectedDeviceId);

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 fade-in flex flex-col gap-6 pb-32 md:pb-10">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Activity size={24} className="text-blue-600" />
          Historial de Conexiones
        </h1>
        <p className="text-sm text-gray-500 mt-1">Verifica cuándo se conecta o desconecta el GPS del servidor.</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <form onSubmit={handleSearch} className="flex flex-col md:flex-row items-end gap-4">
          <div className="flex-1 w-full">
            <label className="block text-xs font-bold text-gray-600 mb-1.5">Taxi</label>
            <select
              value={selectedDeviceId}
              onChange={e => setSelectedDeviceId(Number(e.target.value))}
              required
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
            >
              <option value="" disabled>Selecciona un taxi</option>
              {devices.map(d => (
                <option key={d.id} value={d.id}>{d.name} ({d.uniqueId})</option>
              ))}
            </select>
          </div>
          <div className="flex-1 w-full">
            <label className="block text-xs font-bold text-gray-600 mb-1.5 flex items-center gap-1.5"><Calendar size={12}/> Desde</label>
            <input type="datetime-local" required value={dateRange.from} onChange={e => setDateRange(d => ({ ...d, from: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex-1 w-full">
            <label className="block text-xs font-bold text-gray-600 mb-1.5 flex items-center gap-1.5"><Calendar size={12}/> Hasta</label>
            <input type="datetime-local" required value={dateRange.to} onChange={e => setDateRange(d => ({ ...d, to: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full md:w-auto flex items-center justify-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition">
            <Search size={16} /> {loading ? 'Buscando...' : 'Buscar'}
          </button>
        </form>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col mb-4">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50 rounded-t-2xl">
          <h2 className="font-bold text-gray-900 text-sm">
            Resultados {device ? `para ${device.name}` : ''}
          </h2>
          {events.length > 0 && (
            <button onClick={handleExport}
              className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg text-xs font-bold transition">
              <Download size={14} /> Exportar Excel
            </button>
          )}
        </div>

        <div className="p-4 sm:p-5">
          {events.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-gray-400 gap-3">
              <Activity size={32} className="opacity-20" />
              <p className="text-sm font-medium">No hay registros de conexión en estas fechas.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {events.map(ev => {
                const isOnline = ev.type === 'deviceOnline';
                return (
                  <div key={ev.id} className="flex items-center justify-between p-4 rounded-xl border border-gray-100 hover:border-blue-100 transition shadow-sm bg-white">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isOnline ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                        {isOnline ? <Wifi size={18} /> : <WifiOff size={18} />}
                      </div>
                      <div>
                        <p className={`text-sm font-bold ${isOnline ? 'text-green-700' : 'text-gray-700'}`}>
                          {isOnline ? 'Conexión Restablecida' : 'Señal Perdida'}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">{device?.name || `ID: ${ev.deviceId}`}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-gray-900">{new Date(ev.eventTime || ev.serverTime || Date.now()).toLocaleTimeString()}</p>
                      <p className="text-xs text-gray-500">{new Date(ev.eventTime || ev.serverTime || Date.now()).toLocaleDateString()}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
