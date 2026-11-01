import {assert,assertEquals} from 'https://deno.land/std@0.177.0/testing/asserts.ts';
import {coordinateTaxi,type TaxiServices} from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/coordinator.ts';
import {parseInterpretation} from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/policy.ts';
import {parseSession} from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
import {TAXI_INTAKE_CASES,INTAKE_CHANNEL,INTAKE_NOW,matchesIntake,intakeMessage,intakePin,intakeSession} from './fixtures/taxi-client-intake.ts';
import type {Interpretation,TaxiDecision,TaxiInbound} from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
function providers(proposal:Interpretation){let quotes=0,lookups=0;const services:TaxiServices={interpret:async current=>parseInterpretation(proposal,current),resolve:async()=>({kind:'unavailable'}),quote:async()=>{quotes++;return 5500;},candidates:async()=>{lookups++;return[];}};return{services,counts:()=>({quotes,lookups})};}
for(const item of TAXI_INTAKE_CASES)Deno.test('customer intake: '+item.id,async()=>{
 const fixture=providers(item.proposal),before=JSON.stringify(item.session),d=await coordinateTaxi(item.messages,item.session,INTAKE_CHANNEL,fixture.services,INTAKE_NOW);
 assert(matchesIntake(d,item),JSON.stringify({reason:d.reason,draft:d.draft}));assertEquals(fixture.counts().lookups,0);assertEquals(JSON.stringify(item.session),before);
 if(item.expected.pickup&&item.expected.destination===null){assert(d.messages[0].buttons?.some(b=>b.id.startsWith('txd_')));assert(!d.messages[0].locationRequest);}
});
Deno.test('customer intake: independent bubbles preserve data, omit destination explicitly and require a current confirmation click',async()=>{
 let s=intakeSession(),proposal:Interpretation={intent:'request',fields:{}},lookups=0,quotes=0,now=INTAKE_NOW;
 const services:TaxiServices={interpret:async current=>parseInterpretation(proposal,current),resolve:async()=>({kind:'unavailable'}),quote:async()=>{quotes++;return 5500;},candidates:async()=>{lookups++;return[];}};
 async function turn(message:TaxiInbound,next:Interpretation):Promise<TaxiDecision>{
  // Separate turns are more than 15 seconds apart. Round-trip the durable session,
  // including its synthetic outbound ledger; this is not a PostgreSQL commit test.
  now+=30000;proposal=next;const incoming={...message,id:'turn-'+(s.revision+1),at:new Date(now-15000).toISOString()};
  const d=await coordinateTaxi([incoming],s,INTAKE_CHANNEL,services,now);
  assert(d.replyClass);assert(d.action==='draft'||d.action==='confirm'||d.action==='reply'&&d.reason==='stale_confirmation',d.reason);
  if(d.action!=='confirm'){
   assertEquals(d.messages.length,1);assert(!/\$|MXN/.test(d.messages[0].text));
   if(s.draft.pickupMessageId)assert(!d.messages[0].locationRequest,'Must not ask for the saved pickup pin again');
  }
  const budget=s.messageBudget??{normal:0,extra:0,closed:false};
  s=parseSession({...s,revision:s.revision+1,draft:d.draft,history:[...s.history,{role:'user',content:incoming.text||'[Ubicación o botón]'},...d.messages.map(m=>({role:'assistant',content:m.text}))].slice(-12),messageBudget:{normal:budget.normal+(d.replyClass==='normal'?d.messages.length:0),extra:budget.extra+(d.replyClass!=='normal'?d.messages.length:0),closed:false}});
  return d;
 }
 await turn(intakeMessage('Necesito un servicio por favor'),{intent:'request',fields:{}});
 await turn(intakePin(),{intent:'provide',fields:{}});const pickupId=s.draft.pickupMessageId;assert(pickupId);
 await turn(intakeMessage('Diego Villalba'),{intent:'provide',fields:{name:{value:'Diego Villalba',evidence:'Diego Villalba'}}});
 assertEquals(s.messageBudget?.normal,3);assert(s.draft.destinationPrompt);const oldDestinationPrompt=s.draft.destinationPrompt;
 for(const reference of ['En la fábrica de tostadas Botanitos','A un costado de la zona industrial']){
  const d=await turn(intakeMessage(reference),{intent:'provide',fields:{pickupReference:{value:reference,evidence:reference}}});
  assertEquals(d.replyClass,'change');assertEquals(d.draft.name,'Diego Villalba');assertEquals(d.draft.pickupMessageId,pickupId);assertEquals(d.draft.destinationText??null,null);
 }
 assert(s.draft.pickupText?.includes('En la fábrica de tostadas Botanitos'));assert(s.draft.pickupText?.includes('A un costado de la zona industrial'));
 assertEquals(s.messageBudget,{normal:3,extra:2,closed:false});assertEquals(lookups,0);
 const staleChoice=await turn({...intakeMessage(''),type:'button',button:'txd_'+oldDestinationPrompt},{intent:'ambiguous',fields:{}});
 assertEquals(staleChoice.reason,'stale_destination_choice');assert(!s.draft.destinationDeferred);assert(!s.draft.confirmation);assert(s.draft.destinationPrompt);
 const deferred=await turn({...intakeMessage(''),type:'button',button:'txd_'+s.draft.destinationPrompt},{intent:'ambiguous',fields:{}});
 assert(deferred.draft.confirmation);assert(quotes>0);assertEquals(lookups,0);
 const oldConfirmation=s.draft.confirmation;
 await turn(intakeMessage('Sí, mándalo'),{intent:'ambiguous',fields:{}});assertEquals(lookups,0);assert(s.draft.confirmation);
 // A forged/stale button cannot authorize a trip or invalidate the current one.
 const currentConfirmation=s.draft.confirmation;
 const stale=await turn({...intakeMessage(''),type:'button',button:'txc_'+(oldConfirmation===currentConfirmation?crypto.randomUUID():oldConfirmation)},{intent:'ambiguous',fields:{}});
 assertEquals(stale.reason,'stale_confirmation');assertEquals(s.draft.confirmation,currentConfirmation);assertEquals(lookups,0);
 const confirmed=await turn({...intakeMessage(''),type:'button',button:'txc_'+s.draft.confirmation},{intent:'ambiguous',fields:{}});
 assertEquals(confirmed.action,'confirm');assertEquals(lookups,1);assertEquals(s.messageBudget?.normal,3);assertEquals(s.draft.pickupMessageId,pickupId);
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
