'use strict';
function patchMotion(source){
 const edits=[
 ["const { occupancyParams } = require('./occupancy.cjs');","const { occupancyParams } = require('./occupancy.cjs');\nconst {createMotionTracker}=require('./motion.cjs');\nconst motionTracker=createMotionTracker({file:'/root/wialon-bridge/state/taxi-motion.json'});"],
 ["      let extraParams = '&' + availability.toString();","      const motion=motionTracker.observe(String(item.id??safeId),pos);\n      let extraParams = '&' + availability.toString() + '&' + motion.toString();"],
 ["    console.log(JSON.stringify({event:'taxi_occupancy_observed',...occupancyCounts}));","    motionTracker.persist();\n    console.log(JSON.stringify({event:'taxi_occupancy_observed',...occupancyCounts}));"]
 ];
 if(source.includes('motionTracker'))throw Error('Motion patch already present');
 for(const [before,after]of edits){if(source.split(before).length!==2)throw Error('Reviewed bridge contract changed');source=source.replace(before,after);}
 return source;
}
module.exports={patchMotion};
