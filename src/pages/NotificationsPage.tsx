import React, { useState, useEffect } from 'react';
import { api } from '../lib/traccarApi';
import { Bell, Plus, Trash2, Edit2, AlertTriangle, Wifi, WifiOff, Zap, BatteryLow, Gauge, MapPin, X, Check, ChevronDown } from 'lucide-react';

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface TraccarNotification {
  id?: number;
  type: string;
  notificators: string;
  always: boolean;
  description?: string;
}

// ─── Tipos de notificaciones disponibles en Traccar ───────────────────────────
const NOTIFICATION_TYPES = [
  { value: 'deviceOnline',    label: 'Taxi conectado',         icon: Wifi,           color: 'text-green-600 bg-green-50' },
  { value: 'deviceOffline',   label: 'Taxi desconectado',      icon: WifiOff,        color: 'text-gray-600 bg-gray-50' },
  { value: 'deviceMoving',    label: 'Taxi en movimiento',     icon: Zap,            color: 'text-blue-600 bg-blue-50' },
  { value: 'deviceStopped',   label: 'Taxi detenido',          icon: MapPin,         color: 'text-orange-600 bg-orange-50' },
  { value: 'lowBattery',      label: 'Batería baja',           icon: BatteryLow,     color: 'text-red-600 bg-red-50' },
  { value: 'speeding',        label: 'Exceso de velocidad',    icon: Gauge,          color: 'text-red-600 bg-red-50' },
  { value: 'alarm',           label: 'Alarma',                 icon: AlertTriangle,  color: 'text-yellow-600 bg-yellow-50' },
  { value: 'geofenceEnter',   label: 'Entrada a geocerca',     icon: MapPin,         color: 'text-purple-600 bg-purple-50' },
  { value: 'geofenceExit',    label: 'Salida de geocerca',     icon: MapPin,         color: 'text-purple-600 bg-purple-50' },
];

const NOTIFICATORS = [
  { value: 'web',      label: 'Web (navegador)' },
  { value: 'mail',     label: 'Correo electrónico' },
  { value: 'sms',      label: 'SMS' },
];

