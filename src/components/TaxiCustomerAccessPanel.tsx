import { useCallback, useEffect, useRef, useState } from 'react';
import { LockKeyhole, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { trackingCall, TrackingClientError } from '../lib/trackingClient';
import { customerPhone, customerPhones, parseCustomerAccess, type CustomerAccess } from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/customerAccess.ts';

interface Command { action: 'set_customer_access'; tenantId: string; requestId: string; revision: number; phones: string[]; restricted: boolean }
export default function TaxiCustomerAccessPanel({ tenantId, canEdit, preview, onLockChange }: {
  tenantId: string; canEdit: boolean; preview: boolean; onLockChange: (locked: boolean) => void;
}) {
  const [saved, setSaved] = useState<CustomerAccess | null>(null), [phones, setPhones] = useState<string[]>([]);
  const [restricted, setRestricted] = useState(true);
  const [input, setInput] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [pending, setPending] = useState<Command | null>(null);
  const mounted = useRef(true);
  const dirty = saved !== null && (saved.restricted !== restricted || JSON.stringify(saved.phones) !== JSON.stringify(phones));
  useEffect(() => { onLockChange(dirty || saving || pending !== null); }, [dirty, saving, pending, onLockChange]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; onLockChange(false); }; }, [onLockChange]);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(''); setNotice('');
    try {
      const next = preview ? { restricted: true, revision: 0, phones: ['+529630000002'] } : parseCustomerAccess(await trackingCall('taxi-bot-admin', { action: 'customer_access', tenantId }, signal));
      if (!signal?.aborted && mounted.current) { setSaved(next); setPhones(next.phones); setRestricted(next.restricted); }
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
      setSaved(result); setPhones(result.phones); setRestricted(result.restricted); setPending(null); setNotice(result.restricted ? 'Listo. La IA atiende sólo a los números autorizados.' : 'Piloto abierto. La IA puede atender a todos los clientes cuando el canal está activo.');
    } catch (e: unknown) {
      if (!mounted.current) return;
      if (e instanceof TrackingClientError && e.status >= 400 && e.status < 500) setPending(null);
      setError(e instanceof Error ? e.message : 'No se confirmó el guardado. Comprueba la misma solicitud.');
    } finally { if (mounted.current) setSaving(false); }
  };
  const disabled = !canEdit || preview || loading || saving || pending !== null;
  return <section className="taxi-customer-access" aria-labelledby="taxi-access-title">
    <div className="taxi-access-heading"><LockKeyhole size={23} /><div><h2 id="taxi-access-title">Atención a clientes</h2><p>Elige si la IA atiende a todos los clientes o sólo a tus números de prueba. Para detener respuestas y ofertas usa «Pausar bot» arriba.</p></div></div>
    {saved && <p className="taxi-access-policy" role="status">{saved.restricted ? 'Sólo autorizados · Una lista vacía deja fuera a todos los clientes.' : 'Piloto abierto · Todos los clientes pueden conversar con la IA cuando el canal está activo.'}</p>}
    {loading && <p role="status">Cargando autorizados…</p>}
    {error && <p className="taxi-error" role="alert">{error}</p>}
    {notice && <p className="taxi-notice" role="status">{notice}</p>}
    {saved && <>
      <div className="taxi-access-add"><label htmlFor="taxi-access-mode">Quién puede conversar con la IA<select id="taxi-access-mode" value={restricted ? 'restricted' : 'public'} disabled={disabled} onChange={(event) => { setRestricted(event.target.value === 'restricted'); setNotice(''); }}><option value="restricted">Sólo números autorizados</option><option value="public">Todos los clientes (piloto)</option></select></label></div>
      <p className="taxi-muted">La lista se conserva al abrir el piloto y vuelve a aplicarse al elegir «Sólo números autorizados». Aplica a los canales de esta base.</p>
      <form className="taxi-access-add" onSubmit={(event) => { event.preventDefault(); if (!disabled) add(); }}>
        <label htmlFor="taxi-access-phone">Número de WhatsApp<input id="taxi-access-phone" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ej. 963 000 0000" inputMode="tel" autoComplete="tel" disabled={disabled} maxLength={24}/></label>
        <button className="taxi-secondary" type="submit" disabled={disabled || !input.trim() || phones.length >= 100}><Plus size={17}/>Agregar a la lista</button>
      </form>
      <p className="taxi-muted">Para México puedes escribir los diez dígitos. Para otro país incluye + y la lada.</p>
      {phones.length ? <ul className="taxi-access-list" aria-label="Clientes autorizados">{phones.map((phone) => <li key={phone}><span>{phone}</span><span>Cliente</span><button className="taxi-text-button" disabled={disabled} onClick={() => { setPhones(phones.filter((value) => value !== phone)); setNotice(''); }} aria-label={'Quitar '+phone}><Trash2 size={16}/>Quitar</button></li>)}</ul> : <p className="taxi-empty">Todavía no hay números autorizados. Agrega el de quien hará la prueba.</p>}
      <div className="taxi-access-actions"><button className="taxi-primary" disabled={disabled || !dirty} onClick={() => { if (saved) void save({ action: 'set_customer_access', tenantId, requestId: crypto.randomUUID(), revision: saved.revision, phones, restricted }); }}><Save size={17}/>{saving ? 'Guardando…' : 'Guardar acceso'}</button>
        {dirty && !pending && <button className="taxi-secondary" disabled={saving} onClick={() => { setPhones(saved.phones); setRestricted(saved.restricted); setError(''); }}>Descartar cambios</button>}
      </div>
    </>}
    {pending && !saving && <div className="taxi-uncertain"><p>El resultado quedó pendiente. Comprueba esta solicitud antes de hacer otro cambio.</p><button className="taxi-primary" onClick={() => void save(pending)}>Comprobar guardado</button></div>}
    {!dirty && !pending && <button className="taxi-text-button" disabled={loading || saving} onClick={() => void load()}><RefreshCw size={16}/>Actualizar lista</button>}
    <p className="taxi-muted">Las ofertas siguen perteneciendo al conductor asignado. Abrir el piloto no permite aceptar ofertas ajenas.</p>
  </section>;
}
