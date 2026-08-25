import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Map, Users, BarChart3, Settings, Car, LogOut, Shield, Bell, Play, Layers, UserCheck, Hexagon, ChevronRight, Wrench, X, Activity } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface SidebarProps {
  onClose?: () => void;
}



export default function Sidebar({ onClose }: SidebarProps) {
  const { user, logout } = useAuth();

  const mainItems = [
    { to: '/map', icon: <Map size={18} />, label: 'Mapa en Vivo' },
    { to: '/dashboard', icon: <BarChart3 size={18} />, label: 'Dashboard' },
    { to: '/devices', icon: <Car size={18} />, label: 'Mis Taxis' },
  ];

  const toolsItems = [
    { to: '/connections', icon: <Activity size={16} />, label: 'Conexiones' },
    { to: '/reports', icon: <BarChart3 size={16} />, label: 'Reportes' },
    { to: '/replay', icon: <Play size={16} />, label: 'Repetición Ruta' },
    { to: '/geofences', icon: <Hexagon size={16} />, label: 'Geocercas' },
    { to: '/maintenance', icon: <Wrench size={16} />, label: 'Mantenimientos' },
    { to: '/notifications', icon: <Bell size={16} />, label: 'Notificaciones' },
  ];

  const adminItems = [
    { to: '/groups', icon: <Layers size={16} />, label: 'Grupos', always: true },
    { to: '/drivers', icon: <UserCheck size={16} />, label: 'Conductores', always: true },
    { to: '/users', icon: <Users size={16} />, label: 'Usuarios', always: false, adminOnly: true },
    { to: '/settings', icon: <Settings size={16} />, label: 'Configuración', always: false, adminOnly: true },
  ].filter(item => item.always || (item.adminOnly && user?.administrator));

  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    tools: true,
    admin: true,
  });

  const toggleSection = (key: string) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await new Promise(r => setTimeout(r, 400)); // Pequeña pausa para mostrar el spinner
    await logout();
  };

  return (
    <aside className="h-screen w-72 bg-white border-r border-gray-100 flex flex-col shadow-sm flex-shrink-0">
      
      {/* Header del Sidebar */}
      <div className="p-6 flex items-center gap-3 border-b border-gray-50 relative">
        <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center text-white shadow-md shadow-blue-500/30">
          <Car size={20} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900 tracking-tight">Estrella Taxi</h2>
          <p className="text-xs text-green-500 font-medium flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> Sistema Online
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} className="md:hidden absolute right-4 top-6 text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        )}
      </div>

      {/* Navegación */}
      <nav className="flex-1 overflow-y-auto scrollbar-hide py-4 px-3 space-y-1">
        <div className="px-2 mb-2 mt-2">
          <span className="px-3 py-1 bg-blue-600 text-white text-[10px] font-bold uppercase tracking-widest rounded-lg shadow-sm">Rastreo</span>
        </div>
        
        {mainItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onClose}
            className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}
          >
            <div className="w-5 text-center flex justify-center">{item.icon}</div>
            <span className="font-medium">{item.label}</span>
          </NavLink>
        ))}

        <button 
          onClick={() => toggleSection('tools')}
          className="w-full flex items-center justify-between px-2 mb-2 mt-6 cursor-pointer group"
        >
          <span className="px-3 py-1 bg-gray-900 text-white text-[10px] font-bold uppercase tracking-widest rounded-lg shadow-sm transition-transform group-hover:scale-105">Análisis y Herr.</span>
          <div className={`transform transition-transform duration-500 ease-out text-gray-400 group-hover:text-gray-900 ${openSections.tools ? 'rotate-90' : 'rotate-0'}`}>
            <ChevronRight size={14} />
          </div>
        </button>
        
        <div className={`overflow-hidden transition-all duration-500 ease-in-out ${openSections.tools ? 'max-h-[400px]' : 'max-h-0'}`}>
          <div className="space-y-1 pt-1 pb-2">
            {toolsItems.map((item, index) => {
              const isOpen = openSections.tools;
              const delay = isOpen ? index * 60 : (toolsItems.length - 1 - index) * 30;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onClose}
                  className={({ isActive }) => `sidebar-item transform transition-all duration-300 ${isActive ? 'active' : ''} ${isOpen ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4'}`}
                  style={{ transitionDelay: `${delay}ms` }}
                >
                  <div className="w-5 text-center flex justify-center">{item.icon}</div>
                  <span className="font-medium">{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        </div>

        {adminItems.length > 0 && (
          <>
            <button 
              onClick={() => toggleSection('admin')}
              className="w-full flex items-center justify-between px-2 mb-2 mt-6 cursor-pointer group"
            >
              <span className="px-3 py-1 bg-red-600 text-white text-[10px] font-bold uppercase tracking-widest rounded-lg shadow-sm transition-transform group-hover:scale-105">Administración</span>
              <div className={`transform transition-transform duration-500 ease-out text-gray-400 group-hover:text-red-600 ${openSections.admin ? 'rotate-90' : 'rotate-0'}`}>
                <ChevronRight size={14} />
              </div>
            </button>
            
            <div className={`overflow-hidden transition-all duration-500 ease-in-out ${openSections.admin ? 'max-h-[400px]' : 'max-h-0'}`}>
              <div className="space-y-1 pt-1 pb-2">
                {adminItems.map((item, index) => {
                  const isOpen = openSections.admin;
                  const delay = isOpen ? index * 60 : (adminItems.length - 1 - index) * 30;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={onClose}
                      className={({ isActive }) => `sidebar-item transform transition-all duration-300 ${isActive ? 'active' : ''} ${isOpen ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4'}`}
                      style={{ transitionDelay: `${delay}ms` }}
                    >
                      <div className="w-5 text-center flex justify-center">{item.icon}</div>
                      <span className="font-medium">{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </nav>

      {/* Footer Usuario */}
      <div className="p-4 border-t border-gray-100">
        <div 
          onClick={handleLogout}
          className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-red-50 hover:text-red-600 transition group"
        >
          <div className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center font-bold shadow-sm group-hover:bg-red-500 transition-colors">
            {user?.name?.charAt(0)?.toUpperCase() || 'A'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate group-hover:text-red-600">{user?.name || 'Usuario'}</p>
            <p className="text-xs text-gray-500 truncate group-hover:text-red-400">{user?.administrator ? 'Super Administrador' : 'Operador'}</p>
          </div>
          {isLoggingOut ? (
            <svg className="animate-spin h-4 w-4 text-red-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <LogOut size={18} className="text-gray-400 group-hover:text-red-500 transition" />
          )}
        </div>
      </div>
    </aside>
  );
}
