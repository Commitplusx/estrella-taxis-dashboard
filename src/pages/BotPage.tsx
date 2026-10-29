import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Building2, MapPin, MessageSquare, Package, Power, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { companyAdminClient } from '../lib/companyAdminClient';
import type { TaxiBase } from '../../estrella-taxis-backend/supabase/functions/_shared/tracking/companies.ts';

export default function BotPage() {
  const [bases, setBases] = useState<TaxiBase[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadBases = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await companyAdminClient.list(signal);
      if (!signal?.aborted) {
        setBases(result.bases);
        setCanManage(result.canManage);
      }
    } catch (caught: unknown) {
      if (!signal?.aborted) setError(caught instanceof Error ? caught.message : 'No pudimos cargar las bases. Inténtalo de nuevo.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  const refresh = () => {
    setLoading(true);
    setError('');
    void loadBases();
  };

  useEffect(() => {
    const abort = new AbortController();
    void loadBases(abort.signal);
    return () => abort.abort();
  }, [loadBases]);

  const setActive = async (base: TaxiBase) => {
    if (pendingId || !canManage) return;
    setPendingId(base.id);
    setError('');
    try {
      const saved = await companyAdminClient.setActive(base, !base.activo);
      setBases(current => current.map(item => item.id === saved.id ? saved : item));
      toast.success(saved.activo ? 'Base activada.' : 'Base desactivada.');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'No pudimos cambiar el estado. Actualiza la lista antes de repetir.');
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-7xl p-4 font-sans sm:p-6 lg:p-8">
      <header className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><Building2 size={24} className="text-blue-600" /> Bases y canales</h1>
          <p className="mt-2 max-w-2xl text-base text-gray-600">Revisa el estado de cada base y abre su configuración de WhatsApp.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && <Link to="/packages#asignacion" className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"><Package size={17} /> Planes y asignación</Link>}
          <button type="button" onClick={refresh} disabled={loading || pendingId !== null} className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50"><RefreshCw size={17} className={loading ? 'animate-spin' : ''} /> Actualizar</button>
        </div>
      </header>

      {error && <div role="alert" className="mb-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-900"><AlertCircle size={20} className="mt-0.5 shrink-0" /><p className="break-words text-base">{error}</p></div>}
      {loading ? <p role="status" className="py-12 text-center text-gray-600">Cargando bases…</p> : (
        <div className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
          {bases.map(base => (
            <section key={base.id} className="flex flex-col gap-6 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between" aria-label={base.nombre_empresa}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <h2 className="text-xl font-bold text-gray-900 [overflow-wrap:anywhere]">{base.nombre_empresa}</h2>
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700"><span className={'h-2.5 w-2.5 rounded-full ' + (base.activo ? 'bg-emerald-600' : 'bg-gray-400')} />{base.activo ? 'Base activa' : 'Base inactiva'}</span>
                </div>
                {base.ciudad && <p className="mt-2 flex items-center gap-2 text-sm text-gray-600"><MapPin size={16} className="shrink-0" />{base.ciudad}</p>}
                <p className="mt-3 text-sm text-gray-700">{base.plan ? base.plan.nombre + (base.plan.activo ? '' : ' · inactivo') : 'Sin plan asignado'}{base.plan?.activo && base.plan.incluye_whatsapp ? ' · incluye WhatsApp' : ''}</p>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-600">{base.activo ? 'La base está habilitada. WhatsApp atenderá cuando también actives su canal y completes la configuración.' : 'Activa la base para habilitar sus servicios. Después puedes encender su canal de WhatsApp.'}</p>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
                <Link to={'/taxi-bot?base=' + base.id + '#configuracion'} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"><MessageSquare size={17} /> Configurar WhatsApp</Link>
                {canManage && <button type="button" onClick={() => void setActive(base)} disabled={pendingId !== null} className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50"><Power size={17} />{pendingId === base.id ? 'Guardando…' : base.activo ? 'Desactivar base' : 'Activar base'}</button>}
              </div>
            </section>
          ))}
          {bases.length === 0 && !error && <p className="p-8 text-center text-gray-600">Tu cuenta todavía no tiene bases de taxi asignadas.</p>}
        </div>
      )}
    </div>
  );
}
