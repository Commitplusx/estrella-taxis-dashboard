'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
/** Change only occupancy serialization and aggregate visibility in the existing loop. */
function patchBridgeSource(source){
 const edits=[
  ["    let syncedCount = 0;","    let syncedCount = 0;\n    const occupancyCounts = {free:0,occupied:0,unknown:0};"],
  ["      let extraParams = '';","      const availability = occupancyParams(prms);\n      const availabilityState = availability.get('taxiAvailability');\n      if (availabilityState === 'free') occupancyCounts.free++;\n      else if (availabilityState === 'occupied') occupancyCounts.occupied++;\n      else occupancyCounts.unknown++;\n      let extraParams = '&' + availability.toString();"],
  ["         const ocupado = prms.io_3?.v === 0;\n         extraParams += `&occupied=${ocupado ? 'true' : 'false'}`;","         // Occupancy is serialized above, including an explicit unknown when io_3 is absent."],
  ["    console.log(`📡 Sincronización exitosa: ${syncedCount}/${items.length} taxis inyectados a Traccar.`);","    console.log(JSON.stringify({event:'taxi_occupancy_observed',...occupancyCounts}));\n    console.log(`📡 Sincronización exitosa: ${syncedCount}/${items.length} taxis inyectados a Traccar.`);"]
 ];
 let result=source.replaceAll('\r\n','\n');
 if(result.includes("require('./occupancy.cjs')"))throw Error('Occupancy patch is already installed; verify its active hash.');
 for(const [before,after]of edits){if(result.split(before).length!==2)throw Error('Bridge baseline changed; review before editing.');result=result.replace(before,after);}
 return "const { occupancyParams } = require('./occupancy.cjs');\n"+result;
}
function main(){
 const expected=process.argv[3];if(process.argv[2]!=='--apply'||!expected||!/^[a-f0-9]{64}$/.test(expected))throw Error('Supply --apply and the reviewed SHA256.');
 const root='/root/wialon-bridge';if(fs.realpathSync(root)!==root)throw Error('Unexpected bridge target.');
 const entry=path.join(root,'index.js'),bytes=fs.readFileSync(entry);if(sha(bytes)!==expected)throw Error('Active bridge differs from the reviewed baseline.');
 const moduleFile=path.join(root,'occupancy.cjs');if(fs.existsSync(moduleFile))throw Error('Review the existing occupancy module before replacing it.');
 const patched=patchBridgeSource(bytes.toString('utf8')),pending=path.join(__dirname,'index-patched.js');
 fs.writeFileSync(pending,patched,{mode:0o600});
 const check=cp.spawnSync(process.execPath,['--check',pending],{stdio:'pipe'});if(check.status!==0)throw Error('Patched bridge failed syntax validation.');
 const tests=cp.spawnSync(process.execPath,['--test',path.join(__dirname,'occupancy.test.cjs')],{stdio:'pipe'});if(tests.status!==0)throw Error('Occupancy module tests failed.');
 const backup=path.join(root,'backups','occupancy-20261031-'+expected.slice(0,12));fs.mkdirSync(backup,{recursive:true,mode:0o700});fs.chmodSync(backup,0o700);
 fs.writeFileSync(path.join(backup,'index.js'),bytes,{flag:'wx',mode:0o600});
 if(sha(fs.readFileSync(entry))!==expected)throw Error('Bridge changed during preparation. No source was replaced.');
 const staged=path.join(root,'occupancy.pending.cjs');fs.copyFileSync(path.join(__dirname,'occupancy.cjs'),staged);fs.chmodSync(staged,0o600);fs.renameSync(staged,moduleFile);
 fs.renameSync(pending,entry);fs.chmodSync(entry,0o600);
 console.log(JSON.stringify({entry,before:expected,after:sha(fs.readFileSync(entry)),module:sha(fs.readFileSync(moduleFile)),backup,applied:true,restarted:false}));
}
module.exports={patchBridgeSource};
if(require.main===module)main();
