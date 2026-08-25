import React, { useState } from 'react';
import { Outlet, useLocation, NavLink } from 'react-router-dom';
import { Menu, Map as MapIcon, BarChart3, Car, Settings } from 'lucide-react';
import Sidebar from './Sidebar';

export default function Layout() {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [mounted, setMounted] = useState(false);
  React.useEffect(() => setMounted(true), []);

  const getPageTitle = (path: string) => {
    if (path === '/map' || path === '/') return 'Mapa en Vivo';
    if (path === '/dashboard') return 'Dashboard';
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
        className={`fixed inset-0 bg-gray-900/40 z-30 md:hidden transition-opacity duration-500 ease-out ${
          sidebarOpen ? 'opacity-100 backdrop-blur-sm' : 'opacity-0 pointer-events-none'
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
        <header className="h-16 flex-none bg-white border-b border-gray-100 hidden md:flex items-center justify-between px-4 sm:px-8 shrink-0 relative z-10 shadow-sm transition-all duration-300">
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
        <div key={location.pathname} className="flex-1 overflow-hidden relative page-transition">
          <Outlet />
        </div>
        
        {/* BOTTOM NAVIGATION (Mobile Solo) */}
        <div className={`md:hidden absolute bottom-0 left-0 w-full px-2 pb-6 pt-2 bg-transparent z-50 flex justify-center pointer-events-none transition-all duration-300 ${sidebarOpen ? 'translate-y-[150%] opacity-0' : 'translate-y-0 opacity-100'}`}>
          <nav className="h-[68px] bg-white rounded-full inline-flex justify-center items-center px-4 gap-2 shadow-[0_12px_40px_rgba(0,0,0,0.12)] border border-gray-100 backdrop-blur-lg pointer-events-auto">
            
            <NavLink to="/map" className={({isActive}) => `relative flex flex-col items-center justify-center w-[64px] h-full gap-1 group`}>
              {({isActive}) => (
                <>
                  <div className={`p-2 rounded-xl transition-all duration-300 ${isActive && !sidebarOpen ? 'bg-gray-900 text-white shadow-md shadow-gray-900/30 -translate-y-1' : 'text-gray-800 group-hover:bg-gray-100'}`}>
                    <MapIcon size={20} />
                  </div>
                  <span className={`text-[10px] transition-all duration-300 ${isActive && !sidebarOpen ? 'font-bold text-gray-900 translate-y-0' : 'font-medium text-gray-600'}`}>Mapa</span>
                </>
              )}
            </NavLink>

            <NavLink to="/dashboard" className={({isActive}) => `relative flex flex-col items-center justify-center w-[64px] h-full gap-1 group`}>
              {({isActive}) => (
                <>
                  <div className={`p-2 rounded-xl transition-all duration-300 ${isActive && !sidebarOpen ? 'bg-gray-900 text-white shadow-md shadow-gray-900/30 -translate-y-1' : 'text-gray-800 group-hover:bg-gray-100'}`}>
                    <BarChart3 size={20} />
                  </div>
                  <span className={`text-[10px] transition-all duration-300 ${isActive && !sidebarOpen ? 'font-bold text-gray-900 translate-y-0' : 'font-medium text-gray-600'}`}>Panel</span>
                </>
              )}
            </NavLink>

            <NavLink to="/devices" className={({isActive}) => `relative flex flex-col items-center justify-center w-[64px] h-full gap-1 group`}>
              {({isActive}) => (
                <>
                  <div className={`p-2 rounded-xl transition-all duration-300 ${isActive && !sidebarOpen ? 'bg-gray-900 text-white shadow-md shadow-gray-900/30 -translate-y-1' : 'text-gray-800 group-hover:bg-gray-100'}`}>
                    <Car size={20} />
                  </div>
                  <span className={`text-[10px] transition-all duration-300 ${isActive && !sidebarOpen ? 'font-bold text-gray-900 translate-y-0' : 'font-medium text-gray-600'}`}>Taxis</span>
                </>
              )}
            </NavLink>

            <button onClick={() => setSidebarOpen(true)} className="relative flex flex-col items-center justify-center w-[64px] h-full gap-1 group">
              <div className={`p-2 rounded-xl transition-all duration-300 ${sidebarOpen ? 'bg-gray-900 text-white shadow-md shadow-gray-900/30 -translate-y-1' : 'text-gray-800 group-hover:bg-gray-100'}`}>
                <Settings size={20} />
              </div>
              <span className={`text-[10px] transition-all duration-300 ${sidebarOpen ? 'font-bold text-gray-900 translate-y-0' : 'font-medium text-gray-600'}`}>Ajustes</span>
            </button>

          </nav>
        </div>
      </main>
    </div>
  );
}
