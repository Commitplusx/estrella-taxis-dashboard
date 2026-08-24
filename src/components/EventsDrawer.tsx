import React from 'react';
import { X, Zap, MapPin, AlertTriangle, Wifi, WifiOff, Bell } from 'lucide-react';
import type { TraccarDevice } from '../lib/traccarApi';

interface EventsDrawerProps {
  events: any[];
  devices: TraccarDevice[];
  onClose: () => void;
  open: boolean;
}

const EVENT_LABELS: Record<string, { label: string; icon: any; color: string }> = {
  deviceOnline:    { label: 'GPS Conectado',       icon: Wifi,          color: 'text-green-600 bg-green-50' },
  deviceOffline:   { label: 'GPS Desconectado',    icon: WifiOff,       color: 'text-gray-600 bg-gray-50' },
  deviceMoving:    { label: 'En movimiento',       icon: Zap,           color: 'text-blue-600 bg-blue-50' },
  deviceStopped:   { label: 'Detenido',            icon: MapPin,        color: 'text-orange-600 bg-orange-50' },
  deviceOverspeed: { label: 'Exceso velocidad',    icon: AlertTriangle, color: 'text-red-600 bg-red-50' },
  geofenceEnter:   { label: 'Entrada geocerca',    icon: MapPin,        color: 'text-purple-600 bg-purple-50' },
  geofenceExit:    { label: 'Salida geocerca',     icon: MapPin,        color: 'text-purple-600 bg-purple-50' },
  alarm:           { label: 'Alarma',              icon: AlertTriangle, color: 'text-yellow-600 bg-yellow-50' },
  ignitionOn:      { label: 'Encendido ON',        icon: Zap,           color: 'text-emerald-600 bg-emerald-50' },
  ignitionOff:     { label: 'Encendido OFF',       icon: Zap,           color: 'text-slate-600 bg-slate-50' },
};

export function EventsDrawer({ events, devices, onClose, open }: EventsDrawerProps) {
  if (!open) return null;

  return (
    <div className="absolute top-4 right-4 bottom-[7.5rem] md:bottom-4 w-80 bg-white shadow-xl rounded-2xl flex flex-col border border-gray-100 z-50 overflow-hidden animate-fade-in pointer-events-auto">
      <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gray-50 shrink-0">
        <div className="flex items-center gap-2">
          <Bell size={16} className="text-blue-600" />
          <h2 className="font-bold text-gray-900 text-sm">Eventos en Vivo</h2>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded-lg transition-colors">
          <X size={16} className="text-gray-500" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {events.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-2 p-6 text-center">
            <Bell size={32} className="opacity-30" />
            <p className="text-xs">Esperando eventos en tiempo real...</p>
          </div>
        ) : (
          events.map((ev, i) => {
            const meta = EVENT_LABELS[ev.type] || { label: ev.type, icon: Bell, color: 'text-gray-600 bg-gray-50' };
            const Icon = meta.icon;
            const device = devices.find(d => d.id === ev.deviceId);

            return (
              <div key={i} className="flex gap-3 p-3 hover:bg-gray-50 rounded-xl transition-colors border border-transparent hover:border-gray-100">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${meta.color}`}>
                  <Icon size={14} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-gray-900 truncate">{device?.name || `Dispositivo ${ev.deviceId}`}</p>
                  <p className="text-[11px] font-medium text-gray-600 capitalize mt-0.5">{meta.label}</p>
                  <p className="text-[10px] text-gray-400 mt-1">{new Date(ev.serverTime).toLocaleTimeString()}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
