'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {patchRefresh}=require('./patch-refresh.cjs');
const {readWorkerSecret}=require('./refresh.cjs');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const location=`    location = /taxi-gps-refresh {
        limit_except POST { deny all; }
        client_max_body_size 1k;
        proxy_pass http://127.0.0.1:5295/taxi-gps-refresh;
        proxy_set_header x-taxi-worker-secret $http_x_taxi_worker_secret;
        proxy_connect_timeout 2s;
        proxy_send_timeout 2s;
        proxy_read_timeout 12s;
        proxy_buffering off;
    }

`;
function main(){
 const [operation,expectedBridge,expectedNginx]=process.argv.slice(2);
 if(operation!=='--apply'||![expectedBridge,expectedNginx].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)))throw Error('Expected two reviewed hashes.');
 const root='/root/wialon-bridge',entry=path.join(root,'index.js'),nginx='/etc/nginx/sites-enabled/taxis';
 if(fs.realpathSync(root)!==root||fs.realpathSync(nginx)!==nginx)throw Error('Unexpected deployment target.');
 const oldBridge=fs.readFileSync(entry),oldNginx=fs.readFileSync(nginx);
 if(sha(oldBridge)!==expectedBridge||sha(oldNginx)!==expectedNginx)throw Error('Production changed; review before patching.');
 readWorkerSecret('/opt/stellar-taxi-bot/config/worker.env');
 if(fs.existsSync(path.join(root,'refresh.cjs')))throw Error('Existing refresh module requires review.');
 const patched=patchRefresh(oldBridge.toString('utf8')),nginxSource=oldNginx.toString('utf8');
 if(nginxSource.includes('/taxi-gps-refresh')||nginxSource.split('    location / {').length!==2)throw Error('Nginx source changed.');
 const patchedNginx=nginxSource.replace('    location / {',location+'    location / {');
 const staged=path.join(__dirname,'index-refresh-pending.js');fs.writeFileSync(staged,patched,{mode:0o600});
 if(cp.spawnSync(process.execPath,['--check',staged]).status!==0)throw Error('Bridge syntax failed.');
 if(cp.spawnSync(process.execPath,['--test',path.join(__dirname,'refresh.test.cjs')],{stdio:'pipe'}).status!==0)throw Error('Refresh module tests failed.');
 const backup=path.join(root,'backups','refresh-20261031-'+expectedBridge.slice(0,12));fs.mkdirSync(backup,{recursive:true,mode:0o700});
 fs.writeFileSync(path.join(backup,'index.js'),oldBridge,{flag:'wx',mode:0o600});fs.writeFileSync(path.join(backup,'nginx-taxis'),oldNginx,{flag:'wx',mode:0o600});
 if(sha(fs.readFileSync(entry))!==expectedBridge||sha(fs.readFileSync(nginx))!==expectedNginx)throw Error('Production changed during preparation.');
 fs.writeFileSync(nginx,patchedNginx);
 if(cp.spawnSync('nginx',['-t'],{stdio:'pipe'}).status!==0){fs.writeFileSync(nginx,oldNginx);throw Error('Nginx validation failed; original restored.');}
 fs.copyFileSync(path.join(__dirname,'refresh.cjs'),path.join(root,'refresh.cjs'));fs.chmodSync(path.join(root,'refresh.cjs'),0o600);
 fs.renameSync(staged,entry);fs.chmodSync(entry,0o600);
 console.log(JSON.stringify({before:expectedBridge,after:sha(fs.readFileSync(entry)),module:sha(fs.readFileSync(path.join(root,'refresh.cjs'))),nginxBefore:expectedNginx,nginxAfter:sha(fs.readFileSync(nginx)),backup,restarted:false}));
}
if(require.main===module)main();
