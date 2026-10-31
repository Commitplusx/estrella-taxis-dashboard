import {assert,assertEquals} from 'https://deno.land/std@0.177.0/testing/asserts.ts';
import {selectTaxiCandidates} from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/selection.ts';
import {taxiTelemetryIssue,taxiMotion} from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/dispatchPolicy.ts';
import type {TaxiSelectionDecision} from '../estrella-taxis-backend/supabase/functions/_shared/algorithms/headingMatcher.ts';
import type {FleetDevice} from '../estrella-taxis-backend/supabase/functions/_shared/tracking/auth.ts';
const now=Date.parse('2026-10-31T22:00:00Z'),fix=(age:number)=>new Date(now-age*1000).toISOString();
function position(gpsAge:number,idle:number|null,free:boolean|null){
 return{id:1,deviceId:1,latitude:16.25,longitude:-92.13,valid:true,fixTime:fix(gpsAge),speed:idle===null?15/1.852:0,course:0,outdated:false,attributes:{occupied:free===null?'unknown':!free,taxiAvailability:free===null?'unknown':free?'free':'occupied',taxiMotionVersion:1,taxiMotionFixTime:Math.floor((now-gpsAge*1000)/1000),taxiMotionState:idle===null?'moving':'stationary',...(idle!==null?{taxiStationarySince:Math.floor((now-idle*1000)/1000)}:{})}};
}
function select(p:unknown[],status:FleetDevice['status']='online',allowed=new Set([1])){
 const decisions:TaxiSelectionDecision[]=[],devices:FleetDevice[]=[{id:1,name:'Synthetic unit',status}];
 return{result:selectTaxiCandidates(devices,p,allowed,{lat:16.251,lng:-92.13},20,now,d=>decisions.push(d)),decisions};
}
for(const gpsAge of [0,120,600,1200,1800,1801])for(const idle of [null,1200,1800,1801,7200])for(const free of [true,false,null])for(const status of ['online','offline'] as const){
 if(idle!==null&&idle<gpsAge)continue;
 Deno.test(`dispatch 30m policy: gps=${gpsAge} idle=${idle} free=${free} connection=${status}`,()=>{
  const p=position(gpsAge,idle,free),before=JSON.stringify(p),{result}=select([p],status);
  const expected=free===true&&gpsAge<=1800&&(idle===null||idle<=1800);
  assertEquals(result.success,expected);assertEquals(JSON.stringify(p),before);
  const issue=taxiTelemetryIssue(p.fixTime,p.attributes,p.speed,now);
  assertEquals(issue,gpsAge>1800?'stale_gps':idle!==null&&idle>1800?'idle_timeout':null);
 });
}
Deno.test('fresh stopped reports still exclude a vehicle after thirty minutes; movement permits it again',()=>{
 assertEquals(select([position(0,1801,true)]).decisions[0].reason,'idle_timeout');
 assert(select([position(0,null,true)]).result.success);
});
Deno.test('old imported points, forged motion metadata, timestamps and legacy unknown free are not fresh fixes',()=>{
 const p=position(1200,1200,true);
 for(const change of [{valid:false},{fixTime:'invalid'},{fixTime:fix(-31)},{attributes:{...p.attributes,taxiMotionFixTime:1}},{attributes:{...p.attributes,taxiStationarySince:(now+1000)/1000}},{attributes:{occupied:false}}])assertEquals(select([{...p,...change}]).result.success,false);
 assertEquals(taxiMotion({...p.attributes,taxiMotionVersion:'invalid'},Date.parse(p.fixTime),0).valid,false);
 assertEquals(select([p],'online',new Set([99])).result.success,false);
});
Deno.test('an old direction never adds a turn penalty, fresh direction keeps the current ranking rule',()=>{
 const old=select([position(1200,null,true)]),fresh=select([position(20,null,true)]);
 assert(old.result.success&&fresh.result.success);assertEquals(old.decisions.at(-1)?.penaltyKm,0);
 const away={...position(20,null,true),course:180};assertEquals(select([away]).decisions.at(-1)?.penaltyKm,2);
});
Deno.test('new invalid GPS cannot fall back silently to an older free point',()=>{
 const old=position(60,60,true),invalid={...position(0,0,true),id:2,valid:false};
 assertEquals(select([invalid,old]).result.success,false);
 assertEquals(select([old,invalid]).result.success,false);
});
