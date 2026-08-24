import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Map, Users, BarChart3, Settings, Car, LogOut, Shield, Bell, Play, Layers, UserCheck, Hexagon, ChevronRight, Wrench, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface SidebarProps {
  onClose?: () => void;
}

function SidebarGroup({ icon, label, items, onNavClick }: {
  icon: React.ReactNode; label: string; items: any[]; onNavClick?: () => void;
}) {
  const location = useLocation();
  const isActive = items.some(item => location.pathname === item.to || (item.to === '/' && location.pathname === '/'));
  const [open, setOpen] = useState(isActive);

  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm transition-all duration-200 ${
          isActive
            ? 'text-blue-700 font-bold bg-blue-50/50'
            : 'text-gray-500 hover:bg-gray-50 hover:text-blue-600 hover:translate-x-1'
        }`}
      >
        <div className="flex items-center gap-3">
          {icon}
          <span>{label}</span>
        </div>
        <ChevronRight size={14} className={`opacity-50 transition-transform duration-300 ${open ? 'rotate-90' : 'rotate-0'}`} />
      </button>

      <div className={`grid transition-all duration-300 ease-in-out ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <div className="mt-1 space-y-1">
            {items.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={onNavClick}
                className={({ isActive }) =>
                  `flex items-center gap-3 pl-[46px] pr-4 py-2.5 rounded-xl text-sm transition-all duration-200 ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20 font-semibold'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-blue-600 hover:translate-x-1'
                  }`
                }
              >
                {item.icon}
                <span>{item.label}</span>
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Sidebar({ onClose }: SidebarProps) {
  const { user, logout } = useAuth();

  const mainItems = [
    { to: '/map', icon: <Map size={18} />, label: 'Mapa en Vivo' },
    { to: '/dashboard', icon: <BarChart3 size={18} />, label: 'Dashboard' },
    { to: '/devices', icon: <Car size={18} />, label: 'Mis Taxis' },
  ];

  const toolsItems = [
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

  return (
    <div className="h-screen w-64 bg-white border-r border-gray-100 flex flex-col shadow-sm">

      {/* Logo + botón cerrar en móvil */}
      <div className="p-5 border-b border-gray-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2.5 rounded-xl shadow-md shadow-blue-600/20">
            <Car className="text-white" size={20} />
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-gray-900 leading-none tracking-tight">Estrella Taxis</h1>
            <p className="text-xs text-gray-400 mt-1 font-medium">Panel de Control</p>
          </div>
        </div>
        {/* Solo visible en móvil */}
        {onClose && (
          <button
            onClick={onClose}
            className="md:hidden p-1.5 rounded-xl hover:bg-gray-100 transition text-gray-400"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 p-4 overflow-y-auto">
        <div className="space-y-1 mb-6">
          <div className="px-3 mb-3 text-[10px] font-bold tracking-[0.15em] text-gray-400/80 uppercase">Principal</div>
          {mainItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-all duration-200 ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20 font-semibold'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-blue-600 hover:translate-x-1'
                }`
              }
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>

        <div className="space-y-1">
          <div className="px-3 mt-6 mb-3 text-[10px] font-bold tracking-[0.15em] text-gray-400/80 uppercase">Ajustes y Más</div>
          <SidebarGroup icon={<Wrench size={18} />} label="Herramientas" items={toolsItems} onNavClick={onClose} />
          <SidebarGroup icon={<Settings size={18} />} label="Administración" items={adminItems} onNavClick={onClose} />
        </div>
      </nav>

      {/* User info + logout */}
      <div className="p-4 border-t border-gray-100 bg-gray-50/30">
        <div className="bg-white border border-gray-100 rounded-2xl p-3 shadow-sm hover:shadow-md hover:border-gray-200 transition-all">
          {user?.administrator && (
            <div className="flex items-center gap-1.5 px-1 mb-2">
              <Shield size={12} className="text-blue-500" />
              <span className="text-[10px] uppercase tracking-wider text-blue-600 font-bold">Administrador</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 font-bold text-sm flex-shrink-0 border border-blue-100">
                {user?.name?.charAt(0)?.toUpperCase() || 'U'}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-800 truncate">{user?.name}</p>
                <p className="text-xs text-gray-400 truncate">{user?.email}</p>
              </div>
            </div>
            <button onClick={logout} title="Cerrar sesión" className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors flex-shrink-0">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
