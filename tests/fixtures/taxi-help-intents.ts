import type{TaxiContextCase}from'./taxi-contextual-intents.ts';
/** Frozen synthetic development cases before running the new model contract. They do not measure blind accuracy. */
export const TAXI_HELP_CASES:readonly TaxiContextCase[]=[
 {id:'why-location',context:'origin',message:'¿Por qué me pides mi ubicación?',expected:{intent:'question',fields:{}}},
 {id:'how-location',context:'origin',message:'Oye y cómo te mando la ubicación?',expected:{intent:'question',fields:{}}},
 {id:'written-instead-gps',context:'origin',message:'¿No basta con darte mi dirección escrita?',expected:{intent:'question',fields:{}}},
 {id:'name-format',context:'name',message:'¿Mi nombre completo o sólo mi nombre?',expected:{intent:'question',fields:{}}},
 {id:'destination-optional',context:'destination',message:'¿Y si no sé todavía a dónde voy?',expected:{intent:'question',fields:{}}},
 {id:'destination-later-question',context:'destination',message:'¿Puedo decirle el destino después al chofer?',expected:{intent:'question',fields:{}}},
 {id:'payment-unknown',context:'destination',message:'¿Aceptan tarjeta?',expected:{intent:'question',fields:{}}},
 {id:'hours-unknown',context:'review',message:'¿A qué hora dejan de atender?',expected:{intent:'question',fields:{}}},
 {id:'confirmation-how',context:'review',message:'¿Con escribirte que sí ya viene el taxi?',expected:{intent:'question',fields:{}}},
 {id:'summary-before-request',context:'destination',message:'¿Me enseñarás un resumen antes de pedirlo?',expected:{intent:'question',fields:{}}},
 {id:'mixed-destination-question',context:'destination',message:'Voy al Centro, ¿me mostrarás un resumen antes?',expected:{intent:'question',fields:{destination:['Centro']}}},
 {id:'mixed-destination-price',context:'destination',message:'Voy a Pilita Seca, ¿cuánto me sale?',expected:{intent:'quote',fields:{destination:['Pilita Seca']}}},
 {id:'saved-price',context:'review',message:'¿Cuánto sale mi viaje?',expected:{intent:'quote',fields:{}}},
 {id:'actual-status',context:'review',message:'¿Ya viene mi taxi?',expected:{intent:'status',fields:{}}},
 {id:'bare-new-destination',context:'destination',message:'Pilita Seca',expected:{intent:'provide',fields:{destination:['Pilita Seca']}}},
 {id:'explicit-change-despite-question',context:'name',message:'Voy a Pilita Seca',expected:{intent:'provide',fields:{destination:['Pilita Seca']}}},
];
