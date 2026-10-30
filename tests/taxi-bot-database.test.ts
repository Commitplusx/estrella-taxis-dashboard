import {LIFECYCLES,type Lifecycle}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/stateMachine.ts';
import {conversationPhase}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/stateMachine.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync}from'node:fs';
import {PGlite}from'@electric-sql/pglite';
import {emptyDraft,parseSession,parseStoredInbound,record}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
import {TaxiEngine}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/engine.ts';
import {coordinateTaxi,type TaxiServices}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/coordinator.ts';
import {createTaxiServices}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/services.ts';
import {parseZones}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/adminContracts.ts';
import {taxiH3Scope}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/h3.ts';
import type{TaxiChannel,TaxiInbound}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
import type{TrackingStore}from'../estrella-taxis-backend/supabase/functions/_shared/tracking/store.ts';
import type{Fetcher}from'../estrella-taxis-backend/supabase/functions/_shared/tracking/http.ts';
import {parseInterpretation}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/policy.ts';
import {parseNeighborhoods}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/neighborhoodContracts.ts';
import {parseQualityDetail,parseQualityPage}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/qualityContracts.ts';
import {createTaxiInterpreter,TAXI_INTERPRETER_CONTRACT}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/interpreter.ts';
import {fingerprint}from'../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts';
import {parseOutgoing,sendTaxiMessage}from'../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/transport.ts';
const denyAdminWrite = async (): Promise<never> => { throw new Error('No administration writes in this fixture.'); };
const sql=readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261027220000_taxi_bot_transactions.sql',import.meta.url),'utf8');
const h3CatalogSql=readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20260901110001_create_h3_zonas.sql',import.meta.url),'utf8');
const h3PricingSql=readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261027223402_taxi_bot_h3_pricing.sql',import.meta.url),'utf8');
const adminSql=readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261028145826_taxi_bot_admin_zones.sql',import.meta.url),'utf8');
const traceSql=readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261028160342_taxi_bot_trace_state_quality.sql',import.meta.url),'utf8');
const accessSql=readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261029165842_taxi_customer_access.sql',import.meta.url),'utf8');
const mapCacheSql=readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261029194000_taxi_channel_edit_map_cache.sql',import.meta.url),'utf8');
const driverSetupSql=readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261029193220_taxi_bot_driver_setup.sql',import.meta.url),'utf8');
const baseZonesSql=readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261029195350_taxi_base_owned_zones.sql',import.meta.url),'utf8');
const baseFleetSql=readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261030134513_taxi_base_fleet.sql',import.meta.url),'utf8');
const baseContactsSql=readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261030135906_taxi_base_contacts.sql',import.meta.url),'utf8');
const personAccountsSql=readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261030180000_taxi_person_accounts.sql',import.meta.url),'utf8');
const locationRequestSql=readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261030190000_taxi_native_location_request.sql',import.meta.url),'utf8');
const optionalFareSql=readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261030200000_taxi_optional_fare.sql',import.meta.url),'utf8');
const addressGeocodeSql=readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261030201500_taxi_address_geocoding.sql',import.meta.url),'utf8');
const neighborhoodsSql=readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261030210000_taxi_neighborhoods.sql',import.meta.url),'utf8');
const dispatchSafetySql=readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261030223000_taxi_dispatch_safety.sql',import.meta.url),'utf8');
const conversationEmojisSql=readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261030234500_taxi_conversation_emojis.sql',import.meta.url),'utf8');
const pdfLocalFaresSql=readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261031120000_taxi_document_local_fares.sql',import.meta.url),'utf8');
const localitySeparationSql=readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261031160000_taxi_written_localities_h3_separation.sql',import.meta.url),'utf8');
const gpsBookingSql=readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261031170000_taxi_gps_pickup_button_booking.sql',import.meta.url),'utf8');
const privateReferenceQuoteSql=readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261031173000_taxi_reference_quote_private_reads.sql',import.meta.url),'utf8');
const resetMinimumSql=readFileSync(new URL('../estrella-taxis-backend/supabase/migrations/20261031180000_taxi_conversation_reset_minimum.sql',import.meta.url),'utf8');
const tenant='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',waba='+529630000001',customer='+529630000002',driverPhone='+529630000003';
const pompeyo='4cf9acf1-f07e-4a01-9396-eb5bde3e7411';

test('minimum fare SQL: pickup, GPS route and written locality respect the configured base minimum without rewriting source tariffs',async()=>{
 const f=await fixture();try{
  await f.prepare();const scope=await f.seedH3();await f.db.query('UPDATE taxi_bot_channels SET base_cents=5500 WHERE tenant_id=$1',[tenant]);
  const amount=async(name:string,args:unknown[])=>f.obj(await f.scalar('SELECT '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+')',args)).cents;
  assert.equal(await amount('taxi_bot_h3_quote',[tenant,waba,scope.originCell,scope.originCell]),5500);
  assert.equal(await amount('taxi_bot_h3_quote',[tenant,waba,scope.originCell,scope.destinationCell]),6500);
  assert.equal(await amount('taxi_bot_pickup_quote',[tenant,waba,scope.originCell,null]),5500);
  await f.db.query("INSERT INTO taxi_bot_localities(tenant_id,category,label,fare_cents)VALUES($1,'barrio','Barrio sintético',4900)",[tenant]);
  const localities=parseNeighborhoods(await f.scalar('SELECT taxi_bot_neighborhood_read($1)',[tenant])),r=localities[0],area={label:r.label,category:r.category,version:r.version,cents:r.cents,cell:null,priceSource:'reference'};
  assert.equal(await amount('taxi_bot_pickup_quote',[tenant,waba,scope.originCell,area]),5500);
  assert.equal(await amount('taxi_bot_h3_quote_with_references',[tenant,waba,scope.originCell,scope.originCell,null,{...area,cell:scope.originCell,reference:'Calle Primera 20, portón azul'}]),5500);
  const draft={...f.draft,destination:null,quoteBasis:'pickup',quoteH3:taxiH3Scope(f.draft.origin,f.draft.origin),quoteCents:4500};
  await assert.rejects(f.scalar('SELECT taxi_bot_validate_quote($1,$2,$3)',[tenant,waba,draft]),/below minimum fare/);
  await f.scalar('SELECT taxi_bot_validate_quote($1,$2,$3)',[tenant,waba,{...draft,quoteCents:5500}]);
  assert.equal(await f.scalar('SELECT price_cents FROM taxi_bot_base_zones WHERE tenant_id=$1 AND h3_index=$2',[tenant,scope.originCell]),4500);
  assert.equal(await f.scalar('SELECT fare_cents FROM taxi_bot_localities WHERE tenant_id=$1',[tenant]),4900);
 }finally{await f.db.close();}
});
test('Pompeyo minimum migration: only its reviewed channel receives 55 pesos and a new revision',async()=>{
 const f=await fixture();try{
  // Recreate both production constraints and its enabled legacy row, including the conflict on clearing the self-recipient.
  await f.db.exec('ALTER TABLE taxi_bot_channels DROP CONSTRAINT IF EXISTS taxi_bot_channels_check; ALTER TABLE taxi_bot_channels ADD CONSTRAINT taxi_bot_channels_check CHECK(NOT enabled OR dispatcher IS NOT NULL)');
  await f.db.exec('ALTER TABLE taxi_bot_channels DROP CONSTRAINT taxi_bot_dispatcher_must_be_person');
  await f.db.query("INSERT INTO taxi_bot_channels(tenant_id,waba,name,city,center_lat,center_lng,radius_km,base_cents,revision,dispatcher,enabled)VALUES($1,'+529630002491','Pompeyo sintético','Comitán',16.25,-92.13,20,NULL,5,'+529630002491',true)",[pompeyo]);
  await f.db.exec('ALTER TABLE taxi_bot_channels ADD CONSTRAINT taxi_bot_dispatcher_must_be_person CHECK(dispatcher IS NULL OR taxi_bot_customer_phone(dispatcher)IS DISTINCT FROM taxi_bot_customer_phone(waba))NOT VALID');
  await assert.rejects(f.db.query('UPDATE taxi_bot_channels SET base_cents=5500 WHERE tenant_id=$1',[pompeyo]),/taxi_bot_dispatcher_must_be_person/);
  await assert.rejects(f.db.query('UPDATE taxi_bot_channels SET dispatcher=NULL WHERE tenant_id=$1',[pompeyo]),/taxi_bot_channels_check/);
  const otherBase=await f.scalar('SELECT base_cents FROM taxi_bot_channels WHERE tenant_id=$1',[tenant]);await f.db.exec(resetMinimumSql);
  assert.equal(await f.scalar('SELECT base_cents FROM taxi_bot_channels WHERE tenant_id=$1',[pompeyo]),5500);assert.equal(await f.scalar('SELECT revision FROM taxi_bot_channels WHERE tenant_id=$1',[pompeyo]),6);
  assert.equal(await f.scalar('SELECT dispatcher FROM taxi_bot_channels WHERE tenant_id=$1',[pompeyo]),null);
  assert.equal(await f.scalar('SELECT enabled FROM taxi_bot_channels WHERE tenant_id=$1',[pompeyo]),true);
  assert.equal(await f.scalar('SELECT base_cents FROM taxi_bot_channels WHERE tenant_id=$1',[tenant]),otherBase);
 }finally{await f.db.close();}
});

test('panel attention: an enabled channel without an alert phone still persists human handoff and dispatches offers to its drivers',async()=>{
 const f=await fixture();try{
  await f.prepare();
  const payload={name:'Base sintética',city:'Comitán',dispatcher:null,centerLat:16.25,centerLng:-92.13,radiusKm:20,pricingMode:'h3_zone_max',baseCents:null,perKmCents:null,enabled:true};
  assert.equal((await f.admin('configure',payload)).state,'saved');
  const first=await f.enqueue('Necesito una persona'),claim=await f.begin(first.eventId);
  await f.commit(first.eventId,claim,{...f.decision('human'),messages:[{to:customer,text:'La base te atiende desde el panel.'}]});
  assert.equal(await f.scalar('SELECT mode FROM taxi_bot_sessions WHERE customer=$1',[customer]),'human');
  assert.equal(await f.scalar("SELECT count(*)::int FROM taxi_bot_turn_traces WHERE event_id=$1 AND action='human'",[first.eventId]),1);
  await f.admin('resume',{customer},2);
  const review=await f.enqueue('Un taxi'),reviewClaim=await f.begin(review.eventId);await f.commit(review.eventId,reviewClaim,f.decision());
  const confirmed=await f.confirm();assert.equal(confirmed.result.state,'committed');
  assert.equal(await f.scalar("SELECT count(*)::int FROM taxi_bot_outbox WHERE destination=$1 AND dedupe_key LIKE 'offer:%'",[driverPhone]),1);
  assert.equal(await f.scalar("SELECT count(*)::int FROM taxi_bot_outbox WHERE destination=$1 AND dedupe_key LIKE 'dispatch:%'",[waba]),0);
 }finally{await f.db.close();}
});
test('conversation reset SQL: clears context, rejects old GPS and button, supersedes pending replies and replays once',async()=>{
 const f=await fixture();try{
  await f.prepare();await f.scalar('SELECT taxi_bot_emit($1,$2,$3,$4,$5)',[tenant,waba,customer,'Pregunta anterior','reply:previous:1']);
  const old=(await f.db.query<Record<string,unknown>>('SELECT * FROM taxi_bot_outbox_claim($1,$2)',[tenant,waba])).rows[0];assert.ok(old);assert.equal(await f.scalar('SELECT taxi_bot_outbox_permitted($1,$2)',[old.id,old.lease]),true);
  const event=await f.enqueue('/reset'),claim=await f.begin(event.eventId),reset={...f.decision(),action:'reset',confirmation:null,tripId:null,offerId:null,candidates:[],messages:[{to:customer,text:'Conversación reiniciada',locationRequest:'origin'}],reason:'conversation_reset'};
  await f.commit(event.eventId,claim,reset);
  const draft=f.obj(await f.scalar('SELECT draft FROM taxi_bot_sessions WHERE customer=$1',[customer]));assert.equal(draft.name,null);assert.equal(draft.origin,null);assert.equal(draft.confirmation,null);assert.equal(draft.awaitingLocation,'origin');assert.equal(draft.pickupMessageId,undefined);
  const history=JSON.stringify(await f.scalar('SELECT history FROM taxi_bot_sessions WHERE customer=$1',[customer]));assert.match(history,/reset/);assert.doesNotMatch(history,/Persona Prueba|Terminal|Pregunta anterior/);
  assert.equal(await f.scalar('SELECT taxi_bot_outbox_permitted($1,$2)',[old.id,old.lease]),false);
  await f.scalar('SELECT taxi_bot_outbox_complete($1,$2,$3,$4,$5)',[old.id,old.lease,'failed',null,'outbox_no_longer_permitted']);
  const current=(await f.db.query<Record<string,unknown>>('SELECT * FROM taxi_bot_outbox_claim($1,$2)',[tenant,waba])).rows[0];assert.ok(current);assert.equal(await f.scalar('SELECT taxi_bot_outbox_permitted($1,$2)',[current.id,current.lease]),true);
  await assert.rejects(f.scalar('SELECT taxi_bot_validate_pickup($1,$2,$3,$4)',[tenant,waba,customer,f.draft]),/verified pickup GPS required/);
  assert.equal((await f.commit(event.eventId,claim,reset)).state,'replay');assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_outbox'),2);
  const oldButton=await f.enqueueButton(),oldClaim=await f.begin(oldButton.eventId);
  await assert.rejects(f.commit(oldButton.eventId,oldClaim,{...f.decision('confirm'),confirmation:f.draft.confirmation}),/current confirmation button required/);
  await f.commit(oldButton.eventId,oldClaim,{...f.decision('reply')});assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),0);
  const freshId=crypto.randomUUID(),fresh=await f.enqueue('',customer,freshId,null,{lat:f.draft.origin.lat,lng:f.draft.origin.lng});
  // Ordinary fixtures backdate receive times to bypass debounce. A fresh pin must stay after the reset boundary.
  await f.db.query('UPDATE taxi_bot_events SET received_at=clock_timestamp()WHERE id=$1',[fresh.eventId]);
  await new Promise<void>(resolve=>setTimeout(resolve,1700));
  const freshClaim=await f.begin(fresh.eventId);
  const freshDraft={...f.draft,pickupMessageId:freshId,destination:null,quoteBasis:'pickup',quoteCents:4500,quoteH3:taxiH3Scope(f.draft.origin,f.draft.origin),confirmation:crypto.randomUUID()};
  await f.commit(fresh.eventId,freshClaim,{...f.decision('draft'),draft:freshDraft});assert.equal(await f.scalar("SELECT draft->>'pickupMessageId'FROM taxi_bot_sessions WHERE customer=$1",[customer]),freshId);
 }finally{await f.db.close();}
});
test('conversation reset SQL: cannot be fabricated from another ordinary text or a quoted command',async()=>{
 const f=await fixture();try{
  for(const text of ['Hola','¿Qué hace /reset?']){const event=await f.enqueue(text),claim=await f.begin(event.eventId);await assert.rejects(f.commit(event.eventId,claim,{...f.decision(),action:'reset'}),/explicit reset command required/);await f.commit(event.eventId,claim,{...f.decision('reply')});}
  assert.equal(await f.scalar('SELECT last_reset_at FROM taxi_bot_sessions WHERE customer=$1',[customer]),null);
 }finally{await f.db.close();}
});
for(const human of [false,true])test('conversation reset SQL: preserves '+(human?'human ownership':'a searching trip and its offers'),async()=>{
 const f=await fixture();try{
  await f.prepare();if(human)await f.db.query("UPDATE taxi_bot_sessions SET mode='human'WHERE customer=$1",[customer]);else await f.confirm();
  const trips=await f.scalar('SELECT jsonb_agg(to_jsonb(v))FROM viajes v'),offers=await f.scalar('SELECT jsonb_agg(to_jsonb(o)ORDER BY id)FROM taxi_bot_offers o');
  const event=await f.enqueue('/reset'),claim=await f.begin(event.eventId);await f.commit(event.eventId,claim,{...f.decision(),action:'reset',messages:[{to:customer,text:'Conversación reiniciada. Tu atención actual continúa.'}]});
  assert.equal(await f.scalar('SELECT mode FROM taxi_bot_sessions WHERE customer=$1',[customer]),human?'human':'bot');assert.equal(await f.scalar("SELECT draft->>'awaitingLocation' FROM taxi_bot_sessions WHERE customer=$1",[customer]),null);
  assert.deepEqual(await f.scalar('SELECT jsonb_agg(to_jsonb(v))FROM viajes v'),trips);assert.deepEqual(await f.scalar('SELECT jsonb_agg(to_jsonb(o)ORDER BY id)FROM taxi_bot_offers o'),offers);
 }finally{await f.db.close();}
});

test('native pin persistence: a failed model turn survives SQL commit, role clarification and resumed name capture without creating a trip',async()=>{
 const f=await fixture();try{
  await f.seedH3();let modelCalls=0;
  const channel:TaxiChannel={tenantId:tenant,waba,enabled:true,name:'Base sintética',city:'Comitán',centerLat:16.25,centerLng:-92.13,radiusKm:20,dispatcher:null,model:'fixture',baseCents:null,perKmCents:null,pricingMode:'h3_zone_max'};
  const services:TaxiServices={interpret:async(text)=>{modelCalls++;if(text==='y otra cosa')throw Error('Declared provider outage');assert.equal(text,'Soy Mariana');return parseInterpretation({intent:'provide',fields:{name:{value:'Mariana',evidence:text}}},text);},resolve:async()=>{throw Error('No textual resolver expected');},quote:async()=>4500,candidates:async()=>{throw Error('No current click, no dispatch');}};
  const turn=async(event:Record<string,unknown>)=>{const claim=await f.begin(event.eventId);assert.equal(claim.state,'proceed');assert.ok(Array.isArray(claim.messages));const decision=await coordinateTaxi(claim.messages.map(item=>parseStoredInbound(item,Date.now())),parseSession(claim.session),channel,services,Date.now());await f.commit(claim.eventId,claim,{...decision});return decision;};
  const pinId=crypto.randomUUID(),pin=await f.enqueue('',customer,pinId,null,{lat:16.25,lng:-92.13});await f.enqueue('y otra cosa');
  const first=await turn(pin);assert.equal(first.draft.pendingLocation?.messageId,pinId);assert.equal(first.draft.confirmation,null);
  assert.equal(await f.scalar("SELECT draft->'pendingLocation'->>'messageId' FROM taxi_bot_sessions WHERE customer=$1",[customer]),pinId);
  const selected=await turn(await f.enqueue('ahí me recoges'));assert.equal(selected.draft.pickupMessageId,pinId);assert.equal(selected.draft.origin?.source,'gps');assert.equal(selected.draft.confirmation,null);
  const reviewed=await turn(await f.enqueue('Soy Mariana'));assert.equal(reviewed.draft.name,'Mariana');assert.equal(reviewed.draft.pickupMessageId,pinId);assert.equal(reviewed.draft.quoteCents,4500);assert.ok(reviewed.draft.confirmation);assert.equal(modelCalls,2);
  assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),0);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_offers'),0);
  assert.equal(await f.scalar("SELECT count(*)::int FROM taxi_bot_events WHERE state='completed'"),4);
 }finally{await f.db.close();}
});

