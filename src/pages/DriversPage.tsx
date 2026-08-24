import React, { useState, useEffect } from 'react';
import { User, Plus, Trash2, Edit2, X, Save, Hash, Phone, Link, Check } from 'lucide-react';
import { useCachedFetch } from '../hooks/useCachedFetch';
import { dataCache } from '../lib/cache';
import { api, type TraccarDevice } from '../lib/traccarApi';

interface TraccarDriver {
  id?: number;
  name: string;
  uniqueId: string;
  attributes?: Record<string, any>;
}

// ─── Modal para Crear/Editar Conductor ────────────────────────────────────────
function DriverModal({
  driver,
  onClose,
  onSaved,
}: {
  driver?: TraccarDriver;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: driver?.name ?? '',
    uniqueId: driver?.uniqueId ?? '',
    phone: driver?.attributes?.phone ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!form.name.trim() || !form.uniqueId.trim()) {
      setError('El nombre e identificador son obligatorios.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const method = driver?.id ? 'PUT' : 'POST';
      const url = driver?.id ? `/api/drivers/${driver.id}` : '/api/drivers';
      
      const payload: any = {
        name: form.name,
        uniqueId: form.uniqueId,
        attributes: {
          ...(driver?.attributes || {})
        }
      };
      
      if (form.phone) {
        payload.attributes.phone = form.phone;
      }
      
      if (driver?.id) {
        payload.id = driver.id;
      }

      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }
      
      onSaved();
      onClose();
    } catch (e: any) {
      setError('Error al guardar: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <User size={18} className="text-emerald-600" />
            {driver ? 'Editar Conductor' : 'Nuevo Conductor'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1">
              <User size={11} /> Nombre completo
            </label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Ej: Juan Pérez"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1">
              <Hash size={11} /> Identificador (RFID / # Empleado)
            </label>
            <input value={form.uniqueId} onChange={e => setForm(f => ({ ...f, uniqueId: e.target.value }))}
              placeholder="Ej: RFID-0045"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1">
              <Phone size={11} /> Teléfono (opcional)
            </label>
            <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              placeholder="+52 961 000 0000"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-xl">{error}</p>}
        </div>

        <div className="flex gap-2 p-5 pt-0">
          <button onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-200 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 transition">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition">
            <Save size={14} />
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Asignar Taxis a Conductor ─────────────────────────────────────────
function AssignTaxisModal({ driver, onClose }: { driver: TraccarDriver; onClose: () => void }) {
  const [allDevices, setAllDevices] = useState<TraccarDevice[]>([]);
  const [linked, setLinked] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const all = await api.getAllDevices();
        
        // Traccar no soporta filtrar dispositivos por driverId directamente (/api/devices?driverId=X falla).
        // En su lugar, debemos preguntar a cada dispositivo qué conductores tiene asignados.
        const linkedIds = new Set<number>();
        
        await Promise.all(all.map(async (device) => {
          try {
            const res = await fetch(`/api/drivers?deviceId=${device.id}`, { credentials: 'include' });
            if (res.ok) {
              const deviceDrivers = await res.json();
              if (deviceDrivers.some((d: any) => d.id === driver.id)) {
                linkedIds.add(device.id);
              }
            }
          } catch (e) {
            console.error(`Error loading drivers for device ${device.id}`, e);
          }
        }));

        setAllDevices(all);
        setLinked(linkedIds);
      } catch (error) {
        console.error('Error cargando datos de taxis:', error);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [driver.id]);

  const toggle = async (deviceId: number) => {
    if (!driver.id) return;
    setSaving(deviceId);
    try {
      if (linked.has(deviceId)) {
        await api.unlinkDeviceFromDriver(driver.id, deviceId);
        setLinked(prev => { const s = new Set(prev); s.delete(deviceId); return s; });
      } else {
        await api.linkDeviceToDriver(driver.id, deviceId);
        setLinked(prev => new Set(prev).add(deviceId));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
              Taxis de {driver.name}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">{linked.size} taxi{linked.size !== 1 ? 's' : ''} asignado{linked.size !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto max-h-96">
          {loading ? (
            <div className="animate-pulse flex flex-col divide-y divide-gray-50">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-gray-200"></div>
                    <div className="space-y-1.5">
                      <div className="h-4 w-24 bg-gray-200 rounded"></div>
                      <div className="h-3 w-16 bg-gray-100 rounded"></div>
                    </div>
                  </div>
                  <div className="h-6 w-20 bg-gray-100 rounded-full"></div>
                </div>
              ))}
            </div>
          ) : allDevices.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">No hay taxis registrados.</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {allDevices.map(device => {
                const isLinked = linked.has(device.id);
                const isSaving = saving === device.id;
                return (
                  <div key={device.id} className={`flex items-center justify-between px-6 py-3 transition-colors ${isLinked ? 'bg-emerald-50/50' : 'hover:bg-gray-50'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${device.status === 'online' ? 'bg-green-500' : 'bg-gray-300'}`} />
                      <div>
                        <p className="text-sm font-medium text-gray-800">{device.name}</p>
                        <p className="text-xs text-gray-400">{device.uniqueId}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => toggle(device.id)}
                      disabled={isSaving}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        isLinked
                          ? 'bg-emerald-100 text-emerald-700 hover:bg-red-50 hover:text-red-600'
                          : 'bg-gray-100 text-gray-500 hover:bg-emerald-50 hover:text-emerald-600'
                      } disabled:opacity-50`}
                    >
                      {isSaving ? (
                        <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      ) : isLinked ? (
                        <><Check size={12} /> Asignado</>
                      ) : (
                        <><Plus size={12} /> Asignar</>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end">
          <button onClick={onClose} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition">
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function DriversPage() {
  const { data, loading, refetch } = useCachedFetch<TraccarDriver[]>('/api/drivers', { ttlMs: 60_000 });
  const drivers = data ?? [];
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<{ open: boolean; driver?: TraccarDriver }>({ open: false });
  const [assigningDriver, setAssigningDriver] = useState<TraccarDriver | null>(null);

  const handleDelete = async (id: number) => {
    if (!confirm('¿Eliminar este conductor?')) return;
    await fetch(`/api/drivers/${id}`, { method: 'DELETE', credentials: 'include' });
    dataCache.invalidate('/api/drivers');
    refetch();
  };

  const filtered = drivers.filter(d =>
    d.name.toLowerCase().includes(search.toLowerCase()) ||
    d.uniqueId.toLowerCase().includes(search.toLowerCase()) ||
    (d.attributes?.phone ?? '').includes(search)
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Conductores</h1>
          <p className="text-sm text-gray-500 mt-0.5">{drivers.length} conductores registrados</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative flex-1 sm:flex-none">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar conductor..."
              className="border border-gray-200 rounded-xl px-4 py-2 text-sm pl-9 focus:outline-none focus:ring-2 focus:ring-emerald-500 w-full sm:w-52 bg-gray-50" />
            <svg className="absolute left-3 top-2.5 text-gray-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
          </div>
          <button onClick={() => setModal({ open: true })}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition shadow-sm whitespace-nowrap">
            <Plus size={16} /> <span className="hidden sm:inline">Nuevo conductor</span><span className="sm:hidden">Nuevo</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden animate-pulse">
          <div className="border-b border-gray-100 bg-gray-50/50 flex px-5 py-3">
            <div className="w-1/3 h-3 bg-gray-200 rounded"></div>
            <div className="w-1/3 h-3 bg-gray-200 rounded mx-5"></div>
            <div className="w-1/3 h-3 bg-gray-200 rounded"></div>
          </div>
          <div className="divide-y divide-gray-50">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="flex items-center px-5 py-4">
                <div className="w-1/3 flex items-center gap-3">
                  <div className="w-9 h-9 bg-gray-100 rounded-xl"></div>
                  <div className="h-4 w-32 bg-gray-200 rounded"></div>
                </div>
                <div className="w-1/3 px-5">
                  <div className="h-3 w-24 bg-gray-100 rounded"></div>
                </div>
                <div className="w-1/3 px-5">
                  <div className="h-3 w-28 bg-gray-100 rounded"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-gray-400 gap-3 py-20">
          <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center">
            <User size={24} className="text-gray-400" />
          </div>
          <p className="text-sm font-medium">
            {drivers.length === 0 ? 'No hay conductores registrados' : 'Sin resultados para tu búsqueda'}
          </p>
          {drivers.length === 0 && (
            <button onClick={() => setModal({ open: true })}
              className="mt-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 transition">
              Registrar primer conductor
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Conductor</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Identificador</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Teléfono</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-32" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(driver => (
                <tr key={driver.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-700 font-bold text-xs">
                        {driver.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm font-semibold text-gray-900">{driver.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded-lg text-gray-600">{driver.uniqueId}</span>
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-500">{driver.attributes?.phone || '—'}</td>
                  <td className="px-5 py-3">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => setAssigningDriver(driver)}
                        className="p-1.5 hover:bg-emerald-50 hover:text-emerald-600 text-gray-400 rounded-lg transition" title="Asignar a Taxis">
                        <Link size={14} />
                      </button>
                      <button onClick={() => setModal({ open: true, driver })}
                        className="p-1.5 hover:bg-blue-50 hover:text-blue-500 text-gray-400 rounded-lg transition" title="Editar">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => driver.id && handleDelete(driver.id)}
                        className="p-1.5 hover:bg-red-50 hover:text-red-500 text-gray-400 rounded-lg transition" title="Eliminar">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal.open && (
        <DriverModal
          driver={modal.driver}
          onClose={() => setModal({ open: false })}
          onSaved={() => {
            dataCache.invalidate('/api/drivers');
            refetch();
          }}
        />
      )}

      {assigningDriver && (
        <AssignTaxisModal
          driver={assigningDriver}
          onClose={() => setAssigningDriver(null)}
        />
      )}
    </div>
  );
}
