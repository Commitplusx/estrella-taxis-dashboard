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
const row:Neighborhood={label:'El Piedrón',category:'barrio',aliases:['Piedron'],description:'Junto a la cancha de prueba',cents:6500,minCents:6500,maxCents:6500,cells:[],version:'a'.repeat(32),priceSource:'reference'};
const channel:TaxiChannel={tenantId:'11111111-1111-4111-8111-111111111111',waba:'+529630000001',enabled:true,name:'Base sintética',city:'Comitán',centerLat:16.25,centerLng:-92.13,radiusKm:20,dispatcher:null,model:'fixture',baseCents:null,perKmCents:null,pricingMode:'h3_zone_max'};
const session=():TaxiSession=>({revision:0,mode:'bot',active:null,history:[],draft:emptyDraft()});
const message=(text:string):TaxiInbound=>({id:crypto.randomUUID(),from:'+529630000002',to:channel.waba,at:new Date(now).toISOString(),type:'text',text,button:null,location:null});
const deny=async():Promise<never>=>{throw new Error('Undeclared provider or write');};
function store(rows:Neighborhood[]=[row]):TrackingStore{return{writePackages:deny,writeCompanyPackage:deny,writeCompanyStatus:deny,writeScores:deny,read:async(table)=>{equal(table,'lugares_frecuentes');return[];},rpc:async(name,args)=>{equal(name,'taxi_bot_neighborhood_read');equal(args.p_tenant,channel.tenantId);return rows;}};}
const config={mapsKey:'',modelKey:'',traccarUrl:'https://tracking.test',traccarEmail:'',traccarPassword:''};
const completion=(localities:unknown)=>({usage:{prompt_tokens:12,completion_tokens:6},choices:[{finish_reason:'tool_calls',message:{tool_calls:[{type:'function',function:{name:'elegir_colonias',arguments:JSON.stringify({localities})}}]}}]});
Deno.test('written locality rows have a category and never include H3 cells',()=>{
 equal(neighborhoodKey('Colonia El Piedrón'),'piedron');equal(exactNeighborhoods('el piedron',[row]),[row]);
 const parsed=parseNeighborhoods([row]);equal(parsed[0].category,'barrio');equal(parsed[0].cells,[]);equal(parsed[0].priceSource,'reference');
 const invalid:unknown={...row,cells:[cell]};let rejected=false;try{parseNeighborhoods([invalid]);}catch{rejected=true;}assert(rejected);
 assert(!streetReference('El Piedron',row.label,row.aliases));assert(!streetReference('Sí, mándalo',row.label));assert(!streetReference('Por ahí',row.label));assert(!streetReference('Cerca de la iglesia\n\u0001 ignorado',row.label));
 assert(streetReference('Frente a la escuela, portón azul',row.label));assert(streetReference('Cerca de la iglesia',row.label));assert(streetReference('Por el Oxxo',row.label));
});
Deno.test('same written name in different PDF categories stays disambiguated',()=>{
 const motel:Neighborhood={...row,label:'Pinos',category:'colonia',cents:5500,minCents:5500,maxCents:5500,version:'b'.repeat(32)};
 const other:Neighborhood={...row,label:'Los Pinos',category:'motel',cents:8000,minCents:8000,maxCents:8000,version:'c'.repeat(32)};
 const matches=exactNeighborhoods('Los Pinos',[motel,other]);equal(matches.length,2);assert(matches.some(value=>value.category==='colonia'));assert(matches.some(value=>value.category==='motel'));
 assert(representativeArea(matches[0]).category!==representativeArea(matches[1]).category);
});
Deno.test('neighborhood semantic search uses only category and label pairs from the selected base',async()=>{
 const other={...row,label:'Las Brisas',category:'colonia' as const},metadata:unknown[]=[];let count=0;
 const fetcher:Fetcher=async(_url,init)=>{count++;assert(!String(init?.body).includes(cell));return Response.json(completion([{label:row.label,category:row.category},{label:other.label,category:other.category}]));};
 equal(await semanticNeighborhoods('por la cancha',[row,other],fetcher,'fixture-key','fixture',undefined,value=>metadata.push(value)),[row,other]);equal(count,1);equal(metadata.length,1);
});
for(const proposal of [[{label:'Colonia ajena',category:'barrio'}],[{label:row.label,category:'colonia'}],[{label:row.label,category:'barrio'},{label:row.label,category:'barrio'}],[{label:'A',category:'barrio'},{label:'B',category:'barrio'},{label:'C',category:'barrio'},{label:'D',category:'barrio'}],null])Deno.test('locality semantic search rejects malformed or invented category/label pairs: '+JSON.stringify(proposal),async()=>{
 await rejects(()=>semanticNeighborhoods('sitio',[row],async()=>Response.json(completion(proposal)),'fixture','fixture'));
});
Deno.test('a locality name alone is never a pickup door or an invented map center',async()=>{
 const s=createTaxiServices(store(),deny,config),area=representativeArea(row);
 const first=await s.resolve('El Piedrón',channel);assert(first.kind==='ambiguous');equal(first.neighborhoods,[area]);assert(first.neighborhoods?.[0].cell===null);
 const noGeocoder=await s.resolve('Frente a la escuela, casa azul',channel,undefined,area);equal(noGeocoder.kind,'unavailable');
});
Deno.test('typed locality geocodes for navigation and carries its written fare independently of H3 prices',async()=>{
 const locality:Neighborhood={label:'La Esmeralda',category:'colonia',aliases:[],description:'',cents:5500,minCents:5500,maxCents:5500,cells:[],version:'c'.repeat(32),priceSource:'reference'};
 const fetcher:Fetcher=async input=>{const url=new URL(String(input));assert(url.searchParams.get('address')?.includes('Calle Norte número 20'));return Response.json({status:'OK',results:[{partial_match:false,geometry:{location_type:'ROOFTOP',location:{lat,lng}},formatted_address:'Calle Norte 20, La Esmeralda',place_id:'fixture-place'}]});};
 const service=createTaxiServices(store([locality]),fetcher,{...config,mapsKey:'fixture'});
  const start=await service.resolve('La Esmeralda',channel);if(start.kind!=='ambiguous'||!start.neighborhoods)throw new Error('Expected the locality to ask for its street.');equal(start.neighborhoods,[representativeArea(locality)]);
  const area=start.neighborhoods[0];if(!area)throw new Error('Expected one locality choice.');const resolved=await service.resolve('Calle Norte número 20',channel,undefined,area);assert(resolved.kind==='resolved');equal(resolved.place.source,'locality');equal(resolved.place.area?.priceSource,'reference');equal(resolved.place.area?.category,'colonia');equal(resolved.place.area?.cents,5500);equal(resolved.place.area?.cell,cell);equal(resolved.place.text,'Calle Norte 20, La Esmeralda');
 let checked=false;const base=store([locality]),rpcStore:TrackingStore={...base,rpc:async(name,args)=>{if(name==='taxi_bot_neighborhood_read')return[locality];equal(name,'taxi_bot_h3_quote_with_references');equal(args.p_origin_reference,resolved.place.area);equal(args.p_destination_reference,null);checked=true;return{state:'priced',mode:'h3_zone_max',cents:5500,originCell:cell,destinationCell:latLngToCell(16.26,-92.14,10)};}};
 const destination={text:'Pin GPS',lat:16.26,lng:-92.14,placeId:null,source:'gps' as const};equal(await createTaxiServices(rpcStore,fetcher,{...config,mapsKey:'fixture'}).quote(resolved.place,destination,channel),5500);assert(checked);
});
Deno.test('a written address without a registered locality never falls through to an H3 GPS fare',async()=>{
 const fetcher:Fetcher=async()=>Response.json({status:'OK',results:[{partial_match:false,geometry:{location_type:'ROOFTOP',location:{lat,lng}},formatted_address:'Calle 5, Comitán',place_id:'fixture'}]});
 const s=createTaxiServices(store(),fetcher,{...config,mapsKey:'fixture'}),resolved=await s.resolve('Calle 5 número 10',channel);assert(resolved.kind==='resolved');equal(resolved.place.source,'written');
 equal(await s.quote(resolved.place,{text:'Pin GPS',lat:16.26,lng:-92.14,placeId:null,source:'gps'},channel),null);
});
Deno.test('unpriced conflicting PDF locality cannot make a fare',async()=>{
 const unresolved:Neighborhood={...row,label:'Rosario Castellanos',category:'fraccionamiento',description:'El PDF muestra $80 y $90; falta definir.',cents:null,minCents:null,maxCents:null,version:'d'.repeat(32)};
 const service=createTaxiServices(store([unresolved]),deny,config),place={text:'Calle Norte 20, Rosario Castellanos',lat,lng,placeId:null,source:'locality' as const,area:{...representativeArea(unresolved),cell,reference:'Calle Norte 20'}};
 equal(await service.quote(place,{text:'Pin GPS',lat:16.26,lng:-92.14,placeId:null,source:'gps'},channel),null);
});
Deno.test('locality fare requires a known tariff and GPS fares remain H3-only',async()=>{
 let h3Calls=0;const base=store(),rpcStore:TrackingStore={...base,rpc:async(name,args)=>{if(name==='taxi_bot_neighborhood_read')return[row];h3Calls++;equal(name,'taxi_bot_h3_quote');return{state:'priced',mode:'h3_zone_max',cents:7200,originCell:args.p_origin,destinationCell:args.p_destination};}};
 const services=createTaxiServices(rpcStore,deny,config),gps={text:'Pin GPS',lat,lng,placeId:null,source:'gps' as const};
 equal(await services.quote(gps,{...gps,lat:16.26,lng:-92.14},channel),7200);equal(h3Calls,1);
 const written={...gps,source:'written' as const};equal(await services.quote(written,{...gps,lat:16.26,lng:-92.14},channel),null);equal(h3Calls,1);
});
Deno.test('neighborhood coordinator asks street before quote or dispatch and lets a native pin replace the text zone',async()=>{
 const actual=createTaxiServices(store(),deny,config);let candidates=0;
 const services:TaxiServices={...actual,interpret:async current=>({intent:'provide',fields:{origin:{value:current,evidence:current}}}),candidates:async()=>{candidates++;return[];}};
 const first=await coordinateTaxi([message('El Piedrón')],session(),channel,services,now);equal(first.reason,'neighborhood_reference_required');equal(first.draft.origin,null);assert(first.draft.originArea);equal(candidates,0);equal(first.draft.confirmation,null);
 const state={...session(),draft:first.draft};services.interpret=async()=>({intent:'provide',fields:{}});
 const pin=await coordinateTaxi([{...message(''),type:'location',location:{lat:16.251,lng:-92.131}}],state,channel,services,now);assert(pin.draft.origin);equal(pin.draft.origin.source,'gps');equal(pin.draft.origin.area,undefined);equal(pin.draft.originArea,null);
});
Deno.test('a selected locality retains its category and tariff revision through a quote review',async()=>{
 const locality={...representativeArea(row),reference:'Frente a la escuela, casa azul'},s=session();
 const typed={text:'Calle Principal, El Piedrón. '+locality.reference,lat,lng,placeId:null,source:'locality' as const,area:{...locality,cell,reference:locality.reference}};
 s.draft={...emptyDraft(),name:'Mariana',origin:typed,destination:{text:'Destino',lat:16.26,lng:-92.14,placeId:null,source:'gps'},confirmation:crypto.randomUUID(),expiresAt:new Date(now+600000).toISOString()};
 let candidates=0;const actual=createTaxiServices(store(),deny,config),services:TaxiServices={...actual,resolve:async()=>({kind:'resolved',place:{...typed,area:{...typed.area,version:'b'.repeat(32)}}}),candidates:async()=>{candidates++;return[];}};
 const result=await coordinateTaxi([message('Sí, mándalo')],s,channel,services,now);equal(result.action,'draft');equal(result.reason,'neighborhood_changed');assert(result.draft.confirmation!==s.draft.confirmation);equal(candidates,0);
 await rejects(()=>parseSession({...s,draft:{...s.draft,originArea:representativeArea(row)}}));
});
Deno.test('neighborhood trace records semantic usage without customer text',async()=>{
 const s=session(),trace=new TaxiTurnTrace(s,now),services:TaxiServices={interpret:deny,quote:deny,candidates:deny,resolve:async(_text,_c,_signal,_area,observe)=>{observe?.({inputTokens:12,outputTokens:5,responseHash:'a'.repeat(64)});return {kind:'ambiguous',labels:[row.label],neighborhoods:[representativeArea(row)]};}};
 await trace.services(services).resolve('por la cancha',channel);equal(trace.packet().steps[0].model?.inputTokens,12);assert(!JSON.stringify(trace.packet().steps).includes('por la cancha'));
});
Deno.test('locality administration denies writes to non-admins before attempting the database',async()=>{
 const args={action:'neighborhoods',tenantId:channel.tenantId,waba:channel.waba};const data=await neighborhoodRequest(args,channel.tenantId,42,false,store(),'fixture','',deny,new AbortController().signal);assert(typeof data==='object');
 await rejects(()=>neighborhoodRequest({...args,action:'neighborhood_create',requestId:crypto.randomUUID(),payload:{}},channel.tenantId,42,false,store(),'fixture','',deny,new AbortController().signal));
});
