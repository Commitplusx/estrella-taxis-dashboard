import{parsePhotonAddress,resolveOsmAddress}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/addressGeocoder.ts';
import{createTaxiServices}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/services.ts';
import type{TrackingStore}from'../estrella-taxis-backend/supabase/functions/_shared/tracking/store.ts';
import type{TaxiChannel}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
import{record}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
const channel:TaxiChannel={tenantId:'11111111-1111-4111-8111-111111111111',waba:'+529630000001',enabled:true,name:'Base sintética',city:'Comitán',centerLat:16.25,centerLng:-92.13,radiusKm:20,dispatcher:null,model:'fixture',baseCents:null,perKmCents:null,pricingMode:'h3_zone_max'};
function assert(v:unknown):asserts v{if(!v)throw new Error('Assertion failed');}
function feature(properties:Record<string,unknown>={},coordinates=[-92.13,16.25]){return{type:'Feature',geometry:{type:'Point',coordinates},properties:{countrycode:'MX',street:'Calle Primera',housenumber:'20',osm_id:1,osm_type:'N',...properties}};}
const collection=(features:unknown[])=>({type:'FeatureCollection',features});
const address='Calle Primera número 20';
Deno.test('OSM address: accepts one exact numbered house or named POI, never a street centroid',()=>{
 assert(parsePhotonAddress(collection([feature()]),address).kind==='resolved');
 assert(parsePhotonAddress(collection([feature({name:'Hospital de Prueba',housenumber:null,osm_key:'amenity'})]),'Hospital de Prueba').kind==='resolved');
 for(const item of[feature({housenumber:null}),feature({housenumber:'21'}),feature({countrycode:'GT'}),feature({street:'Calle Segunda'})])assert(parsePhotonAddress(collection([item]),address).kind!=='resolved');
 assert(parsePhotonAddress(collection([feature()]),'Calle Primera').kind!=='resolved');
});
Deno.test('OSM address: multiple places and a precise point beside a vague result ask for clarification',()=>{
 assert(parsePhotonAddress(collection([feature(),feature({},[-92.14,16.26])]),address).kind==='ambiguous');
 assert(parsePhotonAddress(collection([feature(),feature({housenumber:null})]),address).kind==='ambiguous');
});
const deny=async():Promise<never>=>{throw new Error('Undeclared write');};
function fixture(state='fetch'){
 let reads=0;const calls:{name:string;args:Record<string,unknown>}[]=[];
 const store:TrackingStore={writePackages:deny,writeCompanyPackage:deny,writeCompanyStatus:deny,writeScores:deny,read:async()=>{reads++;return[];},rpc:async(name,args)=>{assert(name==='taxi_bot_address_lookup');assert(args.p_tenant===channel.tenantId);calls.push({name,args});return args.p_lease?{state:'saved'}:{state,lease:'22222222-2222-4222-8222-222222222222',result:{kind:'unavailable'}};}};
 return{store,calls,reads:()=>reads};
}
Deno.test('OSM address: scoped durable claim precedes one bounded provider request and caches the parsed result',async()=>{
 const f=fixture();let fetches=0;
 const result=await resolveOsmAddress(address,channel,f.store,async(input,init)=>{fetches++;const u=new URL(String(input));assert(u.origin==='https://photon.komoot.io');assert(u.searchParams.get('countrycode')==='MX');assert(u.searchParams.get('limit')==='5');assert(u.searchParams.has('bbox'));assert(!u.searchParams.has('lang'));assert(Boolean(new Headers(init?.headers).get('User-Agent')));return Response.json(collection([feature()]));},'https://photon.komoot.io/api/');
 assert(result.kind==='resolved');assert(fetches===1&&f.calls.length===2);assert(record(f.calls[1].args.p_result)&&f.calls[1].args.p_result.kind==='resolved');
});
for(const state of['cached','limited','busy'])Deno.test('OSM address: '+state+' never makes an extra external request',async()=>{
 const f=fixture(state);const r=await resolveOsmAddress(address,channel,f.store,deny,'https://photon.komoot.io/api/');assert(r.kind==='unavailable'&&f.calls.length===1);
});
Deno.test('OSM address: provider failure has one attempt and leaves a short durable negative cache',async()=>{
 const f=fixture();let fetches=0;const r=await resolveOsmAddress(address,channel,f.store,async()=>{fetches++;return new Response('',{status:503});},'https://photon.komoot.io/api/');assert(r.kind==='unavailable'&&fetches===1&&f.calls.length===2);
});
Deno.test('OSM address: existing literal URL protection runs before dictionary, cache and provider',async()=>{
 const f=fixture();const services=createTaxiServices(f.store,deny,{mapsKey:'',modelKey:'',traccarUrl:'https://fleet.test',traccarEmail:'',traccarPassword:'',geocoderUrl:'https://photon.komoot.io/api/'});
 assert((await services.resolve('https://maps.app.goo.gl/test',channel)).kind==='unavailable');assert(f.calls.length===0&&f.reads()===0);
});
