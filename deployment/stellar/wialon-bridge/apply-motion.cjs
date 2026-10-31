'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {patchMotion}=require('./patch-motion.cjs');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function main(){
 const [operation,expected]=process.argv.slice(2);
 if(operation!=='--apply'||typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected))throw Error('Expected reviewed bridge hash');
 const root='/root/wialon-bridge',entry=path.join(root,'index.js');
 if(fs.realpathSync(root)!==root)throw Error('Unexpected bridge target');
 const before=fs.readFileSync(entry);if(sha(before)!==expected)throw Error('Active bridge changed; review again');
 if(fs.existsSync(path.join(root,'motion.cjs')))throw Error('Existing motion module requires review');
 const patched=patchMotion(before.toString('utf8')),pending=path.join(__dirname,'index-motion-pending.js');fs.writeFileSync(pending,patched,{mode:0o600});
 if(cp.spawnSync(process.execPath,['--check',pending],{stdio:'pipe'}).status!==0||cp.spawnSync(process.execPath,['--test',path.join(__dirname,'motion.test.cjs')],{stdio:'pipe'}).status!==0)throw Error('Bridge checks failed');
 const backup=path.join(root,'backups','motion-20261031-'+expected.slice(0,12));fs.mkdirSync(backup,{recursive:true,mode:0o700});fs.writeFileSync(path.join(backup,'index.js'),before,{flag:'wx',mode:0o600});
 if(sha(fs.readFileSync(entry))!==expected)throw Error('Bridge changed during preparation');
 fs.copyFileSync(path.join(__dirname,'motion.cjs'),path.join(root,'motion.cjs'));fs.chmodSync(path.join(root,'motion.cjs'),0o600);
 fs.renameSync(pending,entry);fs.chmodSync(entry,0o600);
 console.log(JSON.stringify({backup,before:expected,after:sha(fs.readFileSync(entry)),module:sha(fs.readFileSync(path.join(root,'motion.cjs'))),restarted:false}));
}
if(require.main===module)main();
