import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { record } from '../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts';
const migration=readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261027190000_tracking_ai_integrity.sql',import.meta.url),'utf8');
async function fixture() {
  const db=new PGlite();
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE driving_scores(id bigserial PRIMARY KEY,device_id integer NOT NULL,score_date date NOT NULL,score integer NOT NULL,UNIQUE(device_id,score_date));
    ALTER TABLE driving_scores ENABLE ROW LEVEL SECURITY;
    CREATE POLICY anon_insert ON driving_scores FOR INSERT TO anon WITH CHECK(true);
    CREATE POLICY anon_select ON driving_scores FOR SELECT TO anon USING(true);
    GRANT ALL ON driving_scores TO anon,authenticated;
    INSERT INTO driving_scores(device_id,score_date,score)VALUES(1,'2026-10-26',80);`);
  await db.exec(migration);
  const scalar=async(sql:string,params:unknown[]=[])=>Object.values((await db.query<Record<string,unknown>>(sql,params)).rows[0])[0];
  const start=(user:number,key=crypto.randomUUID(),hash='a'.repeat(64),kind='audit')=>scalar('SELECT tracking_operation_begin($1,$2,$3,$4)',[user,key,kind,hash]);
  function row(value:unknown):Record<string,unknown>{assert.ok(record(value));return value;}
  return {db,scalar,start,row};
}
test('tracking migration closes anonymous score reads/writes and preserves legacy rows',async()=>{
  const {db,scalar}=await fixture();try {
    assert.equal(await scalar('SELECT score FROM driving_scores'),80);
    assert.equal(await scalar('SELECT algorithm_version FROM driving_scores'),'legacy-v1');
    for (const role of ['anon','authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(scalar('SELECT count(*) FROM driving_scores'),/permission denied/);
      await assert.rejects(scalar('SELECT tracking_operation_begin(1,gen_random_uuid(),\'audit\',repeat(\'a\',64))'),/permission denied/);
      await db.exec('RESET ROLE');
    }
    await db.exec('SET ROLE service_role');assert.equal(await scalar('SELECT count(*)::int FROM driving_scores'),1);
    await assert.rejects(scalar('SELECT count(*) FROM tracking_operations'),/permission denied/);
  }finally{await db.close();}
});
test('analysis lease binds user, UUID and parameters; duplicate calls do not start twice',async()=>{
  const {db,start,scalar,row}=await fixture();try {
    const key=crypto.randomUUID(),first=row(await start(11,key));assert.equal(first.state,'proceed');
    assert.equal(row(await start(11,key)).state,'running');
    assert.equal(row(await start(11,key,'b'.repeat(64))).state,'conflict');
    assert.equal(await scalar('SELECT tracking_operation_complete($1,$2,$3,$4,200)',[12,key,first.lease,'{"ok":true}']),false);
    assert.equal(await scalar('SELECT tracking_operation_complete($1,$2,$3,$4,200)',[11,key,crypto.randomUUID(),'{"ok":true}']),false);
    assert.equal(await scalar('SELECT tracking_operation_complete($1,$2,$3,$4,200)',[11,key,first.lease,'{"ok":true}']),true);
    const replay=row(await start(11,key));assert.equal(replay.state,'replay');assert.deepEqual(replay.result,{ok:true});
    assert.equal(await scalar('SELECT tracking_operation_complete($1,$2,$3,$4,200)',[11,key,first.lease,'{"ok":false}']),false);
  }finally{await db.close();}
});
test('durable concurrency and rate limits span callers; expired calls remain uncertain',async()=>{
  const {db,start,row}=await fixture();try {
    for(const user of [1,2,3,4]) assert.equal(row(await start(user)).state,'proceed');
    assert.equal(row(await start(5)).state,'limited');assert.equal(row(await start(1)).state,'limited');
    const key=crypto.randomUUID();await db.exec("UPDATE tracking_operations SET lease_until=clock_timestamp()-interval '1 second'");
    assert.equal(row(await start(5,key)).state,'proceed');
    await db.exec("UPDATE tracking_operations SET lease_until=clock_timestamp()-interval '1 second'");
    assert.equal(row(await start(5,key)).state,'uncertain');
  }finally{await db.close();}
});
test('three completed audits consume the budget and failures replay without provider calls',async()=>{
  const {db,start,scalar,row}=await fixture();try {
    for(let i=0;i<3;i++) {
      const key=crypto.randomUUID(),claim=row(await start(44,key));assert.equal(claim.state,'proceed');
      assert.equal(await scalar('SELECT tracking_operation_complete($1,$2,$3,$4,502)',[44,key,claim.lease,'{"code":"provider_failed"}']),true);
      const replay=row(await start(44,key));assert.equal(replay.state,'replay');assert.equal(replay.status,502);
    }
    assert.equal(row(await start(44)).state,'limited');
  }finally{await db.close();}
});
test('score writes require server evidence and reject an older computation',async()=>{
  const {db,scalar}=await fixture();try {
    await db.exec('SET ROLE service_role');
    await assert.rejects(db.query("INSERT INTO driving_scores(device_id,score_date,score)VALUES(2,'2026-10-26',100)"),/validated evidence/);
    await db.query("INSERT INTO driving_scores(device_id,score_date,score,algorithm_version,quality,computed_at)VALUES(2,'2026-10-26',90,'tracking-score-v2','{\"status\":\"limited\"}','2026-10-27T12:00:00Z')");
    await assert.rejects(db.query("UPDATE driving_scores SET score=50,computed_at='2026-10-27T11:00:00Z' WHERE device_id=2"),/newer tracking score/);
    assert.equal(await scalar('SELECT score FROM driving_scores WHERE device_id=2'),90);
  }finally{await db.close();}
});
