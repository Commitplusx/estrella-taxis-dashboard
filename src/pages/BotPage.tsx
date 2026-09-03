import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { api, type TraccarUser } from '../lib/traccarApi';
import { Phone, Bot, Building2, MapPin, Save, Plus, Trash2, CheckCircle, Circle, Edit2, Users, X, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

interface Paquete {
  id: string;
  nombre: string;
  precio_mensual: number;
  incluye_bot: boolean;
  incluye_whatsapp: boolean;
}

interface Empresa {
  id: string;
  nombre_empresa: string;
  nombre_bot: string;
  tipo_negocio: string;
  telefono_telnyx: string;
  dispatcher_phone: string | null;
  prompt_personalizado: string | null;
  ciudad: string | null;
  activo: boolean;
  paquete_id: string | null;
  paquete?: Paquete;
  created_at: string;
}

const TIPOS = ['taxi', 'restaurante', 'refaccionaria', 'farmacia', 'otro'];

const PROMPTS_POR_TIPO: Record<string, string> = {
  taxi: 'Servicio 24/7. Mascotas permitidas avisando antes. Pago efectivo o tarjeta. Desde $50 MXN, llega en 5 mins.',
  restaurante: 'Horario de 1 PM a 11 PM. Ofrecemos hamburguesas, pizzas y alitas. Tiempo estimado de entrega 30-40 min. Aceptamos efectivo y tarjeta.',
  refaccionaria: 'Horario de 8 AM a 7 PM. Contamos con refacciones para todas las marcas. Entrega a domicilio y cotizaciones por teléfono.',
  farmacia: 'Servicio 24 hrs. Contamos con medicamentos genéricos y de patente. Servicio a domicilio. Si requieren receta, indícales que la tengan a la mano.',
  otro: 'Información general de tu negocio aquí...'
};

const defaultForm = {
  nombre_empresa: '',
  nombre_bot: '',
  tipo_negocio: 'taxi',
  telefono_telnyx: '',
  dispatcher_phone: '',
  ciudad: '',
  prompt_personalizado: '',
  activo: true,
  paquete_id: '',
};

export default function BotPage() {
  const { userRole, empresaId } = useAuth();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [paquetes, setPaquetes] = useState<Paquete[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Empresa | null>(null);
  const [vinculandoEmpresa, setVinculandoEmpresa] = useState<Empresa | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);

  const fetchEmpresas = async () => {
    setLoading(true);
    let empresaQuery = supabase.from('empresas').select('*, paquete:paquetes(*)').order('created_at', { ascending: false });
    
    // Si es admin_empresa, solo ve la suya
    if (userRole === 'admin_empresa') {
      if (empresaId) {
        empresaQuery = empresaQuery.eq('id', empresaId);
      } else {
        // Fallback de seguridad: si por alguna razón no tiene empresa_id, no mostrar NADA.
        empresaQuery = empresaQuery.eq('id', '00000000-0000-0000-0000-000000000000');
      }
    }

    const [empRes, paqRes] = await Promise.all([
      empresaQuery,
      supabase.from('paquetes').select('*').eq('activo', true).order('precio_mensual', { ascending: true })
    ]);
    if (!empRes.error) setEmpresas(empRes.data || []);
    if (!paqRes.error) setPaquetes(paqRes.data || []);
    setLoading(false);
  };

  useEffect(() => { 
    // Solo permitir superadmin o admin_empresa
    if (userRole === 'superadmin' || userRole === 'admin_empresa') {
      fetchEmpresas(); 
    }
  }, [userRole, empresaId]);

  const openCreate = () => {
    setEditing(null);
    setForm(defaultForm);
    setShowForm(true);
  };

  const openEdit = (emp: Empresa) => {
    setEditing(emp);
    setForm({
      nombre_empresa: emp.nombre_empresa,
      nombre_bot: emp.nombre_bot,
      tipo_negocio: emp.tipo_negocio,
      telefono_telnyx: emp.telefono_telnyx,
      dispatcher_phone: emp.dispatcher_phone || '',
      ciudad: emp.ciudad || '',
      prompt_personalizado: emp.prompt_personalizado || '',
      activo: emp.activo,
      paquete_id: emp.paquete_id || '',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.nombre_empresa || !form.nombre_bot || !form.telefono_telnyx) {
      toast.error('Nombre, nombre del bot y teléfono son obligatorios.');
      return;
    }
    setSaving(true);
    const payload = {
      ...form,
      dispatcher_phone: form.dispatcher_phone || null,
      prompt_personalizado: form.prompt_personalizado || null,
      ciudad: form.ciudad || null,
      paquete_id: form.paquete_id || null,
    };

    if (editing) {
      const { error } = await supabase.from('empresas').update(payload).eq('id', editing.id);
      if (error) { toast.error('Error al actualizar.'); }
      else { toast.success('Empresa actualizada ✅'); }
    } else {
      const { error } = await supabase.from('empresas').insert(payload);
      if (error) { toast.error('Error al crear. ¿El teléfono ya existe?'); }
      else { toast.success('Empresa creada 🎉'); }
    }

    setSaving(false);
    setShowForm(false);
    fetchEmpresas();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar esta empresa?')) return;
    const { error } = await supabase.from('empresas').delete().eq('id', id);
    if (error) toast.error('Error al eliminar.');
    else { toast.success('Eliminada.'); fetchEmpresas(); }
  };

  const toggleActivo = async (e: Empresa) => {
    await supabase.from('empresas').update({ activo: !e.activo }).eq('id', e.id);
    fetchEmpresas();
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow">
            <Bot size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Bot de Voz (Pompeyo)</h1>
            <p className="text-sm text-gray-500">Gestión de empresas y configuración multi-tenant</p>
          </div>
        </div>
        {userRole === 'superadmin' && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition shadow"
          >
            <Plus size={16} /> Nueva Empresa
          </button>
        )}
      </div>

      {/* Lista de empresas */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">Cargando...</div>
      ) : (
        <div className="grid gap-4">
          {empresas.map(emp => (
            <div key={emp.id} className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm flex items-start gap-4">
              {/* Indicador activo */}
              <button onClick={() => toggleActivo(emp)} className="mt-1 flex-shrink-0">
                {emp.activo
                  ? <CheckCircle size={20} className="text-green-500" />
                  : <Circle size={20} className="text-gray-300" />}
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="font-bold text-gray-900">{emp.nombre_empresa}</span>
                  <span className="text-xs bg-indigo-50 text-indigo-700 font-semibold px-2 py-0.5 rounded-full capitalize">{emp.tipo_negocio}</span>
                  {emp.paquete && (
                    <span className="text-xs bg-emerald-50 text-emerald-700 font-semibold px-2 py-0.5 rounded-full border border-emerald-100">
                      {emp.paquete.nombre}
                    </span>
                  )}
                  {!emp.activo && <span className="text-xs bg-gray-100 text-gray-400 font-medium px-2 py-0.5 rounded-full">Inactivo</span>}
                </div>

                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-gray-600 mt-2">
                  <span className="flex items-center gap-1.5"><Bot size={13} className="text-indigo-400" /> {emp.nombre_bot}</span>
                  <span className="flex items-center gap-1.5"><Phone size={13} className="text-blue-400" /> {emp.telefono_telnyx}</span>
                  {emp.ciudad && <span className="flex items-center gap-1.5"><MapPin size={13} className="text-rose-400" /> {emp.ciudad}</span>}
                  {emp.dispatcher_phone && <span className="flex items-center gap-1.5"><Building2 size={13} className="text-amber-400" /> Despachador: {emp.dispatcher_phone}</span>}
                </div>

                {emp.prompt_personalizado && (
                  <p className="mt-2 text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2 line-clamp-2">{emp.prompt_personalizado}</p>
                )}
              </div>

              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => setVinculandoEmpresa(emp)} className="p-2 rounded-lg hover:bg-emerald-50 text-emerald-500 transition" title="Vincular Usuarios">
                  <Users size={15} />
                </button>
                <button onClick={() => openEdit(emp)} className="p-2 rounded-lg hover:bg-indigo-50 text-indigo-500 transition" title="Editar">
                  <Edit2 size={15} />
                </button>
                {userRole === 'superadmin' && (
                  <button onClick={() => handleDelete(emp.id)} className="p-2 rounded-lg hover:bg-red-50 text-red-400 transition" title="Eliminar">
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>
          ))}
          {empresas.length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <Bot size={40} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm">No hay empresas configuradas todavía.</p>
            </div>
          )}
        </div>
      )}

      {/* Modal de formulario */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">
              {editing ? `Editar: ${editing.nombre_empresa}` : 'Nueva Empresa'}
            </h2>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Nombre Empresa *</label>
                  <input className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" value={form.nombre_empresa} onChange={e => setForm(f => ({...f, nombre_empresa: e.target.value}))} placeholder="Estrella Taxis" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Nombre del Bot *</label>
                  <input className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" value={form.nombre_bot} onChange={e => setForm(f => ({...f, nombre_bot: e.target.value}))} placeholder="Pompeyo" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Tipo de Negocio</label>
                  <select 
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 capitalize" 
                    value={form.tipo_negocio} 
                    onChange={e => {
                      const newTipo = e.target.value;
                      const oldDefault = PROMPTS_POR_TIPO[form.tipo_negocio] || '';
                      setForm(f => ({
                        ...f, 
                        tipo_negocio: newTipo,
                        // Cambiar el prompt automático solo si está vacío o si tiene el default del tipo anterior
                        prompt_personalizado: (!f.prompt_personalizado || f.prompt_personalizado === oldDefault) 
                          ? (PROMPTS_POR_TIPO[newTipo] || '') 
                          : f.prompt_personalizado
                      }));
                    }}
                  >
                    {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Ciudad</label>
                  <input className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" value={form.ciudad} onChange={e => setForm(f => ({...f, ciudad: e.target.value}))} placeholder="San Cristóbal de las Casas, Chiapas" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Teléfono Telnyx *</label>
                  <input className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300" value={form.telefono_telnyx} onChange={e => setForm(f => ({...f, telefono_telnyx: e.target.value}))} placeholder="+15676031156" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">WhatsApp Despachador</label>
                  <input className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300" value={form.dispatcher_phone} onChange={e => setForm(f => ({...f, dispatcher_phone: e.target.value}))} placeholder="+529611234567" />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Paquete Contratado</label>
                <select 
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-gray-100 disabled:text-gray-500" 
                  value={form.paquete_id} 
                  onChange={e => setForm(f => ({...f, paquete_id: e.target.value}))}
                  disabled={userRole !== 'superadmin'}
                >
                  <option value="">Sin paquete asignado</option>
                  {paquetes.map(p => (
                    <option key={p.id} value={p.id}>{p.nombre} — ${p.precio_mensual}/mes</option>
                  ))}
                </select>
                {userRole !== 'superadmin' && <p className="text-[10px] text-gray-400 mt-1">Solo soporte técnico puede cambiar el paquete.</p>}
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Instrucciones del Bot (Prompt)</label>
                <textarea rows={3} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none" value={form.prompt_personalizado} onChange={e => setForm(f => ({...f, prompt_personalizado: e.target.value}))} placeholder="Servicio 24/7. Mascotas permitidas. Pago efectivo o tarjeta..." />
              </div>

              <div className="flex items-center gap-2">
                <input 
                  type="checkbox" 
                  id="activo" 
                  checked={form.activo} 
                  onChange={e => setForm(f => ({...f, activo: e.target.checked}))} 
                  className="rounded"
                  disabled={userRole !== 'superadmin'}
                />
                <label htmlFor="activo" className="text-sm text-gray-600">Empresa activa</label>
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowForm(false)} className="flex-1 border border-gray-200 text-gray-600 px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50 transition">
                Cancelar
              </button>
              <button onClick={handleSave} disabled={saving} className="flex-1 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition disabled:opacity-50 flex items-center justify-center gap-2">
                <Save size={15} /> {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Vincular Usuarios */}
      {vinculandoEmpresa && (
        <VincularUsuariosModal 
          empresa={vinculandoEmpresa} 
          onClose={() => setVinculandoEmpresa(null)} 
        />
      )}
    </div>
  );
}

// ─── Modal: Vincular Usuarios a la Empresa ────────────────────────────────────
function VincularUsuariosModal({ empresa, onClose }: { empresa: Empresa; onClose: () => void }) {
  const [users, setUsers] = useState<TraccarUser[]>([]);
  const [linkedUsers, setLinkedUsers] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingUser, setSavingUser] = useState<number | null>(null);

  useEffect(() => {
    async function loadData() {
      // 1. Cargar todos los usuarios de Traccar
      const traccarUsers = await api.getUsers();
      // Filtrar usuarios temporales
      const validUsers = traccarUsers.filter(u => !u.temporary && !u.name?.startsWith('Share:'));
      setUsers(validUsers);

      // 2. Cargar perfiles de esta empresa
      const { data } = await supabase
        .from('perfiles')
        .select('traccar_user_id, rol')
        .eq('empresa_id', empresa.id);
      
      const linked: Record<number, string> = {};
      if (data) data.forEach(p => { linked[p.traccar_user_id] = p.rol; });
      setLinkedUsers(linked);
      
      setLoading(false);
    }
    loadData();
  }, [empresa.id]);

  const toggleUser = async (user: TraccarUser) => {
    const isLinked = !!linkedUsers[user.id];
    setSavingUser(user.id);

    try {
      if (isLinked) {
        // Desvincular
        const { error } = await supabase.from('perfiles').delete().match({ traccar_user_id: user.id, empresa_id: empresa.id });
        if (error) throw error;
        setLinkedUsers(prev => { const s = { ...prev }; delete s[user.id]; return s; });
      } else {
        // Vincular (o actualizar) por defecto como operador
        const payload = { traccar_user_id: user.id, empresa_id: empresa.id, rol: 'operador' };
        const { error } = await supabase.from('perfiles').upsert(payload, { onConflict: 'traccar_user_id' });
        if (error) throw error;
        setLinkedUsers(prev => ({ ...prev, [user.id]: 'operador' }));
      }
    } catch (err) {
      toast.error('Error al modificar vinculación.');
      console.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingUser(null);
    }
  };

  const changeRole = async (user: TraccarUser, newRole: string) => {
    setSavingUser(user.id);
    try {
      const payload = { traccar_user_id: user.id, empresa_id: empresa.id, rol: newRole };
      const { error } = await supabase.from('perfiles').upsert(payload, { onConflict: 'traccar_user_id' });
      if (error) throw error;
      setLinkedUsers(prev => ({ ...prev, [user.id]: newRole }));
    } catch (err) {
      toast.error('Error al cambiar rol.');
      console.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingUser(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900">Usuarios en {empresa.nombre_empresa}</h2>
            <p className="text-xs text-gray-400 mt-0.5">Asigna usuarios a esta empresa (Tenant)</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        
        <div className="overflow-y-auto flex-1 bg-gray-50/30">
          {loading ? (
            <div className="p-10 text-center text-sm text-gray-400">Cargando usuarios...</div>
          ) : users.length === 0 ? (
            <div className="p-10 text-center text-sm text-gray-400">No hay usuarios en el sistema.</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {users.map(user => {
                const isLinked = !!linkedUsers[user.id];
                const userRole = linkedUsers[user.id];
                const isSaving = savingUser === user.id;
                
                return (
                  <div key={user.id} className={`flex items-center justify-between px-6 py-3 transition-colors ${isLinked ? 'bg-indigo-50/50' : 'hover:bg-gray-50'}`}>
                    <div>
                      <p className="text-sm font-bold text-gray-800">{user.name}</p>
                      <p className="text-xs text-gray-500">{user.email}</p>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {isLinked && (
                        <select 
                          className="text-xs border border-indigo-100 rounded-lg px-2 py-1.5 bg-white text-indigo-700 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-300"
                          value={userRole}
                          onChange={(e) => changeRole(user, e.target.value)}
                          disabled={isSaving}
                        >
                          <option value="operador">Operador</option>
                          <option value="admin_empresa">Admin Empresa</option>
                        </select>
                      )}

                      <button 
                        onClick={() => toggleUser(user)} 
                        disabled={isSaving}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          isLinked 
                            ? 'bg-indigo-100 text-indigo-700 hover:bg-red-50 hover:text-red-600' 
                            : 'bg-white border border-gray-200 text-gray-600 hover:border-indigo-500 hover:text-indigo-600'
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
                  </div>
                );
              })}
            </div>
          )}
        </div>
        
        <div className="px-6 py-4 border-t border-gray-100 bg-white flex justify-end flex-shrink-0">
          <button onClick={onClose} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition">
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}
