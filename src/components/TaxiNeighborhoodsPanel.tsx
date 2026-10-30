import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, Pencil, Plus, RefreshCw, Save, Search, X } from 'lucide-react';
import { trackingCall, TrackingClientError } from '../lib/trackingClient';
import { record } from '../../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts';
import { isLocalityCategory, LOCALITY_CATEGORIES, LOCALITY_CATEGORY_LABELS, neighborhoodKey, parseNeighborhood, parseNeighborhoods, type LocalityCategory, type Neighborhood } from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/neighborhoodContracts.ts';

const previewRows:Neighborhood[]=[
 {label:'Centro',category:'colonia',aliases:['Centro de Comitán'],description:'',cents:5500,minCents:5500,maxCents:5500,cells:[],version:'1'.repeat(32),priceSource:'reference'},
 {label:'El Piedrón',category:'barrio',aliases:['Piedron'],description:'Junto a la cancha',cents:5500,minCents:5500,maxCents:5500,cells:[],version:'2'.repeat(32),priceSource:'reference'},
 {label:'Las Brisas',category:'colonia',aliases:[],description:'',cents:6500,minCents:6500,maxCents:6500,cells:[],version:'3'.repeat(32),priceSource:'reference'},
];
const money=(cents:number)=>'$'+(cents/100).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});
const blankLocality:Neighborhood={label:'',category:'colonia',aliases:[],description:'',cents:null,minCents:null,maxCents:null,cells:[],version:'0'.repeat(32),priceSource:'reference'};

