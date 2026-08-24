import React, { useState, useEffect } from 'react';
import type { TraccarMaintenance } from '../lib/traccarApi';
import { Wrench, Plus, X, Save, Trash2, Edit2, AlertCircle } from 'lucide-react';

// Tipos requeridos (Agregados aquí por simplicidad si no están en traccarApi)
interface TraccarMaintenanceExtended extends Omit<TraccarMaintenance, 'attributes'> {
  id: number;
  name: string;
  type: string;
  start: number;
  period: number;
  attributes?: any;
}

const MAINTENANCE_TYPES = [
  { value: 'distance', label: 'Basado en Kilometraje' },
  { value: 'engineHours', label: 'Basado en Horas de Motor' },
  { value: 'period', label: 'Basado en Tiempo (Días)' } // Dependiendo de la versión de traccar
];

export default function MaintenancePage() {
  const [items, setItems] = useState<TraccarMaintenanceExtended[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingItem, setEditingItem] = useState<Partial<TraccarMaintenanceExtended> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/maintenance', { credentials: 'include' });
      if (res.ok) setItems(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    if (!editingItem?.name || !editingItem?.type || !editingItem?.period) {
      return alert('Llenar los campos requeridos (Nombre, Tipo, Período)');
    }

    setSaving(true);
    try {
      const isNew = !editingItem.id;
      
      // Traccar procesa distancia (start, period) en metros. El frontend lo manejará en KM.
      let payload = { ...editingItem };
      if (payload.type === 'distance') {
        payload.start = (Number(payload.start) || 0) * 1000;
        payload.period = (Number(payload.period) || 0) * 1000;
      }
      
      const res = await fetch(isNew ? '/api/maintenance' : `/api/maintenance/${editingItem.id}`, {
        method: isNew ? 'POST' : 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text());
      
      await load();
      setEditingItem(null);
    } catch (e: any) {
      alert(`Error al guardar: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('¿Eliminar este mantenimiento?')) return;
    try {
      const res = await fetch(`/api/maintenance/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (e: any) {
      alert(`Error al eliminar: ${e.message}`);
    }
  };

  const formatPeriod = (item: TraccarMaintenanceExtended) => {
    if (item.type === 'distance') return `${(item.period / 1000).toLocaleString()} km`;
    if (item.type === 'engineHours') return `${item.period} hrs`;
    return `${item.period}`;
  };

  return (
    <div className="flex flex-col gap-6 h-full p-6 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Mantenimientos</h1>
          <p className="text-sm text-gray-500 mt-1">Registra y programa rutinas para tu flotilla</p>
        </div>
        <button
          onClick={() => setEditingItem({ name: '', type: 'distance', start: 0, period: 10000 })}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold shadow-sm transition"
        >
          <Plus size={16} /> Agregar Rutina
        </button>
      </div>

      {loading ? (
        <div className="text-center text-sm text-gray-400 py-12">Cargando...</div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center bg-white rounded-3xl border border-gray-100 p-12 text-gray-400">
          <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mb-4">
            <Wrench size={28} className="text-gray-300" />
          </div>
          <p className="text-sm font-semibold text-gray-700">Sin rutinas de mantenimiento</p>
          <p className="text-xs text-gray-400 mt-1 mb-4 text-center">Registra cambios de aceite, llantas o servicios preventivos.</p>
          <button onClick={() => setEditingItem({ name: '', type: 'distance', start: 0, period: 10000 })}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-semibold transition">
            Crear primera rutina
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map(item => (
            <div key={item.id} className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="bg-blue-50 text-blue-600 p-2 rounded-xl"><Wrench size={16} /></div>
                    <h3 className="font-bold text-gray-900">{item.name}</h3>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => {
                       // Convertir de metros a KM para editar
                       let editable = { ...item };
                       if (editable.type === 'distance') {
                         editable.start = (editable.start || 0) / 1000;
                         editable.period = (editable.period || 0) / 1000;
                       }
                       setEditingItem(editable);
                    }} className="p-1.5 text-gray-400 hover:bg-gray-100 hover:text-blue-600 rounded-lg transition"><Edit2 size={14}/></button>
                    <button onClick={() => handleDelete(item.id)} className="p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 rounded-lg transition"><Trash2 size={14}/></button>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Tipo</span>
                    <span className="font-medium text-gray-700 capitalize">{MAINTENANCE_TYPES.find(t => t.value === item.type)?.label || item.type}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Frecuencia</span>
                    <span className="font-medium text-gray-900">{formatPeriod(item)}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Edición */}
      {editingItem && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-fade-in">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Wrench size={16} className="text-blue-600" />
                {editingItem.id ? 'Editar Rutina' : 'Nueva Rutina'}
              </h2>
              <button onClick={() => setEditingItem(null)} className="text-gray-400 hover:bg-gray-200 p-1.5 rounded-lg transition"><X size={16}/></button>
            </div>
            
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Nombre (Ej: Cambio de Aceite)</label>
                <input value={editingItem.name || ''} onChange={e => setEditingItem({...editingItem, name: e.target.value})}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Cambio de Aceite" />
              </div>
              
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Métrica / Tipo</label>
                <select value={editingItem.type || 'distance'} onChange={e => setEditingItem({...editingItem, type: e.target.value})}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                  {MAINTENANCE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5 flex items-center gap-1">
                    Valor Inicial
                    <span className="text-gray-400" title="Odómetro al que se inició el conteo (0 por defecto)">
                      <AlertCircle size={10} />
                    </span>
                  </label>
                  <input type="number" value={editingItem.start ?? 0} onChange={e => setEditingItem({...editingItem, start: Number(e.target.value)})}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5 flex items-center gap-1">
                    Período {editingItem.type === 'distance' ? '(KM)' : ''}
                  </label>
                  <input type="number" value={editingItem.period ?? 0} onChange={e => setEditingItem({...editingItem, period: Number(e.target.value)})}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            </div>

            <div className="p-5 bg-gray-50 border-t border-gray-100 flex gap-2">
              <button onClick={() => setEditingItem(null)} className="flex-1 px-4 py-2 border border-gray-200 text-gray-700 bg-white rounded-xl text-sm font-semibold hover:bg-gray-50 transition">Cancelar</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition">
                <Save size={16} /> {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
