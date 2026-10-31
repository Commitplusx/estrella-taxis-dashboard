import { assert,assertEquals } from 'https://deno.land/std@0.177.0/testing/asserts.ts';
import { coordinateTaxi,type TaxiServices } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/coordinator.ts';
import { emptyDraft,parseSession,type Interpretation,type TaxiChannel,type TaxiInbound,type TaxiSession } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
import { locationRole,locationRoleOnly,parseInterpretation } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/policy.ts';
import { TAXI_COMPOUND_CASES,TAXI_COMPOUND_CHANNEL,TAXI_COMPOUND_NOW,matchesTaxiCompound } from './fixtures/taxi-compound-turns.ts';

const now=Date.parse('2026-10-31T18:00:00Z'),token='33333333-3333-4333-8333-333333333333';
const channel:TaxiChannel={tenantId:'11111111-1111-4111-8111-111111111111',waba:'+529630000001',enabled:true,name:'Base sintética',city:'Comitán',centerLat:16.25,centerLng:-92.13,radiusKm:20,dispatcher:null,model:'fixture',baseCents:5500,perKmCents:null,pricingMode:'h3_zone_max'};
const origin={text:'Centro',lat:16.25,lng:-92.13,placeId:null,source:'gps' as const},previousDestination={text:'Terminal',lat:16.26,lng:-92.14,placeId:null,source:'gps' as const};
const point={lat:16.255,lng:-92.135};
const names=['José Ángel','María Fernanda','Ana','Mariana','Noé','Ximena','René López','Ana María'] as const;
const details=['Hospital','Plaza Las Flores','El Piedrón','Pilita Seca','San José','Barrio San Sebastián','20 de Noviembre','Priv. Ninguno 139'] as const;
const references=['el portón azul','frente a la cancha','la puerta blanca','junto a la farmacia','en la esquina','la entrada principal','frente al parque','la reja negra'] as const;
const cues={origin:['Aquí me recoges','Ese es el origen','Pasa por mí en esta dirección','Mándame un taxi a esta dirección'],destination:['Ahí voy','Ese es el destino','Voy para esta dirección','Llévame a esta dirección']} as const;
const orders=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]] as const;
const sources=['native_0','native_1','native_2','native_3','pending'] as const;
for(const item of TAXI_COMPOUND_CASES)Deno.test('fixed compound pipeline regression: '+item.id,async()=>{
 let calls=0;const services:TaxiServices={interpret:async current=>{calls++;return parseInterpretation(item.proposal,current);},resolve:async()=>({kind:'unavailable'}),quote:async()=>item.expected.destinationLat===null?5500:6500,candidates:async()=>{throw Error('No confirmation click.');}};
 const d=await coordinateTaxi(item.messages,item.session,TAXI_COMPOUND_CHANNEL,services,TAXI_COMPOUND_NOW);assertEquals(calls,1);assert(matchesTaxiCompound(d,item));
});
for(const role of ['origin','destination'] as const)Deno.test('a deictic tool field cannot overwrite the native pin whose pending role was just chosen: '+role,async()=>{
 const s=state(true,role),label=role==='origin'?'Me recoges en esta dirección':'Voy para esta dirección';s.draft.pendingLocation={place:{text:'Native pendiente',...point,placeId:null,source:'gps'},messageId:'pending-proof',expiresAt:new Date(now+600000).toISOString()};s.draft.awaitingLocation='choice';s.draft.confirmation=null;s.draft.expiresAt=null;
 const f:TaxiServices={interpret:async current=>parseInterpretation({intent:'provide',fields:{[role]:{value:'esta dirección',evidence:label},name:{value:'José Ángel',evidence:'Soy José Ángel'}}},current),resolve:async()=>{throw Error('A deictic reference is not a written address.');},quote:async()=>6500,candidates:async()=>{throw Error('No click.');}};
 const d=await coordinateTaxi([inbound(label,0),inbound('Soy José Ángel',1)],s,channel,f,now);assertEquals(d.draft[role]?.lat,point.lat);assertEquals(d.draft.name,'José Ángel');assertEquals(d.draft.pendingLocation,null);assertEquals(d.draft.awaitingLocation,null);assert(d.draft.confirmation);if(role==='destination')assertEquals(d.draft.destinationText,null);else assertEquals(d.draft.pickupMessageId,'pending-proof');
});
function inbound(text:string,index:number):TaxiInbound{return{id:'synthetic-'+index,from:'+529630000002',to:channel.waba,at:new Date(now).toISOString(),type:'text',text,button:null,location:null};}
function state(review:boolean,role:'origin'|'destination'):TaxiSession{
 const s:TaxiSession={revision:1,mode:'bot',active:null,history:[],draft:emptyDraft()};
 if(review||role==='destination'){s.draft.origin=origin;s.draft.pickupMessageId='known-pickup';s.draft.pickupText='Centro';}
 if(review)s.draft={...s.draft,name:'Pasajero anterior',destination:previousDestination,fareMode:'quoted',quoteCents:6500,confirmation:token,expiresAt:new Date(now+600000).toISOString()};
 return s;
}
// Each combination declares its interpreter proposal. These are deterministic protocol tests, not measured model accuracy.
for(const role of ['origin','destination'] as const)for(const [cueIndex,cue]of cues[role].entries())for(const [nameIndex,name]of names.entries())for(const [detailIndex,detail]of details.entries())for(const [orderIndex,order]of orders.entries())for(const source of sources){
 Deno.test(`compound combination role=${role} cue=${cueIndex} name=${nameIndex} detail=${detailIndex} order=${orderIndex} source=${source}`,async()=>{
  const s=state((nameIndex+detailIndex)%2===0,role),pin:TaxiInbound={...inbound('',4),id:'current-native-pin',type:'location',location:point};
  const reference=references[detailIndex],identity='Soy '+name,route=role==='origin'?'Voy a '+detail:'Estoy junto a '+reference;
  const texts=[cue,identity,route],events=order.map(index=>inbound(texts[index],index));
  if(source==='pending'){s.draft.pendingLocation={place:{text:'Pin pendiente',...point,placeId:null,source:'gps'},messageId:pin.id,expiresAt:new Date(now+600000).toISOString()};s.draft.awaitingLocation='choice';s.draft.confirmation=null;s.draft.expiresAt=null;}
  else events.splice(Number(source.slice(-1)),0,pin);
  const input=events.filter(event=>event.type==='text').map(event=>event.text).join('\n'),snapshot=JSON.stringify(s);let interpretations=0,quotes=0,assignments=0;
  const fields:Interpretation['fields']={name:{value:name,evidence:identity},...(role==='origin'?{destination:{value:detail,evidence:route}}:{pickupReference:{value:reference,evidence:route}})};
  const services:TaxiServices={interpret:async current=>{interpretations++;assertEquals(current,input);return parseInterpretation({intent:'provide',fields},current);},resolve:async query=>{assertEquals(role,'origin');assertEquals(query,detail);return{kind:'unavailable'};},quote:async(from,to)=>{quotes++;assertEquals(from.lat,role==='origin'?point.lat:origin.lat);assertEquals(to.lat,point.lat);return role==='origin'?5500:6500;},candidates:async()=>{assignments++;throw Error('No button was provided.');}};
  const decision=await coordinateTaxi(events,parseSession(JSON.parse(snapshot)),channel,services,now);
  assertEquals(interpretations,1);assertEquals(assignments,0);assertEquals(quotes,1);assertEquals(decision.action,'draft');assertEquals(decision.draft.name,name);assertEquals(decision.draft.pendingLocation,null);assertEquals(decision.draft.awaitingLocation,null);assert(decision.draft.confirmation&&decision.draft.confirmation!==token);
  assertEquals(decision.messages.length,1);assertEquals(decision.messages[0].buttons?.[0]?.id,'txc_'+decision.draft.confirmation);assert(!/\$|MXN/.test(decision.messages[0].text));
  if(role==='origin'){assertEquals(decision.draft.origin?.lat,point.lat);assertEquals(decision.draft.pickupMessageId,pin.id);assertEquals(decision.draft.destinationText,detail);assertEquals(decision.draft.destination,null);}
  else{assertEquals(decision.draft.origin,origin);assertEquals(decision.draft.pickupMessageId,'known-pickup');assertEquals(decision.draft.destination?.lat,point.lat);assert(decision.draft.pickupText?.includes(reference));}
  assertEquals(JSON.stringify(s),snapshot,'The caller session is immutable.');
  const restored=parseSession(JSON.parse(JSON.stringify({...s,revision:s.revision+1,draft:decision.draft})));assertEquals(restored.draft,decision.draft);
 });
}

