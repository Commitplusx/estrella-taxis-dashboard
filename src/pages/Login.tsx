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
      <div className={`hidden lg:flex flex-col w-[55%] bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-900 relative transition-transform duration-1000 ${mounted ? 'translate-x-0' : '-translate-x-12'}`}>
        {/* Adorno orgánico sutil de fondo (no robótico) */}
        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute w-[200%] h-[200%] -top-[50%] -left-[50%] animate-spin-slow" style={{ animationDuration: '150s' }}>
            <path fill="#ffffff" d="M38.1,-49.9C51.5,-42.9,65.8,-35.1,73.8,-22.7C81.8,-10.3,83.5,6.7,78.2,21.1C72.9,35.5,60.6,47.3,47.1,56.1C33.6,64.9,18.8,70.7,3.5,66.1C-11.8,61.5,-27.6,46.5,-40.4,34.4C-53.2,22.3,-62.9,13.1,-65.4,2.5C-67.9,-8.1,-63.1,-20.1,-54.6,-28.9C-46.1,-37.7,-33.9,-43.3,-21.8,-49.6C-9.7,-55.9,2.3,-62.9,14.7,-60.8C27.1,-58.7,39.5,-47.5,38.1,-49.9Z" transform="translate(50 50)" />
          </svg>
        </div>

        <div className="relative z-10 flex flex-col h-full p-8 lg:p-12 justify-between text-white">
          {/* Top Logo */}
          <div className="flex items-center gap-3">
            <div className="bg-white/20 backdrop-blur-md p-2.5 rounded-2xl">
              <Car className="text-white" size={24} />
            </div>
            <div>
              <h1 className="text-xl lg:text-2xl font-bold tracking-tight">Estrella Taxis</h1>
              <p className="text-blue-200 font-medium tracking-wide text-[10px] lg:text-xs uppercase mt-0.5">Sistema de Gestión de Flotillas</p>
            </div>
          </div>

          {/* Main Copy */}
          <div className="w-full max-w-xl mx-auto flex flex-col justify-center flex-1 py-4">
            <h2 className="text-3xl lg:text-4xl xl:text-5xl font-extrabold leading-[1.15] tracking-tight mb-4">
              Controla tu flotilla <br/>
              <span className="text-blue-200 font-light">desde cualquier lugar.</span>
            </h2>
            <p className="text-blue-100 text-sm lg:text-base leading-relaxed mb-8 max-w-md">
              Monitorea tus taxis en tiempo real, revisa reportes y gestiona a tus choferes desde un solo panel limpio e intuitivo.
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 lg:gap-4">
              {/* Box 1 */}
              <div className={`flex justify-between items-center p-2.5 lg:p-3 rounded-xl backdrop-blur-sm ${getBoxClass(1)}`}>
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg shrink-0 ${getIconClass(1)}`}><Navigation2 size={16} /></div>
                  <span className="font-medium text-xs lg:text-sm">Rastreo GPS en tiempo real</span>
                </div>
                <div className={`transition-all duration-300 ${loginPhase > 1 ? 'opacity-100 scale-100' : 'opacity-0 scale-50'} ${loginPhase === 5 ? 'text-emerald-200' : 'text-emerald-400'}`}>
                  <CheckCircle2 size={18} />
                </div>
              </div>
              
              {/* Box 2 */}
              <div className={`flex justify-between items-center p-2.5 lg:p-3 rounded-xl backdrop-blur-sm ${getBoxClass(2)}`}>
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg shrink-0 ${getIconClass(2)}`}><Users size={16} /></div>
                  <span className="font-medium text-xs lg:text-sm">Gestión de choferes</span>
                </div>
                <div className={`transition-all duration-300 ${loginPhase > 2 ? 'opacity-100 scale-100' : 'opacity-0 scale-50'} ${loginPhase === 5 ? 'text-emerald-200' : 'text-emerald-400'}`}>
                  <CheckCircle2 size={18} />
                </div>
              </div>

              {/* Box 3 */}
              <div className={`flex justify-between items-center p-2.5 lg:p-3 rounded-xl backdrop-blur-sm ${getBoxClass(3)}`}>
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg shrink-0 ${getIconClass(3)}`}><MapPin size={16} /></div>
                  <span className="font-medium text-xs lg:text-sm">Reportes de viajes</span>
                </div>
                <div className={`transition-all duration-300 ${loginPhase > 3 ? 'opacity-100 scale-100' : 'opacity-0 scale-50'} ${loginPhase === 5 ? 'text-emerald-200' : 'text-emerald-400'}`}>
                  <CheckCircle2 size={18} />
                </div>
              </div>

              {/* Box 4 */}
              <div className={`flex justify-between items-center p-2.5 lg:p-3 rounded-xl backdrop-blur-sm ${getBoxClass(4)}`}>
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg shrink-0 ${getIconClass(4)}`}><Activity size={16} /></div>
                  <span className="font-medium text-xs lg:text-sm">Batería y velocidad</span>
                </div>
                <div className={`transition-all duration-300 ${loginPhase > 4 ? 'opacity-100 scale-100' : 'opacity-0 scale-50'} ${loginPhase === 5 ? 'text-emerald-200' : 'text-emerald-400'}`}>
                  <CheckCircle2 size={18} />
                </div>
              </div>
            </div>
          </div>

          {/* Footer Copy */}
          <div>
            <p className="text-blue-200 text-[13px] font-medium mb-0.5">
              Impulsado por <span className="text-white font-bold">Estrella Eats</span>
            </p>
            <p className="text-blue-300/60 text-[10px] font-medium uppercase tracking-wider">
              Comitán, Chiapas
            </p>
          </div>
        </div>
      </div>

      {/* ─── Panel Derecho (Formulario Limpio) ────────────────────────────────── */}
      {/* ─── Panel Derecho (Formulario Limpio) ────────────────────────────────── */}
      <div
        className={`flex-1 flex flex-col justify-center items-center px-6 sm:px-12 py-8 transition-all duration-700 bg-white lg:bg-slate-50 overflow-y-auto w-full relative ${mounted ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}`}
      >
        
        {/* ─── Header Móvil (Ultra Limpio) ─── */}
        <div className="lg:hidden w-full flex flex-col items-center mb-10 mt-4">
          <div className="inline-flex items-center gap-2.5 bg-blue-600 px-6 py-2.5 rounded-full mb-3 shadow-md shadow-blue-600/20">
            <Car className="text-white" size={20} />
            <span className="text-white font-bold text-[15px]">Estrella Taxis</span>
          </div>
          <p className="text-slate-500 text-[13px] font-medium">Panel de Administración</p>
        </div>

        {/* ─── Contenedor del Formulario ─── */}
        <div className="w-full max-w-sm flex flex-col relative z-20">
          <div className="bg-white lg:p-10 lg:rounded-[2rem] lg:shadow-[0_8px_30px_rgb(0,0,0,0.04)] lg:border lg:border-slate-100/60">
            
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
              <div className="flex items-center gap-2 text-[12px] lg:text-[13px] font-medium text-slate-400">
                <Car size={16} />
                <span>Usa las mismas credenciales de tu cuenta Traccar</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
