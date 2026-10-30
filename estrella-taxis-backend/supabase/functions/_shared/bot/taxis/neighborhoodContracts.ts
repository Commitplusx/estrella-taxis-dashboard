import { record, TrackingError } from '../../tracking/contracts.ts';
import { taxiH3Cell } from './h3.ts';
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u001f]/.test(v);
export interface Neighborhood {
 label:string;aliases:string[];description:string;cents:number|null;minCents:number|null;maxCents:number|null;
 cells:string[];version:string;priceSource:'h3'|'reference';
}
export interface NeighborhoodArea {label:string;version:string;cents:number|null;cell:string|null;priceSource:'h3'|'reference';reference?:string}
export function neighborhoodKey(value:string):string{return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim().replace(/^(?:(?:el|la|los|las|colonia|col|barrio)\s+)+/,'');}
export function streetReference(value:string,label:string,aliases:string[]=[]):boolean{
 const key=neighborhoodKey(value);
 const vague=new Set(['si','si claro','va','sale','ok','okay','gracias','ahi','por ahi','aqui','por aqui','mandalo','de acuerdo','listo','adelante']);
 return value.length>=6&&value.length<=260&&key.length>=6&&!vague.has(key)&&![label,...aliases].some(v=>neighborhoodKey(v)===key)&&
  /\b(calle|avenida|av|privada|carretera|numero|num|frente|junto|cerca|lado|esquina|atras|detras|costado|sobre|pasando|casa|local|tienda|farmacia|escuela|iglesia|parque|puerta|porton|entrada|salida|entre|oxxo|mercado|cancha|plaza|hospital|clinica)\b/.test(key)&&!/[<>\u0000-\u001f]|https?:/i.test(value);
}
export function parseNeighborhood(raw:unknown):Neighborhood{
 const amount=(v:unknown):v is number|null=>v===null||typeof v==='number'&&Number.isSafeInteger(v)&&v>0&&v<=10000000;
 const priceSource=record(raw)&&raw.priceSource===undefined?'h3':record(raw)?raw.priceSource:null;
 if(!record(raw)||!text(raw.label,100)||!Array.isArray(raw.aliases)||raw.aliases.length>12||!raw.aliases.every(v=>text(v,100))||typeof raw.description!=='string'||raw.description.length>500||!Array.isArray(raw.cells)||raw.cells.length>5000||!raw.cells.every(taxiH3Cell)||new Set(raw.cells).size!==raw.cells.length||typeof raw.version!=='string'||!/^[a-f0-9]{32}$/.test(raw.version)||!amount(raw.cents)||!amount(raw.minCents)||!amount(raw.maxCents)||(raw.minCents===null)!==(raw.maxCents===null)||raw.minCents!==null&&raw.maxCents!==null&&raw.maxCents<raw.minCents||!(raw.cents===null||raw.cents===raw.minCents&&raw.cents===raw.maxCents)||(priceSource!=='h3'&&priceSource!=='reference')||(raw.cells.length===0&&(priceSource!=='reference'||raw.cents===null||raw.cents!==raw.minCents||raw.cents!==raw.maxCents))||(raw.cells.length>0&&priceSource!=='h3'))throw new TrackingError(502,'invalid_neighborhood','No pudimos comprobar los datos de la colonia.');
 return{label:String(raw.label),aliases:raw.aliases.map(String),description:raw.description,cells:raw.cells.map(String),cents:raw.cents,minCents:raw.minCents,maxCents:raw.maxCents,version:raw.version,priceSource};
}
export function parseNeighborhoods(raw:unknown):Neighborhood[]{
 if(!Array.isArray(raw)||raw.length>250)throw new TrackingError(502,'invalid_neighborhoods','No pudimos cargar las colonias de la base.');
 const rows=raw.map(parseNeighborhood);if(new Set(rows.map(r=>r.label)).size!==rows.length)throw new TrackingError(502,'invalid_neighborhoods','La lista contiene colonias repetidas.');return rows;
}
export function parseNeighborhoodArea(raw:unknown):NeighborhoodArea|null{
 if(raw===null||raw===undefined)return null;
 const priceSource=record(raw)&&raw.priceSource===undefined?'h3':record(raw)?raw.priceSource:null;
 if(!record(raw)||!text(raw.label,100)||typeof raw.version!=='string'||!/^[a-f0-9]{32}$/.test(raw.version)||!(raw.cell===null||taxiH3Cell(raw.cell))||!(raw.cents===null||typeof raw.cents==='number'&&Number.isSafeInteger(raw.cents)&&raw.cents>0&&raw.cents<=10000000)||(priceSource!=='h3'&&priceSource!=='reference')||(raw.cell===null&&raw.priceSource==='h3')||(raw.priceSource==='reference'&&raw.cents===null)||(raw.reference!==undefined&&(!text(raw.reference,260)||!streetReference(raw.reference,raw.label))))throw new TrackingError(502,'invalid_neighborhood_area','La colonia guardada no es válida.');
 return{label:String(raw.label),version:raw.version,cents:raw.cents,cell:raw.cell,priceSource,...(typeof raw.reference==='string'?{reference:raw.reference}:{})};
}
