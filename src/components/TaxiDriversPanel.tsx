import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Save, Truck } from 'lucide-react';
import { trackingCall, TrackingClientError } from '../lib/trackingClient';
import { record } from '../../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts';
import { parseBotDriver, parseDriverSetup, type DriverSetup } from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/driverAdmin.ts';
import { channelPhone, splitChannelPhone } from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/channelPhone.ts';
import TaxiPhoneField, { type TaxiPhoneValue } from './TaxiPhoneField';

export default function TaxiDriversPanel({ tenantId, waba, canEdit, preview, disabled, onZones, onLockChange }: {
  tenantId: string; waba: string; canEdit: boolean; preview: boolean; disabled: boolean; onZones: () => void; onLockChange: (locked: boolean) => void;
}) {
  const [data, setData] = useState<DriverSetup | null>(null);
  const [loading, setLoading] = useState(!preview), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [device, setDevice] = useState(''), [name, setName] = useState(''), [active, setActive] = useState(true);
  const [phone, setPhone] = useState<TaxiPhoneValue>({ country: 'MX', national: '' });
  const [dirty, setDirty] = useState(false), [pending, setPending] = useState<Record<string, unknown> | null>(null);
  useEffect(() => { onLockChange(dirty || busy || Boolean(pending)); return () => onLockChange(false); }, [dirty, busy, pending, onLockChange]);
  const load = useCallback(async (signal: AbortSignal) => {
    if (preview) return;
    try {
      const result = parseDriverSetup(await trackingCall('taxi-bot-admin', { action: 'drivers', tenantId, waba }, signal));
      if (!signal.aborted) { setData(result); setError(''); }
    } catch (cause: unknown) { if (!signal.aborted) setError(cause instanceof Error ? cause.message : 'No pudimos cargar los conductores.'); }
    finally { if (!signal.aborted) setLoading(false); }
  }, [tenantId, waba, preview]);
  useEffect(() => { const abort = new AbortController(); void load(abort.signal); return () => abort.abort(); }, [load, reload]);
  const select = (value: string) => {
    const driver = data?.drivers.find(item => item.deviceId === Number(value));
    setDevice(value); setName(driver?.name ?? ''); setPhone(splitChannelPhone(driver?.phone ?? '')); setActive(driver?.active ?? true); setDirty(false); setNotice('');
  };
  const save = async (command: Record<string, unknown>) => {
    setBusy(true); setPending(command); setError(''); setNotice('');
    try {
      const result = await trackingCall('taxi-bot-admin', command);
      if (!record(result) || result.state !== 'saved') throw new Error('No se confirmó el registro. Comprueba el mismo guardado.');
      parseBotDriver(result.driver);
      setPending(null); setDirty(false); setDevice(''); setName(''); setPhone({ country: 'MX', national: '' }); setActive(true);
      setNotice('Conductor guardado para esta base. Ya puede recibir las ofertas del bot cuando esté disponible.'); setLoading(true); setReload(value => value + 1);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'No se confirmó el registro.');
      if (cause instanceof TrackingClientError && cause.status >= 400 && cause.status < 500) setPending(null);
    } finally { setBusy(false); }
  };
  return <section className="taxi-config taxi-driver-setup" id="conductores-bot" aria-labelledby="taxi-driver-heading">
    <div className="taxi-section-heading"><div><h2 id="taxi-driver-heading"><Truck size={23} /> Conductores de esta base</h2>
      <p>Elige la unidad de Traccar y registra el WhatsApp de quien la conduce. Aquí queda vinculada con el bot.</p></div>
      <button className="taxi-secondary" disabled={disabled || busy || dirty || Boolean(pending) || loading} onClick={() => { setLoading(true); setReload(value => value + 1); }} aria-label="Actualizar conductores"><RefreshCw size={18} /></button></div>
    {loading && <p role="status">Consultando unidades y conductores…</p>}
    {preview && <p>Entra con tu cuenta para elegir las unidades reales de Traccar.</p>}
    {data && <>
      <p className="taxi-setup-status">{data.activeCount} {data.activeCount === 1 ? 'conductor activo' : 'conductores activos'} · {data.zoneCount.toLocaleString('es-MX')} hexágonos de la base.
        {' '}<button className="taxi-text-button" onClick={onZones} disabled={disabled || dirty || busy || Boolean(pending)}>Ver zonas y tarifas</button></p>
      {data.drivers.length > 0 && <ul className="taxi-driver-list">{data.drivers.map(driver => <li key={driver.deviceId}>
        <div><strong>{driver.name}</strong><small>{data.units.find(unit => unit.id === driver.deviceId)?.name ?? 'Unidad no disponible en tu cuenta'} · {driver.phone} · {driver.active ? 'Activo' : 'En pausa'}</small></div>
        {canEdit && <button className="taxi-secondary" disabled={disabled || busy || Boolean(pending) || dirty || !data.units.some(unit => unit.id === driver.deviceId)} onClick={() => select(String(driver.deviceId))}>Editar</button>}
      </li>)}</ul>}
      {canEdit && <form onSubmit={event => {
        event.preventDefault(); const number = channelPhone(phone.country, phone.national);
        if (!device || !name.trim() || !number) { setError('Elige la unidad, escribe el nombre y completa el WhatsApp con su país.'); return; }
        void save({ action: 'driver_save', tenantId, waba, deviceId: Number(device), name: name.trim(), phone: number, active,
          expected: data.drivers.find(driver => driver.deviceId === Number(device))?.version ?? null, requestId: crypto.randomUUID() });
      }}>
        <h3>{data.drivers.some(driver => driver.deviceId === Number(device)) ? 'Editar conductor' : 'Agregar conductor'}</h3>
        {!data.units.length && <p>No hay unidades visibles en Traccar. Agrégalas o asigna el acceso a tu cuenta antes de registrar al conductor.</p>}
        <fieldset className="taxi-fields" disabled={disabled || busy || Boolean(pending) || !data.units.length}>
          <label>Unidad de Traccar<select required value={device} onChange={event => { select(event.target.value); setDirty(true); }}><option value="">Elige una unidad</option>{data.units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
          <label>Nombre del conductor<input value={name} required maxLength={120} autoComplete="name" onChange={event => { setName(event.target.value); setDirty(true); }} /></label>
          <TaxiPhoneField label="WhatsApp del conductor" value={phone} required onChange={value => { setPhone(value); setDirty(true); }} help="A este número le llegarán las ofertas de servicio." />
          <label className="taxi-enable"><input type="checkbox" checked={active} onChange={event => { setActive(event.target.checked); setDirty(true); }} /><span>Permitir ofertas del bot para esta unidad</span></label>
        </fieldset>
        <div className="taxi-form-footer"><button type="button" className="taxi-text-button" disabled={disabled || busy || Boolean(pending)} onClick={() => select('')}>Limpiar captura</button><button className="taxi-primary" type="submit" disabled={disabled || busy || Boolean(pending) || !dirty || !data.units.length}><Save size={18} />{busy ? 'Guardando…' : 'Guardar conductor'}</button></div>
      </form>}
    </>}
    {notice && <p className="taxi-notice" role="status">{notice}</p>}
    {error && <p className="taxi-error" role="alert">{error}</p>}
    {pending && !busy && <button className="taxi-primary" onClick={() => void save(pending)}>Comprobar guardado del conductor</button>}
  </section>;
}
