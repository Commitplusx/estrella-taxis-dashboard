import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { 
  Shield, 
  Radio, 
  Clock, 
  Phone, 
  Check, 
  ChevronRight, 
  ArrowRight, 
  BarChart3, 
  MapPin, 
  Power,
  Layers,
  ChevronDown,
  Menu,
  X
} from 'lucide-react';

export default function Landing() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isAnnual, setIsAnnual] = useState(false);

  const plans = [
    {
      name: 'Básico / Auto',
      description: 'Ideal para conductores particulares y taxis individuales.',
      price: isAnnual ? 149 : 199,
      features: [
        'Rastreo GPS en tiempo real',
        'Historial de rutas (30 días)',
        'Apagado de motor remoto',
        'Alertas de velocidad',
        'Soporte por WhatsApp'
      ],
      cta: 'Empezar ahora',
      popular: false
    },
    {
      name: 'Flotillas',
      description: 'Optimizado para concesionarios y administradores de flotas.',
      price: isAnnual ? 249 : 299,
      features: [
        'Rastreo GPS en tiempo real (WebSocket)',
        'Historial de rutas (90 días)',
        'Apagado de motor remoto',
        'Creación ilimitada de Geocercas',
        'Reportes de rendimiento en Excel',
        'Soporte prioritario 24/7'
      ],
      cta: 'Solicitar Demo',
      popular: true
    },
    {
      name: 'Empresarial',
      description: 'Soluciones a la medida para logística masiva.',
      price: 'Cotizar',
      features: [
        'Todo lo de Flotillas',
        'Integración API directa',
        'Servidor dedicado opcional',
        'Desarrollo de módulos a medida',
        'Instalación técnica a domicilio'
      ],
      cta: 'Contactar Ventas',
      popular: false
    }
  ];

  const handleCta = (planName: string) => {
    const message = encodeURIComponent(`Hola Stellar Tracking, me interesa el plan: ${planName}. Me gustaría recibir más información.`);
    window.open(`https://wa.me/5211234567890?text=${message}`, '_blank');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-500/20 scroll-smooth">
      {/* ─── NAVEGACIÓN ─── */}
      <nav className="sticky top-0 bg-white/80 backdrop-blur-md border-b border-slate-100 z-50 transition-all duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-20 items-center">
            {/* Logo */}
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              <div className="bg-black text-white p-2 rounded-xl">
                <Radio className="w-6 h-6 animate-pulse text-blue-500" />
              </div>
              <span className="text-xl font-black tracking-widest text-slate-950 uppercase">
                Stellar <span className="font-light text-slate-600">Tracking</span>
              </span>
            </div>

            {/* Desktop Menu */}
            <div className="hidden md:flex items-center gap-8 font-semibold text-[14px] text-slate-600">
              <a href="#features" className="hover:text-black transition-colors">Características</a>
              <a href="#coverage" className="hover:text-black transition-colors">Tecnología</a>
              <a href="#pricing" className="hover:text-black transition-colors">Precios</a>
              <a href="#contact" className="hover:text-black transition-colors">Contacto</a>
            </div>

            {/* Action Button */}
            <div className="hidden md:flex items-center gap-4">
              {user ? (
                <button
                  onClick={() => navigate('/map')}
                  className="bg-black hover:bg-slate-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-black/10 transition-all hover:scale-105 active:scale-[0.98]"
                >
                  Ir al Panel
                </button>
              ) : (
                <>
                  <button
                    onClick={() => navigate('/login')}
                    className="text-slate-600 hover:text-black font-semibold text-sm transition-colors"
                  >
                    Iniciar Sesión
                  </button>
                  <button
                    onClick={() => {
                      const el = document.getElementById('pricing');
                      el?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-md shadow-blue-600/20 transition-all hover:scale-105 active:scale-[0.98]"
                  >
                    Contratar
                  </button>
                </>
              )}
            </div>

            {/* Mobile Menu Toggle */}
            <div className="md:hidden">
              <button 
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="p-2 rounded-lg text-slate-600 hover:bg-slate-100"
              >
                {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Menu Panel */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-white border-b border-slate-200 py-4 px-6 space-y-3 animate-in slide-in-from-top duration-300">
            <a href="#features" onClick={() => setMobileMenuOpen(false)} className="block py-2 font-medium text-slate-600 hover:text-black">Características</a>
            <a href="#coverage" onClick={() => setMobileMenuOpen(false)} className="block py-2 font-medium text-slate-600 hover:text-black">Tecnología</a>
            <a href="#pricing" onClick={() => setMobileMenuOpen(false)} className="block py-2 font-medium text-slate-600 hover:text-black">Precios</a>
            <a href="#contact" onClick={() => setMobileMenuOpen(false)} className="block py-2 font-medium text-slate-600 hover:text-black">Contacto</a>
            <div className="border-t border-slate-100 pt-3 flex flex-col gap-2">
              {user ? (
                <button
                  onClick={() => { setMobileMenuOpen(false); navigate('/map'); }}
                  className="w-full bg-black text-white py-3 rounded-xl font-bold text-center"
                >
                  Ir al Panel
                </button>
              ) : (
                <>
                  <button
                    onClick={() => { setMobileMenuOpen(false); navigate('/login'); }}
                    className="w-full border border-slate-200 text-slate-700 py-3 rounded-xl font-bold text-center"
                  >
                    Iniciar Sesión
                  </button>
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      const el = document.getElementById('pricing');
                      el?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold text-center"
                  >
                    Contratar
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </nav>

      {/* ─── HERO SECTION (Premium White Theme) ─── */}
      <section className="relative bg-white text-slate-900 py-20 lg:py-32 overflow-hidden border-b border-slate-100">
        {/* Background Gradients */}
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.08),rgba(255,255,255,0))] pointer-events-none"></div>
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-blue-500/5 rounded-full blur-3xl pointer-events-none"></div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-8 items-center">
            
            {/* Text Content */}
            <div className="lg:col-span-7 space-y-8 text-center lg:text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100 text-xs font-bold uppercase tracking-wider">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping"></span>
                Tecnología GPS en Tiempo Real
              </div>

              <h1 className="text-4xl sm:text-6xl font-black tracking-tight leading-[1.1] text-slate-950">
                Control total de tu flota, <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
                  en tiempo real.
                </span>
              </h1>

              <p className="text-slate-550 text-lg sm:text-xl font-medium max-w-xl mx-auto lg:mx-0">
                La plataforma de rastreo y telemetría más intuitiva y estable para taxis y flotillas. Monitorea ubicaciones, velocidades y alertas desde cualquier dispositivo.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4">
                <button
                  onClick={() => {
                    const el = document.getElementById('pricing');
                    el?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-2xl font-bold shadow-lg shadow-blue-600/25 transition-all hover:scale-105 active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  Ver planes y precios <ArrowRight size={18} />
                </button>
                <button
                  onClick={() => navigate(user ? '/map' : '/login')}
                  className="w-full sm:w-auto bg-slate-100 hover:bg-slate-200 text-slate-700 px-8 py-4 rounded-2xl font-bold transition-all flex items-center justify-center gap-2"
                >
                  Demo en vivo
                </button>
              </div>

              {/* Stats badges */}
              <div className="grid grid-cols-3 gap-4 pt-8 max-w-md mx-auto lg:mx-0 border-t border-slate-100">
                <div>
                  <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900">99.9%</h3>
                  <p className="text-slate-400 text-xs sm:text-sm font-semibold uppercase tracking-wider mt-1">Uptime Servidor</p>
                </div>
                <div>
                  <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900">&lt; 1s</h3>
                  <p className="text-slate-400 text-xs sm:text-sm font-semibold uppercase tracking-wider mt-1">Latencia WebSocket</p>
                </div>
                <div>
                  <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900">90d</h3>
                  <p className="text-slate-400 text-xs sm:text-sm font-semibold uppercase tracking-wider mt-1">Historial de Rutas</p>
                </div>
              </div>
            </div>

            {/* Interactive Mockup (Dashboard Preview Vibe) */}
            <div className="lg:col-span-5 relative w-full flex justify-center">
              <div className="w-full max-w-md bg-slate-100 border border-slate-200/80 rounded-[2.5rem] p-4 shadow-xl relative animate-in fade-in slide-in-from-bottom duration-1000">
                {/* Floating GPS card Mockup */}
                <div className="bg-slate-950/90 border border-slate-850 rounded-3xl p-5 shadow-2xl relative overflow-hidden backdrop-blur-md">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h4 className="font-extrabold text-white text-base">Unidad 14 - Concesionario</h4>
                      <p className="text-xs text-slate-500 font-semibold uppercase tracking-widest mt-0.5">Nissan Tsuru 2022</p>
                    </div>
                    <span className="bg-emerald-500/10 text-emerald-400 px-2.5 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-wider border border-emerald-500/20">
                      En Ruta
                    </span>
                  </div>

                  {/* Latency and Position data */}
                  <div className="space-y-3.5 my-5 border-t border-b border-slate-900 py-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500 font-medium">Velocidad actual</span>
                      <span className="text-white font-extrabold">64 km/h</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500 font-medium">Última conexión</span>
                      <span className="text-blue-400 font-semibold flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping"></span>
                        Hace un instante
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500 font-medium">Motor</span>
                      <span className="text-emerald-400 font-bold flex items-center gap-1">
                        Encendido
                      </span>
                    </div>
                  </div>

                  {/* Actions buttons mockup */}
                  <div className="grid grid-cols-2 gap-3 mt-4">
                    <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800/60 text-center">
                      <MapPin className="w-5 h-5 mx-auto mb-1.5 text-blue-500" />
                      <span className="text-xs font-semibold text-slate-300">Ubicación exacta</span>
                    </div>
                    <div className="bg-red-500/10 p-3 rounded-xl border border-red-500/20 text-center cursor-pointer hover:bg-red-500/20 transition-all duration-300">
                      <Power className="w-5 h-5 mx-auto mb-1.5 text-red-500 animate-pulse" />
                      <span className="text-xs font-extrabold text-red-400">Apagado Motor</span>
                    </div>
                  </div>
                </div>

                {/* Second background floating element */}
                <div className="absolute -bottom-6 -left-6 bg-slate-950 border border-slate-800 rounded-2xl p-4 shadow-lg flex items-center gap-3 hidden sm:flex animate-bounce duration-[4000ms]">
                  <div className="p-2.5 rounded-xl bg-blue-600 text-white">
                    <BarChart3 size={20} />
                  </div>
                  <div>
                    <h5 className="font-bold text-xs text-white">Consumo Optimizado</h5>
                    <p className="text-[10px] text-slate-500 font-medium">Ahorro promedio del 14%</p>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ─── CARACTERÍSTICAS TÉCNICAS (Grid) ─── */}
      <section id="features" className="py-24 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-20">
          <h2 className="text-xs font-extrabold text-blue-600 uppercase tracking-widest">¿Por qué Stellar Tracking?</h2>
          <p className="text-3xl sm:text-4xl font-black text-slate-950 tracking-tight mt-3">
            Todo lo necesario para gestionar tu flota de transporte en un solo lugar.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {/* Card 1 */}
          <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-slate-200/30 hover:-translate-y-1 transition-all duration-300 group">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl w-fit mb-6 transition-all group-hover:scale-110">
              <Radio className="w-6 h-6 text-blue-600" />
            </div>
            <h3 className="text-lg font-black text-slate-900 mb-2">WebSocket en Tiempo Real</h3>
            <p className="text-slate-500 text-[14px] leading-relaxed font-medium">
              Olvídate de estar refrescando la página. Con nuestro sistema WebSocket, los vehículos se mueven fluidamente por el mapa a medida que avanzan.
            </p>
          </div>

          {/* Card 2 */}
          <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-slate-200/30 hover:-translate-y-1 transition-all duration-300 group">
            <div className="p-3 bg-red-50 text-red-600 rounded-2xl w-fit mb-6 transition-all group-hover:scale-110">
              <Power className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="text-lg font-black text-slate-900 mb-2">Apagado de Motor</h3>
            <p className="text-slate-500 text-[14px] leading-relaxed font-medium">
              Seguridad de última milla. Detén el vehículo de inmediato desde la plataforma web o móvil en caso de robo o ruta no autorizada.
            </p>
          </div>

          {/* Card 3 */}
          <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-slate-200/30 hover:-translate-y-1 transition-all duration-300 group">
            <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl w-fit mb-6 transition-all group-hover:scale-110">
              <MapPin className="w-6 h-6 text-amber-600" />
            </div>
            <h3 className="text-lg font-black text-slate-900 mb-2">Geocercas Dinámicas</h3>
            <p className="text-slate-500 text-[14px] leading-relaxed font-medium">
              Crea perímetros virtuales en segundos. Recibe notificaciones push o SMS en cuanto un taxi o conductor abandone la zona de trabajo asignada.
            </p>
          </div>

          {/* Card 4 */}
          <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-slate-200/30 hover:-translate-y-1 transition-all duration-300 group">
            <div className="p-3 bg-purple-50 text-purple-600 rounded-2xl w-fit mb-6 transition-all group-hover:scale-110">
              <Clock className="w-6 h-6 text-purple-600" />
            </div>
            <h3 className="text-lg font-black text-slate-900 mb-2">Reproductor de Historial</h3>
            <p className="text-slate-500 text-[14px] leading-relaxed font-medium">
              Visualiza con precisión dónde estuvo cada unidad en un momento exacto del día con el control interactivo de reproducción temporal.
            </p>
          </div>

          {/* Card 5 */}
          <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-slate-200/30 hover:-translate-y-1 transition-all duration-300 group">
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl w-fit mb-6 transition-all group-hover:scale-110">
              <BarChart3 className="w-6 h-6 text-emerald-600" />
            </div>
            <h3 className="text-lg font-black text-slate-900 mb-2">Reportes Consolidados</h3>
            <p className="text-slate-500 text-[14px] leading-relaxed font-medium">
              Genera informes en Excel de distancias, velocidades, tiempos muertos y alertas mecánicas en cuestión de clics.
            </p>
          </div>

          {/* Card 6 */}
          <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-slate-200/30 hover:-translate-y-1 transition-all duration-300 group">
            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl w-fit mb-6 transition-all group-hover:scale-110">
              <Shield className="w-6 h-6 text-indigo-600" />
            </div>
            <h3 className="text-lg font-black text-slate-900 mb-2">Servidor GPS Optimizado</h3>
            <p className="text-slate-500 text-[14px] leading-relaxed font-medium">
              Nuestra infraestructura está optimizada para procesar datos de miles de vehículos de manera asíncrona y con latencia cercana a cero.
            </p>
          </div>
        </div>
      </section>

      {/* ─── TECNOLOGÍA & COMPATIBILIDAD ─── */}
      <section id="coverage" className="bg-slate-900 text-white py-20 relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-xs font-extrabold text-blue-400 uppercase tracking-widest">Compatibilidad Total</h2>
              <h3 className="text-3xl sm:text-4xl font-black tracking-tight leading-tight text-white mt-3">
                Conecta cualquier dispositivo del mercado.
              </h3>
              <p className="text-slate-400 text-base font-medium mt-6 leading-relaxed">
                Stellar Tracking trabaja con los principales protocolos GPS del mercado. Ya sea que uses equipos **SinoTrack**, **Coban**, **Concox**, o que prefieras usar tu teléfono móvil como localizador (vía Traccar Client), nuestra configuración es rápida e intuitiva.
              </p>

              <div className="grid grid-cols-2 gap-6 mt-8">
                <div className="flex items-center gap-2">
                  <div className="p-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                    <Check size={14} />
                  </div>
                  <span className="text-[14px] font-semibold text-slate-300">Coban (TK103, TK303)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="p-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                    <Check size={14} />
                  </div>
                  <span className="text-[14px] font-semibold text-slate-300">SinoTrack (ST-901, ST-902)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="p-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                    <Check size={14} />
                  </div>
                  <span className="text-[14px] font-semibold text-slate-300">Concox (GT06, OB22)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="p-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                    <Check size={14} />
                  </div>
                  <span className="text-[14px] font-semibold text-slate-300">App Móvil (iOS & Android)</span>
                </div>
              </div>
            </div>

            {/* Visual simulation of GPS tracking system */}
            <div className="relative bg-slate-950 rounded-3xl p-8 border border-slate-800 shadow-2xl flex flex-col justify-center">
              <h4 className="font-extrabold text-sm text-slate-400 uppercase tracking-widest mb-4">Servidor API y Puertos</h4>
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-slate-900 border border-slate-800/60 flex justify-between items-center">
                  <div>
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Dirección de Servidor</span>
                    <code className="text-sm font-extrabold text-white">taxis.estrella-eats.mx</code>
                  </div>
                  <span className="bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider">
                    Online
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-slate-900 border border-slate-800/60 flex justify-between items-center">
                  <div>
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Puerto Genéricos GPS</span>
                    <code className="text-sm font-extrabold text-white">5013</code>
                  </div>
                  <span className="text-slate-500 text-xs font-semibold">ST-901</span>
                </div>

                <div className="p-4 rounded-xl bg-slate-900 border border-slate-800/60 flex justify-between items-center">
                  <div>
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Puerto Coban TK103</span>
                    <code className="text-sm font-extrabold text-white">5001</code>
                  </div>
                  <span className="text-slate-500 text-xs font-semibold">Coban</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── PLANES DE PRECIOS ─── */}
      <section id="pricing" className="py-24 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-xs font-extrabold text-blue-600 uppercase tracking-widest">Nuestros Planes</h2>
          <p className="text-3xl sm:text-4xl font-black text-slate-950 tracking-tight mt-3">
            Planes flexibles a la medida de tus necesidades.
          </p>

          {/* Toggle buttons annual/monthly */}
          <div className="inline-flex items-center gap-2 mt-8 bg-slate-200/60 p-1.5 rounded-2xl border border-slate-200">
            <button 
              onClick={() => setIsAnnual(false)}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${!isAnnual ? 'bg-white text-black shadow-sm' : 'text-slate-600 hover:text-black'}`}
            >
              Mensual
            </button>
            <button 
              onClick={() => setIsAnnual(true)}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-1.5 ${isAnnual ? 'bg-white text-black shadow-sm' : 'text-slate-600 hover:text-black'}`}
            >
              Anual <span className="bg-blue-100 text-blue-600 text-[10px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-wider">Ahorra 25%</span>
            </button>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-8 items-stretch">
          {plans.map((plan, i) => (
            <div 
              key={i} 
              className={`bg-white p-8 sm:p-10 rounded-[2.5rem] border transition-all duration-300 flex flex-col justify-between ${
                plan.popular 
                  ? 'border-blue-500 shadow-xl shadow-blue-500/5 ring-1 ring-blue-500 scale-105 z-10' 
                  : 'border-slate-100 shadow-xl shadow-slate-200/30'
              }`}
            >
              <div>
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h3 className="text-xl font-black text-slate-900">{plan.name}</h3>
                    <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">{plan.description}</p>
                  </div>
                  {plan.popular && (
                    <span className="bg-blue-600 text-white px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider shadow-md shadow-blue-500/20">
                      Recomendado
                    </span>
                  )}
                </div>

                <div className="my-6">
                  {typeof plan.price === 'number' ? (
                    <div className="flex items-baseline">
                      <span className="text-slate-900 text-4xl sm:text-5xl font-black tracking-tight">${plan.price}</span>
                      <span className="text-slate-500 text-sm font-semibold ml-1.5">MXN / mes</span>
                    </div>
                  ) : (
                    <span className="text-slate-900 text-4xl sm:text-5xl font-black tracking-tight">{plan.price}</span>
                  )}
                </div>

                <div className="border-t border-slate-100 pt-6 space-y-4 my-6">
                  {plan.features.map((feature, j) => (
                    <div key={j} className="flex items-start gap-2.5">
                      <div className="p-0.5 rounded-full bg-blue-50 text-blue-600 mt-0.5">
                        <Check size={14} />
                      </div>
                      <span className="text-[13px] font-semibold text-slate-600 leading-tight">{feature}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={() => handleCta(plan.name)}
                className={`w-full py-4 px-4 rounded-xl text-sm font-bold transition-all duration-300 flex items-center justify-center gap-1.5 ${
                  plan.popular
                    ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/20 active:scale-[0.98]'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700 active:scale-[0.98]'
                }`}
              >
                {plan.cta}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ─── SECCIÓN DE CONTACTO ─── */}
      <section id="contact" className="bg-slate-950 text-white py-24 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_60%_60%_at_50%_50%,rgba(120,119,198,0.12),rgba(255,255,255,0))] pointer-events-none"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center max-w-2xl mx-auto space-y-8">
          <h2 className="text-xs font-extrabold text-blue-400 uppercase tracking-widest">¿Listo para empezar?</h2>
          <h3 className="text-3xl sm:text-5xl font-black tracking-tight leading-none text-white">
            Optimiza hoy tu operación de transporte.
          </h3>
          <p className="text-slate-400 text-base sm:text-lg font-medium leading-relaxed px-4">
            ¿Tienes dudas sobre los equipos GPS o necesitas una cotización de volumen para más de 10 unidades? Escríbenos y un experto te atenderá de inmediato.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-6">
            <a 
              href="https://wa.me/5211234567890?text=Hola%20Stellar%20Tracking,%20me%20gustar%C3%ADa%20solicitar%20asesor%C3%ADa."
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-2xl font-bold shadow-lg shadow-blue-500/25 transition-all hover:scale-105 active:scale-[0.98]"
            >
              Chatear por WhatsApp
            </a>
            <a 
              href="mailto:soporte@estrella-eats.mx?subject=Cotizacion%20Stellar%20Tracking"
              className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white px-8 py-4 rounded-2xl font-bold border border-slate-800 transition-all"
            >
              Enviar correo electrónico
            </a>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="bg-slate-950 text-slate-600 border-t border-slate-900 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="bg-slate-900 p-1.5 rounded-lg border border-slate-800 text-slate-400">
              <Radio size={16} />
            </div>
            <span className="text-[14px] font-black tracking-widest text-white uppercase">
              Stellar <span className="font-light text-slate-500">Tracking</span>
            </span>
          </div>
          <p className="text-xs font-semibold text-slate-500">
            &copy; 2026 Stellar Tracking. Todos los derechos reservados.
          </p>
        </div>
      </footer>
    </div>
  );
}
