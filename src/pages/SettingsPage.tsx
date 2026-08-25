import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/traccarApi';
import { Settings, Save, Lock, Map as MapIcon, Globe, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const { user } = useAuth();
  
  // States
  const [mapType, setMapType] = useState(localStorage.getItem('estrella_map_type') || 'roadmap');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingSecurity, setSavingSecurity] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  // Sincronizar estado inicial
  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setEmail(user.email || '');
    }
  }, [user]);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      // Guardar mapa en caché local para que MapPage y ReportsPage lo lean de inmediato
      localStorage.setItem('estrella_map_type', mapType);
      
      if (user) {
        // Actualizar nombre y email en el backend
        await api.updateUser(user.id, { name, email });
      }
      showSuccess('Ajustes guardados correctamente.');
    } catch (e: any) {
      toast.error(`Error al guardar: ${e.message}`);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveSecurity = async () => {
    if (!password) return toast.error('Ingresa una contraseña nueva.');
    if (password !== confirmPassword) return toast.error('Las contraseñas no coinciden.');
    if (password.length < 5) return toast.error('La contraseña debe tener al menos 5 caracteres.');
    
    setSavingSecurity(true);
    try {
      if (user) {
        await api.updateUser(user.id, { password });
        setPassword('');
        setConfirmPassword('');
        showSuccess('Contraseña actualizada con éxito.');
      }
    } catch (e: any) {
      toast.error(`Error de seguridad: ${e.message}`);
    } finally {
      setSavingSecurity(false);
    }
  };

  return (
    <div className="absolute inset-0 p-4 sm:p-6 pb-32 md:pb-10 view-panel fade-in overflow-y-auto">
      <div className="max-w-4xl mx-auto w-full flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Settings size={24} className="text-blue-600" />
          Ajustes y Preferencias
        </h1>
        <p className="text-sm text-gray-500 mt-1">Configura tu perfil, contraseña y apariencia del sistema.</p>
      </div>

      {successMsg && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl flex items-center gap-2 animate-fade-in">
          <CheckCircle2 size={18} />
          <span className="text-sm font-semibold">{successMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        
        {/* PANEL: Preferencias Generales */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
            <Globe size={18} className="text-gray-600" />
            <h2 className="font-bold text-gray-900">Perfil y Apariencia</h2>
          </div>
          
          <div className="p-5 space-y-5">
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1.5">Nombre de Usuario</label>
              <input value={name} onChange={e => setName(e.target.value)} 
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1.5">Correo Electrónico</label>
              <input value={email} onChange={e => setEmail(e.target.value)} 
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <div className="pt-2 border-t border-gray-100">
              <label className="block text-xs font-bold text-gray-600 mb-3 flex items-center gap-1.5">
                <MapIcon size={14} /> Capa del Mapa (Predeterminada)
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setMapType('roadmap')}
                  className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition ${mapType === 'roadmap' ? 'border-blue-500 bg-blue-50' : 'border-gray-100 hover:border-gray-200'}`}>
                  <span className={`text-sm font-bold ${mapType === 'roadmap' ? 'text-blue-700' : 'text-gray-600'}`}>Estándar</span>
                  <span className="text-[10px] text-gray-400">Calles y rutas</span>
                </button>
                <button onClick={() => setMapType('satellite')}
                  className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition ${mapType === 'satellite' ? 'border-blue-500 bg-blue-50' : 'border-gray-100 hover:border-gray-200'}`}>
                  <span className={`text-sm font-bold ${mapType === 'satellite' ? 'text-blue-700' : 'text-gray-600'}`}>Satélite</span>
                  <span className="text-[10px] text-gray-400">Vista real (Google)</span>
                </button>
              </div>
            </div>
          </div>

          <div className="p-5 bg-gray-50 border-t border-gray-100 mt-auto">
            <button onClick={handleSaveSettings} disabled={savingSettings}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition">
              <Save size={16} /> {savingSettings ? 'Guardando...' : 'Guardar Preferencias'}
            </button>
          </div>
        </div>

        {/* PANEL: Seguridad */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
            <Lock size={18} className="text-gray-600" />
            <h2 className="font-bold text-gray-900">Seguridad</h2>
          </div>
          
          <div className="p-5 space-y-5">
            <div className="bg-amber-50 text-amber-800 p-3 rounded-xl text-xs font-medium border border-amber-100">
              Usa este panel solo si deseas cambiar tu contraseña actual. Si no, déjalo en blanco.
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1.5">Nueva Contraseña</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} 
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="••••••••" />
            </div>
            
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1.5">Confirmar Contraseña</label>
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} 
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="••••••••" />
            </div>
          </div>

          <div className="p-5 bg-gray-50 border-t border-gray-100 mt-auto">
            <button onClick={handleSaveSecurity} disabled={savingSecurity || !password}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-900 hover:bg-black disabled:opacity-50 text-white rounded-xl text-sm font-bold transition">
              <Lock size={16} /> {savingSecurity ? 'Actualizando...' : 'Actualizar Contraseña'}
            </button>
          </div>
        </div>

      </div>
    </div>
    </div>
  );
}
