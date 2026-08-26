import React, { useState, useEffect } from 'react';
import { api, BASE_URL, type TraccarDevice } from '../lib/traccarApi';
import { X, Save, Car, Phone, User, Hash, Layers, Tag, ShieldAlert, Power, Radio, Zap, Edit2 } from 'lucide-react';
import { CommandModal } from '../components/CommandModal';
import { ShareModal } from '../components/ShareModal';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { VEHICLE_CATEGORIES, getCategoryDef } from '../lib/mapIcons';




interface EditDeviceModalProps {
  device: TraccarDevice;
  groups: { id: number; name: string }[];
  onClose: () => void;
  onSaved: (updated: TraccarDevice) => void;
}

function EditDeviceModal({ device, groups, onClose, onSaved }: EditDeviceModalProps) {
  const [form, setForm] = useState({
    name: device.name || '',
    uniqueId: device.uniqueId || '',
    phone: device.phone || '',
    model: device.model || '',
    category: device.category || 'car',
    groupId: device.groupId || 0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!form.name.trim() || !form.uniqueId.trim()) {
      setError('El nombre e IMEI son obligatorios.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${BASE_URL}/devices/${device.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...device, ...form, groupId: Number(form.groupId) }),
      });
      if (!res.ok) throw new Error(await res.text());
      const updated = await res.json();
      onSaved(updated);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al guardar.');
    } finally {
      setSaving(false);
    }
  };

  const selectedCat = getCategoryDef(form.category);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-white sm:rounded-3xl rounded-t-3xl shadow-2xl w-full sm:max-w-lg flex flex-col max-h-[96vh] sm:max-h-[88vh]">

        {/* ── Handle bar (mobile) ── */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden shrink-0">
          <div className="w-10 h-1 bg-gray-200 rounded-full" />
        </div>

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 pt-4 pb-5 shrink-0">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/30 shrink-0">
              {selectedCat.image ? (
                <img src={selectedCat.image} alt="Icon" className="w-[22px] h-[22px] object-contain brightness-0 invert" />
              ) : (
                <svg viewBox="0 0 24 24" width="22" height="22">
                  <path d={selectedCat.path} fill="white" />
                </svg>
              )}
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-gray-900 leading-tight">{device.name || 'Vehículo'}</h2>
              <p className="text-sm text-blue-500 font-semibold">{selectedCat.label}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center bg-gray-100 hover:bg-gray-200 rounded-2xl transition"
          >
            <X size={16} className="text-gray-600" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto min-h-0 px-6 space-y-4 pb-4">

          {/* Nombre + IMEI */}
          <div className="bg-gray-50 rounded-2xl overflow-hidden divide-y divide-gray-100 border border-gray-100">
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="text-xs font-bold text-gray-400 w-14 shrink-0 uppercase">Nombre</span>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Ej: Taxi 01"
                className="flex-1 bg-transparent text-sm font-semibold text-gray-800 focus:outline-none placeholder:text-gray-300"
              />
            </div>
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="text-xs font-bold text-gray-400 w-14 shrink-0 uppercase">IMEI</span>
              <input
                value={form.uniqueId}
                onChange={e => setForm(f => ({ ...f, uniqueId: e.target.value }))}
                placeholder="869066065085806"
                className="flex-1 bg-transparent text-sm font-mono text-gray-800 focus:outline-none placeholder:text-gray-300"
              />
            </div>
          </div>

          {/* Teléfono, Modelo, Grupo */}
          <div className="bg-gray-50 rounded-2xl overflow-hidden divide-y divide-gray-100 border border-gray-100">
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="text-xs font-bold text-gray-400 w-14 shrink-0 uppercase">Tel.</span>
              <input
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="+52 961 000 0000"
                className="flex-1 bg-transparent text-sm font-medium text-gray-800 focus:outline-none placeholder:text-gray-300"
              />
            </div>
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="text-xs font-bold text-gray-400 w-14 shrink-0 uppercase">Modelo</span>
              <input
                value={form.model}
                onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
                placeholder="Nissan Versa 2020"
                className="flex-1 bg-transparent text-sm font-medium text-gray-800 focus:outline-none placeholder:text-gray-300"
              />
            </div>
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="text-xs font-bold text-gray-400 w-14 shrink-0 uppercase">Grupo</span>
              <select
                value={form.groupId}
                onChange={e => setForm(f => ({ ...f, groupId: Number(e.target.value) }))}
                className="flex-1 bg-transparent text-sm font-medium text-gray-800 focus:outline-none"
              >
                <option value={0}>Sin grupo</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          </div>

          {/* Tipo / Ícono picker */}
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 px-1">
              Ícono en el mapa
            </p>
            <div className="grid grid-cols-5 gap-2">
              {VEHICLE_CATEGORIES.map(cat => {
                const active = form.category === cat.value;
                return (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, category: cat.value }))}
                    title={cat.label}
                    className={`relative flex flex-col items-center gap-1.5 py-3 px-1 rounded-2xl transition-all duration-150 ${
                      active
                        ? 'bg-blue-600 shadow-lg shadow-blue-500/30'
                        : 'bg-gray-100 hover:bg-gray-200'
                    }`}
                  >
                    {cat.image ? (
                      <img src={cat.image} alt={cat.label} className="w-[22px] h-[22px] object-contain" style={{ filter: active ? 'brightness(0) invert(1)' : 'grayscale(100%) opacity(50%)' }} />
                    ) : (
                      <svg viewBox="0 0 24 24" width="22" height="22">
                        <path
                          d={cat.path}
                          fill={active ? 'white' : '#94a3b8'}
                        />
                      </svg>
                    )}
                    <span className={`text-[9px] font-bold leading-tight text-center ${
                      active ? 'text-blue-100' : 'text-gray-400'
                    }`}>
                      {cat.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

        </div>

        {/* ── Error ── */}
        {error && (
          <p className="mx-6 mb-2 text-xs text-red-600 bg-red-50 px-4 py-2.5 rounded-2xl border border-red-100 shrink-0">{error}</p>
        )}

        {/* ── Footer ── */}
        <div className="flex gap-3 px-6 pb-6 pt-3 shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-2xl text-sm font-bold transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-2xl text-sm font-bold transition shadow-lg shadow-blue-600/30"
          >
            <Save size={14} />
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>

      </div>
    </div>
  );
}

