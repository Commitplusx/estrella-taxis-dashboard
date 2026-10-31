import {assert,assertEquals,assertThrows} from 'https://deno.land/std@0.177.0/testing/asserts.ts';
import {emptyDraft,parseSession,type TaxiSession,type TaxiDecision} from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
import {constrainTaxiConversation,missingBookingDetails,taxiReplyClass} from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/messageBudget.ts';
import {parseTaxiQuestion} from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/conversationReply.ts';
const session=():TaxiSession=>({revision:0,mode:'bot',active:null,history:[],draft:emptyDraft(),messageBudget:{normal:3,extra:0,closed:false}});
const decision=(s:TaxiSession):TaxiDecision=>({action:'draft',draft:{...s.draft},confirmation:null,tripId:null,offerId:null,candidates:[],messages:[{to:'+529630000002',text:'Comparte los datos pendientes.'}],reason:'missing_destination'});
const input={id:'fixture',from:'+529630000002',to:'+529630000001',at:new Date().toISOString(),type:'text' as const,text:'Un taxi',button:null,location:null};
Deno.test('brief flow: three ordinary collection messages cannot become an endless collection loop',()=>{
 const s=session(),d=decision(s);constrainTaxiConversation(s,d,[input]);assertEquals(d.action,'human');assertEquals(d.reason,'conversation_budget');assertEquals(d.messages.length,1);assert(!d.draft.confirmation);assert(/no se ha pedido/.test(d.messages[0].text));
});
Deno.test('brief flow: questions, corrections, current summaries and a new service survive the normal budget',()=>{
 const s=session();for(const kind of ['question','change','summary','new'] as const){const d=decision(s);if(kind==='question')d.reason='service_question';if(kind==='change'){s.draft.name='Mariana';d.draft.name='Rosa';}if(kind==='summary')d.draft.confirmation=crypto.randomUUID();if(kind==='new')s.messageBudget={normal:5,extra:2,closed:true};constrainTaxiConversation(s,d,[input]);assertEquals(d.action,'draft');}
});
Deno.test('brief flow: courtesy uses no outbound request; model data cannot set the budget',()=>{
 const s=session(),d=decision(s);d.action='reply';d.reason='courtesy';constrainTaxiConversation(s,d,[{...input,text:'Gracias'}]);assertEquals(d.messages,[]);
 for(const budget of [{normal:6,extra:0,closed:false},{normal:-1,extra:0,closed:false},{normal:1,extra:'0',closed:false}])assertThrows(()=>parseSession({...s,messageBudget:budget}));
 assertEquals(taxiReplyClass(s,{...decision(s),reason:'quote_only'}),'question');assertEquals(missingBookingDetails(emptyDraft()),['pickup_gps','passenger_name','destination_optional']);
});
const completion=(question:string)=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({question})}}]});
Deno.test('brief flow: generated grouped requests must include every pending detail',()=>{
 const context={baseName:'Base sintética',city:'Comitán',hasPickupGps:false,hasName:false,hasDestination:false,destinationDeferred:false,phase:'origin',activeState:null,recent:[],nextStep:'booking_details' as const,missingDetails:missingBookingDetails(emptyDraft())};
 const response='¿Me compartes tu ubicación con el botón, tu nombre y a dónde te llevamos? El destino puedes decírselo al chofer. 🚕';
 assertEquals(parseTaxiQuestion(completion(response),'conversation',context),response);
 assertThrows(()=>parseTaxiQuestion(completion('¿Me compartes tu ubicación con el botón? 🚕'),'conversation',context));
});
