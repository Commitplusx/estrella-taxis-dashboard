import { coordinateTaxi, type TaxiServices } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/coordinator.ts';
import { emptyDraft, parseSession, type TaxiChannel, type TaxiInbound, type TaxiSession } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
import { createTaxiServices } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/services.ts';
import { neighborhoodKey, parseNeighborhoods, streetReference, type Neighborhood } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/neighborhoodContracts.ts';
import { exactNeighborhoods, representativeArea, semanticNeighborhoods } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/neighborhoods.ts';
import { neighborhoodRequest } from '../estrella-taxis-backend/supabase/functions/taxi-bot-admin/neighborhoods.ts';
import { cellToLatLng, latLngToCell } from 'h3-js';
import type { TrackingStore } from '../estrella-taxis-backend/supabase/functions/_shared/tracking/store.ts';
import type { Fetcher } from '../estrella-taxis-backend/supabase/functions/_shared/tracking/http.ts';
import { TaxiTurnTrace } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/trace.ts';
function assert(value:unknown,message='Assertion failed'):asserts value{if(!value)throw new Error(message);}
function equal(a:unknown,b:unknown){assert(JSON.stringify(a)===JSON.stringify(b),JSON.stringify(a)+' != '+JSON.stringify(b));}
async function rejects(fn:()=>unknown){let rejected=false;try{await fn();}catch{rejected=true;}assert(rejected);}
const now=Date.now(),cell=latLngToCell(16.25,-92.13,10),[lat,lng]=cellToLatLng(cell);
const row:Neighborhood={label:'El Piedrón',aliases:['Piedron'],description:'Junto a la cancha de prueba',cents:6500,minCents:6500,maxCents:6500,cells:[cell],version:'a'.repeat(32)};
const channel:TaxiChannel={tenantId:'11111111-1111-4111-8111-111111111111',waba:'+529630000001',enabled:true,name:'Base sintética',city:'Comitán',centerLat:16.25,centerLng:-92.13,radiusKm:20,dispatcher:null,model:'fixture',baseCents:null,perKmCents:null,pricingMode:'h3_zone_max'};
const session=():TaxiSession=>({revision:0,mode:'bot',active:null,history:[],draft:emptyDraft()});
const message=(text:string):TaxiInbound=>({id:crypto.randomUUID(),from:'+529630000002',to:channel.waba,at:new Date(now).toISOString(),type:'text',text,button:null,location:null});
const deny=async():Promise<never>=>{throw new Error('Undeclared provider or write');};
function store(rows:Neighborhood[]=[row]):TrackingStore{return{writePackages:deny,writeCompanyPackage:deny,writeCompanyStatus:deny,writeScores:deny,read:async(table)=>{equal(table,'lugares_frecuentes');return[];},rpc:async(name,args)=>{equal(name,'taxi_bot_neighborhood_read');equal(args.p_tenant,channel.tenantId);return rows;}};}
const config={mapsKey:'',modelKey:'',traccarUrl:'https://tracking.test',traccarEmail:'',traccarPassword:''};
const completion=(labels:unknown)=>({usage:{prompt_tokens:12,completion_tokens:6},choices:[{finish_reason:'tool_calls',message:{tool_calls:[{type:'function',function:{name:'elegir_colonias',arguments:JSON.stringify({labels})}}]}}]});
Deno.test('neighborhood names normalize articles, accents and repeated prefixes, not unrelated street names',()=>{
 equal(neighborhoodKey('Colonia El Piedrón'),'piedron');equal(exactNeighborhoods('el piedron',[row]),[row]);
 assert(!streetReference('El Piedron',row.label,row.aliases));assert(!streetReference('Sí, mándalo',row.label));assert(!streetReference('Por ahí',row.label));assert(!streetReference('Cerca de la iglesia\n\u0001 ignorado',row.label));
 assert(streetReference('Frente a la escuela, portón azul',row.label));assert(streetReference('Cerca de la iglesia',row.label));assert(streetReference('Por el Oxxo',row.label));
});
Deno.test('neighborhood semantic search uses only the selected base names, records usage and returns ambiguity without choosing',async()=>{
 const other={...row,label:'Las Brisas'},metadata:unknown[]=[];let count=0;
 const fetcher:Fetcher=async(_url,init)=>{count++;assert(!String(init?.body).includes(cell));return Response.json(completion([row.label,other.label]));};
 equal(await semanticNeighborhoods('por la cancha',[row,other],fetcher,'fixture-key','fixture',undefined,value=>metadata.push(value)),[row,other]);equal(count,1);equal(metadata.length,1);
});
for(const proposal of [['Colonia ajena'],[row.label,row.label],['A','B','C','D'],[{label:row.label}],null])Deno.test('neighborhood semantic search rejects malformed or invented labels: '+JSON.stringify(proposal),async()=>{
 await rejects(()=>semanticNeighborhoods('sitio',[row],async()=>Response.json(completion(proposal)),'fixture','fixture'));
});
Deno.test('neighborhood service: a name alone is never a door; written reference resolves as explicitly approximate without GPS',async()=>{
 const s=createTaxiServices(store(),deny,config),area=representativeArea(row);
 const first=await s.resolve('El Piedrón',channel);assert(first.kind==='ambiguous');equal(first.neighborhoods,[area]);
 const next=await s.resolve('Frente a la escuela, casa azul',channel,undefined,area);assert(next.kind==='resolved');assert(next.place.text.startsWith('Zona aproximada: '));equal(next.place.lat,lat);equal(next.place.area?.reference,'Frente a la escuela, casa azul');
 equal((await s.resolve('Piedron',channel,undefined,area)).kind,'ambiguous');
});
Deno.test('neighborhood service: mixed prices and road-distance approximation never invent a quoted fare',async()=>{
 const s=createTaxiServices(store(),deny,config),p={text:'Zona aproximada: El Piedrón. Calle Prueba 20',lat,lng,placeId:null,area:{...representativeArea(row),cents:null,reference:'Calle Prueba 20'}};
 equal(await s.quote(p,{text:'Destino',lat:16.26,lng:-92.14,placeId:null},channel),null);
 equal(await s.quote({...p,area:{...p.area,cents:6500}},{text:'Destino',lat:16.26,lng:-92.14,placeId:null},{...channel,pricingMode:'road_distance'}),null);
});
Deno.test('neighborhood service: a geocoded point outside the named H3 group is rejected as a reference conflict',async()=>{
 const otherCell=latLngToCell(16.251,-92.131,10);assert(!row.cells.includes(otherCell));const [otherLat,otherLng]=cellToLatLng(otherCell);
 const fetcher:Fetcher=async()=>Response.json({status:'OK',results:[{partial_match:false,geometry:{location_type:'ROOFTOP',location:{lat:otherLat,lng:otherLng}},formatted_address:'Calle 5, otra colonia',place_id:'fixture'}]});
 const s=createTaxiServices(store(),fetcher,{...config,mapsKey:'fixture'}),resolved=await s.resolve('Calle 5, El Piedrón',channel,undefined,representativeArea(row));
 equal(resolved,{kind:'reference_conflict',label:row.label});
});
Deno.test('neighborhood coordinator: asks street before name, summary, candidate lookup or dispatch; native pin can replace the zone',async()=>{
 const actual=createTaxiServices(store(),deny,config);let candidates=0;
 const services:TaxiServices={...actual,interpret:async current=>({intent:'provide',fields:{origin:{value:current,evidence:current}}}),candidates:async()=>{candidates++;return[];}};
 const first=await coordinateTaxi([message('El Piedrón')],session(),channel,services,now);equal(first.reason,'neighborhood_reference_required');equal(first.draft.origin,null);assert(first.draft.originArea);equal(candidates,0);equal(first.draft.confirmation,null);
 const state={...session(),draft:first.draft};
 const second=await coordinateTaxi([message('Frente a la escuela, casa azul')],state,channel,services,now);assert(second.draft.origin?.area);equal(second.draft.originArea,null);equal(second.reason,'missing_destination');equal(candidates,0);
 services.interpret=async()=>({intent:'provide',fields:{}});
 const pin=await coordinateTaxi([{...message(''),type:'location',location:{lat:16.251,lng:-92.131}}],state,channel,services,now);assert(pin.draft.origin);equal(pin.draft.origin.area,undefined);equal(pin.draft.originArea,null);
});
Deno.test('neighborhood coordinator: a street outside the chosen colony clears the unverified zone and asks for correction',async()=>{
 const area=representativeArea(row),s=session();s.draft={...emptyDraft(),originArea:area,awaitingLocation:'origin'};let candidates=0;
 const services:TaxiServices={interpret:async()=>({intent:'provide',fields:{origin:{value:'Calle 5, El Piedrón',evidence:'Calle 5, El Piedrón'}}}),resolve:async()=>({kind:'reference_conflict',label:row.label}),quote:deny,candidates:async()=>{candidates++;return[];}};
 const result=await coordinateTaxi([message('Calle 5, El Piedrón')],s,channel,services,now);
 equal(result.reason,'neighborhood_reference_conflict');equal(result.draft.origin,null);equal(result.draft.originArea,null);assert(result.messages[0].text.includes('no cae en El Piedrón'));equal(candidates,0);
});
Deno.test('neighborhood coordinator: a summary includes the reference and cannot reuse a changed area version',async()=>{
 const actual=createTaxiServices(store(),deny,config),area={...representativeArea(row),reference:'Frente a la escuela, casa azul'},s=session();
 s.draft={...emptyDraft(),name:'Mariana',origin:{text:'Zona aproximada: El Piedrón. '+area.reference,lat,lng,placeId:null,area},destination:{text:'Destino',lat:16.26,lng:-92.14,placeId:null},confirmation:crypto.randomUUID(),expiresAt:new Date(now+600000).toISOString()};
 let candidates=0;const services:TaxiServices={...actual,resolve:async()=>({kind:'resolved',place:{...s.draft.origin!,area:{...area,version:'b'.repeat(32)}}}),candidates:async()=>{candidates++;return[];}};
 const result=await coordinateTaxi([message('Sí, mándalo')],s,channel,services,now);equal(result.action,'draft');equal(result.reason,'neighborhood_changed');assert(result.draft.confirmation!==s.draft.confirmation);assert(result.messages[0].text.includes('Zona aproximada'));equal(candidates,0);
 await rejects(()=>parseSession({...s,draft:{...s.draft,originArea:representativeArea(row)}}));
});
Deno.test('neighborhood resolve trace includes semantic model usage without customer text in public trace fields',async()=>{
 const s=session(),trace=new TaxiTurnTrace(s,now),services:TaxiServices={interpret:deny,quote:deny,candidates:deny,resolve:async(_text,_c,_signal,_area,observe)=>{observe?.({inputTokens:12,outputTokens:5,responseHash:'a'.repeat(64)});return {kind:'ambiguous',labels:[row.label],neighborhoods:[representativeArea(row)]};}};
 await trace.services(services).resolve('por la cancha',channel);equal(trace.packet().steps[0].model?.inputTokens,12);assert(!JSON.stringify(trace.packet().steps).includes('por la cancha'));
});
Deno.test('neighborhood administration reads existing H3 without mutation and rejects non-admin save before RPC',async()=>{
 const args={action:'neighborhoods',tenantId:channel.tenantId,waba:channel.waba};const data=await neighborhoodRequest(args,channel.tenantId,42,false,store(),'fixture','',deny,new AbortController().signal);assert(typeof data==='object');
 await rejects(()=>neighborhoodRequest({...args,action:'neighborhood_save',requestId:crypto.randomUUID(),label:row.label,expected:row.version,payload:{}},channel.tenantId,42,false,store(),'fixture','',deny,new AbortController().signal));
 equal(parseNeighborhoods([row]).length,1);await rejects(()=>parseNeighborhoods([{...row,cells:['not-h3']} ]));
});
