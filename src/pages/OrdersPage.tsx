import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { 
  ShoppingBag, Clock, Phone, MapPin, CheckCircle, AlertCircle, 
  MessageSquare, RefreshCw, ChefHat, Bike, Check, X, Filter, Copy, CheckCheck,
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
  
  if (diffMins < 1) return 'Hace un momento';
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
  const [copiedSql, setCopiedSql] = useState(false);
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
    
    // Usamos un nombre de canal único para evitar colisiones cuando el componente se monta/desmonta rápido
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
            toast.success('🔔 ¡Nuevo pedido recibido en WhatsApp!', { duration: 5000 });
            setPedidos(prev => [payload.new as Pedido, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setPedidos(prev => prev.map(p => p.id === payload.new.id ? (payload.new as Pedido) : p));
          } else if (payload.eventType === 'DELETE') {
            setPedidos(prev => prev.filter(p => p.id === payload.old.id));
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
      toast.success(`Pedido movido a "${nuevoEstado.replace('_', ' ')}"`);

      supabase.functions.invoke('ycloud-webhook', {
        body: {
          action: 'notify_order_status',
          pedido_id: id,
          nuevo_estado: nuevoEstado
        }
      }).then(res => {
        if (res.data?.notified) {
          toast.success('📲 Cliente notificado por WhatsApp', { duration: 4000 });
        }
      }).catch(err => console.error('[NOTIFY WHATSAPP ERROR]', err));

    } catch (err: any) {
      toast.error('Error al actualizar estado: ' + err.message);
    }
  };

  const countPendientes = pedidos.filter(p => p.estado === 'pendiente').length;
  
  useEffect(() => {
    if (countPendientes === 0) return;
    playNewOrderSound();
    const intervalId = setInterval(() => playNewOrderSound(), 5000);
    return () => clearInterval(intervalId);
  }, [countPendientes > 0]);

  const copySql = () => {
    navigator.clipboard.writeText('-- Correr en Supabase SQL Editor...');
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 3000);
  };

  const OrderCard = ({ pedido }: { pedido: Pedido }) => {
    const cleanTel = pedido.cliente_tel ? pedido.cliente_tel.replace(/\D/g, '') : '';
    
    return (
      <div className="bg-white rounded-[16px] border border-gray-200/60 shadow-sm p-4 flex flex-col hover:shadow-md transition cursor-grab active:cursor-grabbing group shrink-0">
        {/* Top Header */}
        <div className="flex items-center justify-between pb-2 border-b border-gray-50">
          <span className="text-[11px] font-black text-gray-900 tracking-wider">
            #{pedido.id.slice(0, 6).toUpperCase()}
          </span>
          <span className="text-[10px] font-bold text-gray-400 flex items-center gap-1 bg-gray-50 px-2 py-0.5 rounded-full">
            <Clock size={10} /> {formatRelativeTime(pedido.created_at)}
          </span>
        </div>

        {/* Cliente */}
        <div className="mt-3 flex justify-between items-start">
          <div>
            <h4 className="text-sm font-bold text-gray-900 leading-tight">
              {pedido.cliente_nombre || 'Cliente WhatsApp'}
            </h4>
            <p className="text-xs text-gray-500 font-medium mt-0.5">{pedido.cliente_tel}</p>
          </div>
          <div className="flex gap-1">
            {cleanTel && (
              <a href={`https://wa.me/${cleanTel}`} target="_blank" className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition">
                <MessageSquare size={14} />
              </a>
            )}
            {cleanTel && (
              <a href={`tel:${cleanTel}`} className="p-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition">
                <Phone size={14} />
              </a>
            )}
          </div>
        </div>

        {/* Detalle Comanda */}
        <div className="mt-3 bg-amber-50/50 rounded-xl p-3 border border-amber-100/50">
          <p className="text-sm text-gray-800 font-medium whitespace-pre-line leading-relaxed">
            {pedido.detalle_pedido}
          </p>
        </div>

        {/* Dirección */}
        <div className="mt-3 flex items-start gap-1.5 text-xs text-gray-600 font-medium">
          <MapPin size={14} className="text-gray-400 shrink-0 mt-0.5" />
          <span className="leading-snug line-clamp-2">{pedido.direccion_entrega}</span>
        </div>

        {/* Acciones */}
        <div className="mt-4 pt-3 border-t border-gray-100 flex justify-between items-center">
          <span className="text-sm font-black text-emerald-600">
            {pedido.costo_envio != null ? `$${pedido.costo_envio}` : 'Por cobrar'}
          </span>

          <div className="flex items-center gap-2">
            {pedido.estado === 'pendiente' && (
              <button onClick={() => updateEstado(pedido.id, 'preparando')} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5">
                <ChefHat size={14} /> Cocinar
              </button>
            )}
            {pedido.estado === 'preparando' && (
              pedido.direccion_entrega.toLowerCase().includes('recoger') ? (
                <button onClick={() => updateEstado(pedido.id, 'entregado')} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5">
                  <Check size={14} /> Entregado
                </button>
              ) : (
                <button onClick={() => updateEstado(pedido.id, 'en_camino')} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5">
                  <Bike size={14} /> Enviar
                </button>
              )
            )}
            {pedido.estado === 'en_camino' && (
              <button onClick={() => updateEstado(pedido.id, 'entregado')} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5">
                <Check size={14} /> Entregar
              </button>
            )}
            {pedido.estado !== 'entregado' && pedido.estado !== 'cancelado' && (
              <button onClick={() => confirm('¿Cancelar pedido?') && updateEstado(pedido.id, 'cancelado')} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition" title="Cancelar">
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white p-4 sm:p-6 pb-24 md:pb-6">
      
      {/* Header Fijo */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Tablero de Cocina</h1>
            {countPendientes > 0 && (
              <span className="px-2.5 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full animate-bounce shadow-sm shadow-red-200">
                {countPendientes} nuevo{countPendientes > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            Gestión de pedidos &bull; <span className="font-semibold text-gray-700">{empresaData?.nombre_empresa}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => { playNewOrderSound(); toast.success('🔊 Timbre de prueba'); }} className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition">
            <Volume2 size={14} /> Probar Timbre
          </button>
          <button onClick={fetchPedidos} className="flex items-center gap-2 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition shadow-md shadow-blue-200">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Actualizar
          </button>
        </div>
      </div>

      {tableMissing && (
        <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-xl mb-4 text-sm font-bold flex gap-2 shrink-0">
          <AlertCircle size={20} className="shrink-0" />
          La tabla 'pedidos' no existe en Supabase. Contacta a soporte para correr la migración SQL.
        </div>
      )}
      <div className="flex gap-2 overflow-x-auto pb-2 hide-scrollbar mb-4 shrink-0">
        <button
          onClick={() => setActiveTab('pendiente')}
          className={`px-5 py-2.5 rounded-full text-sm font-bold whitespace-nowrap transition-all shadow-sm flex items-center gap-2 ${
            activeTab === 'pendiente' 
              ? 'bg-gray-900 text-white' 
              : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          Nuevos 
          <span className={`px-2 py-0.5 rounded-full text-xs ${activeTab === 'pendiente' ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {countPendientes}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('preparando')}
          className={`px-5 py-2.5 rounded-full text-sm font-bold whitespace-nowrap transition-all shadow-sm flex items-center gap-2 ${
            activeTab === 'preparando' 
              ? 'bg-gray-900 text-white' 
              : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          En Cocina
          <span className={`px-2 py-0.5 rounded-full text-xs ${activeTab === 'preparando' ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {pedidos.filter(p => p.estado === 'preparando').length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('en_camino')}
          className={`px-5 py-2.5 rounded-full text-sm font-bold whitespace-nowrap transition-all shadow-sm flex items-center gap-2 ${
            activeTab === 'en_camino' 
              ? 'bg-gray-900 text-white' 
              : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          En Reparto
          <span className={`px-2 py-0.5 rounded-full text-xs ${activeTab === 'en_camino' ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {pedidos.filter(p => p.estado === 'en_camino').length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('entregado')}
          className={`px-5 py-2.5 rounded-full text-sm font-bold whitespace-nowrap transition-all shadow-sm flex items-center gap-2 ${
            activeTab === 'entregado' 
              ? 'bg-gray-900 text-white' 
              : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          Completados
          <span className={`px-2 py-0.5 rounded-full text-xs ${activeTab === 'entregado' ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {pedidos.filter(p => p.estado === 'entregado').length}
          </span>
        </button>
      </div>

      {/* Listado de Pedidos Activos */}
      <div className="flex-1 overflow-y-auto pr-2 pb-4">
        {pedidos.filter(p => p.estado === activeTab).length === 0 ? (
          <div className="bg-slate-50 border-2 border-dashed border-gray-200 rounded-[24px] p-12 flex flex-col items-center justify-center text-center mt-4">
            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4">
              <ShoppingBag className="text-gray-300" size={32} />
            </div>
            <h3 className="text-gray-900 font-bold text-lg">No hay pedidos aquí</h3>
            <p className="text-gray-500 text-sm mt-1">
              {activeTab === 'pendiente' && 'No han entrado pedidos nuevos por ahora.'}
              {activeTab === 'preparando' && 'La cocina no tiene órdenes pendientes.'}
              {activeTab === 'en_camino' && 'No hay repartidores en ruta ahora mismo.'}
              {activeTab === 'entregado' && 'Aún no se han completado pedidos.'}
            </p>
          </div>
        ) : (
          <div key={activeTab} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-fade-in">
            {pedidos
              .filter(p => p.estado === activeTab)
              .slice(0, 30) // Solo mostramos los últimos 30 pedidos para no sobrecargar el navegador
              .map(p => <OrderCard key={p.id} pedido={p} />)}
          </div>
        )}
      </div>

    </div>
  );
}
