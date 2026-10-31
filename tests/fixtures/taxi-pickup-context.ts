import { taxiContextSession, type TaxiContextCase } from './taxi-contextual-intents.ts';
import type { TaxiSession } from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';

export type TaxiPickupCase = TaxiContextCase & { session: TaxiSession };
function pickupReview(): TaxiSession {
  const s=taxiContextSession('review');
  s.draft.pickupText='centro. la fuente';
  s.history=[{role:'user',content:'Vendrían por mí\nAl centro\nEstoy en la fuente'},{role:'assistant',content:'Ya tengo el pin donde pasamos por ti. El destino anotado es Centro; revisa el resumen antes de confirmar.'}];
  return s;
}
function legacyPickupReview():TaxiSession{
  const s=pickupReview();s.draft.pickupText='la fuente';
  if(s.draft.origin)s.draft.origin={...s.draft.origin,text:'Ubicación compartida (16.25000, -92.13000)'};
  s.history=[{role:'assistant',content:'Ya tengo tu ubicación para pasar por ti. Revisa el resumen: destino Centro.'}];return s;
}
/** Fixed development regressions from a reported conversation, with synthetic account and GPS data. */
export const TAXI_PICKUP_CASES:readonly TaxiPickupCase[]=[
  {id:'fragmented-pickup-not-destination',context:'origin',session:taxiContextSession('origin'),message:'Hola, deseo un servicio de taxi\nVendrían por mi\nAl centro\nEstoy en la fuente',expected:{intent:'provide',fields:{origin:['centro','Al centro'],pickupReference:['la fuente','fuente']}}},
  {id:'destination-correction-keeps-pickup',context:'review',session:pickupReview(),message:'No, me llevarían a plaza, yo estoy en el centro',expected:{intent:'provide',fields:{destination:['plaza'],pickupReference:['el centro','centro','yo estoy en el centro']}}},
  {id:'correction-across-bubbles',context:'review',session:pickupReview(),message:'Me llevarían a plaza\nYo estoy en el centro',expected:{intent:'provide',fields:{destination:['plaza'],pickupReference:['el centro','centro','Yo estoy en el centro']}}},
  {id:'pickup-reference-reaffirmed',context:'review',session:pickupReview(),message:'Sigo en la fuente, llévame a plaza',expected:{intent:'provide',fields:{destination:['plaza'],pickupReference:['la fuente','fuente','Sigo en la fuente']}}},
  {id:'actual-pickup-move-needs-new-pin',context:'review',session:pickupReview(),message:'Ya no estoy en el centro, ahora recógeme en Pilita Seca',expected:{intent:'provide',fields:{origin:['Pilita Seca']}}},
  {id:'different-door-needs-new-pin',context:'review',session:pickupReview(),message:'Ahora recógeme en otra entrada del Centro',expected:{intent:'provide',fields:{origin:['otra entrada del Centro']}}},
  {id:'destination-only-keeps-pickup',context:'review',session:pickupReview(),message:'No cambies dónde me recoges, sólo voy a la Terminal',expected:{intent:'provide',fields:{destination:['la Terminal','Terminal']}}},
  {id:'same-pickup-and-new-name',context:'review',session:pickupReview(),message:'Sigo en la fuente y el nombre es Jorge',expected:{intent:'provide',fields:{pickupReference:['la fuente','fuente','Sigo en la fuente'],name:['Jorge']}}},
  {id:'existing-session-before-this-fix',context:'review',session:legacyPickupReview(),message:'No, me llevarían a plaza, yo estoy en el centro',expected:{intent:'provide',fields:{destination:['plaza'],pickupReference:['el centro','centro','yo estoy en el centro']}}},
];
