import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { api } from '../lib/traccarApi';
import {
  Settings, Save, Lock, Map as MapIcon, CheckCircle2,
  Package, Phone, AlertCircle, ExternalLink, Check, X,
  ChevronDown
} from 'lucide-react';
import toast from 'react-hot-toast';

interface Paquete {
  id: string;
  nombre: string;
  precio_mensual: number;
  incluye_bot: boolean;
  incluye_whatsapp: boolean;
  features: { id: string; label: string; incluido: boolean }[];
}

interface EmpresaInfo {
  id: string;
  nombre_empresa: string;
  nombre_bot: string;
  telefono_telnyx: string;
  ciudad: string | null;
  activo: boolean;
  tipo_negocio: string;
  paquete: Paquete | null;
}

export default function SettingsPage() {
  const { user, userRole, empresaId } = useAuth();

  // Profile & Security
  const [mapType, setMapType]                 = useState(localStorage.getItem('estrella_map_type') || 'roadmap');
  const [password, setPassword]               = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName]                       = useState(user?.name || '');
  const [email, setEmail]                     = useState(user?.email || '');
  const [phone, setPhone]                     = useState(user?.phone || '');
  const [savingSettings, setSavingSettings]   = useState(false);
  const [savingSecurity, setSavingSecurity]   = useState(false);
  const [successMsg, setSuccessMsg]           = useState('');

  // Accordion state
  const [expanded, setExpanded] = useState({
    organizacion: false,
    perfil: false,
    seguridad: false
  });

  const toggleSection = (section: keyof typeof expanded) => {
    setExpanded(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Tenant plan info
  const [empresaInfo, setEmpresaInfo]     = useState<EmpresaInfo | null>(null);
  const [loadingEmpresa, setLoadingEmpresa] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setEmail(user.email || '');
      setPhone(user.phone || '');
    }
  }, [user]);

  useEffect(() => {
    if (userRole === 'admin_empresa' && empresaId) {
      setLoadingEmpresa(true);
      supabase
        .from('empresas')
        .select('id, nombre_empresa, nombre_bot, telefono_telnyx, ciudad, activo, tipo_negocio, paquete:paquetes(id, nombre, precio_mensual, incluye_bot, incluye_whatsapp, features)')
        .eq('id', empresaId)
        .single()
        .then(({ data, error }) => {
          if (!error && data) setEmpresaInfo(data as EmpresaInfo);
        })
        .finally(() => setLoadingEmpresa(false));
    }
  }, [userRole, empresaId]);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      localStorage.setItem('estrella_map_type', mapType);
      if (user) await api.updateUser(user.id, { ...user, name, email, phone });
      showSuccess('Ajustes guardados correctamente.');
    } catch (e: unknown) {
      toast.error(`Error al guardar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveSecurity = async () => {
    if (!password)                      return toast.error('Ingresa una contraseña nueva.');
    if (password !== confirmPassword)   return toast.error('Las contraseñas no coinciden.');
    if (password.length < 5)            return toast.error('La contraseña debe tener al menos 5 caracteres.');
    setSavingSecurity(true);
    try {
      if (user) {
        await api.updateUser(user.id, { ...user, password });
        setPassword('');
        setConfirmPassword('');
        showSuccess('Contraseña actualizada con éxito.');
      }
    } catch (e: unknown) {
      toast.error(`Error de seguridad: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingSecurity(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 md:p-8 font-sans max-w-[1000px] mx-auto pb-32">
      <div className="flex flex-col gap-6">

        {/* Header */}
        <div className="border-b border-gray-200 pb-5">
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">
            {userRole === 'admin_empresa' ? 'Configuración de la Cuenta' : 'Ajustes y Preferencias'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {userRole === 'admin_empresa'
              ? 'Administra los detalles de tu empresa, plan de facturación y preferencias de seguridad.'
              : 'Configura tu perfil personal y preferencias del sistema.'}
          </p>
        </div>

        {successMsg && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-md flex items-center gap-2 shadow-sm animate-fade-in">
            <CheckCircle2 size={18} className="text-emerald-600" />
            <span className="text-sm font-medium">{successMsg}</span>
          </div>
        )}

        {/* ========= SECCIÓN PLAN (Principal y fija) ========= */}
        {userRole === 'admin_empresa' && (
          <div className="flex flex-col gap-6">

            {loadingEmpresa ? (
              <div className="bg-white border border-gray-200 rounded-lg p-6 animate-pulse">
                <div className="h-4 w-48 bg-gray-200 rounded mb-4" />
                <div className="h-10 w-32 bg-gray-200 rounded" />
              </div>
            ) : empresaInfo ? (
              <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between bg-gray-50">
                  <div className="flex items-center gap-2">
                    <Package size={18} className="text-gray-500" />
                    <h2 className="text-base font-semibold text-gray-900">Plan Actual</h2>
                  </div>
                  {empresaInfo.activo ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Activo
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-red-50 text-red-700 text-xs font-semibold border border-red-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Suspendido
                    </span>
                  )}
                </div>

                <div className="p-6 flex flex-col md:flex-row gap-8">
                  {/* Info del plan */}
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-gray-900">
                      {empresaInfo.paquete?.nombre ?? 'Plan no asignado'}
                    </h3>
                    {empresaInfo.paquete ? (
                      <div className="mt-2 flex items-baseline gap-1">
                        <span className="text-3xl font-bold text-gray-900 tracking-tight">
                          ${empresaInfo.paquete.precio_mensual.toLocaleString('es-MX')}
                        </span>
                        <span className="text-sm font-medium text-gray-500">MXN / mes</span>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500 mt-2">Contacta a soporte para activar un plan y ver el precio correspondiente.</p>
                    )}

                    <div className="mt-6 space-y-3">
                      {empresaInfo.paquete && (
                        <>
                          <div className="flex items-start gap-2 text-sm text-gray-700">
                            <Check size={16} className="text-gray-400 mt-0.5 shrink-0" />
                            <span>Rastreo GPS en tiempo real</span>
                          </div>
                          {(Array.isArray(empresaInfo.paquete.features) ? empresaInfo.paquete.features : []).map(f => (
                            <div key={f.id} className="flex items-start gap-2 text-sm text-gray-700">
                              {f.incluido ? (
                                <Check size={16} className="text-gray-400 mt-0.5 shrink-0" />
                              ) : (
                                <X size={16} className="text-gray-300 mt-0.5 shrink-0" />
                              )}
                              <span className={!f.incluido ? 'text-gray-400 line-through' : ''}>{f.label}</span>
                            </div>
                          ))}
                          {(!Array.isArray(empresaInfo.paquete.features) || empresaInfo.paquete.features.length === 0) && (
                            <>
                              <div className="flex items-start gap-2 text-sm text-gray-700">
                                {empresaInfo.paquete.incluye_whatsapp ? <Check size={16} className="text-gray-400 mt-0.5 shrink-0" /> : <AlertCircle size={16} className="text-gray-300 mt-0.5 shrink-0" />}
                                <span className={!empresaInfo.paquete.incluye_whatsapp ? 'text-gray-400 line-through' : ''}>Bot de WhatsApp con IA</span>
                              </div>
                              <div className="flex items-start gap-2 text-sm text-gray-700">
                                {empresaInfo.paquete.incluye_bot ? <Check size={16} className="text-gray-400 mt-0.5 shrink-0" /> : <AlertCircle size={16} className="text-gray-300 mt-0.5 shrink-0" />}
                                <span className={!empresaInfo.paquete.incluye_bot ? 'text-gray-400 line-through' : ''}>Bot de Voz con IA</span>
                              </div>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Facturación y Contacto */}
                  <div className="w-full md:w-64 flex flex-col gap-4">
                    <div className="bg-gray-50 border border-gray-200 rounded-md p-4">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Soporte y Facturación</p>
                      <p className="text-sm text-gray-600 mb-4">¿Necesitas cambiar tu plan o tienes dudas sobre tu factura?</p>
                      <a
                        href="https://wa.me/529631234567?text=Hola,%20necesito%20soporte%20con%20mi%20plan%20de%20Stellar%20Tracking"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-md text-sm font-medium transition-colors shadow-sm"
                      >
                        Contactar Soporte <ExternalLink size={14} />
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-lg p-6 text-center shadow-sm">
                <AlertCircle size={24} className="text-gray-400 mx-auto mb-3" />
                <p className="font-medium text-gray-900 text-sm">No tienes una empresa vinculada.</p>
                <p className="text-sm text-gray-500 mt-1">Pide a tu administrador que te asigne una empresa para ver tu plan.</p>
              </div>
            )}

            {/* Accordion: Datos de la Empresa */}
            {empresaInfo && (
              <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                <button 
                  onClick={() => toggleSection('organizacion')}
                  className="w-full px-6 py-4 flex items-center justify-between bg-white hover:bg-gray-50 transition-colors focus:outline-none"
                >
                  <h2 className="text-base font-semibold text-gray-900">Información de la Organización</h2>
                  <div className={`transform transition-transform duration-300 ${expanded.organizacion ? 'rotate-180' : ''}`}>
                    <ChevronDown size={20} className="text-gray-400" />
                  </div>
                </button>
                
                <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${expanded.organizacion ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                  <div className="overflow-hidden">
                    <div className="p-6 border-t border-gray-200 bg-white grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Nombre</label>
                        <p className="text-sm font-medium text-gray-900">{empresaInfo.nombre_empresa}</p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Sector</label>
                        <p className="text-sm font-medium text-gray-900 capitalize">{empresaInfo.tipo_negocio}</p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Nombre del Asistente IA</label>
                        <p className="text-sm font-medium text-gray-900">{empresaInfo.nombre_bot || 'No configurado'}</p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Línea Telefónica</label>
                        <p className="text-sm font-mono text-gray-900">{empresaInfo.telefono_telnyx || '—'}</p>
                      </div>
                      {empresaInfo.ciudad && (
                        <div>
                          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Ubicación</label>
                          <p className="text-sm font-medium text-gray-900">{empresaInfo.ciudad}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========= PERFIL + SEGURIDAD (ACORDEONES) ========= */}
        <div className="flex flex-col gap-4">
          
          {/* Accordion: Perfil Personal */}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
            <button 
              onClick={() => toggleSection('perfil')}
              className="w-full px-6 py-4 flex items-center justify-between bg-white hover:bg-gray-50 transition-colors focus:outline-none"
            >
              <h2 className="text-base font-semibold text-gray-900">Perfil Personal</h2>
              <div className={`transform transition-transform duration-300 ${expanded.perfil ? 'rotate-180' : ''}`}>
                <ChevronDown size={20} className="text-gray-400" />
              </div>
            </button>
            
            <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${expanded.perfil ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
              <div className="overflow-hidden">
                <div className="border-t border-gray-200 flex flex-col">
                  <div className="p-6 space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Nombre Completo</label>
                        <input 
                          value={name} 
                          onChange={e => setName(e.target.value)}
                          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent shadow-sm" 
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Número de Contacto</label>
                        <input 
                          value={phone} 
                          onChange={e => setPhone(e.target.value)} 
                          type="tel" 
                          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent shadow-sm" 
                        />
                        <p className="text-xs text-gray-500 mt-1.5">Necesario para alertas del GPS.</p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Correo Electrónico</label>
                        <input 
                          value={email} 
                          onChange={e => setEmail(e.target.value)}
                          type="email"
                          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 shadow-sm bg-gray-50" 
                          readOnly
                        />
                      </div>
                    </div>

                    {/* Preferencias Mapa Superadmin */}
                    {userRole === 'superadmin' && (
                      <div className="pt-4 border-t border-gray-200">
                        <label className="block text-sm font-medium text-gray-700 mb-3">Estilo del Mapa Principal</label>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          {(['roadmap', 'satellite'] as const).map(type => (
                            <button 
                              key={type} 
                              onClick={() => setMapType(type)}
                              className={`flex flex-col p-3 rounded-md border text-left transition-colors ${
                                mapType === type 
                                  ? 'border-gray-900 bg-gray-50 ring-1 ring-gray-900' 
                                  : 'border-gray-300 hover:bg-gray-50'
                              }`}
                            >
                              <span className={`text-sm font-semibold ${mapType === type ? 'text-gray-900' : 'text-gray-700'}`}>
                                {type === 'roadmap' ? 'Estándar' : 'Satélite'}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end">
                    <button 
                      onClick={handleSaveSettings} 
                      disabled={savingSettings}
                      className="px-4 py-2 bg-black hover:bg-gray-800 disabled:bg-gray-400 text-white rounded-md text-sm font-semibold transition-colors shadow-sm"
                    >
                      {savingSettings ? 'Guardando...' : 'Guardar Cambios'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Accordion: Seguridad */}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
            <button 
              onClick={() => toggleSection('seguridad')}
              className="w-full px-6 py-4 flex items-center justify-between bg-white hover:bg-gray-50 transition-colors focus:outline-none"
            >
              <h2 className="text-base font-semibold text-gray-900">Seguridad</h2>
              <div className={`transform transition-transform duration-300 ${expanded.seguridad ? 'rotate-180' : ''}`}>
                <ChevronDown size={20} className="text-gray-400" />
              </div>
            </button>
            
            <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${expanded.seguridad ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
              <div className="overflow-hidden">
                <div className="border-t border-gray-200 flex flex-col">
                  <div className="p-6 space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Nueva Contraseña</label>
                        <input 
                          type="password" 
                          value={password} 
                          onChange={e => setPassword(e.target.value)}
                          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent shadow-sm" 
                          placeholder="Mínimo 5 caracteres" 
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar Contraseña</label>
                        <input 
                          type="password" 
                          value={confirmPassword} 
                          onChange={e => setConfirmPassword(e.target.value)}
                          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent shadow-sm" 
                        />
                      </div>
                    </div>
                  </div>
                  
                  <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end">
                    <button 
                      onClick={handleSaveSecurity} 
                      disabled={savingSecurity || !password}
                      className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 text-gray-700 rounded-md text-sm font-semibold transition-colors shadow-sm"
                    >
                      {savingSecurity ? 'Actualizando...' : 'Actualizar Contraseña'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