for(const role of ['origin','destination'] as const)for(const cue of cues[role])for(const wrap of [
 (s:string)=>'Si '+s,
 (s:string)=>'Tal vez '+s,
 (s:string)=>'Por ejemplo: '+s,
 (s:string)=>'Mi amigo dijo: '+s,
 (s:string)=>'¿'+s+'?',
])Deno.test('role selection needs an actual choice: '+wrap(cue),()=>{
 assertEquals(locationRole(wrap(cue)),null);assertEquals(locationRoleOnly(wrap(cue)),false);
});
for(const name of names)for(const cue of cues.origin)Deno.test('a role phrase cannot swallow identity inside its own clause: '+cue+' '+name,()=>{
 assertEquals(locationRoleOnly(cue+', soy '+name+', aquí'),false);
});
for(const text of ['No me recoges aquí','Ese no es el origen','No pases por mí en esta dirección','No mandes el taxi a esta dirección','Ahí no voy','Ese no es el destino','No voy para esta dirección','No me lleves a esta dirección'])Deno.test('a negation cannot label a stored native pin: '+text,()=>{
 assertEquals(locationRole(text),null);assertEquals(locationRoleOnly(text),false);
});
for(const cue of ['Aquí me recoges','Ese es el origen','Ahí voy','Ese es el destino'])Deno.test('a discourse correction can still choose an explicit role: No, '+cue,()=>{
 assertEquals(locationRole('No, '+cue),locationRole(cue));assertEquals(locationRoleOnly('No, '+cue),true);
});

