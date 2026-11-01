import {coord,phone,record,text,type Place}from './contracts.ts';
import {positiveId,uuid}from '../../tracking/contracts.ts';
export interface DispatchClaim{tripId:string;tenantId:string;waba:string;lease:string;origin:Place;excluded:number[]}
export interface DispatchHealth{paused:boolean;failures:number;code:string|null;pausedUntil:string|null;revision:number}
export interface DispatchJob{tripId:string;name:string;customer:string;state:'waiting'|'leased'|'attention';round:number;scans:number;code:string|null;nextAt:string;deadlineAt:string;updatedAt:string}
export interface DispatchStatus{asOf:string;health:DispatchHealth;jobs:DispatchJob[]}
const integer=(v:unknown,max:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=max;
const date=(v:unknown):v is string=>typeof v==='string'&&v.length<=64&&Number.isFinite(Date.parse(v));
const code=(v:unknown):v is string|null=>v===null||typeof v==='string'&&/^[a-z0-9_]{1,80}$/.test(v);
export function parseDispatchClaims(value:unknown):DispatchClaim[]{
 if(!Array.isArray(value)||value.length>2)throw Error('invalid_dispatch_claim');
 const result=value.map((v):DispatchClaim=>{
  if(!record(v)||!phone(v.waba)||!record(v.origin)||!coord(v.origin.lat,v.origin.lng)||typeof v.origin.lng!=='number'||!text(v.origin.text,900)||v.origin.source!=='gps'||!Array.isArray(v.excluded)||v.excluded.length>18||!v.excluded.every(positiveId))throw Error('invalid_dispatch_claim');
  const excluded:number[]=v.excluded;if(new Set(excluded).size!==excluded.length)throw Error('invalid_dispatch_claim');
  return{tripId:uuid(v.tripId),tenantId:uuid(v.tenantId),waba:String(v.waba),lease:uuid(v.lease),origin:{text:String(v.origin.text),lat:v.origin.lat,lng:v.origin.lng,placeId:null,source:'gps'},excluded};
 });
 if(new Set(result.map(v=>v.tripId)).size!==result.length)throw Error('duplicate_dispatch_claim');return result;
}
export function parseDispatchStatus(value:unknown):DispatchStatus{
 if(!record(value)||!date(value.asOf)||!record(value.health)||!Array.isArray(value.jobs)||value.jobs.length>50)throw Error('No pudimos comprobar la asignación. Actualiza la consulta.');
 const h=value.health;
 if(typeof h.paused!=='boolean'||!integer(h.failures,3)||!code(h.code)||h.pausedUntil!==null&&!date(h.pausedUntil)||!integer(h.revision,Number.MAX_SAFE_INTEGER))throw Error('El estado de los avisos no es válido.');
 const jobs=value.jobs.map((v):DispatchJob=>{
  if(!record(v)||!text(v.name,80)||!phone(v.customer)||!integer(v.round,4)||!integer(v.scans,12)||!code(v.code)||!date(v.nextAt)||!date(v.deadlineAt)||!date(v.updatedAt))throw Error('La búsqueda guardada no es válida.');
  const state=v.state;if(state!=='waiting'&&state!=='leased'&&state!=='attention')throw Error('La búsqueda guardada no es válida.');
  return{tripId:uuid(v.tripId),name:String(v.name),customer:String(v.customer),state,round:v.round,scans:v.scans,code:v.code,nextAt:v.nextAt,deadlineAt:v.deadlineAt,updatedAt:v.updatedAt};
 });
 if(new Set(jobs.map(j=>j.tripId)).size!==jobs.length)throw Error('La consulta repitió un viaje.');
 return{asOf:value.asOf,health:{paused:h.paused,failures:h.failures,code:h.code,pausedUntil:h.pausedUntil,revision:h.revision},jobs};
}
