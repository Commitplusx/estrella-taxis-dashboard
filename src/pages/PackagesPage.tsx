import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import {
  Package, Plus, Pencil, Trash2, Check, X, ToggleLeft, ToggleRight,
  Star, DollarSign, Bot, MessageCircle, Wifi, GripVertical, AlertCircle,
  CheckCircle2, Cpu, BarChart3, FileText,
} from 'lucide-react';
import toast from 'react-hot-toast';

interface Feature {
  id: string;
  label: string;
  incluido: boolean;
}

interface Paquete {
  id: string;
  nombre: string;
  precio_mensual: number;
  incluye_bot: boolean;
  incluye_whatsapp: boolean;
  activo: boolean;
  features: Feature[];
  limite_vehiculos: number | null;
  permisos_sistema: Record<string, boolean>;
}

const EMPTY_FORM = {
  nombre: '',
  precio_mensual: 0,
  incluye_bot: false,
  incluye_whatsapp: false,
  activo: true,
  limite_vehiculos: null as number | null,
  features: [] as Feature[],
  permisos_sistema: {} as Record<string, boolean>,
};

// Módulos del sistema — agrega aquí futuros algoritmos
const SYSTEM_MODULES: { key: string; label: string; description: string; icon: React.ReactNode }[] = [
  {
    key: 'enrutamiento_vectorial',
    label: 'Asignación Vectorial (IA)',
    description: 'Usa K-Means y Haversine para despachar al taxi más óptimo.',
    icon: <Cpu size={14} className="text-indigo-500" />,
  },
  {
    key: 'mapa_calor',
    label: 'Mapa de Calor Predictivo',
    description: 'Visualiza zonas de alta demanda en tiempo real para reubicar choferes.',
    icon: <Star size={14} className="text-rose-500" />,
  },
  {
    key: 'score_diario',
    label: 'Score Diario de Choferes',
    description: 'Calcula el rendimiento de cada conductor al final del día.',
    icon: <BarChart3 size={14} className="text-purple-500" />,
  },
  {
    key: 'reporte_pdf',
    label: 'Reportes PDF Automáticos',
    description: 'Genera y envía reportes de flota en PDF cada semana.',
    icon: <FileText size={14} className="text-orange-500" />,
  },
];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const PLAN_GRADIENTS: { max: number; gradient: string }[] = [
  { max: 400,  gradient: 'from-sky-500 to-blue-600' },
  { max: 1500, gradient: 'from-indigo-500 via-indigo-600 to-purple-600' },
  { max: 9999, gradient: 'from-amber-500 to-orange-600' },
];

function getPlanGradient(precio: number): string {
  return PLAN_GRADIENTS.find(p => precio <= p.max)?.gradient ?? 'from-indigo-500 to-purple-600';
}

