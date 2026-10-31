import{useEffect,useId,useRef,useState}from 'react';
import{AlertCircle,CheckCircle2,Plus,RefreshCw,UserRound,X}from 'lucide-react';
import{taxiOwnerClient,type OwnerCommand,type OwnerRegistration}from '../lib/taxiOwnerClient';
import{TrackingClientError}from '../lib/trackingClient';
import{type OwnerContext}from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/ownerContracts.ts';
import{type BaseContact}from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contactAdmin.ts';
import{channelPhone,splitChannelPhone}from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/channelPhone.ts';
import TaxiPhoneField,{type TaxiPhoneValue}from './TaxiPhoneField';
export default function TaxiOwnerPanel({preview=false}:{preview?:boolean}){
 const [data,setData]=useState<OwnerContext|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reload,setReload]=useState(0),[busy,setBusy]=useState(false),[pending,setPending]=useState<OwnerCommand|null>(null);
 const [open,setOpen]=useState(false),[draft,setDraft]=useState<OwnerRegistration|null>(null),[phone,setPhone]=useState<TaxiPhoneValue>({country:'MX',national:''}),[discard,setDiscard]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null),nameRef=useRef<HTMLInputElement>(null),heading=useId();
 const dirty=useRef(false);
 useEffect(()=>{const abort=new AbortController();setError('');void(preview?Promise.resolve(ownerPreview()):taxiOwnerClient.read(abort.signal)).then(result=>{if(!abort.signal.aborted)setData(result);}).catch((e:unknown)=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'No pudimos consultar tu taxi.');});return()=>abort.abort();},[reload,preview]);
 useEffect(()=>{if(open&&!dialog.current?.open){dialog.current?.showModal();nameRef.current?.focus();}else if(!open)dialog.current?.close();},[open]);
 useEffect(()=>{if(!open&&!pending)return;const warn=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[open,pending]);
 const save=async(command:OwnerCommand)=>{
  if(busy)return;if(preview){setNotice('Vista de diseño: no guarda accesos ni turnos.');return;}
  setBusy(true);setPending(command);setError('');setNotice('');
  try{const result=await taxiOwnerClient.save(command);setData(result);setPending(null);setOpen(false);setDraft(null);setNotice(command.action==='owner_shift'?'Turno actualizado. Las nuevas ofertas usan el WhatsApp del chofer en turno.':'Acceso creado. El chofer ya puede entrar con su correo; elige Poner en turno cuando vaya a trabajar.');}
  catch(e:unknown){setError(e instanceof Error?e.message:'No se confirmó el guardado. Comprueba la misma solicitud.');if(e instanceof TrackingClientError&&e.status>=400&&e.status<500){setPending(null);try{setData(await taxiOwnerClient.read());}catch{setError(value=>value+' Tampoco pudimos actualizar el estado de tu taxi.');}}}
  finally{setBusy(false);}
 };
 const edit=(contact?:BaseContact)=>{
  if(!data)return;const reserved=data.pending.find(p=>p.contactId===contact?.id);
  if(reserved?.review){setError('Esta alta requiere revisión de la base. No se creará otra cuenta.');return;}
  setDraft({action:'owner_driver_save',requestId:reserved?.requestId??crypto.randomUUID(),contactId:contact?.id??crypto.randomUUID(),expected:reserved?reserved.expected:contact?.version??null,name:reserved?.name??contact?.name??'',phone:reserved?.phone??contact?.phoneInput??'',email:reserved?.email??'',password:''});
  setPhone(splitChannelPhone(reserved?.phone??contact?.phoneInput??''));dirty.current=false;setError('');setNotice('');setDiscard(false);setOpen(true);
 };
 const close=()=>{if(busy||pending)return;if(dirty.current)setDiscard(true);else{setOpen(false);setDraft(null);}};
 const locked=busy||Boolean(pending);
 const reservation=data?.pending.find(item=>item.requestId===draft?.requestId);
 return <section className="taxi-config taxi-owner" aria-labelledby={heading}>
  <header className="taxi-section-heading"><div><h2 id={heading}><UserRound size={23} aria-hidden="true"/>Choferes y turno de mi taxi</h2><p>Un solo chofer recibe las ofertas de esta unidad. Cada persona entra con su propio correo.</p></div><button type="button" className="taxi-secondary" disabled={locked||open} onClick={()=>setReload(v=>v+1)} aria-label="Actualizar mi taxi"><RefreshCw size={18}/></button></header>
  {preview&&<p className="taxi-demo">Vista local con datos de ejemplo. No crea cuentas ni cambia turnos.</p>}
  {!data&&!error&&<p role="status">Consultando tu taxi y sus choferes…</p>}
  {error&&!open&&<p className="taxi-error" role="alert"><AlertCircle size={18}/>{error}</p>}
  {notice&&!open&&<p className="taxi-notice" role="status"><CheckCircle2 size={18}/>{notice}</p>}
  {data&&<>
   <div className="taxi-owner-current"><div><h3>Unidad {data.owner.unitNumber}</h3><p>GPS #{data.deviceId}</p><strong>{data.driver?.active?'En turno: '+data.driver.name:'Sin chofer en turno'}</strong><p>{data.driver?.active?'Las ofertas llegan a '+data.driver.phone+'.':'Este taxi no recibirá ofertas hasta que pongas un chofer en turno.'}</p></div>
   {data.driver?.active&&<button type="button" className="taxi-secondary" disabled={locked||open||data.busy} onClick={()=>void save({action:'owner_shift',requestId:crypto.randomUUID(),contactId:null,expected:data.driver?.version??null})}>Terminar turno</button>}</div>
   {data.busy&&<p className="taxi-owner-busy" role="status">Hay un viaje u oferta pendiente. El turno podrá cambiar cuando termine.</p>}
   <div className="taxi-section-heading"><h3>Choferes de esta unidad</h3><button type="button" className="taxi-primary" disabled={locked||open||data.drivers.length>=20} onClick={()=>edit()}><Plus size={18}/>Agregar chofer</button></div>
   {data.drivers.length?<ul className="taxi-driver-list">{data.drivers.map(contact=><li key={contact.id}><div><strong>{contact.name}</strong><small>{contact.phone??'Falta WhatsApp'}</small><small>{contact.receiving?'En turno':contact.accountUserId?'Acceso con correo listo':'Falta completar su acceso'}</small></div>
    {contact.accountUserId&&!data.pending.some(p=>p.contactId===contact.id)?<button type="button" className="taxi-secondary" disabled={locked||open||data.busy||contact.receiving} onClick={()=>void save({action:'owner_shift',requestId:crypto.randomUUID(),contactId:contact.id,expected:data.driver?.version??null})}>{contact.receiving?'En turno':'Poner en turno'}</button>:<button type="button" className="taxi-secondary" disabled={locked||open} onClick={()=>edit(contact)}>Completar acceso</button>}
   </li>)}</ul>:<p className="taxi-empty-inline">Agrega al primer chofer con nombre, WhatsApp y correo.</p>}
   {pending&&!open&&<button type="button" className="taxi-primary" disabled={busy} onClick={()=>void save(pending)}>Comprobar el mismo cambio</button>}
  </>}
  <dialog className="taxi-contact-dialog" ref={dialog} aria-labelledby={heading+'-form'} onCancel={e=>{e.preventDefault();close();}}>
   {draft&&<form className="taxi-contact-editor" onSubmit={e=>{e.preventDefault();if(locked)return;const normalized=channelPhone(phone.country,phone.national);if(!normalized){setError('Completa el WhatsApp con su código de país.');return;}void save({...draft,name:draft.name.trim(),phone:normalized,email:draft.email.trim().toLowerCase()});}}>
    <header className="taxi-contact-editor-header"><div><h2 id={heading+'-form'}>Acceso del chofer</h2><p>Quedará vinculado a la unidad {data?.owner.unitNumber}. Tú eliges cuándo entra en turno.</p></div><button type="button" className="taxi-contact-close" disabled={locked} aria-label="Cerrar alta del chofer" onClick={close}><X size={22}/></button></header>
    <fieldset className="taxi-contact-editor-body taxi-owner-fields" disabled={locked||discard}>
     <label>Nombre completo<input ref={nameRef} value={draft.name} required maxLength={120} disabled={Boolean(reservation)} onChange={e=>{dirty.current=true;setDraft({...draft,name:e.target.value});}}/></label>
     <TaxiPhoneField label="WhatsApp del chofer" value={phone} onChange={value=>{dirty.current=true;setPhone(value);}} disabled={Boolean(reservation)} help="Las ofertas llegarán a este número cuando esté en turno."/>
     <label>Correo del chofer<input type="email" value={draft.email} required maxLength={254} disabled={Boolean(reservation?.email)} autoComplete="off" onChange={e=>{dirty.current=true;setDraft({...draft,email:e.target.value});}}/></label>
     <label>Contraseña inicial<input type="password" value={draft.password} required minLength={12} maxLength={128} autoComplete="new-password" onChange={e=>{dirty.current=true;setDraft({...draft,password:e.target.value});}}/><small>Al menos 12 caracteres. Si retomas una cuenta ya creada, conserva su contraseña original.</small></label>
    </fieldset>
    <footer className="taxi-contact-editor-footer">
     {error&&<p className="taxi-error" role="alert">{error}</p>}
     {notice&&<p className="taxi-notice" role="status">{notice}</p>}
     {discard?<div className="taxi-contact-discard"><p>¿Descartar los datos sin guardar?</p><button type="button" className="taxi-secondary" onClick={()=>setDiscard(false)}>Seguir editando</button><button type="button" className="taxi-secondary" onClick={()=>{setDraft(null);setOpen(false);setDiscard(false);}}>Descartar</button></div>:<div className="taxi-contact-editor-actions"><button type="button" className="taxi-secondary" disabled={locked} onClick={close}>Cancelar</button>{pending?<button type="button" className="taxi-primary" disabled={busy} onClick={()=>void save(pending)}>{busy?'Guardando…':'Comprobar alta'}</button>:<button className="taxi-primary" type="submit">Crear acceso del chofer</button>}</div>}
    </footer>
   </form>}
  </dialog>
 </section>;
}
function ownerPreview():OwnerContext{
 const owner:BaseContact={id:'11111111-1111-4111-8111-111111111111',unitNumber:'487',name:'Dueño de ejemplo',phoneInput:'9630000010',phone:'+529630000010',role:'owner',deviceId:7,receiving:false,version:'a'.repeat(32),accountUserId:10};
 const driver:BaseContact={...owner,id:'22222222-2222-4222-8222-222222222222',name:'Chofer de ejemplo',phoneInput:'9630000011',phone:'+529630000011',role:'driver',accountUserId:11,receiving:true};
 return{owner,tenantId:'33333333-3333-4333-8333-333333333333',waba:'+529630000001',deviceId:7,drivers:[driver,{...driver,id:'44444444-4444-4444-8444-444444444444',name:'Otro chofer de ejemplo',phone:'+529630000012',accountUserId:12,receiving:false}],driver:{deviceId:7,name:driver.name,phone:driver.phone??'',active:true,version:'a'.repeat(32)},busy:false,pending:[]};
}