test('GPS button consent SQL: typed assent cannot create trips, offers or notifications; the current click works once without a destination',async()=>{
 const f=await fixture();try{
  await f.prepare();const scope=taxiH3Scope(f.draft.origin,f.draft.origin),draft={...f.draft,destination:null,destinationText:null,quoteBasis:'pickup',quoteCents:4500,quoteH3:scope,confirmation:crypto.randomUUID()};
  const edit=await f.enqueue('Sin destino por ahora'),ec=await f.begin(edit.eventId);await f.commit(edit.eventId,ec,{...f.decision(),draft});
  const assent=await f.enqueue('sí, mándalo'),sc=await f.begin(assent.eventId);
  await assert.rejects(f.commit(assent.eventId,sc,{...f.decision('confirm'),confirmation:draft.confirmation,candidates:[{deviceId:1,name:'Unidad 1'}]}),/current confirmation button required/);
  assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),0);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_offers'),0);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_outbox'),0);
  await f.commit(assent.eventId,sc,{...f.decision('reply'),draft});
  const click=await f.enqueueButton(customer,draft.confirmation),cc=await f.begin(click.eventId),decision={...f.decision('confirm'),confirmation:draft.confirmation,candidates:[{deviceId:1,name:'Unidad 1'}]};
  const result=await f.commit(click.eventId,cc,decision);assert.equal(result.state,'committed');assert.equal((await f.commit(click.eventId,cc,decision)).state,'replay');
  assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),1);assert.equal(await f.scalar('SELECT bot_quote_cents FROM viajes'),4500);assert.equal(await f.scalar('SELECT destino FROM viajes'),'Destino por indicar al conductor');
 }finally{await f.db.close();}
});
test('GPS pickup proof SQL: a copied pin of another passenger, modified coordinates or missing native message cannot authorize a summary',async()=>{
 const f=await fixture();try{
  await f.prepare();const validate=(draft:unknown,phone=customer)=>f.scalar('SELECT taxi_bot_validate_pickup($1,$2,$3,$4)',[tenant,waba,phone,draft]);await validate(f.draft);
  await assert.rejects(validate(f.draft,driverPhone),/verified pickup GPS required/);
  await assert.rejects(validate({...f.draft,pickupMessageId:'invented'}),/verified pickup GPS required/);
  await assert.rejects(validate({...f.draft,origin:{...f.draft.origin,lat:16.255}}),/verified pickup GPS required/);
  await assert.rejects(validate({...f.draft,origin:{...f.draft.origin,source:'written'}}),/verified pickup GPS required/);
  const audit={version:'taxi-trace-v1',steps:[{phase:'interpret',outcome:'ok',durationMs:1,inputHash:'a'.repeat(64),outputHash:'b'.repeat(64),code:'ok',fields:['pickupReference']}],durationMs:1,interpretationPrivate:{intent:'provide',fields:{pickupReference:{value:'Portón azul',evidence:'Portón azul'}}}};
  assert.equal(await f.scalar('SELECT taxi_bot_trace_packet_valid($1)',[audit]),true);
 }finally{await f.db.close();}
});
test('locality quote permission: service role can quote a geocoded destination through private RPC without reading the locality table',async()=>{
 const f=await fixture();try{
  const scope=await f.seedH3();await f.db.query("INSERT INTO taxi_bot_localities(tenant_id,category,label,fare_cents)VALUES($1,'barrio','Pilita Seca',5500)",[tenant]);
  const rows=parseNeighborhoods(await f.scalar('SELECT taxi_bot_neighborhood_read($1)',[tenant])),r=rows[0];
  const area={label:r.label,category:r.category,version:r.version,cents:r.cents,cell:scope.destinationCell,priceSource:'reference',reference:'Frente a la cancha, portón azul'};
  assert.equal(await f.scalar("SELECT has_table_privilege('service_role','public.taxi_bot_localities','SELECT')"),false);
  for(const role of ['anon','authenticated'])assert.equal(await f.scalar("SELECT has_function_privilege($1,'public.taxi_bot_h3_quote_with_references(uuid,text,text,text,jsonb,jsonb)','EXECUTE')",[role]),false);
  await f.db.exec('SET ROLE service_role');
  const quote=f.obj(await f.scalar('SELECT taxi_bot_h3_quote_with_references($1,$2,$3,$4,$5,$6)',[tenant,waba,scope.originCell,scope.destinationCell,null,area]));assert.equal(quote.state,'priced');assert.equal(quote.cents,5500);
 }finally{await f.db.exec('RESET ROLE');await f.db.close();}
});
test('written locality SQL: reads only the separate text directory, never H3 groups, and remains private',async()=>{
 const f=await fixture();try{
  await f.seedH3();await f.db.query("INSERT INTO taxi_bot_localities(tenant_id,category,label,fare_cents)VALUES($1,'barrio','El Piedrón',5500)",[tenant]);
  const rows=await f.scalar('SELECT taxi_bot_neighborhood_read($1)',[tenant]);assert.ok(Array.isArray(rows)&&rows.length===1);const row=f.obj(rows[0]);
  assert.equal(row.category,'barrio');assert.deepEqual(row.cells,[]);assert.equal(row.priceSource,'reference');assert.equal(row.cents,5500);
  assert.deepEqual(await f.scalar('SELECT taxi_bot_neighborhood_read($1)',[other]),[]);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_base_zones WHERE tenant_id=$1',[tenant]),2);
  for(const role of ['anon','authenticated']){await f.db.exec('SET ROLE '+role);await assert.rejects(f.scalar('SELECT taxi_bot_neighborhood_read($1)',[tenant]),/permission denied/);await assert.rejects(f.scalar('SELECT * FROM taxi_bot_localities'),/permission denied/);await f.db.exec('RESET ROLE');}
 }finally{await f.db.close();}
});
test('written locality SQL: create and edit change only the text fare; H3 prices and map version stay untouched',async()=>{
 const f=await fixture();try{
  const scope=await f.seedH3(),before=await f.scalar('SELECT version FROM taxi_bot_map_version WHERE id');
  const request=crypto.randomUUID(),payload={label:'El Piedrón',category:'barrio',aliases:['Piedron conocido'],description:'Junto a la escuela de prueba',cents:7200};
  const save=(p=payload,id=request,label:string|null=null,category:string|null=null,expected:string|null=null)=>f.scalar('SELECT taxi_bot_neighborhood_apply($1,$2,$3,$4,$5,$6,$7)',[tenant,42,id,label,category,expected,p]);
  const first=f.obj(await save()),created=f.obj(first.neighborhood);assert.equal(first.state,'saved');assert.equal(created.category,'barrio');assert.deepEqual(await save(),first);assert.equal(f.obj(await save({...payload,cents:7300})).state,'request_conflict');
  assert.equal(await f.scalar('SELECT version FROM taxi_bot_map_version WHERE id'),before);assert.equal(await f.scalar('SELECT price_cents FROM taxi_bot_base_zones WHERE tenant_id=$1 AND h3_index=$2',[tenant,scope.originCell]),4500);
  const updateId=crypto.randomUUID(),createdLabel=asString(created.label),createdCategory=asString(created.category),createdVersion=asString(created.version),updatedResult=f.obj(await save({...payload,cents:7600},updateId,createdLabel,createdCategory,createdVersion));assert.equal(updatedResult.state,'saved');
  const updated=f.obj(updatedResult.neighborhood);assert.equal(updated.cents,7600);assert.notEqual(updated.version,created.version);
  assert.equal(f.obj(await save(payload,crypto.randomUUID(),createdLabel,createdCategory,createdVersion)).state,'revision_conflict');
  assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_neighborhood_operations'),2);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_base_zones WHERE tenant_id=$1',[tenant]),2);
 }finally{await f.db.close();}
});
test('written locality SQL: category-safe alias edits cannot mutate H3 and an H3 tariff change does not alter the locality',async()=>{
 const f=await fixture();try{
  const scope=await f.seedH3();await f.db.query("INSERT INTO taxi_bot_localities(tenant_id,category,label,fare_cents)VALUES($1,'colonia','La Esmeralda',5500),($1,'colonia','Otra colonia',6500)",[tenant]);
  const rows=await f.scalar('SELECT taxi_bot_neighborhood_read($1)',[tenant]);assert.ok(Array.isArray(rows));const origin=f.obj(rows.find(r=>f.obj(r).label==='La Esmeralda'));
  const area={label:origin.label,category:origin.category,version:origin.version,cents:origin.cents,cell:scope.originCell,priceSource:'reference',reference:'Calle Primera número 20'};
  const draft={...f.draft,destination:null,destinationArea:area,destinationText:'La Esmeralda',quoteCents:5500,quoteH3:{originCell:scope.originCell,destinationCell:scope.originCell}};
  await f.scalar('SELECT taxi_bot_validate_quote($1,$2,$3)',[tenant,waba,draft]);
  assert.equal(await f.scalar('SELECT taxi_bot_street_reference($1,$2)',['Cerca de la iglesia',origin.label]),true);
  assert.equal(await f.scalar('SELECT taxi_bot_street_reference($1,$2)',['Por ahí',origin.label]),false);
  assert.equal(await f.scalar('SELECT taxi_bot_street_reference($1,$2)',['Calle 5, cerca de la escuela\u0001',origin.label]),false);
  await assert.rejects(f.scalar('SELECT taxi_bot_validate_quote($1,$2,$3)',[tenant,waba,{...draft,originArea:area}]),/locality clarification required/);
  await assert.rejects(f.scalar('SELECT taxi_bot_validate_quote($1,$2,$3)',[tenant,waba,{...draft,destinationArea:{...area,version:'f'.repeat(32)}}]),/locality changed/);
  const args=[tenant,42,crypto.randomUUID(),origin.label,origin.category,origin.version,{label:origin.label,category:origin.category,aliases:['Otra colonia'],description:'',cents:4500}];assert.equal(f.obj(await f.scalar('SELECT taxi_bot_neighborhood_apply($1,$2,$3,$4,$5,$6,$7)',args)).state,'alias_conflict');
  await f.db.query('UPDATE taxi_bot_base_zones SET price_cents=4700 WHERE tenant_id=$1 AND h3_index=$2',[tenant,scope.originCell]);
  await f.scalar('SELECT taxi_bot_validate_quote($1,$2,$3)',[tenant,waba,draft]);assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),0);
 }finally{await f.db.close();}
});
test('locality import: PDF fares are categorized separately and do not change the H3 fare map',async()=>{
 const f=await fixture({seedPdfLocalFares:true});try{
  assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_base_zones WHERE tenant_id=$1',[pompeyo]),293);
  const restore=[...localitySeparationSql.matchAll(/\('([^']+)','([^']+)',(\d+),(\d+)\)/g)].map(match=>({cell:match[1],label:match[2],old:Number(match[3])}));
  assert.equal(restore.length,293);for(const row of restore)assert.equal(await f.scalar('SELECT price_cents FROM taxi_bot_base_zones WHERE tenant_id=$1 AND h3_index=$2 AND label=$3',[pompeyo,row.cell,row.label]),row.old);
  assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_neighborhoods WHERE tenant_id=$1 AND reference_price_cents IS NOT NULL',[pompeyo]),0);
  const rows=await f.scalar('SELECT taxi_bot_neighborhood_read($1)',[pompeyo]);assert.ok(Array.isArray(rows));assert.ok(rows.length>150&&rows.length<250);
  assert.equal(parseNeighborhoods(rows).length,rows.length,'the full categorized fare sheet satisfies the bot API contract');
  const localities=rows.map(f.obj);assert.ok(localities.every(row=>Array.isArray(row.cells)&&row.cells.length===0&&row.priceSource==='reference'&&typeof row.category==='string'));
  const piedron=localities.find(row=>row.category==='barrio'&&row.label==='El Piedrón');assert.equal(piedron?.cents,5500);
  const rosarios=localities.filter(row=>row.label==='Rosario Castellanos');assert.equal(rosarios.length,1);assert.equal(rosarios[0].cents,null,'conflicting printed fares stay out of automatic quotes');
  const june=localities.filter(row=>row.label==='27 de Junio');assert.deepEqual(june.map(row=>[row.category,row.cents]).sort(),[['colonia',5500],['lugar',13500]]);
 }finally{await f.db.close();}
});
test('text locality price combines only with a separate GPS H3 price, and edits invalidate stale quotes',async()=>{
 const f=await fixture();try{
  const scope=await f.seedH3();await f.db.query("INSERT INTO taxi_bot_localities(tenant_id,category,label,fare_cents)VALUES($1,'colonia','La Esmeralda',5500)",[tenant]);
  await f.db.query('DELETE FROM taxi_bot_base_zones WHERE tenant_id=$1 AND h3_index=$2',[tenant,scope.destinationCell]);
  const rows=await f.scalar('SELECT taxi_bot_neighborhood_read($1)',[tenant]);assert.ok(Array.isArray(rows));const ref=f.obj(rows.find(value=>f.obj(value).label==='La Esmeralda'));
  const area={label:ref.label,category:ref.category,version:ref.version,cents:ref.cents,cell:scope.originCell,priceSource:'reference',reference:'Calle Norte número 20'};
  const quote=f.obj(await f.scalar('SELECT taxi_bot_pickup_quote($1,$2,$3,$4)',[tenant,waba,scope.originCell,area]));assert.equal(quote.state,'priced');assert.equal(quote.cents,5500);
  const draft={...f.draft,destination:null,destinationArea:area,destinationText:'La Esmeralda',quoteCents:5500,quoteH3:{originCell:scope.originCell,destinationCell:scope.originCell}};await f.scalar('SELECT taxi_bot_validate_quote($1,$2,$3)',[tenant,waba,draft]);
  const saved=f.obj(await f.scalar('SELECT taxi_bot_neighborhood_apply($1,$2,$3,$4,$5,$6,$7)',[tenant,42,crypto.randomUUID(),ref.label,ref.category,ref.version,{label:ref.label,category:ref.category,aliases:[],description:'',cents:7200}]));assert.equal(saved.state,'saved');assert.equal(f.obj(saved.neighborhood).cents,7200);
  await assert.rejects(f.scalar('SELECT taxi_bot_validate_quote($1,$2,$3)',[tenant,waba,draft]),/taxi locality changed/);
  assert.equal(await f.scalar('SELECT price_cents FROM taxi_bot_base_zones WHERE tenant_id=$1 AND h3_index=$2',[tenant,scope.originCell]),4500);
 }finally{await f.db.close();}
});
test('locality SQL: confirmed written address and street reference persist in trip and driver message, replay creates one trip',async()=>{
 const f=await fixture();try{
  await f.seedH3();await f.db.query("INSERT INTO taxi_bot_localities(tenant_id,category,label,fare_cents)VALUES($1,'barrio','Centro',5500)",[tenant]);await f.prepare();const rows=await f.scalar('SELECT taxi_bot_neighborhood_read($1)',[tenant]);assert.ok(Array.isArray(rows));const r=f.obj(rows.find(r=>f.obj(r).label==='Centro'));
  const area={label:r.label,category:r.category,version:r.version,cents:r.cents,cell:taxiH3Scope(f.draft.origin,f.draft.destination).originCell,priceSource:'reference',reference:'Frente a la escuela, casa azul'};
  await f.db.query("UPDATE taxi_bot_sessions SET draft=$1",[{...f.draft,pickupText:'Calle Central número 10. '+area.reference}]);
  const confirmed=await f.confirm();assert.equal(confirmed.result.state,'committed');assert.equal((await f.commit(confirmed.event.eventId,confirmed.claim,{...f.decision('confirm'),confirmation:f.draft.confirmation})).state,'replay');
  assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),1);assert.equal(await f.scalar('SELECT bot_origin_area FROM viajes'),null);assert.equal(await f.scalar('SELECT bot_quote_cents FROM viajes'),6500);
  assert.equal(await f.scalar("SELECT count(*)::int FROM taxi_bot_outbox WHERE destination=$1 AND body->>'text' LIKE '%Calle Central%'AND body->>'text' LIKE '%casa azul%'",[driverPhone]),1);
 }finally{await f.db.close();}
});
test('mandatory fare SQL: confirmed route stores the server price, never a missing or fictitious zero fare',async()=>{
 const f=await fixture();try{
  await f.seedH3();await f.prepare();await f.confirm();assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),1);
  assert.equal(await f.scalar('SELECT bot_quote_cents FROM viajes'),6500);assert.deepEqual(await f.scalar('SELECT bot_quote_h3 FROM viajes'),f.draft.quoteH3);
 }finally{await f.db.close();}
});
test('mandatory fare SQL: unquoted mode is refused and service coverage and channel remain authoritative',async()=>{
 const f=await fixture();try{
  const validate=(d:unknown)=>f.scalar('SELECT taxi_bot_validate_quote($1,$2,$3)',[tenant,waba,d]);
  await assert.rejects(validate({...f.draft,fareMode:'unquoted',quoteCents:1}),/server fare required/);
  await assert.rejects(validate({...f.draft,fareMode:'invalid'}),/server fare required/);
  await assert.rejects(validate({...f.draft,origin:{...f.draft.origin,lat:0,lng:0}}),/coverage changed/);
  await f.db.exec('UPDATE taxi_bot_channels SET enabled=false');await assert.rejects(validate(f.draft),/channel unavailable/);
 }finally{await f.db.close();}
});
test('OSM address SQL: cache claims, result reuse, tenant scope and lease ownership are durable',async()=>{
 const f=await fixture();try{
  const key='a'.repeat(64),lookup=(base=tenant,lease:unknown=null,result:unknown=null)=>f.scalar('SELECT taxi_bot_address_lookup($1,$2,$3,$4)',[base,key,lease,result]);
  const first=f.obj(await lookup());assert.equal(first.state,'fetch');assert.equal(f.obj(await lookup()).state,'busy');
  assert.equal(f.obj(await lookup(tenant,crypto.randomUUID(),{kind:'unavailable'})).state,'stale');
  assert.equal(f.obj(await lookup(tenant,first.lease,{kind:'unavailable'})).state,'saved');assert.equal(f.obj(await lookup()).state,'cached');
  assert.equal(f.obj(await lookup(other)).state,'fetch');assert.equal(await f.scalar("SELECT has_function_privilege('authenticated','taxi_bot_address_lookup(uuid,text,uuid,jsonb)','EXECUTE')"),false);
 }finally{await f.db.close();}
});
test('OSM address SQL: concurrency, global quota and tenant cache size are explicitly bounded',async()=>{
 const f=await fixture();try{
  const lookup=(key:string)=>f.scalar('SELECT taxi_bot_address_lookup($1,$2,$3,$4)',[tenant,key,null,null]);
  assert.equal(f.obj(await lookup('a'.repeat(64))).state,'fetch');assert.equal(f.obj(await lookup('b'.repeat(64))).state,'fetch');assert.equal(f.obj(await lookup('c'.repeat(64))).state,'limited');
  await f.db.exec("UPDATE taxi_bot_address_cache SET lease_until=now()-interval '1 second'");assert.equal(f.obj(await lookup('c'.repeat(64))).state,'fetch');
  await f.db.exec('UPDATE taxi_bot_address_budget SET requests=30');assert.equal(f.obj(await lookup('d'.repeat(64))).state,'limited');
  await f.db.exec("UPDATE taxi_bot_address_budget SET requests=0;UPDATE taxi_bot_address_cache SET lease=NULL,lease_until=NULL;INSERT INTO taxi_bot_address_cache(tenant_id,query_hash,expires_at)SELECT '"+tenant+"',lpad(to_hex(n),64,'0'),now()+interval '1 day'FROM generate_series(1,500)n");
  assert.equal(f.obj(await lookup('e'.repeat(64))).state,'limited');
 }finally{await f.db.close();}
});
test('native location SQL: commit stores role and revision once; provider receives the actual persisted native request',async()=>{
 const f=await fixture();try{
  const e=await f.enqueue('Hola'),claim=await f.begin(e.eventId),d={...f.decision(),draft:{...emptyDraft(),awaitingLocation:'origin'},messages:[{to:customer,text:'¿Dónde te recogemos?',locationRequest:'origin'}]};
  assert.equal((await f.commit(e.eventId,claim,d)).state,'committed');assert.equal((await f.commit(e.eventId,claim,d)).state,'replay');
  const row=(await f.db.query<Record<string,unknown>>('SELECT * FROM taxi_bot_outbox')).rows[0];assert.equal(f.obj(row.body).locationRequest,'origin');assert.equal(f.obj(row.body).locationRevision,1);
  const sent=(await f.db.query<Record<string,unknown>>('SELECT * FROM taxi_bot_outbox_claim($1,$2)',[tenant,waba])).rows[0];
  assert.equal(await f.scalar('SELECT taxi_bot_outbox_permitted($1,$2)',[sent.id,sent.lease]),true);let calls=0;
  const result=await sendTaxiMessage(parseOutgoing(sent),'fixture-key',async(_url,init)=>{calls++;const body:unknown=JSON.parse(String(init?.body));assert.ok(record(body));assert.equal(f.obj(body.interactive).type,'location_request_message');assert.deepEqual(f.obj(body.interactive).action,{name:'send_location'});return Response.json({id:'provider-fixture'});});
  assert.equal(result.state,'accepted');assert.equal(calls,1);assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),0);
 }finally{await f.db.close();}
});
test('native location SQL: malformed, mixed, wrong-role or non-draft request rolls back without output',async()=>{
 const f=await fixture();try{
  const e=await f.enqueue('Hola'),claim=await f.begin(e.eventId),d={...f.decision(),draft:{...emptyDraft(),awaitingLocation:'origin'},messages:[{to:customer,text:'Recogida',locationRequest:'origin'}]};
  for(const altered of [
   {...d,action:'reply'}, {...d,messages:[{...d.messages[0],locationRequest:'destination'}]},
   {...d,messages:[{...d.messages[0],locationRequest:null}]}, {...d,messages:[{...d.messages[0],buttons:[{id:'x',title:'Otro'}]}]},
  ])await assert.rejects(f.commit(e.eventId,claim,altered),/invalid location request/);
  assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_outbox'),0);assert.equal(await f.scalar('SELECT revision::int FROM taxi_bot_sessions'),0);
  assert.equal(await f.scalar("SELECT has_function_privilege('authenticated','taxi_bot_location_request_current(uuid,text,text,jsonb)','EXECUTE')"),false);
 }finally{await f.db.close();}
});
test('native location SQL: a replaced request is discarded before claim and a claimed stale request loses send permission',async()=>{
 const f=await fixture();try{
  const first=await f.enqueue('Hola'),fc=await f.begin(first.eventId),request={...f.decision(),draft:{...emptyDraft(),awaitingLocation:'origin'},messages:[{to:customer,text:'Recogida',locationRequest:'origin'}]};
  await f.commit(first.eventId,fc,request);
  const second=await f.enqueue('Otra pregunta'),sc=await f.begin(second.eventId);await f.commit(second.eventId,sc,request);
  const rows=(await f.db.query<Record<string,unknown>>('SELECT * FROM taxi_bot_outbox_claim($1,$2)',[tenant,waba])).rows;assert.equal(rows.length,1);
  assert.equal(await f.scalar("SELECT count(*)::int FROM taxi_bot_outbox WHERE state='failed'AND error_code='outdated_before_send'"),1);
  assert.equal(await f.scalar('SELECT taxi_bot_outbox_permitted($1,$2)',[rows[0].id,rows[0].lease]),true);
  const next=await f.enqueue('Cambió la recogida'),nc=await f.begin(next.eventId);await f.commit(next.eventId,nc,{...request,draft:{...emptyDraft(),origin:f.draft.origin,awaitingLocation:'destination'},messages:[{to:customer,text:'Destino',locationRequest:'destination'}]});
  assert.equal(await f.scalar('SELECT taxi_bot_outbox_permitted($1,$2)',[rows[0].id,rows[0].lease]),false);
 }finally{await f.db.close();}
});
test('native location SQL: session window, human ownership, tenant and authorized customer are checked before sending',async()=>{
 const f=await fixture();try{
  const e=await f.enqueue('Hola'),claim=await f.begin(e.eventId);await f.commit(e.eventId,claim,{...f.decision(),draft:{...emptyDraft(),awaitingLocation:'origin'},messages:[{to:customer,text:'Recogida',locationRequest:'origin'}]});
  const row=(await f.db.query<Record<string,unknown>>('SELECT * FROM taxi_bot_outbox_claim($1,$2)',[tenant,waba])).rows[0];
  const permitted=()=>f.scalar('SELECT taxi_bot_outbox_permitted($1,$2)',[row.id,row.lease]);assert.equal(await permitted(),true);
  assert.equal(await f.scalar('SELECT taxi_bot_location_request_current($1,$2,$3,$4)',[other,waba,customer,row.body]),false);
  await f.db.exec("UPDATE taxi_bot_sessions SET mode='human'");assert.equal(await permitted(),false);await f.db.exec("UPDATE taxi_bot_sessions SET mode='bot',last_source_at=now()-interval '25 hours'");assert.equal(await permitted(),false);
  await f.db.exec('UPDATE taxi_bot_sessions SET last_source_at=now()');assert.equal(await permitted(),true);await f.db.exec('DELETE FROM taxi_bot_allowed_customers');assert.equal(await permitted(),false);
 }finally{await f.db.close();}
});
test('person account SQL: changing taxi and driver role updates the existing login and dispatch WhatsApp atomically',async()=>{
 const f=await fixture();try{
  const id=crypto.randomUUID();await f.db.query("INSERT INTO taxi_base_contacts(id,tenant_id,unit_number,name,phone_input,role,device_id)VALUES($1,$2,'487','Persona','9630000094','owner',1)",[id,tenant]);
  const bind=async(assignment:Record<string,unknown>)=>{
   const version=await f.scalar("SELECT taxi_bot_contact_record(c)->>'version'FROM taxi_base_contacts c WHERE id=$1",[id]),request=crypto.randomUUID();
   const b=f.obj(await f.scalar('SELECT taxi_account_begin($1,$2,$3,$4,$5,$6,$7,$8)',[tenant,42,request,id,version,'person@example.test',81,assignment]));assert.equal(b.state,'proceed');
   return f.obj(await f.scalar('SELECT taxi_account_finish($1,$2,$3,$4)',[42,request,b.lease,81]));
  };
  assert.equal((await bind({role:'owner',deviceId:1,receiveOffers:false,driverVersion:null})).state,'saved');
  const driverVersion=await f.scalar("SELECT taxi_bot_driver_record(d)->>'version'FROM conductores d WHERE device_id=2");
  const moved=await bind({role:'driver',deviceId:2,receiveOffers:true,driverVersion});assert.equal(moved.state,'saved');
  assert.equal(f.obj(moved.contact).accountUserId,81);assert.equal(f.obj(moved.contact).deviceId,2);assert.equal(f.obj(moved.contact).receiving,true);
  assert.equal(await f.scalar('SELECT rol FROM perfiles WHERE traccar_user_id=81'),'driver');assert.equal(await f.scalar('SELECT count(*)::int FROM perfiles'),1);
  assert.equal(await f.scalar('SELECT telefono_whatsapp FROM conductores WHERE device_id=2'),'+529630000094');
  assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_base_contacts'),1);
 }finally{await f.db.close();}
});
test('person account SQL: existing person and Traccar ID share one access, replay and private self profile',async()=>{
 const f=await fixture();try{
  const id=crypto.randomUUID(),request=crypto.randomUUID();
  await f.db.query("INSERT INTO taxi_base_contacts(id,tenant_id,unit_number,name,phone_input,role,device_id)VALUES($1,$2,'487','Persona prueba','9630000091','owner',1)",[id,tenant]);
  const version=await f.scalar("SELECT taxi_bot_contact_record(c)->>'version' FROM taxi_base_contacts c WHERE id=$1",[id]);
  const assignment={role:'owner',deviceId:1,receiveOffers:false,driverVersion:null};
  const args=[tenant,42,request,id,version,'persona@example.test',81,assignment];
  const begin=f.obj(await f.scalar('SELECT taxi_account_begin($1,$2,$3,$4,$5,$6,$7,$8)',args));assert.equal(begin.state,'proceed');
  assert.equal(f.obj(await f.scalar('SELECT taxi_account_begin($1,$2,$3,$4,$5,$6,$7,$8)',args)).state,'running');
  assert.equal(f.obj(await f.scalar('SELECT taxi_account_finish($1,$2,$3,$4)',[42,request,crypto.randomUUID(),81])).state,'operation_changed');
  const saved=f.obj(await f.scalar('SELECT taxi_account_finish($1,$2,$3,$4)',[42,request,begin.lease,81]));assert.equal(saved.state,'saved');
  assert.equal(f.obj(saved.contact).accountUserId,81);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_base_contacts'),1);
  assert.equal(await f.scalar('SELECT rol FROM perfiles WHERE traccar_user_id=81'),'owner');
  assert.equal(f.obj(await f.scalar('SELECT taxi_account_begin($1,$2,$3,$4,$5,$6,$7,$8)',args)).activated,false);
  assert.equal(await f.scalar('SELECT taxi_account_activated($1,$2,$3)',[42,request,81]),true);
  const replay=f.obj(await f.scalar('SELECT taxi_account_begin($1,$2,$3,$4,$5,$6,$7,$8)',args));assert.equal(replay.activated,true);assert.deepEqual(replay.result,saved);
  assert.equal(f.obj(f.obj(await f.scalar('SELECT taxi_account_self($1)',[81])).contact).id,id);
  assert.equal(await f.scalar('SELECT taxi_account_self($1)',[82]),null);
  for(const role of ['anon','authenticated'])assert.equal(await f.scalar('SELECT has_function_privilege($1,$2,$3)',[role,'taxi_account_self(integer)','EXECUTE']),false);
 }finally{await f.db.close();}
});
test('person account SQL: no cross-base takeover, admin downgrade, duplicate person or stale revision',async()=>{
 const f=await fixture();try{
  const id=crypto.randomUUID();await f.db.query("INSERT INTO taxi_base_contacts(id,tenant_id,unit_number,name,phone_input,role,device_id)VALUES($1,$2,'487','Persona','9630000092','owner',1)",[id,tenant]);
  await f.db.query("INSERT INTO perfiles VALUES(81,$1,'operador'),(82,$2,'admin_empresa')",[other,tenant]);
  const v=await f.scalar("SELECT taxi_bot_contact_record(c)->>'version'FROM taxi_base_contacts c WHERE id=$1",[id]),a={role:'owner',deviceId:1,receiveOffers:false,driverVersion:null};
  const begin=(user:number|null,base=tenant,version=v,assignment=a)=>f.scalar('SELECT taxi_account_begin($1,$2,$3,$4,$5,$6,$7,$8)',[base,42,crypto.randomUUID(),id,version,'persona@example.test',user,assignment]);
  assert.equal(f.obj(await begin(81)).state,'user_forbidden');assert.equal(f.obj(await begin(82)).state,'user_forbidden');assert.equal(f.obj(await begin(42)).state,'user_forbidden');
  assert.equal(f.obj(await begin(83,other)).state,'contact_forbidden');assert.equal(f.obj(await begin(83,tenant,'a'.repeat(32))).state,'revision_conflict');
  assert.equal(f.obj(await begin(83,tenant,v,{...a,deviceId:3})).state,'device_forbidden');assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_account_operations'),0);
 }finally{await f.db.close();}
});
test('person account SQL: durable lease prevents duplicate provisioning and freezes the same person while pending',async()=>{
 const f=await fixture();try{
  const id=crypto.randomUUID(),request=crypto.randomUUID();await f.db.query("INSERT INTO taxi_base_contacts(id,tenant_id,unit_number,name,phone_input,role,device_id)VALUES($1,$2,'487','Persona','9630000093','owner',1)",[id,tenant]);
  const v=await f.scalar("SELECT taxi_bot_contact_record(c)->>'version'FROM taxi_base_contacts c WHERE id=$1",[id]),a={role:'owner',deviceId:1,receiveOffers:false,driverVersion:null};
  const args=[tenant,42,request,id,v,'persona@example.test',null,a];const first=f.obj(await f.scalar('SELECT taxi_account_begin($1,$2,$3,$4,$5,$6,$7,$8)',args));
  assert.equal(f.obj(await f.scalar('SELECT taxi_bot_contact_apply($1,$2,$3,$4,$5,$6)',[tenant,42,crypto.randomUUID(),v,id,{unitNumber:'487',name:'Otra',phoneInput:'9630000093',...a}])).state,'account_pending');
  assert.equal(f.obj(await f.scalar('SELECT taxi_account_begin($1,$2,$3,$4,$5,$6,$7,$8)',[...args.slice(0,2),crypto.randomUUID(),...args.slice(3)])).state,'account_pending');
  await f.db.exec("UPDATE taxi_account_operations SET lease_until=clock_timestamp()-interval '1 second'");
  const resumed=f.obj(await f.scalar('SELECT taxi_account_begin($1,$2,$3,$4,$5,$6,$7,$8)',args));assert.equal(resumed.state,'proceed');assert.notEqual(resumed.lease,first.lease);
  const pending=await f.scalar('SELECT taxi_account_pending($1,$2)',[42,tenant]);assert.ok(Array.isArray(pending));assert.equal(pending.length,1);assert.ok(!JSON.stringify(pending).includes('password'));
  assert.deepEqual(await f.scalar('SELECT taxi_account_pending($1,$2)',[43,tenant]),[]);
 }finally{await f.db.close();}
});
async function fixture(options:{legacy?:boolean;seedCoverageBeforeMigration?:boolean;seedPdfLocalFares?:boolean}={}){
  const db=new PGlite();await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE empresas(id uuid PRIMARY KEY,tipo_negocio text DEFAULT 'taxi',telefono_whatsapp text,nombre_empresa text);INSERT INTO empresas(id,nombre_empresa)VALUES('${tenant}','Base de prueba'),('${other}','Otra base de prueba')${options.legacy||options.seedPdfLocalFares?`,('${pompeyo}','Servicio de Taxis Pompeyo Express')`:''};
    CREATE TABLE webhook_queue(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),payload jsonb,status text,processed_at timestamptz);
    CREATE TABLE conductores(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,device_id integer UNIQUE,telefono_whatsapp text,nombre text,activo boolean DEFAULT true);
    CREATE TABLE viajes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),token text UNIQUE NOT NULL,tenant_id uuid,device_id integer,taxi_name text,cliente_tel text NOT NULL,cliente_nombre text,origen text NOT NULL,destino text NOT NULL,origen_lat double precision,origen_lng double precision,estado text NOT NULL,conductores_contactados integer[]DEFAULT '{}',created_at timestamptz DEFAULT now());
    ALTER TABLE viajes ENABLE ROW LEVEL SECURITY;CREATE POLICY legacy_open ON viajes FOR ALL USING(true)WITH CHECK(true);GRANT ALL ON viajes TO anon,authenticated,service_role;`);
  await db.exec(h3CatalogSql);await db.exec(sql);await db.query("INSERT INTO taxi_bot_channels(tenant_id,waba,enabled,name,city,center_lat,center_lng,radius_km,dispatcher)VALUES($1,$2,true,'Base de prueba','Comitán',16.25,-92.13,20,$3)",[tenant,waba,'+529630000099']);await db.exec(h3PricingSql);await db.exec(adminSql);await db.exec(traceSql);
  await db.exec(accessSql);
  await db.exec(locationRequestSql);
  await db.exec(addressGeocodeSql);
  // Base-owned zone validation is installed below; optional fares extend that current validator.
  await db.exec(mapCacheSql);
  await db.exec(driverSetupSql);
  if(options.seedCoverageBeforeMigration){
    await db.exec(readFileSync(new URL('../estrella-taxis-backend/supabase/h3_limpio.sql',import.meta.url),'utf8'));
    await db.exec('ALTER TABLE h3_zonas ADD COLUMN tenant_id uuid');
    await db.query('UPDATE h3_zonas SET tenant_id=$1',[tenant]);
  }
  if(!options.legacy){await db.exec(baseZonesSql);await db.exec(baseFleetSql);await db.exec(baseContactsSql);
    await db.exec("CREATE TABLE perfiles(traccar_user_id integer PRIMARY KEY CHECK(traccar_user_id>0),empresa_id uuid REFERENCES empresas(id),rol text CHECK(rol IN('superadmin','admin_empresa','operador')),created_at timestamptz DEFAULT now())");
    await db.exec(personAccountsSql);
    await db.exec(optionalFareSql);await db.exec(neighborhoodsSql);await db.exec(dispatchSafetySql);await db.exec(conversationEmojisSql);
    if(options.seedPdfLocalFares){
      const restore=[...localitySeparationSql.matchAll(/\('([^']+)','([^']+)',(\d+),(\d+)\)/g)];
      if(restore.length!==293)throw new Error('Expected the guarded PDF restore to contain 293 reviewed cells.');
      const values=restore.map(match=>`('${pompeyo}','${match[1]}','${match[2]}',${match[3]})`);
      await db.exec('INSERT INTO taxi_bot_base_zones(tenant_id,h3_index,label,price_cents)VALUES'+values.join(','));
    }
    await db.exec(pdfLocalFaresSql);
    // Ordinary fixtures install the historical schema before creating this base. The
    // dedicated import fixture supplies the exact reviewed map required by that import.
    if(!options.seedPdfLocalFares)await db.query('INSERT INTO empresas(id,nombre_empresa)VALUES($1,$2)',[pompeyo,'Servicio de Taxis Pompeyo Express']);
    await db.exec(localitySeparationSql);
    await db.exec(gpsBookingSql);
    await db.exec(privateReferenceQuoteSql);
    await db.exec(resetMinimumSql);
  }
  // These legacy protocol fixtures explicitly act as customers too. Driver-only access has separate tests below.
  await db.query('INSERT INTO taxi_bot_allowed_customers(tenant_id,phone)VALUES($1,$2),($1,$3),($1,$4)',[tenant,customer,driverPhone,'+529630000004']);
  await db.query("INSERT INTO conductores(tenant_id,device_id,telefono_whatsapp,nombre)VALUES($1,1,$2,'Unidad 1'),($1,2,'+529630000004','Unidad 2'),($3,3,'+529630000005','Ajena')",[tenant,driverPhone,other]);
  const scalar=async(query:string,args:unknown[]=[])=>Object.values((await db.query<Record<string,unknown>>(query,args)).rows[0])[0];
  const obj=(v:unknown):Record<string,unknown>=>{if(!record(v))throw new TypeError('Expected a JSON object from the SQL fixture.');return v;};
  const enqueue=async(content='Un taxi',from=customer,id=crypto.randomUUID(),button:string|null=null,location:{lat:number;lng:number}|null=null)=>{
    const message={id,from,to:waba,at:new Date().toISOString(),type:button?'button':location?'location':'text',text:content,button,location};
    const result=obj(await scalar('SELECT taxi_bot_enqueue($1,$2,$3,$4,$5)',[tenant,waba,message,'a'.repeat(64),{type:'whatsapp.inbound_message',whatsappInboundMessage:{id,from,to:waba}}]));
    await db.query("UPDATE taxi_bot_events SET received_at=clock_timestamp()-interval '2 seconds'WHERE id=$1",[result.eventId]);return result;
  };
  const begin=async(id:unknown)=>{const c=obj(await scalar('SELECT taxi_bot_begin($1)',[id]));if(c.state==='proceed'){const session=parseSession(c.session);await scalar('SELECT taxi_bot_trace_start($1,$2,$3,$4)',[c.eventId,c.lease,session.revision,{version:'taxi-trace-v1',engineVersion:'fixture',model:'fixture-model',promptHash:'a'.repeat(64),phaseBefore:conversationPhase(session,Date.now())}]);}return c;};
  const draft={...emptyDraft(),fareMode:'quoted' as const,quoteBasis:'route' as 'route'|'pickup',name:'Persona Prueba',origin:{text:'Centro',lat:16.25,lng:-92.13,placeId:null,source:'gps' as const},destination:{text:'Terminal',lat:16.26,lng:-92.14,placeId:null,source:'gps' as const},pickupMessageId:String(crypto.randomUUID()),quoteCents:6500,confirmation:crypto.randomUUID(),expiresAt:new Date(Date.now()+600000).toISOString()};
  draft.quoteH3=taxiH3Scope(draft.origin,draft.destination);
  let prepared=false;
  const decision=(action:string='draft')=>({action,draft:prepared?draft:{...draft,confirmation:null,expiresAt:null},confirmation:null,tripId:null,offerId:null,candidates:[],messages:[],reason:'fixture'});
  const commit=async(id:unknown,claim:Record<string,unknown>,d:Record<string,unknown>)=>{const s=obj(claim.session);return obj(await scalar('SELECT taxi_bot_commit($1,$2,$3,$4)',[id,claim.lease,s.revision,d]));};
  const prepare=async(from=customer)=>{await seedH3();const event=await enqueue('A nombre de Persona Prueba',from,crypto.randomUUID(),null,{lat:draft.origin.lat,lng:draft.origin.lng});const saved=await scalar("SELECT message->>'id' FROM taxi_bot_events WHERE id=$1",[event.eventId]);draft.pickupMessageId=asString(saved);const claim=await begin(event.eventId);assert.equal(claim.state,'proceed');prepared=true;await commit(event.eventId,claim,decision());return draft;};
  const enqueueButton=async(from=customer,token:string=draft.confirmation)=>enqueue('',from,crypto.randomUUID(),'txc_'+token);
  const confirm=async(from=customer,candidates=[{deviceId:1,name:'Unidad 1'},{deviceId:2,name:'Unidad 2'}])=>{const e=await enqueueButton(from),claim=await begin(e.eventId);return{event:e,claim,result:await commit(e.eventId,claim,{...decision('confirm'),confirmation:draft.confirmation,candidates})};};
  const seedH3=async()=>{
    const scope=taxiH3Scope(draft.origin,draft.destination);
    await db.query("UPDATE taxi_bot_channels SET pricing_mode='h3_zone_max'WHERE waba=$1",[waba]);
    await db.query("INSERT INTO h3_zonas(h3_index,precio,resolucion,nombre)VALUES($1,45,10,'Zona sintética origen'),($2,65,10,'Zona sintética destino')ON CONFLICT(h3_index)DO NOTHING",[scope.originCell,scope.destinationCell]);
    if(options.legacy)await db.query('INSERT INTO taxi_bot_h3_cells(tenant_id,waba,h3_index)VALUES($1,$2,$3),($1,$2,$4)',[tenant,waba,scope.originCell,scope.destinationCell]);
    else await db.query("INSERT INTO taxi_bot_base_zones(tenant_id,h3_index,label,price_cents)VALUES($1,$2,'Zona sintética origen',4500),($1,$3,'Zona sintética destino',6500)ON CONFLICT(tenant_id,h3_index)DO NOTHING",[tenant,scope.originCell,scope.destinationCell]);
    return scope;
  };
  const admin=async(action:string,payload:Record<string,unknown>,expected=0,request=crypto.randomUUID(),company=tenant,number=waba)=>obj(await scalar('SELECT taxi_bot_admin_apply($1,$2,$3,$4,$5,$6,$7)',[company,number,42,request,expected,action,payload]));
  return{db,scalar,obj,enqueue,enqueueButton,begin,decision,commit,prepare,confirm,draft,seedH3,admin};
}
function asString(value:unknown):string{if(typeof value!=='string')throw new TypeError('Expected a string field from the SQL fixture.');return value;}

test('dispatch safety: rejects an attention contact equivalent to the WhatsApp sender, including Mexico +52/+521 variants',async()=>{
 const f=await fixture();try{
  const migrationRule=await f.scalar("SELECT convalidated FROM pg_constraint WHERE conname='taxi_bot_dispatcher_must_be_person'");
  assert.equal(migrationRule,false,'The legacy channel is preserved until its owner updates the dispatcher phone.');
  await assert.rejects(f.db.query("INSERT INTO taxi_bot_channels(tenant_id,waba,enabled,name,city,center_lat,center_lng,radius_km,dispatcher)VALUES($1,'+529630000088',false,'Base','Comitán',16.25,-92.13,20,'+5219630000088')",[tenant]),/taxi_bot_dispatcher_must_be_person/);
 }finally{await f.db.close();}
});

test('base ownership migration: Pompeyo receives all existing zones once, preserving original tariffs and earlier private edits',async()=>{
 const f=await fixture({legacy:true});try{
  const scope=await f.seedH3();
  await f.db.query("UPDATE empresas SET tipo_negocio='restaurant' WHERE id IN($1,$2)",[tenant,other]);
  await f.db.query('UPDATE taxi_bot_channels SET tenant_id=$1 WHERE tenant_id=$2',[pompeyo,tenant]);
  await f.db.query('UPDATE taxi_bot_h3_cells SET tenant_id=$1 WHERE tenant_id=$2',[pompeyo,tenant]);
  await f.admin('upsert_zones',{cells:[scope.originCell],label:'Tarifa propia conservada',cents:5700},0,crypto.randomUUID(),pompeyo);
  await f.db.query('DELETE FROM conductores WHERE tenant_id=$1',[other]);
  await f.db.query('DELETE FROM taxi_bot_customer_access WHERE tenant_id=$1',[other]);
  await f.db.query('DELETE FROM empresas WHERE id=$1',[other]);await f.db.exec(baseZonesSql);
  assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_base_zones WHERE tenant_id=$1',[pompeyo]),2);
  assert.equal(await f.scalar('SELECT count(*)::int FROM h3_zonas WHERE tenant_id=$1',[pompeyo]),2);
  const page=parseZones(await f.scalar('SELECT taxi_bot_admin_read($1,$2,$3,$4)',[pompeyo,waba,'zones',{}]));
  assert.equal(page.zones.find(z=>z.cell===scope.originCell)?.cents,5700);assert.equal(page.zones.find(z=>z.cell===scope.originCell)?.label,'Tarifa propia conservada');
  assert.equal(page.zones.find(z=>z.cell===scope.destinationCell)?.cents,6500);
 }finally{await f.db.close();}
});
test('base ownership migration: ambiguous ownership and conflicting old channel prices stop without changing existing coverage',async()=>{
 const f=await fixture({legacy:true});try{
  const scope=await f.seedH3();await assert.rejects(f.db.exec(baseZonesSql),/Resolve H3 ownership/);await f.db.exec('ROLLBACK');
  assert.equal(await f.scalar("SELECT to_regclass('public.taxi_bot_base_zones')"),null);
  await f.db.exec('ALTER TABLE h3_zonas ADD COLUMN tenant_id uuid');await f.db.query('UPDATE h3_zonas SET tenant_id=$1',[tenant]);
  const second='+529630000088';await f.db.query("INSERT INTO taxi_bot_channels(tenant_id,waba,name,city,center_lat,center_lng,radius_km)VALUES($1,$2,'Otro canal','Comitán',16.25,-92.13,20)",[tenant,second]);
  await f.db.query('UPDATE taxi_bot_h3_cells SET price_cents=4500 WHERE h3_index=$1',[scope.originCell]);
  await f.db.query('INSERT INTO taxi_bot_h3_cells(tenant_id,waba,h3_index,price_cents)VALUES($1,$2,$3,5500)',[tenant,second,scope.originCell]);
  await assert.rejects(f.db.exec(baseZonesSql),/Conflicting channel overrides/);await f.db.exec('ROLLBACK');
  assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_h3_cells'),3);
 }finally{await f.db.close();}
});
test('base zones: an edit applies to all channels of that base and invalidates their map versions without borrowing another base price',async()=>{
 const f=await fixture();try{
  const scope=await f.seedH3(),second='+529630000088';
  await f.db.query("INSERT INTO taxi_bot_channels(tenant_id,waba,enabled,name,city,center_lat,center_lng,radius_km,dispatcher)VALUES($1,$2,true,'Segundo canal','Comitán',16.25,-92.13,20,'+529630000099')",[tenant,second]);
  const before=parseZones(await f.scalar('SELECT taxi_bot_admin_read($1,$2,$3,$4)',[tenant,second,'zones',{}]));
  assert.equal((await f.admin('upsert_zones',{cells:[scope.originCell],label:'Precio de la base',cents:7900})).state,'saved');
  assert.equal(f.obj(await f.scalar('SELECT taxi_bot_h3_quote($1,$2,$3,$4)',[tenant,second,scope.originCell,scope.destinationCell])).cents,7900);
  assert.notEqual(parseZones(await f.scalar('SELECT taxi_bot_admin_read($1,$2,$3,$4)',[tenant,second,'zones',{}])).version,before.version);
  await f.db.query('UPDATE h3_zonas SET precio=1 WHERE h3_index=$1',[scope.originCell]);
  assert.equal(f.obj(await f.scalar('SELECT taxi_bot_h3_quote($1,$2,$3,$4)',[tenant,second,scope.originCell,scope.destinationCell])).cents,7900);
  const setup=f.obj(await f.scalar('SELECT taxi_bot_driver_read($1,$2)',[tenant,second]));assert.equal(setup.zoneCount,2);
  await f.admin('remove_zones',{cells:[scope.originCell]},1);
  assert.equal(f.obj(await f.scalar('SELECT taxi_bot_h3_quote($1,$2,$3,$4)',[tenant,second,scope.originCell,scope.destinationCell])).state,'uncovered');
 }finally{await f.db.close();}
});

test('contacts: incomplete source phone is preserved for editing, owner and unclassified contacts cannot receive offers',async()=>{
 const f=await fixture();try{
  const id=crypto.randomUUID(),payload={unitNumber:'487',name:'Contacto de prueba',phoneInput:'963000077',role:'pending',deviceId:null,receiveOffers:false,driverVersion:null};
  const save=(body:Record<string,unknown>,expected:string|null=null,base=tenant)=>f.scalar('SELECT taxi_bot_contact_apply($1,$2,$3,$4,$5,$6)',[base,42,crypto.randomUUID(),expected,id,body]);
  const saved=f.obj(await save(payload)),contact=f.obj(saved.contact);assert.equal(saved.state,'saved');assert.equal(contact.phoneInput,'963000077');assert.equal(contact.phone,null);assert.equal(contact.receiving,false);
  assert.equal(f.obj(await save({...payload,role:'owner',receiveOffers:true},String(contact.version))).state,'role_not_driving');
  assert.equal(f.obj(await save({...payload,role:'driver',receiveOffers:true,deviceId:1},String(contact.version))).state,'phone_invalid');
  assert.equal(f.obj(await save(payload,String(contact.version),other)).state,'contact_forbidden');
  assert.equal(await f.scalar('SELECT count(*)::int FROM conductores'),3);
  for(const actor of ['anon','authenticated']){
   assert.equal(await f.scalar('SELECT has_table_privilege($1,$2,$3)',[actor,'taxi_base_contacts','SELECT']),false);
   assert.equal(await f.scalar('SELECT has_function_privilege($1,$2,$3)',[actor,'taxi_bot_contact_apply(uuid,bigint,uuid,text,uuid,jsonb)','EXECUTE']),false);
  }
 }finally{await f.db.close();}
});
test('contacts: role, phone and GPS explicitly activate one driver, replay is durable and changing to owner pauses offers',async()=>{
 const f=await fixture();try{
  await f.scalar('SELECT taxi_bot_link_units($1,$2,$3,$4)',[tenant,42,crypto.randomUUID(),[{id:4,name:'Taxi 4'}]]);
  const id=crypto.randomUUID(),request=crypto.randomUUID(),payload={unitNumber:'487',name:'Persona de prueba',phoneInput:'9630000077',role:'driver',deviceId:4,receiveOffers:true,driverVersion:null};
  const save=(body:Record<string,unknown>,expected:string|null=null,req=crypto.randomUUID())=>f.scalar('SELECT taxi_bot_contact_apply($1,$2,$3,$4,$5,$6)',[tenant,42,req,expected,id,body]);
  const saved=f.obj(await save(payload,null,request)),contact=f.obj(saved.contact);assert.equal(saved.state,'saved');assert.equal(contact.receiving,true);
  assert.deepEqual(await save(payload,null,request),saved);
  assert.equal(f.obj(await save({...payload,name:'Cambio viejo'})).state,'revision_conflict');
  const paused=f.obj(await save({...payload,role:'owner',receiveOffers:false},String(contact.version)));assert.equal(paused.state,'saved');assert.equal(f.obj(paused.contact).receiving,false);
  assert.equal(await f.scalar('SELECT activo FROM conductores WHERE device_id=4'),false);
  await assert.rejects(f.db.query("INSERT INTO conductores(tenant_id,device_id,nombre,telefono_whatsapp,activo)VALUES($1,5,'No conduce','+529630000077',true)",[tenant]),/Confirm driving role/);
  assert.equal(await f.scalar('SELECT count(*)::int FROM conductores WHERE device_id=5'),0);
  assert.equal(f.obj(await save({...payload,phoneInput:'9630000002',receiveOffers:false},String(f.obj(paused.contact).version))).state,'saved');
 }finally{await f.db.close();}
});
test('contacts: pending offers roll back both a contact edit and its attempted driver change; metadata-only edits preserve dispatch',async()=>{
 const f=await fixture();try{
  const driver=f.obj(await f.scalar('SELECT taxi_bot_driver_record(d)FROM conductores d WHERE device_id=1'));
  const id=crypto.randomUUID(),payload={unitNumber:'487',name:'Unidad 1',phoneInput:driverPhone,role:'driver',deviceId:1,receiveOffers:true,driverVersion:driver.version};
  const save=(body:Record<string,unknown>,expected:string|null=null)=>f.scalar('SELECT taxi_bot_contact_apply($1,$2,$3,$4,$5,$6)',[tenant,42,crypto.randomUUID(),expected,id,body]);
  const saved=f.obj(await save(payload)),contact=f.obj(saved.contact);assert.equal(saved.state,'saved');
  await f.prepare();await f.confirm();
  const denied=f.obj(await save({...payload,role:'owner',receiveOffers:false},String(contact.version)));assert.equal(denied.state,'driver_busy');
  assert.deepEqual(await f.scalar('SELECT taxi_bot_contact_record(c)FROM taxi_base_contacts c WHERE id=$1',[id]),contact);
  assert.equal(await f.scalar('SELECT activo FROM conductores WHERE device_id=1'),true);
  const label=f.obj(await save({...payload,unitNumber:'488'},String(contact.version)));assert.equal(label.state,'saved');assert.equal(f.obj(label.contact).receiving,true);
 }finally{await f.db.close();}
});

test('base fleet: linking actual units preserves driver contacts and makes unconfigured units pending',async()=>{
 const f=await fixture();try{
  const id=crypto.randomUUID(),units=[{id:4,name:'Taxi 4'},{id:5,name:'Taxi 5'}];
  const link=(body=units,request=id,base=tenant)=>f.scalar('SELECT taxi_bot_link_units($1,$2,$3,$4)',[base,42,request,body]);
  const before=await f.scalar('SELECT jsonb_agg(to_jsonb(d)ORDER BY device_id)FROM conductores d');
  const saved=f.obj(await link());assert.equal(saved.state,'saved');assert.equal(saved.linkedCount,4);assert.equal(saved.readyCount,2);assert.equal(saved.pendingCount,2);
  assert.deepEqual(await f.scalar('SELECT jsonb_agg(to_jsonb(d)ORDER BY device_id)FROM conductores d'),before);
  assert.deepEqual(await link([...units].reverse()),saved);
  assert.equal(f.obj(await link([{id:4,name:'Otro nombre'}])).state,'request_conflict');
  assert.equal(f.obj(await link([{id:3,name:'Ajena'},{id:6,name:'No insertar'}],crypto.randomUUID())).state,'device_conflict');
  assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_base_units WHERE device_id=6'),0);
  const denied=f.obj(await f.scalar('SELECT taxi_bot_driver_apply($1,$2,$3,$4,$5,$6,$7,$8)',[other,42,crypto.randomUUID(),4,'Ajeno','+529630000066',true,null]));assert.equal(denied.state,'device_conflict');
 }finally{await f.db.close();}
});
test('base fleet: existing drivers are backfilled; direct cross-base reassignment cannot escape ownership',async()=>{
 const f=await fixture({legacy:true});try{
  await f.db.exec(baseFleetSql);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_base_units'),3);
  await assert.rejects(f.db.query('UPDATE conductores SET tenant_id=$1 WHERE device_id=1',[other]),/another base/);
  assert.equal(await f.scalar('SELECT tenant_id FROM conductores WHERE device_id=1'),tenant);
 }finally{await f.db.close();}
});
test('base fleet: malformed batches, duplicate IDs and extra phone fields never create fake drivers or partial units',async()=>{
 const f=await fixture();try{
  for(const body of [[],[{id:4,name:'Taxi'},{id:4,name:'Repetido'}],[{id:4,name:'Taxi',phone:'+529630000066'}],[{id:0,name:'Taxi'}],[{id:4,name:' '}],Array.from({length:501},(_,i)=>({id:100+i,name:'Taxi'}))]){
   await assert.rejects(f.scalar('SELECT taxi_bot_link_units($1,$2,$3,$4)',[tenant,42,crypto.randomUUID(),body]));
  }
  assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_base_units'),3);assert.equal(await f.scalar('SELECT count(*)::int FROM conductores'),3);
  for(const role of ['anon','authenticated']){
   assert.equal(await f.scalar('SELECT has_table_privilege($1,$2,$3)',[role,'taxi_base_units','SELECT']),false);
   assert.equal(await f.scalar('SELECT has_function_privilege($1,$2,$3)',[role,'taxi_bot_link_units(uuid,bigint,uuid,jsonb)','EXECUTE']),false);
  }
 }finally{await f.db.close();}
});

test('driver setup SQL: save persists the bot mapping, replay is exact, stale edits and cross-base reassignment are rejected',async()=>{
 const f=await fixture();try{
  const request=crypto.randomUUID(),save=(device=4,name='Persona sintética',expected:string|null=null,id=request,base=tenant)=>f.scalar('SELECT taxi_bot_driver_apply($1,$2,$3,$4,$5,$6,$7,$8)',[base,42,id,device,name,'+529630000066',true,expected]);
  const saved=f.obj(await save());assert.equal(saved.state,'saved');assert.deepEqual(await save(),saved);
  assert.equal(await f.scalar('SELECT count(*)::int FROM conductores WHERE device_id=4'),1);
  assert.equal(f.obj(await save(4,'Cambio con mismo request')).state,'request_conflict');
  assert.equal(f.obj(await save(4,'Cambio sin versión',null,crypto.randomUUID())).state,'revision_conflict');
  assert.equal(f.obj(await save(4,'De otra base',null,crypto.randomUUID(),other)).state,'device_conflict');
  const driver=f.obj(saved.driver);assert.equal(f.obj(await save(4,'Nombre corregido',String(driver.version),crypto.randomUUID())).state,'saved');
  assert.equal(await f.scalar('SELECT nombre FROM conductores WHERE device_id=4'),'Nombre corregido');
  assert.equal(f.obj(await save(5,'Mismo WhatsApp',null,crypto.randomUUID())).state,'phone_conflict');
  const own=f.obj(await f.scalar('SELECT taxi_bot_driver_read($1,$2)',[tenant,waba]));assert.equal(own.activeCount,3);assert.equal(own.zoneCount,0);assert.ok(Array.isArray(own.drivers));assert.equal(own.drivers.length,3);
  for(const role of ['anon','authenticated']){await f.db.exec('SET ROLE '+role);await assert.rejects(save(6),/permission denied/);await assert.rejects(f.scalar('SELECT taxi_bot_driver_read($1,$2)',[tenant,waba]),/permission denied/);await f.db.exec('RESET ROLE');}
 }finally{await f.db.close();}
});
test('driver setup SQL: pending offer blocks contact edits until the offer is resolved',async()=>{
 const f=await fixture();try{
  await f.prepare();await f.confirm();const driver=f.obj(await f.scalar('SELECT taxi_bot_driver_record(d) FROM conductores d WHERE device_id=1'));
  const save=()=>f.scalar('SELECT taxi_bot_driver_apply($1,$2,$3,$4,$5,$6,$7,$8)',[tenant,42,crypto.randomUUID(),1,'Otro nombre',driverPhone,true,driver.version]);
  assert.equal(f.obj(await save()).state,'driver_busy');
  await f.db.exec("UPDATE taxi_bot_offers SET state='rejected'");assert.equal(f.obj(await save()).state,'saved');
 }finally{await f.db.close();}
});
test('coverage SQL: same-count price edits invalidate the server token; per-channel saves advance its revision',async()=>{
 const f=await fixture();try{
  const scope=await f.seedH3(),read=()=>f.scalar('SELECT taxi_bot_admin_read($1,$2,$3,$4)',[tenant,waba,'zones',{}]);
  const first=f.obj(await read());await f.db.query('UPDATE taxi_bot_base_zones SET price_cents=price_cents+100 WHERE h3_index=$1',[scope.originCell]);
  const changed=f.obj(await read());assert.equal(first.totalCells,changed.totalCells);assert.notEqual(first.version,changed.version);
  await f.admin('upsert_zones',{cells:[scope.originCell],label:'Tarifa privada',cents:9900});assert.notEqual(f.obj(await read()).version,changed.version);
 }finally{await f.db.close();}
});
const correctedConfig={name:'Base corregida',city:'Comitán',dispatcher:'+529630000099',centerLat:16.25,centerLng:-92.13,radiusKm:20,pricingMode:'h3_zone_max',baseCents:null,perKmCents:null,enabled:false};
test('channel correction SQL: paused unused number moves its zones and prices atomically and response loss replays safely',async()=>{
 const f=await fixture();try{
  const scope=await f.seedH3(),target='+529630000088',request=crypto.randomUUID();
  await f.admin('upsert_zones',{cells:[scope.originCell],label:'Precio de esta base',cents:5700});
  await f.db.query('UPDATE taxi_bot_channels SET enabled=false WHERE waba=$1',[waba]);
  await f.db.query('UPDATE empresas SET telefono_whatsapp=$1 WHERE id=$2',[waba,tenant]);
  const payload={...correctedConfig,newWaba:target},first=await f.admin('rename_channel',payload,1,request);
  assert.equal(first.state,'saved');assert.deepEqual(await f.admin('rename_channel',payload,1,request),first);
  assert.equal(await f.scalar('SELECT waba FROM taxi_bot_channels'),target);assert.equal(await f.scalar('SELECT enabled FROM taxi_bot_channels'),false);
  assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_base_zones WHERE tenant_id=$1',[tenant]),2);
  assert.equal(await f.scalar('SELECT price_cents FROM taxi_bot_base_zones WHERE h3_index=$1',[scope.originCell]),5700);
  assert.equal(await f.scalar('SELECT telefono_whatsapp FROM empresas WHERE id=$1',[tenant]),target);
  assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_sessions'),0);
 }finally{await f.db.close();}
});
test('channel correction SQL: active channel, occupied target and historical conversations cannot be overwritten',async()=>{
 const f=await fixture();try{
  const payload={...correctedConfig,newWaba:'+529630000088'};
  assert.equal((await f.admin('rename_channel',payload)).state,'pause_channel_first');
  await f.prepare();await f.db.exec('UPDATE taxi_bot_channels SET enabled=false');
  assert.equal((await f.admin('rename_channel',payload)).state,'channel_has_history');
  await f.db.query("INSERT INTO taxi_bot_channels(tenant_id,waba,enabled,name,city,center_lat,center_lng,radius_km)VALUES($1,$2,false,'Otra base','Comitán',16.25,-92.13,20)",[other,payload.newWaba]);
  assert.equal((await f.admin('rename_channel',payload)).state,'channel_conflict');
  assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_channels'),2);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_sessions'),1);
 }finally{await f.db.close();}
});
test('activation SQL: missing driver and missing saved H3 coverage have distinct errors',async()=>{
 const f=await fixture();try{
  const config={...correctedConfig,enabled:true};
  assert.equal((await f.admin('configure',config)).state,'activation_zones_missing');await f.db.exec('DELETE FROM conductores');
  assert.equal((await f.admin('configure',config)).state,'activation_driver_missing');
 }finally{await f.db.close();}
});

test('customer access: an empty list rejects intake before creating events, sessions or queue rows',async()=>{
 const f=await fixture();try{
  await f.db.exec('DELETE FROM taxi_bot_allowed_customers');
  const result=await f.enqueue('Hola');assert.equal(result.ignored,true);
  for(const table of ['taxi_bot_events','taxi_bot_sessions','webhook_queue'])assert.equal(await f.scalar('SELECT count(*)::int FROM '+table),0);
 }finally{await f.db.close();}
});
test('customer access: only the selected company authorizes a phone, including the Mexican legacy prefix',async()=>{
 const f=await fixture();try{
  assert.equal(await f.scalar('SELECT taxi_bot_customer_allowed($1,$2)',[tenant,customer]),true);
  assert.equal(await f.scalar('SELECT taxi_bot_customer_allowed($1,$2)',[tenant,'+521'+customer.slice(3)]),true);
  assert.equal(await f.scalar('SELECT taxi_bot_customer_allowed($1,$2)',[other,customer]),false);
  assert.equal((await f.enqueue('Hola','+529630000088')).ignored,true);
  assert.ok((await f.enqueue()).eventId);
 }finally{await f.db.close();}
});
test('customer access: removing a queued customer closes the event before starting the model',async()=>{
 const f=await fixture();try{
  const e=await f.enqueue();await f.db.query('DELETE FROM taxi_bot_allowed_customers WHERE phone=$1',[customer]);
  const never=async():Promise<never>=>{throw new Error('No model, alias, GPS, price, transport or table read allowed');};
  const services:TaxiServices={interpret:never,resolve:never,quote:never,candidates:never};
  const store:TrackingStore={writePackages:denyAdminWrite,writeCompanyPackage:denyAdminWrite,writeCompanyStatus:denyAdminWrite,read:never,writeScores:never,rpc:async(name,args)=>{assert.equal(name,'taxi_bot_begin');return f.scalar('SELECT taxi_bot_begin($1)',[args.p_event]);}};
  const engine=new TaxiEngine(store,services,{webhookSecret:'fixture-secret',workerSecret:'fixture-worker-secret-at-least-32-characters',ycloudKey:'fixture-key',now:()=>Date.now()},never);
  assert.equal(await engine.process(String(e.eventId)),'blocked');
  assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_sessions'),0);assert.equal(await f.scalar('SELECT status FROM webhook_queue'),'done');
 }finally{await f.db.close();}
});
test('customer access: revocation during interpretation cannot commit a trip or outgoing message',async()=>{
 const f=await fixture();try{
  await f.prepare();const event=await f.enqueueButton(),claim=await f.begin(event.eventId);
  await f.db.query('DELETE FROM taxi_bot_allowed_customers WHERE phone=$1',[customer]);
  await assert.rejects(f.commit(event.eventId,claim,{...f.decision('confirm'),confirmation:f.draft.confirmation,candidates:[{deviceId:1,name:'Unidad 1'}]}),/taxi_customer_not_authorized/);
  assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),0);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_outbox'),0);
 }finally{await f.db.close();}
});
test('customer access: pending and already-claimed outputs are checked again before a provider call',async()=>{
 const f=await fixture();try{
  await f.scalar('SELECT taxi_bot_emit($1,$2,$3,$4,$5)',[tenant,waba,customer,'Mensaje sintético','access-output']);
  const claimed=(await f.db.query<Record<string,unknown>>('SELECT * FROM taxi_bot_outbox_claim($1,$2)',[tenant,waba])).rows;
  assert.equal(claimed.length,1);await f.db.query('DELETE FROM taxi_bot_allowed_customers WHERE phone=$1',[customer]);
  let providerCalls=0;const never=async():Promise<never>=>{throw new Error('No interpretation');};
  const store:TrackingStore={writePackages:denyAdminWrite,writeCompanyPackage:denyAdminWrite,writeCompanyStatus:denyAdminWrite,read:never,writeScores:never,rpc:async(name,args)=>{
   if(name==='taxi_bot_outbox_claim')return claimed;
   if(name==='taxi_bot_outbox_permitted')return f.scalar('SELECT taxi_bot_outbox_permitted($1,$2)',[args.p_id,args.p_lease]);
   assert.equal(name,'taxi_bot_outbox_complete');return f.scalar('SELECT taxi_bot_outbox_complete($1,$2,$3,$4,$5)',[args.p_id,args.p_lease,args.p_state,args.p_provider,args.p_error]);
  }};
  const engine=new TaxiEngine(store,{interpret:never,resolve:never,quote:never,candidates:never},{webhookSecret:'fixture-secret',workerSecret:'fixture-worker-secret-at-least-32-characters',ycloudKey:'fixture-key',now:()=>Date.now()},async()=>{providerCalls++;throw new Error('Provider must not be called');});
  await engine.drain(tenant,waba);assert.equal(providerCalls,0);assert.equal(await f.scalar('SELECT state FROM taxi_bot_outbox'),'failed');
  await f.scalar('SELECT taxi_bot_emit($1,$2,$3,$4,$5)',[tenant,waba,customer,'Otra prueba','access-output-2']);
  assert.equal((await f.db.query('SELECT * FROM taxi_bot_outbox_claim($1,$2)',[tenant,waba])).rows.length,0);
 }finally{await f.db.close();}
});
test('customer access: a driver-only phone can only answer its own valid offer buttons',async()=>{
 const f=await fixture();try{
  await f.prepare();await f.confirm();const offer=(await f.db.query<Record<string,unknown>>('SELECT * FROM taxi_bot_offers WHERE device_id=1')).rows[0];
  await f.db.query('DELETE FROM taxi_bot_allowed_customers WHERE phone=$1',[driverPhone]);
  const message={id:crypto.randomUUID(),from:'+521'+driverPhone.slice(3),to:waba,at:new Date().toISOString(),type:'button',text:'Aceptar',button:'txa_'+offer.id,location:null};
  assert.equal(await f.scalar('SELECT taxi_bot_inbound_allowed($1,$2,$3)',[tenant,waba,message]),true);
  for(const changed of [{...message,from:'+529630000088'},{...message,type:'text',button:null},{...message,button:'txa_'+crypto.randomUUID()}])assert.equal(await f.scalar('SELECT taxi_bot_inbound_allowed($1,$2,$3)',[tenant,waba,changed]),false);
  const e=f.obj(await f.scalar('SELECT taxi_bot_enqueue($1,$2,$3,$4,$5)',[tenant,waba,message,'a'.repeat(64),{}]));
  await f.db.query("UPDATE taxi_bot_events SET received_at=now()-interval '2 seconds'WHERE id=$1",[e.eventId]);const claim=await f.begin(e.eventId);
  await f.commit(e.eventId,claim,{...f.decision('driver_accept'),offerId:offer.id});assert.equal(await f.scalar('SELECT estado FROM viajes'),'en_camino');
 }finally{await f.db.close();}
});
test('customer access: writes are versioned, idempotent and tenant-scoped; clearing the list stays closed',async()=>{
 const f=await fixture();try{
  const request=crypto.randomUUID(),write=(phones:string[],revision=0,id=request)=>f.scalar('SELECT taxi_bot_customer_access_apply($1,$2,$3,$4,$5)',[tenant,42,id,revision,phones]);
  const saved=f.obj(await write([customer]));assert.equal(saved.restricted,true);assert.deepEqual(await write([customer]),saved);
  assert.equal(f.obj(await write([driverPhone])).state,'request_conflict');assert.equal(f.obj(await write([customer],0,crypto.randomUUID())).state,'revision_conflict');
  assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_customer_access_operations'),1);
  assert.equal(f.obj(await write([],1,crypto.randomUUID())).revision,2);assert.equal(await f.scalar('SELECT taxi_bot_customer_allowed($1,$2)',[tenant,customer]),false);
  for(const role of ['anon','authenticated']){await f.db.exec('SET ROLE '+role);await assert.rejects(f.scalar('SELECT * FROM taxi_bot_allowed_customers'),/permission denied/);await assert.rejects(f.scalar('SELECT taxi_bot_customer_access_read($1)',[tenant]),/permission denied/);await f.db.exec('RESET ROLE');}
 }finally{await f.db.close();}
});

test('taxi admin SQL: a base price overrides its cell without changing the shared catalog or another base',async()=>{
  const f=await fixture();try{
    const scope=await f.seedH3(),otherWaba='+529630000077';
    await f.db.query("INSERT INTO taxi_bot_channels(tenant_id,waba,name,city,center_lat,center_lng,radius_km,enabled,dispatcher)VALUES($1,$2,'Otra base','Comitán',16.25,-92.13,20,true,'+529630000099')",[other,otherWaba]);
    await f.db.query("INSERT INTO taxi_bot_base_zones(tenant_id,h3_index,label,price_cents)VALUES($1,$2,'Otra base origen',4500),($1,$3,'Otra base destino',6500)",[other,scope.originCell,scope.destinationCell]);
    assert.equal((await f.admin('upsert_zones',{cells:[scope.destinationCell],label:'Centro de mi base',cents:8500})).state,'saved');
    assert.equal(f.obj(await f.scalar('SELECT taxi_bot_h3_quote($1,$2,$3,$4)',[tenant,waba,scope.originCell,scope.destinationCell])).cents,8500);
    assert.equal(f.obj(await f.scalar('SELECT taxi_bot_h3_quote($1,$2,$3,$4)',[other,otherWaba,scope.originCell,scope.destinationCell])).cents,6500);
    assert.equal(String(await f.scalar('SELECT precio FROM h3_zonas WHERE h3_index=$1',[scope.destinationCell])),'65');
  }finally{await f.db.close();}
});

test('taxi admin SQL: response loss and replay apply a price once; changed request or revision cannot overwrite it',async()=>{
  const f=await fixture();try{
    const scope=await f.seedH3(),id=crypto.randomUUID(),payload={cells:[scope.originCell],label:'Centro',cents:4900};
    const first=await f.admin('upsert_zones',payload,0,id);assert.equal(first.state,'saved');assert.deepEqual(await f.admin('upsert_zones',payload,0,id),first);
    assert.equal(await f.scalar('SELECT revision FROM taxi_bot_channels'),1);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_admin_operations'),1);
    assert.equal((await f.admin('upsert_zones',{...payload,cents:5900},0,id)).state,'request_conflict');
    assert.equal((await f.admin('upsert_zones',{...payload,cents:5900},0)).state,'revision_conflict');assert.equal(await f.scalar('SELECT price_cents FROM taxi_bot_base_zones WHERE h3_index=$1',[scope.originCell]),4900);
  }finally{await f.db.close();}
});

test('taxi admin SQL: a new private cell can be priced without inserting or changing a global zone',async()=>{
  const f=await fixture();try{
    const scope=await f.seedH3(),cell=taxiH3Scope(f.draft.origin,{...f.draft.destination,lat:16.27,lng:-92.15}).destinationCell;
    assert.equal((await f.admin('upsert_zones',{cells:[cell],label:'Nueva zona',cents:7900})).state,'saved');
    assert.equal(await f.scalar('SELECT count(*)::int FROM h3_zonas'),2);
    assert.equal(f.obj(await f.scalar('SELECT taxi_bot_h3_quote($1,$2,$3,$4)',[tenant,waba,scope.originCell,cell])).cents,7900);
    const page=f.obj(await f.scalar('SELECT taxi_bot_admin_read($1,$2,$3,$4)',[tenant,waba,'zones',{search:'Nueva'}]));assert.ok(Array.isArray(page.zones));assert.equal(page.zones.length,1);
    assert.equal((await f.admin('remove_zones',{cells:[cell]},1)).state,'saved');assert.equal(f.obj(await f.scalar('SELECT taxi_bot_h3_quote($1,$2,$3,$4)',[tenant,waba,scope.originCell,cell])).state,'uncovered');
  }finally{await f.db.close();}
});

test('taxi admin SQL: preview works on a paused channel while live booking stays disabled',async()=>{
  const f=await fixture();try{
    const scope=await f.seedH3();await f.db.exec('UPDATE taxi_bot_channels SET enabled=false');
    assert.equal(f.obj(await f.scalar('SELECT taxi_bot_admin_read($1,$2,$3,$4)',[tenant,waba,'quote',scope])).cents,6500);
    assert.equal(f.obj(await f.scalar('SELECT taxi_bot_h3_quote($1,$2,$3,$4)',[tenant,waba,scope.originCell,scope.destinationCell])).state,'channel_unavailable');
    await f.db.exec('SET ROLE anon');await assert.rejects(f.scalar('SELECT taxi_bot_admin_read($1,$2,$3,$4)',[tenant,waba,'zones',{}]),/permission denied/);await assert.rejects(f.admin('remove_zones',{cells:[scope.originCell]}),/permission denied/);
  }finally{await f.db.close();}
});

test('taxi admin SQL: taking human control invalidates an in-flight bot turn before it can create a trip',async()=>{
  const f=await fixture();try{
    await f.prepare();const e=await f.enqueueButton(),claim=await f.begin(e.eventId),session=parseSession(claim.session);
    assert.equal((await f.admin('takeover',{customer},session.revision)).state,'saved');
    await assert.rejects(f.commit(e.eventId,claim,{...f.decision('confirm'),confirmation:f.draft.confirmation}),/stale taxi operation/);
    assert.equal(await f.scalar('SELECT mode FROM taxi_bot_sessions'),'human');assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),0);
    assert.equal(await f.scalar("SELECT draft->>'confirmation'FROM taxi_bot_sessions"),null);assert.equal(await f.scalar("SELECT count(*)::int FROM taxi_bot_events WHERE state='processing'"),0);
  }finally{await f.db.close();}
});

test('taxi admin SQL: manual replies require human ownership and enqueue once without claiming delivery',async()=>{
  const f=await fixture();try{
    await f.prepare();assert.equal((await f.admin('send',{customer,text:'Mensaje sintético de prueba'},1)).state,'send_forbidden');
    await f.admin('takeover',{customer},1);const id=crypto.randomUUID(),payload={customer,text:'Mensaje sintético de prueba'};
    assert.equal((await f.admin('send',payload,2,id)).state,'queued');assert.equal((await f.admin('send',payload,2,id)).state,'queued');
    assert.equal(await f.scalar("SELECT count(*)::int FROM taxi_bot_outbox WHERE dedupe_key LIKE 'admin:%'"),1);assert.equal(await f.scalar('SELECT state FROM taxi_bot_outbox'),'pending');
    const result=f.obj(await f.scalar('SELECT taxi_bot_admin_read($1,$2,$3,$4)',[tenant,waba,'operations',{customer}]));assert.ok(Array.isArray(result.sessions));const session=f.obj(result.sessions[0]);assert.ok(Array.isArray(session.history));assert.ok(session.history.some((h)=>f.obj(h).content===payload.text));
    await f.db.exec("UPDATE taxi_bot_sessions SET last_source_at=clock_timestamp()-interval '25 hours'");assert.equal((await f.admin('send',{customer,text:'Otro mensaje'},3)).state,'send_forbidden');
    assert.equal((await f.admin('resume',{customer},3)).state,'saved');assert.equal(await f.scalar('SELECT mode FROM taxi_bot_sessions'),'bot');assert.equal(await f.scalar("SELECT draft->>'confirmation'FROM taxi_bot_sessions"),null);
  }finally{await f.db.close();}
});
test('taxi SQL: durable dedupe, rollback and replay create one trip and one notification set',async()=>{
  const f=await fixture();try{
    await f.prepare();const id=crypto.randomUUID(),e=await f.enqueue('hola',customer,id),again=await f.enqueue('hola',customer,id);assert.equal(e.queueId,again.queueId);assert.equal(again.duplicate,true);
    await assert.rejects(f.scalar('SELECT taxi_bot_enqueue($1,$2,$3,$4,$5)',[tenant,waba,{id,from:customer,to:waba,at:new Date().toISOString()},'b'.repeat(64),{}]),/identity conflict/);
    const claim=await f.begin(e.eventId);await f.commit(e.eventId,claim,f.decision());
    const created=await f.confirm();assert.ok(created.result.tripId);assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),1);
    assert.equal((await f.begin(created.event.eventId)).state,'replay');
    await f.commit(created.event.eventId,created.claim,{...f.decision('confirm'),confirmation:f.draft.confirmation});assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),1);
  }finally{await f.db.close();}
});
test('taxi SQL: changed summaries invalidate old confirmation and forged reply recipients roll back',async()=>{
  const f=await fixture();try{
    await f.prepare();const e=await f.enqueue('Mejor otro destino'),claim=await f.begin(e.eventId);
    await assert.rejects(f.commit(e.eventId,claim,{...f.decision(),messages:[{to:driverPhone,text:'forged'}]}),/recipient/);
    const changed={...f.draft,confirmation:crypto.randomUUID()};await f.commit(e.eventId,claim,{...f.decision(),draft:changed});
    const next=await f.enqueueButton(),nextClaim=await f.begin(next.eventId);
    await assert.rejects(f.commit(next.eventId,nextClaim,{...f.decision('confirm'),confirmation:f.draft.confirmation}),/current confirmation button required/);
    assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),0);
  }finally{await f.db.close();}
});

test('taxi SQL: a pin awaiting its role persists without a usable confirmation and survives a new worker turn',async()=>{
  const f=await fixture();try{
    await f.prepare();const e=await f.enqueue('pin'),claim=await f.begin(e.eventId);
    const pending={place:{text:'Ubicación compartida',lat:16.255,lng:-92.135,placeId:null},expiresAt:new Date(Date.now()+600000).toISOString()};
    const draft={...f.draft,awaitingLocation:'choice',pendingLocation:pending};
    await assert.rejects(f.commit(e.eventId,claim,{...f.decision(),draft}),/invalid summary/);
    await f.commit(e.eventId,claim,{...f.decision(),draft:{...draft,confirmation:null,expiresAt:null}});
    const next=await f.enqueue('Es el origen'),nextClaim=await f.begin(next.eventId),session=parseSession(nextClaim.session);
    assert.equal(session.draft.pendingLocation?.place.lat,16.255);assert.equal(session.draft.confirmation,null);
    await assert.rejects(f.commit(next.eventId,nextClaim,{...f.decision('confirm'),confirmation:f.draft.confirmation}),/current confirmation button required/);
    assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),0);
  }finally{await f.db.close();}
});

test('taxi SQL: a summary without an expiry is rejected both on creation and confirmation',async()=>{
  const f=await fixture();try{
    await f.prepare();const e=await f.enqueue('resumen'),claim=await f.begin(e.eventId);
    await assert.rejects(f.commit(e.eventId,claim,{...f.decision(),draft:{...f.draft,expiresAt:null}}),/invalid summary/);
    await f.commit(e.eventId,claim,f.decision());
    await f.db.exec("UPDATE taxi_bot_sessions SET draft=jsonb_set(draft,'{expiresAt}','null')");
    const next=await f.enqueueButton(),nextClaim=await f.begin(next.eventId);
    await assert.rejects(f.commit(next.eventId,nextClaim,{...f.decision('confirm'),confirmation:f.draft.confirmation}),/not current/);
    assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),0);
  }finally{await f.db.close();}
});

test('taxi H3 SQL: every channel of a base uses its owned tariffs, including two endpoints in one cell',async()=>{
  const f=await fixture();try{
    assert.equal(await f.scalar('SELECT pricing_mode FROM taxi_bot_channels'),'road_distance','An upgrade must preserve the old channel rule.');
    await f.db.query("INSERT INTO taxi_bot_channels(tenant_id,waba,name,city,center_lat,center_lng,radius_km)VALUES($1,'+529630000088','Otra base sintética','Comitán',16.25,-92.13,20)",[tenant]);
    assert.equal(await f.scalar("SELECT pricing_mode FROM taxi_bot_channels WHERE waba='+529630000088'"),'h3_zone_max');assert.equal(await f.scalar("SELECT count(*)::int FROM taxi_bot_h3_cells WHERE waba='+529630000088'"),0);
    const scope=await f.seedH3();
    const quote=f.obj(await f.scalar('SELECT taxi_bot_h3_quote($1,$2,$3,$4)',[tenant,waba,scope.originCell,scope.destinationCell]));assert.equal(quote.cents,6500);assert.equal(quote.state,'priced');
    const same=f.obj(await f.scalar('SELECT taxi_bot_h3_quote($1,$2,$3,$3)',[tenant,waba,scope.originCell]));assert.equal(same.cents,4500);
    await f.db.query('UPDATE taxi_bot_base_zones SET price_cents=7550 WHERE h3_index=$1',[scope.destinationCell]);
    const updated=f.obj(await f.scalar('SELECT taxi_bot_h3_quote($1,$2,$3,$4)',[tenant,waba,scope.originCell,scope.destinationCell]));assert.equal(updated.cents,7550);
    assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),0);
  }finally{await f.db.close();}
});

test('taxi H3 SQL: a missing endpoint or another tenant never borrows a global zone price',async()=>{
  const f=await fixture();try{
    const scope=await f.seedH3();
    await f.db.query('DELETE FROM taxi_bot_base_zones WHERE h3_index=$1',[scope.destinationCell]);
    const quote=f.obj(await f.scalar('SELECT taxi_bot_h3_quote($1,$2,$3,$4)',[tenant,waba,scope.originCell,scope.destinationCell]));assert.equal(quote.state,'uncovered');assert.equal(quote.cents,undefined);
    for(const args of [[other,waba],[tenant,'+529630000055']]){
      assert.equal(f.obj(await f.scalar('SELECT taxi_bot_h3_quote($1,$2,$3,$4)',[...args,scope.originCell,scope.destinationCell])).state,'channel_unavailable');
    }
    assert.equal(await f.scalar('SELECT count(*)::int FROM h3_zonas'),2);
    await assert.rejects(f.db.query('INSERT INTO taxi_bot_h3_cells(tenant_id,waba,h3_index)VALUES($1,$2,$3)',[other,waba,scope.originCell]),/foreign key/);
  }finally{await f.db.close();}
});

test('taxi H3 SQL: a base tariff cannot store invalid amounts and missing prices stay pending without fallback',async()=>{
  const f=await fixture();try{
    const scope=await f.seedH3();
    for(const price of ['NaN','Infinity','-1','0','19.999','10000001']){
      await assert.rejects(f.db.query('UPDATE taxi_bot_base_zones SET price_cents=$1::text::integer WHERE h3_index=$2',[price,scope.destinationCell]));
    }
    await f.db.query('UPDATE taxi_bot_base_zones SET price_cents=NULL WHERE h3_index=$1',[scope.destinationCell]);
    assert.equal(f.obj(await f.scalar('SELECT taxi_bot_h3_quote($1,$2,$3,$4)',[tenant,waba,scope.originCell,scope.destinationCell])).state,'invalid_zone');
    await assert.rejects(f.scalar('SELECT taxi_bot_h3_quote($1,$2,$3,$4)',[tenant,waba,'invalid-cell',scope.destinationCell]),/invalid taxi H3 cell/);
  }finally{await f.db.close();}
});

test('taxi H3 SQL: quote and bindings are private and a disabled or distance-priced channel cannot return H3 prices',async()=>{
  const f=await fixture();try{
    const scope=await f.seedH3();
    await f.db.exec('SET ROLE anon');await assert.rejects(f.scalar('SELECT count(*) FROM taxi_bot_base_zones'),/permission denied/);await assert.rejects(f.scalar('SELECT taxi_bot_h3_quote($1,$2,$3,$4)',[tenant,waba,scope.originCell,scope.destinationCell]),/permission denied/);await f.db.exec('RESET ROLE');
    await f.db.exec('SET ROLE service_role');assert.equal(f.obj(await f.scalar('SELECT taxi_bot_h3_quote($1,$2,$3,$4)',[tenant,waba,scope.originCell,scope.destinationCell])).cents,6500);await f.db.exec('RESET ROLE');
    for(const update of ["pricing_mode='road_distance'","pricing_mode='h3_zone_max',enabled=false"]){
      await f.db.exec('UPDATE taxi_bot_channels SET '+update);assert.equal(f.obj(await f.scalar('SELECT taxi_bot_h3_quote($1,$2,$3,$4)',[tenant,waba,scope.originCell,scope.destinationCell])).state,'channel_unavailable');
    }
  }finally{await f.db.close();}
});

test('taxi H3 SQL: changing a shown price before commit rolls back the trip and every side effect',async()=>{
  const f=await fixture();try{
    await f.prepare();const scope=await f.seedH3(),e=await f.enqueue('Resumen H3'),claim=await f.begin(e.eventId);
    await f.commit(e.eventId,claim,{...f.decision(),draft:{...f.draft,fareMode:'quoted',quoteCents:6500,quoteH3:scope}});
    const confirm=await f.enqueueButton(),cc=await f.begin(confirm.eventId);
    await f.db.query('UPDATE taxi_bot_base_zones SET price_cents=7500 WHERE h3_index=$1',[scope.destinationCell]);
    await assert.rejects(f.commit(confirm.eventId,cc,{...f.decision('confirm'),confirmation:f.draft.confirmation,candidates:[{deviceId:1,name:'Unidad 1'}]}),/tariff changed/);
    assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),0);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_offers'),0);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_outbox'),0);
    await f.commit(confirm.eventId,cc,{...f.decision(),draft:{...f.draft,fareMode:'quoted',quoteCents:7500,quoteH3:scope,confirmation:crypto.randomUUID()}});
    const latest=await f.scalar("SELECT draft->>'confirmation' FROM taxi_bot_sessions");const next=await f.enqueueButton(customer,asString(latest)),nc=await f.begin(next.eventId),stored=parseSession(nc.session);
    await f.commit(next.eventId,nc,{...f.decision('confirm'),confirmation:stored.draft.confirmation,candidates:[{deviceId:1,name:'Unidad 1'}]});
    assert.equal(await f.scalar('SELECT bot_quote_cents FROM viajes'),7500);assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),1);
  }finally{await f.db.close();}
});

test('taxi H3 SQL: complete legacy consent without H3 scope cannot bypass the new review',async()=>{
  const f=await fixture();try{
    await f.prepare();await f.db.exec("UPDATE taxi_bot_sessions SET draft=draft-'quoteH3'");
    await assert.rejects(f.confirm(),/H3 review required/);assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),0);
  }finally{await f.db.close();}
});

test('taxi H3 integration: real service quote → current summary → recheck → SQL commit keeps the exact amount',async()=>{
  const f=await fixture();try{
    await f.prepare();const scope=await f.seedH3(),event=await f.enqueue('¿Cuánto cuesta el recorrido?'),claim=await f.begin(event.eventId);
    const channel:TaxiChannel={tenantId:tenant,waba,enabled:true,name:'Base sintética',city:'Comitán',centerLat:16.25,centerLng:-92.13,radiusKm:20,dispatcher:'+529630000099',model:'fixture',baseCents:null,perKmCents:null,pricingMode:'h3_zone_max'};
    const store:TrackingStore={writePackages:denyAdminWrite,writeCompanyPackage:denyAdminWrite,writeCompanyStatus:denyAdminWrite,read:async()=>{throw new Error('Undeclared catalog read.');},writeScores:async()=>{throw new Error('No score writes.');},rpc:async(name,args)=>{
      assert.equal(name,'taxi_bot_h3_quote');return f.scalar('SELECT taxi_bot_h3_quote($1,$2,$3,$4)',[args.p_tenant,args.p_waba,args.p_origin,args.p_destination]);
    }};
    const noProvider:Fetcher=async()=>{throw new Error('No Maps/model call is declared for this deterministic fixture.');};
    const services=createTaxiServices(store,noProvider,{mapsKey:'',modelKey:'',traccarUrl:'https://tracking.test/api',traccarEmail:'fixture@example.invalid',traccarPassword:'not-a-real-password'});
    const current='¿Cuánto cuesta el recorrido?';services.interpret=async(text)=>{assert.equal(text,current);return parseInterpretation({intent:'quote',fields:{}},text);};
    services.resolve=async(text)=>{assert.ok(text==='Centro'||text==='Terminal');return{kind:'resolved',place:text==='Centro'?f.draft.origin:f.draft.destination};};
    services.candidates=async()=>[{deviceId:1,name:'Unidad 1'}];
    const inbound:TaxiInbound={id:crypto.randomUUID(),from:customer,to:waba,at:new Date().toISOString(),type:'text',text:current,button:null,location:null};
    const summary=await coordinateTaxi([inbound],parseSession(claim.session),channel,services,Date.now());assert.equal(summary.action,'draft');assert.equal(summary.draft.quoteCents,6500);assert.deepEqual(summary.draft.quoteH3,scope);
    await f.commit(event.eventId,claim,{...summary});assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),0);
    const confirmed=await f.enqueueButton(customer,asString(summary.draft.confirmation)),cc=await f.begin(confirmed.eventId),decision=await coordinateTaxi([{...inbound,id:crypto.randomUUID(),type:'button',text:'',button:'txc_'+summary.draft.confirmation}],parseSession(cc.session),channel,services,Date.now());assert.equal(decision.action,'confirm');
    await f.commit(confirmed.eventId,cc,{...decision});assert.equal(await f.scalar('SELECT bot_quote_cents FROM viajes'),6500);assert.deepEqual(await f.scalar('SELECT bot_quote_h3 FROM viajes'),scope);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_offers'),1);
    assert.match(String(await f.scalar("SELECT body->>'text' FROM taxi_bot_outbox WHERE dedupe_key LIKE 'offer:%'")),/65/);
  }finally{await f.db.close();}
});
test('taxi SQL: only the offered driver accepts, first acceptance wins and duplicate acceptance is harmless',async()=>{
  const f=await fixture();try{
    await f.prepare();await f.confirm();const offers=(await f.db.query<Record<string,unknown>>('SELECT * FROM taxi_bot_offers ORDER BY device_id')).rows;assert.equal(offers.length,2);
    const forged=await f.enqueue('botón',customer),fc=await f.begin(forged.eventId);await f.commit(forged.eventId,fc,{...f.decision('driver_accept'),offerId:offers[0].id});assert.equal(await f.scalar("SELECT count(*)::int FROM viajes WHERE estado='en_camino'"),0);
    for(const [index,phone]of[driverPhone,'+529630000004'].entries()){
      const e=await f.enqueue('botón',phone),c=await f.begin(e.eventId);await f.commit(e.eventId,c,{...f.decision('driver_accept'),offerId:offers[index].id});
    }
    assert.equal(await f.scalar("SELECT device_id FROM viajes WHERE estado='en_camino'"),1);
    assert.equal(await f.scalar("SELECT count(*)::int FROM taxi_bot_outbox WHERE dedupe_key LIKE 'trip-assigned:%'"),1);
    const again=await f.enqueue('botón',driverPhone),gc=await f.begin(again.eventId);await f.commit(again.eventId,gc,{...f.decision('driver_accept'),offerId:offers[0].id});assert.equal(await f.scalar("SELECT count(*)::int FROM viajes WHERE estado='en_camino'"),1);
  }finally{await f.db.close();}
});
test('taxi status notifications match trip state from request through assignment, completion and timeout',async()=>{
  const f=await fixture();try{
    await f.prepare();await f.confirm();
    assert.match(String(await f.scalar("SELECT body->>'text'FROM taxi_bot_outbox WHERE dedupe_key LIKE 'trip-created:%'")),/^🚕 Tu solicitud quedó registrada/);
    assert.match(String(await f.scalar("SELECT body->>'text'FROM taxi_bot_outbox WHERE dedupe_key LIKE 'offer:%'")),/^🚕/);
    const offer=(await f.db.query<Record<string,unknown>>('SELECT id FROM taxi_bot_offers WHERE device_id=1')).rows[0];assert.ok(offer);
    const accepted=await f.enqueue('botón',driverPhone),acceptClaim=await f.begin(accepted.eventId);
    await f.commit(accepted.eventId,acceptClaim,{...f.decision('driver_accept'),offerId:offer.id});
    const assigned=String(await f.scalar("SELECT body->>'text'FROM taxi_bot_outbox WHERE dedupe_key LIKE 'trip-assigned:%'"));assert.match(assigned,/^🚕/);assert.match(assigned,/😊/);
    const finished=await f.enqueue('botón',driverPhone),finishClaim=await f.begin(finished.eventId);
    await f.commit(finished.eventId,finishClaim,{...f.decision('driver_finish'),offerId:offer.id});
    const completion=String(await f.scalar("SELECT body->>'text'FROM taxi_bot_outbox WHERE dedupe_key LIKE 'trip-finished:%'"));assert.match(completion,/^🚕/);assert.match(completion,/😊/);
  }finally{await f.db.close();}
  const timed=await fixture();try{
    await timed.prepare();await timed.confirm(customer,[]);await timed.db.exec("SELECT set_config('app.taxi_bot_write','on',false);UPDATE viajes SET created_at=clock_timestamp()-interval '13 minutes';SELECT set_config('app.taxi_bot_write','off',false)");
    assert.equal(await timed.scalar('SELECT taxi_bot_maintain()'),1);
    const timeout=String(await timed.scalar("SELECT body->>'text'FROM taxi_bot_outbox WHERE dedupe_key LIKE 'timeout-customer:%'"));assert.match(timeout,/^🚕/);assert.match(timeout,/🙂/);
  }finally{await timed.db.close();}
});
test('taxi SQL: tenant scope, private trips and protocol guards cannot be bypassed by old routes',async()=>{
  const f=await fixture();try{
    await f.prepare();await f.confirm(customer,[{deviceId:3,name:'Ajena'}]);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_offers'),0);
    await f.db.exec('SET ROLE anon');assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),0);await assert.rejects(f.scalar('SELECT taxi_bot_begin(gen_random_uuid())'),/permission denied/);await f.db.exec('RESET ROLE');
    await f.db.exec('SET ROLE service_role');await assert.rejects(f.scalar("UPDATE viajes SET estado='en_camino'RETURNING id"),/protocol owns/);await f.db.exec('RESET ROLE');
    const e=await f.enqueue('cancela',driverPhone),c=await f.begin(e.eventId),trip=await f.scalar('SELECT id FROM viajes');await f.commit(e.eventId,c,{...f.decision('cancel'),tripId:trip});assert.equal(await f.scalar('SELECT estado FROM viajes'),'buscando_conductor');
  }finally{await f.db.close();}
});
test('taxi SQL: outbox acceptance is distinct from delivery; uncertain sends are never resent automatically',async()=>{
  const f=await fixture();try{
    const e=await f.enqueue('hola'),claim=await f.begin(e.eventId);await f.commit(e.eventId,claim,{...f.decision('reply'),messages:[{to:customer,text:'Hola'}]});
    const rows=(await f.db.query<Record<string,unknown>>('SELECT * FROM taxi_bot_outbox_claim($1,$2)',[tenant,waba])).rows;assert.equal(rows.length,1);const m=rows[0];
    assert.equal(await f.scalar('SELECT taxi_bot_outbox_complete($1,$2,$3,$4,$5)',[m.id,m.lease,'accepted','provider-fixture',null]),true);
    assert.equal(await f.scalar('SELECT state FROM taxi_bot_outbox'),'accepted');
    assert.equal(await f.scalar('SELECT taxi_bot_provider_status($1,$2,$3,$4,$5)',[m.id,'provider-fixture',waba,driverPhone,'read']),false);
    assert.equal(await f.scalar('SELECT taxi_bot_provider_status($1,$2,$3,$4,$5)',[m.id,'provider-fixture',waba,customer,'read']),true);
    assert.equal(await f.scalar('SELECT taxi_bot_provider_status($1,$2,$3,$4,$5)',[m.id,'provider-fixture',waba,customer,'accepted']),false);
    const next=await f.enqueue('Otro mensaje'),nextClaim=await f.begin(next.eventId);await f.commit(next.eventId,nextClaim,{...f.decision('reply'),messages:[{to:customer,text:'Segundo mensaje'}]});
    const sending=(await f.db.query<Record<string,unknown>>('SELECT * FROM taxi_bot_outbox_claim($1,$2)',[tenant,waba])).rows;assert.equal(sending.length,1);
    await f.db.query("UPDATE taxi_bot_outbox SET lease_until=clock_timestamp()-interval '1 second'WHERE id=$1",[sending[0].id]);
    assert.equal((await f.db.query('SELECT * FROM taxi_bot_outbox_claim($1,$2)',[tenant,waba])).rows.length,0);assert.equal(await f.scalar('SELECT state FROM taxi_bot_outbox WHERE id=$1',[sending[0].id]),'uncertain');assert.equal(await f.scalar('SELECT state FROM taxi_bot_outbox WHERE id=$1',[m.id]),'read');
  }finally{await f.db.close();}
});
test('taxi SQL: human ownership survives subsequent replies and interpreter failures',async()=>{
  const f=await fixture();try{
    const e=await f.enqueue('persona real'),claim=await f.begin(e.eventId);await f.commit(e.eventId,claim,f.decision('human'));
    const n=await f.enqueue('hola'),nc=await f.begin(n.eventId);assert.equal(f.obj(nc.session).mode,'human');await f.commit(n.eventId,nc,{...f.decision('reply'),messages:[{to:customer,text:'Should not send'}]});
    assert.equal(await f.scalar('SELECT mode FROM taxi_bot_sessions'),'human');assert.equal(await f.scalar("SELECT count(*)::int FROM taxi_bot_outbox WHERE body->>'text'='Should not send'"),0);
  }finally{await f.db.close();}
});

test('taxi SQL: a new correction during a confirmation supersedes the turn before any trip commit',async()=>{
  const f=await fixture();try{
    await f.prepare();const first=await f.enqueueButton(),claim=await f.begin(first.eventId);assert.equal(claim.state,'proceed');
    await f.enqueue('No, mejor otro destino');
    const result=await f.commit(first.eventId,claim,{...f.decision('confirm'),confirmation:f.draft.confirmation,candidates:[{deviceId:1,name:'Unidad 1'}]});
    assert.equal(result.state,'superseded');assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),0);
    const next=await f.begin(first.eventId);assert.equal(next.state,'proceed');assert.ok(Array.isArray(next.messages));assert.equal(next.messages.length,2);
    await f.commit(first.eventId,next,{...f.decision(),draft:{...f.draft,confirmation:null,expiresAt:null}});
    assert.equal(await f.scalar("SELECT count(*)::int FROM taxi_bot_events WHERE state='completed'"),3);
  }finally{await f.db.close();}
});
test('taxi SQL: expired offers cannot assign, a driver cannot take two trips and only its accepted offer finishes',async()=>{
  const f=await fixture();try{
    await f.prepare();await f.confirm();const first=(await f.db.query<Record<string,unknown>>('SELECT id,trip_id FROM taxi_bot_offers WHERE device_id=1')).rows[0];
    await f.db.query("UPDATE taxi_bot_offers SET expires_at=clock_timestamp()-interval '1 second'WHERE id=$1",[first.id]);
    const e=await f.enqueue('botón',driverPhone),c=await f.begin(e.eventId);await f.commit(e.eventId,c,{...f.decision('driver_accept'),offerId:first.id});assert.equal(await f.scalar("SELECT count(*)::int FROM viajes WHERE estado='en_camino'"),0);
    await f.db.query("UPDATE taxi_bot_offers SET expires_at=clock_timestamp()+interval '1 minute'WHERE id=$1",[first.id]);
    const accepted=await f.enqueue('botón',driverPhone),ac=await f.begin(accepted.eventId);await f.commit(accepted.eventId,ac,{...f.decision('driver_accept'),offerId:first.id});
    const secondCustomer='+529630000008';await f.db.query('INSERT INTO taxi_bot_allowed_customers(tenant_id,phone)VALUES($1,$2)',[tenant,secondCustomer]);await f.prepare(secondCustomer);await f.confirm(secondCustomer,[{deviceId:1,name:'Unidad 1'}]);
    assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_offers WHERE device_id=1'),1);
    const forged=await f.enqueue('botón','+529630000004'),fc=await f.begin(forged.eventId);await f.commit(forged.eventId,fc,{...f.decision('driver_finish'),offerId:first.id});assert.equal(await f.scalar("SELECT count(*)::int FROM viajes WHERE estado='completado'"),0);
    const finished=await f.enqueue('botón',driverPhone),finishClaim=await f.begin(finished.eventId);await f.commit(finished.eventId,finishClaim,{...f.decision('driver_finish'),offerId:first.id});assert.equal(await f.scalar("SELECT count(*)::int FROM viajes WHERE estado='completado'"),1);
  }finally{await f.db.close();}
});
test('taxi SQL: messages to one recipient leave the outbox in durable order',async()=>{
  const f=await fixture();try{
    const e=await f.enqueue('hola'),claim=await f.begin(e.eventId);await f.commit(e.eventId,claim,{...f.decision('reply'),messages:[{to:customer,text:'Primero'},{to:customer,text:'Segundo'}]});
    const first=(await f.db.query<Record<string,unknown>>('SELECT * FROM taxi_bot_outbox_claim($1,$2)',[tenant,waba])).rows;assert.equal(first.length,1);
    assert.equal(f.obj(first[0].body).text,'Primero');
    assert.equal((await f.db.query('SELECT * FROM taxi_bot_outbox_claim($1,$2)',[tenant,waba])).rows.length,0);
    await f.scalar('SELECT taxi_bot_outbox_complete($1,$2,$3,$4,$5)',[first[0].id,first[0].lease,'accepted','fixture-1',null]);
    assert.equal((await f.db.query('SELECT * FROM taxi_bot_outbox_claim($1,$2)',[tenant,waba])).rows.length,1);
  }finally{await f.db.close();}
});
test('taxi SQL: timeout and attempts exhaustion leave durable human notifications without retrying side effects',async()=>{
  const f=await fixture();try{
    await f.prepare();await f.confirm();await f.db.exec("BEGIN;SELECT set_config('app.taxi_bot_write','on',true);UPDATE viajes SET created_at=clock_timestamp()-interval '13 minutes';COMMIT;");
    assert.equal(await f.scalar('SELECT taxi_bot_maintain()'),1);assert.equal(await f.scalar('SELECT taxi_bot_maintain()'),0);assert.equal(await f.scalar('SELECT estado FROM viajes'),'cancelado_timeout');
    const e=await f.enqueue('No entiendo');await f.db.query('UPDATE taxi_bot_events SET attempts=3 WHERE id=$1',[e.eventId]);
    assert.equal((await f.begin(e.eventId)).state,'replay');assert.equal(await f.scalar('SELECT mode FROM taxi_bot_sessions WHERE customer=$1',[customer]),'human');
    assert.equal(await f.scalar("SELECT count(*)::int FROM taxi_bot_outbox WHERE dedupe_key LIKE 'attempts-customer:%'"),1);
  }finally{await f.db.close();}
});
test('taxi SQL: expired offers and superseded summaries are discarded before provider submission',async()=>{
  const f=await fixture();try{
    await f.prepare();const initial=await f.enqueue('datos'),claim=await f.begin(initial.eventId);
    await f.commit(initial.eventId,claim,{...f.decision(),messages:[{to:customer,text:'Resumen anterior',buttons:[{id:'txc_'+f.draft.confirmation,title:'Confirmar viaje'}]}]});
    const correction=await f.enqueue('corrección'),cc=await f.begin(correction.eventId);await f.commit(correction.eventId,cc,{...f.decision(),draft:{...f.draft,confirmation:crypto.randomUUID()}});
    await f.db.query('SELECT * FROM taxi_bot_outbox_claim($1,$2)',[tenant,waba]);assert.equal(await f.scalar("SELECT state FROM taxi_bot_outbox WHERE body->>'text'='Resumen anterior'"),'failed');
    // Prepare a fresh summary and expire its resulting driver offer before sending.
    await f.prepare();await f.confirm();await f.db.exec("UPDATE taxi_bot_offers SET expires_at=clock_timestamp()-interval '1 second'");
    const claimed=(await f.db.query<Record<string,unknown>>('SELECT * FROM taxi_bot_outbox_claim($1,$2)',[tenant,waba])).rows;
    assert.equal(claimed.some((r)=>String(r.dedupe_key).startsWith('offer:')),false);assert.equal(await f.scalar("SELECT state FROM taxi_bot_outbox WHERE dedupe_key LIKE 'offer:%'LIMIT 1"),'failed');
  }finally{await f.db.close();}
});
test('taxi SQL: operator resume checks revision and does not revive old confirmation',async()=>{
  const f=await fixture();try{
    const e=await f.enqueue('humano'),claim=await f.begin(e.eventId);await f.commit(e.eventId,claim,f.decision('human'));
    const revision=await f.scalar('SELECT revision FROM taxi_bot_sessions');assert.equal(await f.scalar('SELECT taxi_bot_resume($1,$2,$3,$4)',[other,waba,customer,revision]),false);
    assert.equal(await f.scalar('SELECT taxi_bot_resume($1,$2,$3,$4)',[tenant,waba,customer,Number(revision)+1]),false);
    assert.equal(await f.scalar('SELECT taxi_bot_resume($1,$2,$3,$4)',[tenant,waba,customer,revision]),true);
    assert.equal(await f.scalar("SELECT draft->>'confirmation'FROM taxi_bot_sessions"),null);
    await f.db.exec('SET ROLE anon');await assert.rejects(f.scalar('SELECT taxi_bot_resume($1,$2,$3,$4)',[tenant,waba,customer,revision]),/permission denied/);
  }finally{await f.db.close();}
});
test('taxi SQL: service-only functions and live conversation limits remain enforced',async()=>{
  const f=await fixture();try{
    await f.db.exec('SET ROLE service_role');
    const signatures=(await f.db.query<{signature:string}>("SELECT p.oid::regprocedure::text signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'AND p.proname LIKE 'taxi_bot_%'AND p.proname<>'taxi_bot_owns_tenant'")).rows;
    for(const fn of signatures)assert.equal(await f.scalar("SELECT has_function_privilege('anon',$1,'EXECUTE')",[fn.signature]),false);
    await f.db.exec('RESET ROLE');
    await f.db.query('INSERT INTO taxi_bot_allowed_customers(tenant_id,phone)VALUES($1,$2),($1,$3),($1,$4)',[tenant,'+529630000011','+529630000012','+529630000013']);
    const a=await f.enqueue('uno','+529630000011'),b=await f.enqueue('dos','+529630000012'),d=await f.enqueue('tres','+529630000013');
    assert.equal((await f.begin(a.eventId)).state,'proceed');assert.equal((await f.begin(b.eventId)).state,'proceed');assert.equal((await f.begin(d.eventId)).state,'limited');
  }finally{await f.db.close();}
});

test('taxi reset ingress: without an alert phone, signed webhook → SQL queue → worker → trace → native location reply → provider ACK, once',async()=>{
 const f=await fixture();try{
  await f.prepare();await f.db.query('UPDATE taxi_bot_channels SET dispatcher=NULL,base_cents=5500 WHERE tenant_id=$1',[tenant]);
  const rpcArgs:Record<string,string[]>={taxi_bot_enqueue:['p_tenant','p_waba','p_message','p_hash','p_payload'],taxi_bot_begin:['p_event'],taxi_bot_commit:['p_event','p_lease','p_revision','p_decision'],taxi_bot_trace_start:['p_event','p_lease','p_revision','p_meta'],taxi_bot_trace_fail:['p_event','p_lease','p_code','p_packet'],taxi_bot_outbox_permitted:['p_id','p_lease'],taxi_bot_outbox_complete:['p_id','p_lease','p_state','p_provider','p_error'],taxi_bot_maintain:[]};
  const store:TrackingStore={writePackages:denyAdminWrite,writeCompanyPackage:denyAdminWrite,writeCompanyStatus:denyAdminWrite,writeScores:denyAdminWrite,
   read:async(table,q)=>{
    if(table==='taxi_bot_channels')return(await f.db.query<Record<string,unknown>>('SELECT * FROM taxi_bot_channels WHERE waba=$1',[q.get('waba')?.slice(3)])).rows;
    if(table==='empresas')return[{id:tenant,activo:true,tipo_negocio:'taxi',paquete:{activo:true,incluye_whatsapp:true}}];
    if(table==='taxi_bot_outbox')return(await f.db.query<Record<string,unknown>>("SELECT tenant_id,waba FROM taxi_bot_outbox WHERE state IN('pending','sending')ORDER BY created_at LIMIT 100")).rows;
    throw Error('Undeclared reset fixture read '+table);
   },
   rpc:async(name,args)=>{
    if(name==='taxi_bot_pending')return(await f.db.query<Record<string,unknown>>('SELECT * FROM taxi_bot_pending()')).rows;
    if(name==='taxi_bot_outbox_claim')return(await f.db.query<Record<string,unknown>>('SELECT * FROM taxi_bot_outbox_claim($1,$2)',[args.p_tenant,args.p_waba])).rows;
    const keys=rpcArgs[name];if(!keys)throw Error('Undeclared reset fixture RPC '+name);
    return f.scalar('SELECT '+name+'('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',keys.map(key=>args[key]));
   }
  };
  const never=async():Promise<never>=>{throw Error('A reset cannot invoke the interpreter, geocoder, quotes or fleet.');};
  let providerCalls=0;
  const transport:Fetcher=async(url,init)=>{
   assert.equal(String(url),'https://api.ycloud.com/v2/whatsapp/messages');assert.equal(init?.method,'POST');providerCalls++;
   const body:unknown=JSON.parse(String(init?.body));assert.ok(record(body));assert.equal(body.from,waba);assert.equal(body.to,customer);
   assert.ok(record(body.interactive));assert.equal(body.interactive.type,'location_request_message');assert.deepEqual(body.interactive.action,{name:'send_location'});
   return Response.json({id:'fixture-reset-provider'});
  };
  const secret='fixture-webhook-secret-not-real',workerSecret='fixture-worker-secret-at-least-32-characters';
  const engine=new TaxiEngine(store,{interpret:never,resolve:never,quote:never,candidates:never},{webhookSecret:secret,workerSecret,ycloudKey:'fixture-key',now:()=>Date.now()},transport);
  const raw=JSON.stringify({type:'whatsapp.inbound_message',createTime:new Date().toISOString(),whatsappInboundMessage:{id:crypto.randomUUID(),from:customer,to:waba,type:'text',text:{body:'/reset'}}});
  const timestamp=String(Math.floor(Date.now()/1000)),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const digest=[...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+raw)))].map(byte=>byte.toString(16).padStart(2,'0')).join(''),signature='t='+timestamp+',s='+digest;
  const response=await engine.inbound(raw,signature);assert.equal(response?.status,200);assert.equal(f.obj(await response?.json()).queued,true);
  await new Promise<void>(resolve=>setTimeout(resolve,1700));
  const tick=await engine.worker({action:'taxi_tick'},workerSecret);assert.equal(tick?.status,200);assert.deepEqual(await tick?.json(),{processed:1,deferred:0,failed:0});
  assert.equal(providerCalls,1);assert.equal(await f.scalar("SELECT count(*)::int FROM taxi_bot_turn_traces WHERE action='reset'AND state='committed'"),1);
  assert.equal(await f.scalar("SELECT count(*)::int FROM taxi_bot_outbox WHERE state='accepted'AND provider_id='fixture-reset-provider'"),1);
  assert.equal(await f.scalar("SELECT draft->>'name'FROM taxi_bot_sessions WHERE customer=$1",[customer]),null);
  assert.equal(await f.scalar('SELECT last_reset_at IS NOT NULL FROM taxi_bot_sessions WHERE customer=$1',[customer]),true);
  const duplicate=await engine.inbound(raw,signature);assert.equal(f.obj(await duplicate?.json()).duplicate,true);await engine.tick();assert.equal(providerCalls,1);
  await assert.rejects(engine.inbound(raw+' ',signature),/Firma de proveedor no válida/);
  assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),0);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_offers'),0);
 }finally{await f.db.close();}
});

test('taxi end-to-end: signed webhook → durable queue → real tool decoder → summary → one trip → provider ACK → driver acceptance',async()=>{
  const f=await fixture();try{
    await f.seedH3();
    const rpcArgs:Record<string,string[]>={taxi_bot_outbox_permitted:['p_id','p_lease'],taxi_bot_trace_start:['p_event','p_lease','p_revision','p_meta'],taxi_bot_trace_fail:['p_event','p_lease','p_code','p_packet'],taxi_bot_enqueue:['p_tenant','p_waba','p_message','p_hash','p_payload'],taxi_bot_begin:['p_event'],taxi_bot_commit:['p_event','p_lease','p_revision','p_decision'],taxi_bot_outbox_complete:['p_id','p_lease','p_state','p_provider','p_error'],taxi_bot_maintain:[]};
    const store:TrackingStore={writePackages:denyAdminWrite,writeCompanyPackage:denyAdminWrite,writeCompanyStatus:denyAdminWrite,
      read:async(table,q)=>{
        if(table==='taxi_bot_channels')return(await f.db.query<Record<string,unknown>>('SELECT * FROM taxi_bot_channels WHERE waba=$1',[q.get('waba')?.slice(3)])).rows;
        if(table==='empresas')return[{id:tenant,activo:true,tipo_negocio:'taxi',paquete:{activo:true,incluye_whatsapp:true,incluye_bot:false}}];
        if(table==='taxi_bot_outbox')return(await f.db.query<Record<string,unknown>>("SELECT tenant_id,waba FROM taxi_bot_outbox WHERE state IN('pending','sending')ORDER BY created_at LIMIT 100")).rows;
        throw new Error('Unexpected fixture read '+table);
      },writeScores:async()=>{throw new Error('Taxi must not write driving scores.');},
      rpc:async(name,args)=>{
        if(name==='taxi_bot_pending')return(await f.db.query<Record<string,unknown>>('SELECT * FROM taxi_bot_pending()')).rows;
        if(name==='taxi_bot_outbox_claim')return(await f.db.query<Record<string,unknown>>('SELECT * FROM taxi_bot_outbox_claim($1,$2)',[args.p_tenant,args.p_waba])).rows;
        const keys=rpcArgs[name];if(!keys)throw new Error('Unexpected fixture RPC '+name);
        return f.scalar('SELECT '+name+'('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',keys.map((key)=>args[key]));
      }
    };
    const current='Soy Persona Prueba, de Centro a Terminal';let modelCalls=0,providerCalls=0;
    const modelProvider:Fetcher=async(url,init)=>{
      modelCalls++;assert.equal(String(url),'https://api.deepseek.com/chat/completions');
      const body:unknown=JSON.parse(String(init?.body));assert.ok(record(body)&&Array.isArray(body.tools)&&Array.isArray(body.messages));
      const turn:unknown=body.messages.at(-1);assert.ok(record(turn)&&typeof turn.content==='string');const input:unknown=JSON.parse(turn.content);assert.ok(record(input));
      assert.equal(input.current,current,'No undeclared model decision may be automatically approved.');
      return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'call_sql',type:'function',function:{name:'actualizar_recorrido',arguments:JSON.stringify({fields:{name:{value:'Persona Prueba',evidence:current},origin:{value:'Centro',evidence:current},destination:{value:'Terminal',evidence:current}}})}}]}}],usage:{prompt_tokens:250,completion_tokens:70}}),{status:200});
    };
    const services:TaxiServices={interpret:(text,s,c,signal,observe)=>createTaxiInterpreter(modelProvider,'fixture-model-key',c.model,observe)(text,s,c,signal),resolve:async()=>({kind:'unavailable'}),quote:async()=>4500,candidates:async()=>[{deviceId:1,name:'Unidad 1'}]};
    const transport:Fetcher=async(url,init)=>{assert.equal(String(url),'https://api.ycloud.com/v2/whatsapp/messages');assert.equal(init?.method,'POST');providerCalls++;const body:unknown=JSON.parse(String(init?.body));assert.ok(record(body));assert.match(String(body.externalId),/^taxi:/);return new Response(JSON.stringify({id:'provider-fixture-'+providerCalls}),{status:202});};
    const secret='fixture-signature-secret-not-real',workerSecret='fixture-worker-secret-at-least-32-characters';
    const engine=new TaxiEngine(store,services,{webhookSecret:secret,workerSecret,ycloudKey:'fixture-key',now:()=>Date.now()},transport);
    async function inbound(content:string,from=customer,id=crypto.randomUUID(),button:string|null=null,location:{latitude:number;longitude:number}|null=null){
      const at=new Date().toISOString(),raw=JSON.stringify({createTime:at,type:'whatsapp.inbound_message',whatsappInboundMessage:{id,from,to:waba,type:button?'interactive':location?'location':'text',...(button?{interactive:{button_reply:{id:button}}}:location?{location}:{text:{body:content}})}});
      const timestamp=String(Math.floor(Date.now()/1000)),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
      const hash=[...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+raw)))].map((b)=>b.toString(16).padStart(2,'0')).join('');
      const result=await engine.inbound(raw,`t=${timestamp},s=${hash}`);assert.equal(result?.status,200);
      await f.db.exec("UPDATE taxi_bot_events SET received_at=clock_timestamp()-interval '2 seconds'WHERE state='pending'");return{raw,hash,timestamp,id};
    }
    const initial=await inbound(current);await engine.tick();assert.equal(modelCalls,1);assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),0);
    assert.equal(await f.scalar("SELECT meta->>'engineVersion'FROM taxi_bot_turn_traces LIMIT 1"),'taxi-bot-v9.1-panel-attention');
    assert.equal(await f.scalar("SELECT meta->>'promptHash'FROM taxi_bot_turn_traces LIMIT 1"),await fingerprint(TAXI_INTERPRETER_CONTRACT));
    let summary=f.obj(await f.scalar('SELECT draft FROM taxi_bot_sessions WHERE customer=$1',[customer]));assert.equal(summary.confirmation,null);assert.equal(summary.pickupText,'Centro');
    await inbound('',customer,crypto.randomUUID(),null,{latitude:16.25,longitude:-92.13});await engine.tick();summary=f.obj(await f.scalar('SELECT draft FROM taxi_bot_sessions WHERE customer=$1',[customer]));assert.ok(summary.confirmation);assert.equal(summary.quoteCents,4500);assert.equal(modelCalls,1);
    await engine.inbound(initial.raw,`t=${initial.timestamp},s=${initial.hash}`);await engine.tick();assert.equal(modelCalls,1);
    await inbound('',customer,crypto.randomUUID(),'txc_'+summary.confirmation);await engine.tick();assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),1);assert.equal(modelCalls,1);
    assert.ok(providerCalls>=3);assert.equal(await f.scalar("SELECT count(*)::int FROM taxi_bot_outbox WHERE state='delivered'"),0);
    const offer=await f.scalar('SELECT id FROM taxi_bot_offers LIMIT 1');await inbound('',driverPhone,crypto.randomUUID(),'txa_'+offer);await engine.tick();assert.equal(await f.scalar('SELECT estado FROM viajes'),'en_camino');
    assert.equal(await f.scalar("SELECT count(*)::int FROM taxi_bot_outbox WHERE dedupe_key LIKE 'trip-assigned:%'"),1);
    await assert.rejects(engine.inbound(initial.raw,'t=0,s='+'0'.repeat(64)),/Firma/);
    assert.equal(await engine.authorized(null),false);assert.equal(await engine.authorized(workerSecret),true);
  }finally{await f.db.close();}
});

test('taxi admin SQL: all 2541 owned cells are immediately available, paginated and searchable without channel assignment',async()=>{
  const f=await fixture({seedCoverageBeforeMigration:true});try{
    const seen=new Set<string>();let after:string|undefined;
    for(let pageNumber=0;pageNumber<27;pageNumber++){
      const page=parseZones(await f.scalar('SELECT taxi_bot_admin_read($1,$2,$3,$4)',[tenant,waba,'zones',{source:'catalog',...(after?{after}:{})}]));
      assert.equal(page.totalCells,2541);assert.equal(page.totalAreas,94);assert.ok(page.zones.length<=100);
      for(const z of page.zones){assert.equal(z.assigned,true);assert.equal(z.source,'base');assert.equal(seen.has(z.cell),false);seen.add(z.cell);}
      if(!page.hasMore)break;after=page.zones.at(-1)?.cell;
    }
    assert.equal(seen.size,2541);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_h3_cells'),0);
    const base=parseZones(await f.scalar('SELECT taxi_bot_admin_read($1,$2,$3,$4)',[tenant,waba,'zones',{}]));assert.equal(base.totalCells,2541);
    const search=parseZones(await f.scalar('SELECT taxi_bot_admin_read($1,$2,$3,$4)',[tenant,waba,'zones',{source:'catalog',search:'Pilita Seca'}]));
    assert.ok(search.zones.length>0);assert.ok(search.zones.every((z)=>z.label==='Pilita Seca'));
    const viewport=parseZones(await f.scalar('SELECT taxi_bot_admin_read($1,$2,$3,$4)',[tenant,waba,'zones',{source:'catalog',cells:[...seen].slice(0,3)}]));assert.equal(viewport.zones.length,3);assert.equal(viewport.totalCells,2541);
  }finally{await f.db.close();}
});
test('taxi admin SQL: channel assignment is retired, shared base edits preserve price and isolation',async()=>{
  const f=await fixture();try{
    const scope=await f.seedH3(),request=crypto.randomUUID(),payload={cells:[scope.originCell,scope.destinationCell]};
    assert.equal((await f.admin('assign_catalog',payload,0,request)).state,'action_retired');
    assert.equal((await f.admin('assign_catalog',payload,0,request)).state,'action_retired');
    assert.equal(await f.scalar('SELECT revision FROM taxi_bot_channels'),0);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_base_zones'),2);
    assert.equal(f.obj(await f.scalar('SELECT taxi_bot_h3_quote($1,$2,$3,$4)',[tenant,waba,scope.originCell,scope.destinationCell])).cents,6500);
    await f.admin('upsert_zones',{cells:[scope.originCell],label:'Precio propio',cents:9000},0);
    assert.equal((await f.admin('assign_catalog',payload,1)).state,'action_retired');assert.equal(await f.scalar('SELECT price_cents FROM taxi_bot_base_zones WHERE h3_index=$1',[scope.originCell]),9000);
    const page=parseZones(await f.scalar('SELECT taxi_bot_admin_read($1,$2,$3,$4)',[tenant,waba,'zones',{source:'catalog'}]));assert.ok(page.zones.every((z)=>z.assigned));assert.equal(page.zones.find((z)=>z.cell===scope.originCell)?.cents,9000);
    const invalid=taxiH3Scope(f.draft.origin,{...f.draft.destination,lat:16.27,lng:-92.15}).destinationCell;
    assert.equal((await f.admin('assign_catalog',{cells:[scope.originCell,invalid]},1)).state,'action_retired');assert.equal(await f.scalar('SELECT revision FROM taxi_bot_channels'),1);assert.equal(await f.scalar('SELECT count(*)::int FROM h3_zonas'),2);
    await assert.rejects(f.scalar('SELECT taxi_bot_admin_read($1,$2,$3,$4)',[other,waba,'zones',{source:'catalog'}]),/channel not found/);
    assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_h3_cells WHERE tenant_id=$1',[other]),0);
  }finally{await f.db.close();}
});

test('taxi admin SQL: a coverage change between review and commit rolls back trip, offers and notifications',async()=>{
  const f=await fixture();try{
    const scope=await f.seedH3();Object.assign(f.draft,{fareMode:'quoted',quoteCents:6500,quoteH3:scope});await f.prepare();
    const e=await f.enqueueButton(),claim=await f.begin(e.eventId),before=await f.scalar('SELECT count(*)::int FROM taxi_bot_outbox');
    const payload={name:'Base de prueba',city:'Comitán',dispatcher:'+529630000099',centerLat:16.25,centerLng:-92.13,radiusKm:0.1,pricingMode:'h3_zone_max',baseCents:null,perKmCents:null,enabled:true};
    assert.equal((await f.admin('configure',payload)).state,'saved');
    await assert.rejects(f.commit(e.eventId,claim,{...f.decision('confirm'),confirmation:f.draft.confirmation,candidates:[{deviceId:1,name:'Unidad 1'}]}),/taxi coverage changed/);
    assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),0);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_offers'),0);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_outbox'),before);
  }finally{await f.db.close();}
});

test('taxi trace SQL: commit and replay keep one completed trace tied to the original inputs',async()=>{
 const f=await fixture();try{
  const e=await f.enqueue('Soy Persona Prueba'),claim=await f.begin(e.eventId);
  assert.equal(await f.scalar('SELECT state FROM taxi_bot_turn_traces'),'running');
  await f.commit(e.eventId,claim,f.decision());assert.equal(await f.scalar('SELECT state FROM taxi_bot_turn_traces'),'committed');
  assert.equal((await f.commit(e.eventId,claim,f.decision())).state,'replay');assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_turn_traces'),1);
  assert.equal(await f.scalar('SELECT cardinality(event_ids)FROM taxi_bot_turn_traces'),1);assert.equal(await f.scalar('SELECT phase_after FROM taxi_bot_turn_traces'),'ready_for_review');
  assert.equal(await f.scalar('SELECT taxi_bot_trace_fail($1,$2,$3,$4)',[e.eventId,claim.lease,'external_failure',null]),false);assert.equal(await f.scalar('SELECT state FROM taxi_bot_turn_traces'),'committed');
  await assert.rejects(f.scalar('SELECT taxi_bot_trace_start($1,$2,$3,$4)',[e.eventId,claim.lease,0,{version:'taxi-trace-v1'}]),/stale trace start/);
 }finally{await f.db.close();}
});
test('taxi trace SQL: failures and lease recovery preserve distinct attempts instead of erasing the first error',async()=>{
 const f=await fixture();try{
  const e=await f.enqueue('datos'),claim=await f.begin(e.eventId);
  assert.equal(await f.scalar('SELECT taxi_bot_trace_fail($1,$2,$3,$4)',[e.eventId,claim.lease,'storage_unavailable',null]),true);
  await f.db.exec("UPDATE taxi_bot_sessions SET lease_until=clock_timestamp()-interval '1 second'");
  const next=await f.begin(e.eventId);assert.equal(next.state,'proceed');assert.notEqual(next.lease,claim.lease);
  await f.commit(e.eventId,next,f.decision());assert.equal(await f.scalar("SELECT count(*)::int FROM taxi_bot_turn_traces WHERE state='error'"),1);assert.equal(await f.scalar("SELECT count(*)::int FROM taxi_bot_turn_traces WHERE state='committed'"),1);
  assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_quality_contacts'),1);
 }finally{await f.db.close();}
});
test('taxi trace SQL: invalid telemetry is rejected atomically instead of storing arbitrary payloads',async()=>{
 const f=await fixture();try{
  const e=await f.enqueue('datos'),claim=await f.begin(e.eventId);
  const invalid=[{}, {version:'taxi-trace-v1',steps:[],durationMs:-1},{version:'taxi-trace-v1',steps:[],durationMs:0,secret:'not permitted'}, {version:'taxi-trace-v1',steps:[{phase:'interpret'}],durationMs:0}, {version:'taxi-trace-v1',steps:[],durationMs:0,interpretationPrivate:{intent:'provide',fields:{name:{value:42,evidence:'42'}}}}];
  for(const audit of invalid){assert.equal(await f.scalar('SELECT taxi_bot_trace_packet_valid($1)',[audit]),false);await assert.rejects(f.commit(e.eventId,claim,{...f.decision('confirm'),confirmation:f.draft.confirmation,audit}),/invalid trace packet/);}
  assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),0);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_outbox'),0);assert.equal(await f.scalar('SELECT state FROM taxi_bot_turn_traces'),'running');
 }finally{await f.db.close();}
});
test('taxi trace SQL: a correction marks the attempt superseded and its next batch has both source events',async()=>{
 const f=await fixture();try{
  const e=await f.enqueue('datos'),claim=await f.begin(e.eventId);await f.enqueue('Mejor otra recogida');
  assert.equal((await f.commit(e.eventId,claim,f.decision())).state,'superseded');assert.equal(await f.scalar('SELECT state FROM taxi_bot_turn_traces'),'superseded');
  const next=await f.begin(e.eventId);await f.commit(e.eventId,next,f.decision());assert.equal(await f.scalar("SELECT cardinality(event_ids)FROM taxi_bot_turn_traces WHERE state='committed'"),2);assert.equal(await f.scalar('SELECT count(*)::int FROM viajes'),0);
 }finally{await f.db.close();}
});
test('taxi lifecycle SQL: all state pairs agree with the declared graph and terminal states cannot reopen',async()=>{
 const f=await fixture();try{
  await f.prepare();await f.confirm();await f.db.exec("BEGIN;SELECT set_config('app.taxi_bot_write','on',true)");
  const rows:{kind:Lifecycle;table:string;column:string;id:unknown;paths:Record<string,string[]>}[]=[
   {kind:'trip',table:'viajes',column:'estado',id:await f.scalar('SELECT id FROM viajes LIMIT 1'),paths:{buscando_conductor:[],en_camino:['en_camino'],completado:['en_camino','completado'],cancelado:['cancelado'],cancelado_timeout:['cancelado_timeout']}},
   {kind:'offer',table:'taxi_bot_offers',column:'state',id:await f.scalar('SELECT id FROM taxi_bot_offers LIMIT 1'),paths:{offered:[],accepted:['accepted'],rejected:['rejected'],revoked:['revoked'],expired:['expired'],finished:['accepted','finished']}},
   {kind:'delivery',table:'taxi_bot_outbox',column:'state',id:await f.scalar('SELECT id FROM taxi_bot_outbox LIMIT 1'),paths:{pending:[],sending:['sending'],uncertain:['sending','uncertain'],accepted:['sending','accepted'],delivered:['sending','delivered'],read:['sending','read'],failed:['failed']}}];
  let pairs=0;
  for(const row of rows)for(const[before,path]of Object.entries(row.paths))for(const after of[...Object.keys(row.paths),'unknown']){
   await f.db.exec('SAVEPOINT trial');for(const state of path)await f.db.query('UPDATE '+row.table+' SET '+row.column+'=$1 WHERE id=$2',[state,row.id]);
   const beforeCount=await f.scalar('SELECT count(*)::int FROM taxi_bot_lifecycle_audit');await f.db.exec('SAVEPOINT change');
   const allowed=before===after||LIFECYCLES[row.kind][before].includes(after);
   if(allowed){await f.db.query('UPDATE '+row.table+' SET '+row.column+'=$1 WHERE id=$2',[after,row.id]);assert.equal(await f.scalar('SELECT '+row.column+' FROM '+row.table+' WHERE id=$1',[row.id]),after);}
   else{await assert.rejects(f.db.query('UPDATE '+row.table+' SET '+row.column+'=$1 WHERE id=$2',[after,row.id]));await f.db.exec('ROLLBACK TO change');assert.equal(await f.scalar('SELECT '+row.column+' FROM '+row.table+' WHERE id=$1',[row.id]),before);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_lifecycle_audit'),beforeCount);}
   await f.db.exec('ROLLBACK TO trial');pairs++;
  }
  assert.equal(pairs,128);await f.db.exec('ROLLBACK');
 }finally{await f.db.close();}
});
test('taxi quality SQL: aggregate views are scoped, bounded and keep review signals separate from confirmed errors',async()=>{
 const f=await fixture();try{
  await f.prepare();const from=new Date(Date.now()-86400000).toISOString(),to=new Date(Date.now()+1000).toISOString();
  const result=f.obj(await f.scalar('SELECT taxi_bot_quality_read($1,$2,$3,$4)',[tenant,waba,'overview',{from,to}]));assert.equal(result.attempts,1);assert.equal(result.interpretationAttempts,0);assert.equal(result.confirmedInterpretationErrors,0);assert.equal(result.blindAccuracyMeasured,false);assert.ok(!JSON.stringify(result).includes(customer));
  await assert.rejects(f.scalar('SELECT taxi_bot_quality_read($1,$2,$3,$4)',[other,waba,'overview',{from,to}]),/channel not found/);
  await assert.rejects(f.scalar('SELECT taxi_bot_quality_read($1,$2,$3,$4)',[tenant,waba,'overview',{from:'2020-01-01',to}]),/window/);
  await f.db.exec('SET ROLE anon');await assert.rejects(f.scalar('SELECT taxi_bot_quality_read($1,$2,$3,$4)',[tenant,waba,'overview',{from,to}]),/permission denied/);
 }finally{await f.db.close();}
});
test('taxi quality SQL: human labels are idempotent, isolated and cannot move holdout contacts into training',async()=>{
 const f=await fixture();try{
  await f.db.exec("UPDATE taxi_bot_quality_secret SET salt='fixed-fixture-partition-secret'");
  const expected={intent:'provide',fields:{name:{value:'Persona Prueba',evidence:'Soy Persona Prueba'}}};
  const folds=['train','holdout'];let trainId:unknown;
  for(const fold of folds){
   const number=await f.scalar("SELECT '+52963'||lpad(n::text,7,'0')FROM generate_series(10,200)n WHERE CASE WHEN(('x'||substr(encode(sha256(convert_to('fixed-fixture-partition-secret'||'|'||$1||'|'||$2||'|'||'+52963'||lpad(n::text,7,'0'),'UTF8')),'hex'),1,8))::bit(32)::bigint%10)<7 THEN 'train'WHEN(('x'||substr(encode(sha256(convert_to('fixed-fixture-partition-secret'||'|'||$1||'|'||$2||'|'||'+52963'||lpad(n::text,7,'0'),'UTF8')),'hex'),1,8))::bit(32)::bigint%10)<9 THEN 'validation'ELSE 'holdout'END=$3 LIMIT 1",[tenant,waba,fold]);assert.equal(typeof number,'string');
   await f.db.query('INSERT INTO taxi_bot_allowed_customers(tenant_id,phone)VALUES($1,$2)',[tenant,number]);
   const e=await f.enqueue('Soy Persona Prueba',String(number)),claim=await f.begin(e.eventId);await f.commit(e.eventId,claim,f.decision());
   const trace=await f.scalar('SELECT id FROM taxi_bot_turn_traces WHERE event_id=$1',[e.eventId]),id=crypto.randomUUID();
   const args=[tenant,waba,trace,42,id,0,'correct',expected];const saved=f.obj(await f.scalar('SELECT taxi_bot_quality_review($1,$2,$3,$4,$5,$6,$7,$8)',args));assert.equal(saved.cohort,fold);assert.equal(saved.revision,1);
   assert.deepEqual(await f.scalar('SELECT taxi_bot_quality_review($1,$2,$3,$4,$5,$6,$7,$8)',args),saved);
   assert.equal(f.obj(await f.scalar('SELECT taxi_bot_quality_review($1,$2,$3,$4,$5,$6,$7,$8)',[tenant,waba,trace,42,crypto.randomUUID(),0,'correct',expected])).state,'revision_conflict');
   if(fold==='train')trainId=trace;
  }
  const exported=f.obj(await f.scalar('SELECT taxi_bot_quality_read($1,$2,$3,$4)',[tenant,waba,'export',{}]));assert.equal(exported.synthetic,null);assert.equal(exported.source,'reviewed_whatsapp_events');assert.ok(Array.isArray(exported.cases));assert.equal(exported.cases.length,1);const row=f.obj(exported.cases[0]);assert.equal(row.cohort,'train');assert.equal(row.reviewer,42);assert.equal(String(row.contextHash).length,64);assert.equal(String(row.expectedHash).length,64);
  assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_quality_reviews'),2);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_quality_contacts'),2);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_quality_contacts WHERE inspected_at IS NOT NULL'),2);
  assert.equal(f.obj(await f.scalar('SELECT taxi_bot_quality_review($1,$2,$3,$4,$5,$6,$7,$8)',[tenant,waba,trainId,42,crypto.randomUUID(),1,'incomplete',null])).state,'saved');
  const noTraining=f.obj(await f.scalar('SELECT taxi_bot_quality_read($1,$2,$3,$4)',[tenant,waba,'export',{}]));assert.deepEqual(noTraining.cases,[]);
 }finally{await f.db.close();}
});
test('taxi trace SQL: retention is bounded and abandoned attempts remain distinguishable from successful commits',async()=>{
 const f=await fixture();try{
  const e=await f.enqueue('datos');await f.begin(e.eventId);
  await f.db.exec("UPDATE taxi_bot_turn_traces SET started_at=clock_timestamp()-interval '4 minutes'");await f.scalar('SELECT taxi_bot_trace_maintain()');assert.equal(await f.scalar('SELECT state FROM taxi_bot_turn_traces'),'abandoned');
  await f.db.exec("INSERT INTO taxi_bot_turn_traces(event_id,tenant_id,waba,lease,revision,contact_hash,event_ids,source_hashes,meta,phase_before,context_private,started_at)SELECT event_id,tenant_id,waba,gen_random_uuid(),revision,contact_hash,event_ids,source_hashes,meta,phase_before,context_private,clock_timestamp()-interval '31 days'FROM taxi_bot_turn_traces CROSS JOIN generate_series(1,201)");
  await f.scalar('SELECT taxi_bot_trace_maintain()');assert.equal(await f.scalar("SELECT count(*)::int FROM taxi_bot_turn_traces WHERE started_at<clock_timestamp()-interval '30 days'"),1);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_quality_contacts'),1);
 }finally{await f.db.close();}
});

test('taxi engine trace SQL: a lost commit response cannot overwrite committed history or repeat model work',async()=>{
 const f=await fixture();try{
  const e=await f.enqueue('Hola');let modelCalls=0,commitCalls=0;
  const keys:Record<string,string[]>={taxi_bot_begin:['p_event'],taxi_bot_trace_start:['p_event','p_lease','p_revision','p_meta'],taxi_bot_trace_fail:['p_event','p_lease','p_code','p_packet'],taxi_bot_commit:['p_event','p_lease','p_revision','p_decision']};
  const store:TrackingStore={writePackages:denyAdminWrite,writeCompanyPackage:denyAdminWrite,writeCompanyStatus:denyAdminWrite,read:async(table)=>{if(table==='taxi_bot_channels')return(await f.db.query<Record<string,unknown>>('SELECT * FROM taxi_bot_channels')).rows;if(table==='empresas')return[{id:tenant,activo:true,tipo_negocio:'taxi',paquete:{activo:true,incluye_whatsapp:true}}];throw new Error('Unexpected table');},writeScores:async()=>{throw new Error('No score writes');},rpc:async(name,args)=>{const order=keys[name];assert.ok(order,'Every fixture RPC must be declared');const result=await f.scalar('SELECT '+name+'('+order.map((_,i)=>'$'+(i+1)).join(',')+')',order.map((key)=>args[key]));if(name==='taxi_bot_commit'){commitCalls++;throw new Error('Simulated lost HTTP response after the real commit');}return result;}};
  const never=async():Promise<never>=>{throw new Error('Unexpected service');};const services:TaxiServices={interpret:async(current)=>{modelCalls++;assert.equal(current,'Hola');return{intent:'smalltalk',fields:{}};},resolve:never,quote:never,candidates:never};
  const engine=new TaxiEngine(store,services,{webhookSecret:'fixture-signature-secret',workerSecret:'fixture-worker-secret-at-least-32-characters',ycloudKey:'fixture-key',now:()=>Date.now()},never);
  await assert.rejects(engine.process(String(e.eventId)),/lost HTTP response/);
  assert.equal(await f.scalar('SELECT state FROM taxi_bot_turn_traces'),'committed');assert.equal(await f.scalar('SELECT state FROM taxi_bot_events'),'completed');assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_outbox'),1);
  assert.equal(await engine.process(String(e.eventId)),'replay');assert.equal(modelCalls,1);assert.equal(commitCalls,1);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_turn_traces'),1);
 }finally{await f.db.close();}
});

test('taxi trace SQL: derived phases match TypeScript and one lease cannot silently change its prompt version',async()=>{
 const f=await fixture();try{
  const now=Date.now();let combinations=0;
  for(let fields=0;fields<8;fields++)for(const mode of['bot','human']as const)for(const state of[null,'buscando_conductor','en_camino']as const)for(const review of['fresh','expired','absent','choice']as const){
   const draft={...emptyDraft(),name:fields&1?'Persona Prueba':null,origin:fields&2?f.draft.origin:null,destination:fields&4?f.draft.destination:null,confirmation:review==='absent'||review==='choice'?null:f.draft.confirmation,expiresAt:review==='absent'||review==='choice'?null:new Date(now+(review==='expired'?-1:60000)).toISOString(),awaitingLocation:review==='choice'?'choice' as const:null};
   const active=state?{id:'44444444-4444-4444-8444-444444444444',state,taxiName:null}:null;
   assert.equal(await f.scalar('SELECT taxi_bot_phase($1,$2,$3,$4)',[mode,draft,state,new Date(now).toISOString()]),conversationPhase({revision:0,mode,draft,history:[],active},now));combinations++;
  }
  assert.equal(combinations,192);
  const e=await f.enqueue('datos'),claim=await f.begin(e.eventId),meta=f.obj(await f.scalar('SELECT meta FROM taxi_bot_turn_traces'));
  assert.equal(await f.scalar('SELECT taxi_bot_trace_start($1,$2,$3,$4)',[e.eventId,claim.lease,0,meta]),true);
  await assert.rejects(f.scalar('SELECT taxi_bot_trace_start($1,$2,$3,$4)',[e.eventId,claim.lease,0,{...meta,promptHash:'b'.repeat(64)}]),/trace start conflict/);
  await assert.rejects(f.scalar('SELECT taxi_bot_trace_start($1,$2,$3,$4)',[e.eventId,claim.lease,0,{...meta,secret:'not permitted'}]),/metadata/);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_turn_traces'),1);
 }finally{await f.db.close();}
});

test('taxi training export SQL: cursor pagination has a byte budget and cannot drop or repeat reviewed cases',async()=>{
 const f=await fixture();try{
  const contact='f'.repeat(64);await f.db.query("INSERT INTO taxi_bot_quality_contacts(tenant_id,waba,contact_hash,cohort)VALUES($1,$2,$3,'train')",[tenant,waba,contact]);
  await f.db.query("INSERT INTO taxi_bot_quality_cases(tenant_id,waba,contact_hash,cohort,label,revision,reviewer,source_hashes,context_private,expected_private)SELECT $1,$2,$3,'train','correct',1,42,'[]',jsonb_build_object('before',jsonb_build_object('history',repeat('x',70000))),jsonb_build_object('intent','smalltalk','fields','{}'::jsonb)FROM generate_series(1,30)",[tenant,waba,contact]);
  const seen=new Set<string>();let after:string|undefined;let pages=0;
  for(let i=0;i<30;i++){
   const page=f.obj(await f.scalar('SELECT taxi_bot_quality_read($1,$2,$3,$4)',[tenant,waba,'export',after?{after}:{}]));assert.ok(Array.isArray(page.cases));assert.ok(page.cases.length<=25);assert.ok(Buffer.byteLength(JSON.stringify(page))<1100000);
   for(const value of page.cases){const row=f.obj(value);assert.equal(typeof row.id,'string');assert.equal(seen.has(String(row.id)),false);seen.add(String(row.id));after=String(row.id);}
   pages++;if(!page.hasMore)break;assert.ok(page.cases.length>0,'Byte limit must still allow progress');
  }
  assert.equal(seen.size,30);assert.ok(pages>1);
 }finally{await f.db.close();}
});

test('taxi quality panel SQL: keyset paging preserves tied microseconds, bounds pages and exposes no message content',async()=>{
 const f=await fixture();try{
  await f.prepare();
  await f.db.exec("UPDATE taxi_bot_turn_traces SET started_at='2026-10-28T12:00:00.123456Z';INSERT INTO taxi_bot_turn_traces(event_id,tenant_id,waba,lease,revision,contact_hash,event_ids,source_hashes,meta,phase_before,context_private,started_at)SELECT event_id,tenant_id,waba,gen_random_uuid(),revision,contact_hash,event_ids,source_hashes,meta,phase_before,context_private,started_at FROM taxi_bot_turn_traces CROSS JOIN generate_series(1,45)");
  const input={from:'2026-10-28T00:00:00Z',to:'2026-10-29T00:00:00Z'};let after:{startedAt:string;id:string}|undefined;const ids=new Set<string>();let pages=0;
  while(pages<4){const raw=await f.scalar('SELECT taxi_bot_quality_read($1,$2,$3,$4)',[tenant,waba,'attempts',{...input,...(after?{after}:{})}]),page=parseQualityPage(raw);assert.ok(page.items.length<=20);assert.ok(!JSON.stringify(raw).includes(customer));assert.ok(!JSON.stringify(raw).includes('Persona Prueba'));
   for(const item of page.items){assert.equal(ids.has(item.id),false);ids.add(item.id);assert.ok(item.startedAt.includes('.123456'));after={startedAt:item.startedAt,id:item.id};}
   pages++;if(!page.hasMore)break;
  }
  assert.equal(pages,3);assert.equal(ids.size,46);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_quality_contacts WHERE inspected_at IS NOT NULL'),0);
  await assert.rejects(f.scalar('SELECT taxi_bot_quality_read($1,$2,$3,$4)',[other,waba,'attempts',input]),/channel not found/);
  await assert.rejects(f.scalar('SELECT taxi_bot_quality_read($1,$2,$3,$4)',[tenant,waba,'attempts',{...input,after:{}}]),/cursor/);
 }finally{await f.db.close();}
});
test('taxi quality panel SQL: private case and saved correction match the strict UI contract',async()=>{
 const f=await fixture();try{
  await f.prepare();const traceId=String(await f.scalar('SELECT id FROM taxi_bot_turn_traces'));
  const read=()=>f.scalar('SELECT taxi_bot_quality_read($1,$2,$3,$4)',[tenant,waba,'trace',{traceId}]);
  const detail=parseQualityDetail(await read());assert.equal(detail.id,traceId);assert.equal(detail.messages[0].text,'A nombre de Persona Prueba');assert.equal(detail.review,null);assert.equal(detail.proposal,null);
  const expected={intent:'provide',fields:{name:{value:'Persona Prueba',evidence:'A nombre de Persona Prueba'}}};
  assert.equal(f.obj(await f.scalar('SELECT taxi_bot_quality_review($1,$2,$3,$4,$5,$6,$7,$8)',[tenant,waba,traceId,42,crypto.randomUUID(),0,'interpretation_error',expected])).state,'saved');
  const reviewed=parseQualityDetail(await read());assert.equal(reviewed.review?.revision,1);assert.deepEqual(reviewed.review?.expected,expected);assert.equal(await f.scalar('SELECT count(*)::int FROM taxi_bot_quality_contacts WHERE inspected_at IS NOT NULL'),1);
 }finally{await f.db.close();}
});
