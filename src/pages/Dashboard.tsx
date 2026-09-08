import React, { useEffect, useState } from 'react';
import { api, type TraccarDevice } from '../lib/traccarApi';
import { useAuth, type EmpresaData } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { 
  CarFront, RadioTower, WifiOff, MapPin, 
  UtensilsCrossed, ShoppingBag, Bot, Clock, Users, Plus, ArrowRight, MessageSquare, ExternalLink, Sparkles, CheckCircle2, ClipboardList 
} from 'lucide-react';
import { useTraccarSocket } from '../hooks/useTraccarSocket';
import { Link, useNavigate } from 'react-router-dom';

function formatRelativeTime(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMins = Math.round((now.getTime() - d.getTime()) / 60000);
  
  if (diffMins < 1) return 'Hace unos segundos';
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

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 fade-in space-y-6 pb-32 md:pb-10">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
          Hola, {user?.name?.split(' ')[0]} 👋
        </h1>
        <p className="text-gray-500 text-sm mt-1 capitalize">
          {new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="col-span-2 bg-gradient-to-br from-blue-600 to-blue-800 rounded-[24px] p-5 sm:p-6 text-white shadow-lg shadow-blue-600/30 flex items-center justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -mr-10 -mt-10"></div>
          <div className="absolute bottom-0 left-0 w-24 h-24 bg-blue-400/20 rounded-full blur-xl -ml-5 -mb-5"></div>
          <div className="relative z-10">
            <p className="text-blue-100 font-medium text-sm sm:text-base mb-1">Total de Flotilla</p>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl sm:text-5xl font-bold tracking-tight">{loading ? '...' : devices.length}</span>
              <span className="text-blue-200 text-sm">Taxis registrados</span>
            </div>
          </div>
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-white/10 border border-white/20 backdrop-blur-sm flex items-center justify-center shrink-0 relative z-10">
            <CarFront size={28} className="text-white" />
          </div>
        </div>

        <div className="bg-white rounded-[20px] p-4 sm:p-5 border border-gray-100 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between mb-2">
            <div className="w-10 h-10 rounded-xl bg-green-50 text-green-600 flex items-center justify-center">
              <RadioTower size={20} />
            </div>
            <span className="px-2 py-1 bg-green-50 text-green-600 text-[10px] font-bold uppercase rounded-lg">Online</span>
          </div>
          <div>
            <p className="text-2xl sm:text-3xl font-bold text-gray-900">{loading ? '...' : online}</p>
            <p className="text-xs text-gray-500 font-medium mt-0.5">Conectados</p>
          </div>
        </div>

        <div className="bg-white rounded-[20px] p-4 sm:p-5 border border-gray-100 shadow-sm flex flex-col justify-between">
          <div className="flex items-start justify-between mb-2">
            <div className="w-10 h-10 rounded-xl bg-gray-50 text-gray-500 flex items-center justify-center">
              <WifiOff size={20} />
            </div>
            <span className="px-2 py-1 bg-gray-100 text-gray-500 text-[10px] font-bold uppercase rounded-lg">Offline</span>
          </div>
          <div>
            <p className="text-2xl sm:text-3xl font-bold text-gray-900">{loading ? '...' : offline}</p>
            <p className="text-xs text-gray-500 font-medium mt-0.5">Desconectados</p>
          </div>
        </div>

        <div className="col-span-2 bg-white rounded-[20px] p-4 sm:p-5 border border-gray-100 shadow-sm flex flex-col justify-center">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-amber-50 text-amber-500 flex items-center justify-center">
                <MapPin size={16} />
              </div>
              <p className="text-sm font-semibold text-gray-700">Cobertura Activa</p>
            </div>
            <p className="text-lg font-bold text-amber-500">{loading || !devices.length ? '0' : Math.round((online / devices.length) * 100)}%</p>
          </div>
          <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div 
              className="h-full bg-amber-500 rounded-full transition-all duration-1000 ease-out" 
              style={{ width: `${loading || !devices.length ? 0 : Math.round((online / devices.length) * 100)}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Taxis recientes */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-50">
          <h2 className="text-base font-semibold text-gray-900 tracking-tight">Estado de tu Flotilla</h2>
        </div>
        <div className="divide-y divide-gray-50/80">
          {loading ? (
            <div className="animate-pulse flex flex-col">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-50">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full sm:rounded-2xl bg-gray-100"></div>
                    <div className="space-y-2">
                      <div className="h-4 w-32 bg-gray-200 rounded"></div>
                      <div className="h-3 w-20 bg-gray-100 rounded"></div>
                    </div>
                  </div>
                  <div className="h-8 w-8 bg-gray-100 rounded-full"></div>
                </div>
              ))}
            </div>
          ) : devices.slice(0, 8).map(device => {
            const isOnline = device.status === 'online';
            return (
              <div key={device.id} className="flex items-center justify-between px-4 sm:px-6 py-4 hover:bg-slate-50 transition-colors group cursor-pointer">
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="relative">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full sm:rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                      <CarFront size={20} className="sm:w-6 sm:h-6" />
                    </div>
                    <div className="absolute -bottom-1 -right-1 sm:-bottom-1 sm:-right-1">
                      <div className="relative flex items-center justify-center w-3.5 h-3.5">
                        {isOnline && <span className="absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-40 animate-ping"></span>}
                        <span className={`relative inline-flex rounded-full h-3 w-3 border-2 border-white ${isOnline ? 'bg-green-500' : 'bg-gray-400'}`}></span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm sm:text-base font-bold text-gray-900 group-hover:text-blue-600 transition-colors">{device.name}</p>
                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mt-0.5">
                      <span className="text-[9px] sm:text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded tracking-wide uppercase">
                        ID: {device.uniqueId}
                      </span>
                      <span className="text-[10px] sm:text-xs text-gray-400 font-medium">
                        &bull; {isOnline ? 'Señal Activa' : 'Desconectado'}
                      </span>
                      {device.lastUpdate && (
                        <span className="text-[10px] sm:text-xs text-gray-400 font-medium">
                          &bull; Última señal: {formatRelativeTime(device.lastUpdate)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="hidden sm:flex flex-col items-end">
                     <span className={`text-[10px] font-bold uppercase tracking-wider ${isOnline ? 'text-green-600' : 'text-gray-400'}`}>{isOnline ? 'Online' : 'Offline'}</span>
                  </div>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${isOnline ? 'bg-green-50 text-green-600 shadow-sm shadow-green-100' : 'bg-gray-50 text-gray-400'}`}>
                    {isOnline ? <RadioTower size={14} /> : <WifiOff size={14} />}
                  </div>
                </div>
              </div>
            );
          })}
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

        // Intentar obtener pedidos pendientes (no falla si la tabla no existe)
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

  const waPhone = empresaDetails?.telefono_whatsapp?.replace(/\D/g, '');

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 fade-in space-y-6 pb-32 md:pb-10">
      {/* Header y Saludo */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
              Hola, {user?.name?.split(' ')[0]} 👋
            </h1>
            <span className={`px-2.5 py-0.5 text-xs font-bold uppercase rounded-full tracking-wider border ${
              isRestaurante 
                ? 'bg-amber-50 text-amber-700 border-amber-200' 
                : 'bg-blue-50 text-blue-700 border-blue-200'
            }`}>
              {empresaData.tipo_negocio}
            </span>
          </div>
          <p className="text-gray-500 text-sm mt-1">
            Panel de control de <span className="font-semibold text-gray-800">{empresaData.nombre_empresa}</span> &bull; {new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto">
          <button
            onClick={() => navigate('/orders')}
            className="flex items-center gap-2 px-3.5 py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-xl text-sm font-semibold transition shadow-sm"
          >
            <ClipboardList size={16} className="text-amber-600" />
            <span>Pedidos en vivo</span>
            {pendingOrdersCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0.5 bg-amber-600 text-white rounded-full text-[11px] font-bold">
                {pendingOrdersCount}
              </span>
            )}
          </button>
          <button
            onClick={() => navigate('/catalog')}
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 hover:bg-black text-white rounded-xl text-sm font-semibold transition shadow-sm"
          >
            <Plus size={16} /> {isRestaurante ? 'Agregar Platillo' : 'Agregar Producto'}
          </button>
        </div>
      </div>

      {/* Tarjetas de Métricas Principales */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Card 1: Pedidos Activos */}
        <div className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl p-5 text-white shadow-lg shadow-amber-500/20 relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-white/90">
              Pedidos Activos
            </span>
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-sm">
              <ClipboardList size={20} className="text-white" />
            </div>
          </div>
          <div className="my-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl sm:text-4xl font-extrabold tracking-tight">{loading ? '...' : pendingOrdersCount}</span>
              {pendingOrdersCount > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-white text-orange-600 animate-pulse">
                  En cocina / camino
                </span>
              )}
            </div>
            <p className="text-xs text-white/90 mt-0.5">
              {pendingOrdersCount === 0 ? 'Sin pedidos pendientes por ahora' : 'Órdenes en preparación y entrega'}
            </p>
          </div>
          <Link to="/orders" className="inline-flex items-center gap-1.5 text-xs font-semibold text-white hover:underline mt-1">
            Ver Tablero en Tiempo Real <ArrowRight size={13} />
          </Link>
        </div>

        {/* Card 2: Menú / Catálogo */}
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
              {isRestaurante ? 'Menú Activo' : 'Catálogo'}
            </span>
            <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
              {isRestaurante ? <UtensilsCrossed size={20} /> : <ShoppingBag size={20} />}
            </div>
          </div>
          <div className="my-3">
            <p className="text-3xl font-extrabold tracking-tight text-gray-900">{loading ? '...' : items.length}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {isRestaurante ? 'Platillos registrados' : 'Productos disponibles'}
            </p>
          </div>
          <Link to="/catalog" className="inline-flex items-center gap-1.5 text-xs font-semibold text-orange-600 hover:text-orange-700 mt-1">
            Gestionar {isRestaurante ? 'Menú' : 'Catálogo'} <ArrowRight size={13} />
          </Link>
        </div>

        {/* Card 2: Bot de Atención IA */}
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Asistente IA</span>
            <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
              <Bot size={20} />
            </div>
          </div>
          <div className="my-3">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <p className="text-base font-bold text-gray-900 truncate">
                {empresaDetails?.nombre_bot || 'Bot IA'}
              </p>
            </div>
            <p className="text-xs text-gray-500 mt-1 truncate">
              {empresaDetails?.telefono_whatsapp ? `WA: ${empresaDetails.telefono_whatsapp}` : 'Canal WhatsApp listo'}
            </p>
          </div>
          <Link to="/bot" className="inline-flex items-center gap-1.5 text-xs font-semibold text-purple-600 hover:text-purple-700">
            Ajustar Bot <ArrowRight size={13} />
          </Link>
        </div>

        {/* Card 3: Horario y Políticas */}
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Atención</span>
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Clock size={20} />
            </div>
          </div>
          <div className="my-3">
            <p className="text-xs text-gray-700 font-medium line-clamp-2">
              {empresaDetails?.prompt_personalizado || 'Sin horario configurado aún'}
            </p>
            <p className="text-[11px] text-gray-400 mt-1">
              {empresaDetails?.ciudad || 'Ubicación local'}
            </p>
          </div>
          <Link to="/bot" className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700">
            Editar Horario <ArrowRight size={13} />
          </Link>
        </div>

        {/* Card 4: Usuarios y Accesos */}
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Equipo</span>
            <div className="w-10 h-10 rounded-xl bg-gray-50 text-gray-700 flex items-center justify-center">
              <Users size={20} />
            </div>
          </div>
          <div className="my-3">
            <p className="text-3xl font-extrabold text-gray-900">{loading ? '...' : userCount}</p>
            <p className="text-xs text-gray-500 mt-0.5">Usuarios autorizados</p>
          </div>
          <Link to="/users" className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 hover:text-gray-900">
            Ver Usuarios <ArrowRight size={13} />
          </Link>
        </div>

      </div>

      {/* Banner Destacado: Probar Asistente de Voz / WhatsApp */}
      {waPhone && (
        <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 border border-emerald-100 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shadow-md shadow-emerald-500/20 shrink-0">
              <MessageSquare size={24} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900">Prueba el Asistente en WhatsApp</h3>
              <p className="text-xs text-gray-600 mt-0.5">
                Envía un mensaje para verificar cómo la IA recomienda los platillos de tu menú en tiempo real.
              </p>
            </div>
          </div>
          <a
            href={`https://wa.me/${waPhone}?text=Hola,%20me%20gustaria%20saber%20su%20menu`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition shrink-0"
          >
            Abrir WhatsApp <ExternalLink size={14} />
          </a>
        </div>
      )}

      {/* Mini-Feed de Pedidos Recientes */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList size={16} className="text-amber-600" />
            <h2 className="text-base font-bold text-gray-900 tracking-tight">Últimos Pedidos Activos</h2>
          </div>
          <Link to="/orders" className="text-xs font-semibold text-amber-600 hover:underline">
            Ir al Tablero Kanban &rarr;
          </Link>
        </div>

        {loading ? (
          <div className="p-6 text-center text-gray-400 text-sm animate-pulse">Cargando pedidos...</div>
        ) : recentOrders.length === 0 ? (
          <div className="p-10 text-center flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-gray-50 text-gray-400 flex items-center justify-center mb-3">
              <CheckCircle2 size={24} />
            </div>
            <h3 className="text-sm font-bold text-gray-900">No hay pedidos pendientes</h3>
            <p className="text-xs text-gray-500 max-w-sm mt-1">
              Todos los pedidos han sido procesados. La cocina está despejada y esperando nuevas órdenes...
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {recentOrders.map(pedido => (
              <div key={pedido.id} className="px-6 py-4 flex items-center justify-between hover:bg-amber-50/30 transition group">
                <div className="min-w-0 flex-1 pr-4">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-bold text-gray-900 truncate">{pedido.cliente_nombre || 'Cliente WhatsApp'}</p>
                    <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-md border ${
                      pedido.estado === 'pendiente' ? 'bg-red-50 text-red-700 border-red-200' :
                      pedido.estado === 'preparando' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                      'bg-blue-50 text-blue-700 border-blue-200'
                    }`}>
                      {pedido.estado.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 truncate">{pedido.detalle_pedido}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-sm font-black text-emerald-600">
                    {pedido.costo_envio != null ? `$${pedido.costo_envio}` : 'Por cobrar'}
                  </span>
                  <span className="text-[10px] font-semibold text-gray-400 flex items-center gap-1">
                    <Clock size={10}/> {formatRelativeTime(pedido.created_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
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

