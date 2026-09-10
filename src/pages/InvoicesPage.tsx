import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import {
  FileText, Phone, Clock, RefreshCw, CheckCircle2,
  XCircle, AlertCircle, MessageSquare, FileCheck, FileClock,
  FileX, Search, ChevronDown, Receipt, Filter, X
} from 'lucide-react';
import toast from 'react-hot-toast';

export interface Factura {
  id: string;
  tenant_id: string;
  cliente_tel: string;
  media_id: string;
  media_type: 'image' | 'document';
  media_url?: string;
  pdf_url?: string;
  datos_fiscales: string;
  estado: 'pendiente' | 'facturada' | 'cancelada';
  created_at: string;
  updated_at: string;
}

type EstadoFilter = 'todas' | 'pendiente' | 'facturada' | 'cancelada';

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
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

const ESTADO_CONFIG = {
  pendiente: {
    label: 'Pendiente',
    icon: <FileClock size={14} />,
    badge: 'bg-amber-50 text-amber-700 border border-amber-200',
    dot: 'bg-amber-400',
  },
  facturada: {
    label: 'Facturada',
    icon: <FileCheck size={14} />,
    badge: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    dot: 'bg-emerald-500',
  },
  cancelada: {
    label: 'Cancelada',
    icon: <FileX size={14} />,
    badge: 'bg-red-50 text-red-700 border border-red-200',
    dot: 'bg-red-400',
  },
} as const;

