import { findOptimalTaxi } from '../estrella-taxis-backend/supabase/functions/_shared/algorithms/headingMatcher.ts';
import { calculateKMeans } from '../estrella-taxis-backend/supabase/functions/_shared/algorithms/kMeans.ts';
import { checkMaintenance } from '../estrella-taxis-backend/supabase/functions/_shared/algorithms/maintenance.ts';

function assert(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}

Deno.test('dispatch excludes future and invalid GPS timestamps', () => {
  const devices = [{ id: 1, name: 'Unidad 1', uniqueId: 'test-1', status: 'online' }];
  for (const fixTime of ['invalid', new Date(Date.now() + 3600000).toISOString()]) {
    const result = findOptimalTaxi(devices, [{ id: 1, deviceId: 1, latitude: 16.25, longitude: -92.13, fixTime }], 16.251, -92.13);
    assert(!result.success, 'Un GPS sin fecha fiable no puede ganar una asignación.');
  }
});

Deno.test('clustering rejects an invalid cluster count without throwing', () => {
  assert(calculateKMeans([{ lat: 16.25, lng: -92.13 }], 0).length === 0, 'k debe ser un entero positivo.');
});

Deno.test('maintenance marks a service due at the interval boundary', () => {
  const result = checkMaintenance(1, 5000, [{ id: 'oil', name: 'Aceite', intervalKm: 5000, warningThresholdKm: 200 }]);
  assert(result.some((row) => row.status === 'DUE'), 'Al alcanzar el intervalo no debe desaparecer el aviso.');
});

Deno.test('maintenance does not label invalid telemetry or service history as healthy',()=>{
  for(const odometer of [NaN,-1,10000001]) assert(checkMaintenance(1,odometer)[0]?.status==='UNKNOWN','Un odómetro no fiable debe quedar sin evaluar.');
  const result=checkMaintenance(1,5000,[{id:'oil',name:'Aceite',intervalKm:5000,warningThresholdKm:200,lastServiceKm:6000}]);
  assert(result[0]?.status==='UNKNOWN','Un servicio posterior al odómetro requiere revisión.');
});

Deno.test('clustering preserves duplicate weight and reports the actual final mean',()=>{
  const points=[{lat:16.25,lng:-92.13},{lat:16.25,lng:-92.13}];
  const groups=calculateKMeans(points,3);
  assert(groups.length===1 && groups[0].weight===2,'Las observaciones iguales deben compartir su zona.');
  const one=calculateKMeans([{lat:1,lng:2},{lat:3,lng:4},{lat:5,lng:6}],1,1);
  assert(one[0]?.centroid.lat===3 && one[0]?.centroid.lng===4,'El resultado debe usar la media final, incluso en la última iteración.');
});
