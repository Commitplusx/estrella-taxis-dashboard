import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Car, MapPin, Users, BarChart3, CheckCircle2 } from 'lucide-react';

const features = [
  { icon: <MapPin size={18} />, text: 'Rastreo GPS en tiempo real' },
  { icon: <Users size={18} />, text: 'Gestión de flotillas y choferes' },
  { icon: <BarChart3 size={18} />, text: 'Reportes de viajes y paradas' },
  { icon: <Car size={18} />, text: 'Estado de batería y velocidad' },
];

type LoginState = 'idle' | 'loading' | 'success' | 'error';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<LoginState>('idle');
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);

  const [isForgotPassword, setIsForgotPassword] = useState(false);

  // Animación de entrada al montar
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('loading');
    setError('');
    try {
      if (isForgotPassword) {
        // En un dashboard real importas api de '../lib/traccarApi'
        // Espera, tenemos que importar 'api' si no está importado
        const { api } = await import('../lib/traccarApi');
        await api.resetPassword(email);
        setState('success');
        setTimeout(() => {
          setIsForgotPassword(false);
          setState('idle');
        }, 3000);
      } else {
        await login(email, password);
        setState('success');
        // El AuthContext redirige automáticamente
      }
    } catch (error: unknown) {
      setState('error');
      const msg = error instanceof Error ? error.message : 'Error desconocido';
      setError(isForgotPassword ? msg : 'Correo o contraseña incorrectos.');
      // Regresa a idle después de 2s para que puedan intentar de nuevo
      setTimeout(() => setState('idle'), 2000);
    }
  };

  return (
    <div className="min-h-screen flex overflow-hidden bg-white">

      {/* ── Panel izquierdo (Solo PC) ───────────────────────── */}
      <div
        className={`hidden lg:flex w-1/2 bg-gradient-to-br from-blue-700 via-blue-600 to-blue-500 flex-col justify-between p-12 relative overflow-hidden transition-all duration-700 ${mounted ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-8'}`}
      >
        {/* Círculos decorativos de fondo */}
        <div className="absolute top-[-80px] right-[-80px] w-72 h-72 bg-white/10 rounded-full" />
        <div className="absolute bottom-[-60px] left-[-60px] w-56 h-56 bg-white/10 rounded-full" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-white/5 rounded-full" />

        {/* Logo */}
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 backdrop-blur-sm p-2.5 rounded-xl border border-white/30">
              <Car className="text-white" size={24} />
            </div>
            <div>
              <h1 className="text-white font-bold text-xl leading-none">Estrella Taxis</h1>
              <p className="text-blue-200 text-xs mt-0.5">Sistema de Gestión de Flotillas</p>
            </div>
          </div>
        </div>

        {/* Hero text */}
        <div className="relative z-10 space-y-6">
          <div>
            <h2 className="text-white text-4xl font-bold leading-tight">
              Controla tu flotilla
              <br />
              <span className="text-blue-200">desde cualquier lugar.</span>
            </h2>
            <p className="text-blue-100 mt-4 text-base leading-relaxed">
              Monitorea tus taxis en tiempo real, revisa reportes y gestiona
              a tus choferes desde un solo panel.
            </p>
          </div>

          <div className="space-y-3">
            {features.map((f, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 transition-all duration-500`}
                style={{ transitionDelay: `${200 + i * 80}ms`, opacity: mounted ? 1 : 0, transform: mounted ? 'translateX(0)' : 'translateX(-16px)' }}
              >
                <div className="text-blue-200">{f.icon}</div>
                <span className="text-white text-sm">{f.text}</span>
                <CheckCircle2 size={14} className="text-blue-300 ml-auto flex-shrink-0" />
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10">
          <p className="text-blue-200 text-xs">
            Impulsado por Traccar GPS · Comitán, Chiapas
          </p>
        </div>
      </div>

      {/* ── Panel derecho (Formulario) ───────────────────────── */}
      <div
        className={`flex-1 flex flex-col justify-center items-center px-6 sm:px-12 py-12 transition-all duration-700 ${mounted ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}`}
      >
        {/* Logo móvil (solo visible en móvil) */}
        <div className="lg:hidden mb-8 text-center">
          <div className="inline-flex items-center gap-2 bg-blue-600 px-4 py-2.5 rounded-2xl mb-3">
            <Car className="text-white" size={20} />
            <span className="text-white font-bold">Estrella Taxis</span>
          </div>
          <p className="text-sm text-gray-500">Panel de Administración</p>
        </div>

        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900">Bienvenido de vuelta</h2>
            <p className="text-gray-500 text-sm mt-1">Ingresa tus credenciales para continuar</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Error message con animación */}
            <div className={`overflow-hidden transition-all duration-300 ${state === 'error' ? 'max-h-20 opacity-100' : 'max-h-0 opacity-0'}`}>
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-xl mb-1">
                {error}
              </div>
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Correo Electrónico</label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={state === 'loading' || state === 'success'}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-gray-50 focus:bg-white disabled:opacity-60"
                placeholder="tu@correo.com"
              />
            </div>

            {/* Contraseña */}
            {!isForgotPassword && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700">Contraseña</label>
                  <button
                    type="button"
                    onClick={() => { setIsForgotPassword(true); setError(''); setState('idle'); }}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium transition"
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
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-gray-50 focus:bg-white disabled:opacity-60"
                  placeholder="••••••••"
                />
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={state === 'loading' || state === 'success'}
              className={`w-full py-3 px-4 rounded-xl text-sm font-semibold transition-all duration-300 flex items-center justify-center gap-2 mt-2 ${
                state === 'success'
                  ? 'bg-green-500 text-white scale-95'
                  : state === 'error'
                  ? 'bg-red-500 text-white scale-95'
                  : 'bg-blue-600 hover:bg-blue-700 active:scale-95 text-white'
              } disabled:opacity-80`}
            >
              {state === 'loading' && (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {isForgotPassword ? 'Enviando...' : 'Verificando...'}
                </>
              )}
              {state === 'success' && (
                <>
                  <CheckCircle2 size={16} />
                  {isForgotPassword ? 'Correo enviado' : '¡Bienvenido!'}
                </>
              )}
              {state === 'error' && '✗ Inténtalo de nuevo'}
              {state === 'idle' && (isForgotPassword ? 'Enviar correo de recuperación' : 'Iniciar Sesión')}
            </button>
          </form>

          {isForgotPassword && (
            <p className="text-center mt-6">
              <button
                onClick={() => { setIsForgotPassword(false); setError(''); setState('idle'); }}
                className="text-sm font-medium text-gray-500 hover:text-gray-800 transition"
              >
                Volver al inicio de sesión
              </button>
            </p>
          )}

          {!isForgotPassword && (
            <p className="text-center text-xs text-gray-400 mt-8">
              Usa las mismas credenciales de tu cuenta Traccar
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
