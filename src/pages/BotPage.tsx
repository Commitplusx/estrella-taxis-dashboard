import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { api, type TraccarUser } from '../lib/traccarApi';
import { Link } from 'react-router-dom';
import { Phone, Bot, Building2, MapPin, Save, Plus, Trash2, Edit2, Users, X, Package } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

interface Empresa {
  id: string;
  nombre_empresa: string;
  nombre_bot: string;
  tipo_negocio: string;
  telefono_telnyx: string;
  telefono_whatsapp: string | null;
  dispatcher_phone: string | null;
  prompt_personalizado: string | null;
  ciudad: string | null;
  activo: boolean;
  ignored_phones?: string[] | null;
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
  telefono_whatsapp: '',
  dispatcher_phone: '',
  ciudad: '',
  prompt_personalizado: '',
  activo: true,
};

export default function BotPage() {
  const { userRole, empresaId } = useAuth();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Empresa | null>(null);
  const [vinculandoEmpresa, setVinculandoEmpresa] = useState<Empresa | null>(null);
  const [managingExceptions, setManagingExceptions] = useState<Empresa | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);

  const loadEmpresas = useCallback(async (): Promise<Empresa[]> => {
    let empresaQuery = supabase.from('empresas').select('*').order('created_at', { ascending: false });
    
    // Si es admin_empresa, solo ve la suya
    if (userRole === 'admin_empresa') {
      if (empresaId) {
        empresaQuery = empresaQuery.eq('id', empresaId);
      } else {
        // Fallback de seguridad: si por alguna razón no tiene empresa_id, no mostrar NADA.
        empresaQuery = empresaQuery.eq('id', '00000000-0000-0000-0000-000000000000');
      }
    }

    const empRes = await empresaQuery;
    if (empRes.error) throw empRes.error;
    return empRes.data || [];
  }, [userRole, empresaId]);

  useEffect(() => {
    if (userRole !== 'superadmin' && userRole !== 'admin_empresa') return;
    let active = true;
    loadEmpresas().then(rows => {
      if (active) setEmpresas(rows);
    }).catch((error: unknown) => {
      if (active) toast.error('No pudimos cargar las bases: ' + (error instanceof Error ? error.message : String(error)));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [userRole, loadEmpresas]);

  const fetchEmpresas = async () => {
    setLoading(true);
    try {
      setEmpresas(await loadEmpresas());
    } catch (error: unknown) {
      toast.error('No pudimos cargar las bases: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setLoading(false);
    }
  };

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
      telefono_whatsapp: emp.telefono_whatsapp || '',
      dispatcher_phone: emp.dispatcher_phone || '',
      ciudad: emp.ciudad || '',
      prompt_personalizado: emp.prompt_personalizado || '',
      activo: emp.activo,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.nombre_empresa) {
      toast.error('El nombre de la empresa es obligatorio.');
      return;
    }

    if ((form.telefono_telnyx.trim() || form.telefono_whatsapp.trim()) && !form.nombre_bot.trim()) {
      toast.error('Escribe el nombre del bot para configurar sus canales.');
      return;
    }

    setSaving(true);
    const payload = {
      ...form,
      nombre_bot: form.nombre_bot.trim() || 'N/A',
      telefono_telnyx: form.telefono_telnyx.trim() || 'N/A',
      telefono_whatsapp: form.telefono_whatsapp.trim() || null,
      dispatcher_phone: form.dispatcher_phone || null,
      prompt_personalizado: form.prompt_personalizado || null,
      ciudad: form.ciudad || null,
    };

    if (editing) {
      const { error } = await supabase.from('empresas').update(payload).eq('id', editing.id);
      if (error) {
        toast.error('Error al actualizar: ' + error.message);
        setSaving(false);
        return; // No cerrar el form si falló
      }
      toast.success('Empresa actualizada ✅');
    } else {
      const { error } = await supabase.from('empresas').insert(payload);
      if (error) {
        toast.error('Error al crear. ¿El teléfono ya existe? ' + error.message);
        setSaving(false);
        return; // No cerrar el form si falló
      }
      toast.success('Empresa creada 🎉');
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
    // Optimistic update: voltear el interruptor inmediatamente
    setEmpresas(prev => prev.map(emp => emp.id === e.id ? { ...emp, activo: !emp.activo } : emp));
    const { error } = await supabase.from('empresas').update({ activo: !e.activo }).eq('id', e.id);
    if (error) {
      // Revertir si falló
      setEmpresas(prev => prev.map(emp => emp.id === e.id ? { ...emp, activo: e.activo } : emp));
      toast.error('Error al cambiar el estado.');
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full font-sans">
      {/* Header Limpio */}
      {!showForm && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Bot className="text-gray-400" size={24} />
              Bases y canales
            </h1>
            <p className="text-sm text-gray-500 mt-1">Configura los datos y canales de cada base.</p>
          </div>
          {userRole === 'superadmin' && (
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <Link to="/packages#asignacion" className="flex items-center gap-2 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors justify-center">
                <Package size={16} /> Asignar planes
              </Link>
              <button
                onClick={openCreate}
                className="flex items-center gap-2 bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors shadow-sm justify-center"
              >
                <Plus size={16} /> Nueva base
              </button>
            </div>
          )}
        </div>
      )}

      {/* Lista de empresas (Full Width) */}
      {!showForm && (
        loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin"></div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {empresas.map(emp => (
              <div key={emp.id} className="bg-white rounded-2xl p-5 sm:p-6 border border-gray-200 shadow-sm hover:shadow-md transition-shadow flex flex-col lg:flex-row gap-6">
                
                {/* Info Principal */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${emp.activo ? 'bg-green-500' : 'bg-gray-300'}`} title={emp.activo ? 'Activo' : 'Inactivo'} />
                    <h3 className="text-xl font-bold text-gray-900 leading-tight truncate">{emp.nombre_empresa}</h3>
                    
                    {/* Badges Escritorio */}
                    <div className="hidden sm:flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider bg-gray-100 px-2.5 py-1 rounded-md">{emp.tipo_negocio}</span>
                    </div>
                  </div>
                  
                  {/* Badges Móvil */}
                  <div className="flex sm:hidden items-center gap-2 mb-5">
                    <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider bg-gray-100 px-2.5 py-1 rounded-md">{emp.tipo_negocio}</span>
                  </div>

                  {/* Grid de Datos (Bot, WA, etc) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-y-4 gap-x-6 text-sm">
                    <div className="flex flex-col">
                       <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1"><Bot size={12}/> Bot IA</span>
                       <span className="font-medium text-gray-900 truncate">{emp.nombre_bot}</span>
                    </div>
                    
                    <div className="flex flex-col">
                       <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1"><Phone size={12}/> Voz</span>
                       <span className="font-medium text-gray-900 truncate">{emp.telefono_telnyx || 'N/A'}</span>
                    </div>

                    {emp.telefono_whatsapp && (
                      <div className="flex flex-col">
                         <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1"><Phone size={12} className="text-green-500"/> WhatsApp</span>
                         <span className="font-medium text-gray-900 truncate">{emp.telefono_whatsapp}</span>
                      </div>
                    )}

                    {emp.dispatcher_phone && (
                      <div className="flex flex-col">
                         <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1"><Building2 size={12} className="text-orange-400"/> Despachador</span>
                         <span className="font-medium text-gray-900 truncate">{emp.dispatcher_phone}</span>
                      </div>
                    )}

                    {emp.ciudad && (
                      <div className="flex flex-col sm:col-span-2 md:col-span-3 xl:col-span-4 mt-1">
                         <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1"><MapPin size={12} className="text-red-400"/> Ubicación</span>
                         <span className="font-medium text-gray-900 truncate">{emp.ciudad}</span>
                      </div>
                    )}
                  </div>

                  {/* Prompt */}
                  {emp.prompt_personalizado && (
                    <div className="mt-5 bg-gray-50 rounded-lg p-3.5 border border-gray-100">
                      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Prompt Base</p>
                      <p className="text-xs text-gray-700 line-clamp-3 leading-relaxed font-mono">{emp.prompt_personalizado}</p>
                    </div>
                  )}
                </div>

                {/* Acciones */}
                <div className="flex flex-row lg:flex-col items-center justify-end gap-2 shrink-0 border-t lg:border-t-0 lg:border-l border-gray-100 pt-4 lg:pt-0 lg:pl-6 mt-2 lg:mt-0">
                  <button onClick={() => toggleActivo(emp)} className="flex items-center justify-center gap-2 w-full p-2.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors" title={emp.activo ? 'Desactivar' : 'Activar'}>
                    <Bot size={18} className={emp.activo ? 'text-green-500' : 'text-gray-400'} />
                    <span className="hidden lg:inline">{emp.activo ? 'Desactivar' : 'Activar'}</span>
                  </button>
                  <button onClick={() => setManagingExceptions(emp)} className="flex items-center justify-center gap-2 w-full p-2.5 text-sm font-medium text-gray-600 hover:text-red-800 hover:bg-gray-100 rounded-lg transition-colors" title="Excepciones">
                    <Phone size={18} className="text-gray-400" />
                    <span className="hidden lg:inline">Excepciones</span>
                  </button>
                  <button onClick={() => setVinculandoEmpresa(emp)} className="flex items-center justify-center gap-2 w-full p-2.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors" title="Usuarios">
                    <Users size={18} className="text-gray-400" />
                    <span className="hidden lg:inline">Usuarios</span>
                  </button>
                  <button onClick={() => openEdit(emp)} className="flex items-center justify-center gap-2 w-full p-2.5 text-sm font-medium text-gray-600 hover:text-blue-800 hover:bg-gray-100 rounded-lg transition-colors" title="Editar">
                    <Edit2 size={18} className="text-gray-400" />
                    <span className="hidden lg:inline">Editar</span>
                  </button>
                  {userRole === 'superadmin' && (
                    <button onClick={() => handleDelete(emp.id)} className="flex items-center justify-center gap-2 w-full p-2.5 text-sm font-medium text-gray-600 hover:text-red-800 hover:bg-gray-100 rounded-lg transition-colors" title="Eliminar">
                      <Trash2 size={18} className="text-gray-400" />
                      <span className="hidden lg:inline">Eliminar</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
            {empresas.length === 0 && (
              <div className="w-full py-16 text-center border-2 border-dashed border-gray-200 rounded-2xl bg-gray-50/50">
                <p className="text-gray-500 text-sm font-medium">No hay empresas configuradas todavía.</p>
              </div>
            )}
          </div>
        )
      )}

      {/* Formulario Limpio */}
      {showForm && (() => {
        return (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm w-full max-w-4xl mx-auto overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {editing ? 'Editar Empresa' : 'Nueva Empresa'}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">Configura los datos del inquilino.</p>
              </div>
              <button onClick={() => setShowForm(false)} className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="text-xs font-semibold text-gray-700 mb-1.5 block uppercase tracking-wide">Nombre de la Empresa *</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm" value={form.nombre_empresa} onChange={e => setForm(f => ({...f, nombre_empresa: e.target.value}))} placeholder="Ej. Taxis Estrella" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 mb-1.5 block uppercase tracking-wide">Nombre del bot (si aplica)</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm" value={form.nombre_bot} onChange={e => setForm(f => ({...f, nombre_bot: e.target.value}))} placeholder="Ej. Pompeyo" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 mb-1.5 block uppercase tracking-wide">Tipo de Negocio</label>
                  <select 
                    className="w-full border border-gray-300 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white shadow-sm" 
                    value={form.tipo_negocio} 
                    onChange={e => {
                      const newTipo = e.target.value;
                      const oldDefault = PROMPTS_POR_TIPO[form.tipo_negocio] || '';
                      setForm(f => ({
                        ...f, 
                        tipo_negocio: newTipo,
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
                  <label className="text-xs font-semibold text-gray-700 mb-1.5 block uppercase tracking-wide">Ciudad de Operación</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm" value={form.ciudad} onChange={e => setForm(f => ({...f, ciudad: e.target.value}))} placeholder="San Cristóbal de las Casas" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-6 border-t border-gray-100">
                <div>
                  <label className="text-xs font-semibold text-gray-700 mb-1.5 block uppercase tracking-wide">Teléfono Voz (Telnyx)</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm" value={form.telefono_telnyx} onChange={e => setForm(f => ({...f, telefono_telnyx: e.target.value}))} placeholder="+15676031156" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 mb-1.5 block uppercase tracking-wide">WhatsApp IA (YCloud)</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm" value={form.telefono_whatsapp} onChange={e => setForm(f => ({...f, telefono_whatsapp: e.target.value}))} placeholder="+529611234567" />
                </div>
                <div className="col-span-1 md:col-span-2">
                  <label className="text-xs font-semibold text-gray-700 mb-1.5 block uppercase tracking-wide">WhatsApp Despachador (Humano)</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm" value={form.dispatcher_phone} onChange={e => setForm(f => ({...f, dispatcher_phone: e.target.value}))} placeholder="+529611234567" />
                </div>
              </div>

              <div className="pt-6 border-t border-gray-100">
                <label className="text-xs font-semibold text-gray-700 mb-1.5 block uppercase tracking-wide">Prompt base del bot (si aplica)</label>
                <textarea rows={5} className="w-full border border-gray-300 rounded-lg px-3.5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono shadow-sm bg-gray-50 focus:bg-white transition-colors" value={form.prompt_personalizado} onChange={e => setForm(f => ({...f, prompt_personalizado: e.target.value}))} />
              </div>

              <div className="flex items-center gap-3">
                <input 
                  type="checkbox" 
                  id="activo" 
                  checked={form.activo} 
                  onChange={e => setForm(f => ({...f, activo: e.target.checked}))} 
                  className="w-4 h-4 text-gray-900 rounded border-gray-300 focus:ring-gray-900"
                  disabled={userRole !== 'superadmin'}
                />
                <label htmlFor="activo" className="text-sm font-medium text-gray-900 cursor-pointer">Empresa Activa</label>
              </div>

              <div className="flex justify-end gap-3 pt-6 border-t border-gray-100 mt-6">
                <button onClick={() => setShowForm(false)} className="px-5 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                  Cancelar
                </button>
                <button onClick={handleSave} disabled={saving} className="px-5 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-black disabled:opacity-50 flex items-center gap-2 transition-colors shadow-sm">
                  <Save size={16} /> {saving ? 'Guardando...' : 'Guardar Empresa'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal Vincular Usuarios Limpio */}
      {vinculandoEmpresa && (
        <VincularUsuariosModal 
          empresa={vinculandoEmpresa} 
          onClose={() => setVinculandoEmpresa(null)} 
        />
      )}

      {/* Modal Excepciones (Ignorados) */}
      {managingExceptions && (
        <ManageExceptionsModal 
          empresa={managingExceptions} 
          onClose={() => { setManagingExceptions(null); fetchEmpresas(); }} 
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
      const traccarUsers = await api.getUsers();
      const validUsers = traccarUsers.filter(u => !u.temporary && !u.name?.startsWith('Share:'));
      setUsers(validUsers);

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
        const { error } = await supabase.from('perfiles').delete().match({ traccar_user_id: user.id, empresa_id: empresa.id });
        if (error) throw error;
        setLinkedUsers(prev => { const s = { ...prev }; delete s[user.id]; return s; });
      } else {
        const payload = { traccar_user_id: user.id, empresa_id: empresa.id, rol: 'operador' };
        const { error } = await supabase.from('perfiles').upsert(payload, { onConflict: 'traccar_user_id' });
        if (error) throw error;
        setLinkedUsers(prev => ({ ...prev, [user.id]: 'operador' }));
      }
    } catch (err) {
      toast.error('Error al modificar vinculación.');
      console.error(err);
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
      console.error(err);
    } finally {
      setSavingUser(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-auto flex flex-col max-h-[85vh]">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">Usuarios en {empresa.nombre_empresa}</h2>
            <p className="text-xs text-gray-500 mt-0.5">Asigna usuarios a esta empresa</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"><X size={18} /></button>
        </div>
        
        <div className="overflow-y-auto flex-1 p-2">
          {loading ? (
            <div className="flex justify-center items-center h-32">
               <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin"></div>
            </div>
          ) : users.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">No hay usuarios en el sistema.</div>
          ) : (
            <div className="space-y-1">
              {users.map(user => {
                const isLinked = !!linkedUsers[user.id];
                const userRole = linkedUsers[user.id];
                const isSaving = savingUser === user.id;
                
                return (
                  <div key={user.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{user.name}</p>
                      <p className="text-xs text-gray-500">{user.email}</p>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      {isLinked && (
                        <select 
                          className="text-xs border border-gray-300 rounded-md px-2 py-1.5 bg-white text-gray-700 font-medium focus:outline-none focus:ring-1 focus:ring-blue-500"
                          value={userRole}
                          onChange={(e) => changeRole(user, e.target.value)}
                          disabled={isSaving}
                        >
                          <option value="operador">Operador</option>
                          <option value="admin_empresa">Admin</option>
                        </select>
                      )}

                      <button 
                        onClick={() => toggleUser(user)} 
                        disabled={isSaving}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium min-w-[70px] transition-colors ${
                          isLinked 
                            ? 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100' 
                            : 'bg-gray-900 text-white hover:bg-black'
                        } disabled:opacity-50 flex justify-center`}
                      >
                        {isSaving ? (
                          <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        ) : isLinked ? (
                          'Asignado'
                        ) : (
                          'Asignar'
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Excepciones (Ignorados) ──────────────────────────────────────────
function ManageExceptionsModal({ empresa, onClose }: { empresa: Empresa; onClose: () => void }) {
  const [phones, setPhones] = useState<string[]>(empresa.ignored_phones || []);
  const [newPhone, setNewPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    const p = newPhone.trim();
    if (!p) return;
    if (phones.includes(p)) {
      toast.error('El número ya está en la lista.');
      return;
    }
    const newPhonesList = [...phones, p];
    
    // Guardado inmediato y optimista
    setPhones(newPhonesList);
    setNewPhone('');
    
    setSaving(true);
    const { error } = await supabase.from('empresas').update({ ignored_phones: newPhonesList }).eq('id', empresa.id);
    setSaving(false);
    
    if (error) {
      toast.error('Error al guardar excepción: ' + error.message);
      // Revertir
      setPhones(phones);
    } else {
      toast.success('Número bloqueado añadido.');
    }
  };

  const handleRemove = async (index: number) => {
    const pToRemove = phones[index];
    const newPhonesList = phones.filter((_, i) => i !== index);
    
    // Guardado inmediato y optimista
    setPhones(newPhonesList);
    
    setSaving(true);
    const { error } = await supabase.from('empresas').update({ ignored_phones: newPhonesList }).eq('id', empresa.id);
    setSaving(false);
    
    if (error) {
      toast.error('Error al remover excepción.');
      // Revertir
      setPhones([...newPhonesList, pToRemove]);
    } else {
      toast.success('Número desbloqueado.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-gray-100 bg-gray-50/80">
          <div>
            <h3 className="text-lg font-bold text-gray-900 leading-tight">Excepciones del Bot</h3>
            <p className="text-sm text-gray-500 mt-0.5">El bot ignorará por completo estos números.</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50" disabled={saving}>
            <X size={20} />
          </button>
        </div>

        <div className="p-4 sm:p-5 flex-1 overflow-y-auto">
          <div className="flex gap-2 mb-6">
            <input 
              className="flex-1 border border-gray-300 rounded-lg px-3.5 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm" 
              value={newPhone} 
              onChange={e => setNewPhone(e.target.value)} 
              placeholder="Ej. +521234567890"
              disabled={saving}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAdd();
                }
              }}
            />
            <button 
              onClick={handleAdd}
              disabled={saving || !newPhone.trim()}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-black transition-colors flex items-center gap-2 border border-transparent disabled:opacity-50"
            >
              <Plus size={16} /> Agregar
            </button>
          </div>
          
          {phones.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {phones.map((phone, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-red-50 text-red-700 border border-red-100 shadow-sm">
                  <Phone size={12} className="text-red-400" />
                  <span className="font-mono">{phone}</span>
                  <button 
                    onClick={() => handleRemove(i)}
                    disabled={saving}
                    className="p-0.5 hover:bg-red-200 rounded-full transition-colors ml-1 disabled:opacity-50"
                    title="Desbloquear"
                  >
                    <X size={14} />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-400 bg-gray-50 border border-dashed border-gray-200 rounded-lg p-6 text-center">
              No hay números bloqueados.
            </div>
          )}
        </div>

        <div className="p-4 sm:p-5 border-t border-gray-100 bg-white flex justify-between items-center gap-3 shrink-0">
          <div className="text-xs text-gray-400 flex items-center gap-1.5">
            {saving ? (
              <span className="text-blue-500 animate-pulse">Guardando...</span>
            ) : (
              <span>Se guarda automáticamente</span>
            )}
          </div>
          <button onClick={onClose} disabled={saving} className="px-5 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
