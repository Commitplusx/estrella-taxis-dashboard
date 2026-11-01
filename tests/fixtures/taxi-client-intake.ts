import {emptyDraft,type Interpretation,type TaxiChannel,type TaxiDecision,type TaxiInbound,type TaxiSession} from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
import {normalize} from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/policy.ts';
export const INTAKE_NOW=Date.now();
export const INTAKE_CHANNEL:TaxiChannel={tenantId:'11111111-1111-4111-8111-111111111111',waba:'+529630000001',enabled:true,name:'Base sintética',city:'Comitán',centerLat:16.25,centerLng:-92.13,radiusKm:20,dispatcher:null,model:'deepseek-chat',baseCents:5500,perKmCents:null,pricingMode:'h3_zone_max'};
export function intakeMessage(text:string,id='text'):TaxiInbound{return{id,from:'+529630000002',to:INTAKE_CHANNEL.waba,at:new Date(INTAKE_NOW).toISOString(),type:'text',text,button:null,location:null};}
export function intakePin(id='pickup'):TaxiInbound{return{...intakeMessage('',id),type:'location',location:{lat:16.25,lng:-92.13}};}
export function intakeSession(saved=false):TaxiSession{
 return{revision:0,mode:'bot',active:null,history:saved?[{role:'assistant',content:'¿A nombre de quién va el taxi y a dónde te llevamos? Puedes indicarle el destino al chofer.'}]:[],draft:{...emptyDraft(),...(saved?{origin:{text:'Pin compartido',lat:16.25,lng:-92.13,placeId:null,source:'gps' as const},pickupMessageId:'saved-pickup',awaitingLocation:'destination' as const}:{})}};
}
export interface IntakeCase {id:string;messages:TaxiInbound[];session:TaxiSession;proposal:Interpretation;expected:{name:string|null;pickup:boolean;references:string[];destination:string|null}}
const value=(text:string)=>({value:text,evidence:text});
const reference='En la fábrica de tostadas Botanitos',landmark='A un costado de la zona industrial';
const savedName=()=>{const s=intakeSession(true);s.draft.name='Mariana';return s;};
/** Development regressions derived from customer examples; account, passenger and GPS data are synthetic. */
export const TAXI_INTAKE_CASES:readonly IntakeCase[]=[
 {id:'greeting-request-bubbles',messages:[intakeMessage('Buenas noches','greet'),intakeMessage('Necesito un servicio por favor','request')],session:intakeSession(),proposal:{intent:'request',fields:{}},expected:{name:null,pickup:false,references:[],destination:null}},
 {id:'pin-prefixed-name-no-destination',messages:[intakePin(),intakeMessage('A nombre de Mariana','name')],session:intakeSession(),proposal:{intent:'provide',fields:{name:{value:'Mariana',evidence:'A nombre de Mariana'}}},expected:{name:'Mariana',pickup:true,references:[],destination:null}},
 {id:'pin-bare-full-name-and-two-references',messages:[intakeMessage('Buenas tardes','greet'),intakePin(),intakeMessage('Diego Villalba','name'),intakeMessage(reference,'place'),intakeMessage(landmark,'landmark')],session:intakeSession(),proposal:{intent:'provide',fields:{name:value('Diego Villalba'),pickupReference:{value:reference+' '+landmark,evidence:reference+'\n'+landmark}}},expected:{name:'Diego Villalba',pickup:true,references:[reference,landmark],destination:null}},
 {id:'bare-full-name-before-pin',messages:[intakeMessage('diego villalba','name'),intakePin(),intakeMessage(reference,'place')],session:intakeSession(),proposal:{intent:'provide',fields:{name:value('diego villalba'),pickupReference:value(reference)}},expected:{name:'diego villalba',pickup:true,references:[reference],destination:null}},
 {id:'saved-pin-name-reference-in-later-batch',messages:[intakeMessage('Diego Villalba','name'),intakeMessage(reference,'place'),intakeMessage(landmark,'landmark')],session:intakeSession(true),proposal:{intent:'provide',fields:{name:value('Diego Villalba'),pickupReference:{value:reference+' '+landmark,evidence:reference+'\n'+landmark}}},expected:{name:'Diego Villalba',pickup:true,references:[reference,landmark],destination:null}},
 {id:'saved-pin-detail-is-not-destination',messages:[intakeMessage('A un costado de la zona industrial')],session:savedName(),proposal:{intent:'provide',fields:{pickupReference:value(landmark)}},expected:{name:'Mariana',pickup:true,references:[landmark],destination:null}},
 {id:'known-name-reference-and-written-destination',messages:[intakeMessage('Estoy frente al portón azul','reference'),intakeMessage('Voy para la Terminal','destination')],session:savedName(),proposal:{intent:'provide',fields:{pickupReference:{value:'frente al portón azul',evidence:'Estoy frente al portón azul'},destination:{value:'la Terminal',evidence:'Voy para la Terminal'}}},expected:{name:'Mariana',pickup:true,references:['frente al portón azul'],destination:'la Terminal'}},
 {id:'explicit-relocation-needs-new-pin',messages:[intakeMessage('Ya me moví, ahora recógeme en Pilita Seca')],session:savedName(),proposal:{intent:'provide',fields:{origin:{value:'Pilita Seca',evidence:'ahora recógeme en Pilita Seca'}}},expected:{name:'Mariana',pickup:false,references:['Pilita Seca'],destination:null}},
];
export function matchesIntake(d:TaxiDecision,item:IntakeCase):boolean{
 const expected=item.expected,pin=Boolean(d.draft.origin?.source==='gps'&&d.draft.pickupMessageId);
 const key=(v:string|null|undefined)=>normalize(v??''),placeKey=(v:string|null|undefined)=>key(v).replace(/^(?:el|la|los|las)\s+/,'');
 return d.action==='draft'&&key(d.draft.name)===key(expected.name)&&pin===expected.pickup&&expected.references.every(part=>key(d.draft.pickupText).includes(key(part)))&&placeKey(d.draft.destinationText)===placeKey(expected.destination)&&d.candidates.length===0&&d.messages.length===1&&!d.messages.some(m=>/\$|MXN|ya (?:va|viene)|asignado/i.test(m.text))&&(!expected.destination?!d.draft.confirmation:true)&&(!expected.pickup||!d.messages[0].locationRequest);
}