for(const [originCueIndex,originCue]of cues.origin.entries())for(const [destinationCueIndex,destinationCue]of cues.destination.entries())for(const beforeOrigin of [false,true])for(const beforeDestination of [false,true])for(const reverse of [false,true])for(const nameAt of [0,1,2])for(const review of [false,true]){
 Deno.test(`two pin combination pickupCue=${originCueIndex} destinationCue=${destinationCueIndex} before=${beforeOrigin},${beforeDestination} reversed=${reverse} nameAt=${nameAt} review=${review}`,async()=>{
  const s=state(review,'origin'),pickup:TaxiInbound={...inbound('',4),id:'two-pickup',type:'location',location:point},target:TaxiInbound={...inbound('',5),id:'two-destination',type:'location',location:{lat:16.265,lng:-92.14}};
  const pickupLabel=inbound(originCue,0),targetLabel=inbound(destinationCue,1),identity=inbound('Soy María Fernanda',2);
  const pickupBlock=beforeOrigin?[pickupLabel,pickup]:[pickup,pickupLabel],destinationBlock=beforeDestination?[targetLabel,target]:[target,targetLabel],blocks=reverse?[destinationBlock,pickupBlock]:[pickupBlock,destinationBlock];
  const events=[...(nameAt===0?[identity]:[]),...blocks[0],...(nameAt===1?[identity]:[]),...blocks[1],...(nameAt===2?[identity]:[])];let calls=0,assignments=0;
  const providers:TaxiServices={interpret:async current=>{calls++;return parseInterpretation({intent:'provide',fields:{name:{value:'María Fernanda',evidence:identity.text}}},current);},resolve:async()=>{throw Error('Both locations are native pins.');},quote:async(from,to)=>{assertEquals(from.lat,point.lat);assertEquals(to.lat,16.265);return 6500;},candidates:async()=>{assignments++;throw Error('No confirmation click.');}};
  const d=await coordinateTaxi(events,s,channel,providers,now);assertEquals(calls,1);assertEquals(assignments,0);assertEquals(d.draft.name,'María Fernanda');assertEquals(d.draft.origin?.lat,point.lat);assertEquals(d.draft.pickupMessageId,pickup.id);assertEquals(d.draft.destination?.lat,16.265);assert(d.draft.confirmation);assertEquals(d.draft.awaitingLocation,null);assertEquals(d.draft.pendingLocation,null);
 });
}
for(const mode of ['ambiguous','outage'] as const)Deno.test('a clearly labelled pending pin survives a compound '+mode+' without a confirmation',async()=>{
 const s=state(true,'origin');s.draft.pendingLocation={place:{...origin,...point},messageId:'pending-proof',expiresAt:new Date(now+600000).toISOString()};s.draft.awaitingLocation='choice';s.draft.confirmation=null;s.draft.expiresAt=null;
 const services:TaxiServices={interpret:async()=>{if(mode==='outage')throw Error('Declared outage.');return{intent:'ambiguous',fields:{}};},resolve:async()=>{throw Error('No resolution during clarification.');},quote:async()=>{throw Error('No quote during clarification.');},candidates:async()=>{throw Error('No consent.');}};
 const d=await coordinateTaxi([inbound('Ese es el origen',0),inbound('Y la otra cosa',1)],s,channel,services,now);assertEquals(d.draft.origin?.lat,point.lat);assertEquals(d.draft.pickupMessageId,'pending-proof');assertEquals(d.draft.pendingLocation,null);assertEquals(d.draft.name,s.draft.name);assertEquals(d.draft.destination,s.draft.destination);assertEquals(d.draft.confirmation,null);
});
for(const text of ['No me recoges aquí','¿Me recoges aquí?','Por ejemplo: me recoges aquí','Mi amigo dijo: me recoges aquí'])Deno.test('uncertain compound role cannot consume a stored GPS proof: '+text,async()=>{
 const s=state(true,'origin');s.draft.pendingLocation={place:{...origin,...point},messageId:'pending-proof',expiresAt:new Date(now+600000).toISOString()};s.draft.awaitingLocation='choice';s.draft.confirmation=null;s.draft.expiresAt=null;
 const services:TaxiServices={interpret:async()=>({intent:'ambiguous',fields:{}}),resolve:async()=>{throw Error('No location choice.');},quote:async()=>{throw Error('No quote.');},candidates:async()=>{throw Error('No consent.');}};
 const d=await coordinateTaxi([inbound(text,0)],s,channel,services,now);assertEquals(d.draft.origin,s.draft.origin);assertEquals(d.draft.pickupMessageId,s.draft.pickupMessageId);assertEquals(d.draft.pendingLocation,s.draft.pendingLocation);assertEquals(d.draft.confirmation,null);
});
for(const order of ['all_labels_first','all_pins_first'] as const)Deno.test('two native pins need unique nearby role labels: '+order,async()=>{
 const s=state(true,'origin'),labels=[inbound('Aquí me recoges',0),inbound('Ahí voy',1)],pins:TaxiInbound[]=[{...inbound('',2),type:'location',location:point},{...inbound('',3),type:'location',location:{lat:16.265,lng:-92.14}}];
 const services:TaxiServices={interpret:async()=>({intent:'provide',fields:{}}),resolve:async()=>{throw Error('Native pins only.');},quote:async()=>{throw Error('Ambiguous role mapping.');},candidates:async()=>{throw Error('No consent.');}};
 const d=await coordinateTaxi(order==='all_labels_first'?[...labels,...pins]:[...pins,...labels],s,channel,services,now);assertEquals(d.reason,'multiple_locations');assertEquals(d.draft.origin,s.draft.origin);assertEquals(d.draft.destination,s.draft.destination);assertEquals(d.draft.pickupMessageId,s.draft.pickupMessageId);assertEquals(d.draft.confirmation,null);
});
for(const item of TAXI_COMPOUND_CASES)for(const control of ['human','searching','en_route'] as const)Deno.test('compound messages respect existing control: '+item.id+' '+control,async()=>{
 const s=parseSession(JSON.parse(JSON.stringify(item.session)));if(control==='human')s.mode='human';else s.active={id:'44444444-4444-4444-8444-444444444444',state:control==='searching'?'buscando_conductor':'en_camino',taxiName:null};
 let called=false;const services:TaxiServices={interpret:async()=>{called=true;throw Error('Current trip or human ownership.');},resolve:async()=>{called=true;throw Error('Not allowed.');},quote:async()=>{called=true;throw Error('Not allowed.');},candidates:async()=>{called=true;throw Error('Not allowed.');}};
 const d=await coordinateTaxi(item.messages,s,channel,services,now);assertEquals(called,false);assert(d.action!=='confirm');assertEquals(d.draft.origin,s.draft.origin);assertEquals(d.draft.destination,s.draft.destination);assertEquals(d.draft.name,s.draft.name);assertEquals(d.candidates,[]);
});
for(const role of ['origin','destination'] as const)for(const afterPin of [false,true])for(const cropped of [false,true])Deno.test(`the newest endpoint wins inside one burst: role=${role} afterPin=${afterPin} cropped=${cropped}`,async()=>{
 const s=state(true,role),cue=inbound(role==='origin'?'Aquí me recoges':'Ahí voy',0),pin:TaxiInbound={...inbound('',1),id:'earlier-pin',type:'location',location:point},change=inbound(role==='origin'?'Ahora recógeme en Pilita Seca':'No, mejor a Hospital',2),value=role==='origin'?'Pilita Seca':'Hospital';
 const events=afterPin?[pin,cue,change]:[change,cue,pin];let assignments=0;
 const services:TaxiServices={interpret:async current=>parseInterpretation({intent:'provide',fields:{[role]:{value,evidence:cropped?value:change.text}}},current),resolve:async()=>({kind:'unavailable'}),quote:async()=>6500,candidates:async()=>{assignments++;throw Error('No click.');}};
 const d=await coordinateTaxi(events,s,channel,services,now);assertEquals(assignments,0);
 if(afterPin&&role==='origin'){assertEquals(d.draft.origin,null);assertEquals(d.draft.pickupMessageId,null);assertEquals(d.draft.pickupText,value);assertEquals(d.messages[0].locationRequest,'origin');assertEquals(d.draft.confirmation,null);}
 else if(afterPin){assertEquals(d.draft.destination,null);assertEquals(d.draft.destinationText,value);assertEquals(d.draft.origin,origin);assert(d.draft.confirmation);}
 else{assertEquals(d.draft[role]?.lat,point.lat);assert(d.draft.confirmation);}
});
