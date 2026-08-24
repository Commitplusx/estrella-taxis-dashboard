import React, { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import Sidebar from './Sidebar';

export default function Layout() {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // El mapa necesita llenar todo el espacio sin padding
  const isMapPage = location.pathname === '/map' || location.pathname === '/';

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">

      {/* Overlay oscuro en móvil cuando sidebar está abierto */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-20 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — drawer en móvil, fijo en desktop */}
      <div className={`
        fixed inset-y-0 left-0 z-30 transition-transform duration-300 ease-in-out
        md:relative md:translate-x-0 md:z-auto
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Contenido principal */}
      <main className="flex-1 overflow-y-auto min-w-0 flex flex-col">
        {/* Topbar solo en móvil */}
        <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-100 shadow-sm md:hidden flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-xl hover:bg-gray-100 transition text-gray-600"
          >
            <Menu size={20} />
          </button>
          <span className="text-sm font-bold text-gray-800">Estrella Taxis</span>
        </div>

        <div
          key={location.pathname}
          className={`flex-1 flex flex-col page-transition ${isMapPage ? '' : 'p-4 md:p-6'}`}
        >
          <Outlet />
        </div>
      </main>
    </div>
  );
}
