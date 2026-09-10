import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { 
  ShoppingBag, Clock, Phone, MapPin, AlertCircle, 
  MessageSquare, RefreshCw, ChefHat, Bike, Check, X,
  Volume2
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
  
  if (diffMins < 1) return 'Justo ahora';
  if (diffMins < 60) return `Hace ${diffMins} min`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `Hace ${diffHours} h`;
  return `Hace ${Math.floor(diffHours / 24)} días`;
}

export default function OrdersPage() {
  const { empresaId, empresaData } = useAuth();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [activeTab, setActiveTab] = useState<'pendiente' | 'preparando' | 'en_camino' | 'entregado'>('pendiente');

  const fetchPedidos = async () => {
    if (!empresaId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('pedidos')
        .select('*')
        .eq('tenant_id', empresaId)
        .order('created_at', { ascending: false });

      if (error) {
        if (error.code === 'PGRST204' || error.message.includes('not find the table') || error.message.includes('relation "pedidos" does not exist')) {
          setTableMissing(true);
        } else {
          toast.error('Error al cargar pedidos: ' + error.message);
        }
        return;
      }

      setTableMissing(false);
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
    
    const channelName = `pedidos-page-${empresaId}-${Date.now()}`;
    
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pedidos',
          filter: `tenant_id=eq.${empresaId}`
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setPedidos(prev => [payload.new as Pedido, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setPedidos(prev => prev.map(p => p.id === payload.new.id ? (payload.new as Pedido) : p));
          } else if (payload.eventType === 'DELETE') {
            setPedidos(prev => prev.filter(p => p.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [empresaId]);

  const updateEstado = async (id: string, nuevoEstado: Pedido['estado']) => {
    try {
      const { error } = await supabase
        .from('pedidos')
        .update({ estado: nuevoEstado, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;

      setPedidos(prev => prev.map(p => p.id === id ? { ...p, estado: nuevoEstado } : p));
      toast.success(`Movido a "${nuevoEstado.replace('_', ' ')}"`);

      supabase.functions.invoke('ycloud-webhook', {
        body: {
          action: 'notify_order_status',
          pedido_id: id,
          nuevo_estado: nuevoEstado
        }
      }).catch(err => console.error('[NOTIFY WHATSAPP ERROR]', err));

    } catch (err: any) {
      toast.error('Error al actualizar estado: ' + err.message);
    }
  };

  const countPendientes = pedidos.filter(p => p.estado === 'pendiente').length;

  const OrderCard = ({ pedido }: { pedido: Pedido }) => {
    const cleanTel = pedido.cliente_tel ? pedido.cliente_tel.replace(/\D/g, '') : '';
    
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 flex flex-col hover:border-gray-300 transition-colors shrink-0">
        {/* Top Header */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-mono font-bold text-gray-900 bg-gray-100 px-2 py-1 rounded">
            #{pedido.id.slice(0, 6).toUpperCase()}
          </span>
          <span className="text-[11px] font-medium text-gray-500 flex items-center gap-1">
            <Clock size={12} /> {formatRelativeTime(pedido.created_at)}
          </span>
        </div>

        {/* Cliente */}
        <div className="mb-4">
          <div className="flex justify-between items-start">
            <div className="min-w-0 pr-2">
              <h4 className="text-sm font-semibold text-gray-900 truncate">
                {pedido.cliente_nombre || 'Cliente sin nombre'}
              </h4>
              <p className="text-xs text-gray-500 font-mono mt-0.5">{pedido.cliente_tel}</p>
            </div>
            <div className="flex gap-1 shrink-0">
              {cleanTel && (
                <a href={`https://wa.me/${cleanTel}`} target="_blank" rel="noopener noreferrer" className="p-1.5 text-gray-400 hover:text-emerald-600 transition-colors bg-gray-50 hover:bg-emerald-50 rounded-md">
                  <MessageSquare size={14} />
                </a>
              )}
              {cleanTel && (
                <a href={`tel:${cleanTel}`} className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors bg-gray-50 hover:bg-blue-50 rounded-md">
                  <Phone size={14} />
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Detalle Comanda */}
        <div className="mb-4 bg-gray-50 border border-gray-200 rounded-md p-3">
          <p className="text-sm text-gray-800 font-medium whitespace-pre-line leading-relaxed">
            {pedido.detalle_pedido}
          </p>
        </div>

        {/* Dirección */}
        <div className="flex items-start gap-1.5 text-xs text-gray-600 mb-4">
          <MapPin size={14} className="text-gray-400 shrink-0 mt-0.5" />
          <span className="leading-snug line-clamp-2">{pedido.direccion_entrega}</span>
        </div>

        {/* Acciones */}
        <div className="mt-auto pt-4 border-t border-gray-100 flex flex-wrap justify-between items-center gap-y-3 gap-x-2">
          <span className="text-sm font-semibold text-gray-900 shrink-0">
            {pedido.costo_envio != null ? `$${pedido.costo_envio}` : 'Por cobrar'}
          </span>

          <div className="flex flex-wrap items-center gap-2">
            {pedido.estado === 'pendiente' && (
              <button onClick={() => updateEstado(pedido.id, 'preparando')} className="px-3 py-1.5 bg-black hover:bg-gray-800 text-white rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-sm">
                <ChefHat size={14} /> Preparar
              </button>
            )}
            {pedido.estado === 'preparando' && (
              pedido.direccion_entrega.toLowerCase().includes('recoger') ? (
                <button onClick={() => updateEstado(pedido.id, 'entregado')} className="px-3 py-1.5 bg-black hover:bg-gray-800 text-white rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-sm">
                  <Check size={14} /> Entregado
                </button>
              ) : (
                <button onClick={() => updateEstado(pedido.id, 'en_camino')} className="px-3 py-1.5 bg-black hover:bg-gray-800 text-white rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-sm">
                  <Bike size={14} /> Despachar
                </button>
              )
            )}
            {pedido.estado === 'en_camino' && (
              <button onClick={() => updateEstado(pedido.id, 'entregado')} className="px-3 py-1.5 bg-black hover:bg-gray-800 text-white rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-sm">
                <Check size={14} /> Entregado
              </button>
            )}
            {pedido.estado !== 'entregado' && pedido.estado !== 'cancelado' && (
              <button onClick={() => confirm('¿Cancelar pedido?') && updateEstado(pedido.id, 'cancelado')} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors border border-transparent hover:border-red-200" title="Cancelar">
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const tabs = [
    { id: 'pendiente', label: 'Nuevos', count: countPendientes },
    { id: 'preparando', label: 'En Cocina', count: pedidos.filter(p => p.estado === 'preparando').length },
    { id: 'en_camino', label: 'En Reparto', count: pedidos.filter(p => p.estado === 'en_camino').length },
    { id: 'entregado', label: 'Completados', count: pedidos.filter(p => p.estado === 'entregado').length }
  ] as const;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white p-6 md:p-8 font-sans max-w-[1600px] mx-auto w-full">
      
      {/* Header Enterprise */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-gray-200 pb-5 shrink-0">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Tablero de Cocina</h1>
            {countPendientes > 0 && (
              <span className="px-2 py-0.5 bg-gray-900 text-white text-[11px] font-bold uppercase tracking-wider rounded">
                {countPendientes} Nuevos
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500">
            Gestión operativa de pedidos &bull; <strong className="font-medium text-gray-900">{empresaData?.nombre_empresa}</strong>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={() => { playNewOrderSound(); toast.success('Timbre de prueba reproducido'); }} className="flex items-center justify-center gap-2 px-4 py-1.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 rounded-md text-sm font-medium transition-colors shadow-sm h-9">
            <Volume2 size={16} className="text-gray-500" /> Timbre
          </button>
          <button onClick={fetchPedidos} className="flex items-center justify-center gap-2 px-4 py-1.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 rounded-md text-sm font-medium transition-colors shadow-sm h-9">
            <RefreshCw size={14} className={loading ? "animate-spin text-gray-500" : "text-gray-500"} /> Actualizar
          </button>
        </div>
      </div>

      {tableMissing && (
        <div className="mt-6 bg-red-50 border border-red-200 text-red-800 p-4 rounded-lg text-sm font-medium flex items-center gap-3 shrink-0">
          <AlertCircle size={18} className="shrink-0" />
          La tabla de pedidos no está configurada correctamente en la base de datos.
        </div>
      )}

      {/* Tabs Enterprise */}
      <div className="flex gap-2 overflow-x-auto py-6 hide-scrollbar shrink-0 border-b border-gray-100">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-2 border ${
              activeTab === tab.id 
                ? 'bg-gray-900 border-gray-900 text-white' 
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300'
            }`}
          >
            {tab.label}
            <span className={`px-2 py-0.5 rounded text-xs font-mono ${
              activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
            }`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Listado de Pedidos Activos */}
      <div className="flex-1 overflow-y-auto pt-6 pb-20">
        {pedidos.filter(p => p.estado === activeTab).length === 0 ? (
          <div className="border border-dashed border-gray-300 rounded-lg p-12 flex flex-col items-center justify-center text-center max-w-lg mx-auto mt-8">
            <div className="w-12 h-12 bg-gray-50 border border-gray-100 rounded-lg flex items-center justify-center mb-4">
              <ShoppingBag className="text-gray-400" size={24} />
            </div>
            <h3 className="text-gray-900 font-medium text-sm">Bandeja vacía</h3>
            <p className="text-gray-500 text-sm mt-1">
              {activeTab === 'pendiente' && 'No hay pedidos nuevos pendientes de revisar.'}
              {activeTab === 'preparando' && 'La cocina no tiene órdenes en curso.'}
              {activeTab === 'en_camino' && 'No hay pedidos en ruta de entrega en este momento.'}
              {activeTab === 'entregado' && 'No se han completado pedidos recientemente.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {pedidos
              .filter(p => p.estado === activeTab)
              .slice(0, 50) 
              .map(p => <OrderCard key={p.id} pedido={p} />)}
          </div>
        )}
      </div>

    </div>
  );
}
