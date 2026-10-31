import{FleetApi,type FleetIdentity}from '../_shared/tracking/auth.ts';
import type{TrackingStore}from '../_shared/tracking/store.ts';
import{record,TrackingError,uuid}from '../_shared/tracking/contracts.ts';
import{parseContactId,parseBaseContact}from '../_shared/bot/taxis/contactAdmin.ts';
import{parseOwnerContext,type OwnerContext}from '../_shared/bot/taxis/ownerContracts.ts';
import{exact}from '../_shared/bot/taxis/adminContracts.ts';
import{accountRequest}from './accounts.ts';
export type AccountManager=(signal:AbortSignal)=>Promise<FleetIdentity>;
const messages:Record<string,string>={driver_busy:'El taxi tiene un viaje u oferta pendiente. Finalízalo antes de cambiar el turno.',driver_access_required:'Primero crea el acceso con correo del chofer.',revision_conflict:'Cambió el turno o el contacto. Actualiza antes de guardar.',driver_changed:'Cambió el chofer de la unidad. Actualiza antes de guardar.',phone_conflict:'Ese WhatsApp ya está registrado. Usa el contacto existente o pide a la base que lo vincule.',contact_forbidden:'Ese chofer no pertenece a tu taxi.',request_conflict:'La solicitud ya se usó con otros datos. Actualiza y vuelve a intentarlo.',driver_limit:'Este taxi llegó al límite de 20 choferes registrados.',account_details_locked:'Para corregir los datos de un acceso existente, pide ayuda a la base.'};
function saved(value:unknown):Record<string,unknown>{if(!record(value)||typeof value.state!=='string')throw new TrackingError(503,'owner_write_unconfirmed','No se confirmó el cambio. Comprueba la misma solicitud.');if(value.state!=='saved')throw new TrackingError(409,value.state,messages[value.state]??'No se confirmó el cambio. Actualiza tu taxi.');return value;}
export async function ownerRequest(raw:Record<string,unknown>,identity:FleetIdentity,fleet:FleetApi,store:TrackingStore,manager:AccountManager|undefined,signal:AbortSignal):Promise<OwnerContext>{
 exact(raw,raw.action==='owner_context'?['action']:raw.action==='owner_shift'?['action','requestId','contactId','expected']:['action','requestId','contactId','expected','name','phone','email','password']);
 const context=parseOwnerContext(await store.rpc('taxi_owner_read',{p_user:identity.userId}));
 const visible=await fleet.get('/devices',identity.cookie,signal);
 if(!Array.isArray(visible)||visible.length>10000||!visible.some(d=>record(d)&&d.id===context.deviceId))throw new TrackingError(403,'owner_device_forbidden','Tu taxi ya no está vinculado a esta cuenta. Pide ayuda a la base.');
 if(raw.action==='owner_context')return context;
 const requestId=uuid(raw.requestId),expected=raw.expected;
 if(!(expected===null||typeof expected==='string'&&/^[a-f0-9]{32}$/.test(expected)))throw new TrackingError(400,'invalid_revision','Actualiza tu taxi antes de guardar.');
 if(raw.action==='owner_shift'){
  const contactId=raw.contactId===null?null:parseContactId(raw.contactId),target=context.drivers.find(d=>d.id===contactId);
  if(contactId!==null){
   if(!target?.accountUserId)throw new TrackingError(409,'driver_access_required',messages.driver_access_required);
   if(!manager)throw new TrackingError(503,'account_manager_unavailable','La base debe configurar el servicio de accesos.');
   const admin=await manager(signal);if(!admin.admin)throw new TrackingError(503,'account_manager_unavailable','La base debe revisar el servicio de accesos.');
   const account=await fleet.get('/users/'+target.accountUserId,admin.cookie,signal);
   if(!record(account)||account.id!==target.accountUserId||account.disabled!==false||account.administrator!==false)throw new TrackingError(409,'driver_access_disabled','El acceso del chofer está deshabilitado. Pide a la base que lo revise.');
  }
  saved(await store.rpc('taxi_owner_shift_apply',{p_user:identity.userId,p_request:requestId,p_contact:contactId,p_expected:expected}));
 }else if(raw.action==='owner_driver_save'){
  if(typeof raw.email!=='string'||raw.email!==raw.email.trim().toLowerCase()||raw.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.email)||typeof raw.password!=='string'||raw.password.length<12||raw.password.length>128||typeof raw.name!=='string'||!raw.name.trim()||raw.name.length>120||typeof raw.phone!=='string'||!/^\+(?:52(?:1)?\d{10}|1\d{10}|502\d{8})$/.test(raw.phone))throw new TrackingError(400,'invalid_owner_driver','Revisa nombre, WhatsApp, correo y contraseña de al menos 12 caracteres.');
  const contactId=parseContactId(raw.contactId);
  if(!manager)throw new TrackingError(503,'account_manager_unavailable','La base debe configurar el servicio de accesos.');
  const admin=await manager(signal);if(!admin.admin)throw new TrackingError(503,'account_manager_unavailable','La base debe revisar el servicio de accesos.');
  const result=saved(await store.rpc('taxi_owner_contact_save',{p_user:identity.userId,p_request:requestId,p_contact:contactId,p_expected:expected,p_name:raw.name.trim(),p_phone:raw.phone}));
  const contact=parseBaseContact(result.contact);
  if(!(result.driverVersion===null||typeof result.driverVersion==='string'&&/^[a-f0-9]{32}$/.test(result.driverVersion)))throw new TrackingError(503,'owner_write_unconfirmed','No se confirmó la reserva del acceso. Comprueba la misma solicitud.');
  await accountRequest({action:'account_save',tenantId:context.tenantId,waba:context.waba,contactId,expected:contact.version,userId:contact.accountUserId??null,email:raw.email,password:contact.accountUserId?'':raw.password,requestId,role:'driver',deviceId:context.deviceId,receiveOffers:false,driverVersion:result.driverVersion},context.tenantId,context.waba,admin,fleet,store,signal,{actor:identity.userId,contactId,deviceId:context.deviceId});
 }else throw new TrackingError(400,'invalid_owner_action','Esa operación no está disponible.');
 return parseOwnerContext(await store.rpc('taxi_owner_read',{p_user:identity.userId}));
}
