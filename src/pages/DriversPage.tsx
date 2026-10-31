import { useState, useEffect, useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import TaxiDriversPanel from '../components/TaxiDriversPanel';
import TaxiOwnerPanel from '../components/TaxiOwnerPanel';
import { taxiAdminClient } from '../lib/taxiAdminClient';
import { createTaxiAdminPreview } from '../lib/taxiAdminPreview';
import { trackingCall } from '../lib/trackingClient';
import { record } from '../../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts';
import { contactRoles, parseBaseContact, type BaseContact } from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contactAdmin.ts';
import type { AdminContext } from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/adminContracts.ts';
import './taxiBotAdmin.css';
/** The sidebar and WhatsApp settings share the same base contacts and editor. */
export default function DriversPage({ preview = false, accessMode = false }: { preview?: boolean; accessMode?: boolean }) {
  const { empresaId,user } = useAuth();
  if(preview&&new URLSearchParams(window.location.search).get('vista')==='dueno')return <main className="taxi-admin taxi-people-page"><TaxiOwnerPanel preview/></main>;
  return <BaseContactsDirectory key={(empresaId ?? 'administrator')+'|'+user?.id} preferredBase={empresaId ?? null} preview={preview} accessMode={accessMode} />;
}

function BaseContactsDirectory({ preferredBase, preview, accessMode }: { preferredBase: string | null; preview: boolean; accessMode: boolean }) {
  const client = useMemo(() => preview ? createTaxiAdminPreview() : taxiAdminClient, [preview]);
  const [context, setContext] = useState<AdminContext | null>(null);
  const [tenantId, setTenantId] = useState(''), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [locked, setLocked] = useState(false), [reload, setReload] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setError(''); setContext(null);
    void client.context(abort.signal).then(result => {
      if (abort.signal.aborted) return;
      const requested = new URLSearchParams(window.location.search).get('base') ?? preferredBase;
      if (requested && !result.tenants.some(base => base.id === requested)) throw new Error('Tu cuenta no tiene acceso a esa base.');
      setTenantId(requested ?? result.tenants[0]?.id ?? '');
      setContext(result);
    }).catch((cause: unknown) => {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'No pudimos consultar los contactos de tu base.');
    }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [preferredBase, reload, client]);
  const channel = context?.channels.find(item => item.tenantId === tenantId);
  const baseName = context?.tenants.find(base => base.id === tenantId)?.name;
  const settingsUrl = '/taxi-bot' + (tenantId ? '?base=' + encodeURIComponent(tenantId) : '') + '#configuracion';
  if (context?.accessRole) return <PersonalTaxiProfile baseName={baseName ?? 'Pompeyo'} owner={['owner','owner_driver'].includes(context.accessRole)}/>;
  return <main className="taxi-admin taxi-people-page">
    {preview && <p className="taxi-demo">Vista local con contactos de prueba. No guarda cambios ni envía mensajes.</p>}
    <header className="taxi-admin-header"><div><h1>Conductores y dueños</h1><p>Las personas de tu base, sus unidades y quién recibe los viajes.</p></div>
      {context && <a className="taxi-secondary" href={settingsUrl}>Configurar WhatsApp <ArrowRight size={17} aria-hidden="true" /></a>}</header>
    {loading && <p role="status">Consultando tu base…</p>}
    {error && <div className="taxi-error" role="alert"><span>{error}</span><button className="taxi-text-button" onClick={() => setReload(value => value + 1)}>Reintentar</button></div>}
    {context && <>
      {context.tenants.length > 0 ? <div className="taxi-people-base"><label>Base<select value={tenantId} disabled={locked} onChange={event => { setTenantId(event.target.value); }}>{context.tenants.map(base => <option key={base.id} value={base.id}>{base.name}</option>)}</select></label>
        <p>Estos contactos son de {baseName}. Son los mismos que aparecen en la configuración de WhatsApp.</p></div>
        : <p className="taxi-error">Tu cuenta necesita una base asignada para consultar sus contactos.</p>}
      {channel ? <TaxiDriversPanel key={tenantId + '|' + channel.waba} tenantId={tenantId} waba={channel.waba} canEdit={context.canConfigure} canManageAccounts={preview || context.canManageAccounts === true} accessMode={accessMode} preview={preview} disabled={false}
        onZones={() => { window.location.assign('/zonas-tarifas?base=' + encodeURIComponent(tenantId)); }} onLockChange={setLocked} />
        : tenantId && <div className="taxi-config"><h2>Falta configurar el WhatsApp de esta base</h2><p>Guarda su canal para administrar los contactos y vincular sus unidades.</p><a className="taxi-text-button" href={settingsUrl}>Ir a configuración <ArrowRight size={17} aria-hidden="true" /></a></div>}
      <p className="taxi-people-help">El administrador vincula el correo a la persona y su taxi. Los viajes llegan al WhatsApp del conductor que tenga activadas las ofertas de esa unidad.</p>
    </>}
  </main>;
}

function PersonalTaxiProfile({ baseName,owner }: { baseName: string;owner:boolean }) {
  const { user } = useAuth();
  const [person, setPerson] = useState<BaseContact | null>(null), [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    void trackingCall('taxi-bot-admin', { action: 'account_self' }, abort.signal).then(result => {
      if (!record(result)) throw new Error('Tu acceso no tiene una persona vinculada. Pide al administrador que lo revise.');
      const contact = parseBaseContact(result.contact);
      if (!abort.signal.aborted) setPerson(contact);
    }).catch((cause: unknown) => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'No pudimos consultar tu perfil.'); });
    return () => abort.abort();
  }, []);
  return <main className="taxi-admin taxi-people-page"><header className="taxi-admin-header"><div><h1>Mi taxi y mi acceso</h1><p>{baseName}</p></div><a className="taxi-secondary" href="/map">Ver mi taxi en el mapa <ArrowRight size={18} aria-hidden="true" /></a></header>
    {error && <p className="taxi-error" role="alert">{error}</p>}
    {!person && !error && <p role="status">Consultando tu acceso…</p>}
    {owner&&<TaxiOwnerPanel/>}
    {person && <section className="taxi-config"><h2>{person.name}</h2><dl className="taxi-personal-facts"><div><dt>Correo de acceso</dt><dd>{user?.email}</dd></div><div><dt>Rol</dt><dd>{contactRoles.find(role => role.value === person.role)?.label}</dd></div><div><dt>Unidad</dt><dd>{person.unitNumber} · GPS #{person.deviceId}</dd></div><div><dt>WhatsApp</dt><dd>{person.phone ?? 'Pendiente de completar'}</dd></div><div><dt>Ofertas de viaje</dt><dd>{person.receiving ? 'Llegan a tu WhatsApp cuando la unidad está disponible' : 'No recibes ofertas de viaje'}</dd></div></dl><p>{owner?'Elige al chofer y su turno arriba. Para cambiar el taxi asignado o tus datos, pide ayuda a la base.':'Para cambiar el taxi o tus datos, solicita el cambio al administrador de la base.'}</p></section>}
  </main>;
}
