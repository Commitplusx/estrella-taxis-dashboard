import React, { useEffect, useState } from 'react';
import { api, type TraccarDevice } from '../lib/traccarApi';
import { useAuth } from '../context/AuthContext';
import { CarFront, RadioTower, WifiOff, MapPin } from 'lucide-react';
import { useTraccarSocket } from '../hooks/useTraccarSocket';

function StatCard({ title, value, subtitle, icon, color }: {
  title: string; value: string | number; subtitle?: string; icon: React.ReactNode; color: string;
}) {
  return (
    <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] hover:shadow-[0_8px_20px_-6px_rgba(0,0,0,0.1)] transition-all flex items-center gap-5">
      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 ${color}`}>
        {icon}
      </div>
      <div>
        <p className="text-sm font-semibold text-gray-500">{title}</p>
        <p className="text-2xl font-bold text-gray-900 leading-tight mt-0.5">{value}</p>
        {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [devices, setDevices] = useState<TraccarDevice[]>([]);
  const [loading, setLoading] = useState(true);

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
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
          Hola, {user?.name?.split(' ')[0]} 👋
        </h1>
        <p className="text-gray-500 text-sm mt-1 capitalize">
          {new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard
          title="Total de Taxis"
          value={loading ? '...' : devices.length}
          icon={<CarFront size={26} strokeWidth={2.5} className="text-blue-600" />}
          color="bg-blue-50 border border-blue-100/50"
        />
        <StatCard
          title="En Línea"
          value={loading ? '...' : online}
          subtitle="Con señal GPS activa"
          icon={<RadioTower size={26} strokeWidth={2.5} className="text-green-600" />}
          color="bg-green-50 border border-green-100/50"
        />
        <StatCard
          title="Sin Señal"
          value={loading ? '...' : offline}
          icon={<WifiOff size={26} strokeWidth={2.5} className="text-gray-500" />}
          color="bg-gray-100 border border-gray-200/50"
        />
        <StatCard
          title="Cobertura"
          value={loading || !devices.length ? '—' : `${Math.round((online / devices.length) * 100)}%`}
          subtitle="Taxis activos hoy"
          icon={<MapPin size={26} strokeWidth={2.5} className="text-amber-600" />}
          color="bg-amber-50 border border-amber-100/50"
        />
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
                <div key={i} className="flex items-center justify-between px-6 py-4 border-b border-gray-50">
                  <div className="flex items-center gap-4">
                    <div className="w-2 h-2 rounded-full bg-gray-200"></div>
                    <div className="space-y-1.5">
                      <div className="h-4 w-32 bg-gray-200 rounded"></div>
                      <div className="h-3 w-20 bg-gray-100 rounded"></div>
                    </div>
                  </div>
                  <div className="h-6 w-20 bg-gray-100 rounded-full"></div>
                </div>
              ))}
            </div>
          ) : devices.slice(0, 8).map(device => {
            const isOnline = device.status === 'online';
            return (
              <div key={device.id} className="flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="relative flex items-center justify-center w-3 h-3">
                    {isOnline && <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-30 animate-ping"></span>}
                    <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isOnline ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{device.name}</p>
                    <p className="text-xs text-gray-400">ID: {device.uniqueId}</p>
                  </div>
                </div>
                <span className={`text-xs font-semibold px-3 py-1.5 rounded-full ${
                  isOnline ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-gray-50 text-gray-500 border border-gray-100'
                }`}>
                  {isOnline ? 'En línea' : 'Sin señal'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
