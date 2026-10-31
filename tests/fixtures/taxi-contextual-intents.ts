import { emptyDraft, type Interpretation, type TaxiSession } from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';

export type TaxiContext = 'origin' | 'destination' | 'origin_reference' | 'destination_reference' | 'name' | 'review';
export interface TaxiContextCase {
  id: string;
  context: TaxiContext;
  message: string;
  expected: {intent: Interpretation['intent']; fields: Partial<Record<keyof Interpretation['fields'], readonly string[]>>};
}
/** Fixed synthetic development cases. They are not a blind accuracy cohort. */
export const TAXI_CONTEXT_CASES: readonly TaxiContextCase[] = [
  {id:'voy-a-pilita',context:'origin',message:'voy a la Pilita Seca',expected:{intent:'provide',fields:{destination:['la Pilita Seca','Pilita Seca']}}},
  {id:'me-dirijo',context:'origin',message:'me dirijo al Piedrón',expected:{intent:'provide',fields:{destination:['Piedrón','al Piedrón']}}},
  {id:'llevame',context:'origin',message:'llévame a Pilita Seca',expected:{intent:'provide',fields:{destination:['Pilita Seca']}}},
  {id:'destino-polite',context:'origin',message:'¿Me llevas a la Pilita Seca?',expected:{intent:'provide',fields:{destination:['la Pilita Seca','Pilita Seca']}}},
  {id:'destino-llegar',context:'origin',message:'necesito llegar a Pilita Seca',expected:{intent:'provide',fields:{destination:['Pilita Seca']}}},
  {id:'pickup-send',context:'origin',message:'mándame un taxi a Pilita Seca',expected:{intent:'provide',fields:{origin:['Pilita Seca']}}},
  {id:'pickup-can',context:'origin',message:'¿Podrías pasar por mí en Pilita Seca?',expected:{intent:'provide',fields:{origin:['Pilita Seca']}}},
  {id:'pickup-present',context:'destination',message:'estoy en Pilita Seca',expected:{intent:'provide',fields:{origin:['Pilita Seca']}}},
  {id:'pickup-wait',context:'destination',message:'te espero en Pilita Seca',expected:{intent:'provide',fields:{origin:['Pilita Seca']}}},
  {id:'bare-pickup',context:'origin',message:'pilita seca',expected:{intent:'provide',fields:{origin:['pilita seca']}}},
  {id:'bare-destination',context:'destination',message:'pilita seca',expected:{intent:'provide',fields:{destination:['pilita seca']}}},
  {id:'two-endpoints',context:'origin',message:'Estoy en El Piedrón y voy a Pilita Seca',expected:{intent:'provide',fields:{origin:['El Piedrón'],destination:['Pilita Seca']}}},
  {id:'from-to',context:'origin',message:'de El Piedrón a Pilita Seca',expected:{intent:'provide',fields:{origin:['El Piedrón'],destination:['Pilita Seca']}}},
  {id:'reverse-order',context:'origin',message:'voy a Pilita Seca, recógeme en El Piedrón',expected:{intent:'provide',fields:{origin:['El Piedrón'],destination:['Pilita Seca']}}},
  {id:'reference-origin',context:'origin_reference',message:'frente a la cancha, portón azul',expected:{intent:'provide',fields:{origin:['frente a la cancha, portón azul']}}},
  {id:'reference-destination',context:'destination_reference',message:'calle 3 número 12',expected:{intent:'provide',fields:{destination:['calle 3 número 12']}}},
  {id:'correct-destination',context:'review',message:'mejor llévame a Pilita Seca',expected:{intent:'provide',fields:{destination:['Pilita Seca']}}},
  {id:'correct-origin',context:'review',message:'no me recojas en Centro, mejor en El Piedrón',expected:{intent:'provide',fields:{origin:['El Piedrón']}}},
  {id:'complete-name',context:'name',message:'para Mariana',expected:{intent:'provide',fields:{name:['Mariana']}}},
  {id:'quote-only',context:'review',message:'¿cuánto me sale el viaje?',expected:{intent:'quote',fields:{}}},
  {id:'alternative',context:'origin',message:'Pilita Seca o El Piedrón, todavía no sé',expected:{intent:'ambiguous',fields:{}}},
  {id:'hypothetical',context:'review',message:'si pudiera ir a Pilita Seca, tal vez',expected:{intent:'ambiguous',fields:{}}},
  {id:'status',context:'review',message:'¿ya viene mi taxi?',expected:{intent:'status',fields:{}}},
  {id:'colloquial-destination',context:'origin',message:'oye bro voy pa la Pilita Seca',expected:{intent:'provide',fields:{destination:['la Pilita Seca','Pilita Seca']}}},
  {id:'reference-after-pin',context:'name',message:'es el portón azul',expected:{intent:'provide',fields:{pickupReference:['es el portón azul','el portón azul','portón azul']}}},
  {id:'reference-current-review',context:'review',message:'estoy frente a la cancha',expected:{intent:'provide',fields:{pickupReference:['estoy frente a la cancha','frente a la cancha']}}},
  {id:'pickup-voice-with-reference',context:'origin',message:'toy aquí por el mercado, junto a la entrada de atrás',expected:{intent:'provide',fields:{origin:['por el mercado, junto a la entrada de atrás','el mercado, junto a la entrada de atrás']}}},
  {id:'destination-business-entrance',context:'origin',message:'voy al hospital, por la entrada de urgencias',expected:{intent:'provide',fields:{destination:['hospital, por la entrada de urgencias','Hospital, por la entrada de urgencias','el hospital, por la entrada de urgencias']}}},
  {id:'pickup-and-destination-colloquial',context:'origin',message:'pásame a buscar a El Piedrón y me dejas en la Terminal',expected:{intent:'provide',fields:{origin:['El Piedrón'],destination:['la Terminal','Terminal']}}},
  {id:'name-and-latest-destination-correction',context:'review',message:'Soy Ana. Ya no al Centro, mejor al Hospital.',expected:{intent:'provide',fields:{name:['Ana'],destination:['Hospital','al Hospital']}}},
  {id:'text-yes-is-not-confirm-button',context:'review',message:'Sí, todo está bien',expected:{intent:'ambiguous',fields:{}}},
  {id:'cancel-text-needs-server-check',context:'review',message:'Mejor cancélalo',expected:{intent:'ambiguous',fields:{}}},
];

