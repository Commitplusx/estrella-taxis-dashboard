import React, { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Menu, Map as MapIcon, Car, BarChart3 } from 'lucide-react';
import Sidebar from './Sidebar';

export default function Layout() {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // El mapa necesita llenar todo el espacio sin padding
  const isMapPage = location.pathname === '/map' || location.pathname === '/';
  
  const [mounted, setMounted] = useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <div className={`flex h-screen bg-slate-50 overflow-hidden transition-opacity duration-700 ${mounted ? 'opacity-100' : 'opacity-0'}`}>

      {/* Overlay oscuro en móvil cuando sidebar está abierto */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — drawer en móvil, fijo en desktop */}
      <div className={`
        fixed inset-y-0 left-0 z-50 transition-transform duration-300 ease-in-out
        md:relative md:translate-x-0 md:z-auto
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Contenido principal */}
      <main className="flex-1 overflow-y-auto min-w-0 flex flex-col relative">
        {/* Topbar solo en móvil (Centrado, Glassmorphism) */}
        <div className="sticky top-0 z-10 flex items-center justify-center px-4 py-3 bg-white/80 backdrop-blur-md border-b border-gray-100 shadow-sm md:hidden flex-shrink-0">
          <span className="text-[15px] font-extrabold text-blue-600 tracking-tight">Estrella Taxis</span>
        </div>

        <div
          key={location.pathname}
          className={`flex-1 flex flex-col page-transition ${isMapPage ? '' : 'p-4 md:p-6 pb-28 md:pb-6'}`}
        >
          <Outlet />
        </div>

        {/* ─── Bottom Navigation (Móvil) ─── */}
        <div className="md:hidden fixed bottom-5 left-4 right-4 bg-white/90 backdrop-blur-lg border border-slate-200/50 shadow-2xl rounded-2xl z-30 flex items-center justify-around py-2 px-2">
          
          <NavLink to="/map" className={({isActive}) => `flex flex-col items-center justify-center w-16 h-12 rounded-xl transition-all ${isActive ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
            <MapIcon size={22} className={location.pathname === '/map' ? 'fill-blue-50 text-blue-600' : ''} />
            <span className="text-[10px] font-bold mt-1">Mapa</span>
          </NavLink>
          
          <NavLink to="/devices" className={({isActive}) => `flex flex-col items-center justify-center w-16 h-12 rounded-xl transition-all ${isActive ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
            <Car size={22} className={location.pathname === '/devices' ? 'fill-blue-50 text-blue-600' : ''} />
            <span className="text-[10px] font-bold mt-1">Taxis</span>
          </NavLink>
          
          <NavLink to="/dashboard" className={({isActive}) => `flex flex-col items-center justify-center w-16 h-12 rounded-xl transition-all ${isActive ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
            <BarChart3 size={22} className={location.pathname === '/dashboard' ? 'fill-blue-50 text-blue-600' : ''} />
            <span className="text-[10px] font-bold mt-1">Panel</span>
          </NavLink>
          
          <button onClick={() => setSidebarOpen(true)} className="flex flex-col items-center justify-center w-16 h-12 rounded-xl transition-all text-slate-400 hover:text-slate-600">
            <Menu size={22} />
            <span className="text-[10px] font-bold mt-1">Menú</span>
          </button>
          
        </div>
      </main>
    </div>
  );
}
