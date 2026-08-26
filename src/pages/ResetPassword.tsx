import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/traccarApi';
import { CheckCircle2 } from 'lucide-react';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // useSearchParams convierte '+' en espacios porque sigue la spec de form-urlencoding.
  // Traccar genera tokens Base64 que contienen '+', así que extraemos el valor
  // del raw query string y sólo decodeamos %XX, preservando los '+' literales.
  const rawToken = (() => {
    const raw = window.location.search;
    const match = raw.match(/[?&]passwordReset=([^&]*)/);
    if (match) return decodeURIComponent(match[1]);
    const fallback = raw.match(/[?&]token=([^&]*)/);
    if (fallback) return decodeURIComponent(fallback[1]);
    return null;
  })();
  
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!rawToken) {
      setError('Enlace inválido o expirado.');
      setState('error');
    }
  }, [rawToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawToken) return;
    
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      setState('error');
      return;
    }

    setState('loading');
    setError('');

    try {
      await api.updatePassword(rawToken, password);
      setState('success');
      setTimeout(() => {
        navigate('/login');
      }, 3000);
    } catch (err: any) {
      setState('error');
      setError(err.message || 'Error al actualizar contraseña.');
    }
  };

  return (
    <div className={`h-screen flex bg-white font-sans overflow-hidden transition-opacity duration-700 relative ${mounted ? 'opacity-100' : 'opacity-0'}`}>
      
      {/* Panel Izquierdo (Hero) */}
      <div className="hidden lg:flex flex-col w-[55%] bg-black items-center justify-center relative z-10">
        <img src="/logo-full.png" alt="Stellar Tracking" className="w-[80%] max-w-lg object-contain relative z-10" />
        <div className="absolute bottom-8 left-0 w-full text-center z-20">
          <p className="text-gray-400 text-[12px] font-medium tracking-widest uppercase">
            Impulsado por <span className="text-white font-extrabold">Stellar Tracking</span>
          </p>
        </div>
      </div>

      {/* Panel Derecho (Formulario) */}
      <div className="flex-1 flex flex-col justify-center items-center px-4 sm:px-12 py-8 transition-all duration-700 bg-slate-50 w-full relative z-0">
        <div className="hidden lg:block absolute top-0 left-0 w-[60%] h-full bg-gradient-to-r from-black via-slate-800/80 to-transparent pointer-events-none z-0"></div>
        <div className="hidden lg:block absolute top-0 left-0 w-[30%] h-full bg-gradient-to-r from-black to-transparent pointer-events-none z-10"></div>
        
        <div className="lg:hidden w-full flex flex-col items-center mb-8 mt-2">
          <img src="/logo.png" alt="Stellar Tracking" className="h-24 object-contain filter invert mix-blend-multiply" />
        </div>

        <div className="w-full max-w-sm flex flex-col relative z-20">
          <div className="bg-white p-8 lg:p-10 rounded-[2rem] shadow-xl shadow-blue-900/5 lg:shadow-[0_8px_30px_rgb(0,0,0,0.04)] lg:border lg:border-slate-100/60">
            
            <div className="mb-8 text-left lg:text-center">
              <h2 className="text-[28px] lg:text-2xl font-extrabold text-slate-900 tracking-tight leading-tight">Nueva Contraseña</h2>
              <p className="text-slate-500 text-[14px] mt-2 font-medium">Crea una nueva contraseña para tu cuenta</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className={`overflow-hidden transition-all duration-300 ${state === 'error' ? 'max-h-20 opacity-100 mb-4' : 'max-h-0 opacity-0 mb-0'}`}>
                <div className="bg-red-50 text-red-600 text-sm p-3.5 rounded-xl font-medium text-center border border-red-100">
                  {error}
                </div>
              </div>

              <div className={`transition-all duration-500 ${state === 'success' ? 'opacity-0 scale-95 h-0 overflow-hidden' : 'opacity-100 scale-100'}`}>
                <div className="space-y-1.5 mb-5">
                  <label className="block text-[13px] font-semibold text-slate-700 ml-1">Nueva Contraseña</label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    disabled={state === 'loading' || state === 'success' || !rawToken}
                    className="w-full px-4 py-3.5 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all bg-slate-50 focus:bg-white disabled:opacity-60 text-slate-900 placeholder:text-slate-400"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={state === 'loading' || state === 'success' || !rawToken}
                className={`w-full py-4 lg:py-3.5 px-4 rounded-xl text-sm font-bold transition-all duration-500 flex items-center justify-center gap-2 mt-6 ${
                  state === 'success'
                    ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 scale-105'
                    : state === 'error' || !rawToken
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white shadow-md shadow-blue-600/20 lg:shadow-sm'
                }`}
              >
                {state === 'loading' && (
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                
                {state === 'success' && <><CheckCircle2 size={18} /> ¡Contraseña actualizada!</>}
                {state === 'error' && 'Inténtalo de nuevo'}
                {state === 'idle' && (rawToken ? 'Guardar Contraseña' : 'Enlace inválido')}
                {state === 'loading' && 'Guardando...'}
              </button>
            </form>

            <div className="text-center mt-6">
              <button
                onClick={() => navigate('/login')}
                className="text-[13px] font-semibold text-slate-500 hover:text-slate-900 transition-colors"
              >
                Volver al inicio de sesión
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