// ─── Accumulators Modal ───────────────────────────────────────────────────────
function AccumulatorsModal({ device, onClose, onSaved }: { device: TraccarDevice, onClose: () => void, onSaved: () => void }) {
  // Traccar usa 'totalDistance' en metros, 'hours' en milisegundos en el endpoint /accumulators (a veces en body.totalDistance, body.hours).
  const [distanceKm, setDistanceKm] = useState('');
  const [engineHours, setEngineHours] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: any = {};
      if (distanceKm) body.totalDistance = Number(distanceKm) * 1000;
      if (engineHours) body.hours = Number(engineHours) * 3600000;
      
      const res = await fetch(`${BASE_URL}/devices/${device.id}/accumulators`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      onSaved();
      onClose();
    } catch (err) {
      toast.error('Error al actualizar acumuladores');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="font-bold text-gray-900 text-base">Acumuladores</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition"><X size={18} className="text-gray-500" /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-gray-500">
            Ajusta los valores actuales del odómetro y horómetro del vehículo <span className="font-bold text-gray-800">{device.name}</span>.
          </p>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1">Odómetro (Kilómetros)</label>
            <input type="number" placeholder="Ej: 15000" value={distanceKm} onChange={e => setDistanceKm(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1">Horómetro (Horas)</label>
            <input type="number" placeholder="Ej: 350" value={engineHours} onChange={e => setEngineHours(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div className="p-5 pt-0 flex gap-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-200 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 transition">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition">
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal de dispositivos ─────────────────────────────────────────
export default function DevicesPage() {
  const { user } = useAuth();
  const isReadonly = user?.readonly ?? false;

  const [devices, setDevices] = useState<TraccarDevice[]>([]);
  const [groups, setGroups] = useState<{ id: number; name: string }[]>([]);
  const [driverMap, setDriverMap] = useState<Record<number, string>>({}); // deviceId → driver name
  const [editingDevice, setEditingDevice] = useState<TraccarDevice | null>(null);
  const [commandDevice, setCommandDevice] = useState<TraccarDevice | null>(null);
  const [accumulatorsDevice, setAccumulatorsDevice] = useState<TraccarDevice | null>(null);
  const [shareDevice, setShareDevice] = useState<TraccarDevice | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.getDevices(),
      api.getGroups()
    ]).then(async ([d, g]) => {
      setDevices(d);
      setGroups(g);
      setLoading(false);

      // Para no saturar al servidor haciendo 50 peticiones al mismo tiempo,
      // las agrupamos en bloques de 5.
      const entries: [number, string][] = [];
      const fetchInChunks = async () => {
        const chunkSize = 5;
        for (let i = 0; i < d.length; i += chunkSize) {
          const chunk = d.slice(i, i + chunkSize);
          await Promise.all(
            chunk.map(async (device) => {
              try {
                const res = await fetch(`${BASE_URL}/drivers?deviceId=${device.id}`, { credentials: 'include' });
                if (res.ok) {
                  const drivers = await res.json();
                  if (drivers?.[0]?.name) entries.push([device.id, drivers[0].name]);
                }
              } catch (e) {
                // Silencioso, simplemente no mostramos el conductor
              }
            })
          );
        }
        setDriverMap(Object.fromEntries(entries));
      };
      
      fetchInChunks();
    });
  }, []);

  const filtered = devices.filter(d =>
    d.name.toLowerCase().includes(search.toLowerCase()) ||
    d.uniqueId.toLowerCase().includes(search.toLowerCase())
  );

  // Agrupar taxis por groupId
  const groupedDevices = groups.reduce((acc, group) => {
    acc[group.id] = { name: group.name, devices: [] };
    return acc;
  }, {} as Record<number, { name: string, devices: TraccarDevice[] }>);
  
  // Agregar un grupo para los que no tienen grupo
  groupedDevices[0] = { name: 'Sin Grupo', devices: [] };

  filtered.forEach(d => {
    const gid = d.groupId || 0;
    if (groupedDevices[gid]) {
      groupedDevices[gid].devices.push(d);
    } else {
groupedDevices[0].devices.push(d);
    }
  });

  const statusColor = (s?: string) => s === 'online' ? 'bg-green-500' : s === 'unknown' ? 'bg-yellow-400' : 'bg-gray-300';
  const statusLabel = (s?: string) => s === 'online' ? 'En línea' : s === 'unknown' ? 'Sin datos' : 'Fuera de línea';
  const [searchTerm, setSearchTerm] = useState('');

  const handleSaved = (updated: TraccarDevice) => {
    setDevices(prev => prev.map(d => d.id === updated.id ? updated : d));
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 fade-in pb-32 md:pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Mis Taxis</h1>
          <p className="text-sm text-gray-500 mt-1">Gestiona la flota de vehículos y sus comandos.</p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Barra de búsqueda */}
          <div className="relative">
            <input 
              type="text" 
              placeholder="Buscar vehículo..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary w-full sm:w-64 bg-white shadow-sm"
            />
            <Car size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          </div>

          {!isReadonly && (
            <button
              onClick={() => {
                setEditingDevice({ name: '', uniqueId: '', phone: '', model: '', category: 'car', groupId: 0 });
              }}
              className="btn-primary"
            >
              <Car size={16} /> Registrar Taxi
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col gap-6 animate-pulse">
          {[1, 2].map(groupKey => (
            <div key={groupKey} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="bg-gray-50 px-5 py-3 border-b border-gray-100 flex items-center gap-2">
                <div className="w-4 h-4 bg-gray-200 rounded"></div>
                <div className="h-4 w-32 bg-gray-200 rounded"></div>
              </div>
              <div className="divide-y divide-gray-50">
                {[1, 2, 3].map(rowKey => (
                  <div key={rowKey} className="flex items-center justify-between px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-gray-100 rounded-xl"></div>
                      <div className="space-y-1.5">
                        <div className="h-4 w-32 bg-gray-200 rounded"></div>
                        <div className="h-3 w-24 bg-gray-100 rounded"></div>
                      </div>
                    </div>
                    <div className="h-4 w-16 bg-gray-200 rounded-full"></div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {Object.values(groupedDevices).filter(g => g.devices.length > 0).map(group => (
            <div key={group.name} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              {/* Category header */}
              <div className="bg-gray-50 px-5 py-3 border-b border-gray-100 flex items-center gap-2">
                <Layers size={16} className="text-blue-600" />
                <h2 className="font-bold text-gray-800 text-sm">{group.name}</h2>
                <span className="bg-white border border-gray-200 text-gray-500 text-[10px] px-2 py-0.5 rounded-full font-bold ml-2">
                  {group.devices.length}
                </span>
              </div>

              {/* Desktop: tabla */}
              <table className="w-full hidden md:table">
                <thead>
                  <tr className="border-b border-gray-100 bg-white">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Vehículo</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Modelo / Tel</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Estado</th>
                    <th className="px-5 py-3 w-28" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {group.devices.map(device => (
                    <tr key={device.id} className="hover:bg-gray-50/50 transition">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center text-lg shadow-sm border border-blue-100">🚕</div>
                          <div>
                            <p className="text-sm font-bold text-gray-900">{device.name}</p>
                            <p className="text-xs text-gray-400 font-mono">IMEI: {device.uniqueId}</p>
                            {driverMap[device.id] && (
                              <div className="flex items-center gap-1 mt-0.5">
                                <User size={10} className="text-emerald-500" />
                                <span className="text-xs text-emerald-700 font-medium">{driverMap[device.id]}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-col gap-1">
                          {device.model && (
                            <div className="flex items-center gap-1.5 text-xs text-gray-600">
                              <Car size={12} className="text-gray-400" /> {device.model}
                            </div>
                          )}
                          {device.phone && (
                            <div className="flex items-center gap-1.5 text-xs text-gray-600">
                              <Phone size={12} className="text-gray-400" /> {device.phone}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full ${statusColor(device.status)}`} />
                          <span className="text-xs font-medium text-gray-600">{statusLabel(device.status)}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex gap-1 justify-end">
                          {!isReadonly && (
                            <>
                              <button onClick={() => setShareDevice(device)}
                                className="p-1.5 hover:bg-orange-50 hover:text-orange-600 text-gray-400 rounded-lg transition" title="Compartir enlace">
                                <Tag size={14} />
                              </button>
                              <button onClick={() => setAccumulatorsDevice(device)}
                                className="p-1.5 hover:bg-emerald-50 hover:text-emerald-600 text-gray-400 rounded-lg transition" title="Acumuladores (Odómetro/Horómetro)">
                                <Radio size={14} />
                              </button>
                              <button onClick={() => setEditingDevice(device)}
                                className="p-1.5 hover:bg-blue-50 hover:text-blue-600 text-gray-400 rounded-lg transition" title="Editar">
                                <Edit2 size={14} />
                              </button>
                              <button onClick={() => setCommandDevice(device)}
                                className="p-1.5 hover:bg-red-50 hover:text-red-600 text-gray-400 rounded-lg transition" title="Comandos">
                                <ShieldAlert size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Mobile: cards */}
              <div className="md:hidden divide-y divide-gray-50">
                {group.devices.map(device => (
                  <div key={device.id} className="px-4 py-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-lg shadow-sm border border-blue-100 flex-shrink-0">🚕</div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-gray-900 truncate">{device.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusColor(device.status)}`} />
                          <span className="text-xs text-gray-500">{statusLabel(device.status)}</span>
                        </div>
                        {driverMap[device.id] && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <User size={10} className="text-emerald-500" />
                            <span className="text-xs text-emerald-700 font-medium truncate">{driverMap[device.id]}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      {!isReadonly && (
                        <>
                          <button onClick={() => setShareDevice(device)}
                            className="p-2 hover:bg-orange-50 hover:text-orange-600 text-gray-400 rounded-xl transition" title="Compartir enlace">
                            <Tag size={15} />
                          </button>
                          <button onClick={() => setAccumulatorsDevice(device)}
                            className="p-2 hover:bg-emerald-50 hover:text-emerald-600 text-gray-400 rounded-xl transition" title="Acumuladores (Odómetro/Horómetro)">
                            <Radio size={15} />
                          </button>
                          <button onClick={() => setEditingDevice(device)}
                            className="p-2 hover:bg-blue-50 hover:text-blue-600 text-gray-400 rounded-xl transition" title="Editar">
                            <Edit2 size={15} />
                          </button>
                          <button onClick={() => setCommandDevice(device)}
                            className="p-2 hover:bg-red-50 hover:text-red-600 text-gray-400 rounded-xl transition" title="Comandos">
                            <ShieldAlert size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {editingDevice && (
        <EditDeviceModal
          device={editingDevice}
          groups={groups}
          onClose={() => setEditingDevice(null)}
          onSaved={handleSaved}
        />
      )}

      {commandDevice && (
        <CommandModal
          device={commandDevice}
          onClose={() => setCommandDevice(null)}
        />
      )}
      
      {accumulatorsDevice && (
        <AccumulatorsModal
          device={accumulatorsDevice}
          onClose={() => setAccumulatorsDevice(null)}
          onSaved={() => {
            toast.success('Acumuladores actualizados con éxito');
          }}
        />
      )}

      {shareDevice && (
        <ShareModal
          device={shareDevice}
          onClose={() => setShareDevice(null)}
        />
      )}
    </div>
  );
}

