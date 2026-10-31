import {assert,assertEquals,assertThrows} from 'https://deno.land/std@0.177.0/testing/asserts.ts';
import {coordinateTaxi,taxiSummary,type TaxiServices} from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/coordinator.ts';
import {emptyDraft,parseSession,type Interpretation,type TaxiChannel,type TaxiInbound,type TaxiSession} from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
import {conversationPhase} from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/stateMachine.ts';
import {parseTaxiQuestion,type TaxiNextStep,type TaxiReplyContext} from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/conversationReply.ts';
import {parseOutgoing,sendTaxiMessage} from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/transport.ts';
const now=Date.parse('2026-10-31T18:00:00Z');
const channel:TaxiChannel={tenantId:'11111111-1111-4111-8111-111111111111',waba:'+529630000001',enabled:true,name:'Base sintética',city:'Comitán',centerLat:16.25,centerLng:-92.13,radiusKm:20,dispatcher:null,model:'fixture',baseCents:5500,perKmCents:null,pricingMode:'road_distance'};
const origin={text:'Pin de recogida',lat:16.25,lng:-92.13,placeId:null,source:'gps' as const};
const destination={...origin,text:'Pin de destino',lat:16.26,lng:-92.14};
const token='33333333-3333-4333-8333-333333333333';
const message=(text:string):TaxiInbound=>({id:crypto.randomUUID(),from:'+529630000002',to:channel.waba,at:new Date(now).toISOString(),type:'text',text,button:null,location:null});
const stages=['origin','destination','name','location_role','ready_for_review','review','review_expired'] as const;
type Stage=typeof stages[number];
function session(stage:Stage):TaxiSession {
 const draft={...emptyDraft(),origin,pickupMessageId:'native-pickup',destination,name:'Mariana',pickupText:'Frente al portón azul'};
 if(stage==='origin')return{revision:1,mode:'bot',active:null,history:[],draft:{...draft,origin:null,pickupMessageId:null,awaitingLocation:'origin'}};
 if(stage==='destination')return{revision:1,mode:'bot',active:null,history:[],draft:{...draft,destination:null,awaitingLocation:'destination',destinationPrompt:token,expiresAt:new Date(now+600000).toISOString()}};
 if(stage==='name')return{revision:1,mode:'bot',active:null,history:[],draft:{...draft,name:null}};
 if(stage==='location_role')return{revision:1,mode:'bot',active:null,history:[],draft:{...draft,awaitingLocation:'choice',pendingLocation:{place:destination,messageId:'native-pending',expiresAt:new Date(now+600000).toISOString()}}};
 return{revision:1,mode:'bot',active:null,history:[],draft:{...draft,...(stage==='ready_for_review'?{}:{fareMode:'quoted',quoteCents:5500,confirmation:token,expiresAt:new Date(now+(stage==='review_expired'?-1:600000)).toISOString()})}};
}
const causes=['failed_interpretation','ambiguous','no_fields','smalltalk','assent','old_button','question','unsupported'] as const;
for(const stage of stages)for(const cause of causes)for(const composer of ['unavailable','throws'] as const)Deno.test(`recovery resumes ${stage} after ${cause}, composer=${composer}`,async()=>{
 const s=parseSession(session(stage)),before=JSON.stringify(s);let interprets=0,quotes=0,compositions=0;
 const proposal:Interpretation={intent:cause==='ambiguous'?'ambiguous':cause==='smalltalk'?'smalltalk':cause==='question'?'question':'provide',fields:{}};
 const services:TaxiServices={interpret:async()=>{interprets++;if(cause==='failed_interpretation')throw Error('Declared interpreter outage');return proposal;},resolve:async()=>{throw Error('No new endpoint was supplied');},quote:async()=>{quotes++;return 5500;},candidates:async()=>{throw Error('Recovery is never consent');},question:async()=>{compositions++;if(composer==='throws')throw Error('Declared composer outage');return null;}};
 const input=cause==='assent'?message('Sí'):cause==='old_button'?{...message(''),type:'button' as const,button:'txc_55555555-5555-4555-8555-555555555555'}:cause==='unsupported'?{...message(''),type:'unsupported' as const}:message(cause==='smalltalk'?'Sigo aquí':cause==='question'?'¿Qué sigue ahora?':'No entendí bien');
 const result=await coordinateTaxi([input],s,channel,services,now);
 assert(['draft','reply'].includes(result.action));assertEquals(result.candidates,[]);assertEquals(JSON.stringify(s),before);
 assertEquals(result.draft.origin,s.draft.origin);assertEquals(result.draft.pickupMessageId,s.draft.pickupMessageId);assertEquals(result.draft.pickupText,s.draft.pickupText);assertEquals(result.draft.destination,s.draft.destination);assertEquals(result.draft.name,s.draft.name);
 const text=result.messages.map(item=>item.text).join('\n');assert(!/\$|MXN|pesos/.test(text));
 if(stage==='origin'){assertEquals(result.messages[0].locationRequest,'origin');assertEquals(result.draft.confirmation,null);}
 else if(stage==='destination'){assertEquals(result.draft.awaitingLocation,'destination');assert(result.draft.destinationPrompt);assert(result.messages.some(item=>item.buttons?.some(button=>button.id==='txd_'+result.draft.destinationPrompt)));}
 else if(stage==='name'){assert(/nombre/.test(text));assertEquals(result.draft.confirmation,null);assertEquals(result.messages[0].locationRequest,undefined);}
 else if(stage==='location_role'){assertEquals(result.draft.pendingLocation,s.draft.pendingLocation);assert(/recog|pasamos por ti/.test(text)&&/destino|a dónde vas/.test(text));assertEquals(result.draft.confirmation,null);}
 else if(cause==='question'&&stage==='review'){assertEquals(result.draft,s.draft);assertEquals(quotes,0);}
 else{assert(result.draft.confirmation);assert(result.messages.some(item=>item.buttons?.some(button=>button.id==='txc_'+result.draft.confirmation)));assertEquals(conversationPhase({...s,draft:result.draft},now),'review');}
 assert(interprets<=1);assert(quotes<=1);assert(compositions<=1);
 const restored=parseSession({...s,draft:result.draft});assertEquals(restored.draft,result.draft);
});
for(const kind of ['smalltalk','service_question','conversation'] as const)for(const [step,good]of [
 ['pickup_gps','Claro 😊 ¿Me compartes tu ubicación con el botón para pasar por ti?'],
 ['passenger_name','Aquí sigo 😊 ¿A nombre de quién queda el taxi?'],
 ['destination_optional','Ya tengo dónde pasamos por ti 😊 ¿A dónde te llevamos? Puedes decírselo al chofer después.'],
 ['location_role','¿El pin es donde pasamos por ti o el destino? 😊'],
] satisfies [TaxiNextStep,string][])Deno.test(`natural ${kind} must preserve backend next step ${step}`,()=>{
 const context:TaxiReplyContext={baseName:channel.name,city:channel.city,hasPickupGps:false,hasName:false,hasDestination:false,destinationDeferred:false,phase:'fixture',activeState:null,recent:[],nextStep:step};
 const raw=(question:string)=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({question})}}]});
 assertEquals(parseTaxiQuestion(raw(good),kind,context),good);
 assertThrows(()=>parseTaxiQuestion(raw('Aquí estoy pendiente para lo que necesites 😊'),kind,context));
});
Deno.test('recovery expiry refreshes price once; old buttons cannot invalidate a still-current review',async()=>{
 const s=session('review_expired');let quotes=0,dispatches=0;
 const services:TaxiServices={interpret:async()=>{throw Error('A click does not call the model');},resolve:async()=>{throw Error('No textual endpoint');},quote:async()=>{quotes++;return 6500;},candidates:async()=>{dispatches++;return[{deviceId:1,name:'Unidad sintética'}];}};
 const old={...message(''),type:'button' as const,button:'txc_'+token};
 const refreshed=await coordinateTaxi([old],s,channel,services,now);assertEquals(refreshed.action,'draft');assertEquals(refreshed.draft.quoteCents,6500);assert(refreshed.draft.confirmation!==token);assertEquals(quotes,1);assertEquals(dispatches,0);
 const current={...s,draft:refreshed.draft};
 const repeated=await coordinateTaxi([old],current,channel,services,now);assertEquals(repeated.action,'reply');assertEquals(repeated.draft,current.draft);assertEquals(quotes,1);assertEquals(dispatches,0);assert(repeated.messages[0].buttons?.some(button=>button.id==='txc_'+current.draft.confirmation));
 const accepted=await coordinateTaxi([{...old,button:'txc_'+current.draft.confirmation}],current,channel,services,now);assertEquals(accepted.action,'confirm');assertEquals(dispatches,1);assertEquals(quotes,2);
});
for(const failure of ['missing','throws','below_minimum'] as const)Deno.test(`recovery cannot expose a new confirmation on ${failure} fare`,async()=>{
 const s=session('review_expired');let quotes=0;
 const services:TaxiServices={interpret:async()=>{throw Error('Declared model outage');},resolve:async()=>{throw Error('No textual endpoint');},quote:async()=>{quotes++;if(failure==='throws')throw Error('Declared fare outage');return failure==='missing'?null:4500;},candidates:async()=>{throw Error('No consent');}};
 const result=await coordinateTaxi([message('No entendí')],s,channel,services,now);assertEquals(result.action,'human');assertEquals(result.draft.confirmation,null);assertEquals(result.draft.origin,s.draft.origin);assertEquals(quotes,1);assert(!result.messages.some(item=>item.buttons?.some(button=>button.id.startsWith('txc_'))));
});
for(const ownership of ['human','searching','en_route'] as const)Deno.test(`recovery respects ${ownership} ownership`,async()=>{
 const s=session('review_expired');if(ownership==='human')s.mode='human';else s.active={id:crypto.randomUUID(),state:ownership==='searching'?'buscando_conductor':'en_camino',taxiName:'Unidad sintética'};
 const never=async():Promise<never>=>{throw Error('An owned session cannot start a new booking');};
 const result=await coordinateTaxi([{...message(''),type:'button',button:'txc_'+token}],s,channel,{interpret:never,resolve:never,quote:never,candidates:never},now);assertEquals(result.action,'reply');assertEquals(result.draft,s.draft);assertEquals(result.candidates,[]);
});
for(const ownership of ['human','searching','en_route'] as const)Deno.test(`unsupported media cannot start a new booking under ${ownership} ownership`,async()=>{
 const s=session('review_expired');if(ownership==='human')s.mode='human';else s.active={id:crypto.randomUUID(),state:ownership==='searching'?'buscando_conductor':'en_camino',taxiName:'Unidad sintética'};
 const never=async():Promise<never>=>{throw Error('An owned session cannot restart');};
 const result=await coordinateTaxi([{...message(''),type:'unsupported'}],s,channel,{interpret:never,resolve:never,quote:never,candidates:never},now);assertEquals(result.action,'reply');assertEquals(result.draft,s.draft);assertEquals(result.candidates,[]);
});
Deno.test('a service question renews an expired optional-destination control instead of resending its unusable token',async()=>{
 const s=session('destination');s.draft.expiresAt=new Date(now-1).toISOString();
 const never=async():Promise<never>=>{throw Error('No quote or dispatch before destination choice');};
 const result=await coordinateTaxi([message('¿Qué sigue?')],s,channel,{interpret:async()=>({intent:'question',fields:{}}),resolve:never,quote:never,candidates:never},now);
 assertEquals(result.draft.origin,s.draft.origin);assert(result.draft.destinationPrompt&&result.draft.destinationPrompt!==token);assert(Date.parse(result.draft.expiresAt??'')>now);assert(result.messages[0].buttons?.some(button=>button.id==='txd_'+result.draft.destinationPrompt));
});
for(const mediaPosition of [0,1,2])Deno.test(`mixed media at ${mediaPosition} preserves supported name and native pickup from the same batch`,async()=>{
 const s=session('origin');s.draft.name=null;let interpretations=0,quotes=0;
 const pin:TaxiInbound={...message(''),type:'location',location:{lat:16.25,lng:-92.13}};
 const messages=[message('Soy Jorge'),pin];messages.splice(mediaPosition,0,{...message(''),type:'unsupported'});
 const result=await coordinateTaxi(messages,s,channel,{interpret:async current=>{interpretations++;assertEquals(current,'Soy Jorge');return{intent:'provide',fields:{name:{value:'Jorge',evidence:current}}};},resolve:async()=>{throw Error('Native pin does not need a resolver');},quote:async()=>{quotes++;return 5500;},candidates:async()=>{throw Error('Mixed media is not consent');}},now);
 assertEquals(result.draft.name,'Jorge');assertEquals(result.draft.pickupMessageId,pin.id);assertEquals(result.draft.origin?.source,'gps');assert(result.draft.confirmation);assertEquals(interpretations,1);assertEquals(quotes,1);assert(result.messages[0].text.includes('no puedo leer audios'));assert(!/\$|MXN|pesos/.test(result.messages[0].text));
});
for(const cause of ['assent','failed_interpretation','old_button'] as const)Deno.test(`long review after ${cause} preserves every field while keeping the confirmation body within WhatsApp limits`,async()=>{
 const s=session('review_expired');s.draft.name=('Mariana '.repeat(10)).trim();s.draft.pickupText='Referencia '.repeat(40).slice(0,400);s.draft.destination=null;s.draft.destinationText='Destino '.repeat(50);
 let quotes=0,submissions=0;
 const services:TaxiServices={interpret:async()=>{throw Error('Declared interpreter outage');},resolve:async()=>{throw Error('No new endpoint');},quote:async()=>{quotes++;return 5500;},candidates:async()=>{throw Error('No current consent');}};
 const input=cause==='old_button'?{...message(''),type:'button' as const,button:'txc_'+token}:message(cause==='assent'?'Sí':'No entendí');
 const result=await coordinateTaxi([input],s,channel,services,now);assertEquals(result.action,'draft');assert(result.draft.confirmation);assertEquals(quotes,1);assertEquals(result.messages.length,1);
 assertEquals(result.draft.pickupText,s.draft.pickupText);assertEquals(result.draft.destinationText,s.draft.destinationText);
 assert(result.messages[0].text.includes(taxiSummary(result.draft)));assert(result.messages[0].text.includes('…'));
 assert(result.messages[0].text.length<=1024);assert(result.messages[0].buttons?.some(button=>button.id==='txc_'+result.draft.confirmation));assert(!/\$|MXN|pesos/.test(result.messages.map(item=>item.text).join('\n')));
 for(const outgoing of result.messages){const persisted=parseOutgoing({id:crypto.randomUUID(),lease:crypto.randomUUID(),tenant_id:channel.tenantId,waba:channel.waba,destination:input.from,body:outgoing});
  const outcome=await sendTaxiMessage(persisted,'fixture-key',async(_url,init)=>{submissions++;const body:unknown=JSON.parse(String(init?.body));assert(body!==null&&typeof body==='object'&&'type' in body);return Response.json({id:'synthetic-provider-ack'});});assertEquals(outcome.state,'accepted');}
 assertEquals(submissions,1);
});
for(const length of [1024,1025,4096])Deno.test(`provider boundary enforces an interactive body of ${length} characters without retry`,async()=>{
 const raw={id:crypto.randomUUID(),lease:crypto.randomUUID(),tenant_id:channel.tenantId,waba:channel.waba,destination:'+529630000002',body:{text:'x'.repeat(length),buttons:[{id:'txc_'+token,title:'Confirmar viaje'}]}};
 let calls=0;const fetcher=async()=>{calls++;return Response.json({id:'synthetic-provider-ack'});};
 if(length>1024){assertThrows(()=>parseOutgoing(raw));const outcome=await sendTaxiMessage({id:raw.id,lease:raw.lease,tenantId:channel.tenantId,waba:channel.waba,message:{to:raw.destination,...raw.body}},'fixture-key',fetcher);assertEquals(outcome,{state:'failed',code:'invalid_taxi_interactive_body'});assertEquals(calls,0);}
 else{assertEquals((await sendTaxiMessage(parseOutgoing(raw),'fixture-key',fetcher)).state,'accepted');assertEquals(calls,1);}
 const plain=parseOutgoing({...raw,body:{text:raw.body.text}});assertEquals((await sendTaxiMessage(plain,'fixture-key',fetcher)).state,'accepted');
});
