import { dayPeriod, localDay, period, TrackingError } from '../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts';
import { analyzeDriving } from '../estrella-taxis-backend/supabase/functions/_shared/tracking/scoring.ts';
import { normalizeEvents, normalizeSummaries, buildFacts, parseNarrative } from '../estrella-taxis-backend/supabase/functions/_shared/tracking/insights.ts';
import { findOptimalTaxi } from '../estrella-taxis-backend/supabase/functions/_shared/algorithms/headingMatcher.ts';
import { calculateKMeans } from '../estrella-taxis-backend/supabase/functions/_shared/algorithms/kMeans.ts';
import { loadFleetActivity } from '../src/lib/fleetActivity.ts';
import { parseAuditReport } from '../src/lib/trackingContracts.ts';
const assert=(value:unknown,message='Assertion failed'):void=>{if(!value)throw new Error(message);};
function equal(actual:unknown,expected:unknown){if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);}
function throws(action:()=>unknown){try{action();}catch{return;}throw new Error('Expected a rejected input.');}
const start=Date.parse('2026-10-26T06:00:00Z'),device={id:1,name:'Unidad de prueba'};
function positions(count=10,step=10,ignition:unknown=true){return Array.from({length:count},(_,index)=>({deviceId:1,id:index+1,fixTime:new Date(start+index*step*1000).toISOString(),latitude:16.25,longitude:-92.13,speed:0,valid:true,attributes:{ignition}}));}
Deno.test('day boundaries use Chiapas across UTC midnight and leap dates',()=>{
  equal(localDay(Date.parse('2026-10-27T04:00:00Z')),'2026-10-26');
  const range=dayPeriod('2026-10-26',Date.parse('2026-10-27T15:00:00Z'));
  equal(range.from,'2026-10-26T06:00:00.000Z');equal(range.to,'2026-10-27T05:59:59.999Z');
  throws(()=>dayPeriod('2026-02-30',Date.parse('2026-03-01T15:00:00Z')));
  throws(()=>period('2026-10-26T00:00','2026-10-27T00:00',Date.now()));
});
Deno.test('insufficient telemetry never produces a perfect score',()=>{
  equal(analyzeDriving([],device,'2026-10-26',start,start+86400000).score,null);
  equal(analyzeDriving(positions(7),device,'2026-10-26',start,start+86400000).score,null);
});
Deno.test('idle requires confirmed ignition and the grace period is counted once',()=>{
  const known=analyzeDriving(positions(601,1),device,'2026-10-26',start,start+86400000);
  assert(known.score);equal(known.score?.idleMinutes,7);equal(known.score?.score,99);
  const unknown=analyzeDriving(positions(601,1,null),device,'2026-10-26',start,start+86400000);
  equal(unknown.score?.idleMinutes,0);equal(unknown.quality.unknownIgnitionMinutes,10);
});
Deno.test('missing or invalid speed is unknown and does not become idling',()=>{
  const raw=positions(121,5).map((point)=>({...point,speed:null}));
  equal(analyzeDriving(raw,device,'2026-10-26',start,start+86400000).score?.idleMinutes,0);
});
Deno.test('long GPS gaps do not fabricate distance or active driving time',()=>{
  const raw=positions(12,10);raw[11]={...raw[11],fixTime:new Date(start+3600000).toISOString(),latitude:17.0};
  const result=analyzeDriving(raw,device,'2026-10-26',start,start+86400000);
  equal(result.quality.gapSegments,1);equal(result.score?.distanceKm,0);assert(result.quality.coverage<.1);
});
Deno.test('impossible jumps and conflicting simultaneous fixes lower coverage',()=>{
  const raw=positions(12,10);raw[5]={...raw[5],latitude:70};
  const result=analyzeDriving(raw,device,'2026-10-26',start,start+86400000);
  equal(result.quality.suspectSegments,2);equal(result.score?.distanceKm,0);
  const duplicate=analyzeDriving([...positions(),{...positions()[4],latitude:70}],device,'2026-10-26',start,start+86400000);
  equal(duplicate.quality.duplicatePoints,1);assert(duplicate.quality.rejectedPoints>=2);
});
Deno.test('raw telemetry rejects invalid fixes, other devices and out-of-period rows',()=>{
  const raw=[...positions(),{...positions()[0],deviceId:2},{...positions()[0],valid:false},{...positions()[0],latitude:Infinity},{...positions()[0],fixTime:'bad'},{...positions()[0],fixTime:new Date(start-1).toISOString()}];
  const result=analyzeDriving(raw,device,'2026-10-26',start,start+86400000);equal(result.quality.rejectedPoints,5);equal(result.quality.acceptedPoints,10);
});
Deno.test('events are counted on entry, deduplicated and require source scope',()=>{
  const range={from:new Date(start).toISOString(),to:new Date(start+86400000).toISOString()};
  const event={id:1,deviceId:1,type:'deviceOverspeed',eventTime:new Date(start+1000).toISOString()};
  equal(normalizeEvents([event,event],new Set([1]),range).length,1);
  throws(()=>normalizeEvents([{...event,deviceId:2}],new Set([1]),range));
  throws(()=>normalizeSummaries([{deviceId:2,distance:100,maxSpeed:5,averageSpeed:3,engineHours:0}],new Set([1])));
});
Deno.test('narrative citations cannot invent incidents or execute markup',()=>{
  const facts=buildFacts([device],[{deviceId:1,distance:100,maxSpeed:20,averageSpeed:3,engineHours:7200000}],[]);
  equal(facts.findings[0].id,'activity-1');assert(facts.warnings.length>0);
  throws(()=>parseNarrative({summary:'<script>alert(1)</script>',recommendations:[]},facts));
  throws(()=>parseNarrative({summary:'Revisar',recommendations:[{findingId:'invented',text:'Revisar'}]},facts));
  equal(parseNarrative({summary:'Conviene revisar el registro.',recommendations:[{findingId:'activity-1',text:'Verificar la señal del motor.'}]},facts).recommendations.length,1);
});
Deno.test('dispatch filters offline, occupied, stopped, invalid and stale units',()=>{
  const now=Date.parse('2026-10-27T12:00:00Z');
  const devices=Array.from({length:6},(_,index)=>({id:index+1,name:'U'+index,uniqueId:'u'+index,status:index===0?'online':'offline'}));
  const points=devices.map((unit)=>({id:unit.id,deviceId:unit.id,fixTime:new Date(now).toISOString(),latitude:16.25,longitude:-92.13,attributes:{occupied:false}}));
  equal(findOptimalTaxi(devices,points,16.251,-92.13,10,now).success,true);
  for(const attributes of [{occupied:'1'},{occupied:1},{occupied:false,ignition:'false'},{occupied:false,ignition:0}]) assert(!findOptimalTaxi([devices[0]],[{...points[0],attributes}],16.251,-92.13,10,now).success);
  assert(!findOptimalTaxi([devices[0]],[{...points[0],valid:false}],16.251,-92.13,10,now).success);
  assert(!findOptimalTaxi([devices[0]],[{...points[0],fixTime:new Date(now-601000).toISOString()}],16.251,-92.13,10,now).success);
});
Deno.test('taxi offers can reach a parked taxi but never trust a stale offline fix or a known occupied unit',()=>{
  const now=Date.parse('2026-10-27T12:00:00Z'),pickup={lat:16.251,lng:-92.13},options={allowIgnitionOff:true,allowOfflineFixAgeMs:120000};
  const parked={id:1,name:'Estacionado',uniqueId:'fixture-1',status:'online'},parkedPoint={...positions(1,10,false)[0],fixTime:new Date(now).toISOString(),attributes:{ignition:false,occupied:false}};
  equal(findOptimalTaxi([parked],[parkedPoint],pickup.lat,pickup.lng,20,now,options).success,true);
  const recentlyOffline={id:2,name:'Desconectado reciente',uniqueId:'fixture-2',status:'offline'},freshFix={...parkedPoint,deviceId:recentlyOffline.id,id:recentlyOffline.id};
  equal(findOptimalTaxi([recentlyOffline],[freshFix],pickup.lat,pickup.lng,20,now,options).success,true);
  const staleFix={...freshFix,fixTime:new Date(now-120001).toISOString()};
  equal(findOptimalTaxi([recentlyOffline],[staleFix],pickup.lat,pickup.lng,20,now,options).success,false);
  equal(findOptimalTaxi([parked],[{...parkedPoint,attributes:{occupied:true}}],pickup.lat,pickup.lng,20,now,options).success,false);
});
Deno.test('clustering is reproducible and survives identical points and invalid limits',()=>{
  const points=[{lat:16,lng:-92},{lat:16.01,lng:-92},{lat:17,lng:-93},{lat:17.01,lng:-93}];
  equal(calculateKMeans(points,2),calculateKMeans([...points].reverse(),2));
  equal(calculateKMeans(Array.from({length:20},()=>({lat:16,lng:-92})),3).length,1);
  equal(calculateKMeans(points,NaN).length,0);equal(calculateKMeans(points,2,0).length,0);
});
Deno.test('activity uses limited concurrency and one observation per unit/time bucket',async()=>{
  let active=0,maxActive=0;
  const result=await loadFleetActivity([1,2,3,4],new Date(start).toISOString(),new Date(start+3600000).toISOString(),async(id)=>{
    active++;maxActive=Math.max(maxActive,active);await Promise.resolve();active--;
    return positions(100,1).map((point)=>({...point,deviceId:id}));
  });
  assert(maxActive<=3);equal(result.sampledPoints,4);equal(result.clusters.reduce((sum,item)=>sum+item.weight,0),4);
});
Deno.test('client contract rejects a recommendation for another unit',()=>{
  throws(()=>parseAuditReport({version:'audit-v2',requestId:'qa',generatedAt:new Date(start).toISOString(),period:{from:new Date(start).toISOString(),to:new Date(start+60000).toISOString()},devices:[device],facts:{units:1,distanceKm:0,eventCount:0,maxSpeedKmh:0,findings:[{id:'x',deviceId:2,severity:'review',title:'x',evidence:'x'}],warnings:[]},narrative:null,narrativeStatus:'not_configured'}));
});
