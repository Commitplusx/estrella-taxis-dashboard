'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {occupancyParams}=require('./occupancy.cjs');
for(const value of [0,'0',1,'1'])test('Wialon exact switch '+JSON.stringify(value),()=>{
 const params=occupancyParams({io_3:{v:value}}),occupied=value===0||value==='0';
 assert.equal(params.get('occupied'),String(occupied));assert.equal(params.get('taxiAvailability'),occupied?'occupied':'free');
});
for(const params of [undefined,null,{},[],{io_3:null},{io_3:1},{io_3:{}},...[null,undefined,true,false,2,-1,'',' ','true','false','01','1.0',{},[],NaN,Infinity].map(v=>({io_3:{v}}))])test('unknown switch remains unknown '+JSON.stringify(params),()=>{
 assert.deepEqual(Object.fromEntries(occupancyParams(params)),{taxiAvailability:'unknown',occupied:'unknown'});
});
test('explicit free -> missing signal -> occupied -> free never keeps an old free flag',()=>{
 const attributes=new URLSearchParams();
 for(const [params,state,occupied] of [[{io_3:{v:1}},'free','false'],[{},'unknown','unknown'],[{io_3:{v:0}},'occupied','true'],[{io_3:{v:1}},'free','false']]){
  for(const [key,value] of occupancyParams(params))attributes.set(key,value);
  assert.equal(attributes.get('taxiAvailability'),state);assert.equal(attributes.get('occupied'),occupied);
 }
});