export function taxiContextSession(context: TaxiContext): TaxiSession {
  const session:TaxiSession={revision:0,mode:'bot',active:null,history:[],draft:emptyDraft()};
  const origin={text:'Calle Primera 20',lat:16.25,lng:-92.13,placeId:null,source:'gps' as const};
  const destination={text:'Calle Segunda 35',lat:16.26,lng:-92.14,placeId:null,source:'written' as const};
  if(context==='destination'||context==='destination_reference'||context==='name'||context==='review'){session.draft.origin=origin;session.draft.pickupMessageId='synthetic-native-pickup';}
  if(context==='origin_reference'||context==='name'||context==='review')session.draft.destination=destination;
  if(context==='review')session.draft.name='Mariana';
  const role=context==='origin_reference'?'origin':context==='destination_reference'?'destination':context;
  session.draft.awaitingLocation=role==='origin'||role==='destination'?role:null;
  if(context==='origin_reference'||context==='destination_reference')session.draft[context==='origin_reference'?'originArea':'destinationArea']={label:'Pilita Seca',category:'barrio',version:'a'.repeat(32),cents:5500,cell:null,priceSource:'reference'};
  session.history=[{role:'assistant',content:context==='origin_reference'?'Ubico Pilita Seca. ¿Qué calle o referencia usamos para recogerte?':context==='destination_reference'?'Ubico Pilita Seca. ¿Qué calle o referencia tiene el destino?':role==='origin'?'¿Dónde te recogemos?':role==='destination'?'¿A dónde vas?':role==='name'?'¿A nombre de quién queda?':'Revisa tu recorrido antes de confirmar.'}];
  return session;
}

export function matchesTaxiContext(actual: Interpretation, test: TaxiContextCase): boolean {
  const keys=Object.keys(actual.fields).sort(),expected=Object.keys(test.expected.fields).sort();
  return actual.intent===test.expected.intent&&JSON.stringify(keys)===JSON.stringify(expected)&&
    Object.entries(test.expected.fields).every(([key,values])=>values?.includes(actual.fields[key==='origin'?'origin':key==='destination'?'destination':key==='pickupReference'?'pickupReference':'name']?.value??''));
}
