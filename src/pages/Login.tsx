import React, { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Car, MapPin, Users, Activity, CheckCircle2, Navigation2 } from 'lucide-react';

export default function Login() {
  const { user, login, resetPassword } = useAuth();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);

  const [isTransitioning, setIsTransitioning] = useState(false);
  const [loadingText, setLoadingText] = useState('Iniciando Sesión...');
  const [loginPhase, setLoginPhase] = useState(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (user && !isTransitioning) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('loading');
    setError('');
    
    setIsTransitioning(true);
    setLoginPhase(1);
    setLoadingText('Verificando credenciales...');

    try {
      if (isForgotPassword) {
        await resetPassword(email);
        setState('success');
        setIsTransitioning(false);
      } else {
        // Fase 1: Rastreo (Autenticación)
        const loginPromise = login(email, password);
        await Promise.all([loginPromise, new Promise(r => setTimeout(r, 800))]);

        // Fase 2: Choferes
        setLoginPhase(2);
        setLoadingText('Sincronizando perfil de choferes...');
        await new Promise(r => setTimeout(r, 700));

        // Fase 3: Reportes
        setLoginPhase(3);
        setLoadingText('Cargando motor de reportes...');
        await new Promise(r => setTimeout(r, 700));

        // Fase 4: Telemetría / Batería
        setLoginPhase(4);
        setLoadingText('Recibiendo telemetría de vehículos...');
        await new Promise(r => setTimeout(r, 700));

        // Fase 5: Éxito
        setLoginPhase(5);
        setState('success');
        setLoadingText('¡Todo listo, bienvenido!');
        
        setTimeout(() => setIsTransitioning(false), 1200);
      }
    } catch (err: any) {
      setIsTransitioning(false);
      setLoginPhase(0);
      setState('error');
      setError(err.message || (isForgotPassword ? 'Error al solicitar el correo.' : 'Credenciales inválidas.'));
    }
  };

  const getBoxClass = (step: number) => {
    if (loginPhase === 5) return 'bg-emerald-500/20 border-emerald-400/50 text-emerald-50 scale-[1.02] shadow-[0_0_15px_rgba(16,185,129,0.2)] transition-all duration-500';
    if (loginPhase === step) return 'bg-white/20 border-white/40 text-white shadow-[0_0_20px_rgba(255,255,255,0.2)] scale-[1.03] transition-all duration-300 relative overflow-hidden';
    if (loginPhase > step) return 'bg-white/10 border-white/20 text-white transition-all duration-500';
    return 'bg-white/5 border-white/10 text-blue-50/70 transition-all duration-500';
  };
  
  const getIconClass = (step: number) => {
    if (loginPhase === 5) return 'bg-emerald-500 text-white shadow-md shadow-emerald-500/40 transition-all duration-500';
    if (loginPhase === step) return 'bg-white text-blue-600 animate-pulse transition-all duration-300';
    if (loginPhase > step) return 'bg-white/20 text-white transition-all duration-500';
    return 'bg-white/10 text-white/50 transition-all duration-500';
  };

  return (
    <div className={`h-screen flex bg-white font-sans overflow-hidden transition-opacity duration-700 relative ${mounted ? 'opacity-100' : 'opacity-0'}`}>
      
      {/* ─── Progress Bar Superior Estilo Apple/Vercel ──────────────────────── */}
      <div className="absolute top-0 left-0 w-full h-1 bg-transparent z-[100]">
        <div 
          className="h-full bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.9)] transition-all ease-linear"
          style={{ 
            width: loginPhase === 0 ? '0%' : loginPhase === 5 ? '100%' : `${loginPhase * 25}%`,
            transitionDuration: loginPhase === 0 ? '0s' : loginPhase === 5 ? '0.5s' : '0.8s'
          }}
        />
      </div>

      {/* ─── Panel Izquierdo (Hero Limpio y Profesional) ──────────────────────── */}
      <div className={`hidden lg:flex flex-col w-[55%] bg-black items-center justify-center relative transition-transform duration-1000 z-10 ${mounted ? 'translate-x-0' : '-translate-x-12'}`}>
        <img src="/logo-full.png" alt="Stellar Tracking" className="w-[80%] max-w-lg object-contain relative z-10" />
        
        {/* Footer Text */}
        <div className="absolute bottom-8 left-0 w-full text-center z-20">
          <p className="text-gray-400 text-[12px] font-medium tracking-widest uppercase">
            Impulsado por <span className="text-white font-extrabold">Stellar Tracking</span>
          </p>
        </div>
      </div>

      {/* ─── Panel Derecho (Formulario Limpio) ────────────────────────────────── */}
      {/* ─── Panel Derecho (Formulario Limpio) ────────────────────────────────── */}
      <div
        className={`flex-1 flex flex-col justify-center items-center px-4 sm:px-12 py-8 transition-all duration-700 bg-slate-50 overflow-y-auto w-full relative z-0 ${mounted ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}`}
      >
        {/* Difuminado MEJORADO: transición mucho más suave y ancha */}
        <div className="hidden lg:block absolute top-0 left-0 w-[60%] h-full bg-gradient-to-r from-black via-slate-800/80 to-transparent pointer-events-none z-0"></div>
        <div className="hidden lg:block absolute top-0 left-0 w-[30%] h-full bg-gradient-to-r from-black to-transparent pointer-events-none z-10"></div>
        
        {/* ─── Header Móvil (Ultra Limpio y Premium) ─── */}
        <div className="lg:hidden w-full flex flex-col items-center mb-8 mt-2">
          <img src="/logo.png" alt="Stellar Tracking" className="h-24 object-contain filter invert mix-blend-multiply" />
        </div>

        {/* ─── Contenedor del Formulario ─── */}
        <div className="w-full max-w-sm flex flex-col relative z-20">
          <div className="bg-white p-8 lg:p-10 rounded-[2rem] shadow-xl shadow-blue-900/5 lg:shadow-[0_8px_30px_rgb(0,0,0,0.04)] lg:border lg:border-slate-100/60">
            
            <div className="mb-8 text-left lg:text-center">
              <h2 className="text-[28px] lg:text-2xl font-extrabold text-slate-900 tracking-tight leading-tight">Bienvenido de vuelta</h2>
              <p className="text-slate-500 text-[14px] mt-2 font-medium">Ingresa tus credenciales para continuar</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <style>{`
                input:-webkit-autofill,
                input:-webkit-autofill:hover, 
                input:-webkit-autofill:focus, 
                input:-webkit-autofill:active {
                    -webkit-box-shadow: 0 0 0 30px #f8fafc inset !important;
                    -webkit-text-fill-color: #0f172a !important;
                    border-radius: 1rem;
                }
              `}</style>

              {/* Error message */}
              <div className={`overflow-hidden transition-all duration-300 ${state === 'error' ? 'max-h-20 opacity-100 mb-4' : 'max-h-0 opacity-0 mb-0'}`}>
                <div className="bg-red-50 text-red-600 text-sm p-3.5 rounded-xl font-medium text-center border border-red-100">
                  {error}
                </div>
              </div>

              <div className={`transition-all duration-500 ${state === 'success' ? 'opacity-0 scale-95 h-0 overflow-hidden' : 'opacity-100 scale-100'}`}>
                {/* Email */}
                <div className="space-y-1.5 mb-5">
                  <label className="block text-[13px] font-semibold text-slate-700 ml-1">Correo Electrónico</label>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    disabled={state === 'loading' || state === 'success'}
                    className="w-full px-4 py-3.5 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all bg-slate-50 focus:bg-white disabled:opacity-60 text-slate-900 placeholder:text-slate-400"
                    placeholder="tu@correo.com"
                  />
                </div>

                {/* Contraseña */}
                {!isForgotPassword && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between ml-1">
                      <label className="text-[13px] font-semibold text-slate-700">Contraseña</label>
                      <button
                        type="button"
                        onClick={() => { setIsForgotPassword(true); setError(''); setState('idle'); }}
                        className="text-[13px] text-blue-600 hover:text-blue-700 font-bold transition-colors"
                      >
                        ¿Olvidaste tu contraseña?
                      </button>
                    </div>
                    <input
                      type="password"
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      disabled={state === 'loading' || state === 'success'}
                      className="w-full px-4 py-3.5 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all bg-slate-50 focus:bg-white disabled:opacity-60 text-slate-900 placeholder:text-slate-400"
                      placeholder="••••••••"
                    />
                  </div>
                )}
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={state === 'loading' || state === 'success'}
                className={`w-full py-4 lg:py-3.5 px-4 rounded-xl text-sm font-bold transition-all duration-500 flex items-center justify-center gap-2 mt-6 ${
                  state === 'success'
                    ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 scale-105'
                    : state === 'error'
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white shadow-md shadow-blue-600/20 lg:shadow-sm'
                } disabled:opacity-100`}
              >
                {state === 'loading' && (
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {state === 'loading' && (isForgotPassword ? 'Enviando...' : loadingText)}
                
                {state === 'success' && <><CheckCircle2 size={18} /> {isForgotPassword ? 'Correo enviado' : loadingText}</>}
                {state === 'error' && 'Inténtalo de nuevo'}
                {state === 'idle' && (isForgotPassword ? 'Enviar correo de recuperación' : 'Iniciar Sesión')}
              </button>
            </form>

            {isForgotPassword && (
              <div className="text-center mt-6">
                <button
                  onClick={() => { setIsForgotPassword(false); setError(''); setState('idle'); }}
                  className="text-[13px] font-semibold text-slate-500 hover:text-slate-900 transition-colors"
                >
                  Volver al inicio de sesión
                </button>
              </div>
            )}
          </div>

          {!isForgotPassword && (
            <div className={`mt-10 lg:mt-8 flex flex-col items-center justify-center gap-2 transition-opacity duration-500 ${state === 'success' ? 'opacity-0' : 'opacity-100'}`}>
              {/* Optional footer content can go here */}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
