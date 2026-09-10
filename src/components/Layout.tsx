import React, { useState, useEffect } from 'react';
import { Outlet, useLocation, NavLink, useNavigate } from 'react-router-dom';
import { Menu, Map as MapIcon, BarChart3, Car, Settings, Bell, BellOff, UtensilsCrossed, ShoppingBag, LayoutDashboard, Bot, ClipboardList } from 'lucide-react';
import Sidebar from './Sidebar';
import MapPage from '../pages/MapPage';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { playNewOrderSound } from '../lib/soundNotification';
import { usePushNotifications } from '../hooks/usePushNotifications';
import toast from 'react-hot-toast';

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { userRole, empresaData, empresaId, user } = useAuth();
  const isSuperadmin = userRole === 'superadmin';
  const tipoNegocio = empresaData?.tipo_negocio || (isSuperadmin ? 'taxi' : 'otro');
  const isTaxi = isSuperadmin || tipoNegocio === 'taxi';

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [bottomNavHidden, setBottomNavHidden] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Push notifications: se registra el SW y gestiona suscripciones
  const { isPushEnabled, isPushSupported, enablePush, disablePush } =
    usePushNotifications(
      empresaData?.id ?? null,
      user?.id ?? null
    );

  // Escucha global de nuevos pedidos en tiempo real para hacer sonar el timbre de comanda
  useEffect(() => {
    if (!empresaId) return;

    const channel = supabase
      .channel(`global-pedidos-${empresaId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'pedidos',
          filter: `tenant_id=eq.${empresaId}`
        },
        (payload) => {
          const nuevoPedido = payload.new as { cliente_nombre?: string; direccion_entrega?: string; detalle_pedido?: string };
          console.log('[SOUND ALERT] Nuevo pedido recibido:', nuevoPedido);

          // 1. Timbre sonoro
          playNewOrderSound();

          // 2. Notificación flotante interactiva (browser abierto)
          const cliente = nuevoPedido.cliente_nombre || 'Cliente';
          const direccion = nuevoPedido.direccion_entrega || '';
          const esRecoger = direccion.toLowerCase().includes('recoger');

          toast.custom((t) => (
            <div
              className={`${
                t.visible ? 'animate-enter' : 'animate-leave'
              } max-w-md w-full bg-white shadow-2xl rounded-2xl pointer-events-auto flex ring-1 ring-black ring-opacity-5 border-l-4 border-amber-500 p-4 transition-all duration-300`}
            >
              <div className="flex-1 w-0">
                <div className="flex items-start">
                  <div className="flex-shrink-0 pt-0.5">
                    <span className="text-2xl animate-bounce">🔔</span>
                  </div>
                  <div className="ml-3 flex-1">
                    <p className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                      ¡Nuevo Pedido! {esRecoger ? '🏬 (Recoger en tienda)' : '🛵 (A Domicilio)'}
                    </p>
                    <p className="mt-0.5 text-xs font-semibold text-gray-800">
                      👤 {cliente}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-600 line-clamp-2">
                      📋 {nuevoPedido.detalle_pedido}
                    </p>
                    {/* Si el usuario aún no activó push, invitarlo */}
                    {isPushSupported && !isPushEnabled && Notification.permission !== 'denied' && (
                      <button
                        onClick={() => enablePush()}
                        className="mt-2 text-[10px] font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-900"
                      >
                        🔔 Activar notificaciones para cuando el browser esté cerrado
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-col justify-center gap-2 border-l border-gray-100 pl-3 ml-3">
                <button
                  onClick={() => {
                    toast.dismiss(t.id);
                    navigate('/orders');
                  }}
                  className="w-full border border-transparent rounded-lg px-2.5 py-1.5 inline-flex justify-center text-xs font-bold text-amber-800 bg-amber-100 hover:bg-amber-200 transition"
                >
                  Ver Comanda
                </button>
                <button
                  onClick={() => toast.dismiss(t.id)}
                  className="w-full text-center text-[10px] text-gray-400 hover:text-gray-600 transition"
                >
                  Cerrar
                </button>
              </div>
            </div>
          ), { duration: 9000, position: 'top-right' });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [empresaId, navigate]);
  React.useEffect(() => {
    setMounted(true);

    const hide = () => setBottomNavHidden(true);
    const show = () => setBottomNavHidden(false);
    window.addEventListener('hideBottomNav', hide);
    window.addEventListener('showBottomNav', show);

    let lastScrollY = 0;
    const handleScroll = (e: Event) => {
      const target = e.target as HTMLElement;
      if (!target || typeof target.scrollTop !== 'number') return;

      const currentScrollY = target.scrollTop;
      if (currentScrollY <= 0) {
        setBottomNavHidden(false);
        return;
      }
      if (currentScrollY > lastScrollY + 10) {
        setBottomNavHidden(true);
      } else if (currentScrollY < lastScrollY - 10) {
        setBottomNavHidden(false);
      }
      lastScrollY = currentScrollY;
    };
    // Use capturing phase to catch scroll events from any inner container
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      window.removeEventListener('hideBottomNav', hide);
      window.removeEventListener('showBottomNav', show);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, []);

  const getPageTitle = (path: string) => {
    if (path === '/map' || path === '/') return isTaxi ? 'Mapa en Vivo' : 'Panel Principal';
    if (path === '/dashboard') return isTaxi ? '' : 'Panel Principal';
    if (path === '/orders') return 'Pedidos Activos';
    if (path === '/catalog') return tipoNegocio === 'restaurante' ? 'Menú y Platillos' : 'Catálogo de Productos';
    if (path === '/bot') return 'Bot de Atención IA';
    if (path === '/devices') return 'Mis Taxis';
    if (path === '/connections') return 'Conexiones';
    if (path === '/reports') return 'Reportes';
    if (path === '/replay') return 'Repetición de Ruta';
    if (path === '/geofences') return 'Geocercas';
    if (path === '/maintenance') return 'Mantenimientos';
    if (path === '/notifications') return 'Notificaciones';
    if (path === '/groups') return 'Grupos';
    if (path === '/drivers') return 'Conductores';
    if (path === '/users') return 'Usuarios';
    if (path === '/settings') return 'Configuración';
    return 'Panel de Control';
  };

  const title = getPageTitle(location.pathname);

  return (
    <div className={`flex h-[100dvh] bg-slate-50 overflow-hidden transition-opacity duration-700 ${mounted ? 'opacity-100' : 'opacity-0'}`}>

      {/* Overlay oscuro en móvil cuando sidebar está abierto */}
      <div
        className={`fixed inset-0 bg-gray-900/40 z-30 md:hidden transition-opacity duration-500 ease-out ${sidebarOpen ? 'opacity-100 backdrop-blur-sm' : 'opacity-0 pointer-events-none'
          }`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar — drawer en móvil, fijo en desktop */}
      <div className={`
        fixed inset-y-0 left-0 z-40 transition-all duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]
        md:relative md:translate-x-0 md:z-auto
        ${sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full shadow-none'}
      `}>
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Contenido principal */}
      <main className="flex-1 flex flex-col bg-[#F8FAFC] relative overflow-hidden w-full">

        {/* HEADER TOP GLOBAl */}
        <header className="hidden">
          <div className="flex items-center gap-4">
            <button
              className="md:hidden w-10 h-10 rounded-xl bg-gray-50 text-gray-600 hover:bg-blue-50 hover:text-primary transition flex items-center justify-center"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <Menu size={20} />
            </button>
            <h2 key={title} className="text-lg sm:text-xl font-bold text-gray-800 slide-in-right truncate">
              {title}
            </h2>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            {/* 
                <button className="w-10 h-10 rounded-full bg-gray-50 text-gray-600 hover:bg-blue-50 hover:text-primary transition-colors relative">
                    <Bell size={20} />
                    <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full"></span>
                </button>
                <button className="btn-primary py-1.5 px-3 text-sm shadow-none hidden sm:flex">
                    <Terminal size={18} /> Comando Rápido
                </button>
                <button className="btn-primary w-10 h-10 p-0 shadow-none flex sm:hidden justify-center items-center">
                    <Terminal size={18} />
                </button>
                */}
          </div>
        </header>

        {/* VISTAS DINÁMICAS */}
        <div className="flex-1 overflow-hidden relative">
          {/* MAPA PERSISTENTE (Solo se monta si la empresa es de Taxis / Rastreo) */}
          {isTaxi && (
            <div className={`absolute inset-0 z-0 transition-opacity duration-500 ease-in-out ${location.pathname === '/map' || location.pathname === '/' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
              <MapPage />
            </div>
          )}

          {/* OTRAS PÁGINAS */}
          <div key={location.pathname} className={`absolute inset-0 z-10 bg-[#F8FAFC] page-transition overflow-x-hidden overflow-y-auto ${isTaxi && (location.pathname === '/map' || location.pathname === '/') ? 'hidden' : 'block'}`}>
            <Outlet />
          </div>
        </div>

        {/* BOTTOM NAVIGATION (Mobile Solo) */}
        <div className={`md:hidden absolute bottom-0 left-0 w-full px-4 pb-6 pt-2 bg-transparent z-50 flex justify-center items-center pointer-events-none transition-all duration-[700ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${sidebarOpen || bottomNavHidden ? 'translate-y-24 opacity-0' : 'translate-y-0 opacity-100'} ${isTaxi && (location.pathname === '/map' || location.pathname === '/') ? 'gap-3' : 'gap-0'}`}>
          <nav className="h-[60px] bg-white rounded-full inline-flex justify-center items-center px-2 gap-1 shadow-[0_12px_40px_rgba(0,0,0,0.12)] border border-gray-100 backdrop-blur-lg pointer-events-auto shrink-0 transition-transform duration-[700ms] ease-[cubic-bezier(0.16,1,0.3,1)]">

            {isTaxi ? (
              <>
                <NavLink to="/map" className={({ isActive }) => `relative flex items-center justify-center w-[54px] h-full group`}>
                  {({ isActive }) => (
                    <div className={`p-3 rounded-full transition-all duration-[400ms] ${isActive && !sidebarOpen ? 'bg-gray-900 text-white shadow-md shadow-gray-900/30' : 'text-gray-800 group-hover:bg-gray-100'}`}>
                      <MapIcon size={22} />
                    </div>
                  )}
                </NavLink>

                <NavLink to="/dashboard" className={({ isActive }) => `relative flex items-center justify-center w-[54px] h-full group`}>
                  {({ isActive }) => (
                    <div className={`p-3 rounded-full transition-all duration-[400ms] ${isActive && !sidebarOpen ? 'bg-gray-900 text-white shadow-md shadow-gray-900/30' : 'text-gray-800 group-hover:bg-gray-100'}`}>
                      <BarChart3 size={22} />
                    </div>
                  )}
                </NavLink>

                <NavLink to="/devices" className={({ isActive }) => `relative flex items-center justify-center w-[54px] h-full group`}>
                  {({ isActive }) => (
                    <div className={`p-3 rounded-full transition-all duration-[400ms] ${isActive && !sidebarOpen ? 'bg-gray-900 text-white shadow-md shadow-gray-900/30' : 'text-gray-800 group-hover:bg-gray-100'}`}>
                      <Car size={22} />
                    </div>
                  )}
                </NavLink>
              </>
            ) : (
              <>
                <NavLink to="/dashboard" className={({ isActive }) => `relative flex items-center justify-center w-[54px] h-full group`}>
                  {({ isActive }) => (
                    <div className={`p-3 rounded-full transition-all duration-[400ms] ${isActive && !sidebarOpen ? 'bg-gray-900 text-white shadow-md shadow-gray-900/30' : 'text-gray-800 group-hover:bg-gray-100'}`}>
                      <LayoutDashboard size={22} />
                    </div>
                  )}
                </NavLink>

                <NavLink to="/orders" className={({ isActive }) => `relative flex items-center justify-center w-[54px] h-full group`}>
                  {({ isActive }) => (
                    <div className={`p-3 rounded-full transition-all duration-[400ms] ${isActive && !sidebarOpen ? 'bg-gray-900 text-white shadow-md shadow-gray-900/30' : 'text-gray-800 group-hover:bg-gray-100'}`}>
                      <ClipboardList size={22} />
                    </div>
                  )}
                </NavLink>

                <NavLink to="/catalog" className={({ isActive }) => `relative flex items-center justify-center w-[54px] h-full group`}>
                  {({ isActive }) => (
                    <div className={`p-3 rounded-full transition-all duration-[400ms] ${isActive && !sidebarOpen ? 'bg-gray-900 text-white shadow-md shadow-gray-900/30' : 'text-gray-800 group-hover:bg-gray-100'}`}>
                      {tipoNegocio === 'restaurante' ? <UtensilsCrossed size={22} /> : <ShoppingBag size={22} />}
                    </div>
                  )}
                </NavLink>

                <NavLink to="/bot" className={({ isActive }) => `relative flex items-center justify-center w-[54px] h-full group`}>
                  {({ isActive }) => (
                    <div className={`p-3 rounded-full transition-all duration-[400ms] ${isActive && !sidebarOpen ? 'bg-gray-900 text-white shadow-md shadow-gray-900/30' : 'text-gray-800 group-hover:bg-gray-100'}`}>
                      <Bot size={22} />
                    </div>
                  )}
                </NavLink>
              </>
            )}

            <button onClick={() => setSidebarOpen(true)} className="relative flex items-center justify-center w-[54px] h-full group">
              <div className={`p-3 rounded-full transition-all duration-[400ms] ${sidebarOpen ? 'bg-gray-900 text-white shadow-md shadow-gray-900/30' : 'text-gray-800 group-hover:bg-gray-100'}`}>
                <Settings size={22} />
              </div>
            </button>
          </nav>

          {/* Botón de eventos en vivo global (Móvil Solo Taxis) */}
          {isTaxi && (
            <button 
              onClick={() => window.dispatchEvent(new Event('toggleMobileEvents'))}
              className={`bg-white rounded-full flex items-center justify-center text-gray-800 hover:bg-gray-50 pointer-events-auto transition-all duration-[700ms] ease-[cubic-bezier(0.34,1.3,0.64,1)] shrink-0 overflow-hidden origin-left ${
                location.pathname === '/map' || location.pathname === '/' 
                  ? 'w-[60px] h-[60px] opacity-100 scale-100 shadow-[0_12px_40px_rgba(0,0,0,0.12)] border border-gray-100 rotate-0 translate-x-0' 
                  : 'w-0 h-[60px] opacity-0 scale-50 border-transparent shadow-none -rotate-90 -translate-x-4'
              }`}
            >
              <div className="relative shrink-0 flex items-center justify-center w-[60px] h-[60px]">
                <Bell size={26} />
                <div id="global-bell-badge" className="hidden absolute top-3 right-3 w-3 h-3 bg-red-500 rounded-full border-2 border-white animate-pulse"></div>
              </div>
            </button>
          )}

          {/* Botón Push Notifications (visible en mobile, solo negocios) */}
          {!isTaxi && isPushSupported && (
            <button
              title={isPushEnabled ? 'Desactivar notificaciones push' : 'Activar notificaciones push'}
              onClick={() => isPushEnabled ? disablePush() : enablePush()}
              className={`pointer-events-auto rounded-full flex items-center justify-center transition-all duration-500 ease-[cubic-bezier(0.34,1.3,0.64,1)] shrink-0 shadow-[0_12px_40px_rgba(0,0,0,0.12)] border ${
                isPushEnabled
                  ? 'w-[60px] h-[60px] bg-amber-500 border-amber-400 text-white'
                  : 'w-[60px] h-[60px] bg-white border-gray-100 text-gray-500'
              }`}
            >
              <div className="relative flex items-center justify-center w-[60px] h-[60px]">
                {isPushEnabled ? <Bell size={24} /> : <BellOff size={24} />}
                {isPushEnabled && (
                  <span className="absolute top-3 right-3 w-2.5 h-2.5 bg-green-400 rounded-full border-2 border-white animate-pulse" />
                )}
              </div>
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
