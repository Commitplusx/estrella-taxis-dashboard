import React, { useEffect, useState } from 'react';
import { api, type TraccarDevice } from '../lib/traccarApi';
import { useAuth } from '../context/AuthContext';
import { CarFront, RadioTower, WifiOff, MapPin } from 'lucide-react';
import { useTraccarSocket } from '../hooks/useTraccarSocket';

function formatRelativeTime(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMins = Math.round((now.getTime() - d.getTime()) / 60000);
  
  if (diffMins < 1) return 'Hace unos segundos';
  if (diffMins < 60) return `Hace ${diffMins} min`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `Hace ${diffHours} h`;
  return `Hace ${Math.floor(diffHours / 24)} días`;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [devices, setDevices] = useState<TraccarDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [nowTick, setNowTick] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    api.getDevices()
      .then(setDevices)
      .finally(() => setLoading(false));
  }, []);

  useTraccarSocket({
    onDevices: (updated) => {
      setDevices(prev => {
        const map = new Map(prev.map(d => [d.id, d]));
        updated.forEach(d => map.set(d.id, d));
        return Array.from(map.values());
      });
    },
  });

  const online = devices.filter(d => d.status === 'online').length;
  const offline = devices.filter(d => d.status !== 'online').length;

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 fade-in space-y-6 pb-32 md:pb-10">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
          Hola, {user?.name?.split(' ')[0]} 👋
        </h1>
        <p className="text-gray-500 text-sm mt-1 capitalize">
          {new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Stats - Rediseño Moderno */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        
        {/* Hero Card: Total Taxis (Full width en móvil, col-span-2) */}
        <div className="col-span-2 bg-gradient-to-br from-blue-600 to-blue-800 rounded-[24px] p-5 sm:p-6 text-white shadow-lg shadow-blue-600/30 flex items-center justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -mr-10 -mt-10"></div>
          <div className="absolute bottom-0 left-0 w-24 h-24 bg-blue-400/20 rounded-full blur-xl -ml-5 -mb-5"></div>
          <div className="relative z-10">
            <p className="text-blue-100 font-medium text-sm sm:text-base mb-1">Total de Flotilla</p>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl sm:text-5xl font-bold tracking-tight">{loading ? '...' : devices.length}</span>
              <span className="text-blue-200 text-sm">Taxis registrados</span>
            </div>
          </div>
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-white/10 border border-white/20 backdrop-blur-sm flex items-center justify-center shrink-0 relative z-10">
            <CarFront size={28} className="text-white" />
          </div>
        </div>

        {/* Card: En Línea */}
        <div className="bg-white rounded-[20px] p-4 sm:p-5 border border-gray-100 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between mb-2">
            <div className="w-10 h-10 rounded-xl bg-green-50 text-green-600 flex items-center justify-center">
              <RadioTower size={20} />
            </div>
            <span className="px-2 py-1 bg-green-50 text-green-600 text-[10px] font-bold uppercase rounded-lg">Online</span>
          </div>
          <div>
            <p className="text-2xl sm:text-3xl font-bold text-gray-900">{loading ? '...' : online}</p>
            <p className="text-xs text-gray-500 font-medium mt-0.5">Conectados</p>
          </div>
        </div>

        {/* Card: Sin Señal */}
        <div className="bg-white rounded-[20px] p-4 sm:p-5 border border-gray-100 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between mb-2">
            <div className="w-10 h-10 rounded-xl bg-gray-50 text-gray-500 flex items-center justify-center">
              <WifiOff size={20} />
            </div>
            <span className="px-2 py-1 bg-gray-100 text-gray-500 text-[10px] font-bold uppercase rounded-lg">Offline</span>
          </div>
          <div>
            <p className="text-2xl sm:text-3xl font-bold text-gray-900">{loading ? '...' : offline}</p>
            <p className="text-xs text-gray-500 font-medium mt-0.5">Desconectados</p>
          </div>
        </div>

        {/* Cobertura (Full width) */}
        <div className="col-span-2 bg-white rounded-[20px] p-4 sm:p-5 border border-gray-100 shadow-sm flex flex-col justify-center">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-amber-50 text-amber-500 flex items-center justify-center">
                <MapPin size={16} />
              </div>
              <p className="text-sm font-semibold text-gray-700">Cobertura Activa</p>
            </div>
            <p className="text-lg font-bold text-amber-500">{loading || !devices.length ? '0' : Math.round((online / devices.length) * 100)}%</p>
          </div>
          <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div 
              className="h-full bg-amber-500 rounded-full transition-all duration-1000 ease-out" 
              style={{ width: `${loading || !devices.length ? 0 : Math.round((online / devices.length) * 100)}%` }}
            ></div>
          </div>
        </div>

      </div>

      {/* Taxis recientes */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-50">
          <h2 className="text-base font-semibold text-gray-900 tracking-tight">Estado de tu Flotilla</h2>
        </div>
        <div className="divide-y divide-gray-50/80">
          {loading ? (
            <div className="animate-pulse flex flex-col">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-50">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full sm:rounded-2xl bg-gray-100"></div>
                    <div className="space-y-2">
                      <div className="h-4 w-32 bg-gray-200 rounded"></div>
                      <div className="h-3 w-20 bg-gray-100 rounded"></div>
                    </div>
                  </div>
                  <div className="h-8 w-8 bg-gray-100 rounded-full"></div>
                </div>
              ))}
            </div>
          ) : devices.slice(0, 8).map(device => {
            const isOnline = device.status === 'online';
            return (
              <div key={device.id} className="flex items-center justify-between px-4 sm:px-6 py-4 hover:bg-slate-50 transition-colors group cursor-pointer">
                <div className="flex items-center gap-3 sm:gap-4">
                  
                  {/* Car Avatar + Status Dot */}
                  <div className="relative">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full sm:rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                      <CarFront size={20} className="sm:w-6 sm:h-6" />
                    </div>
                    <div className="absolute -bottom-1 -right-1 sm:-bottom-1 sm:-right-1">
                      <div className="relative flex items-center justify-center w-3.5 h-3.5">
                        {isOnline && <span className="absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-40 animate-ping"></span>}
                        <span className={`relative inline-flex rounded-full h-3 w-3 border-2 border-white ${isOnline ? 'bg-green-500' : 'bg-gray-400'}`}></span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Text Data */}
                  <div>
                    <p className="text-sm sm:text-base font-bold text-gray-900 group-hover:text-blue-600 transition-colors">{device.name}</p>
                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mt-0.5">
                      <span className="text-[9px] sm:text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded tracking-wide uppercase">
                        ID: {device.uniqueId}
                      </span>
                      <span className="text-[10px] sm:text-xs text-gray-400 font-medium">
                        &bull; {isOnline ? 'Señal Activa' : 'Desconectado'}
                      </span>
                      {device.lastUpdate && (
                        <span className="text-[10px] sm:text-xs text-gray-400 font-medium">
                          &bull; Última señal: {formatRelativeTime(device.lastUpdate)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                
                {/* Status Indicator Right */}
                <div className="flex items-center gap-3">
                  <div className="hidden sm:flex flex-col items-end">
                     <span className={`text-[10px] font-bold uppercase tracking-wider ${isOnline ? 'text-green-600' : 'text-gray-400'}`}>{isOnline ? 'Online' : 'Offline'}</span>
                  </div>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${isOnline ? 'bg-green-50 text-green-600 shadow-sm shadow-green-100' : 'bg-gray-50 text-gray-400'}`}>
                    {isOnline ? <RadioTower size={14} /> : <WifiOff size={14} />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
