import { taxiContextSession,matchesTaxiContext,type TaxiContextCase } from './taxi-contextual-intents.ts';
import type { Interpretation,TaxiSession } from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';

export type TaxiClarificationCase=TaxiContextCase&{session:TaxiSession;refines?:string};
export function unresolvedTaxiDestination():TaxiSession{
  const s=taxiContextSession('destination');s.draft.destinationText='Plaza Las Flores';s.draft.pickupText='Centro. la fuente';
  s.history=[{role:'assistant',content:'Encontré estas opciones: Plaza Las Flores (Cash A), Plaza Las Flores (otros puntos). ¿Cuál es?'}];return s;
}
function review():TaxiSession{const s=taxiContextSession('review');s.draft.pickupText='Centro. la fuente';return s;}
/** Fixed synthetic development cases; no accuracy claims or real customer messages. */
export const TAXI_CLARIFICATION_CASES:readonly TaxiClarificationCase[]=[
  {id:'pending-business-detail',context:'destination',session:unresolvedTaxiDestination(),message:'Liverpool',refines:'Plaza Las Flores',expected:{intent:'provide',fields:{destination:['Liverpool']}}},
  {id:'pending-category-detail',context:'destination',session:unresolvedTaxiDestination(),message:'Otros puntos',refines:'Plaza Las Flores',expected:{intent:'provide',fields:{destination:['Otros puntos']}}},
  {id:'identity-while-resolving-destination',context:'destination',session:unresolvedTaxiDestination(),message:'Soy Jorge',expected:{intent:'provide',fields:{name:['Jorge']}}},
  {id:'identity-not-address',context:'destination',session:unresolvedTaxiDestination(),message:'Me llamo Jorge',expected:{intent:'provide',fields:{name:['Jorge']}}},
  {id:'new-destination-para',context:'destination',session:unresolvedTaxiDestination(),message:'Voy para Hospital',expected:{intent:'provide',fields:{destination:['Hospital']}}},
  {id:'new-destination-llevan',context:'destination',session:unresolvedTaxiDestination(),message:'Me llevan al Hospital',expected:{intent:'provide',fields:{destination:['Hospital']}}},
  {id:'pickup-while-resolving-destination',context:'destination',session:unresolvedTaxiDestination(),message:'Estoy en Pilita Seca',expected:{intent:'provide',fields:{origin:['Pilita Seca']}}},
  {id:'detail-and-identity-across-bubbles',context:'destination',session:unresolvedTaxiDestination(),message:'Liverpool\nSoy Jorge',refines:'Plaza Las Flores',expected:{intent:'provide',fields:{destination:['Liverpool'],name:['Jorge']}}},
  {id:'question-keeps-pending-place',context:'destination',session:unresolvedTaxiDestination(),message:'¿Por qué necesitas mi ubicación?',expected:{intent:'question',fields:{}}},
  {id:'explicit-name-correction',context:'review',session:review(),message:'Sigo en la fuente y el nombre es Jorge',expected:{intent:'provide',fields:{name:['Jorge'],pickupReference:['la fuente','Sigo en la fuente','fuente']}}},
  {id:'independent-reference-and-destination',context:'review',session:review(),message:'Estoy en la fuente.\nMejor voy a la Terminal.',expected:{intent:'provide',fields:{pickupReference:['la fuente','Estoy en la fuente','fuente'],destination:['Terminal','la Terminal']}}},
  {id:'last-destination-wins',context:'review',session:review(),message:'Voy al Hospital\nNo, mejor a la Terminal',expected:{intent:'provide',fields:{destination:['Terminal','la Terminal']}}},
];
export function matchesTaxiClarification(actual:Interpretation,item:TaxiClarificationCase):boolean{
  return matchesTaxiContext(actual,item)&&actual.fields.destination?.refines===item.refines&&actual.fields.origin?.refines===undefined&&actual.fields.name?.refines===undefined&&actual.fields.pickupReference?.refines===undefined;
}
