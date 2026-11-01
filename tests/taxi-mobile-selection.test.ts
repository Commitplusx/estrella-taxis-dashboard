import { assertEquals, assert } from 'https://deno.land/std@0.177.0/testing/asserts.ts';
import { combineTaxiPositions, refreshDispatchSources } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/mobilePositions.ts';
import { selectTaxiCandidates } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/selection.ts';
const now = Date.parse('2026-11-01T18:00:00Z');
const fix = (age: number) => new Date(now - age * 1000).toISOString();
function hardware(id: number, lat = 16.26, age = 10, occupied: unknown = false) {
  return { id, deviceId: id, valid: true, latitude: lat, longitude: -92.13, speed: 0, fixTime: fix(age), attributes: { occupied, taxiAvailability: occupied===false?'free':occupied===true?'occupied':'unknown' } };
}
function mobile(id: number, age = 10, idle = 10) {
  return { ...hardware(id, 16.25, age), attributes: { occupied: false, taxiAvailability: 'free', taxiPositionSource: 'mobile', taxiStationarySinceMs: now - idle * 1000 } };
}
function run(h: unknown[], m: unknown[]) {
  const positions = combineTaxiPositions(h, m, now);
  return selectTaxiCandidates([{ id: 1, name: 'Hardware', status: 'online' }, { id: 2, name: 'Phone', status: 'unknown' }], positions, new Set([1, 2]), { lat: 16.2501, lng: -92.13 }, 20, now);
}
Deno.test('fresh phone without a hardware position participates, after hardware even when much closer', () => {
  const result = run([hardware(1)], [mobile(2)]);
  assert(result.success); assertEquals(result.data.map(u => u.deviceId), [1, 2]);
});
Deno.test('fresh phone replaces unavailable old hardware, never current occupied or unknown telemetry', () => {
  assert(run([hardware(2, 16.25, 1801)], [mobile(2)]).success);
  for (const occupied of [true, 'unknown', null]) assertEquals(run([hardware(2, 16.25, 10, occupied)], [mobile(2)]).success, false);
});
for(const patch of [{valid:false},{latitude:91},{fixTime:'not-a-date'},{fixTime:fix(-60)}])for(const occupied of [true,false,null]){
  Deno.test('a malformed or future hardware report cannot be silently replaced with a free phone: '+JSON.stringify({patch,occupied}),()=>{
    assertEquals(run([{...hardware(2,16.25,10,occupied),...patch}],[mobile(2)]).success,false);
  });
}
for (const age of [0, 30, 120, 121, -31]) for (const idle of [30, 1800, 1801]) {
  if (idle < age) continue;
  Deno.test(`phone expiry and idle limits: age=${age}, idle=${idle}`, () => {
    assertEquals(run([], [mobile(2, age, idle)]).success, age >= -30 && age <= 120 && idle <= 1800);
  });
}
Deno.test('phone does not override idle hardware or enter outside current driver eligibility', () => {
  const h = hardware(2); const stationary = { ...h, attributes: { ...h.attributes, taxiMotionVersion: 1, taxiMotionFixTime: (now - 10000) / 1000, taxiMotionState: 'stationary', taxiStationarySince: (now - 1801000) / 1000 } };
  assertEquals(run([stationary], [mobile(2)]).success, false);
  const result = selectTaxiCandidates([{ id: 2, name: 'Phone', status: 'unknown' }], combineTaxiPositions([], [mobile(2)], now), new Set([1]), { lat: 16.25, lng: -92.13 }, 20, now);
  assertEquals(result.success, false);
});
Deno.test('failed hardware refresh may use independent fresh phone reports, but cannot authorize cached hardware or override its occupied switch', async () => {
  const fresh={...mobile(2),fixTime:new Date().toISOString(),attributes:{...mobile(2).attributes,taxiStationarySinceMs:Date.now()-10000}};
  const config={url:'https://taxis.estrella-eats.mx/taxi-gps-refresh',secret:'s'.repeat(32)};
  const mobileOnly=await refreshDispatchSources(async()=>new Response(null,{status:503}),config,[fresh]);
  assertEquals(mobileOnly,true);
  assertEquals(combineTaxiPositions([hardware(1)],[mobile(2)],now,mobileOnly),[mobile(2)]);
  assertEquals(combineTaxiPositions([hardware(2,16.25,10,true)],[mobile(2)],now,mobileOnly),[]);
  let refused=false;try{await refreshDispatchSources(async()=>new Response(null,{status:503}),config,[]);}catch{refused=true;}assert(refused);
});