export default function InvoicesPage() {
  const { empresaId, empresaData } = useAuth();
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [filtroEstado, setFiltroEstado] = useState<EstadoFilter>('todas');
  const [searchTel, setSearchTel] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<{ url: string, type: 'image' | 'pdf' } | null>(null);

  const fetchFacturas = async () => {
    if (!empresaId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('facturas')
        .select('*')
        .eq('tenant_id', empresaId)
        .order('created_at', { ascending: false });

      if (error) {
        if (
          error.code === 'PGRST204' ||
          error.message.includes('not find the table') ||
          error.message.includes('relation "facturas" does not exist')
        ) {
          setTableMissing(true);
        } else {
          toast.error('Error al cargar facturas: ' + error.message);
        }
        return;
      }

      setTableMissing(false);
      setFacturas((data as Factura[]) || []);
    } catch (err) {
      console.error('[INVOICES]', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFacturas();

    if (!empresaId) return;

    const channel = supabase
      .channel(`facturas-${empresaId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'facturas', filter: `tenant_id=eq.${empresaId}` },
        (payload) => {
          console.log('[REALTIME PING] Evento recibido en facturas:', payload);
          if (payload.eventType === 'INSERT') {
            setFacturas(prev => {
              // Evitar duplicar si por alguna razón la BD lo manda doble o ya lo cargó el fetch inicial
              if (prev.some(f => f.id === payload.new.id)) return prev;
              return [payload.new as Factura, ...prev];
            });
          } else if (payload.eventType === 'UPDATE') {
            setFacturas(prev => prev.map(f => f.id === payload.new.id ? (payload.new as Factura) : f));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [empresaId]);

  const updateEstado = async (id: string, nuevoEstado: Factura['estado']) => {
    setUpdatingId(id);
    try {
      const { error } = await supabase
        .from('facturas')
        .update({ estado: nuevoEstado, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;

      setFacturas(prev => prev.map(f => f.id === id ? { ...f, estado: nuevoEstado } : f));
      toast.success(`Factura marcada como "${ESTADO_CONFIG[nuevoEstado].label}"`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      toast.error('Error al actualizar: ' + msg);
    } finally {
      setUpdatingId(null);
    }
  };

  const facturasFiltered = facturas.filter(f => {
    const matchEstado = filtroEstado === 'todas' || f.estado === filtroEstado;
    const matchTel = searchTel.trim() === '' || f.cliente_tel.includes(searchTel.trim());
    return matchEstado && matchTel;
  });

  const counts = {
    todas: facturas.length,
    pendiente: facturas.filter(f => f.estado === 'pendiente').length,
    facturada: facturas.filter(f => f.estado === 'facturada').length,
    cancelada: facturas.filter(f => f.estado === 'cancelada').length,
  };

  const tabs: { id: EstadoFilter; label: string }[] = [
    { id: 'todas', label: 'Todas' },
    { id: 'pendiente', label: 'Pendientes' },
    { id: 'facturada', label: 'Facturadas' },
    { id: 'cancelada', label: 'Canceladas' },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white p-6 md:p-8 font-sans max-w-[1400px] mx-auto w-full">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-gray-200 pb-5 shrink-0">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Solicitudes de Facturación</h1>
            {counts.pendiente > 0 && (
              <span className="px-2 py-0.5 bg-amber-500 text-white text-[11px] font-bold uppercase tracking-wider rounded">
                {counts.pendiente} pendientes
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500">
            Historial de tickets enviados por clientes vía WhatsApp &bull;{' '}
            <strong className="font-medium text-gray-900">{empresaData?.nombre_empresa}</strong>
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Buscador por teléfono */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por teléfono..."
              value={searchTel}
              onChange={e => setSearchTel(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-gray-400 w-48"
            />
          </div>
          <button
            onClick={fetchFacturas}
            className="flex items-center justify-center gap-2 px-4 py-1.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 rounded-md text-sm font-medium transition-colors shadow-sm h-9"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
            Actualizar
          </button>
        </div>
      </div>

      {/* Alerta tabla faltante */}
      {tableMissing && (
        <div className="mt-6 bg-red-50 border border-red-200 text-red-800 p-4 rounded-lg text-sm font-medium flex items-center gap-3 shrink-0">
          <AlertCircle size={18} className="shrink-0" />
          La tabla <code className="font-mono bg-red-100 px-1 rounded">facturas</code> no existe aún en la base de datos.
          Aplica la migración <code className="font-mono bg-red-100 px-1 rounded">20260909180000_create_facturas_table.sql</code> en Supabase.
        </div>
      )}

      {/* Tabs de estado */}
      <div className="flex gap-2 overflow-x-auto py-5 hide-scrollbar shrink-0 border-b border-gray-100">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setFiltroEstado(tab.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-2 border ${
              filtroEstado === tab.id
                ? 'bg-gray-900 border-gray-900 text-white'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300'
            }`}
          >
            {tab.label}
            <span className={`px-2 py-0.5 rounded text-xs font-mono ${
              filtroEstado === tab.id ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
            }`}>
              {counts[tab.id]}
            </span>
          </button>
        ))}
      </div>

      {/* Contenido */}
      <div className="flex-1 overflow-y-auto pt-5 pb-20">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin" />
            <p className="text-sm text-gray-400">Cargando solicitudes...</p>
          </div>
        ) : facturasFiltered.length === 0 ? (
          <div className="border border-dashed border-gray-300 rounded-lg p-12 flex flex-col items-center justify-center text-center max-w-lg mx-auto mt-8">
            <div className="w-12 h-12 bg-gray-50 border border-gray-100 rounded-lg flex items-center justify-center mb-4">
              <Receipt className="text-gray-400" size={24} />
            </div>
            <h3 className="text-gray-900 font-medium text-sm">
              {searchTel ? `Sin resultados para "${searchTel}"` : 'Sin solicitudes'}
            </h3>
            <p className="text-gray-500 text-sm mt-1">
              {filtroEstado === 'todas'
                ? 'Cuando un cliente solicite facturación por WhatsApp, aparecerá aquí.'
                : `No hay facturas en estado "${ESTADO_CONFIG[filtroEstado as keyof typeof ESTADO_CONFIG]?.label}".`}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {facturasFiltered.map(factura => {
              const cfg = ESTADO_CONFIG[factura.estado];
              const cleanTel = (factura.cliente_tel || '').replace(/\D/g, '');
              const isExpanded = expandedId === factura.id;
              const isUpdating = updatingId === factura.id;

              return (
                <div
                  key={factura.id}
                  className="bg-white border border-gray-200 rounded-lg overflow-hidden hover:border-gray-300 transition-colors"
                >
                  {/* Fila principal */}
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4 px-5 py-4">
                    {/* Contenedor info principal */}
                    <div className="flex items-center gap-4 min-w-0 flex-1 w-full">
                      {/* Ícono tipo de media */}
                      <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                        <FileText size={18} className="text-gray-500" />
                      </div>
  
                      {/* ID + teléfono */}
                      <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-gray-900 bg-gray-100 px-2 py-0.5 rounded">
                          #{factura.id.slice(0, 6).toUpperCase()}
                        </span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${cfg.badge}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                          {cfg.label}
                        </span>
                        <span className="text-xs text-gray-400">
                          {factura.media_type === 'document' ? '📄 PDF' : '🖼️ Imagen'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-sm font-medium text-gray-900 font-mono">
                          {factura.cliente_tel}
                        </span>
                        <span className="text-xs text-gray-400 flex items-center gap-1">
                          <Clock size={11} />
                          {formatRelativeTime(factura.created_at)}
                        </span>
                      </div>
                      </div>
                    </div>

                    {/* Acciones rápidas */}
                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto w-full sm:w-auto justify-end border-t sm:border-0 pt-3 sm:pt-0 mt-2 sm:mt-0 border-gray-100">
                      {cleanTel && (
                        <a
                          href={`https://wa.me/${cleanTel}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 text-gray-400 hover:text-emerald-600 transition-colors bg-gray-50 hover:bg-emerald-50 rounded-md"
                          title="Abrir chat de WhatsApp"
                        >
                          <MessageSquare size={14} />
                        </a>
                      )}
                      {cleanTel && (
                        <a
                          href={`tel:${cleanTel}`}
                          className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors bg-gray-50 hover:bg-blue-50 rounded-md"
                          title="Llamar"
                        >
                          <Phone size={14} />
                        </a>
                      )}

                      {/* Cambio de estado */}
                      {factura.estado === 'pendiente' && (
                        <button
                          disabled={isUpdating}
                          onClick={() => updateEstado(factura.id, 'facturada')}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white rounded-md text-xs font-semibold transition-colors"
                        >
                          <CheckCircle2 size={13} />
                          {isUpdating ? 'Guardando...' : 'Marcar facturada'}
                        </button>
                      )}
                      {factura.estado === 'pendiente' && (
                        <button
                          disabled={isUpdating}
                          onClick={() => window.confirm('¿Cancelar esta solicitud?') && updateEstado(factura.id, 'cancelada')}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors border border-transparent hover:border-red-200"
                          title="Cancelar"
                        >
                          <XCircle size={14} />
                        </button>
                      )}
                      {factura.estado === 'facturada' && (
                        <button
                          disabled={isUpdating}
                          onClick={() => updateEstado(factura.id, 'pendiente')}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-600 border border-gray-300 rounded-md text-xs font-medium transition-colors"
                        >
                          Reabrir
                        </button>
                      )}

                      {/* Toggle datos fiscales */}
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : factura.id)}
                        className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                        title="Ver datos fiscales"
                      >
                        <ChevronDown
                          size={16}
                          className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Panel expandido: Datos fiscales */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 bg-gray-50 px-5 py-4">
                      
                      <div className="flex flex-col md:flex-row gap-6">
                        <div className="flex-1">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                            Datos Fiscales Extraídos
                          </p>
                          <div className="bg-white border border-gray-200 rounded-md p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {(factura.datos_fiscales || 'No especificados').split('\n').filter(line => line.trim().length > 0).map((line, idx) => {
                              const parts = line.split(':');
                              if (parts.length >= 2) {
                                const label = parts[0].trim();
                                const val = parts.slice(1).join(':').trim();
                                return (
                                  <div key={idx} className="flex flex-col gap-0.5">
                                    <span className="text-xs text-gray-400 font-medium">{label}</span>
                                    <span className="text-sm text-gray-900 font-medium">{val}</span>
                                  </div>
                                );
                              }
                              return (
                                <div key={idx} className="col-span-1 sm:col-span-2 text-sm text-gray-800">
                                  {line}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                                {/* Documentos */}
                                {(factura.media_url || factura.pdf_url) && (
                                  <div className="w-full md:w-64 shrink-0">
                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                                      Documentos
                                    </p>
                                    <div className="space-y-2">
                                      {factura.media_url && (
                                        <button
                                          onClick={() => setPreviewFile({ url: factura.media_url!, type: 'image' })}
                                          className="w-full flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-md hover:border-blue-300 hover:bg-blue-50 transition-colors group text-left"
                                        >
                                          <div className="w-8 h-8 rounded bg-blue-100 text-blue-600 flex items-center justify-center shrink-0 group-hover:bg-blue-200">
                                            <FileText size={16} />
                                          </div>
                                          <div className="min-w-0 flex-1">
                                            <p className="text-sm font-medium text-gray-900 truncate">Ticket de Compra</p>
                                            <p className="text-xs text-gray-500">Ver imagen original</p>
                                          </div>
                                        </button>
                                      )}
                                      
                                      {factura.pdf_url && (
                                        <button
                                          onClick={() => setPreviewFile({ url: factura.pdf_url!, type: 'pdf' })}
                                          className="w-full flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-md hover:border-red-300 hover:bg-red-50 transition-colors group text-left"
                                        >
                                          <div className="w-8 h-8 rounded bg-red-100 text-red-600 flex items-center justify-center shrink-0 group-hover:bg-red-200">
                                            <FileText size={16} />
                                          </div>
                                          <div className="min-w-0 flex-1">
                                            <p className="text-sm font-medium text-gray-900 truncate">Constancia Fiscal</p>
                                            <p className="text-xs text-gray-500">Ver PDF adjunto</p>
                                          </div>
                                        </button>
                                      )}
                            </div>
                          </div>
                        )}
                      </div>

                      <p className="text-xs text-gray-400 mt-4 border-t border-gray-200 pt-3">
                        Registrado el {formatDate(factura.created_at)} &nbsp;·&nbsp; ID media: <span className="font-mono">{factura.media_id}</span>
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal Visor de Archivos */}
      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/90 backdrop-blur-sm">
          <div className="relative w-full max-w-5xl h-[85vh] bg-white rounded-lg shadow-2xl overflow-hidden flex flex-col">
            {/* Header del Modal */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
              <h3 className="font-semibold text-gray-800">
                {previewFile.type === 'image' ? 'Vista previa del Ticket' : 'Vista previa de Constancia'}
              </h3>
              <button
                onClick={() => setPreviewFile(null)}
                className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            {/* Contenido del Modal */}
            <div className="flex-1 overflow-auto bg-gray-100 flex items-center justify-center p-4">
              {previewFile.type === 'image' ? (
                <img 
                  src={previewFile.url} 
                  alt="Vista previa" 
                  className="max-w-full max-h-full object-contain shadow-sm bg-white"
                />
              ) : (
                <iframe 
                  src={previewFile.url} 
                  className="w-full h-full bg-white shadow-sm"
                  title="Visor PDF"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
