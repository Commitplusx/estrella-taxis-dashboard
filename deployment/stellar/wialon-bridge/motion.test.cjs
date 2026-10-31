'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createMotionTracker}=require('./motion.cjs');
const epoch=1793470000,point=(t=epoch,extra={})=>({t,y:16.25,x:-92.13,s:0,...extra});
test('stopped interval survives a thousand fresh stationary reports and repeated imports',()=>{
 const tracker=createMotionTracker({clock:()=>(epoch+4000)*1000});
 for(let i=0;i<1000;i++){const p=tracker.observe('unit',point(epoch+i));assert.equal(p.get('taxiStationarySince'),String(epoch));}
 assert.equal(tracker.observe('unit',point(epoch+999)).get('taxiStationarySince'),String(epoch));
});
test('small jitter accumulates against the stop anchor; genuine displacement and speed restart the interval',()=>{
 const t=createMotionTracker({clock:()=>(epoch+4000)*1000});t.observe('unit',point());
 assert.equal(t.observe('unit',point(epoch+30,{y:16.2501})).get('taxiStationarySince'),String(epoch));
 assert.equal(t.observe('unit',point(epoch+60,{y:16.2505})).get('taxiStationarySince'),String(epoch+60));
 assert.equal(t.observe('unit',point(epoch+90,{y:16.2505,s:10})).get('taxiMotionState'),'moving');
 assert.equal(t.observe('unit',point(epoch+120,{y:16.2506})).get('taxiStationarySince'),String(epoch+120));
});
test('restart preserves stop time; corrupt durable state fails visibly instead of resetting the timer',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'taxi-motion-')),file=path.join(dir,'motion.json');
 try{let t=createMotionTracker({file,clock:()=>(epoch+4000)*1000});t.observe('unit',point());t.persist();t=createMotionTracker({file,clock:()=>(epoch+4000)*1000});assert.equal(t.observe('unit',point(epoch+2000)).get('taxiStationarySince'),String(epoch));fs.writeFileSync(file,'broken');assert.throws(()=>createMotionTracker({file}),SyntaxError);}finally{fs.rmSync(dir,{recursive:true});}
});
test('regressed, contradictory, future, missing or impossible telemetry cannot reset a known stop',()=>{
 const t=createMotionTracker({clock:()=>(epoch+60)*1000});t.observe('unit',point());
 for(const p of [point(epoch-1),point(epoch,{y:17}),point(epoch,{s:10}),point(epoch+91),point(epoch+1,{y:NaN}),point(epoch+1,{s:-1}),null])assert.throws(()=>t.observe('unit',p));
 assert.equal(t.observe('unit',point(epoch+60)).get('taxiStationarySince'),String(epoch));
});
