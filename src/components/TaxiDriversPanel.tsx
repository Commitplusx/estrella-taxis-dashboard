import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Save, Search, Truck } from 'lucide-react';
import { trackingCall, TrackingClientError } from '../lib/trackingClient';
import { record } from '../../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts';
import { contactRoles, isContactRole, parseBaseContact, parseContactSetup, type ContactRole, type ContactSetup } from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contactAdmin.ts';
import { channelCountries, channelPhone, splitChannelPhone } from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/channelPhone.ts';
import TaxiPhoneField, { type TaxiPhoneValue } from './TaxiPhoneField';

const previewData: ContactSetup = {
  units: [{ id: 1, name: 'GPS de prueba' }], drivers: [], activeCount: 0, zoneCount: 2541,
  contacts: [
    { id: '11111111-1111-4111-8111-111111111111', unitNumber: '487', name: 'Contacto de prueba', phoneInput: '9630000001', phone: '+529630000001', role: 'pending', deviceId: null, receiving: false, version: 'a'.repeat(32) },
    { id: '22222222-2222-4222-8222-222222222222', unitNumber: '495', name: 'Dueño de prueba', phoneInput: '9630000002', phone: '+529630000002', role: 'owner', deviceId: 1, receiving: false, version: 'b'.repeat(32) },
    { id: '33333333-3333-4333-8333-333333333333', unitNumber: '495', name: 'Conductor de prueba', phoneInput: '963000003', phone: null, role: 'driver', deviceId: 1, receiving: false, version: 'c'.repeat(32) },
  ],
};

