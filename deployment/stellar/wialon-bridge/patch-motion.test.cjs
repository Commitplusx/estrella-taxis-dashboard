'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {patchMotion}=require('./patch-motion.cjs');
const fixture=["const { occupancyParams } = require('./occupancy.cjs');","      let extraParams = '&' + availability.toString();","    console.log(JSON.stringify({event:'taxi_occupancy_observed',...occupancyCounts}));"].join('\n');
test('motion patch touches only the reviewed bridge anchors and preserves original GPS timestamp',()=>{
 const result=patchMotion(fixture+'\nconst original=pos.t;');assert(result.includes('motionTracker.observe(String(item.id??safeId),pos)'));assert(result.includes('motionTracker.persist()'));assert(result.includes('const original=pos.t;'));assert.throws(()=>patchMotion(result));assert.throws(()=>patchMotion(fixture.replace('let extraParams','var extraParams')));
});
