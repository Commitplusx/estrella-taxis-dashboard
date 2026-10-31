import {assertEquals} from 'https://deno.land/std@0.177.0/testing/asserts.ts';
import {findOptimalTaxi} from '../estrella-taxis-backend/supabase/functions/_shared/algorithms/headingMatcher.ts';
import {createTaxiServices} from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/services.ts';
import type {TaxiChannel} from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
import type {TrackingStore} from '../estrella-taxis-backend/supabase/functions/_shared/tracking/store.ts';
import {gpsOccupancy} from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/gpsOccupancy.ts';
const unit={id:1,name:'Unidad sintética',uniqueId:'synthetic',status:'online'};
const point={id:1,deviceId:1,latitude:16.25,longitude:-92.13,fixTime:new Date().toISOString(),valid:true,speed:0};
const channel:TaxiChannel={tenantId:'11111111-1111-4111-8111-111111111111',waba:'+529630000001',enabled:true,name:'Base sintética',city:'Comitán',centerLat:16.25,centerLng:-92.13,radiusKm:20,dispatcher:null,model:'fixture',baseCents:5500,perKmCents:1000,pricingMode:'road_distance'};
for(const attributes of [{},{occupied:null},{occupied:'unknown'},{occupied:'invalid'}])Deno.test('dispatch never treats unknown occupancy as free '+JSON.stringify(attributes),()=>{
 assertEquals(findOptimalTaxi([unit],[{...point,attributes}],16.251,-92.13).success,false);
});
async function candidates(attributes:Record<string,unknown>){
 const deny=async():Promise<never>=>{throw Error('Undeclared write');};
 const store:TrackingStore={read:deny,writeScores:deny,writePackages:deny,writeCompanyPackage:deny,writeCompanyStatus:deny,rpc:async(name,args)=>{assertEquals(name,'taxi_bot_dispatch_eligible');assertEquals(args.p_tenant,channel.tenantId);return[{device_id:1}];}};
 const services=createTaxiServices(store,async(input)=>{
  const path=new URL(String(input)).pathname;
  if(path==='/api/session')return Response.json({id:99,administrator:true,disabled:false},{headers:{'set-cookie':'JSESSIONID=synthetic-session; HttpOnly'}});
  if(path==='/api/devices')return Response.json([unit]);
  if(path==='/api/positions')return Response.json([{...point,fixTime:new Date().toISOString(),attributes}]);
  throw Error('Undeclared provider path');
 },{mapsKey:'',modelKey:'',traccarUrl:'https://fleet.invalid/api',traccarEmail:'fixture@example.test',traccarPassword:'Fixture-password-123'});
 return services.candidates({text:'Origen sintético',lat:16.251,lng:-92.13,placeId:null},channel);
}
Deno.test('dispatch rejects a legacy false that could have been fabricated by the old bridge',async()=>{assertEquals(await candidates({occupied:false}),[]);});
for(const attributes of [{taxiAvailability:'free',occupied:false},{taxiAvailability:'free',occupied:'false'},{taxiAvailability:'free',occupied:0}])Deno.test('explicit consistent free telemetry is eligible '+JSON.stringify(attributes),async()=>{
 assertEquals(gpsOccupancy(attributes),false);assertEquals(await candidates(attributes),[{deviceId:1,name:unit.name}]);
});
for(const state of ['free','occupied','unknown','invalid',null])for(const occupied of [true,false,'unknown',null]){
 const attributes={taxiAvailability:state,occupied};
 if(state==='free'&&occupied===false)continue;
 Deno.test('occupied, missing or contradictory switch cannot dispatch '+JSON.stringify(attributes),async()=>{
  assertEquals(gpsOccupancy(attributes),state==='occupied'&&occupied===true?true:null);assertEquals(await candidates(attributes),[]);
 });
}