export default function PackagesPage() {
  const { userRole } = useAuth();
  const [paquetes, setPaquetes] = useState<Paquete[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [newFeatureLabel, setNewFeatureLabel] = useState('');

  if (userRole !== 'superadmin') {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle size={40} className="text-red-400 mx-auto mb-3" />
          <p className="font-bold text-gray-700">Acceso restringido</p>
          <p className="text-sm text-gray-400 mt-1">Solo el Super Administrador puede acceder a esta sección.</p>
        </div>
      </div>
    );
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const fetchPaquetes = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('paquetes')
      .select('*')
      .order('precio_mensual', { ascending: true });
    if (error) {
      toast.error('Error al cargar los planes: ' + error.message);
    } else {
      setPaquetes((data ?? []).map((p: Paquete) => {
        let parsedFeatures = p.features;
        if (typeof parsedFeatures === 'string') {
          try { parsedFeatures = JSON.parse(parsedFeatures); } catch (e) {}
        }
        let parsedPermisos = p.permisos_sistema;
        if (typeof parsedPermisos === 'string') {
          try { parsedPermisos = JSON.parse(parsedPermisos); } catch (e) {}
        }

        return {
          ...p,
          features: Array.isArray(parsedFeatures) ? parsedFeatures : [],
          permisos_sistema: typeof parsedPermisos === 'object' && parsedPermisos !== null ? parsedPermisos : {},
        };
      }));
    }
    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => { fetchPaquetes(); }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, features: [] });
    setNewFeatureLabel('');
    setModalOpen(true);
  };

  const openEdit = (p: Paquete) => {
    setEditingId(p.id);
    setForm({
      nombre: p.nombre,
      precio_mensual: p.precio_mensual,
      incluye_bot: p.incluye_bot,
      incluye_whatsapp: p.incluye_whatsapp,
      activo: p.activo,
      limite_vehiculos: p.limite_vehiculos,
      features: p.features.map(f => ({ ...f })),
      permisos_sistema: p.permisos_sistema ?? {},
    });
    setNewFeatureLabel('');
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.nombre.trim()) return toast.error('El nombre del plan es requerido.');
    if (form.precio_mensual < 0) return toast.error('El precio no puede ser negativo.');
    setSaving(true);
    try {
      const payload = {
        nombre: form.nombre.trim(),
        precio_mensual: form.precio_mensual,
        incluye_bot: form.incluye_bot,
        incluye_whatsapp: form.incluye_whatsapp,
        activo: form.activo,
        limite_vehiculos: form.limite_vehiculos,
        features: form.features,
        permisos_sistema: form.permisos_sistema,
      };
      if (editingId) {
        const { error } = await supabase.from('paquetes').update(payload).eq('id', editingId);
        if (error) throw error;
        toast.success('Plan actualizado ✓');
      } else {
        const { error } = await supabase.from('paquetes').insert(payload);
        if (error) throw error;
        toast.success('Plan creado ✓');
      }
      setModalOpen(false);
      await fetchPaquetes();
    } catch (e: unknown) {
      toast.error('Error: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, nombre: string) => {
    if (!confirm(`¿Eliminar el plan "${nombre}"? Esta acción no se puede deshacer.`)) return;
    const { error } = await supabase.from('paquetes').delete().eq('id', id);
    if (error) { toast.error('Error al eliminar: ' + error.message); }
    else { toast.success('Plan eliminado'); await fetchPaquetes(); }
  };

  const addFeature = () => {
    if (!newFeatureLabel.trim()) return;
    setForm(f => ({
      ...f,
      features: [...f.features, { id: uid(), label: newFeatureLabel.trim(), incluido: true }],
    }));
    setNewFeatureLabel('');
  };

  const toggleFeature = (id: string) => {
    setForm(f => ({
      ...f,
      features: f.features.map(feat => feat.id === id ? { ...feat, incluido: !feat.incluido } : feat),
    }));
  };

  const removeFeature = (id: string) => {
    setForm(f => ({ ...f, features: f.features.filter(feat => feat.id !== id) }));
  };

  const updateFeatureLabel = (id: string, label: string) => {
    setForm(f => ({
      ...f,
      features: f.features.map(feat => feat.id === id ? { ...feat, label } : feat),
    }));
  };

  return (
    <div className="absolute inset-0 p-4 sm:p-6 pb-32 md:pb-10 view-panel fade-in overflow-y-auto">
      <div className="max-w-5xl mx-auto w-full flex flex-col gap-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Package size={24} className="text-blue-600" />
              Planes de Servicio
            </h1>
            <p className="text-sm text-gray-500 mt-1">Administra los paquetes que ofreces a tus clientes.</p>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold transition shadow-sm"
          >
            <Plus size={16} /> Nuevo Plan
          </button>
        </div>

        {/* Cards grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-64 bg-white rounded-2xl border border-gray-100 animate-pulse" />
            ))}
          </div>
        ) : paquetes.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
            <Package size={40} className="text-gray-300 mx-auto mb-3" />
            <p className="font-bold text-gray-500">No hay planes configurados</p>
            <button onClick={openCreate} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition">
              Crear primer plan
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {paquetes.map(p => (
              <div
                key={p.id}
                className={`rounded-2xl overflow-hidden shadow-sm border ${p.activo ? 'border-transparent' : 'border-gray-200 opacity-60'}`}
              >
                {/* Gradient header */}
                <div className={`bg-gradient-to-br ${getPlanGradient(p.precio_mensual)} p-5 text-white`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold mb-2 ${p.activo ? 'bg-white/20' : 'bg-black/20'}`}>
                        {p.activo ? 'Activo' : 'Inactivo'}
                      </span>
                      <h2 className="text-lg font-extrabold leading-tight">{p.nombre}</h2>
                      <p className="text-2xl font-black mt-1">
                        ${p.precio_mensual.toLocaleString('es-MX')}
                        <span className="text-sm font-normal text-white/70">/mes</span>
                      </p>
                    </div>
                    <Star size={22} className="text-yellow-300 flex-shrink-0 mt-1" fill="currentColor" />
                  </div>

                  {/* System permission badges */}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {[
                      { label: 'GPS',          active: true,               icon: <Wifi size={10} /> },
                      { label: 'WhatsApp IA',  active: p.incluye_whatsapp, icon: <MessageCircle size={10} /> },
                      { label: 'Bot de Voz',   active: p.incluye_bot,      icon: <Bot size={10} /> },
                    ].map(badge => (
                      <span
                        key={badge.label}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          badge.active
                            ? 'bg-white/20 border-white/30 text-white'
                            : 'bg-black/20 border-white/10 text-white/40 line-through'
                        }`}
                      >
                        {badge.icon} {badge.label}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Features + actions */}
                <div className="bg-white p-4">
                  {p.features.length === 0 ? (
                    <p className="text-xs text-gray-400 italic text-center py-2">Sin características configuradas</p>
                  ) : (
                    <ul className="space-y-1.5 mb-1">
                      {p.features.map(f => (
                        <li
                          key={f.id}
                          className={`flex items-center gap-2 text-xs ${f.incluido ? 'text-gray-700' : 'text-gray-300 line-through'}`}
                        >
                          {f.incluido
                            ? <Check size={11} className="text-emerald-500 flex-shrink-0" />
                            : <X size={11} className="text-gray-300 flex-shrink-0" />
                          }
                          {f.label}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="flex gap-2 mt-4 pt-3 border-t border-gray-100">
                    <button
                      onClick={() => openEdit(p)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition"
                    >
                      <Pencil size={12} /> Editar
                    </button>
                    <button
                      onClick={() => handleDelete(p.id, p.nombre)}
                      className="w-9 h-9 flex items-center justify-center bg-red-50 hover:bg-red-100 text-red-500 rounded-xl transition"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== MODAL ===== */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">

            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <h2 className="font-bold text-gray-900 flex items-center gap-2">
                <Package size={18} className="text-blue-600" />
                {editingId ? 'Editar Plan' : 'Crear Plan'}
              </h2>
              <button
                onClick={() => setModalOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 text-gray-500 transition"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-5">

              {/* Nombre + Precio */}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-bold text-gray-600 mb-1.5">Nombre del Plan *</label>
                  <input
                    value={form.nombre}
                    onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                    placeholder="Ej. Plan Enterprise"
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-bold text-gray-600 mb-1.5">Precio Mensual (MXN)</label>
                  <div className="relative">
                    <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="number"
                      min={0}
                      value={form.precio_mensual}
                      onChange={e => setForm(f => ({ ...f, precio_mensual: Number(e.target.value) }))}
                      className="w-full border border-gray-200 rounded-xl pl-8 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Permisos del Sistema */}
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">
                  Permisos del Sistema (API)
                </p>
                <div className="space-y-3">
                  {([
                    { key: 'incluye_whatsapp' as const, label: 'Bot de WhatsApp con IA',   icon: <MessageCircle size={14} className="text-green-500" /> },
                    { key: 'incluye_bot'      as const, label: 'Bot de Voz con IA (Telnyx)',icon: <Bot size={14} className="text-blue-500" /> },
                  ] as const).map(perm => (
                    <div key={perm.key} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {perm.icon}
                        <span className="text-sm font-medium text-slate-700">{perm.label}</span>
                      </div>
                      <button onClick={() => setForm(f => ({ ...f, [perm.key]: !f[perm.key] }))}>
                        {form[perm.key]
                          ? <ToggleRight size={28} className="text-blue-600" />
                          : <ToggleLeft size={28} className="text-gray-300" />
                        }
                      </button>
                    </div>
                  ))}

                  <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                    <span className="text-sm font-medium text-slate-700">Plan Activo (visible)</span>
                    <button onClick={() => setForm(f => ({ ...f, activo: !f.activo }))}>
                      {form.activo
                        ? <ToggleRight size={28} className="text-emerald-500" />
                        : <ToggleLeft size={28} className="text-gray-300" />
                      }
                    </button>
                  </div>
                </div>
              </div>

              {/* Módulos del Sistema (algoritmos) */}
              <div className="bg-purple-50 rounded-xl p-4 border border-purple-100">
                <p className="text-[11px] font-bold text-purple-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <Cpu size={12} /> Módulos del Sistema (Algoritmos)
                </p>
                <p className="text-[10px] text-purple-400 mb-3">
                  Activa funcionalidades avanzadas. El backend las verifica antes de ejecutarse.
                </p>
                <div className="space-y-3">
                  {SYSTEM_MODULES.map(mod => (
                    <div key={mod.key} className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2 min-w-0">
                        <div className="mt-0.5 flex-shrink-0">{mod.icon}</div>
                        <div>
                          <p className="text-sm font-semibold text-slate-700">{mod.label}</p>
                          <p className="text-[10px] text-slate-400">{mod.description}</p>
                        </div>
                      </div>
                      <button
                        className="flex-shrink-0"
                        onClick={() => setForm(f => ({
                          ...f,
                          permisos_sistema: {
                            ...f.permisos_sistema,
                            [mod.key]: !f.permisos_sistema[mod.key],
                          },
                        }))}
                      >
                        {form.permisos_sistema[mod.key]
                          ? <ToggleRight size={28} className="text-purple-600" />
                          : <ToggleLeft size={28} className="text-gray-300" />
                        }
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Constructor de características */}
              <div>
                <p className="text-xs font-bold text-gray-600 mb-2 flex items-center gap-1.5">
                  <CheckCircle2 size={13} className="text-emerald-500" />
                  Características Visibles para el Cliente
                </p>

                <div className="space-y-2 mb-3">
                  {form.features.length === 0 && (
                    <p className="text-xs text-gray-400 italic text-center py-3">Aún no has agregado características</p>
                  )}
                  {form.features.map(feat => (
                    <div key={feat.id} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                      <GripVertical size={13} className="text-gray-300 flex-shrink-0" />
                      <input
                        value={feat.label}
                        onChange={e => updateFeatureLabel(feat.id, e.target.value)}
                        className="flex-1 bg-transparent text-sm text-gray-700 focus:outline-none min-w-0"
                        placeholder="Nombre de la característica"
                      />
                      <button
                        onClick={() => toggleFeature(feat.id)}
                        title={feat.incluido ? 'Marcar como NO incluido' : 'Marcar como incluido'}
                        className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition ${
                          feat.incluido ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-300'
                        }`}
                      >
                        {feat.incluido ? <Check size={11} /> : <X size={11} />}
                      </button>
                      <button
                        onClick={() => removeFeature(feat.id)}
                        className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center hover:bg-red-100 text-gray-300 hover:text-red-500 transition"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <input
                    value={newFeatureLabel}
                    onChange={e => setNewFeatureLabel(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addFeature()}
                    placeholder="Agregar característica..."
                    className="flex-1 border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={addFeature}
                    disabled={!newFeatureLabel.trim()}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-xl transition"
                  >
                    <Plus size={16} />
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5">
                  Presiona Enter o + para agregar. Verde ✓ = incluido · Gris ✗ = no incluido (se mostrará tachado).
                </p>
              </div>

            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0 bg-gray-50">
              <button
                onClick={() => setModalOpen(false)}
                className="flex-1 px-4 py-2.5 border border-gray-200 hover:bg-gray-100 text-gray-700 rounded-xl text-sm font-bold transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition"
              >
                {saving ? 'Guardando...' : editingId ? 'Guardar Cambios' : 'Crear Plan'}
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
