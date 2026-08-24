import React, { useEffect, useState } from 'react';
import { api, type TraccarUser, type TraccarDevice } from '../lib/traccarApi';
import { supabase } from '../lib/supabase';
import { Users, Plus, Trash2, Link, X, Check, Shield, ChevronRight, ChevronDown, Eye, EyeOff, Layers, Search, Filter, Camera } from 'lucide-react';

// ─── Modal: Crear Usuario ──────────────────────────────────────────────────────
function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: (u: TraccarUser) => void }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', administrator: false, deviceLimit: -1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPass, setShowPass] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const created = await api.createUser(form);

      // Llamar a Supabase Edge Function para enviar correo de bienvenida (sin bloquear si falla)
      supabase.functions.invoke('welcome-email', {
        body: { name: form.name, email: form.email, password: form.password }
      }).catch(err => console.error('Error enviando correo de bienvenida:', err));

      onCreated(created);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al crear usuario');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-[fadeSlideUp_0.2s_ease]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Nuevo Usuario</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>
          )}
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Nombre completo</label>
            <input
              required
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Juan Pérez"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Correo electrónico</label>
            <input
              required
              type="email"
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="juan@correo.com"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Contraseña</label>
            <div className="relative">
              <input
                required
                type={showPass ? 'text' : 'password'}
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
                placeholder="••••••••"
              />
              <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-xl">
            <input
              type="checkbox"
              id="admin"
              checked={form.administrator}
              onChange={e => setForm({ ...form, administrator: e.target.checked })}
              className="w-4 h-4 accent-blue-600"
            />
            <label htmlFor="admin" className="text-sm text-amber-800 font-medium">
              <Shield size={13} className="inline mr-1 mb-0.5" />
              Administrador (acceso total)
            </label>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition">
              Cancelar
            </button>
            <button type="submit" disabled={loading} className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition disabled:opacity-60">
              {loading ? 'Creando...' : 'Crear Usuario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Modal: Asignar Taxis y Categorías ──────────────────────────────────────────
function AssignDevicesModal({ user, onClose }: { user: TraccarUser; onClose: () => void }) {
  const [allDevices, setAllDevices] = useState<TraccarDevice[]>([]);
  const [allGroups, setAllGroups] = useState<{ id: number, name: string }[]>([]);
  const [linkedDevices, setLinkedDevices] = useState<Set<number>>(new Set());
  const [linkedGroups, setLinkedGroups] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'devices' | 'groups'>('groups');

  useEffect(() => {
    async function load() {
      const [allDevs, userDevs, allGrps, userGrps] = await Promise.all([
        api.getAllDevices(),
        api.getUserDevices(user.id),
        api.getGroups(),
        api.getUserGroups(user.id)
      ]);
      setAllDevices(allDevs);
      setLinkedDevices(new Set(userDevs.map(d => d.id)));
      setAllGroups(allGrps);
      setLinkedGroups(new Set(userGrps.map(g => g.id)));
      setLoading(false);
    }
    load();
  }, [user.id]);

  const toggleDevice = async (deviceId: number) => {
    setSaving(`dev-${deviceId}`);
    try {
      if (linkedDevices.has(deviceId)) {
        await api.unlinkDeviceFromUser(user.id, deviceId);
        setLinkedDevices(prev => { const s = new Set(prev); s.delete(deviceId); return s; });
      } else {
        await api.linkDeviceToUser(user.id, deviceId);
        setLinkedDevices(prev => new Set(prev).add(deviceId));
      }
    } catch (e: unknown) {
      console.error(e);
      const msg = e instanceof Error ? e.message : 'Error desconocido';
      alert('Error: ' + msg);
    } finally {
      setSaving(null);
    }
  };

  const toggleGroup = async (groupId: number) => {
    setSaving(`grp-${groupId}`);
    try {
      if (linkedGroups.has(groupId)) {
        await api.unlinkGroupFromUser(user.id, groupId);
        setLinkedGroups(prev => { const s = new Set(prev); s.delete(groupId); return s; });
      } else {
        await api.linkGroupToUser(user.id, groupId);
        setLinkedGroups(prev => new Set(prev).add(groupId));
      }
    } catch (e: unknown) {
      console.error(e);
      const msg = e instanceof Error ? e.message : 'Error desconocido';
      alert('Error: ' + msg);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex flex-col border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center justify-between px-6 py-4">
            <div>
              <h2 className="text-base font-bold text-gray-900">Permisos de {user.name}</h2>
              <p className="text-xs text-gray-400 mt-0.5">Asigna categorías completas o taxis individuales</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X size={18} /></button>
          </div>
          <div className="flex px-6 gap-6">
            <button
              onClick={() => setTab('groups')}
              className={`pb-3 text-sm font-semibold transition-colors border-b-2 ${tab === 'groups' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              Categorías ({linkedGroups.size})
            </button>
            <button
              onClick={() => setTab('devices')}
              className={`pb-3 text-sm font-semibold transition-colors border-b-2 ${tab === 'devices' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              Taxis Individuales ({linkedDevices.size})
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 bg-gray-50/30">
          {loading ? (
            <div className="animate-pulse flex flex-col divide-y divide-gray-50">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex items-center justify-between p-6">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-200"></div>
                    <div className="h-4 w-32 bg-gray-200 rounded"></div>
                  </div>
                  <div className="h-8 w-24 bg-gray-100 rounded-xl"></div>
                </div>
              ))}
            </div>
          ) : tab === 'groups' ? (
            <div className="divide-y divide-gray-50">
              {allGroups.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-400">No hay categorías registradas en el sistema.</div>
              ) : allGroups.map(group => {
                const isLinked = linkedGroups.has(group.id);
                const isSaving = saving === `grp-${group.id}`;
                return (
                  <div key={group.id} className={`flex items-center justify-between px-6 py-4 transition-colors ${isLinked ? 'bg-blue-50/50' : 'hover:bg-gray-50'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${isLinked ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
                        <Layers size={16} />
                      </div>
                      <p className="text-sm font-bold text-gray-800">{group.name}</p>
                    </div>
                    <button onClick={() => toggleGroup(group.id)} disabled={saving !== null}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        isLinked ? 'bg-blue-100 text-blue-700 hover:bg-red-50 hover:text-red-600' : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-500 hover:text-blue-600'
                      } disabled:opacity-50`}
                    >
                      {isSaving ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> : isLinked ? <><Check size={12} /> Asignado</> : <><Plus size={12} /> Asignar</>}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {allDevices.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-400">No hay taxis registrados en el sistema.</div>
              ) : allDevices.map(device => {
                const isLinked = linkedDevices.has(device.id);
                const isSaving = saving === `dev-${device.id}`;
                return (
                  <div key={device.id} className={`flex items-center justify-between px-6 py-3 transition-colors ${isLinked ? 'bg-blue-50/50' : 'hover:bg-gray-50'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${device.status === 'online' ? 'bg-green-500' : 'bg-gray-300'}`} />
                      <div>
                        <p className="text-sm font-medium text-gray-800">{device.name}</p>
                        <p className="text-xs text-gray-400">{device.uniqueId}</p>
                      </div>
                    </div>
                    <button onClick={() => toggleDevice(device.id)} disabled={saving !== null}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        isLinked ? 'bg-blue-100 text-blue-700 hover:bg-red-50 hover:text-red-600' : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-500 hover:text-blue-600'
                      } disabled:opacity-50`}
                    >
                      {isSaving ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> : isLinked ? <><Check size={12} /> Asignado</> : <><Plus size={12} /> Asignar</>}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 bg-white flex justify-end flex-shrink-0">
          <button onClick={onClose} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition">
            Hecho
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal de Usuarios ─────────────────────────────────────────────
export default function UsersPage() {
  const [users, setUsers] = useState<TraccarUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [assigningUser, setAssigningUser] = useState<TraccarUser | null>(null);
  const [expandedUser, setExpandedUser] = useState<number | null>(null);
  const [deviceCounts, setDeviceCounts] = useState<Record<number, number>>({});

  // Filtros
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'user'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  useEffect(() => {
    api.getUsers()
      .then(setUsers)
      .finally(() => setLoading(false));
  }, []);

  const loadDeviceCount = async (userId: number) => {
    if (deviceCounts[userId] !== undefined) return;
    const devs = await api.getUserDevices(userId);
    setDeviceCounts(prev => ({ ...prev, [userId]: devs.length }));
  };

  const handleCreated = (user: TraccarUser) => {
    setUsers(prev => [...prev, user]);
  };

  const handleDelete = async (userId: number) => {
    if (!confirm('¿Eliminar este usuario? Esta acción no se puede deshacer.')) return;
    await api.deleteUser(userId);
    setUsers(prev => prev.filter(u => u.id !== userId));
  };

  const handleAvatarUpload = async (user: TraccarUser, file: File) => {
    try {
      // 1. Subir a Supabase Storage
      const fileExt = file.name.split('.').pop();
      const fileName = `user_${user.id}_${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      // 2. Obtener la URL pública
      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

      const publicUrl = urlData.publicUrl;

      // 3. Guardar solo la URL en Traccar (pesa ~70 caracteres, nunca rompe el límite)
      const updatedUser = {
        ...user,
        attributes: { ...(user.attributes || {}), avatar: publicUrl }
      };
      const result = await api.updateUser(user.id, updatedUser);
      setUsers(prev => prev.map(u => u.id === user.id ? result : u));
    } catch (error: unknown) {
      console.error(error);
      const msg = error instanceof Error ? error.message : String(error);
      alert('Error detallado al subir imagen: ' + msg);
    }
  };

  const filteredUsers = users.filter(user => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = user.name?.toLowerCase().includes(q) || (user.email || '').toLowerCase().includes(q);
    const matchesRole = roleFilter === 'all' || (roleFilter === 'admin' && user.administrator) || (roleFilter === 'user' && !user.administrator);
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' && !user.disabled) || (statusFilter === 'inactive' && user.disabled);
    return matchesSearch && matchesRole && matchesStatus;
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Usuarios</h1>
          <p className="text-sm text-gray-500 mt-0.5">{users.length} usuario{users.length !== 1 ? 's' : ''} registrado{users.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition shadow-sm self-start sm:self-auto"
        >
          <Plus size={16} /> Nuevo Usuario
        </button>
      </div>

      {/* Métricas Top (Enterprise Style) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
            <Users size={24} />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Total Usuarios</p>
            <h3 className="text-2xl font-bold text-gray-900">{users.length}</h3>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600">
            <Shield size={24} />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Administradores</p>
            <h3 className="text-2xl font-bold text-gray-900">{users.filter(u => u.administrator).length}</h3>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center text-amber-600">
            <Layers size={24} />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Operativos</p>
            <h3 className="text-2xl font-bold text-gray-900">{users.filter(u => !u.administrator).length}</h3>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-sm flex flex-col sm:flex-row gap-4 mb-2">
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search size={16} className="text-gray-400" />
          </div>
          <input
            type="text"
            placeholder="Buscar por nombre o correo..."
            className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-transparent focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-xl text-sm transition-all outline-none"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-4">
          <div className="relative">
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as any)}
              className="appearance-none pl-4 pr-10 py-2.5 bg-gray-50 border border-transparent focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-xl text-sm text-gray-700 font-medium transition-all outline-none cursor-pointer"
            >
              <option value="all">Todos los Roles</option>
              <option value="admin">Administradores</option>
              <option value="user">Operativos</option>
            </select>
            <Filter size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
          <div className="relative">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="appearance-none pl-4 pr-10 py-2.5 bg-gray-50 border border-transparent focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-xl text-sm text-gray-700 font-medium transition-all outline-none cursor-pointer"
            >
              <option value="all">Cualquier Estado</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
            </select>
            <Filter size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Enterprise List View */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="animate-pulse flex flex-col divide-y divide-gray-100">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center justify-between p-6">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-gray-100 rounded-full"></div>
                  <div className="space-y-2">
                    <div className="h-4 w-32 bg-gray-200 rounded"></div>
                    <div className="h-3 w-48 bg-gray-100 rounded"></div>
                  </div>
                </div>
                <div className="h-8 w-24 bg-gray-100 rounded-xl"></div>
              </div>
            ))}
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <Users size={32} className="text-gray-300" />
            </div>
            <h3 className="text-sm font-bold text-gray-900 mb-1">No se encontraron usuarios</h3>
            <p className="text-sm text-gray-500">Prueba cambiando los filtros de búsqueda.</p>
          </div>
        ) : (
          <div className="bg-white md:bg-transparent md:border-none md:shadow-none rounded-2xl border border-gray-100 shadow-sm overflow-hidden md:overflow-visible">
            {/* Vista Móvil (Tarjetas) */}
            <div className="md:hidden flex flex-col divide-y divide-gray-100">
              {filteredUsers.map(user => (
                <div 
                  key={user.id} 
                  className="p-4 flex flex-col gap-4 hover:bg-gray-50 transition-colors cursor-pointer"
                  onClick={() => setAssigningUser(user)}
                >
                  <div className="flex items-start gap-4">
                    <label 
                      className="relative w-12 h-12 flex-shrink-0 cursor-pointer group/avatar"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {user.attributes?.avatar ? (
                        <img 
                          src={user.attributes.avatar as string} 
                          alt={user.name} 
                          className="w-full h-full object-cover rounded-full shadow-sm ring-1 ring-inset ring-gray-200"
                        />
                      ) : (
                        <div className={`w-full h-full rounded-full flex items-center justify-center font-bold text-lg shadow-sm ring-1 ring-inset ${
                          user.administrator 
                            ? 'bg-amber-50 text-amber-600 ring-amber-600/20' 
                            : 'bg-blue-50 text-blue-600 ring-blue-600/20'
                        }`}>
                          {user.name?.charAt(0)?.toUpperCase() || 'U'}
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/50 rounded-full opacity-0 flex items-center justify-center transition-opacity">
                        <Camera size={14} className="text-white" />
                      </div>
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            handleAvatarUpload(user, e.target.files[0]);
                          }
                          e.target.value = ''; 
                        }}
                      />
                    </label>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="font-bold text-gray-900 truncate">{user.name}</div>
                      <div className="text-xs text-gray-500 truncate mb-2">{user.email}</div>
                      
                      <div className="flex flex-wrap items-center gap-2">
                        {user.administrator ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-bold bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20">
                            <Shield size={10} /> Admin
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-bold bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-500/10">
                            <Users size={10} /> Operativo
                          </span>
                        )}
                        
                        {user.disabled ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-red-600 bg-red-50 px-2 py-1 rounded-md">
                            Inactivo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">
                            Activo
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {expandedUser === user.id && (
                    <div className="flex items-center justify-between pt-3 border-t border-gray-100 mt-1 animate-fade-in" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-gray-500 border border-gray-100">
                          <Layers size={14} />
                        </div>
                        <div onMouseEnter={() => loadDeviceCount(user.id)} onClick={() => loadDeviceCount(user.id)}>
                          <p className="text-sm font-bold text-gray-700">
                            {deviceCounts[user.id] !== undefined ? deviceCounts[user.id] : '—'}
                          </p>
                          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Unidades</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); setAssigningUser(user); }}
                          className="p-2 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors font-semibold"
                          title="Configurar Permisos"
                        >
                          <Layers size={16} />
                        </button>
                        {!user.administrator && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(user.id); }}
                            className="p-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                            title="Eliminar usuario"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {expandedUser !== user.id && (
                     <div className="text-center w-full flex items-center justify-center pt-2">
                       <span className="text-[10px] font-bold text-gray-400 flex items-center gap-1">
                          Toca para ver taxis asignados <ChevronDown size={12}/>
                       </span>
                     </div>
                  )}
                </div>
              ))}
            </div>

            {/* Vista Desktop (Tabla) */}
            <div className="hidden md:block overflow-x-auto bg-white rounded-2xl border border-gray-200 shadow-sm">
              <table className="w-full min-w-[800px] text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 border-b border-gray-200">
                    <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Usuario</th>
                    <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Rol y Estado</th>
                    <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Unidades</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredUsers.map(user => (
                    <tr 
                      key={user.id} 
                      className="hover:bg-slate-50/50 transition-colors group"
                      onMouseEnter={() => loadDeviceCount(user.id)}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-4">
                          <label className="relative w-10 h-10 flex-shrink-0 cursor-pointer group/avatar">
                            {user.attributes?.avatar ? (
                              <img 
                                src={user.attributes.avatar as string} 
                                alt={user.name} 
                                className="w-full h-full object-cover rounded-full shadow-sm ring-1 ring-inset ring-gray-200"
                              />
                            ) : (
                              <div className={`w-full h-full rounded-full flex items-center justify-center font-bold text-sm shadow-sm ring-1 ring-inset ${
                                user.administrator 
                                  ? 'bg-amber-50 text-amber-600 ring-amber-600/20' 
                                  : 'bg-blue-50 text-blue-600 ring-blue-600/20'
                              }`}>
                                {user.name?.charAt(0)?.toUpperCase() || 'U'}
                              </div>
                            )}
                            <div className="absolute inset-0 bg-black/50 rounded-full opacity-0 group-hover/avatar:opacity-100 flex items-center justify-center transition-opacity">
                              <Camera size={14} className="text-white" />
                            </div>
                            <input 
                              type="file" 
                              accept="image/*" 
                              className="hidden" 
                              onChange={(e) => {
                                if (e.target.files && e.target.files[0]) {
                                  handleAvatarUpload(user, e.target.files[0]);
                                }
                                e.target.value = ''; // Reset para poder subir la misma foto de nuevo si se borra
                              }}
                            />
                          </label>
                          <div>
                            <div className="font-semibold text-gray-900">{user.name}</div>
                            <div className="text-xs text-gray-500 mt-0.5">{user.email}</div>
                          </div>
                        </div>
                      </td>
                      
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-col items-start gap-1.5">
                          {user.administrator ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20">
                              <Shield size={12} /> Administrador
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-500/10">
                              <Users size={12} /> Operativo
                            </span>
                          )}
                          
                          {user.disabled ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span> Inactivo
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Activo
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-gray-500 border border-gray-100">
                            <Layers size={14} />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-gray-700">
                              {deviceCounts[user.id] !== undefined ? deviceCounts[user.id] : '—'}
                            </p>
                            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Asignados</p>
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setAssigningUser(user)}
                            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold text-blue-600 bg-white border border-gray-200 hover:border-blue-200 hover:bg-blue-50 rounded-lg transition-all shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                          >
                            <Layers size={14} /> Configurar Permisos
                          </button>
                          
                          {!user.administrator && (
                            <button
                              onClick={() => handleDelete(user.id)}
                              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-100 transition-all rounded-lg opacity-0 group-hover:opacity-100"
                              title="Eliminar usuario"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} onCreated={handleCreated} />}
      {assigningUser && <AssignDevicesModal user={assigningUser} onClose={() => { setAssigningUser(null); setDeviceCounts({}); }} />}
    </div>
  );
}
