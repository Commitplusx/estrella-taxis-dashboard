import {evaluateSimulation} from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/simulation.ts';
import type {TaxiSimulationInput} from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/simulationContracts.ts';
/** Explicit design examples only. Production always requests the backend. */
export function taxiSimulationExample(input:TaxiSimulationInput){
 const now=Date.now(),center={lat:16.25,lng:-92.13};
 const definitions=[{id:4,name:'Unidad 0540',lat:.001,lng:0,free:true,age:24,speed:0,course:0},{id:7,name:'Unidad 1014',lat:-.0015,lng:0,free:true,age:16,speed:12,course:0},{id:8,name:'Unidad 0603',lat:0,lng:.002,free:true,age:35,speed:0,course:90},{id:9,name:'Unidad 0712',lat:.003,lng:0,free:true,age:28,speed:18,course:0},{id:10,name:'Unidad 0831',lat:0,lng:-.004,free:true,age:22,speed:0,course:0},{id:11,name:'Unidad 0946',lat:-.003,lng:-.003,free:false,age:18,speed:0,course:0},{id:12,name:'Unidad 1250',lat:.004,lng:.002,free:true,age:960,speed:0,course:0},{id:13,name:'Unidad 1362',lat:-.004,lng:.004,free:true,age:40,speed:0,course:0}];
 const fleet={enabled:true,paused:false,units:definitions.map(d=>({deviceId:d.id,name:d.name,inTurn:d.id!==13,hasPhone:true,busy:false,eligible:d.id!==13}))};
 const devices=definitions.map(d=>({id:d.id,name:d.name,status:'online' as const}));
 const positions=definitions.map(d=>({id:d.id,deviceId:d.id,latitude:center.lat+d.lat,longitude:center.lng+d.lng,fixTime:new Date(now-d.age*1000).toISOString(),valid:true,speed:d.speed/1.852,course:d.course,attributes:{occupied:!d.free,taxiAvailability:d.free?'free':'occupied',ignition:true}}));
 const result=evaluateSimulation(input,fleet,devices,positions,20,now,true,'example');result.pricing={state:'priced',cents:5500};return result;
}
