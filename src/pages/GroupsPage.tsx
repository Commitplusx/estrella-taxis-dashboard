import React, { useState, useEffect } from 'react';
import { Layers, Plus, Trash2, Edit2, X, Save } from 'lucide-react';
import { useCachedFetch } from '../hooks/useCachedFetch';
import { dataCache } from '../lib/cache';

interface TraccarGroup {
  id?: number;
  name: string;
  groupId?: number;
  attributes?: Record<string, any>;
}

// ─── Modal crear/editar grupo ─────────────────────────────────────────────────
function GroupModal({
  group,
  groups,
  onClose,
  onSaved,
}: {
  group?: TraccarGroup;
  groups: TraccarGroup[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [parentId, setParentId] = useState<number>(group?.groupId ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!name.trim()) { setError('El nombre es obligatorio.'); return; }
    setSaving(true);
    setError('');
    try {
      const method = group?.id ? 'PUT' : 'POST';
      const url = group?.id ? `/api/groups/${group.id}` : '/api/groups';
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(group ?? {}), name, groupId: parentId || undefined }),
      });
      if (!res.ok) throw new Error(await res.text());
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Error al guardar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center">
              <Layers size={18} className="text-blue-600" />
            </div>
            <h2 className="text-base font-bold text-gray-900">{group?.id ? 'Editar Categoría / Grupo' : 'Nueva Categoría / Grupo'}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1">Nombre de la Categoría</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="Ej: Taxis Cafés, Taxis Rosas, VIP..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="text-xs text-gray-400 bg-gray-50 p-3 rounded-xl border border-gray-100">
            Los taxis que asignes a esta categoría aparecerán en una lista separada en la pantalla de "Mis Taxis".
          </div>
          {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-xl">{error}</p>}
        </div>

        <div className="flex gap-2 p-5 pt-0">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-200 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 transition">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition">
            <Save size={14} />
            {saving ? 'Guardando...' : 'Guardar Categoría'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function GroupsPage() {
  const { data, loading, refetch } = useCachedFetch<TraccarGroup[]>('/api/groups', { ttlMs: 60_000 });
  const groups = data ?? [];
  const [modal, setModal] = useState<{ open: boolean; group?: TraccarGroup }>({ open: false });

  const handleDelete = async (id: number) => {
    if (!confirm('¿Eliminar esta categoría? Los taxis asignados a ella quedarán "Sin grupo".')) return;
    await fetch(`/api/groups/${id}`, { method: 'DELETE', credentials: 'include' });
    dataCache.invalidate('/api/groups');
    refetch();
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Categorías y Grupos</h1>
          <p className="text-sm text-gray-500 mt-0.5">Organiza tu flotilla por Taxis Cafés, Rosas, etc.</p>
        </div>
        <button onClick={() => setModal({ open: true })}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition shadow-sm self-start sm:self-auto">
          <Plus size={16} /> Nueva categoría
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gray-100 rounded-xl"></div>
                  <div className="h-4 w-24 bg-gray-200 rounded"></div>
                </div>
                <div className="flex gap-1">
                  <div className="w-7 h-7 bg-gray-100 rounded-lg"></div>
                  <div className="w-7 h-7 bg-gray-100 rounded-lg"></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-3 py-20">
          <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center">
            <Layers size={24} className="text-gray-400" />
          </div>
          <p className="text-sm font-medium">No tienes categorías creadas</p>
          <p className="text-xs text-gray-400 text-center max-w-sm">
            Crea categorías (ej. Taxis Cafés, Taxis Rosas) para agrupar tus unidades y verlas en listas separadas.
          </p>
          <button onClick={() => setModal({ open: true })}
            className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition">
            Crear primera categoría
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map(group => {
            return (
              <div key={group.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                      <Layers size={18} className="text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900">{group.name}</p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => setModal({ open: true, group })}
                      className="p-1.5 hover:bg-gray-100 text-gray-400 hover:text-blue-600 rounded-lg transition" title="Editar">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => group.id && handleDelete(group.id)}
                      className="p-1.5 hover:bg-gray-100 text-gray-400 hover:text-red-600 rounded-lg transition" title="Eliminar">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal.open && (
        <GroupModal
          group={modal.group}
          groups={groups}
          onClose={() => setModal({ open: false })}
          onSaved={() => {
            dataCache.invalidate('/api/groups');
            refetch();
          }}
        />
      )}
    </div>
  );
}
