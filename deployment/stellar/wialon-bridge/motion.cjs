'use strict';
const fs=require('node:fs'),path=require('node:path');
const MAX_UNITS=1000,RETENTION=7*86400;
const finite=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const stamp=n=>Number.isSafeInteger(n)&&n>0;
function distance(a,b){const r=Math.PI/180,dlat=(b.y-a.y)*r,dlng=(b.x-a.x)*r;const h=Math.sin(dlat/2)**2+Math.cos(a.y*r)*Math.cos(b.y*r)*Math.sin(dlng/2)**2;return 6371000*2*Math.asin(Math.sqrt(Math.max(0,Math.min(1,h))));}
function valid(row){return row&&stamp(row.fix)&&stamp(row.seen)&&finite(row.y,-90,90)&&finite(row.x,-180,180)&&finite(row.speed,0,500)&&finite(row.anchorY,-90,90)&&finite(row.anchorX,-180,180)&&(row.since===null||stamp(row.since)&&row.since<=row.fix);}
/** A durable stop interval. Reimports, GPS jitter and process restarts never reset it. */
function createMotionTracker({file,clock=()=>Date.now()}={}){
 let rows=new Map();
 if(file&&fs.existsSync(file)){
  const bytes=fs.readFileSync(file);if(bytes.length>524288)throw Error('motion_state_oversized');
  const state=JSON.parse(bytes);if(state.version!==1||!Array.isArray(state.units)||state.units.length>MAX_UNITS)throw Error('motion_state_invalid');
  for(const pair of state.units){if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||!pair[0]||pair[0].length>120||!valid(pair[1])||rows.has(pair[0]))throw Error('motion_state_invalid');rows.set(pair[0],pair[1]);}
 }
 function observe(id,pos){
  const now=Math.floor(clock()/1000);
  if(typeof id!=='string'||!id||id.length>120||!pos||!stamp(pos.t)||pos.t>now+30||!finite(pos.y,-90,90)||!finite(pos.x,-180,180)||!finite(pos.s,0,500))throw Error('motion_fix_invalid');
  const old=rows.get(id);
  if(old&&pos.t<old.fix)throw Error('motion_fix_regressed');
  if(old&&pos.t===old.fix&&(pos.y!==old.y||pos.x!==old.x||pos.s!==old.speed))throw Error('motion_fix_conflict');
  const moved=pos.s>3||old&&distance({y:old.anchorY,x:old.anchorX},pos)>=50;
  const since=pos.s>3?null:!old||old.since===null||moved?pos.t:old.since;
  const reset=!old||old.since===null||moved;
  const next={fix:pos.t,seen:now,y:pos.y,x:pos.x,speed:pos.s,anchorY:reset?pos.y:old.anchorY,anchorX:reset?pos.x:old.anchorX,since};
  if(!old&&rows.size>=MAX_UNITS)throw Error('motion_state_limit');
  rows.set(id,next);
  const params=new URLSearchParams({taxiMotionVersion:'1',taxiMotionFixTime:String(pos.t),taxiMotionState:since===null?'moving':'stationary'});
  if(since!==null)params.set('taxiStationarySince',String(since));
  return params;
 }
 function persist(){
  const now=Math.floor(clock()/1000);rows=new Map([...rows].filter(([,r])=>now-r.seen<=RETENTION));
  if(!file)return;
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const temporary=file+'.pending',bytes=JSON.stringify({version:1,units:[...rows]});
  const fd=fs.openSync(temporary,'w',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temporary,file);fs.chmodSync(file,0o600);
 }
 return{observe,persist};
}
module.exports={createMotionTracker};
