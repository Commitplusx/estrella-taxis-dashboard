import { assert, assertEquals } from 'https://deno.land/std@0.177.0/testing/asserts.ts';
import { coordinateTaxi, type TaxiServices } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/coordinator.ts';
import { emptyDraft, record, type Interpretation, type TaxiChannel, type TaxiInbound, type TaxiSession } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts';
import { createTaxiInterpreter } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/interpreter.ts';

const now = Date.parse('2026-10-30T20:00:00Z');
const channel: TaxiChannel = { tenantId:'11111111-1111-4111-8111-111111111111',waba:'+529630000001',enabled:true,name:'Base sintética',city:'Comitán',centerLat:16.25,centerLng:-92.13,radiusKm:20,dispatcher:null,model:'fixture',baseCents:null,perKmCents:null,pricingMode:'h3_zone_max' };
const origin = { text:'Calle Primera 20',lat:16.25,lng:-92.13,placeId:null };
const destination = { text:'Calle Segunda 35',lat:16.26,lng:-92.14,placeId:null };
const session = (): TaxiSession => ({ revision:0,mode:'bot',active:null,history:[],draft:emptyDraft() });
const inbound = (text:string): TaxiInbound => ({ id:crypto.randomUUID(),from:'+529630000002',to:channel.waba,at:new Date(now).toISOString(),type:'text',text,button:null,location:null });
const services = (result: Interpretation | Error): TaxiServices => ({
  interpret:async()=>{if(result instanceof Error)throw result;return result;},
  resolve:async()=>{throw new Error('An ambiguous answer cannot invent a resolved location.');},
  quote:async()=>{throw new Error('Clarification cannot quote.');},
  candidates:async()=>{throw new Error('Clarification cannot dispatch.');},
});
for (const role of ['origin','destination'] as const) {
  for (const failed of [false,true]) Deno.test(`contextual reply: ${failed?'failed':'ambiguous'} interpretation keeps asking for pending ${role}`,async()=>{
    const s=session();s.draft.awaitingLocation=role;
    if(role==='origin')s.draft.destination=destination;else s.draft.origin=origin;
    s.draft.name='Mariana';
    const d=await coordinateTaxi([inbound('Pilita seca')],s,channel,services(failed?new Error('fixture failure'):{intent:'ambiguous',fields:{}}),now);
    assertEquals(d.action,'draft');assertEquals(d.draft.awaitingLocation,role);assertEquals(d.messages[0].locationRequest,role);
    assertEquals(d.draft.name,s.draft.name);assertEquals(d.draft[role==='origin'?'destination':'origin'],s.draft[role==='origin'?'destination':'origin']);
    assert(!/cambiar|cancelar|el cambio/.test(d.messages[0].text));assertEquals(d.draft.confirmation,null);
  });
}
Deno.test('contextual reply: a pending passenger name gets a name question without resetting the route',async()=>{
  const s=session();s.draft.origin=origin;s.draft.destination=destination;
  const d=await coordinateTaxi([inbound('¿cómo?')],s,channel,services({intent:'ambiguous',fields:{}}),now);
  assert(/nombre/.test(d.messages[0].text));assert(!/cancelar|cambiar/.test(d.messages[0].text));
  assertEquals(d.draft.origin,origin);assertEquals(d.draft.destination,destination);assertEquals(d.messages[0].locationRequest,undefined);
});
Deno.test('contextual reply: a colloquial answer to the name question completes the saved route without a magic phrase',async()=>{
  const s=session();s.draft.origin=origin;s.draft.destination=destination;
  const d=await coordinateTaxi([inbound('para Mariana')],s,channel,services({intent:'provide',fields:{name:{value:'Mariana',evidence:'para Mariana'}}}),now);
  assertEquals(d.draft.name,'Mariana');assertEquals(d.draft.origin,origin);assertEquals(d.draft.destination,destination);
  assert(d.draft.confirmation);assertEquals(d.action,'draft');assertEquals(d.candidates,[]);
});
Deno.test('contextual interpreter: exposes the expected field for a bare locality and does not copy history as new data',async()=>{
  const s=session();s.draft.awaitingLocation='origin';s.history=[{role:'assistant',content:'¿Dónde te recogemos? Escríbeme la dirección o comparte el pin.'}];
  let checked=false;
  const interpreter=createTaxiInterpreter(async(_url,init)=>{
    const body:unknown=JSON.parse(String(init?.body));assert(record(body)&&Array.isArray(body.messages));
    const last:unknown=body.messages.at(-1);assert(record(last)&&typeof last.content==='string');
    const input:unknown=JSON.parse(last.content);assert(record(input)&&record(input.context));
    assertEquals(input.context.expectedField,'origin');assertEquals(input.current,'Pilita seca');checked=true;
    return Response.json({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'fixture',type:'function',function:{name:'actualizar_recorrido',arguments:JSON.stringify({fields:{origin:{value:'Pilita seca',evidence:'Pilita seca'}}})}}]}}]});
  },'fixture-key','fixture-model');
  const proposal=await interpreter('Pilita seca',s,channel);
  assert(checked);assertEquals(proposal,{intent:'provide',fields:{origin:{value:'Pilita seca',evidence:'Pilita seca'}}});
});