export default function TaxiDriversPanel({ tenantId, waba, canEdit, preview, disabled, onZones, onLockChange }: {
  tenantId: string; waba: string; canEdit: boolean; preview: boolean; disabled: boolean; onZones: () => void; onLockChange: (locked: boolean) => void;
}) {
  const [data, setData] = useState<ContactSetup | null>(preview ? previewData : null);
  const [loading, setLoading] = useState(!preview), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [search, setSearch] = useState('');
  const [selected, setSelected] = useState(''), [device, setDevice] = useState(''), [unitNumber, setUnitNumber] = useState('');
  const [name, setName] = useState(''), [role, setRole] = useState<ContactRole>('pending'), [receiving, setReceiving] = useState(false);
  const [phone, setPhone] = useState<TaxiPhoneValue>({ country: 'MX', national: '' });
  const [dirty, setDirty] = useState(false), [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const locked = disabled || busy || Boolean(pending);
  const driving = role === 'driver' || role === 'owner_driver';
  const completePhone = channelPhone(phone.country, phone.national);
  useEffect(() => { onLockChange(dirty || busy || Boolean(pending)); return () => onLockChange(false); }, [dirty, busy, pending, onLockChange]);
  const clear = useCallback(() => {
    setSelected(''); setDevice(''); setUnitNumber(''); setName(''); setRole('pending'); setReceiving(false);
    setPhone({ country: 'MX', national: '' }); setDirty(false);
  }, []);
  const load = useCallback(async (signal: AbortSignal) => {
    if (preview) { setData(previewData); setLoading(false); return; }
    setLoading(true); setData(null); clear();
    try {
      const result = parseContactSetup(await trackingCall('taxi-bot-admin', { action: 'contacts', tenantId, waba }, signal));
      if (!signal.aborted) { setData(result); setError(''); }
    } catch (cause: unknown) { if (!signal.aborted) setError(cause instanceof Error ? cause.message : 'No pudimos cargar los contactos.'); }
    finally { if (!signal.aborted) setLoading(false); }
  }, [tenantId, waba, preview, clear]);
  useEffect(() => { const abort = new AbortController(); void load(abort.signal); return () => abort.abort(); }, [load, reload]);
  const edit = (id: string) => {
    const contact = data?.contacts.find(item => item.id === id); if (!contact) return;
    setSelected(id); setDevice(contact.deviceId === null ? '' : String(contact.deviceId)); setUnitNumber(contact.unitNumber);
    setName(contact.name); setRole(contact.role); setPhone(splitChannelPhone(contact.phoneInput)); setReceiving(contact.receiving);
    setDirty(false); setNotice(''); setError('');
  };
  const save = async (command: Record<string, unknown>) => {
    if (preview) { setNotice('Vista de diseño: aquí no se guardan datos ni se envían mensajes.'); return; }
    setBusy(true); setPending(command); setError(''); setNotice('');
    try {
      const result = await trackingCall('taxi-bot-admin', command);
      if (!record(result) || result.state !== 'saved') throw new Error('No se confirmó el guardado. Comprueba la misma solicitud.');
      const saved = parseBaseContact(result.contact);
      setPending(null); clear();
      setNotice(saved.receiving ? 'Cambios guardados. Este conductor recibirá ofertas cuando la unidad esté disponible.' : 'Contacto guardado. No recibirá ofertas de viaje.');
      setReload(value => value + 1);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'No se confirmó el guardado.');
      if (cause instanceof TrackingClientError && cause.status >= 400 && cause.status < 500) setPending(null);
    } finally { setBusy(false); }
  };
  const query = search.trim().toLocaleLowerCase('es-MX');
  const visible = data?.contacts.filter(contact => `${contact.name} ${contact.unitNumber} ${contactRoles.find(item => item.value === contact.role)?.label}`.toLocaleLowerCase('es-MX').includes(query)) ?? [];
  return <section className="taxi-config taxi-driver-setup" id="conductores-bot" aria-labelledby="taxi-driver-heading">
    <div className="taxi-section-heading"><div><h2 id="taxi-driver-heading"><Truck size={23} /> Conductores y dueños</h2>
      <p>Organiza los contactos de cada unidad y elige quién recibe los viajes.</p></div>
      <button className="taxi-secondary" disabled={locked || dirty || loading} onClick={() => setReload(value => value + 1)} aria-label="Actualizar contactos"><RefreshCw size={18} /></button></div>
    {loading && <p role="status">Consultando contactos y unidades…</p>}
    {data && <>
      <p className="taxi-setup-status">{data.contacts.length} contactos · {data.units.length} {data.units.length === 1 ? 'unidad' : 'unidades'} con GPS · {data.activeCount} {data.activeCount === 1 ? 'conductor recibe' : 'conductores reciben'} ofertas.
        {' '}<button className="taxi-text-button" onClick={onZones} disabled={locked || dirty}>Ver zonas y tarifas</button></p>
      <div className="taxi-contact-toolbar"><label><Search size={18} /><span className="taxi-sr-only">Buscar contacto o número de unidad</span><input type="search" placeholder="Nombre o número de unidad" value={search} onChange={event => setSearch(event.target.value)} /></label>
        {canEdit && <button className="taxi-secondary" disabled={locked || dirty} onClick={() => { clear(); setNotice(''); }}><Plus size={18} /> Nuevo contacto</button>}</div>
      {visible.length ? <ul className="taxi-driver-list taxi-contact-list" aria-label="Contactos de la base">{visible.map(contact => <li key={contact.id} aria-current={selected === contact.id ? 'true' : undefined}>
        <div><strong>{contact.name}</strong><span className="taxi-contact-role">{contactRoles.find(item => item.value === contact.role)?.label}</span>
          <small>Unidad {contact.unitNumber} · {contact.phoneInput || 'Sin teléfono'}{!contact.phone && ' · Revisar teléfono'}</small>
          <small>{contact.deviceId === null ? 'Sin vincular a GPS' : `${data.units.find(unit => unit.id === contact.deviceId)?.name ?? 'GPS no visible en tu cuenta'} · GPS #${contact.deviceId}`} · {contact.receiving ? 'Recibe ofertas' : 'Sin ofertas'}</small></div>
        {canEdit && <button className="taxi-secondary" disabled={locked || dirty} onClick={() => edit(contact.id)} aria-label={`Editar ${contact.name}, unidad ${contact.unitNumber}`}>Editar</button>}
      </li>)}</ul> : <p role="status">{query ? 'No encontramos ese contacto o unidad.' : 'Todavía no hay contactos registrados.'}</p>}
      {canEdit && <form onSubmit={event => {
        event.preventDefault();
        if (!unitNumber.trim() || !name.trim()) { setError('Escribe el número de unidad y el nombre del contacto.'); return; }
        if (receiving && (!driving || !completePhone || !device)) { setError('Para recibir ofertas, confirma que conduce, completa su WhatsApp y elige su GPS.'); return; }
        const prefix = channelCountries.find(country => country.id === phone.country)?.code ?? '';
        const phoneInput = completePhone ?? (phone.country === 'MX' ? phone.national : prefix + phone.national);
        void save({ action: 'contact_save', tenantId, waba, contactId: selected || crypto.randomUUID(), unitNumber: unitNumber.trim(), name: name.trim(),
          phoneInput, role, deviceId: device ? Number(device) : null, receiveOffers: receiving,
          expected: data.contacts.find(contact => contact.id === selected)?.version ?? null,
          driverVersion: data.drivers.find(driver => driver.deviceId === Number(device))?.version ?? null, requestId: crypto.randomUUID() });
      }}>
        <h3>{selected ? 'Editar contacto' : 'Nuevo contacto'}</h3>
        <fieldset className="taxi-fields" disabled={locked}>
          <label>Número de unidad<input value={unitNumber} required maxLength={20} onChange={event => { setUnitNumber(event.target.value); setDirty(true); }} placeholder="Por ejemplo: 487" /></label>
          <label>Nombre<input value={name} required maxLength={120} autoComplete="name" onChange={event => { setName(event.target.value); setDirty(true); }} /></label>
          <label>¿Qué hace en la base?<select value={role} onChange={event => { if (isContactRole(event.target.value)) { setRole(event.target.value); if (event.target.value !== 'driver' && event.target.value !== 'owner_driver') setReceiving(false); setDirty(true); } }}>{contactRoles.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label>Unidad GPS<select value={device} onChange={event => { setDevice(event.target.value); setDirty(true); }}><option value="">Vincular después</option>{data.units.map(unit => <option key={unit.id} value={unit.id}>{unit.name} · GPS #{unit.id}</option>)}</select></label>
          <TaxiPhoneField label="WhatsApp del contacto" value={phone} onChange={value => { setPhone(value); setDirty(true); }} help="Si el teléfono está incompleto, puedes corregirlo aquí antes de activar ofertas." />
          <label className="taxi-enable"><input type="checkbox" checked={receiving} disabled={!driving && !receiving} onChange={event => { setReceiving(event.target.checked); setDirty(true); }} /><span>Recibe ofertas de viaje<small>Actívalo sólo para quien conduce esta unidad. El dueño puede quedar registrado sin recibir viajes.</small></span></label>
        </fieldset>
        <div className="taxi-form-footer"><button type="button" className="taxi-text-button" disabled={locked} onClick={() => { clear(); setError(''); }}>Cancelar edición</button><button className="taxi-primary" type="submit" disabled={locked || !dirty}><Save size={18} />{busy ? 'Guardando…' : 'Guardar contacto'}</button></div>
      </form>}
    </>}
    {notice && <p className="taxi-notice" role="status">{notice}</p>}
    {error && <p className="taxi-error" role="alert">{error}</p>}
    {pending && !busy && <button className="taxi-primary" onClick={() => void save(pending)}>Comprobar guardado del contacto</button>}
  </section>;
}
