import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {record} from '../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts';
const root='../estrella-taxis-backend/supabase/migrations/';
const load=(name:string)=>readFileSync(new URL(root+name,import.meta.url),'utf8');
const migration=load('20261031235500_taxi_dispatch_simulation.sql'),tracking=load('20261027190000_tracking_ai_integrity.sql'),dispatch=load('20261031210001_taxi_dispatch_rounds.sql'),access=load('20261029165842_taxi_customer_access.sql');
const tenant='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',waba='+529630000001';
async function setup(){
 const db=new PGlite();await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE taxi_bot_channels(tenant_id uuid,waba text,enabled boolean);
 CREATE TABLE taxi_base_units(tenant_id uuid,device_id integer,name text);
 CREATE TABLE conductores(tenant_id uuid,device_id integer,nombre text,activo boolean,telefono_whatsapp text);
 CREATE TABLE viajes(tenant_id uuid,device_id integer,estado text);
 CREATE FUNCTION taxi_bot_dispatch_paused(uuid,text) RETURNS boolean LANGUAGE sql AS 'SELECT false';`);
 const opStart=tracking.indexOf('CREATE TABLE public.tracking_operations'),completeStart=tracking.indexOf('CREATE FUNCTION public.tracking_operation_complete'),opEnd=tracking.indexOf('END $$;',completeStart)+7;
 assert(opStart>0&&completeStart>opStart&&opEnd>completeStart);await db.exec(tracking.slice(opStart,opEnd));
 const phone=access.match(/CREATE FUNCTION public\.taxi_bot_customer_phone[\s\S]*?\$\$;/)?.[0],eligible=dispatch.match(/CREATE FUNCTION public\.taxi_bot_dispatch_eligible[\s\S]*?END \$\$;/)?.[0];assert(phone&&eligible);await db.exec(phone+eligible);await db.exec(migration);
 const scalar=async(sql:string,params:unknown[]=[]):Promise<unknown>=>{const r=await db.query<Record<string,unknown>>(sql,params);return Object.values(r.rows[0]??{})[0];};
 const obj=(v:unknown):Record<string,unknown>=>{assert(record(v));return v;};
 await db.query('INSERT INTO taxi_bot_channels VALUES($1,$2,true),($3,$4,true)',[tenant,waba,other,'+529630000099']);
 await db.query("INSERT INTO taxi_base_units VALUES($1,1,'Taxi 1'),($1,2,'Taxi 2'),($1,3,'Taxi 3'),($1,4,'Taxi 4'),($2,5,'Other tenant')",[tenant,other]);
 await db.query("INSERT INTO conductores VALUES($1,1,'Driver 1',true,'+529630000011'),($1,2,'Driver 2',false,'+529630000012'),($1,3,'Driver 3',true,''),($1,4,'Driver 4',true,'+529630000014'),($2,5,'Other',true,'+529630000015')",[tenant,other]);
 await db.query("INSERT INTO viajes VALUES($1,4,'en_camino')",[tenant]);
 return{db,scalar,obj};
}
test('simulation SQL returns bounded same-tenant facts and the authoritative eligible set without phones or writes',async()=>{
 const f=await setup();try{
  const before=await f.scalar('SELECT count(*) FROM viajes'),result=f.obj(await f.scalar('SELECT taxi_bot_simulation_fleet($1,$2)',[tenant,waba]));assert(Array.isArray(result.units));const units=result.units.map(f.obj);
  assert.deepEqual(units.map(u=>u.deviceId),[1,2,3,4]);assert.deepEqual(units.filter(u=>u.eligible).map(u=>u.deviceId),[1]);assert.equal(units[1].inTurn,false);assert.equal(units[2].hasPhone,false);assert.equal(units[3].busy,true);
  assert(!JSON.stringify(result).includes('+52963'));assert.equal(await f.scalar('SELECT count(*) FROM viajes'),before);assert.equal(await f.scalar('SELECT count(*) FROM tracking_operations'),0);
  assert.equal(await f.scalar('SELECT taxi_bot_simulation_fleet($1,$2)',[tenant,'+529630000099']),null);
  for(const role of['anon','authenticated'])assert.equal(await f.scalar("SELECT has_function_privilege($1,'taxi_bot_simulation_fleet(uuid,text)','EXECUTE')",[role]),false);
  assert.equal(await f.scalar("SELECT has_function_privilege('service_role','taxi_bot_simulation_fleet(uuid,text)','EXECUTE')"),true);
 }finally{await f.db.close();}
});
test('simulation SQL receipts replay exactly, refuse conflicting reuse and preserve one active operation per actor',async()=>{
 const f=await setup();try{
  const id=crypto.randomUUID(),hash='a'.repeat(64),begin=f.obj(await f.scalar('SELECT tracking_operation_begin($1,$2,$3,$4)',[42,id,'simulation',hash]));assert.equal(begin.state,'proceed');
  assert.equal(f.obj(await f.scalar('SELECT tracking_operation_begin($1,$2,$3,$4)',[42,crypto.randomUUID(),'simulation',hash])).state,'limited');
  assert.equal(await f.scalar('SELECT tracking_operation_complete($1,$2,$3,$4,$5)',[42,id,begin.lease,{state:'fixture',asOf:'2026-10-31T19:00:00Z'},200]),true);
  const replay=f.obj(await f.scalar('SELECT tracking_operation_begin($1,$2,$3,$4)',[42,id,'simulation',hash]));assert.equal(replay.state,'replay');assert.deepEqual(replay.result,{state:'fixture',asOf:'2026-10-31T19:00:00Z'});
  assert.equal(f.obj(await f.scalar('SELECT tracking_operation_begin($1,$2,$3,$4)',[42,id,'simulation','b'.repeat(64)])).state,'conflict');
 }finally{await f.db.close();}
});
test('simulation SQL allows thirty runs per actor window and retains existing audit and score ceilings',async()=>{
 const f=await setup();try{
  for(const[kind,limit,user]of[['audit',3,1],['score',12,2],['simulation',30,3]] as const){
   for(let i=0;i<limit;i++){const id=crypto.randomUUID(),begin=f.obj(await f.scalar('SELECT tracking_operation_begin($1,$2,$3,$4)',[user,id,kind,'c'.repeat(64)]));assert.equal(begin.state,'proceed');assert.equal(await f.scalar('SELECT tracking_operation_complete($1,$2,$3,$4,$5)',[user,id,begin.lease,{fixture:true},200]),true);}
   assert.equal(f.obj(await f.scalar('SELECT tracking_operation_begin($1,$2,$3,$4)',[user,crypto.randomUUID(),kind,'c'.repeat(64)])).state,'limited');
  }
 }finally{await f.db.close();}
});
test('simulation receipts expire after thirty minutes without shortening other operation history',async()=>{
 const f=await setup();try{
  for(const [user,kind,minutes]of[[101,'simulation',31],[102,'simulation',29],[103,'audit',31]] as const){await f.db.query("INSERT INTO tracking_operations(user_id,request_id,kind,fingerprint,lease,state,response_status,result,created_at,lease_until,completed_at) VALUES($1,$2,$3,$4,$5,'completed',200,'{}',clock_timestamp()-($6*interval '1 minute'),clock_timestamp(),clock_timestamp())",[user,crypto.randomUUID(),kind,'d'.repeat(64),crypto.randomUUID(),minutes]);}
  assert.equal(f.obj(await f.scalar('SELECT tracking_operation_begin($1,$2,$3,$4)',[104,crypto.randomUUID(),'simulation','e'.repeat(64)])).state,'proceed');
  const rows=await f.db.query<{user_id:number}>('SELECT user_id::integer AS user_id FROM tracking_operations ORDER BY user_id');assert.deepEqual(rows.rows.map(row=>row.user_id),[102,103,104]);
 }finally{await f.db.close();}
});
