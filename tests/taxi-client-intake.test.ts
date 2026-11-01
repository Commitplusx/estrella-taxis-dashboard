import {assert,assertEquals} from 'https://deno.land/std@0.177.0/testing/asserts.ts';
import {coordinateTaxi,type TaxiServices} from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/coordinator.ts';
import {parseInterpretation} from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/policy.ts';
import {TAXI_INTAKE_CASES,INTAKE_CHANNEL,INTAKE_NOW,matchesIntake,intakeMessage,intakePin,intakeSession} from './fixtures/taxi-client-intake.ts';
import type {Interpretation,TaxiDecision,TaxiInbound,TaxiSession} from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
function providers(proposal:Interpretation){let quotes=0,lookups=0;const services:TaxiServices={interpret:async current=>parseInterpretation(proposal,current),resolve:async()=>({kind:'unavailable'}),quote:async()=>{quotes++;return 5500;},candidates:async()=>{lookups++;return[];}};return{services,counts:()=>({quotes,lookups})};}
for(const item of TAXI_INTAKE_CASES)Deno.test('customer intake: '+item.id,async()=>{
 const fixture=providers(item.proposal),before=JSON.stringify(item.session),d=await coordinateTaxi(item.messages,item.session,INTAKE_CHANNEL,fixture.services,INTAKE_NOW);
 assert(matchesIntake(d,item),JSON.stringify({reason:d.reason,draft:d.draft}));assertEquals(fixture.counts().lookups,0);assertEquals(JSON.stringify(item.session),before);
 if(item.expected.pickup&&item.expected.destination===null){assert(d.messages[0].buttons?.some(b=>b.id.startsWith('txd_')));assert(!d.messages[0].locationRequest);}
});
Deno.test('customer intake: independent bubbles preserve data, omit destination explicitly and require a current confirmation click',async()=>{
 const s=intakeSession();let proposal:Interpretation={intent:'request',fields:{}},lookups=0;
 const services:TaxiServices={interpret:async current=>parseInterpretation(proposal,current),resolve:async()=>({kind:'unavailable'}),quote:async()=>5500,candidates:async()=>{lookups++;return[];}};
 function save(d:TaxiDecision,messages:TaxiInbound[]){s.draft=d.draft;s.history.push(...messages.map(m=>({role:'user' as const,content:m.text})),...d.messages.map(m=>({role:'assistant' as const,content:m.text})));}
 const first=[intakeMessage('Necesito un servicio por favor')];let d=await coordinateTaxi(first,s,INTAKE_CHANNEL,services,INTAKE_NOW);save(d,first);
 proposal={intent:'provide',fields:{}};const pin=[intakePin()];d=await coordinateTaxi(pin,s,INTAKE_CHANNEL,services,INTAKE_NOW);save(d,pin);
 proposal={intent:'provide',fields:{name:{value:'Diego Villalba',evidence:'Diego Villalba'},pickupReference:{value:'En la fábrica de tostadas Botanitos',evidence:'En la fábrica de tostadas Botanitos'}}};const details=[intakeMessage('Diego Villalba','name'),intakeMessage('En la fábrica de tostadas Botanitos','reference')];d=await coordinateTaxi(details,s,INTAKE_CHANNEL,services,INTAKE_NOW);save(d,details);assertEquals(d.draft.name,'Diego Villalba');assertEquals(d.draft.pickupMessageId,pin[0].id);assertEquals(lookups,0);assert(d.draft.destinationPrompt);
 const deferred={...intakeMessage(''),type:'button' as const,button:'txd_'+d.draft.destinationPrompt};d=await coordinateTaxi([deferred],s,INTAKE_CHANNEL,services,INTAKE_NOW);save(d,[deferred]);assert(d.draft.confirmation);assert(!/\$|MXN/.test(d.messages[0].text));assertEquals(lookups,0);
 proposal={intent:'ambiguous',fields:{}};const typed=await coordinateTaxi([intakeMessage('Sí, mándalo')],s,INTAKE_CHANNEL,services,INTAKE_NOW);assertEquals(lookups,0);assertEquals(typed.action,'draft');
 const confirm={...intakeMessage(''),type:'button' as const,button:'txc_'+s.draft.confirmation};d=await coordinateTaxi([confirm],s,INTAKE_CHANNEL,services,INTAKE_NOW);assertEquals(d.action,'confirm');assertEquals(lookups,1);
});
Deno.test('customer intake: a place cannot become a name just because it accompanies a pin',async()=>{
 const fixture=providers({intent:'provide',fields:{name:{value:'Plaza Las Flores',evidence:'Plaza Las Flores'}}});const d=await coordinateTaxi([intakePin(),intakeMessage('Plaza Las Flores')],intakeSession(),INTAKE_CHANNEL,fixture.services,INTAKE_NOW);assertEquals(d.draft.name,null);assertEquals(d.draft.pickupMessageId,'pickup');assertEquals(fixture.counts().lookups,0);assert(!d.draft.confirmation);
});
Deno.test('customer intake: adding a pickup landmark after three collection replies is a permitted clarification',async()=>{
 const s=intakeSession(true);s.draft.name='Mariana';s.messageBudget={normal:3,extra:0,closed:false};
 const fixture=providers({intent:'provide',fields:{pickupReference:{value:'En la fábrica de tostadas Botanitos',evidence:'En la fábrica de tostadas Botanitos'}}});
 const d=await coordinateTaxi([intakeMessage('En la fábrica de tostadas Botanitos')],s,INTAKE_CHANNEL,fixture.services,INTAKE_NOW);
 assertEquals(d.action,'draft');assertEquals(d.replyClass,'change');assertEquals(d.draft.pickupMessageId,'saved-pickup');assertEquals(d.draft.name,'Mariana');assert(!d.messages[0].locationRequest);assertEquals(fixture.counts().lookups,0);
});
