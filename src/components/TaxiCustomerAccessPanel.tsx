import { useCallback, useEffect, useRef, useState } from 'react';
import { LockKeyhole, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { trackingCall, TrackingClientError } from '../lib/trackingClient';
import { customerPhone, customerPhones, parseCustomerAccess, type CustomerAccess } from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/customerAccess.ts';

interface Command { action: 'set_customer_access'; tenantId: string; requestId: string; revision: number; phones: string[] }
export default function TaxiCustomerAccessPanel({ tenantId, canEdit, preview, onLockChange }: {
  tenantId: string; canEdit: boolean; preview: boolean; onLockChange: (locked: boolean) => void;
}) {
  const [saved, setSaved] = useState<CustomerAccess | null>(null), [phones, setPhones] = useState<string[]>([]);
  const [input, setInput] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [pending, setPending] = useState<Command | null>(null);
  const mounted = useRef(true);
  const dirty = saved !== null && JSON.stringify(saved.phones) !== JSON.stringify(phones);
  useEffect(() => { onLockChange(dirty || saving || pending !== null); }, [dirty, saving, pending, onLockChange]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; onLockChange(false); }; }, [onLockChange]);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(''); setNotice('');
    try {
      const next = preview ? { revision: 0, phones: ['+529630000002'] } : parseCustomerAccess(await trackingCall('taxi-bot-admin', { action: 'customer_access', tenantId }, signal));
      if (!signal?.aborted && mounted.current) { setSaved(next); setPhones(next.phones); }
    } catch (e: unknown) {
      if (!signal?.aborted && mounted.current) setError(e instanceof Error ? e.message : 'No pudimos cargar los autorizados.');
    } finally { if (!signal?.aborted && mounted.current) setLoading(false); }
  }, [tenantId, preview]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const add = () => {
    try {
      const phone = customerPhone(input);
      const next = customerPhones([...phones, phone]);
      setPhones(next); setInput(''); setError(''); setNotice('');
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Revisa el número.'); }
  };
  const save = async (command: Command) => {
    if (saving || preview || !canEdit) return;
    setPending(command); setSaving(true); setError(''); setNotice('');
    try {
      const result = parseCustomerAccess(await trackingCall('taxi-bot-admin', { ...command }));
      if (!mounted.current) return;
      setSaved(result); setPhones(result.phones); setPending(null); setNotice('Listo. Sólo estos números pueden conversar con la IA como clientes.');
    } catch (e: unknown) {
      if (!mounted.current) return;
      if (e instanceof TrackingClientError && e.status >= 400 && e.status < 500) setPending(null);
      setError(e instanceof Error ? e.message : 'No se confirmó el guardado. Comprueba la misma solicitud.');
    } finally { if (mounted.current) setSaving(false); }
  };
  const disabled = !canEdit || preview || loading || saving || pending !== null;
  return <section className="taxi-customer-access" aria-labelledby="taxi-access-title">
    <div className="taxi-access-heading"><LockKeyhole size={23} /><div><h2 id="taxi-access-title">Números autorizados de Pompeyo</h2><p>La IA sólo atenderá como clientes a los números de esta lista. Los demás no reciben respuesta automática.</p></div></div>
    <p className="taxi-access-policy">Acceso cerrado · Una lista vacía deja fuera a todos los clientes. Aplica a los canales de Pompeyo.</p>
    {loading && <p role="status">Cargando autorizados…</p>}
    {error && <p className="taxi-error" role="alert">{error}</p>}
    {notice && <p className="taxi-notice" role="status">{notice}</p>}
    {saved && <>
      <form className="taxi-access-add" onSubmit={(event) => { event.preventDefault(); if (!disabled) add(); }}>
        <label htmlFor="taxi-access-phone">Número de WhatsApp<input id="taxi-access-phone" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ej. 963 000 0000" inputMode="tel" autoComplete="tel" disabled={disabled} maxLength={24}/></label>
        <button className="taxi-secondary" type="submit" disabled={disabled || !input.trim() || phones.length >= 100}><Plus size={17}/>Agregar a la lista</button>
      </form>
      <p className="taxi-muted">Para México puedes escribir los diez dígitos. Para otro país incluye + y la lada.</p>
      {phones.length ? <ul className="taxi-access-list" aria-label="Clientes autorizados">{phones.map((phone) => <li key={phone}><span>{phone}</span><span>Cliente</span><button className="taxi-text-button" disabled={disabled} onClick={() => { setPhones(phones.filter((value) => value !== phone)); setNotice(''); }} aria-label={'Quitar '+phone}><Trash2 size={16}/>Quitar</button></li>)}</ul> : <p className="taxi-empty">Todavía no hay números autorizados. Agrega el de quien hará la prueba.</p>}
      <div className="taxi-access-actions"><button className="taxi-primary" disabled={disabled || !dirty} onClick={() => { if (saved) void save({ action: 'set_customer_access', tenantId, requestId: crypto.randomUUID(), revision: saved.revision, phones }); }}><Save size={17}/>{saving ? 'Guardando…' : 'Guardar autorizados'}</button>
        {dirty && !pending && <button className="taxi-secondary" disabled={saving} onClick={() => { setPhones(saved.phones); setError(''); }}>Descartar cambios</button>}
      </div>
    </>}
    {pending && !saving && <div className="taxi-uncertain"><p>El resultado quedó pendiente. Comprueba esta solicitud antes de hacer otro cambio.</p><button className="taxi-primary" onClick={() => void save(pending)}>Comprobar guardado</button></div>}
    {!dirty && !pending && <button className="taxi-text-button" disabled={loading || saving} onClick={() => void load()}><RefreshCw size={16}/>Actualizar lista</button>}
    <p className="taxi-muted">Los conductores sólo pueden responder a los botones de una oferta que les pertenece. Eso no los autoriza como clientes.</p>
  </section>;
}
