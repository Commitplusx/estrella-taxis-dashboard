import React, { useEffect, useState } from 'react';
import { api, type TraccarDevice } from '../lib/traccarApi';
import { useAuth, type EmpresaData } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { 
  CarFront, RadioTower, WifiOff, MapPin, 
  UtensilsCrossed, ShoppingBag, Bot, Clock, Users, Plus, ArrowRight, MessageSquare, ExternalLink, ClipboardList 
} from 'lucide-react';
import { useTraccarSocket } from '../hooks/useTraccarSocket';
import { Link, useNavigate } from 'react-router-dom';

function formatRelativeTime(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMins = Math.round((now.getTime() - d.getTime()) / 60000);
  
  if (diffMins < 1) return 'Justo ahora';
  if (diffMins < 60) return `Hace ${diffMins} min`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `Hace ${diffHours} h`;
  return `Hace ${Math.floor(diffHours / 24)} días`;
}

// ─── VISTA 1: DASHBOARD PARA TAXIS / FLOTILLA (TRACCAR) ─────────────────────
function TaxiDashboardView({ user }: { user: any }) {
  const [devices, setDevices] = useState<TraccarDevice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getDevices()
      .then(setDevices)
      .finally(() => setLoading(false));
  }, []);

  useTraccarSocket({
    onDevices: (updated) => {
      setDevices(prev => {
        const map = new Map(prev.map(d => [d.id, d]));
        updated.forEach(d => map.set(d.id, d));
        return Array.from(map.values());
      });
    },
  });

  const online = devices.filter(d => d.status === 'online').length;
  const offline = devices.filter(d => d.status !== 'online').length;
  const coverage = devices.length ? Math.round((online / devices.length) * 100) : 0;

  return (
    <div className="h-full overflow-y-auto p-6 md:p-8 space-y-8 pb-32 md:pb-10 font-sans max-w-[1400px] mx-auto">
      {/* Header Enterprise */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-gray-200 pb-5">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">
            Resumen de Flotilla
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Monitoreo en tiempo real de unidades Traccar.
          </p>
        </div>
        <div className="text-sm text-gray-500 font-medium bg-gray-50 px-3 py-1.5 rounded-md border border-gray-200 inline-flex items-center w-max">
          <Clock size={14} className="mr-2" />
          {new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
      </div>

      {/* Metrics Grid Enterprise */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-500">Total Unidades</h3>
            <CarFront size={16} className="text-gray-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold text-gray-900 leading-none">{loading ? '-' : devices.length}</span>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-500">Unidades Online</h3>
            <RadioTower size={16} className="text-green-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold text-gray-900 leading-none">{loading ? '-' : online}</span>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-500">Unidades Offline</h3>
            <WifiOff size={16} className="text-gray-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold text-gray-900 leading-none">{loading ? '-' : offline}</span>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-500">Cobertura Activa</h3>
            <MapPin size={16} className="text-blue-500" />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-3xl font-semibold text-gray-900 leading-none">{loading ? '-' : `${coverage}%`}</span>
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-600 rounded-full" style={{ width: `${coverage}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Taxis recientes Enterprise Table */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-4">Estado de Unidades</h2>
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
                <th className="px-6 py-3">Unidad</th>
                <th className="px-6 py-3">ID Único</th>
                <th className="px-6 py-3">Estado</th>
                <th className="px-6 py-3 text-right">Última Señal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-500">Cargando unidades...</td>
                </tr>
              ) : devices.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-500">No hay unidades registradas.</td>
                </tr>
              ) : (
                devices.slice(0, 10).map(device => {
                  const isOnline = device.status === 'online';
                  return (
                    <tr key={device.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-3 text-sm font-medium text-gray-900">{device.name}</td>
                      <td className="px-6 py-3 text-sm text-gray-500 font-mono">{device.uniqueId}</td>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
                          <span className="text-sm text-gray-700">{isOnline ? 'Online' : 'Offline'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-500 text-right">
                        {device.lastUpdate ? formatRelativeTime(device.lastUpdate) : '-'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          {devices.length > 10 && (
            <div className="bg-gray-50 px-6 py-3 border-t border-gray-200 text-center">
              <span className="text-xs text-gray-500">Mostrando 10 unidades recientes.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── VISTA 2: DASHBOARD PARA COMERCIOS (RESTAURANTE, FARMACIA, ETC.) ─────────
function BusinessDashboardView({ user, empresaData }: { user: any; empresaData: EmpresaData }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [empresaDetails, setEmpresaDetails] = useState<any>(null);
  const [userCount, setUserCount] = useState<number>(1);
  const [pendingOrdersCount, setPendingOrdersCount] = useState<number>(0);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const isRestaurante = empresaData.tipo_negocio === 'restaurante';

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [catRes, empRes, usersRes] = await Promise.all([
          supabase.from('catalogos').select('*').eq('tenant_id', empresaData.id).order('created_at', { ascending: false }),
          supabase.from('empresas').select('*').eq('id', empresaData.id).single(),
          supabase.from('perfiles').select('traccar_user_id', { count: 'exact' }).eq('empresa_id', empresaData.id)
        ]);

        if (catRes.data) setItems(catRes.data);
        if (empRes.data) setEmpresaDetails(empRes.data);
        if (usersRes.count) setUserCount(usersRes.count);

        try {
          const { data: ordersData, error: ordersErr } = await supabase
            .from('pedidos')
            .select('*')
            .eq('tenant_id', empresaData.id)
            .not('estado', 'in', '("entregado","cancelado")')
            .order('created_at', { ascending: false })
            .limit(10);
            
          if (!ordersErr && ordersData) {
            setRecentOrders(ordersData);
            setPendingOrdersCount(ordersData.length);
          }
        } catch {
          // Ignorado
        }
      } catch (err) {
        console.error('Error loading business dashboard data:', err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [empresaData.id]);

  useEffect(() => {
    const channel = supabase
      .channel(`dashboard-pedidos-${empresaData.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'pedidos',
          filter: `tenant_id=eq.${empresaData.id}`
        },
        (payload) => {
          const nuevoPedido = payload.new as any;
          setRecentOrders(prev => [nuevoPedido, ...prev].slice(0, 10));
          setPendingOrdersCount(prev => prev + 1);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'pedidos',
          filter: `tenant_id=eq.${empresaData.id}`
        },
        (payload) => {
          const updated = payload.new as any;
          setRecentOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
          if (updated.estado === 'entregado' || updated.estado === 'cancelado') {
            setPendingOrdersCount(prev => Math.max(0, prev - 1));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [empresaData.id]);

  const waPhone = empresaDetails?.telefono_whatsapp?.replace(/\D/g, '');

  return (
    <div className="h-full overflow-y-auto p-6 md:p-8 space-y-8 pb-32 md:pb-10 font-sans max-w-[1400px] mx-auto">
      {/* Header Enterprise */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 border-b border-gray-200 pb-5">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">
              Visión General
            </h1>
            <span className="px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider rounded border border-gray-200 bg-gray-50 text-gray-500">
              {empresaData.tipo_negocio}
            </span>
          </div>
          <p className="text-gray-500 text-sm">
            Estadísticas y gestión para <span className="font-medium text-gray-900">{empresaData.nombre_empresa}</span>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex text-sm text-gray-500 font-medium bg-gray-50 px-3 py-1.5 rounded-md border border-gray-200 items-center h-9">
            <Clock size={14} className="mr-2" />
            {new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' })}
          </div>
          <button
            onClick={() => navigate('/orders')}
            className="flex items-center justify-center gap-2 px-4 py-1.5 h-9 bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 rounded-md text-sm font-medium transition-colors shadow-sm"
          >
            Tablero de Pedidos
          </button>
          <button
            onClick={() => navigate('/catalog')}
            className="flex items-center justify-center gap-2 px-4 py-1.5 h-9 bg-black hover:bg-gray-800 text-white border border-black rounded-md text-sm font-medium transition-colors shadow-sm"
          >
            <Plus size={16} /> Agregar {isRestaurante ? 'Platillo' : 'Producto'}
          </button>
        </div>
      </div>

      {/* Metrics Grid Enterprise */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        
        {/* Card 1: Pedidos Activos */}
        <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-500">Pedidos Activos</h3>
            <ClipboardList size={16} className="text-gray-400" />
          </div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-3xl font-semibold text-gray-900 leading-none">{loading ? '-' : pendingOrdersCount}</span>
            {pendingOrdersCount > 0 && <span className="text-sm text-gray-500">en proceso</span>}
          </div>
          <Link to="/orders" className="text-xs font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1 w-max">
            Ver detalles <ArrowRight size={12} />
          </Link>
        </div>

        {/* Card 2: Menú / Catálogo */}
        <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-500">Total en {isRestaurante ? 'Menú' : 'Catálogo'}</h3>
            {isRestaurante ? <UtensilsCrossed size={16} className="text-gray-400"/> : <ShoppingBag size={16} className="text-gray-400"/>}
          </div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-3xl font-semibold text-gray-900 leading-none">{loading ? '-' : items.length}</span>
            <span className="text-sm text-gray-500">registros</span>
          </div>
          <Link to="/catalog" className="text-xs font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1 w-max">
            Gestionar <ArrowRight size={12} />
          </Link>
        </div>

        {/* Card 3: Bot de Atención IA */}
        <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-500">Asistente IA</h3>
            <Bot size={16} className="text-gray-400" />
          </div>
          <div className="mb-2">
            <span className="text-lg font-medium text-gray-900 leading-tight block truncate">
              {empresaDetails?.nombre_bot || 'No configurado'}
            </span>
            <span className="text-sm text-gray-500 truncate block">
              {empresaDetails?.telefono_whatsapp || 'Sin WhatsApp'}
            </span>
          </div>
          <Link to="/bot" className="text-xs font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1 w-max mt-1">
            Configuración <ArrowRight size={12} />
          </Link>
        </div>

        {/* Card 4: Usuarios */}
        <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-500">Equipo</h3>
            <Users size={16} className="text-gray-400" />
          </div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-3xl font-semibold text-gray-900 leading-none">{loading ? '-' : userCount}</span>
            <span className="text-sm text-gray-500">usuarios</span>
          </div>
          <Link to="/users" className="text-xs font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1 w-max">
            Administrar accesos <ArrowRight size={12} />
          </Link>
        </div>

      </div>

      <div>
        {/* Tabla de Pedidos Enterprise */}
        <div className="w-full">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Pedidos en curso</h2>
            <Link to="/orders" className="text-sm font-medium text-gray-500 hover:text-gray-900">Ver historial</Link>
          </div>
          
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
            <table className="w-full text-left border-collapse block sm:table">
              <thead className="hidden sm:table-header-group">
                <tr className="bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="px-5 py-3">Cliente</th>
                  <th className="px-5 py-3">Detalle</th>
                  <th className="px-5 py-3">Estado</th>
                  <th className="px-5 py-3 text-right">Tiempo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 block sm:table-row-group">
                {loading ? (
                  <tr className="block sm:table-row">
                    <td colSpan={4} className="px-5 py-8 text-center text-sm text-gray-500 block sm:table-cell">Cargando datos...</td>
                  </tr>
                ) : recentOrders.length === 0 ? (
                  <tr className="block sm:table-row">
                    <td colSpan={4} className="px-5 py-8 text-center text-sm text-gray-500 block sm:table-cell">No hay pedidos activos.</td>
                  </tr>
                ) : (
                  recentOrders.map(pedido => (
                    <tr key={pedido.id} className="hover:bg-gray-50 transition-colors block sm:table-row p-4 sm:p-0">
                      <td className="px-0 sm:px-5 py-2 sm:py-3 block sm:table-cell">
                        <div className="flex items-center justify-between sm:block">
                          <span className="text-xs font-semibold text-gray-500 sm:hidden uppercase">Cliente: </span>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold tracking-wide bg-blue-50 text-blue-700 border border-blue-200 uppercase">
                            {pedido.cliente_nombre || 'Desconocido'}
                          </span>
                        </div>
                      </td>
                      <td className="px-0 sm:px-5 py-2 sm:py-3 text-sm text-gray-500 truncate sm:max-w-[200px] block sm:table-cell">
                        <div className="flex flex-col sm:block">
                          <span className="text-xs font-semibold text-gray-500 sm:hidden uppercase mb-1">Detalle: </span>
                          <span className="whitespace-normal sm:whitespace-nowrap">{pedido.detalle_pedido}</span>
                        </div>
                      </td>
                      <td className="px-0 sm:px-5 py-2 sm:py-3 block sm:table-cell">
                        <div className="flex items-center justify-between sm:block">
                          <span className="text-xs font-semibold text-gray-500 sm:hidden uppercase">Estado: </span>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold tracking-wide border uppercase ${
                            pedido.estado === 'pendiente' ? 'bg-red-50 text-red-700 border-red-200' :
                            pedido.estado === 'preparando' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            'bg-emerald-50 text-emerald-700 border-emerald-200'
                          }`}>
                            {pedido.estado.replace('_', ' ')}
                          </span>
                        </div>
                      </td>
                      <td className="px-0 sm:px-5 py-2 sm:py-3 text-sm text-gray-500 sm:text-right font-mono block sm:table-cell border-t sm:border-0 mt-2 sm:mt-0 pt-2 sm:pt-3">
                        <div className="flex items-center justify-between sm:block">
                          <span className="text-xs font-semibold text-gray-500 sm:hidden uppercase">Tiempo: </span>
                          <span>{formatRelativeTime(pedido.created_at)}</span>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>



      </div>
    </div>
  );
}

// ─── EXPORT PRINCIPAL: DISPATCHER SEGÚN GIRO ─────────────────────────────────
export default function Dashboard() {
  const { user, userRole, empresaData } = useAuth();

  const isSuperadmin = userRole === 'superadmin';
  const isTaxi = isSuperadmin || !empresaData || empresaData.tipo_negocio === 'taxi';

  if (!isTaxi && empresaData) {
    return <BusinessDashboardView user={user} empresaData={empresaData} />;
  }

  return <TaxiDashboardView user={user} />;
}
