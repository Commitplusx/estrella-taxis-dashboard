import {emptyDraft,type Interpretation,type TaxiChannel,type TaxiDecision,type TaxiInbound,type TaxiSession}from'../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
export const TAXI_COMPOUND_NOW=Date.parse('2026-10-31T18:00:00Z');
export const TAXI_COMPOUND_CHANNEL:TaxiChannel={tenantId:'11111111-1111-4111-8111-111111111111',waba:'+529630000001',enabled:false,name:'Base sintética',city:'Comitán',centerLat:16.25,centerLng:-92.13,radiusKm:20,dispatcher:null,model:'fixture',baseCents:5500,perKmCents:null,pricingMode:'h3_zone_max'};
export interface TaxiCompoundCase{id:string;source:'native'|'pending'|'two_pins';messages:TaxiInbound[];session:TaxiSession;proposal:Interpretation;expected:{name:string;pickupLat:number;pickupId:string;destinationLat:number|null;destinationText:string|null;reference:string|null}}
const origin={text:'Centro',lat:16.25,lng:-92.13,placeId:null,source:'gps' as const},point={text:'Pin sintético',lat:16.255,lng:-92.135,placeId:null,source:'gps' as const};
function message(text:string,id:string):TaxiInbound{return{id,from:'+529630000002',to:TAXI_COMPOUND_CHANNEL.waba,at:new Date(TAXI_COMPOUND_NOW).toISOString(),type:'text',text,button:null,location:null};}
function state():TaxiSession{return{revision:0,mode:'bot',active:null,history:[],draft:emptyDraft()};}
const cues={origin:['Aquí me recoges','Ese es el origen','Pasa por mí en esta dirección','Mándame un taxi a esta dirección'],destination:['Ahí voy','Ese es el destino','Voy para esta dirección','Llévame a esta dirección']} as const;
const names=['José Ángel','María Fernanda','Ana','Mariana','Noé','Ximena','René López','Ana María'];
const places=['Hospital','Plaza Las Flores','El Piedrón','Pilita Seca','San José','Barrio San Sebastián','20 de Noviembre','la Terminal'];
const references=['el portón azul','frente a la cancha','la puerta blanca','junto a la farmacia'];
/** Twenty-four fixed synthetic pipeline cases; expectations are frozen independently of provider responses. */
export const TAXI_COMPOUND_CASES:readonly TaxiCompoundCase[]=(['origin','destination'] as const).flatMap((role,roleIndex)=>cues[role].flatMap((cue,index)=>(['native','pending'] as const).map((source,sourceIndex):TaxiCompoundCase=>{
 const name=names[index+roleIndex*4],place=places[index+sourceIndex*4],reference=references[index],s=state(),identity=message('Soy '+name,'identity'),detail=message(role==='origin'?'Voy a '+place:'Estoy junto a '+reference,'detail'),label=message(cue,'role');
 if(role==='destination'){s.draft.origin=origin;s.draft.pickupMessageId='known-pickup';s.draft.pickupText='Centro';}
 const pin:TaxiInbound={...message('','shared-pin'),type:'location',location:{lat:point.lat,lng:point.lng}};
 if(source==='pending'){s.draft.awaitingLocation='choice';s.draft.pendingLocation={place:point,messageId:pin.id,expiresAt:new Date(TAXI_COMPOUND_NOW+600000).toISOString()};s.history=[{role:'assistant',content:'¿Ese punto es donde pasamos por ti o a dónde te llevamos?'}];}
 const messages=source==='native'?(index%2?[identity,label,pin,detail]:[pin,label,detail,identity]):index%2?[identity,label,detail]:[label,detail,identity];
 return{id:role+'-'+index+'-'+source,source,messages,session:s,proposal:{intent:'provide',fields:{name:{value:name,evidence:identity.text},...(role==='origin'?{destination:{value:place,evidence:detail.text}}:{pickupReference:{value:reference,evidence:detail.text}})}},expected:{name,pickupLat:role==='origin'?point.lat:origin.lat,pickupId:role==='origin'?pin.id:'known-pickup',destinationLat:role==='origin'?null:point.lat,destinationText:role==='origin'?place:null,reference:role==='origin'?null:reference}};
}))).concat(names.map((name,index):TaxiCompoundCase=>{
 const s=state(),pickup:TaxiInbound={...message('','pair-pickup'),type:'location',location:{lat:origin.lat,lng:origin.lng}},destination:TaxiInbound={...message('','pair-destination'),type:'location',location:{lat:point.lat,lng:point.lng}},identity=message('Soy '+name,'identity'),pickupLabel=message(cues.origin[index%4],'pickup-role'),destinationLabel=message(cues.destination[(index+1)%4],'destination-role');
 const pickupBlock=index%2?[pickupLabel,pickup]:[pickup,pickupLabel],destinationBlock=index%3?[destination,destinationLabel]:[destinationLabel,destination];
 return{id:'two-pins-'+index,source:'two_pins' as const,messages:[...(index%2?destinationBlock:pickupBlock),identity,...(index%2?pickupBlock:destinationBlock)],session:s,proposal:{intent:'provide' as const,fields:{name:{value:name,evidence:identity.text}}},expected:{name,pickupLat:origin.lat,pickupId:pickup.id,destinationLat:point.lat,destinationText:null,reference:null}};
}));
const canonicalPlace=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/^(?:el|la|al)\s+/,'').trim();
export function matchesTaxiCompound(decision:TaxiDecision,item:TaxiCompoundCase):boolean{
 const d=decision.draft,e=item.expected;
 return decision.action==='draft'&&decision.candidates.length===0&&d.name===e.name&&d.origin?.source==='gps'&&d.origin.lat===e.pickupLat&&d.pickupMessageId===e.pickupId&&(d.destination?.lat??null)===e.destinationLat&&
  (e.destinationText===null?d.destinationText==null:canonicalPlace(d.destinationText??'')===canonicalPlace(e.destinationText))&&(!e.reference||Boolean(d.pickupText?.includes(e.reference)))&&d.pendingLocation===null&&d.awaitingLocation===null&&Boolean(d.confirmation)&&decision.messages.some(m=>m.buttons?.some(button=>button.id==='txc_'+d.confirmation))&&!decision.messages.some(m=>/\$|MXN/.test(m.text));
}
