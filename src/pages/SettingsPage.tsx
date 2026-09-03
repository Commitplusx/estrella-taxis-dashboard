import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { api } from '../lib/traccarApi';
import {
  Settings, Save, Lock, Map as MapIcon, Globe, CheckCircle2,
  Building2, Package, Phone, Bot, MessageCircle, Wifi, Star,
  AlertCircle, ExternalLink, Shield, Zap, Check,
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
    <div className="absolute inset-0 p-4 sm:p-6 pb-32 md:pb-10 view-panel fade-in overflow-y-auto">
      <div className="max-w-4xl mx-auto w-full flex flex-col gap-6">

        {/* Header */}
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Settings size={24} className="text-blue-600" />
            {userRole === 'admin_empresa' ? 'Mi Cuenta y Plan' : 'Ajustes y Preferencias'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {userRole === 'admin_empresa'
              ? 'Consulta tu plan activo y gestiona tu perfil de acceso.'
              : 'Configura tu perfil, contraseña y apariencia del sistema.'}
          </p>
        </div>

        {successMsg && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl flex items-center gap-2 animate-fade-in">
            <CheckCircle2 size={18} />
            <span className="text-sm font-semibold">{successMsg}</span>
          </div>
        )}

        {/* ========= SECCIÓN PLAN (solo admin_empresa) ========= */}
        {userRole === 'admin_empresa' && (
          <div className="flex flex-col gap-4">

            {loadingEmpresa ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 animate-pulse flex justify-center">
                <div className="h-4 w-56 bg-gray-200 rounded" />
              </div>
            ) : empresaInfo ? (
              <>
                {/* Plan Hero Card */}
                <div className={`relative overflow-hidden rounded-2xl shadow-lg p-6 text-white ${
                  empresaInfo.paquete
                    ? 'bg-gradient-to-br from-indigo-600 via-indigo-700 to-purple-700'
                    : 'bg-gradient-to-br from-gray-500 to-gray-600'
                }`}>
                  {/* decorative blobs */}
                  <div className="pointer-events-none absolute -top-8 -right-8 w-44 h-44 rounded-full bg-white/5" />
                  <div className="pointer-events-none absolute -bottom-10 -left-8 w-56 h-56 rounded-full bg-white/5" />

                  <div className="relative">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-widest uppercase text-indigo-200 mb-1">
                          <Package size={11} /> Plan Contratado
                        </span>
                        <h2 className="text-2xl font-extrabold tracking-tight leading-tight">
                          {empresaInfo.paquete?.nombre ?? 'Sin plan activo'}
                        </h2>
                        {empresaInfo.paquete && (
                          <p className="text-3xl font-black mt-1">
                            ${empresaInfo.paquete.precio_mensual.toLocaleString('es-MX')}
                            <span className="text-base font-normal text-indigo-200"> / mes</span>
                          </p>
                        )}
                      </div>
                      <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center backdrop-blur-sm flex-shrink-0">
                        <Star size={28} className="text-yellow-300" fill="currentColor" />
                      </div>
                    </div>

                    {/* Feature pills — dinámicas desde JSONB */}
                    {empresaInfo.paquete ? (
                      <div className="mt-5 flex flex-col gap-1.5">
                        {/* GPS siempre incluido */}
                        <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-white/15 text-white">
                          <Check size={12} className="flex-shrink-0 text-emerald-300" />
                          <Wifi size={12} className="flex-shrink-0" /> Rastreo GPS en tiempo real
                        </div>
                        {(Array.isArray(empresaInfo.paquete.features) ? empresaInfo.paquete.features : []).map(f => (
                          <div
                            key={f.id}
                            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                              f.incluido ? 'bg-white/15 text-white' : 'bg-white/5 text-white/30 line-through'
                            }`}
                          >
                            {f.incluido
                              ? <Check size={12} className="flex-shrink-0 text-emerald-300" />
                              : <AlertCircle size={12} className="flex-shrink-0 text-white/30" />
                            }
                            {f.label}
                          </div>
                        ))}
                        {/* Si no hay features JSONB, mostrar los permisos del sistema como fallback */}
                        {(!Array.isArray(empresaInfo.paquete.features) || empresaInfo.paquete.features.length === 0) && (
                          <>
                            <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold ${
                              empresaInfo.paquete.incluye_whatsapp ? 'bg-white/15 text-white' : 'bg-white/5 text-white/30 line-through'
                            }`}>
                              {empresaInfo.paquete.incluye_whatsapp
                                ? <Check size={12} className="flex-shrink-0 text-emerald-300" />
                                : <AlertCircle size={12} className="flex-shrink-0 text-white/30" />
                              }
                              <MessageCircle size={12} className="flex-shrink-0" /> Bot de WhatsApp con IA
                            </div>
                            <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold ${
                              empresaInfo.paquete.incluye_bot ? 'bg-white/15 text-white' : 'bg-white/5 text-white/30 line-through'
                            }`}>
                              {empresaInfo.paquete.incluye_bot
                                ? <Check size={12} className="flex-shrink-0 text-emerald-300" />
                                : <AlertCircle size={12} className="flex-shrink-0 text-white/30" />
                              }
                              <Bot size={12} className="flex-shrink-0" /> Bot de Voz con IA
                            </div>
                          </>
                        )}
                      </div>
                    ) : (
                      <p className="mt-4 text-sm text-white/70">Contacta a soporte para activar un plan.</p>
                    )}

                    {/* Status badge */}
                    <div className="mt-4">
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
                        empresaInfo.activo
                          ? 'bg-emerald-400/20 text-emerald-300 border-emerald-400/30'
                          : 'bg-red-400/20 text-red-300 border-red-400/30'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${empresaInfo.activo ? 'bg-emerald-400' : 'bg-red-400'}`} />
                        {empresaInfo.activo ? 'Servicio Activo' : 'Servicio Suspendido'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Datos de la Empresa */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
                    <Building2 size={17} className="text-gray-600" />
                    <h2 className="font-bold text-gray-900 text-sm">Datos de tu Empresa</h2>
                  </div>
                  <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
                    {[
                      { label: 'Empresa',        value: empresaInfo.nombre_empresa,  icon: <Building2 size={12} />  },
                      { label: 'Tipo de Negocio',value: empresaInfo.tipo_negocio,    icon: null, capitalize: true   },
                      { label: 'Nombre del Bot', value: empresaInfo.nombre_bot,      icon: <Bot size={12} />        },
                      { label: 'Número de Bot',  value: empresaInfo.telefono_telnyx || '—', icon: <Phone size={12} /> },
                      ...(empresaInfo.ciudad ? [{ label: 'Ciudad', value: empresaInfo.ciudad, icon: null }] : []),
                    ].map(item => (
                      <div key={item.label}>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                          {item.icon}{item.label}
                        </p>
                        <p className={`text-sm font-semibold text-gray-800 ${(item as {capitalize?: boolean}).capitalize ? 'capitalize' : ''}`}>
                          {item.value}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Support CTA */}
                <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-100 rounded-2xl p-5 flex flex-col sm:flex-row items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500 flex items-center justify-center flex-shrink-0 shadow-sm">
                    <Zap size={22} className="text-white" />
                  </div>
                  <div className="flex-1 text-center sm:text-left">
                    <p className="font-bold text-gray-900 text-sm">¿Necesitas cambiar o mejorar tu plan?</p>
                    <p className="text-xs text-gray-500 mt-0.5">Contáctanos directamente por WhatsApp y te atendemos al momento.</p>
                  </div>
                  <a
                    href="https://wa.me/529631234567?text=Hola,%20necesito%20soporte%20con%20mi%20cuenta%20de%20Stellar%20Tracking"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 flex items-center gap-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-bold transition shadow-sm"
                  >
                    <MessageCircle size={15} /> Soporte WhatsApp <ExternalLink size={12} />
                  </a>
                </div>
              </>
            ) : (
              <div className="bg-amber-50 border border-amber-100 rounded-2xl p-8 text-center">
                <AlertCircle size={32} className="text-amber-400 mx-auto mb-3" />
                <p className="font-bold text-amber-800 text-sm">No tienes una empresa vinculada.</p>
                <p className="text-xs text-amber-600 mt-1">Pide a tu administrador que te asigne una empresa.</p>
              </div>
            )}
          </div>
        )}

        {/* ========= PERFIL + SEGURIDAD ========= */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">

          {/* Perfil */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
              <Globe size={18} className="text-gray-600" />
              <h2 className="font-bold text-gray-900">Perfil</h2>
            </div>
            <div className="p-5 space-y-4 flex-1">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5">Nombre de Usuario</label>
                <input value={name} onChange={e => setName(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5">WhatsApp / Teléfono</label>
                <input value={phone} onChange={e => setPhone(e.target.value)} type="tel" placeholder="Ej. 9631234567"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <p className="text-[10px] text-gray-400 mt-1">Requerido para recibir alertas del GPS.</p>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5">Correo Electrónico</label>
                <input value={email} onChange={e => setEmail(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              {/* Solo superadmin elige capa del mapa */}
              {userRole === 'superadmin' && (
                <div className="pt-2 border-t border-gray-100">
                  <label className="block text-xs font-bold text-gray-600 mb-3 flex items-center gap-1.5">
                    <MapIcon size={14} /> Capa del Mapa
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {(['roadmap', 'satellite'] as const).map(type => (
                      <button key={type} onClick={() => setMapType(type)}
                        className={`flex flex-col items-center p-3 rounded-xl border-2 transition ${mapType === type ? 'border-blue-500 bg-blue-50' : 'border-gray-100 hover:border-gray-200'}`}>
                        <span className={`text-sm font-bold ${mapType === type ? 'text-blue-700' : 'text-gray-600'}`}>
                          {type === 'roadmap' ? 'Estándar' : 'Satélite'}
                        </span>
                        <span className="text-[10px] text-gray-400">{type === 'roadmap' ? 'Calles y rutas' : 'Vista real (Google)'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {userRole === 'admin_empresa' && (
                <div className="flex items-center gap-2 text-xs text-gray-400 pt-2 border-t border-gray-100">
                  <Shield size={13} className="text-indigo-400" />
                  Rol: <strong className="text-indigo-600">Admin de Empresa</strong>
                </div>
              )}
            </div>
            <div className="p-5 bg-gray-50 border-t border-gray-100">
              <button onClick={handleSaveSettings} disabled={savingSettings}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition">
                <Save size={16} /> {savingSettings ? 'Guardando...' : 'Guardar Perfil'}
              </button>
            </div>
          </div>

          {/* Seguridad */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
              <Lock size={18} className="text-gray-600" />
              <h2 className="font-bold text-gray-900">Seguridad</h2>
            </div>
            <div className="p-5 space-y-4 flex-1">
              <div className="bg-amber-50 text-amber-800 p-3 rounded-xl text-xs font-medium border border-amber-100">
                Usa este panel solo si deseas cambiar tu contraseña actual.
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
            <div className="p-5 bg-gray-50 border-t border-gray-100">
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


