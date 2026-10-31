import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, KeyRound, Pencil, Plus, RefreshCw, Save, Search, Truck, X } from 'lucide-react';
import { parseAccountOptions, parsePendingAccounts, type PendingAccount, type TaxiAccountOption } from '../lib/taxiAccountClient';
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

export default function TaxiDriversPanel({ tenantId, waba, canEdit, canManageAccounts = false, accessMode = false, preview, disabled, onZones, onLockChange }: {
  tenantId: string; waba: string; canEdit: boolean; preview: boolean; disabled: boolean; onZones: () => void; onLockChange: (locked: boolean) => void;
  canManageAccounts?: boolean; accessMode?: boolean;
}) {
  const [data, setData] = useState<ContactSetup | null>(preview ? previewData : null);
  const [loading, setLoading] = useState(!preview), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [search, setSearch] = useState('');
  const [selected, setSelected] = useState(''), [device, setDevice] = useState(''), [unitNumber, setUnitNumber] = useState('');
  const [name, setName] = useState(''), [role, setRole] = useState<ContactRole>('pending'), [receiving, setReceiving] = useState(false);
  const [phone, setPhone] = useState<TaxiPhoneValue>({ country: 'MX', national: '' });
  const [dirty, setDirty] = useState(false), [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const [editorOpen, setEditorOpen] = useState(false), [discard, setDiscard] = useState(false);
  const [roleFilter, setRoleFilter] = useState<ContactRole | 'all'>('all'), [savedId, setSavedId] = useState('');
  const dialog = useRef<HTMLDialogElement>(null), backdropPress = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const dialogId = useId();
  const [accounts, setAccounts] = useState<TaxiAccountOption[]>([]), [accountsError, setAccountsError] = useState('');
  const [pendingAccounts, setPendingAccounts] = useState<PendingAccount[]>([]);
  const [editorMode, setEditorMode] = useState<'details' | 'access'>('details');
  const [accountChoice, setAccountChoice] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const locked = disabled || busy || Boolean(pending);
  const driving = role === 'driver' || role === 'owner_driver';
  const completePhone = channelPhone(phone.country, phone.national);
  useEffect(() => { onLockChange(editorOpen || dirty || busy || Boolean(pending)); return () => onLockChange(false); }, [editorOpen, dirty, busy, pending, onLockChange]);
  useEffect(() => {
    const element = dialog.current;
    if (editorOpen && element) {
      if (!element.open) element.showModal();
      if (!discard) nameInput.current?.focus({ preventScroll: true });
    }
    if (!editorOpen && element?.open) element.close();
  }, [editorOpen, discard]);
  useEffect(() => {
    if (!dirty && !busy && !pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy, pending]);
  const clear = useCallback(() => {
    setSelected(''); setDevice(''); setUnitNumber(''); setName(''); setRole('pending'); setReceiving(false);
    setPhone({ country: 'MX', national: '' }); setDirty(false);
  }, []);
  const load = useCallback(async (signal: AbortSignal) => {
    if (preview) { setData(previewData); setLoading(false); return; }
    setLoading(true);
    try {
      const result = parseContactSetup(await trackingCall('taxi-bot-admin', { action: 'contacts', tenantId, waba }, signal));
      if (!signal.aborted) { setData(result); setError(''); }
    } catch (cause: unknown) { if (!signal.aborted) setError(cause instanceof Error ? cause.message : 'No pudimos cargar los contactos.'); }
    finally { if (!signal.aborted) setLoading(false); }
  }, [tenantId, waba, preview]);
  useEffect(() => { const abort = new AbortController(); void load(abort.signal); return () => abort.abort(); }, [load, reload]);
  useEffect(() => {
    if (!canManageAccounts || preview) return;
    const abort = new AbortController();
    void trackingCall('taxi-bot-admin', { action: 'accounts', tenantId, waba }, abort.signal).then(result => {
      if (!abort.signal.aborted) { setAccounts(parseAccountOptions(result)); setPendingAccounts(parsePendingAccounts(result)); setAccountsError(''); }
    }).catch((cause: unknown) => { if (!abort.signal.aborted) setAccountsError(cause instanceof Error ? cause.message : 'No pudimos cargar los accesos.'); });
    return () => abort.abort();
  }, [canManageAccounts, preview, tenantId, waba, reload]);
  const edit = (id: string, mode: 'details' | 'access' = 'details') => {
    const contact = data?.contacts.find(item => item.id === id); if (!contact) return;
    setSelected(id); setDevice(contact.deviceId === null ? '' : String(contact.deviceId)); setUnitNumber(contact.unitNumber);
    setName(contact.name); setRole(contact.role); setPhone(splitChannelPhone(contact.phoneInput)); setReceiving(contact.receiving);
    setDirty(false); setNotice(''); setError('');
    setEditorMode(mode); setAccountChoice(contact.accountUserId ? String(contact.accountUserId) : ''); setEmail(''); setPassword('');
    setDiscard(false); setEditorOpen(true);
  };
  const requestClose = () => {
    if (locked) return;
    if (discard) { setDiscard(false); return; }
    if (dirty) { setDiscard(true); return; }
    setEditorOpen(false);
  };
  const save = async (command: Record<string, unknown>) => {
    if (preview) { setNotice('Vista de diseño: aquí no se guardan datos ni se envían mensajes.'); return; }
    setBusy(true); setPending(command); setError(''); setNotice('');
    try {
      const result = await trackingCall('taxi-bot-admin', command);
      if (!record(result) || result.state !== 'saved') throw new Error('No se confirmó el guardado. Comprueba la misma solicitud.');
      const saved = parseBaseContact(result.contact);
      setPending(null); setSavedId(saved.id); setDirty(false); setPassword('');
      setData(current => current ? { ...current, contacts: [...current.contacts.filter(person => person.id !== saved.id), saved] } : current);
      if (command.action === 'contact_save' && accessMode && canManageAccounts && !saved.accountUserId) {
        setSelected(saved.id); setEditorMode('access'); setAccountChoice(''); setEmail('');
      } else setEditorOpen(false);
      setNotice(command.action === 'account_save' ? 'Acceso vinculado a esta persona y su taxi. Ya puede entrar con su correo.' : saved.receiving ? 'Cambios guardados. Este conductor recibirá ofertas cuando la unidad esté disponible.' : 'Contacto guardado. No recibirá ofertas de viaje.');
      setReload(value => value + 1);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'No se confirmó el guardado.');
      if (cause instanceof TrackingClientError && cause.status >= 400 && cause.status < 500) setPending(null);
    } finally { setBusy(false); }
  };
  const query = search.trim().toLocaleLowerCase('es-MX');
  const changeReceiving=(next:boolean)=>{
    if(next&&!driving){
      const contact=data?.contacts.find(item=>item.id===selected);
      if(contact?.accountUserId){
        if(!canManageAccounts){setError('El administrador debe confirmar que esta persona conduce antes de activar ofertas.');return;}
        if(dirty&&editorMode==='details'){setError('Guarda primero los datos del contacto. Después podrás activar su acceso como conductor.');return;}
        setEditorMode('access');setAccountChoice(String(contact.accountUserId));
      }
      setRole(role==='owner'?'owner_driver':'driver');
    }
    setReceiving(next);setDirty(true);setError('');
  };
  const person = data?.contacts.find(contact => contact.id === selected);
  const visible = data?.contacts.filter(contact => (roleFilter === 'all' || contact.role === roleFilter) && `${contact.name} ${contact.unitNumber} ${contact.phoneInput} ${contactRoles.find(item => item.value === contact.role)?.label}`.toLocaleLowerCase('es-MX').includes(query)) ?? [];
  return <section className="taxi-config taxi-driver-setup" id="conductores-bot" aria-labelledby="taxi-driver-heading">
    <div className="taxi-section-heading"><div><h2 id="taxi-driver-heading"><Truck size={23} /> Conductores y dueños</h2>
      <p>Organiza los contactos de cada unidad y elige quién recibe los viajes.</p></div>
      <button className="taxi-secondary" disabled={locked || dirty || loading} onClick={() => setReload(value => value + 1)} aria-label="Actualizar contactos"><RefreshCw size={18} aria-hidden="true" className={loading ? 'taxi-contact-spinner' : undefined} /></button></div>
    {loading && <p role="status">Consultando contactos y unidades…</p>}
    {data && <>
      <p className="taxi-setup-status">{data.contacts.length} contactos · {data.units.length} {data.units.length === 1 ? 'unidad' : 'unidades'} con GPS · {data.activeCount} {data.activeCount === 1 ? 'conductor recibe' : 'conductores reciben'} ofertas.
        {' '}<button className="taxi-text-button" onClick={onZones} disabled={locked || dirty}>Ver zonas y tarifas</button></p>
      {canManageAccounts && <p className="taxi-contact-results">{preview ? 'Vista de accesos de prueba' : `${accounts.length} cuentas de Traccar disponibles. Vincula cada correo a su persona; no hace falta volver a darla de alta.`}</p>}
      {accountsError && <p className="taxi-error" role="alert">{accountsError}</p>}
      {pendingAccounts.map(operation => <div className="taxi-uncertain" key={operation.requestId}><p>Hay un acceso pendiente para {operation.command.email}. Completa la misma solicitud para evitar duplicados.</p><button type="button" className="taxi-secondary" disabled={locked || dirty} onClick={() => {
        edit(operation.command.contact, 'access');
        if (isContactRole(operation.command.assignment.role)) setRole(operation.command.assignment.role);
        setDevice(operation.command.assignment.deviceId === null ? '' : String(operation.command.assignment.deviceId)); setReceiving(operation.command.assignment.receiveOffers);
        setEmail(operation.command.email); setAccountChoice(operation.command.userId === null ? 'new' : String(operation.command.userId));
        if (operation.needsPassword) { setError('El acceso se reservó, pero falta crear la cuenta. Introduce de nuevo su contraseña inicial para completar esta solicitud.'); setAccountChoice('new'); }
        setPending({ action: 'account_save', tenantId, waba, contactId: operation.command.contact, expected: operation.command.expected, userId: operation.command.userId, email: operation.command.email, ...operation.command.assignment, password: '', requestId: operation.requestId });
      }}>Retomar alta</button></div>)}
      <div className="taxi-contact-toolbar"><label className="taxi-contact-search"><Search size={18} aria-hidden="true" /><span className="taxi-sr-only">Buscar contacto o número de unidad</span><input type="search" placeholder="Nombre, unidad o teléfono" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <label className="taxi-contact-filter"><span className="taxi-sr-only">Filtrar por rol</span><select value={roleFilter} onChange={event => { if (event.target.value === 'all' || isContactRole(event.target.value)) setRoleFilter(event.target.value); }}><option value="all">Todos los roles</option>{contactRoles.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        {canEdit && <button className="taxi-primary" disabled={locked || dirty || loading} onClick={() => { clear(); setNotice(''); setError(''); setDiscard(false); setEditorMode('details'); setAccountChoice(''); setEmail(''); setPassword(''); setEditorOpen(true); }}><Plus size={18} aria-hidden="true" /> Nueva persona</button>}</div>
      <p className="taxi-contact-results" role="status">{visible.length === data.contacts.length ? `${visible.length} contactos` : `${visible.length} de ${data.contacts.length} contactos`}</p>
      {visible.length ? <ul className="taxi-driver-list taxi-contact-list" aria-label="Contactos de la base" aria-busy={loading}>{visible.map(contact => <li key={contact.id} className={savedId === contact.id ? 'is-saved' : undefined}>
        <div className="taxi-contact-identity"><strong>{contact.name}</strong><span className={'taxi-contact-role' + (contact.role === 'pending' ? ' is-pending' : '')}>{contactRoles.find(item => item.value === contact.role)?.label}</span>
          <small>Unidad {contact.unitNumber} · {contact.phoneInput || 'Sin teléfono'}</small>
          {!contact.phone && <span className="taxi-contact-warning"><AlertCircle size={14} aria-hidden="true" /> Teléfono incompleto</span>}</div>
        <div className="taxi-contact-details"><small>{contact.deviceId === null ? 'Sin vincular a GPS' : `${data.units.find(unit => unit.id === contact.deviceId)?.name ?? 'GPS no visible en tu cuenta'} · GPS #${contact.deviceId}`}</small>
          <span className={'taxi-contact-offers' + (contact.receiving ? ' is-receiving' : '')}><i aria-hidden="true" />{contact.receiving ? 'Recibe ofertas' : 'Sin ofertas de viaje'}</span></div>
        {canEdit && <div className="taxi-contact-row-actions"><button className="taxi-secondary" disabled={locked || dirty || loading} onClick={() => edit(contact.id)} aria-label={`Editar ${contact.name}, unidad ${contact.unitNumber}`} aria-haspopup="dialog"><Pencil size={16} aria-hidden="true" /> Editar</button>
          {canManageAccounts && <button className="taxi-text-button" disabled={locked || dirty || loading || Boolean(accountsError)} onClick={() => edit(contact.id, 'access')} aria-haspopup="dialog"><KeyRound size={16} aria-hidden="true" />{contact.accountUserId ? 'Ver acceso' : 'Crear acceso'}</button>}
          {contact.accountUserId && <small>{accounts.find(user => user.id === contact.accountUserId)?.email ?? `Acceso #${contact.accountUserId}`}</small>}</div>}
      </li>)}</ul> : <p role="status">{query || roleFilter !== 'all' ? 'No hay contactos que coincidan con estos filtros.' : 'Todavía no hay contactos registrados.'}</p>}
    </>}
    {notice && !editorOpen && <p className="taxi-notice taxi-contact-feedback" role="status"><CheckCircle2 size={18} aria-hidden="true" />{notice}</p>}
    {error && !editorOpen && <p className="taxi-error" role="alert">{error}</p>}
    {canEdit && <dialog ref={dialog} className="taxi-contact-dialog" aria-labelledby={dialogId + '-title'} aria-describedby={dialogId + '-description'}
      onCancel={event => { event.preventDefault(); requestClose(); }}
      onClose={() => { setEditorOpen(false); setDiscard(false); }}
      onPointerDown={event => { backdropPress.current = event.target === event.currentTarget; }}
      onClick={event => { if (backdropPress.current && event.target === event.currentTarget) requestClose(); backdropPress.current = false; }}>
      {data && <form className="taxi-contact-editor" aria-busy={busy} onSubmit={event => {
        event.preventDefault();
        if (locked || discard || !dirty) return;
        if (editorMode === 'access') {
          if (!person || !accountChoice) { setError('Elige una cuenta existente o Crear cuenta con correo.'); return; }
          const existing = accounts.find(user => String(user.id) === accountChoice);
          const accountEmail = existing?.email.toLowerCase() ?? email.trim().toLowerCase();
          void save({ action: 'account_save', tenantId, waba, contactId: person.id, expected: person.version, userId: existing?.id ?? null,
            email: accountEmail, password: existing ? '' : password, role, deviceId: device ? Number(device) : null, receiveOffers: receiving,
            driverVersion: data.drivers.find(driver => driver.deviceId === Number(device))?.version ?? null, requestId: crypto.randomUUID() });
          return;
        }
        if (!unitNumber.trim() || !name.trim()) { setError('Escribe el número de unidad y el nombre del contacto.'); return; }
        if (receiving && (!driving || !completePhone || !device)) { setError('Para recibir ofertas, confirma que conduce, completa su WhatsApp y elige su GPS.'); return; }
        const prefix = channelCountries.find(country => country.id === phone.country)?.code ?? '';
        const phoneInput = completePhone ?? (phone.country === 'MX' ? phone.national : prefix + phone.national);
        void save({ action: 'contact_save', tenantId, waba, contactId: selected || crypto.randomUUID(), unitNumber: unitNumber.trim(), name: name.trim(),
          phoneInput, role, deviceId: device ? Number(device) : null, receiveOffers: receiving,
          expected: data.contacts.find(contact => contact.id === selected)?.version ?? null,
          driverVersion: data.drivers.find(driver => driver.deviceId === Number(device))?.version ?? null, requestId: crypto.randomUUID() });
      }}>
        <header className="taxi-contact-editor-header"><div><h2 id={dialogId + '-title'}>{editorMode === 'access' ? 'Acceso de ' + name : selected ? 'Editar contacto' : 'Nueva persona'}</h2>
          <p id={dialogId + '-description'}>{selected ? `Unidad ${data.contacts.find(contact => contact.id === selected)?.unitNumber ?? ''} · Actualiza sus datos y su acceso a los viajes.` : 'Registra a la persona y vincúlala a una unidad de la base.'}</p></div>
          <button type="button" className="taxi-contact-close" disabled={locked} onClick={requestClose} aria-label="Cerrar editor"><X size={22} aria-hidden="true" /></button></header>
        <div className="taxi-contact-editor-body">
          {preview && <p className="taxi-contact-preview">Vista de prueba. Aquí no se guardan cambios.</p>}
          {canManageAccounts && selected && <div className="taxi-contact-editor-tabs"><button type="button" className={editorMode === 'details' ? 'is-active' : ''} disabled={locked || dirty || discard} onClick={() => { setEditorMode('details'); setNotice(''); }}>Datos y taxi</button><button type="button" className={editorMode === 'access' ? 'is-active' : ''} disabled={locked || dirty || discard} onClick={() => { setEditorMode('access'); setAccountChoice(person?.accountUserId ? String(person.accountUserId) : ''); setNotice(''); }}>Correo y acceso</button></div>}
          {editorMode === 'access' ? <fieldset className="taxi-contact-fields" disabled={locked || discard}><legend>La misma persona, con su propio correo</legend>
            <p className="taxi-contact-access-help">{role === 'staff' ? 'El operador verá las unidades y la operación de Pompeyo.' : `Verá únicamente su taxi${device ? ' · GPS #' + device : ''}. El administrador controla las altas y asignaciones.`}</p>
            <div className="taxi-fields">
              <label>Rol del acceso<select value={role} onChange={event => { if (isContactRole(event.target.value)) { setRole(event.target.value); if (!['driver','owner_driver'].includes(event.target.value)) setReceiving(false); setDirty(true); } }}>{contactRoles.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label>Taxi asignado<select value={device} onChange={event => { setDevice(event.target.value); setDirty(true); }}><option value="">Elige su taxi</option>{data.units.map(unit => <option key={unit.id} value={unit.id}>{unit.name} · GPS #{unit.id}</option>)}</select></label>
              <label className="taxi-contact-gps">Cuenta de acceso<select value={accountChoice} disabled={Boolean(person?.accountUserId)} onChange={event => { setAccountChoice(event.target.value); setDirty(true); }}><option value="">Elige el correo existente o crea uno</option><option value="new">Crear cuenta con correo</option>{accounts.filter(user => !user.contactId || user.contactId === selected).map(user => <option key={user.id} value={user.id}>{user.name} · {user.email}</option>)}</select></label>
              {person?.accountUserId ? <p className="taxi-contact-access-help">Esta persona ya utiliza la cuenta #{person.accountUserId}. Puedes cambiar su rol y taxi sin crear otro usuario.</p> : accountChoice === 'new' ? <>
                <label className="taxi-contact-gps">Correo electrónico<input type="email" required autoComplete="off" value={email} onChange={event => { setEmail(event.target.value); setDirty(true); }} /></label>
                <label className="taxi-contact-gps">Contraseña inicial<input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={event => { setPassword(event.target.value); setDirty(true); }} /><small>Al menos 12 caracteres. No se guarda en el panel ni se envía por correo.</small></label>
              </> : accountChoice && <p className="taxi-contact-access-help">Se conservarán el correo y la contraseña existentes. La cuenta verá los taxis asignados aquí.</p>}
              <label className="taxi-enable taxi-contact-receiving"><input type="checkbox" role="switch" checked={receiving} onChange={event => changeReceiving(event.target.checked)} /><span>Recibe ofertas de viaje<small>{driving?'Se enviarán a su WhatsApp cuando la unidad esté disponible.':role==='owner'?'Al activarlo confirmas que también conduce; se guardará como Dueño y conductor.':'Al activarlo confirmas que conduce; se guardará con el rol Conductor.'}</small></span></label>
            </div>
          </fieldset> : <>
          <fieldset className="taxi-contact-fields" disabled={locked || discard}><legend>Datos del contacto</legend><div className="taxi-fields">
            <label className="taxi-contact-name">Nombre<input ref={nameInput} value={name} required maxLength={120} autoComplete="off" onChange={event => { setName(event.target.value); setDirty(true); }} /></label>
            <label>Número de unidad<input value={unitNumber} required maxLength={20} onChange={event => { setUnitNumber(event.target.value); setDirty(true); }} placeholder="Por ejemplo: 487" /></label>
            <label>¿Qué hace en la base?<select value={role} disabled={Boolean(person?.accountUserId)} onChange={event => { if (isContactRole(event.target.value)) { setRole(event.target.value); if (event.target.value !== 'driver' && event.target.value !== 'owner_driver') setReceiving(false); setDirty(true); } }}>{contactRoles.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>{person?.accountUserId && <small>Cambia el rol y taxi en Correo y acceso para mantenerlos sincronizados.</small>}</label>
            <TaxiPhoneField label="WhatsApp del contacto" value={phone} onChange={value => { setPhone(value); setDirty(true); }} help="Revisa el número antes de activar ofertas." />
          </div></fieldset>
          <fieldset className="taxi-contact-fields" disabled={locked || discard}><legend>Unidad y viajes</legend><div className="taxi-fields">
            <label className="taxi-contact-gps">Unidad GPS<select value={device} disabled={Boolean(person?.accountUserId)} onChange={event => { setDevice(event.target.value); setDirty(true); }}><option value="">Vincular después</option>{data.units.map(unit => <option key={unit.id} value={unit.id}>{unit.name} · GPS #{unit.id}</option>)}</select></label>
            <label className="taxi-enable taxi-contact-receiving"><input type="checkbox" role="switch" checked={receiving} onChange={event => changeReceiving(event.target.checked)} /><span>Recibe ofertas de viaje<small>{driving ? 'Necesita un WhatsApp completo y una unidad GPS vinculada.' : role==='owner'?'Al activarlo confirmas que también conduce; se guardará como Dueño y conductor.':'Al activarlo confirmas que conduce; se guardará con el rol Conductor.'}</small></span></label>
          </div></fieldset>
          </>}
          {notice && <p className="taxi-notice taxi-contact-feedback" role="status">{notice}</p>}
        </div>
        <footer className="taxi-contact-editor-footer">
          {pending?.action === 'account_save' && pendingAccounts.some(operation => operation.requestId === pending.requestId && operation.needsPassword) && <label>Contraseña inicial para completar el alta<input type="password" minLength={12} maxLength={128} autoComplete="new-password" value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></label>}
          {error && <p className="taxi-error" role="alert"><AlertCircle size={18} aria-hidden="true" />{error}</p>}
          {discard ? <div className="taxi-contact-discard" role="alert"><strong>Hay cambios sin guardar</strong><p>¿Quieres seguir editando o descartarlos?</p><div>
            <button type="button" className="taxi-secondary" onClick={() => setDiscard(false)} autoFocus>Seguir editando</button>
            <button type="button" className="taxi-contact-discard-button" onClick={() => { setDirty(false); setEditorOpen(false); setDiscard(false); setError(''); setNotice(''); }}>Descartar cambios</button></div></div>
          : <><p className="taxi-contact-save-hint" role="status">{busy ? 'Guardando contacto…' : pending ? 'El guardado necesita confirmación.' : dirty ? 'Cambios sin guardar' : 'Los cambios se guardan en esta base.'}</p><div className="taxi-contact-editor-actions">
            <button type="button" className="taxi-secondary" disabled={locked} onClick={requestClose}>Cancelar</button>
            {pending && !busy ? <button type="button" className="taxi-primary" onClick={() => void save(pending.action === 'account_save' && password ? { ...pending, password } : pending)}>Comprobar guardado</button> : <button className="taxi-primary" type="submit" disabled={locked || !dirty}>{busy ? <RefreshCw size={18} className="taxi-contact-spinner" aria-hidden="true" /> : <Save size={18} aria-hidden="true" />}{busy ? 'Guardando…' : editorMode === 'access' ? 'Guardar acceso' : accessMode && canManageAccounts ? 'Guardar y continuar' : 'Guardar contacto'}</button>}
          </div></>}
        </footer>
      </form>}
    </dialog>}
  </section>;
}
