import type {Draft,TaxiDecision,TaxiInbound,TaxiSession} from './contracts.ts';
import {courtesyOnly} from './policy.ts';
import {hasDestination} from './stateMachine.ts';

export const TAXI_NORMAL_MESSAGE_LIMIT=5;
export type BookingDetail='pickup_gps'|'passenger_name'|'destination_optional';
export function missingBookingDetails(d:Draft):BookingDetail[]{
 return [...(!d.origin||d.origin.source!=='gps'||!d.pickupMessageId?['pickup_gps' as const]:[]),...(!d.name?['passenger_name' as const]:[]),...(!hasDestination(d)&&!d.destinationDeferred?['destination_optional' as const]:[])];
}
/** These labels describe server outcomes, never a model-controlled spending allowance. */
export function taxiReplyClass(session:TaxiSession,decision:TaxiDecision):'normal'|'question'|'change'{
 if(['reset','cancel'].includes(decision.action)||['draft_cancelled','summary_declined','edit_location_requested','destination_deferred','active_trip_change'].includes(decision.reason))return'change';
 if(decision.action==='human')return'question';
 // A first landmark supplements an already verified pickup; it is not another
 // failed collection attempt, even if the customer sends it after the name.
 if(session.draft.origin?.source==='gps'&&session.draft.pickupMessageId&&decision.draft.pickupText&&session.draft.pickupText!==decision.draft.pickupText)return'change';
 if((['name','origin','destination','pickupText','destinationText','destinationArea'] as const).some(key=>session.draft[key]!=null&&JSON.stringify(session.draft[key])!==JSON.stringify(decision.draft[key])))return'change';
 if(['service_question','quote_only','active_status','active_trip','no_active_status','no_active_trip','courtesy','smalltalk','ambiguous_intent','interpretation_failed','unclear_name','pickup_reference_too_long','location_target_unclear','multiple_locations','neighborhood_ambiguous','neighborhood_reference_conflict','location_clarification_followup','neighborhood_reference_required','unresolved_location','locality_still_pending','unsupported_media','stale_confirmation','stale_destination_choice','button_confirmation_required','no_current_confirmation','cancellation_question','incomplete_draft'].includes(decision.reason))return'question';
 if(session.draft.confirmation&&decision.draft.confirmation)return'question';
 return'normal';
}
/** Reserve the final normal message for the assignment/outcome, not another collection loop. */
export function constrainTaxiConversation(session:TaxiSession,decision:TaxiDecision,messages:TaxiInbound[]):void{
 decision.replyClass=taxiReplyClass(session,decision);
 if(messages.every(message=>message.type==='text'&&courtesyOnly(message.text))&&decision.action==='reply'){
  decision.messages=[];return;
 }
 const used=session.messageBudget?.closed?0:session.messageBudget?.normal??0;
 if(used>=3&&decision.replyClass==='normal'&&decision.action==='draft'&&!decision.draft.confirmation&&decision.messages.length){
  decision.action='human';decision.reason='conversation_budget';
  decision.draft={...decision.draft,confirmation:null,expiresAt:null,destinationPrompt:null};
  decision.messages=[{to:messages[messages.length-1].from,text:'Para completar lo que falta sin hacerte repetir datos, la base necesita revisar tu solicitud. Todavía no se ha pedido ningún taxi. 🚕'}];
 }
}