// ─── Modal de creación/edición de notificación ─────────────────────────────────
function CreateNotificationModal({ devices, onClose, onSaved, editingNotif }: { devices: any[]; onClose: () => void; onSaved: () => void; editingNotif?: any }) {
  const [type, setType] = useState(editingNotif?.type || '');
  const [notificators, setNotificators] = useState<string[]>(editingNotif?.notificators ? editingNotif.notificators.split(/[, ]+/) : ['web']);
  const [always, setAlways] = useState(editingNotif?.always ?? true);
  const [description, setDescription] = useState(editingNotif?.attributes?.description || '');
  const [selectedDevices, setSelectedDevices] = useState<number[]>([]);
  const [originalDevices, setOriginalDevices] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showDevicePicker, setShowDevicePicker] = useState(false);

  useEffect(() => {
    if (editingNotif) {
      // Cargar taxis vinculados
      fetch(`/api/devices?notificationId=${editingNotif.id}`)
        .then(r => r.json())
        .then(devs => {
          const ids = devs.map((d: any) => d.id);
          setSelectedDevices(ids);
          setOriginalDevices(ids);
        })
        .catch(console.error);
    }
  }, [editingNotif]);

  const toggleNotificator = (val: string) => {
    setNotificators(prev => prev.includes(val) ? prev.filter(n => n !== val) : [...prev, val]);
  };

  const toggleDevice = (id: number) => {
    setSelectedDevices(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleSave = async () => {
    if (!type || notificators.length === 0) {
      setError('Selecciona un tipo y al menos un canal de notificación.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = { 
        ...(editingNotif || {}),
        type, 
        notificators: notificators.join(','), 
        always, 
        attributes: { ...(editingNotif?.attributes || {}), description }
      };

      const method = editingNotif ? 'PUT' : 'POST';
      const url = editingNotif ? `/api/notifications/${editingNotif.id}` : '/api/notifications';

      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      
      if (!res.ok) {
        throw new Error('Error al guardar: ' + await res.text());
      }
      
      const savedNotif = await res.json();
      
      // Actualizar Taxis vinculados
      const toAdd = selectedDevices.filter(id => !originalDevices.includes(id));
      const toRemove = originalDevices.filter(id => !selectedDevices.includes(id));

      for (const deviceId of toAdd) {
        await fetch('/api/permissions', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notificationId: savedNotif.id, deviceId }),
        });
      }

      for (const deviceId of toRemove) {
        await fetch('/api/permissions', {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notificationId: savedNotif.id, deviceId }),
        });
      }
      
      onSaved();
      onClose();
    } catch (err) {
      console.error(err);
      setError('Error al guardar la notificación o vincular taxis.');
    } finally {
      setSaving(false);
    }
  };

  const selectedType = NOTIFICATION_TYPES.find(t => t.value === type);

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-bold text-gray-900">{editingNotif ? 'Editar notificación' : 'Nueva notificación'}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto">
          {/* Tipo de evento */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Tipo de evento</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-56 overflow-y-auto p-1 -m-1">
              {NOTIFICATION_TYPES.map(nt => {
                const Icon = nt.icon;
                return (
                  <button
                    key={nt.value}
                    onClick={() => setType(nt.value)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition
                      ${type === nt.value ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:border-gray-300 text-gray-700'}`}
                  >
                    <span className={`p-1 rounded-lg ${nt.color}`}>
                      <Icon size={12} />
                    </span>
                    {nt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Canal */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Canal de notificación</label>
            <div className="flex gap-2 flex-wrap">
              {NOTIFICATORS.map(n => (
                <button
                  key={n.value}
                  onClick={() => toggleNotificator(n.value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition
                    ${notificators.includes(n.value) ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:border-gray-300 text-gray-700'}`}
                >
                  {notificators.includes(n.value) && <Check size={11} />}
                  {n.label}
                </button>
              ))}
            </div>
          </div>

          {/* Siempre activo */}
          <label className="flex items-center gap-3 cursor-pointer">
            <div
              onClick={() => setAlways(a => !a)}
              className={`w-10 h-5 rounded-full transition-colors ${always ? 'bg-blue-600' : 'bg-gray-200'}`}
            >
              <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${always ? 'translate-x-5' : 'translate-x-0'}`} />
            </div>
            <span className="text-sm text-gray-700">Siempre activo (ignorar horarios)</span>
          </label>

          {/* Descripción */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Descripción (opcional)</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Ej: Alerta batería taxi Ana Karen"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Taxis (Dispositivos) */}
          <div className="relative">
            <label className="block text-xs font-medium text-gray-600 mb-2">Aplicar a taxis</label>
            <button onClick={() => setShowDevicePicker(!showDevicePicker)}
              className="w-full flex items-center justify-between gap-2 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 text-left">
              <span className="truncate text-gray-700">
                {selectedDevices.length === 0 ? 'Ninguno seleccionado (Aplica a todos)' :
                 selectedDevices.length === devices.length ? 'Todos los taxis' :
                 `${selectedDevices.length} taxi(s) seleccionado(s)`}
              </span>
              <ChevronDown size={14} className={`text-gray-400 shrink-0 transition-transform ${showDevicePicker ? 'rotate-180' : ''}`} />
            </button>
            {showDevicePicker && (
              <div className="absolute bottom-full left-0 right-0 z-50 mb-2 bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden max-h-56 overflow-y-auto p-2 origin-bottom animate-in fade-in zoom-in-95 duration-200">
                <div className="flex gap-2 mb-2 p-1 border-b border-gray-100 sticky top-0 bg-white z-10">
                  <button onClick={() => setSelectedDevices(devices.map(d => d.id))} className="text-xs font-bold text-blue-600 hover:underline">Todos</button>
                  <span className="text-gray-300">|</span>
                  <button onClick={() => setSelectedDevices([])} className="text-xs font-bold text-gray-500 hover:underline">Limpiar</button>
                </div>
                {devices.map((d: any) => (
                  <label key={d.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors">
                    <input type="checkbox" checked={selectedDevices.includes(d.id)}
                      onChange={() => toggleDevice(d.id)} className="accent-blue-600 w-4 h-4" />
                    <span className="text-sm text-gray-700">{d.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-xl">{error}</p>}
        </div>

        <div className="flex gap-2 p-5 pt-0 shrink-0 mt-4">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-200 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 transition">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !type || notificators.length === 0}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition"
          >
            {saving ? 'Guardando...' : editingNotif ? 'Guardar cambios' : 'Crear alerta'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<TraccarNotification[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingNotif, setEditingNotif] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [nRes, dRes] = await Promise.all([
        fetch('/api/notifications', { credentials: 'include' }),
        api.getDevices()
      ]);
      if (nRes.ok) setNotifications(await nRes.json());
      setDevices(dRes);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id: number) => {
    if (!confirm('¿Eliminar esta notificación?')) return;
    await fetch(`/api/notifications/${id}`, { method: 'DELETE', credentials: 'include' });
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const getTypeInfo = (type: string) => NOTIFICATION_TYPES.find(t => t.value === type) ?? {
    label: type, icon: Bell, color: 'text-gray-600 bg-gray-50'
  };

  const handleCreateNew = () => {
    setEditingNotif(null);
    setShowModal(true);
  };

  return (
    <div className="flex flex-col gap-6 h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Notificaciones</h1>
          <p className="text-sm text-gray-500 mt-0.5">Alertas automáticas sobre el estado de tus taxis</p>
        </div>
        <button
          onClick={handleCreateNew}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition shadow-sm"
        >
          <Plus size={16} /> Nueva alerta
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Cargando notificaciones...</div>
      ) : notifications.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-3">
          <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center">
            <Bell size={24} className="text-gray-400" />
          </div>
          <p className="text-sm font-medium">No hay alertas configuradas</p>
          <p className="text-xs text-gray-400">Crea una para recibir avisos sobre tus taxis</p>
          <button onClick={() => setShowModal(true)} className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition">
            Crear primera alerta
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {notifications.map(notif => {
            const info = getTypeInfo(notif.type);
            const Icon = info.icon;
            return (
              <div key={notif.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-xl ${info.color}`}>
                      <Icon size={16} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{info.label}</p>
                      {notif.attributes?.description && <p className="text-xs text-gray-500">{notif.attributes.description}</p>}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => { setEditingNotif(notif); setShowModal(true); }}
                      className="p-1.5 hover:bg-blue-50 hover:text-blue-600 text-gray-400 rounded-lg transition" title="Editar">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => notif.id && handleDelete(notif.id)}
                      className="p-1.5 hover:bg-red-50 hover:text-red-500 text-gray-400 rounded-lg transition" title="Eliminar">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {(notif.notificators || '').split(/[, ]+/).filter(Boolean).map(n => (
                    <span key={n} className="text-[10px] font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md capitalize">
                      {NOTIFICATORS.find(x => x.value === n)?.label ?? n}
                    </span>
                  ))}
                  {notif.always && (
                    <span className="text-[10px] font-medium bg-green-50 text-green-700 px-2 py-0.5 rounded-md">
                      Siempre activo
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && <CreateNotificationModal devices={devices} editingNotif={editingNotif} onClose={() => { setShowModal(false); setEditingNotif(null); }} onSaved={load} />}
    </div>
  );
}