export default function TaxiNeighborhoodsPanel({tenantId,waba,canEdit,preview,disabled,onLockChange,onSaved}:{tenantId:string;waba:string;canEdit:boolean;preview:boolean;disabled:boolean;onLockChange:(locked:boolean)=>void;onSaved:()=>void}){
 const [rows,setRows]=useState<Neighborhood[]>(()=>preview?previewRows:[]),[loadedKey,setLoadedKey]=useState<string|null>(preview?'preview':null),[reload,setReload]=useState(0),[query,setQuery]=useState(''),[categoryFilter,setCategoryFilter]=useState<'all'|LocalityCategory>('all');
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[searchBusy,setSearchBusy]=useState(false),[matches,setMatches]=useState<Neighborhood[]|null>(null);
 const [selected,setSelected]=useState<Neighborhood|null>(null),[creating,setCreating]=useState(false),[label,setLabel]=useState(''),[category,setCategory]=useState<LocalityCategory>('colonia'),[aliases,setAliases]=useState(''),[description,setDescription]=useState(''),[price,setPrice]=useState('');
 const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[discard,setDiscard]=useState(false),[pending,setPending]=useState<Record<string,unknown>|null>(null);
 const [editorError,setEditorError]=useState('');const dialog=useRef<HTMLDialogElement>(null),first=useRef<HTMLInputElement>(null),heading=useId();
 const locked=disabled||busy||Boolean(pending);
 const requestKey=useMemo(()=>`${tenantId}|${waba}|${reload}`,[tenantId,waba,reload]),loading=!preview&&loadedKey!==requestKey;
 useEffect(()=>{onLockChange(Boolean(selected)||creating||busy||Boolean(pending)||searchBusy);return()=>onLockChange(false);},[selected,creating,busy,pending,searchBusy,onLockChange]);
 useEffect(()=>{if((selected||creating)&&dialog.current&&!dialog.current.open){dialog.current.showModal();first.current?.focus();}else if(!selected&&!creating&&dialog.current?.open)dialog.current.close();},[selected,creating]);
 useEffect(()=>{if(!dirty&&!pending&&!busy)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty,pending,busy]);
 useEffect(()=>{const abort=new AbortController();
  if(preview)return()=>abort.abort();
  void trackingCall('taxi-bot-admin',{action:'neighborhoods',tenantId,waba},abort.signal).then(value=>{if(!record(value))throw new Error('No pudimos comprobar las localidades.');const data=parseNeighborhoods(value.neighborhoods);if(!abort.signal.aborted)setRows(data);}).catch((cause:unknown)=>{if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:'No pudimos cargar las localidades.');}).finally(()=>{if(!abort.signal.aborted)setLoadedKey(requestKey);});return()=>abort.abort();
 },[tenantId,waba,preview,requestKey]);
 const normalizedQuery=neighborhoodKey(query);
 const local=rows.filter(row=>neighborhoodKey([row.label,...row.aliases,row.description].join(' ')).includes(normalizedQuery));
 const baseRows=matches??local;
 const visible=baseRows.filter(row=>categoryFilter==='all'||row.category===categoryFilter);
 const groups=LOCALITY_CATEGORIES.map(value=>({category:value,rows:visible.filter(row=>row.category===value)})).filter(group=>group.rows.length>0);
 const close=()=>{if(locked)return;if(dirty&&!discard){setDiscard(true);return;}setSelected(null);setCreating(false);setDirty(false);setDiscard(false);setPending(null);setEditorError('');};
 const edit=(row:Neighborhood)=>{setSelected(row);setCreating(false);setLabel(row.label);setCategory(row.category);setAliases(row.aliases.join(', '));setDescription(row.description);setPrice(row.cents===null?'':String(row.cents/100));setDirty(false);setDiscard(false);setPending(null);setEditorError('');setNotice('');};
 const add=()=>{setSelected(blankLocality);setCreating(true);setLabel('');setCategory('colonia');setAliases('');setDescription('');setPrice('');setDirty(true);setDiscard(false);setPending(null);setEditorError('');setNotice('');};
 const search=async()=>{
  if(query.trim().length<2||searchBusy||disabled)return;setSearchBusy(true);setError('');setNotice('');
  try{
   if(preview){setMatches(local);setNotice('Vista de prueba. La búsqueda por significado está disponible en la base activa.');return;}
   const result=await trackingCall('taxi-bot-admin',{action:'neighborhood_search',tenantId,waba,query:query.trim()});if(!record(result))throw new Error('No pudimos comprobar la búsqueda.');
   setMatches(parseNeighborhoods(result.neighborhoods));setNotice(result.method==='semantic'?'Coincidencias por significado y nombres registrados.':'Coincidencia por nombre o nombre alternativo.');
  }catch(cause:unknown){setError(cause instanceof Error?cause.message:'No pudimos buscar la localidad.');}finally{setSearchBusy(false);}
 };
 const save=async(command:Record<string,unknown>)=>{
  setBusy(true);setPending(command);setEditorError('');
  try{
   const result=await trackingCall('taxi-bot-admin',command);if(!record(result)||result.state!=='saved')throw new Error('No se confirmó el cambio.');const row=parseNeighborhood(result.neighborhood);
   if(!record(command.payload)||row.label!==command.payload.label||row.category!==command.payload.category||row.cents!==command.payload.cents)throw new Error('No se confirmaron los mismos datos.');
   setRows(old=>creating?[...old,row]:old.map(item=>item.label===selected?.label&&item.category===selected.category?row:item));setMatches(null);setPending(null);setSelected(null);setCreating(false);setDirty(false);setNotice('Localidad guardada. El bot usará esta tarifa cuando el cliente escriba esa zona.');onSaved();
  }catch(cause:unknown){if(cause instanceof TrackingClientError&&cause.status>=400&&cause.status<500)setPending(null);setEditorError(cause instanceof Error?cause.message:'No se confirmó el guardado. Comprueba la misma solicitud.');}finally{setBusy(false);}
 };
 const submit=(event:React.FormEvent<HTMLFormElement>)=>{
  event.preventDefault();if(!canEdit||locked||!dirty||!selected)return;
  if(preview){setEditorError('Vista de prueba. Aquí no se guardan cambios.');return;}
  const cents=price.trim()===''?null:Math.round(Number(price)*100),names=aliases.split(',').map(value=>value.trim()).filter(Boolean);
  if(!label.trim()||label.trim().length>100||price.trim()===''||!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(price)||cents===null||cents<=0||cents>10000000||names.length>12||names.some(name=>name.length>100)){
   setEditorError('Escribe el nombre y una tarifa válida; puedes agregar hasta 12 nombres alternativos.');return;
  }
  const payload={label:label.trim(),category,aliases:names,description:description.trim(),cents};
  const command:Record<string,unknown>=creating
   ?{action:'neighborhood_create',tenantId,waba,requestId:crypto.randomUUID(),payload}
   :{action:'neighborhood_save',tenantId,waba,requestId:crypto.randomUUID(),label:selected.label,category:selected.category,expected:selected.version,payload};
  void save(command);
 };
 return <section className="taxi-neighborhoods" aria-labelledby="taxi-neighborhoods-title">
  <header className="taxi-neighborhoods-heading"><div><h2 id="taxi-neighborhoods-title">Colonias y lugares escritos</h2><p>Tarifas para cuando el cliente indica su zona con palabras.</p></div><div className="taxi-neighborhood-heading-actions"><button className="taxi-secondary" disabled={loading||locked||searchBusy} onClick={()=>{setError('');setNotice('');setMatches(null);setReload(value=>value+1);}}><RefreshCw size={18}/>Actualizar</button>{canEdit&&<button className="taxi-primary" disabled={loading||locked||searchBusy} onClick={add}><Plus size={18}/>Agregar localidad</button>}</div></header>
  <p className="taxi-neighborhood-separation"><strong>Dirección escrita</strong> usa esta lista. Los pines GPS se cotizan aparte en <strong>Zonas y tarifas</strong>, con hexágonos H3.</p>
  {preview&&<p className="taxi-contact-preview">Vista de prueba. Los nombres y precios son ilustrativos.</p>}
  <form className="taxi-neighborhood-search" onSubmit={event=>{event.preventDefault();void search();}}><label><Search size={18} aria-hidden="true"/><span className="sr-only">Buscar barrio, colonia o lugar</span><input value={query} maxLength={300} disabled={searchBusy||locked} placeholder="Busca por barrio, colonia o lugar…" onChange={event=>{setQuery(event.target.value);setMatches(null);setNotice('');}}/></label><button type="submit" className="taxi-primary" disabled={query.trim().length<2||searchBusy||locked}>{searchBusy?'Buscando…':'Buscar'}</button></form>
  <p className="taxi-neighborhood-help">Si alguien sólo escribe el nombre de la zona, el bot pide calle o referencia antes de solicitar el taxi. Compartir el pin es opcional.</p>
  {error&&<p className="taxi-error" role="alert"><AlertCircle size={18}/>{error}</p>}{notice&&<p className="taxi-notice" role="status"><Check size={18}/>{notice}</p>}
  <nav className="taxi-locality-filters" aria-label="Filtrar por tipo de localidad"><button type="button" className={categoryFilter==='all'?'is-active':''} aria-pressed={categoryFilter==='all'} onClick={()=>setCategoryFilter('all')}>Todas <span>{rows.length}</span></button>{LOCALITY_CATEGORIES.map(value=><button type="button" key={value} className={categoryFilter===value?'is-active':''} aria-pressed={categoryFilter===value} onClick={()=>setCategoryFilter(value)}>{LOCALITY_CATEGORY_LABELS[value]} <span>{rows.filter(row=>row.category===value).length}</span></button>)}</nav>
  <div className="taxi-neighborhood-caption"><span aria-live="polite">{loading?'Cargando localidades…':`${visible.length} de ${rows.length} localidades escritas`}</span></div>
  {!loading&&!error&&visible.length===0&&<div className="taxi-empty"><h3>{rows.length?'No encontramos esa localidad':'Todavía no hay tarifas escritas'}</h3><p>{rows.length?'Prueba otro nombre o cambia el tipo de lugar.':'Agrega un barrio, colonia o punto para que el bot pueda buscar su tarifa.'}</p></div>}
  {groups.map(group=><section className="taxi-locality-group" key={group.category} aria-labelledby={`locality-group-${group.category}`}><header><h3 id={`locality-group-${group.category}`}>{LOCALITY_CATEGORY_LABELS[group.category]}</h3><span>{group.rows.length}</span></header><ul className="taxi-neighborhood-list">{group.rows.map(row=><li key={`${row.category}|${row.label}`}><div><h4>{row.label}</h4>{row.aliases.length>0&&<p>También le dicen: {row.aliases.join(', ')}</p>}{row.description&&<p>{row.description}</p>}{row.cents===null&&<small className="taxi-locality-review">Tarifa por revisar antes de cotizar</small>}</div><strong>{row.cents===null?'Revisar tarifa':money(row.cents)}</strong>{canEdit&&<div className="taxi-neighborhood-actions"><button className="taxi-secondary" disabled={locked||searchBusy} onClick={()=>edit(row)} aria-label={`Editar ${row.label} en ${LOCALITY_CATEGORY_LABELS[row.category].toLocaleLowerCase('es-MX')}`}><Pencil size={17}/>Editar</button></div>}</li>)}</ul></section>)}
  <dialog ref={dialog} className="taxi-contact-dialog" aria-labelledby={heading} onCancel={event=>{event.preventDefault();close();}}>{selected&&(selected||creating)&&<form className="taxi-contact-editor" onSubmit={submit}>
   <header className="taxi-contact-editor-header"><div><h2 id={heading}>{creating?'Agregar localidad':'Editar localidad'}</h2><p>La tarifa se guarda para esta base y aplica a direcciones escritas. No modifica el mapa H3.</p></div><button className="taxi-contact-close" type="button" onClick={close} disabled={locked} aria-label="Cerrar editor"><X size={22}/></button></header>
   <div className="taxi-contact-editor-body"><fieldset className="taxi-contact-fields" disabled={locked||discard}><div className="taxi-fields"><label>Nombre<input ref={first} value={label} maxLength={100} required onChange={event=>{setLabel(event.target.value);setDirty(true);}}/></label><label>Tipo de lugar<select value={category} onChange={event=>{if(isLocalityCategory(event.target.value)){setCategory(event.target.value);setDirty(true);}}}>{LOCALITY_CATEGORIES.map(value=><option key={value} value={value}>{LOCALITY_CATEGORY_LABELS[value]}</option>)}</select></label><label>Tarifa, MXN<input value={price} inputMode="decimal" placeholder="Ej. 55.00" required onChange={event=>{setPrice(event.target.value);setDirty(true);}}/></label><label className="taxi-neighborhood-wide">Nombres alternativos<input value={aliases} maxLength={1212} placeholder="Por ejemplo: Fovissste, Fovisste" onChange={event=>{setAliases(event.target.value);setDirty(true);}}/><small>Hasta 12 nombres, separados por comas.</small></label><label className="taxi-neighborhood-wide">Nota para identificar el lugar<textarea value={description} rows={4} maxLength={500} placeholder="Una referencia útil o una aclaración sobre la tarifa…" onChange={event=>{setDescription(event.target.value);setDirty(true);}}/></label></div></fieldset></div>
   <footer className="taxi-contact-editor-footer">{editorError&&<p className="taxi-error" role="alert"><AlertCircle size={18}/>{editorError}</p>}{discard?<div className="taxi-contact-discard"><strong>Hay cambios sin guardar</strong><div><button type="button" className="taxi-secondary" onClick={()=>setDiscard(false)}>Seguir editando</button><button type="button" className="taxi-contact-discard-button" onClick={()=>{setDirty(false);setSelected(null);setCreating(false);setDiscard(false);}}>Descartar cambios</button></div></div>:<><p className="taxi-contact-save-hint" role="status">{busy?'Guardando…':pending?'Falta confirmar este guardado.':dirty?'Cambios sin guardar':'Los datos se guardan para esta base.'}</p><div className="taxi-contact-editor-actions"><button type="button" className="taxi-secondary" disabled={locked} onClick={close}>Cancelar</button>{pending&&!busy?<button type="button" className="taxi-primary" onClick={()=>void save(pending)}>Comprobar guardado</button>:<button type="submit" className="taxi-primary" disabled={locked||!dirty}><Save size={18}/>{busy?'Guardando…':creating?'Agregar localidad':'Guardar localidad'}</button>}</div></>}</footer>
  </form>}</dialog>
 </section>;
}
