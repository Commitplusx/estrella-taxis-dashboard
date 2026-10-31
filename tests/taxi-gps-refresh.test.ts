import {assert,assertEquals,assertRejects} from 'https://deno.land/std@0.177.0/testing/asserts.ts';
import {refreshTaxiGps} from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/gpsRefresh.ts';
import type {Fetcher} from '../estrella-taxis-backend/supabase/functions/_shared/tracking/http.ts';
const config={url:'https://taxis.estrella-eats.mx/taxi-gps-refresh',secret:'synthetic-test-secret-'.repeat(2)};
const good=()=>({state:'refreshed',synced:19,completedAt:new Date().toISOString()});
Deno.test('GPS refresh is private, bounded, and does not forward customer information',async()=>{
 let calls=0;const fetcher:Fetcher=async(url,init)=>{calls++;assertEquals(url,config.url);assertEquals(init?.method,'POST');assertEquals(init?.body,undefined);assertEquals(init?.redirect,'error');assert(init?.signal);assertEquals(new Headers(init.headers).get('x-taxi-worker-secret'),config.secret);return Response.json(good());};
 await refreshTaxiGps(fetcher,config);assertEquals(calls,1);
});
for(const body of [null,{}, {...good(),state:'pending'}, {...good(),synced:0}, {...good(),synced:'19'}, {...good(),synced:1.5}, {...good(),completedAt:'invalid'}, {...good(),completedAt:'2000-01-01T00:00:00Z'}, {...good(),completedAt:'2100-01-01T00:00:00Z'}])Deno.test('GPS refresh rejects stale or invalid attestation '+JSON.stringify(body),async()=>{
 await assertRejects(()=>refreshTaxiGps(async()=>Response.json(body),config));
});
for(const status of [401,403,429,500,503])Deno.test('GPS refresh does not use cached candidates after HTTP '+status,async()=>{
 await assertRejects(()=>refreshTaxiGps(async()=>new Response('',{status}),config));
});
Deno.test('GPS refresh cannot send its credential to a different URL or follow redirects',async()=>{
 let calls=0;const no:Fetcher=async()=>{calls++;throw Error('Undeclared request');};
 await assertRejects(()=>refreshTaxiGps(no,{...config,url:'https://other.invalid/'}));
 await assertRejects(()=>refreshTaxiGps(no,{...config,secret:''}));assertEquals(calls,0);
 await assertRejects(()=>refreshTaxiGps(async()=>new Response('',{status:302,headers:{location:'https://other.invalid/'}}),config));
});
Deno.test('GPS refresh respects cancellation and network failure',async()=>{
 const signal=AbortSignal.abort();await assertRejects(()=>refreshTaxiGps(async(_url,init)=>{assert(init?.signal?.aborted);throw Error('Declared abort');},config,signal));
 await assertRejects(()=>refreshTaxiGps(async()=>{throw Error('Declared network failure');},config));
});
