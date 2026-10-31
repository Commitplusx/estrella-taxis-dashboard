'use strict';
const http=require('node:http');
const crypto=require('node:crypto');
const fs=require('node:fs');

/** Polling and dispatch share one sync. A failed refresh is never cached as success. */
function createRefreshController(sync,{now=Date.now,timeoutMs=8000,cacheMs=1000}={}){
 let active=null,last=null;
 return {run(reason){
  if(active)return active;
  if(last&&now()-last.finishedMs>=0&&now()-last.finishedMs<cacheMs)return Promise.resolve(last.result);
  active=(async()=>{
   const signal=AbortSignal.timeout(timeoutMs);
   const result=await sync(signal);
   signal.throwIfAborted();
   if(!result||!Number.isSafeInteger(result.synced)||result.synced<1||result.synced!==result.expected)throw Error('gps_refresh_incomplete');
   const finishedMs=now();
   const output={state:'refreshed',synced:result.synced,completedAt:new Date(finishedMs).toISOString()};
   last={finishedMs,result:output};
   console.log(JSON.stringify({event:'taxi_gps_sync',reason,synced:result.synced}));
   return output;
  })().finally(()=>{active=null;});
  return active;
 }};
}

function readWorkerSecret(file){
 const source=fs.readFileSync(file,'utf8');
 const match=/^TAXI_WORKER_SECRET=(.+)$/m.exec(source);
 const secret=match?.[1].trim().replace(/^(['"])(.*)\1$/,'$2');
 if(!secret||secret.length<32||secret.length>512)throw Error('gps_refresh_auth_not_configured');
 return secret;
}
function createRefreshServer(controller,secret){
 if(typeof secret!=='string'||secret.length<32||secret.length>512)throw Error('gps_refresh_auth_not_configured');
 const expected=Buffer.from(secret);
 const server=http.createServer(async(req,res)=>{
  const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  if(req.url!=='/taxi-gps-refresh')return reply(404,{code:'not_found'});
  if(req.method!=='POST')return reply(405,{code:'method_not_allowed'});
  const supplied=req.headers['x-taxi-worker-secret'];
  if(typeof supplied!=='string'||supplied.length>512)return reply(401,{code:'unauthorized'});
  const candidate=Buffer.from(supplied);
  if(candidate.length!==expected.length||!crypto.timingSafeEqual(candidate,expected))return reply(401,{code:'unauthorized'});
  if(req.headers['transfer-encoding']||Number(req.headers['content-length']??0)!==0)return reply(400,{code:'body_not_allowed'});
  try{return reply(200,await controller.run('dispatch'));}
  catch{return reply(503,{code:'gps_refresh_unavailable'});}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;server.keepAliveTimeout=1000;
 return server;
}
function startRefreshServer(controller){
 const server=createRefreshServer(controller,readWorkerSecret('/opt/stellar-taxi-bot/config/worker.env'));
 server.listen(5295,'127.0.0.1');
 return server;
}
module.exports={createRefreshController,createRefreshServer,startRefreshServer,readWorkerSecret};
