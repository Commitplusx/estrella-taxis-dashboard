import{record,positiveId,uuid,TrackingError}from '../../tracking/contracts.ts';
import{parseBaseContact,parseContactId,type BaseContact}from './contactAdmin.ts';
import{parseBotDriver,type BotDriver}from './driverAdmin.ts';
import{phone}from './contracts.ts';
export interface OwnerPending{requestId:string;contactId:string;expected:string|null;name:string;phone:string;email:string|null;review:boolean}
export interface OwnerContext{owner:BaseContact;tenantId:string;waba:string;deviceId:number;drivers:BaseContact[];driver:BotDriver|null;busy:boolean;pending:OwnerPending[]}
export function parseOwnerContext(raw:unknown):OwnerContext{
 if(!record(raw)||!positiveId(raw.deviceId)||!phone(raw.waba)||typeof raw.busy!=='boolean'||!Array.isArray(raw.drivers)||raw.drivers.length>20||!Array.isArray(raw.pending)||raw.pending.length>20)throw new TrackingError(502,'invalid_owner_context','No pudimos comprobar tu taxi y sus choferes. Pide a la base que revise tu acceso.');
 const owner=parseBaseContact(raw.owner),drivers=raw.drivers.map(parseBaseContact),driver=raw.driver===null?null:parseBotDriver(raw.driver);
 if(!['owner','owner_driver'].includes(owner.role)||owner.deviceId!==raw.deviceId||driver&&driver.deviceId!==raw.deviceId||drivers.some(d=>d.deviceId!==raw.deviceId||!['driver','owner_driver'].includes(d.role))||new Set(drivers.map(d=>d.id)).size!==drivers.length)throw new TrackingError(502,'invalid_owner_scope','Los datos no corresponden a tu taxi.');
 const pending=raw.pending.map((p):OwnerPending=>{if(!record(p)||!(p.expected===null||typeof p.expected==='string'&&/^[a-f0-9]{32}$/.test(p.expected))||typeof p.name!=='string'||!p.name.trim()||p.name.length>120||typeof p.phone!=='string'||p.phone.length>40||!(p.email===null||typeof p.email==='string'&&p.email.length<=254)||!(p.review===null||typeof p.review==='boolean'))throw new TrackingError(502,'invalid_owner_pending','No pudimos comprobar los accesos pendientes.');return{requestId:uuid(p.requestId),contactId:parseContactId(p.contactId),expected:p.expected,name:p.name,phone:p.phone,email:p.email,review:p.review===true};});
 if(new Set(pending.map(p=>p.requestId)).size!==pending.length||pending.some(p=>!drivers.some(d=>d.id===p.contactId)))throw new TrackingError(502,'invalid_owner_pending','Hay un acceso pendiente que no corresponde a tu taxi.');
 return{owner,tenantId:uuid(raw.tenantId),waba:String(raw.waba),deviceId:raw.deviceId,drivers,driver,busy:raw.busy,pending};
}
