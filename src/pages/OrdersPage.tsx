import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { 
  Clock, Phone, MapPin,
  MessageSquare, RefreshCw, ChefHat, Bike, Check, X,
  Volume2, Package, AlertTriangle
} from 'lucide-react';
import toast from 'react-hot-toast';
import { playNewOrderSound } from '../lib/soundNotification';

export interface Pedido {
  id: string;
  tenant_id: string;
  cliente_tel: string;
  cliente_nombre: string | null;
  detalle_pedido: string;
  direccion_entrega: string;
  costo_envio: number | null;
  estado: 'pendiente' | 'preparando' | 'en_camino' | 'entregado' | 'cancelado';
  created_at: string;
  updated_at: string;
}

function formatRelativeTime(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMins = Math.round((now.getTime() - d.getTime()) / 60000);
  if (diffMins < 1) return 'Ahora';
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  return `${Math.floor(diffHours / 24)}d`;
}

function getMinutesAgo(dateStr: string) {
  return Math.round((Date.now() - new Date(dateStr).getTime()) / 60000);
}

function isPickup(dir: string) {
  return dir.toLowerCase().includes('recoger');
}

export default function OrdersPage() {
  const { empresaId, empresaData } = useAuth();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'pendiente' | 'preparando' | 'en_camino' | 'entregado'>('pendiente');

  // Tick cada minuto para refrescar tiempos relativos
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  const fetchPedidos = async () => {
    if (!empresaId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('pedidos')
        .select('*')
        .eq('tenant_id', empresaId)
        .order('created_at', { ascending: false });
      if (error) { toast.error('Error al cargar pedidos: ' + error.message); return; }
      setPedidos(data || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPedidos();
    if (!empresaId) return;
    const channel = supabase
      .channel(`pedidos-page-${empresaId}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos', filter: `tenant_id=eq.${empresaId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setPedidos(prev => prev.some(p => p.id === payload.new.id) ? prev : [payload.new as Pedido, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setPedidos(prev => prev.map(p => p.id === payload.new.id ? (payload.new as Pedido) : p));
          } else if (payload.eventType === 'DELETE') {
            setPedidos(prev => prev.filter(p => p.id !== payload.old.id));
          }
        }
      ).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [empresaId]);

  const updateEstado = async (id: string, nuevoEstado: Pedido['estado']) => {
    try {
      const { error } = await supabase
        .from('pedidos')
        .update({ estado: nuevoEstado, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      setPedidos(prev => prev.map(p => p.id === id ? { ...p, estado: nuevoEstado } : p));
      toast.success(`âœ“ ${nuevoEstado.replace('_', ' ')}`);
      supabase.functions.invoke('ycloud-webhook', {
        body: { action: 'notify_order_status', pedido_id: id, nuevo_estado: nuevoEstado }
      }).catch(() => {});
    } catch (err: any) {
      toast.error('Error: ' + err.message);
    }
  };

  const tabs = [
    { id: 'pendiente',  label: 'Nuevos',      icon: '🔔', activeClass: 'text-orange-600 border-orange-500', badgeClass: 'bg-orange-100 text-orange-600' },
    { id: 'preparando', label: 'En Cocina',   icon: '🍳', activeClass: 'text-blue-600 border-blue-500',     badgeClass: 'bg-blue-100 text-blue-600'     },
    { id: 'en_camino',  label: 'En Reparto',  icon: '🛵', activeClass: 'text-violet-600 border-violet-500', badgeClass: 'bg-violet-100 text-violet-600' },
    { id: 'entregado',  label: 'Completados', icon: '✅', activeClass: 'text-emerald-600 border-emerald-500',badgeClass: 'bg-emerald-100 text-emerald-600'},
  ] as const;

  // â”€â”€ Card compacta â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const OrderCard = ({ pedido }: { pedido: Pedido }) => {
    const cleanTel = (pedido.cliente_tel || '').replace(/\D/g, '');
    const minsAgo  = getMinutesAgo(pedido.created_at);
    const urgent   = pedido.estado === 'pendiente' && minsAgo >= 15;
    const pickup   = isPickup(pedido.direccion_entrega);

    const stripeColor =
      pedido.estado === 'pendiente'  ? 'bg-orange-400' :
      pedido.estado === 'preparando' ? 'bg-blue-500'   :
      pedido.estado === 'en_camino'  ? 'bg-violet-500' :
      'bg-emerald-500';

    const timeColor =
      minsAgo < 10 ? 'text-emerald-700 bg-emerald-50' :
      minsAgo < 20 ? 'text-amber-700 bg-amber-50'     :
                     'text-red-700 bg-red-50';

    return (
      <div className={`relative bg-white rounded-xl border overflow-hidden flex flex-col transition-all duration-200 hover:shadow-md hover:-translate-y-px ${
        urgent ? 'border-red-300 ring-1 ring-red-200 shadow-sm' : 'border-gray-200 shadow-sm'
      }`}>
        {/* Franja de color por estado */}
        <div className={`h-[3px] w-full ${stripeColor}`} />

        <div className="p-3 flex flex-col gap-2">

          {/* Fila 1: ID + tiempo + alerta */}
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] font-bold text-gray-400 tracking-widest">
              #{pedido.id.slice(0, 6).toUpperCase()}
            </span>
            <div className="flex items-center gap-1 ml-auto">
              {urgent && (
                <span className="flex items-center gap-0.5 text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full animate-pulse">
                  <AlertTriangle size={9} /> {minsAgo}m
                </span>
              )}
              <span className={`flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${timeColor}`}>
                <Clock size={9} />{formatRelativeTime(pedido.created_at)}
              </span>
            </div>
          </div>

          {/* Fila 2: Nombre + iconos de contacto */}
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-gray-900 truncate leading-tight">
                {pedido.cliente_nombre || 'Sin nombre'}
              </p>
              <p className="text-[11px] text-gray-400 font-mono">{pedido.cliente_tel}</p>
            </div>
            {cleanTel && (
              <div className="flex items-center gap-1 shrink-0">
                <a href={`https://wa.me/${cleanTel}`} target="_blank" rel="noopener noreferrer"
                   className="w-6 h-6 flex items-center justify-center rounded-md bg-gray-50 hover:bg-emerald-50 text-gray-400 hover:text-emerald-600 border border-gray-100 hover:border-emerald-200 transition-colors">
                  <MessageSquare size={12} />
                </a>
                <a href={`tel:${cleanTel}`}
                   className="w-6 h-6 flex items-center justify-center rounded-md bg-gray-50 hover:bg-blue-50 text-gray-400 hover:text-blue-600 border border-gray-100 hover:border-blue-200 transition-colors">
                  <Phone size={12} />
                </a>
              </div>
            )}
          </div>

          {/* Fila 3: Detalle del pedido */}
          <div className="bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-2">
            <p className="text-[12.5px] text-gray-800 font-medium whitespace-pre-line leading-snug">
              {pedido.detalle_pedido}
            </p>
          </div>

          {/* Fila 4: DirecciÃ³n + costo (misma lÃ­nea) */}
          <div className="flex items-start gap-1.5 text-[11px]">
            {pickup ? (
              <span className="flex items-center gap-1 font-bold text-violet-600 bg-violet-50 border border-violet-100 px-1.5 py-0.5 rounded-full">
                <Package size={9} /> Recoger
              </span>
            ) : (
              <>
                <MapPin size={10} className="text-gray-400 shrink-0 mt-0.5" />
                <span className="text-gray-500 leading-snug line-clamp-2 flex-1">{pedido.direccion_entrega}</span>
              </>
            )}
            <span className="shrink-0 font-bold text-gray-700 ml-auto">
              {pedido.costo_envio != null ? `$${pedido.costo_envio}` : 'S/C'}
            </span>
          </div>

          {/* Fila 5: Acciones */}
          <div className="flex items-center justify-between gap-1 pt-1.5 border-t border-gray-100">
            <div className="flex items-center gap-1.5">
              {pedido.estado === 'pendiente' && (
                <button onClick={() => updateEstado(pedido.id, 'preparando')}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold transition-colors shadow-sm">
                  <ChefHat size={11} /> Preparar
                </button>
              )}
              {pedido.estado === 'preparando' && (
                pickup ? (
                  <button onClick={() => updateEstado(pedido.id, 'entregado')}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold transition-colors shadow-sm">
                    <Check size={11} /> Entregado
                  </button>
                ) : (
                  <button onClick={() => updateEstado(pedido.id, 'en_camino')}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-[11px] font-bold transition-colors shadow-sm">
                    <Bike size={11} /> Despachar
                  </button>
                )
              )}
              {pedido.estado === 'en_camino' && (
                <button onClick={() => updateEstado(pedido.id, 'entregado')}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold transition-colors shadow-sm">
                  <Check size={11} /> Entregado
                </button>
              )}
            </div>
            {pedido.estado !== 'entregado' && pedido.estado !== 'cancelado' && (
              <button
                onClick={() => confirm('Â¿Cancelar este pedido?') && updateEstado(pedido.id, 'cancelado')}
                title="Cancelar pedido"
                className="w-6 h-6 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 border border-transparent hover:border-red-100 transition-colors">
                <X size={12} />
              </button>
            )}
          </div>

        </div>
      </div>
    );
  };

  const countPendientes = pedidos.filter(p => p.estado === 'pendiente').length;
  const filteredPedidos = pedidos.filter(p => p.estado === activeTab);
  const activeTabMeta = tabs.find(t => t.id === activeTab)!;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-gray-50 font-sans">

      {/* Header compacto */}
      <div className="bg-white border-b border-gray-200 px-5 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-sm font-bold text-gray-900 leading-tight">Tablero de Cocina</h1>
            <p className="text-[11px] text-gray-400 leading-tight">{empresaData?.nombre_empresa}</p>
          </div>
          {countPendientes > 0 && (
            <span className="px-2 py-0.5 bg-orange-500 text-white text-[10px] font-bold rounded-full animate-pulse">
              {countPendientes} nuevo{countPendientes > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => { playNewOrderSound(); toast.success('Timbre OK'); }}
            title="Probar timbre"
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-500 border border-gray-200 transition-colors">
            <Volume2 size={14} />
          </button>
          <button onClick={fetchPedidos} title="Actualizar"
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-500 border border-gray-200 transition-colors">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 px-5 flex gap-0 shrink-0 overflow-x-auto hide-scrollbar">
        {tabs.map(tab => {
          const count = pedidos.filter(p => p.estado === tab.id).length;
          const isActive = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold border-b-2 whitespace-nowrap transition-all ${
                isActive ? `${tab.activeClass}` : 'text-gray-500 border-transparent hover:text-gray-700'
              }`}>
              <span>{tab.emoji}</span>
              <span>{tab.label}</span>
              {count > 0 && (
                <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full ${
                  isActive ? tab.badgeClass : 'bg-gray-100 text-gray-500'
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && pedidos.length === 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 h-44 animate-pulse" />
            ))}
          </div>
        ) : filteredPedidos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-56 text-center">
            <div className="text-4xl mb-2">{activeTabMeta.emoji}</div>
            <p className="text-sm font-medium text-gray-500">
              {activeTab === 'pendiente'  && 'Sin pedidos nuevos'}
              {activeTab === 'preparando' && 'La cocina estÃ¡ libre'}
              {activeTab === 'en_camino'  && 'Sin repartos activos'}
              {activeTab === 'entregado'  && 'Sin completados recientes'}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">Se actualizan en tiempo real</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
            {filteredPedidos.slice(0, 50).map(p => <OrderCard key={p.id} pedido={p} />)}
          </div>
        )}
      </div>

    </div>
  );
}
