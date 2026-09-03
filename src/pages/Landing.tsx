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
  MessageCircle,
  Star,
  ChevronDown,
  Zap,
} from 'lucide-react';
import { AnimatedMapMockup } from '../components/AnimatedMapMockup';

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
          if (triggerOnce) observer.unobserve(entry.target);
        } else if (!triggerOnce) {
          setIsVisible(false);
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [triggerOnce]);

  const animationClass = {
    'fade-in': 'animate-fade-in',
    'slide-up': 'animate-slide-up',
    'scale-in': 'animate-scale-in',
    'slide-in-right': 'animate-slide-in-right',
    'slide-in-left': 'animate-slide-in-left',
  }[animation];

  return (
    <div
      ref={ref}
      className={`${className} ${isVisible ? animationClass : 'opacity-0'} transform-gpu`}
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'both', animationDuration: '600ms' }}
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
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Live mockup animation
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
  
  // Interactive mockup state
  const [isEngineCut, setIsEngineCut] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  useEffect(() => {
    const speedTimer = setInterval(() => {
      setSpeed(prev => Math.min(80, Math.max(15, prev + Math.floor(Math.random() * 11) - 5)));
    }, 2000);
    const secTimer = setInterval(() => {
      setSeconds(prev => (prev >= 30 ? 1 : prev + 1));
    }, 1000);
    const locTimer = setInterval(() => {
      setLocFade(false);
      setTimeout(() => { setLocIndex(prev => (prev + 1) % locations.length); setLocFade(true); }, 400);
    }, 6000);
    return () => { clearInterval(speedTimer); clearInterval(secTimer); clearInterval(locTimer); };
  }, []);

  const faqs = [
    {
      q: '¿Le hace daño al carro apagarlo desde la app?',
      a: 'No. El GPS corta la corriente a la bomba de gasolina de forma gradual, igual que si apagas el carro normal. No le pasa nada al motor ni a la computadora del taxi.',
    },
    {
      q: '¿Qué pasa si el chofer desconecta la batería para esconderse?',
      a: 'El GPS tiene batería interna. Si cortan el cable o la batería del carro, te llega alerta al celular de inmediato y el rastreo sigue funcionando por hasta 12 horas sin corriente.',
    },
    {
      q: '¿Tengo que configurarlo yo o viene listo?',
      a: 'Viene listo. Nosotros damos de alta tus carros con placas, nombres de choferes y número de unidad. Tú solo abres la app y ya están ahí.',
    },
    {
      q: '¿Puedo poner límite para que el taxi no salga del municipio?',
      a: 'Sí. Dibujas la zona permitida en el mapa y si el chofer sale de ahí, te llega aviso inmediato. Muchos dueños lo usan para que sus taxis no salgan a carretera sin permiso.',
    },
    {
      q: '¿Cuánto tiempo tarda la instalación?',
      a: 'Unos 45 minutos por unidad. El mismo día que nos traes el carro, te lo entregamos con el GPS funcionando y tu acceso a la plataforma activado.',
    },
  ];

  const handleCta = (subject: string) => {
    const message = encodeURIComponent(`Hola Stellar Tracking, quiero cotizar para mis taxis. Asunto: ${subject}.`);
    window.open(`https://wa.me/5219631539156?text=${message}`, '_blank');
  };

  // Testimonials
  const testimonials = [
    {
      name: 'Don Roberto Sánchez',
      city: 'Tuxtla Gutiérrez, Chis.',
      fleet: '8 taxis',
      avatar: 'R',
      color: 'bg-amber-500',
      quote: 'Antes me pasaba que el chofer decía que no había salido y yo sin poder comprobar nada. Ahora en 5 segundos sé dónde está cada unidad y a qué velocidad va. Recuperé el control de mi negocio.',
    },
    {
      name: 'Sra. Carmen Velázquez',
      city: 'Comitán de Domínguez, Chis.',
      fleet: '3 taxis',
      avatar: 'C',
      color: 'bg-rose-500',
      quote: 'Yo no soy de tecnología pero esto sí lo pude aprender. Desde el celular veo mis carros, y si algo raro pasa le llamo al chofer de una. Ya no me preocupa salir de viaje y dejar la flota sola.',
    },
    {
      name: 'Ing. Marco Fuentes',
      city: 'San Cristóbal de las Casas, Chis.',
      fleet: '12 taxis',
      avatar: 'M',
      color: 'bg-blue-600',
      quote: 'Lo que más me gustó fue que ya venía todo configurado. Placas, choferes, todo. Yo solo inicié sesión. En menos de una hora ya estaba monitoreando mi flota completa.',
    },
  ];

  const cities = ['Tuxtla Gutiérrez', 'Comitán', 'San Cristóbal', 'Tapachula', 'Palenque', 'Ocosingo', 'Tonalá', 'Arriaga'];

  return (
    <div className="min-h-screen bg-stone-50 text-slate-900 font-sans selection:bg-amber-500/20 scroll-smooth page-transition">

      {/* ─── NAVEGACIÓN ─── */}
      <nav className={`sticky top-0 z-50 transition-all duration-300 transform-gpu ${isScrolled ? 'bg-white/95 backdrop-blur-md border-b border-zinc-200/80 shadow-sm' : 'bg-transparent border-b-transparent'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className={`flex justify-between items-center transition-all duration-300 ${isScrolled ? 'h-14 sm:h-16' : 'h-16 sm:h-20'}`}>
            <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              <div className="bg-yellow-400 text-zinc-950 p-2 rounded-xl">
                <Compass className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={2.5} />
              </div>
              <span className="text-lg sm:text-xl font-black tracking-widest text-zinc-950 uppercase">
                Stellar <span className="font-light text-zinc-500">Tracking</span>
              </span>
            </div>

            <div className="hidden md:flex items-center gap-8 font-bold text-[13px] text-zinc-500 uppercase tracking-wider">
              {[
                { href: '#control', label: '¿Qué controlas?' },
                { href: '#how-it-works', label: 'Cómo se instala' },
                { href: '#testimonios', label: 'Clientes' },
                { href: '#faq', label: 'Preguntas' },
              ].map(item => (
                <a key={item.href} href={item.href} className="relative group hover:text-zinc-900 transition-colors duration-300 py-1">
                  {item.label}
                  <span className="absolute bottom-0 left-0 w-full h-[2px] bg-yellow-400 rounded-full origin-left scale-x-0 transition-transform duration-300 ease-out group-hover:scale-x-100" />
                </a>
              ))}
            </div>

            <div className="hidden md:flex items-center gap-4">
              {user ? (
                <button onClick={() => navigate('/map')} className="bg-zinc-950 hover:bg-zinc-800 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-sm transition-all hover:scale-105 active:scale-95">
                  Mis taxis
                </button>
              ) : (
                <>
                  <button onClick={() => navigate('/login')} className="text-zinc-500 hover:text-zinc-900 font-bold text-sm transition-all">
                    Entrar
                  </button>
                  <button onClick={() => handleCta('Contratación General')} className="bg-yellow-400 hover:bg-yellow-500 text-zinc-950 px-5 py-2.5 rounded-xl text-sm font-bold transition-all hover:scale-105 active:scale-95 flex items-center gap-2">
                    <MessageCircle size={15} /> Quiero cotizar
                  </button>
                </>
              )}
            </div>

            <div className="md:hidden">
              <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="p-2 rounded-lg text-slate-600 hover:bg-stone-100">
                {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
              </button>
            </div>
          </div>
        </div>

        <div className={`md:hidden bg-white border-b border-stone-200 overflow-hidden transition-all duration-300 ease-in-out ${mobileMenuOpen ? 'max-h-[400px] opacity-100 py-4 px-6' : 'max-h-0 opacity-0 py-0 px-6'}`}>
          <div className="space-y-3">
            {[['#control', '¿Qué controlas?'], ['#how-it-works', 'Cómo se instala'], ['#testimonios', 'Clientes'], ['#faq', 'Preguntas']].map(([href, label]) => (
              <a key={href} href={href} onClick={() => setMobileMenuOpen(false)} className="block py-2 font-bold text-slate-600 hover:text-slate-900 transition-all hover:translate-x-1 duration-200">{label}</a>
            ))}
            <div className="border-t border-stone-100 pt-3 flex flex-col gap-2">
              {user ? (
                <button onClick={() => { setMobileMenuOpen(false); navigate('/map'); }} className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold">Mis taxis</button>
              ) : (
                <>
                  <button onClick={() => { setMobileMenuOpen(false); navigate('/login'); }} className="w-full border border-stone-200 text-slate-700 py-3 rounded-xl font-bold">Entrar</button>
                  <button onClick={() => { setMobileMenuOpen(false); handleCta('Contratación Móvil'); }} className="w-full bg-amber-500 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2"><MessageCircle size={16} /> Quiero cotizar</button>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* ─── HERO ─── */}
      <section className="relative bg-white pt-2 pb-8 sm:pt-4 sm:pb-12 lg:pt-6 lg:pb-12 overflow-hidden border-b border-zinc-100">
        
        {/* Subtle dot pattern instead of glowing orbs */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#000 1px, transparent 1px)', backgroundSize: '24px 24px' }} />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid lg:grid-cols-2 xl:grid-cols-12 gap-8 lg:gap-10 xl:gap-12 items-center">

            {/* Text */}
            <ScrollReveal animation="slide-up" className="xl:col-span-7 space-y-4 sm:space-y-5 text-center lg:text-left">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-100 text-zinc-900 border border-zinc-200 text-[11px] font-bold uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 flex-shrink-0" />
                El control total de tus unidades
              </div>

              <h1 className="text-3xl sm:text-4xl lg:text-4xl xl:text-5xl font-black tracking-tight leading-[1.15] text-zinc-950">
                Tus taxis, siempre en{' '}
                <span className="relative inline-block mt-1 sm:mt-0">
                  la palma de tu mano.
                  <svg className="absolute w-full h-2.5 -bottom-1 left-0 text-yellow-400 -z-10" viewBox="0 0 100 10" preserveAspectRatio="none"><path d="M0 5 Q 50 10 100 5" stroke="currentColor" strokeWidth="8" fill="transparent"/></svg>
                </span>
              </h1>

              <p className="text-zinc-500 text-[15px] sm:text-base lg:text-lg font-medium max-w-xl mx-auto lg:mx-0 leading-relaxed">
                Visualiza exactamente dónde están tus vehículos, a qué velocidad van y cuánto tiempo llevan encendidos. Todo desde tu celular, de forma clara, rápida y sin estrés.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3.5 pt-1">
                <button
                  onClick={() => handleCta('Cotizar unidades')}
                  className="w-full sm:w-auto bg-zinc-950 hover:bg-zinc-800 text-white px-5 py-2.5 rounded-xl text-[15px] font-bold transition-all hover:scale-105 active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  <MessageCircle size={18} /> Quiero saber el precio
                </button>
                <button
                  onClick={() => navigate(user ? '/map' : '/login')}
                  className="w-full sm:w-auto bg-white border-2 border-zinc-200 hover:border-zinc-300 text-zinc-800 px-5 py-2.5 rounded-xl text-[15px] font-bold transition-all flex items-center justify-center gap-2"
                >
                  Ver la plataforma
                </button>
              </div>

              <div className="grid grid-cols-3 gap-3 pt-4 max-w-[400px] mx-auto lg:mx-0 border-t border-zinc-100">
                <div className="text-center lg:text-left">
                  <h3 className="text-xl lg:text-2xl font-extrabold text-zinc-900">24/7</h3>
                  <p className="text-zinc-400 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider mt-0.5">Siempre activo</p>
                </div>
                <div className="text-center lg:text-left">
                  <h3 className="text-xl lg:text-2xl font-extrabold text-zinc-900">45 min</h3>
                  <p className="text-zinc-400 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider mt-0.5">Por vehículo</p>
                </div>
                <div className="text-center lg:text-left">
                  <h3 className="text-xl lg:text-2xl font-extrabold text-zinc-900">Oculto</h3>
                  <p className="text-zinc-400 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider mt-0.5">100% discreto</p>
                </div>
              </div>
            </ScrollReveal>

            <div className="xl:col-span-5 relative w-full flex justify-center mt-8 lg:mt-0">
              <ScrollReveal animation="scale-in" delay={200} className="w-full max-w-[500px] lg:max-w-full xl:max-w-lg">
                <AnimatedMapMockup />
              </ScrollReveal>
            </div>

          </div>
        </div>
      </section>

      {/* ─── SOCIAL PROOF BAR (ciudades) ─── */}
      <div className="bg-stone-900 py-3 overflow-hidden">
        <div className="flex items-center gap-6 animate-marquee whitespace-nowrap">
          {[...cities, ...cities].map((city, i) => (
            <span key={i} className="flex items-center gap-2 text-stone-400 text-xs font-semibold uppercase tracking-widest flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
              {city}
            </span>
          ))}
        </div>
      </div>

      {/* ─── ANTES / AHORA ─── */}
      <section className="py-20 sm:py-28 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <ScrollReveal animation="fade-in">
          <div className="text-center mb-12">
            <p className="text-xs font-extrabold text-amber-500 uppercase tracking-widest mb-3">La diferencia</p>
            <h2 className="text-2xl sm:text-4xl font-black text-slate-950 tracking-tight">
              Así se ve la tranquilidad
            </h2>
          </div>
        </ScrollReveal>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Antes */}
          <ScrollReveal animation="slide-in-left">
            <div className="bg-red-50 border border-red-100 rounded-3xl p-6 sm:p-8 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="px-3 py-1 bg-red-100 text-red-600 text-xs font-black rounded-full uppercase tracking-wider">Antes</span>
              </div>
              {[
                'Llamas al chofer y no contesta',
                'Dice que no hubo trabajo pero el carro anduvo',
                'No sabes si salió a carretera',
                'Si roban el taxi, no puedes rastrearlo',
                'Confías en la palabra del chofer',
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-red-100 text-red-500 flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold">✕</span>
                  <p className="text-sm text-red-800 font-medium">{item}</p>
                </div>
              ))}
            </div>
          </ScrollReveal>

          {/* Ahora */}
          <ScrollReveal animation="slide-in-right" delay={100}>
            <div className="bg-emerald-50 border border-emerald-100 rounded-3xl p-6 sm:p-8 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="px-3 py-1 bg-emerald-100 text-emerald-700 text-xs font-black rounded-full uppercase tracking-wider">Ahora</span>
              </div>
              {[
                'Ves la ubicación exacta en tiempo real',
                'El historial de rutas no miente',
                'Alerta automática si sale de la ciudad',
                'Le cortas la corriente desde el celular',
                'Los datos del GPS son tu respaldo',
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-emerald-200 text-emerald-700 flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold">✓</span>
                  <p className="text-sm text-emerald-900 font-medium">{item}</p>
                </div>
              ))}
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ─── FEATURES ─── */}
      <section id="control" className="bg-white py-20 sm:py-28 scroll-mt-20 sm:scroll-mt-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <ScrollReveal animation="fade-in">
            <div className="text-center max-w-3xl mx-auto mb-16 sm:mb-20">
              <p className="text-xs font-extrabold text-zinc-500 uppercase tracking-widest">Lo que puedes hacer</p>
              <h2 className="text-2xl sm:text-4xl font-black text-zinc-950 tracking-tight mt-3">
                Información clara para tomar mejores decisiones
              </h2>
            </div>
          </ScrollReveal>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
            {[
              { icon: <Clock className="w-5 h-5" />, title: 'Rutas y horarios', text: 'Conoce exactamente a qué hora arrancó y a qué hora paró cada vehículo. Se acabaron las dudas sobre el uso real del coche.' },
              { icon: <Power className="w-5 h-5" />, title: 'Apagado desde el celular', text: 'Si algo no te cuadra o el chofer no responde, puedes cortar la corriente del vehículo desde la app con un solo toque.' },
              { icon: <Shield className="w-5 h-5" />, title: 'Límites de ciudad', text: 'Dibuja una zona en el mapa. Si tu vehículo sale de tu ciudad o de la ruta permitida, te avisamos inmediatamente.' },
              { icon: <MapPin className="w-5 h-5" />, title: 'Historial del día', text: 'Revisa por dónde anduvo el taxi paso a paso. Es súper útil para verificar viajes largos o comprobar si estuvo parado mucho tiempo.' },
              { icon: <FileText className="w-5 h-5" />, title: 'Cuidado del motor', text: 'Sabrás si están corriendo a exceso de velocidad. Proteger el motor y la transmisión de tus vehículos ahora es mucho más fácil.' },
              { icon: <AlertTriangle className="w-5 h-5" />, title: 'Alerta por desconexión', text: 'Si intentan desconectar la batería para apagar el GPS, recibes un aviso al instante y el equipo sigue rastreando gracias a su batería interna.' },
            ].map((item, i) => (
              <ScrollReveal key={i} animation={i % 3 === 0 ? 'slide-in-left' : i % 3 === 2 ? 'slide-in-right' : 'slide-up'} delay={i * 60} className="h-full">
                <div className="bg-white p-6 sm:p-8 rounded-3xl border-2 border-zinc-100 hover:border-zinc-300 transition-all h-full group">
                  <div className="p-3 bg-zinc-50 text-zinc-900 border border-zinc-200 rounded-xl w-fit mb-5 group-hover:bg-yellow-400 group-hover:border-yellow-400 transition-colors">{item.icon}</div>
                  <h3 className="text-base font-black text-zinc-950 mb-2">{item.title}</h3>
                  <p className="text-zinc-500 text-[14px] leading-relaxed font-medium">{item.text}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CÓMO FUNCIONA ─── */}
      <section id="how-it-works" className="bg-zinc-950 text-white py-20 sm:py-28 relative overflow-hidden scroll-mt-20 sm:scroll-mt-24">
        {/* Abstract subtle grid lines */}
        <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <ScrollReveal animation="fade-in">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <p className="text-xs font-extrabold text-yellow-400 uppercase tracking-widest">Puesta en marcha</p>
              <h2 className="text-2xl sm:text-4xl font-black text-white mt-3">Tres pasos simples para tener el control</h2>
            </div>
          </ScrollReveal>

          <div className="grid md:grid-cols-3 gap-8 relative">
            {[
              { num: '1', title: 'Instalamos el equipo', text: 'Nuestros técnicos colocan el dispositivo GPS de forma oculta en unos 45 minutos. Lo hacemos con mucho cuidado para mantener intacta la parte eléctrica del carro.' },
              { num: '2', title: 'Te damos tu acceso', text: 'Entregamos tu cuenta lista para usarse. Ya configuramos previamente las placas y unidades para que tú solo abras la app e inicies sesión sin complicaciones.' },
              { num: '3', title: 'Empiezas a monitorear', text: 'A partir de ese momento, tienes la ubicación en vivo de toda tu flotilla en la pantalla de tu celular o computadora. Así de fácil y rápido.' },
            ].map((step, i) => (
              <ScrollReveal key={i} animation={i === 0 ? 'slide-in-left' : i === 2 ? 'slide-in-right' : 'scale-in'} delay={i * 150}>
                <div className="space-y-4 text-center md:text-left group">
                  <div className="w-10 h-10 rounded-full border-2 border-yellow-400 text-yellow-400 font-extrabold flex items-center justify-center text-lg mx-auto md:mx-0 transition-colors group-hover:bg-yellow-400 group-hover:text-zinc-950">
                    {step.num}
                  </div>
                  <h3 className="text-lg font-black text-white">{step.title}</h3>
                  <p className="text-zinc-400 text-sm font-medium leading-relaxed max-w-xs mx-auto md:mx-0">{step.text}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── TESTIMONIALES ─── */}
      <section id="testimonios" className="py-20 sm:py-28 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 scroll-mt-20 sm:scroll-mt-24">
        <ScrollReveal animation="fade-in">
          <div className="text-center mb-14">
            <p className="text-xs font-extrabold text-amber-500 uppercase tracking-widest mb-3">Casos reales</p>
            <h2 className="text-2xl sm:text-4xl font-black text-slate-950 tracking-tight">
              Lo que dicen nuestros clientes
            </h2>
            <p className="text-stone-500 font-medium mt-3 text-sm sm:text-base">No vendemos tecnología. Vendemos tranquilidad.</p>
          </div>
        </ScrollReveal>

        <div className="grid md:grid-cols-3 gap-6">
          {testimonials.map((t, i) => (
            <ScrollReveal key={i} animation="slide-up" delay={i * 100} className="h-full">
              <div className="bg-white rounded-3xl border border-stone-100 shadow-sm hover:shadow-xl hover:shadow-stone-200/50 hover:-translate-y-1 transition-all p-6 sm:p-7 h-full flex flex-col">
                {/* Stars */}
                <div className="flex gap-1 mb-4">
                  {[1,2,3,4,5].map(s => <Star key={s} size={14} className="text-amber-400" fill="currentColor" />)}
                </div>
                {/* Quote */}
                <p className="text-slate-700 text-sm leading-relaxed font-medium flex-1 mb-6">
                  "{t.quote}"
                </p>
                {/* Author */}
                <div className="flex items-center gap-3 pt-4 border-t border-stone-100">
                  <div className={`w-10 h-10 rounded-full ${t.color} text-white flex items-center justify-center font-black text-sm flex-shrink-0`}>
                    {t.avatar}
                  </div>
                  <div>
                    <p className="text-sm font-black text-slate-900">{t.name}</p>
                    <p className="text-xs text-stone-400 font-medium">{t.city} · {t.fleet}</p>
                  </div>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* ─── FAQ ─── */}
      <section id="faq" className="py-20 sm:py-28 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 scroll-mt-20 sm:scroll-mt-24">
        <ScrollReveal animation="fade-in">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <p className="text-xs font-extrabold text-amber-500 uppercase tracking-widest mb-3">Preguntas frecuentes</p>
            <h2 className="text-2xl sm:text-4xl font-black text-slate-950 tracking-tight">
              Lo que nos preguntan antes de instalar
            </h2>
          </div>
        </ScrollReveal>

        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <ScrollReveal key={i} animation="slide-up" delay={i * 80}>
              <div className={`bg-white rounded-2xl border transition-all duration-300 overflow-hidden ${activeFaq === i ? 'border-amber-200 shadow-sm shadow-amber-100' : 'border-stone-100 hover:border-stone-200'}`}>
                <button
                  onClick={() => setActiveFaq(activeFaq === i ? null : i)}
                  className="w-full text-left px-6 py-5 font-bold text-[15px] text-slate-900 flex justify-between items-center gap-4 transition-all"
                >
                  <span className={`transition-colors ${activeFaq === i ? 'text-amber-600' : ''}`}>{faq.q}</span>
                  <ChevronDown size={18} className={`flex-shrink-0 text-stone-400 transition-transform duration-300 ${activeFaq === i ? 'rotate-180 text-amber-500' : ''}`} />
                </button>
                <div className={`transition-all duration-300 ease-in-out overflow-hidden ${activeFaq === i ? 'max-h-48 opacity-100' : 'max-h-0 opacity-0'}`}>
                  <p className="px-6 pb-5 text-stone-500 text-sm leading-relaxed font-medium border-t border-stone-50 pt-4">{faq.a}</p>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* ─── CTA FINAL ─── */}
      <section id="contact" className="bg-zinc-950 py-20 sm:py-24 relative overflow-hidden scroll-mt-20 sm:scroll-mt-24 border-t border-zinc-800">
        <ScrollReveal animation="scale-in" className="max-w-2xl mx-auto px-4 sm:px-6 text-center relative z-10 space-y-6">
          <p className="text-yellow-400 text-xs font-extrabold uppercase tracking-widest">¿Listo para tener el control?</p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white leading-tight tracking-tight">
            Mándanos un mensaje y agendamos tu instalación.
          </h2>
          <p className="text-zinc-400 text-sm sm:text-base font-medium leading-relaxed">
            Pídenos información por WhatsApp. Te damos los precios de inmediato, resolvemos tus dudas sin dar tantas vueltas y empezamos a trabajar.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <a
              href="https://wa.me/5219631539156?text=Hola%20Stellar%20Tracking,%20quiero%20cotizar%20GPS%20para%20mis%20taxis."
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto bg-yellow-400 hover:bg-yellow-500 text-zinc-950 px-8 py-4 rounded-2xl font-black transition-all hover:scale-105 active:scale-[0.98] flex items-center justify-center gap-2 text-base"
            >
              <MessageCircle size={20} /> Chatear por WhatsApp
            </a>
          </div>
          <p className="text-zinc-500 text-xs font-medium pt-4">
            🔒 Tu información nunca se comparte con terceros.
          </p>
        </ScrollReveal>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="bg-slate-950 text-slate-600 border-t border-slate-900 py-10 sm:py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div className="bg-amber-500/20 p-1.5 rounded-lg text-amber-500">
              <Compass size={16} />
            </div>
            <span className="text-[14px] font-black tracking-widest text-white uppercase">
              Stellar <span className="font-light text-slate-500">Tracking</span>
            </span>
          </div>
          <p className="text-xs font-semibold text-slate-600">
            &copy; 2026 Stellar Tracking. Chiapas, México.
          </p>
        </div>
      </footer>

      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee {
          animation: marquee 20s linear infinite;
          width: max-content;
        }
        @keyframes floatCard {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
        @keyframes badgePulse {
          0%, 100% { box-shadow: 0 0 8px rgba(16,185,129,0.2); }
          50% { box-shadow: 0 0 18px rgba(16,185,129,0.5); }
        }
      `}</style>
    </div>
  );
}
