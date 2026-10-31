'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {patchBridgeSource}=require('./apply-occupancy.cjs');
const snippet="    let syncedCount = 0;\n      let extraParams = '';\n         const ocupado = prms.io_3?.v === 0;\n         extraParams += `&occupied=${ocupado ? 'true' : 'false'}`;\n    console.log(`📡 Sincronización exitosa: ${syncedCount}/${items.length} taxis inyectados a Traccar.`);";
test('patch refuses partial, repeated and changed baselines',()=>{
 for(const s of ['',snippet.replace('io_3','io_4'),snippet+'\n'+snippet])assert.throws(()=>patchBridgeSource(s),/baseline/);
 const patched=patchBridgeSource(snippet);assert.throws(()=>patchBridgeSource(patched),/already installed/);assert.equal(patched.includes('io_3?.v === 0'),false);assert.equal(patched.includes('occupancyParams(prms)'),true);
});
