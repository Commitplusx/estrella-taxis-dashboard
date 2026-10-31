'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRefreshController,createRefreshServer}=require('./refresh.cjs');

test('a live poll and simultaneous trip requests share one upstream sync',async()=>{
 let calls=0,release;const gate=new Promise(resolve=>{release=resolve;});
 const controller=createRefreshController(async signal=>{calls++;assert.equal(signal.aborted,false);await gate;return{synced:19,expected:19};});
 const poll=controller.run('poll'),trip=controller.run('dispatch'),trip2=controller.run('dispatch');
 assert.equal(calls,1);release();
 const all=await Promise.all([poll,trip,trip2]);assert.deepEqual(all[0],all[1]);assert.deepEqual(all[1],all[2]);assert.equal(all[0].state,'refreshed');
});
test('completed snapshots coalesce for one second and failed sync is not success',async()=>{
 let time=100000,calls=0,fail=false;
 const controller=createRefreshController(async()=>{calls++;if(fail)throw Error('Declared upstream failure');return{synced:2,expected:2};},{now:()=>time});
 await controller.run('poll');time+=500;await controller.run('dispatch');assert.equal(calls,1);
 time+=501;fail=true;await assert.rejects(controller.run('dispatch'));assert.equal(calls,2);
 fail=false;await controller.run('dispatch');assert.equal(calls,3);
});
for(const outcome of [undefined,{synced:0,expected:0},{synced:1,expected:2},{synced:1.5,expected:1.5}])test('partial or missing ingestion cannot authorize dispatch '+JSON.stringify(outcome),async()=>{
 const controller=createRefreshController(async()=>outcome);await assert.rejects(controller.run('dispatch'));
});
test('a timed-out sync cannot report successful refresh',async()=>{
 const controller=createRefreshController(signal=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>resolve({synced:1,expected:1}),1000);
  signal.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('Declared timeout'));},{once:true});
 }),{timeoutMs:10});
 await assert.rejects(controller.run('dispatch'));
});
test('private endpoint authenticates before refreshing, rejects bodies and propagates failure',async()=>{
 let calls=0,fail=false;
 const controller={run:async()=>{calls++;if(fail)throw Error('Declared Wialon outage');return{state:'refreshed',synced:19,completedAt:new Date().toISOString()};}};
 const secret='synthetic-test-secret-'.repeat(2),server=createRefreshServer(controller,secret);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert(address&&typeof address!=='string');
 const url='http://127.0.0.1:'+address.port+'/taxi-gps-refresh';
 try{
  for(const headers of [{},{'x-taxi-worker-secret':'incorrect'},{'x-taxi-worker-secret':'x'.repeat(secret.length)}]){const r=await fetch(url,{method:'POST',headers});assert.equal(r.status,401);await r.body.cancel();}
  assert.equal(calls,0);
  const invalid=await fetch(url,{method:'POST',headers:{'x-taxi-worker-secret':secret},body:'{}'});assert.equal(invalid.status,400);await invalid.body.cancel();assert.equal(calls,0);
  const r=await fetch(url,{method:'POST',headers:{'x-taxi-worker-secret':secret}});assert.equal(r.status,200);assert.equal((await r.json()).synced,19);assert.equal(calls,1);
  fail=true;const failed=await fetch(url,{method:'POST',headers:{'x-taxi-worker-secret':secret}});assert.equal(failed.status,503);assert.deepEqual(await failed.json(),{code:'gps_refresh_unavailable'});assert.equal(calls,2);
  const get=await fetch(url,{headers:{'x-taxi-worker-secret':secret}});assert.equal(get.status,405);await get.body.cancel();assert.equal(calls,2);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
