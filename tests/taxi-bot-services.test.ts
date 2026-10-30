import {createTaxiServices}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/services.ts';
import type{TaxiChannel}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
import type{TrackingStore}from'../estrella-taxis-backend/supabase/functions/_shared/tracking/store.ts';
import type{Fetcher}from'../estrella-taxis-backend/supabase/functions/_shared/tracking/http.ts';
function assert(v:unknown,m='Assertion failed'):asserts v{if(!v)throw new Error(m);}
function equal(a:unknown,b:unknown){assert(JSON.stringify(a)===JSON.stringify(b),`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);}
const c:TaxiChannel={tenantId:'11111111-1111-4111-8111-111111111111',waba:'+529630000001',enabled:true,name:'Base sintética',city:'Comitán',centerLat:16.25,centerLng:-92.13,radiusKm:20,dispatcher:'+529630000099',model:'fixture-model',baseCents:4000,perKmCents:1000,pricingMode:'road_distance'};
const origin={text:'Centro',lat:16.25,lng:-92.13,placeId:null},destination={text:'Terminal',lat:16.26,lng:-92.14,placeId:null};
const config={mapsKey:'fixture-maps-key',modelKey:'fixture-model-key',traccarUrl:'https://tracking.test/api',traccarEmail:'fixture@example.invalid',traccarPassword:'not-a-real-password'};
const denyAdminWrite = async (): Promise<never> => { throw new Error('No administration writes in this fixture.'); };
function store(aliases:unknown[]=[]):TrackingStore{return{writePackages:denyAdminWrite,writeCompanyPackage:denyAdminWrite,writeCompanyStatus:denyAdminWrite,read:async(table,q)=>{equal(q.get('tenant_id'),'eq.'+c.tenantId);if(table==='lugares_frecuentes')return aliases;if(table==='conductores')return[{device_id:1},{device_id:2},{device_id:3}];throw new Error('Undeclared fixture table.');},writeScores:async()=>{throw new Error('Forbidden score write.');},rpc:async(name,args)=>{equal(name,'taxi_bot_neighborhood_read');equal(args.p_tenant,c.tenantId);return[];}};}
const denyFetch:Fetcher=async()=>{throw new Error('No undeclared provider call may be approved.');};
Deno.test('taxi geocoding preserves exact GPS including zero longitude and never fetches a customer URL',async()=>{
  const s=createTaxiServices(store(),denyFetch,config);const gps=await s.resolve('16.25, 0',c);assert(gps.kind==='resolved');equal(gps.place.lng,0);
  equal((await s.resolve('https://maps.app.goo.gl/example',c)).kind,'unavailable');
});
Deno.test('tenant dictionary ambiguity does not choose its first result',async()=>{
  const s=createTaxiServices(store([{nombre:'Terminal A',lat:16.25,lng:-92.13},{nombre:'Terminal B',lat:16.26,lng:-92.14}]),denyFetch,config);
  equal((await s.resolve('Terminal',c)).kind,'ambiguous');
});
Deno.test('maps approximate, partial and multiple results are not precise pickup points',async()=>{
  const result={formatted_address:'Centro',place_id:'fixture-place',geometry:{location:{lat:16.25,lng:-92.13},location_type:'APPROXIMATE'}};
  for(const results of [[result],[{...result,partial_match:true}],[result,result]]){
    const f:Fetcher=async()=>new Response(JSON.stringify({status:'OK',results}),{status:200});
    assert((await createTaxiServices(store(),f,config).resolve('Centro',c)).kind!=='resolved');
  }
});
Deno.test('taxi quote uses the configured rate and actual road distance, never a fallback invented amount',async()=>{
  let calls=0;const f:Fetcher=async()=>{calls++;return new Response(JSON.stringify({status:'OK',routes:[{legs:[{distance:{value:2500}}]}]}),{status:200});};
  const s=createTaxiServices(store(),f,config);equal(await s.quote(origin,destination,c),6500);equal(calls,1);
  equal(await s.quote(origin,destination,{...c,baseCents:null,perKmCents:null}),null);equal(calls,1);
  const broken=createTaxiServices(store(),async()=>new Response('{"status":"ZERO_RESULTS"}',{status:200}),config);equal(await broken.quote(origin,destination,c),null);
});
Deno.test('taxi candidates intersect active tenant drivers with authenticated online GPS scope',async()=>{
  const f:Fetcher=async(input,init)=>{
    const u=new URL(String(input));
    if(u.pathname==='/api/session')return new Response(JSON.stringify({id:1,administrator:true,disabled:false}),{status:200,headers:{'set-cookie':'JSESSIONID=fixture-cookie-123; Secure'}});
    equal(new Headers(init?.headers).get('Cookie'),'JSESSIONID=fixture-cookie-123');
    if(u.pathname==='/api/devices')return new Response(JSON.stringify([{id:1,name:'Valid',status:'online'},{id:2,name:'Offline',status:'offline'},{id:3,name:'Invalid fix',status:'online'},{id:4,name:'Foreign',status:'online'}]),{status:200});
    if(u.pathname==='/api/positions')return new Response(JSON.stringify([1,2,3,4].map((id)=>({id,deviceId:id,latitude:16.251,longitude:-92.131,fixTime:new Date().toISOString(),speed:0,valid:id!==3,attributes:{ignition:true,occupied:false}}))),{status:200});
    throw new Error('Unexpected GPS fixture endpoint '+u.pathname);
  };
  equal(await createTaxiServices(store(),f,config).candidates(origin,c),[{deviceId:1,name:'Valid'}]);
});
