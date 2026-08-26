import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  Shield,
  Clock,
  Check,
  ArrowRight,
  MapPin,
  Power,
  Compass,
  Menu,
  X,
  FileText,
  AlertTriangle,
  HelpCircle,
  HelpCircle as FaqIcon
} from 'lucide-react';

interface ScrollRevealProps {
  children: React.ReactNode;
  className?: string;
  animation?: 'fade-in' | 'slide-up' | 'scale-in' | 'slide-in-right' | 'slide-in-left';
  delay?: number;
  triggerOnce?: boolean;
}

function ScrollReveal({ children, className = '', animation = 'slide-up', delay = 0, triggerOnce = false }: ScrollRevealProps) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (triggerOnce) {
            observer.unobserve(entry.target);
          }
        } else if (!triggerOnce) {
          setIsVisible(false);
        }
      },
      {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
      }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [triggerOnce]);

  const animationClass = {
    'fade-in': 'animate-fade-in',
    'slide-up': 'animate-slide-up',
    'scale-in': 'animate-scale-in',
    'slide-in-right': 'animate-slide-in-right',
    'slide-in-left': 'animate-slide-in-left'
  }[animation];

  return (
    <div
      ref={ref}
      className={`${className} ${isVisible ? animationClass : 'opacity-0'}`}
      style={{
        animationDelay: `${delay}ms`,
        animationFillMode: 'both',
        animationDuration: '600ms'
      }}
    >
      {children}
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeFaq, setActiveFaq] = useState<number | null>(null);

  // --- Mockup live animation state ---
  const locations = [
    'Av. Central y Calle 4',
    'Blvd. Independencia 312',
    'Calle Juárez y 5 de Mayo',
    'Col. Centro, Calle 8',
  ];
  const [locIndex, setLocIndex] = useState(0);
  const [speed, setSpeed] = useState(42);
  const [seconds, setSeconds] = useState(3);
  const [locFade, setLocFade] = useState(true);

  useEffect(() => {
    // Speed fluctuates every 2s
    const speedTimer = setInterval(() => {
      setSpeed(prev => {
        const delta = Math.floor(Math.random() * 11) - 5;
        return Math.min(80, Math.max(15, prev + delta));
      });
    }, 2000);

    // Seconds counter increments every second then resets
    const secTimer = setInterval(() => {
      setSeconds(prev => (prev >= 30 ? 1 : prev + 1));
    }, 1000);

    // Location changes every 6s with fade transition
    const locTimer = setInterval(() => {
      setLocFade(false);
      setTimeout(() => {
        setLocIndex(prev => (prev + 1) % locations.length);
        setLocFade(true);
      }, 400);
    }, 6000);

    return () => {
      clearInterval(speedTimer);
      clearInterval(secTimer);
      clearInterval(locTimer);
    };
  }, []);

  const faqs = [
    {
      q: '¿Le hace daño al carro apagarlo desde la app?',
      a: 'No. El GPS corta la corriente a la bomba de gasolina de forma gradual, igual que si apagas el carro normal. No le pasa nada al motor ni a la computadora del taxi.'
    },
    {
      q: '¿Qué pasa si el chofer desconecta la batería para esconderse?',
      a: 'El GPS tiene batería interna. Si cortan el cable o la batería del carro, te llega alerta al celular de inmediato y el rastreo sigue funcionando por hasta 12 horas sin corriente.'
    },
    {
      q: '¿Tengo que configurarlo yo o viene listo?',
      a: 'Viene listo. Nosotros damos de alta tus carros con placas, nombres de choferes y número de unidad. Tú solo abres la app y ya están ahí.'
    },
    {
      q: '¿Puedo poner límite para que el taxi no salga del municipio?',
      a: 'Sí. Dibujas la zona permitida en el mapa y si el chofer sale de ahí, te llega aviso inmediato. Muchos dueños lo usan para que sus taxis no salgan a carretera sin permiso.'
    }
  ];

  const handleCta = (subject: string) => {
    const message = encodeURIComponent(`Hola Stellar Tracking, quiero cotizar para mis taxis. Asunto: ${subject}.`);
    window.open(`https://wa.me/5211234567890?text=${message}`, '_blank');
  };

  const scrollToSection = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-500/20 scroll-smooth page-transition">

      {/* ─── NAVEGACIÓN ─── */}
      <nav className="sticky top-0 bg-white/95 backdrop-blur-md border-b border-slate-100 z-50 transition-all">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 sm:h-20 items-center">
            {/* Logo */}
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              <div className="bg-blue-600 text-white p-2 rounded-xl">
                <Compass className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              </div>
              <span className="text-lg sm:text-xl font-black tracking-widest text-slate-950 uppercase">
                Stellar <span className="font-light text-slate-600">Tracking</span>
              </span>
            </div>

            {/* Menu */}
            <div className="hidden md:flex items-center gap-8 font-bold text-[13px] text-slate-600 uppercase tracking-wider">
              <a href="#control" className="relative group hover:text-blue-600 transition-colors duration-300 py-1">
                ¿Qué controlas?
                <span className="absolute bottom-0 left-0 w-full h-[2px] bg-blue-600 rounded-full origin-left scale-x-0 transition-transform duration-300 ease-out group-hover:scale-x-100"></span>
              </a>
              <a href="#how-it-works" className="relative group hover:text-blue-600 transition-colors duration-300 py-1">
                Cómo se instala
                <span className="absolute bottom-0 left-0 w-full h-[2px] bg-blue-600 rounded-full origin-left scale-x-0 transition-transform duration-300 ease-out group-hover:scale-x-100"></span>
              </a>
              <a href="#faq" className="relative group hover:text-blue-600 transition-colors duration-300 py-1">
                Preguntas
                <span className="absolute bottom-0 left-0 w-full h-[2px] bg-blue-600 rounded-full origin-left scale-x-0 transition-transform duration-300 ease-out group-hover:scale-x-100"></span>
              </a>
              <a href="#contact" className="relative group hover:text-blue-600 transition-colors duration-300 py-1">
                Cotizar
                <span className="absolute bottom-0 left-0 w-full h-[2px] bg-blue-600 rounded-full origin-left scale-x-0 transition-transform duration-300 ease-out group-hover:scale-x-100"></span>
              </a>
            </div>

            {/* Action Button */}
            <div className="hidden md:flex items-center gap-4">
              {user ? (
                <button
                  onClick={() => navigate('/map')}
                  className="bg-black hover:bg-slate-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-black/10 transition-all hover:scale-105 active:scale-95"
                >
                  Mis taxis
                </button>
              ) : (
                <>
                  <button
                    onClick={() => navigate('/login')}
                    className="text-slate-600 hover:text-black font-bold text-sm transition-all hover:scale-105 active:scale-95"
                  >
                    Entrar
                  </button>
                  <button
                    onClick={() => handleCta('Contratación General')}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-md shadow-blue-600/20 transition-all hover:scale-105 active:scale-95"
                  >
                    Quiero cotizar
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
        <div className={`md:hidden bg-white border-b border-slate-200 overflow-hidden transition-all duration-300 ease-in-out ${mobileMenuOpen ? 'max-h-[400px] opacity-100 py-4 px-6 border-b' : 'max-h-0 opacity-0 py-0 px-6 border-b-0'
          }`}>
          <div className="space-y-3">
            <a href="#control" onClick={() => setMobileMenuOpen(false)} className="block py-2 font-bold text-slate-600 hover:text-black transition-all hover:translate-x-1 duration-200">¿Qué controlas?</a>
            <a href="#how-it-works" onClick={() => setMobileMenuOpen(false)} className="block py-2 font-bold text-slate-600 hover:text-black transition-all hover:translate-x-1 duration-200">Cómo se instala</a>
            <a href="#faq" onClick={() => setMobileMenuOpen(false)} className="block py-2 font-bold text-slate-600 hover:text-black transition-all hover:translate-x-1 duration-200">Preguntas</a>
            <a href="#contact" onClick={() => setMobileMenuOpen(false)} className="block py-2 font-bold text-slate-600 hover:text-black transition-all hover:translate-x-1 duration-200">Cotizar</a>
            <div className="border-t border-slate-100 pt-3 flex flex-col gap-2">
              {user ? (
                <button
                  onClick={() => { setMobileMenuOpen(false); navigate('/map'); }}
                  className="w-full bg-black text-white py-3 rounded-xl font-bold text-center active:scale-[0.98] transition-all"
                >
                  Mis taxis
                </button>
              ) : (
                <>
                  <button
                    onClick={() => { setMobileMenuOpen(false); navigate('/login'); }}
                    className="w-full border border-slate-200 text-slate-700 py-3 rounded-xl font-bold text-center active:scale-[0.98] transition-all"
                  >
                    Entrar
                  </button>
                  <button
                    onClick={() => { setMobileMenuOpen(false); handleCta('Contratación Móvil'); }}
                    className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold text-center active:scale-[0.98] transition-all"
                  >
                    Quiero cotizar
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* ─── HERO SECTION ─── */}
      <section className="relative bg-white text-slate-900 pt-6 pb-10 sm:pt-10 sm:pb-16 lg:pt-14 lg:pb-20 overflow-hidden border-b border-slate-100">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(37,99,235,0.06),rgba(255,255,255,0))] pointer-events-none"></div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-8 items-center">

            {/* Text Content */}
            <ScrollReveal animation="slide-up" className="lg:col-span-7 space-y-6 sm:space-y-8 text-center lg:text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100 text-xs font-bold uppercase tracking-wider">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping"></span>
                Para dueños de taxis en México
              </div>

              <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[1.1] text-slate-950">
                Tus taxis, bajo control{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
                  desde el celular.
                </span>
              </h1>

              <p className="text-slate-600 text-base sm:text-lg lg:text-xl font-medium max-w-xl mx-auto lg:mx-0 leading-relaxed">
                Sin pretextos. Ves la ruta, el horario y si salió de la zona. Y si algo no cuadra, le cortas la corriente desde el celular.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4">
                <button
                  onClick={() => handleCta('Cotizar unidades')}
                  className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-2xl font-bold shadow-lg shadow-blue-600/25 transition-all hover:scale-105 active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  Quiero saber el precio <ArrowRight size={18} />
                </button>
                <button
                  onClick={() => navigate(user ? '/map' : '/login')}
                  className="w-full sm:w-auto bg-slate-100 hover:bg-slate-200 text-slate-700 px-8 py-4 rounded-2xl font-bold transition-all flex items-center justify-center gap-2"
                >
                  Ver cómo funciona
                </button>
              </div>

              {/* Stats badges */}
              <div className="grid grid-cols-3 gap-4 pt-8 max-w-md mx-auto lg:mx-0 border-t border-slate-150 text-center lg:text-left">
                <div>
                  <h3 className="text-xl sm:text-2xl font-extrabold text-slate-900">24/7</h3>
                  <p className="text-slate-400 text-[10px] sm:text-xs font-bold uppercase tracking-wider mt-1">Siempre encendido</p>
                </div>
                <div>
                  <h3 className="text-xl sm:text-2xl font-extrabold text-slate-900">45 min</h3>
                  <p className="text-slate-400 text-[10px] sm:text-xs font-bold uppercase tracking-wider mt-1">Por instalación</p>
                </div>
                <div>
                  <h3 className="text-xl sm:text-2xl font-extrabold text-slate-900">Oculto</h3>
                  <p className="text-slate-400 text-[10px] sm:text-xs font-bold uppercase tracking-wider mt-1">El chofer no lo ve</p>
                </div>
              </div>
            </ScrollReveal>

            {/* Real World Mockup (Tsuru / Placas etc - Real-life look) */}
            <div className="lg:col-span-5 relative w-full flex justify-center mt-6 lg:mt-0">
              <ScrollReveal animation="scale-in" delay={200} className="w-full max-w-xs sm:max-w-sm bg-slate-100 border border-slate-200 rounded-[2.5rem] p-3 sm:p-4 shadow-xl relative">
                {/* Floating GPS card Mockup */}
                <div
                  className="bg-slate-950/95 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-2xl relative overflow-hidden backdrop-blur-md"
                  style={{ animation: 'floatCard 4s ease-in-out infinite' }}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h4 className="font-extrabold text-white text-sm sm:text-base">Unidad 04 — Benito Juárez</h4>
                      <p className="text-[10px] sm:text-xs text-slate-500 font-semibold uppercase tracking-widest mt-0.5">Tsuru Verde/Blanco • Placas A-452-F</p>
                    </div>
                    {/* Pulsing CIRCULANDO badge */}
                    <span
                      className="relative px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-[11px] font-extrabold uppercase tracking-wider"
                      style={{
                        background: 'rgba(16,185,129,0.12)',
                        color: '#34d399',
                        border: '1px solid rgba(16,185,129,0.3)',
                        boxShadow: '0 0 12px rgba(16,185,129,0.25)',
                        animation: 'badgePulse 2s ease-in-out infinite'
                      }}
                    >
                      <span className="absolute inset-0 rounded-full" style={{ animation: 'badgeGlow 2s ease-in-out infinite', background: 'rgba(16,185,129,0.08)' }}></span>
                      Circulando
                    </span>
                  </div>

                  {/* Real-life details data */}
                  <div className="space-y-3 my-4 sm:my-5 border-t border-b border-slate-900 py-3 sm:py-4">
                    {/* Animated location */}
                    <div className="flex justify-between text-xs sm:text-sm">
                      <span className="text-slate-500 font-medium">Ubicación</span>
                      <span
                        className="text-white font-semibold"
                        style={{
                          opacity: locFade ? 1 : 0,
                          transition: 'opacity 0.4s ease'
                        }}
                      >
                        {locations[locIndex]}
                      </span>
                    </div>
                    {/* Animated speed */}
                    <div className="flex justify-between text-xs sm:text-sm">
                      <span className="text-slate-500 font-medium">Velocidad</span>
                      <span
                        className="font-extrabold tabular-nums"
                        style={{
                          color: speed > 60 ? '#f87171' : speed > 40 ? '#fbbf24' : '#a3e635',
                          transition: 'color 0.6s ease'
                        }}
                      >
                        {speed} km/h
                      </span>
                    </div>
                    {/* Live seconds counter */}
                    <div className="flex justify-between text-xs sm:text-sm">
                      <span className="text-slate-500 font-medium">Último reporte</span>
                      <span className="text-blue-400 font-semibold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping"></span>
                        Hace {seconds}s
                      </span>
                    </div>
                    <div className="flex justify-between text-xs sm:text-sm">
                      <span className="text-slate-500 font-medium">Chofer Asignado</span>
                      <span className="text-slate-300 font-semibold">Don Miguel Ángel</span>
                    </div>
                  </div>

                  {/* Actions buttons mockup */}
                  <div className="grid grid-cols-2 gap-2 sm:gap-3 mt-3 sm:mt-4">
                    <div className="bg-slate-900/80 p-2 sm:p-3 rounded-xl border border-slate-800/60 text-center transition-all hover:bg-slate-800/80 hover:border-blue-500/30 hover:scale-[1.03] cursor-pointer">
                      <MapPin className="w-4 h-4 sm:w-5 sm:h-5 mx-auto mb-1 text-blue-500" />
                      <span className="text-[10px] sm:text-xs font-semibold text-slate-300">Ver en Mapa</span>
                    </div>
                    <div className="bg-red-500/10 p-2 sm:p-3 rounded-xl border border-red-500/20 text-center cursor-pointer transition-all hover:bg-red-500/20 hover:border-red-500/40 hover:scale-[1.03]">
                      <Power className="w-4 h-4 sm:w-5 sm:h-5 mx-auto mb-1 text-red-500 animate-pulse" />
                      <span className="text-[10px] sm:text-xs font-extrabold text-red-400">Cortar Corriente</span>
                    </div>
                  </div>
                </div>

                {/* Floating alert card */}
                <div className="absolute -bottom-4 -left-4 bg-slate-950 border border-slate-800 rounded-xl p-3 shadow-lg flex items-center gap-2.5 hidden sm:flex">
                  <div className="p-2 rounded-lg bg-blue-600 text-white">
                    <Shield size={16} />
                  </div>
                  <div>
                    <h5 className="font-bold text-xs text-white">El chofer no sabe que está</h5>
                    <p className="text-[9px] text-slate-500 font-medium">Instalado bajo el tablero</p>
                  </div>
                </div>
              </ScrollReveal>
            </div>

          </div>
        </div>
      </section>

      {/* ─── REAL PROBLEMS CONTROL ─── */}
      <section id="control" className="py-20 sm:py-28 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 scroll-mt-20 sm:scroll-mt-24">
        <ScrollReveal animation="fade-in">
          <div className="text-center max-w-3xl mx-auto mb-16 sm:mb-20">
            <h2 className="text-xs font-extrabold text-blue-600 uppercase tracking-widest">Lo que puedes hacer</h2>
            <p className="text-2xl sm:text-4xl font-black text-slate-950 tracking-tight mt-3">
              Todo lo que un dueño de taxis necesita saber
            </p>
          </div>
        </ScrollReveal>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">

          {/* Item 1 */}
          <ScrollReveal animation="slide-in-left" delay={0} className="h-full">
            <div className="bg-white p-6 sm:p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-slate-200/30 hover:-translate-y-1 transition-all h-full">
              <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl w-fit mb-6">
                <Clock className="w-6 h-6 text-blue-600" />
              </div>
              <h3 className="text-lg font-black text-slate-900 mb-2">Turnos y horarios</h3>
              <p className="text-slate-500 text-[14px] leading-relaxed font-medium">
                Ves a qué hora arrancó el carro y a qué hora paró. Si el chofer dice que no salió trabajo pero el auto anduvo circulando, lo verás ahí mismo.
              </p>
            </div>
          </ScrollReveal>

          {/* Item 2 */}
          <ScrollReveal animation="slide-up" delay={100} className="h-full">
            <div className="bg-white p-6 sm:p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-slate-200/30 hover:-translate-y-1 transition-all h-full">
              <div className="p-3 bg-red-50 text-red-600 rounded-2xl w-fit mb-6">
                <Power className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-lg font-black text-slate-900 mb-2">Corta el motor desde el celular</h3>
              <p className="text-slate-500 text-[14px] leading-relaxed font-medium">
                Si el carro no regresa o el chofer no se reporta, lo apagas desde la app. No vuelve a prender hasta que tú lo actives.
              </p>
            </div>
          </ScrollReveal>

          {/* Item 3 */}
          <ScrollReveal animation="slide-in-right" delay={200} className="h-full">
            <div className="bg-white p-6 sm:p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-slate-200/30 hover:-translate-y-1 transition-all h-full">
              <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl w-fit mb-6">
                <Shield className="w-6 h-6 text-amber-600" />
              </div>
              <h3 className="text-lg font-black text-slate-900 mb-2">Alerta si sale de zona</h3>
              <p className="text-slate-500 text-[14px] leading-relaxed font-medium">
                ¿Tu taxi solo debe circular en tu ciudad? Te avisamos si el chofer se va a carretera, cruza el municipio o entra a una zona que no debe.
              </p>
            </div>
          </ScrollReveal>

          {/* Item 4 */}
          <ScrollReveal animation="slide-in-left" delay={0} className="h-full">
            <div className="bg-white p-6 sm:p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-slate-200/30 hover:-translate-y-1 transition-all h-full">
              <div className="p-3 bg-purple-50 text-purple-600 rounded-2xl w-fit mb-6">
                <MapPin className="w-6 h-6 text-purple-600" />
              </div>
              <h3 className="text-lg font-black text-slate-900 mb-2">Historial de rutas</h3>
              <p className="text-slate-500 text-[14px] leading-relaxed font-medium">
                Revisa el recorrido exacto del día. Si estuvo parado dos horas con el motor prendido o fue a un lugar fuera de ruta, queda registrado.
              </p>
            </div>
          </ScrollReveal>

          {/* Item 5 */}
          <ScrollReveal animation="slide-up" delay={100} className="h-full">
            <div className="bg-white p-6 sm:p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-slate-200/30 hover:-translate-y-1 transition-all h-full">
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl w-fit mb-6">
                <FileText className="w-6 h-6 text-emerald-600" />
              </div>
              <h3 className="text-lg font-black text-slate-900 mb-2">Velocidad y manejo</h3>
              <p className="text-slate-500 text-[14px] leading-relaxed font-medium">
                Cuida tu inversión. Sabes si tu chofer frena de golpe, rebota baches a toda velocidad o si el carro nuevo ya tiene maltratos mecánicos.
              </p>
            </div>
          </ScrollReveal>

          {/* Item 6 */}
          <ScrollReveal animation="slide-in-right" delay={200} className="h-full">
            <div className="bg-white p-6 sm:p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-slate-200/30 hover:-translate-y-1 transition-all h-full">
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl w-fit mb-6">
                <AlertTriangle className="w-6 h-6 text-indigo-600" />
              </div>
              <h3 className="text-lg font-black text-slate-900 mb-2">Aviso si tocan la batería</h3>
              <p className="text-slate-500 text-[14px] leading-relaxed font-medium">
                Si el chofer desconecta la batería para que no lo rastrees, el GPS te manda alerta al celular y sigue transmitiendo por su propia batería interna.
              </p>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ─── CÓMO FUNCIONA ─── */}
      <section id="how-it-works" className="bg-slate-900 text-white py-20 sm:py-28 relative overflow-hidden scroll-mt-20 sm:scroll-mt-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <ScrollReveal animation="fade-in">
            <div className="text-center max-w-2xl mx-auto mb-16">
              <h2 className="text-xs font-extrabold text-blue-400 uppercase tracking-widest">Así empezamos</h2>
              <h3 className="text-2xl sm:text-4xl font-black text-white mt-3">Tres pasos y ya lo tienes funcionando</h3>
            </div>
          </ScrollReveal>

          <div className="grid md:grid-cols-3 gap-8 relative">

            {/* Paso 1 */}
            <ScrollReveal animation="slide-in-left" delay={0}>
              <div className="space-y-4 text-center md:text-left">
                <div className="w-10 h-10 rounded-xl bg-blue-600 text-white font-extrabold flex items-center justify-center text-lg mx-auto md:mx-0 shadow-lg shadow-blue-600/30">
                  1
                </div>
                <h4 className="text-lg font-black">Instalamos el GPS en tu carro</h4>
                <p className="text-slate-400 text-sm font-medium leading-relaxed max-w-xs mx-auto md:mx-0">
                  Tú traes la unidad, nosotros instalamos el GPS oculto bajo el tablero. Son unos 45 minutos por carro, sin dañar nada.
                </p>
              </div>
            </ScrollReveal>

            {/* Paso 2 */}
            <ScrollReveal animation="scale-in" delay={150}>
              <div className="space-y-4 text-center md:text-left">
                <div className="w-10 h-10 rounded-xl bg-blue-600 text-white font-extrabold flex items-center justify-center text-lg mx-auto md:mx-0 shadow-lg shadow-blue-600/30">
                  2
                </div>
                <h4 className="text-lg font-black">Te entregamos tu acceso listo</h4>
                <p className="text-slate-400 text-sm font-medium leading-relaxed max-w-xs mx-auto md:mx-0">
                  Te mandamos usuario y contraseña. Ya dejamos tus carros dados de alta con placas y nombres. Solo inicias sesión.
                </p>
              </div>
            </ScrollReveal>

            {/* Paso 3 */}
            <ScrollReveal animation="slide-in-right" delay={300}>
              <div className="space-y-4 text-center md:text-left">
                <div className="w-10 h-10 rounded-xl bg-blue-600 text-white font-extrabold flex items-center justify-center text-lg mx-auto md:mx-0 shadow-lg shadow-blue-600/30">
                  3
                </div>
                <h4 className="text-lg font-black">Monitorea desde donde estés</h4>
                <p className="text-slate-400 text-sm font-medium leading-relaxed max-w-xs mx-auto md:mx-0">
                  Abre la app a cualquier hora, ves tus carros en vivo, cortas corriente si hace falta y descargas el reporte del día.
                </p>
              </div>
            </ScrollReveal>

          </div>
        </div>
      </section>

      {/* ─── PREGUNTAS (FAQ) ─── */}
      <section id="faq" className="py-20 sm:py-28 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 scroll-mt-20 sm:scroll-mt-24">
        <ScrollReveal animation="fade-in">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <FaqIcon className="w-8 h-8 text-blue-600 mx-auto mb-3" />
            <h2 className="text-xs font-extrabold text-blue-600 uppercase tracking-widest">Preguntas frecuentes</h2>
            <p className="text-2xl sm:text-4xl font-black text-slate-950 tracking-tight mt-3">
              Lo que nos preguntan antes de instalar
            </p>
          </div>
        </ScrollReveal>

        <div className="space-y-4">
          {faqs.map((faq, i) => (
            <ScrollReveal key={i} animation="slide-up" delay={i * 100}>
              <div
                className="group bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-blue-100"
              >
                <button
                  onClick={() => setActiveFaq(activeFaq === i ? null : i)}
                  className="w-full text-left px-6 py-5 sm:px-8 sm:py-6 font-extrabold text-[15px] sm:text-base text-slate-900 group-hover:bg-blue-50/30 flex justify-between items-center gap-4 transition-all"
                >
                  <span className="group-hover:text-blue-600 transition-colors duration-300">{faq.q}</span>
                  <span className={`p-1.5 rounded-lg border transition-all duration-300 ${
                    activeFaq === i 
                      ? 'rotate-180 bg-blue-100 text-blue-600 border-blue-200' 
                      : 'bg-slate-50 text-slate-500 border-slate-100 group-hover:bg-blue-50 group-hover:text-blue-500 group-hover:border-blue-100'
                  }`}>
                    ▼
                  </span>
                </button>

                <div
                  className={`transition-all duration-350 ease-in-out overflow-hidden ${activeFaq === i ? 'max-h-[160px] opacity-100 border-t border-slate-50' : 'max-h-0 opacity-0'
                    }`}
                >
                  <div className="px-6 py-5 sm:px-8 sm:py-6 text-slate-500 text-[14px] leading-relaxed font-semibold">
                    {faq.a}
                  </div>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* ─── CONTACTO / COTIZACIÓN ─── */}
      <section id="contact" className="bg-slate-950 text-white py-20 sm:py-24 relative overflow-hidden scroll-mt-20 sm:scroll-mt-24">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_60%_60%_at_50%_50%,rgba(37,99,235,0.08),rgba(255,255,255,0))] pointer-events-none"></div>
        <ScrollReveal animation="scale-in" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center max-w-2xl mx-auto space-y-6 sm:space-y-8">
          <h2 className="text-xs font-extrabold text-blue-400 uppercase tracking-widest">¿Quieres empezar?</h2>
          <h3 className="text-2xl sm:text-4xl lg:text-5xl font-black tracking-tight leading-tight text-white">
            Escríbenos y te decimos el precio hoy mismo.
          </h3>
          <p className="text-slate-400 text-sm sm:text-base lg:text-lg font-medium leading-relaxed px-4">
            Sin compromiso. Te explicamos cómo funciona, cuánto cuesta y cuándo podemos instalar en tus carros.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <a
              href="https://wa.me/5211234567890?text=Hola%20Stellar%20Tracking,%20quiero%20cotizar%20la%20instalacion%20de%20GPS%20para%20mis%20taxis."
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
              Enviar Correo
            </a>
          </div>
        </ScrollReveal>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="bg-slate-950 text-slate-600 border-t border-slate-900 py-10 sm:py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="bg-slate-900 p-1.5 rounded-lg border border-slate-800 text-slate-400">
              <Compass size={16} />
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
