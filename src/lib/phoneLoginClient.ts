import { config } from './supabase';
import { record } from '../../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts';
import { readJson } from '../../estrella-taxis-backend/supabase/functions/_shared/tracking/http.ts';
export async function phoneLoginToken(phone:string,password:string):Promise<string>{
 const response=await fetch(config.url+'/functions/v1/taxi-bot-admin',{method:'POST',headers:{'Content-Type':'application/json',apikey:config.publicKey},body:JSON.stringify({action:'phone_login',phone,password,client:'web'}),signal:AbortSignal.timeout(50000)});
 const data=await readJson(response,8192);
 if(!response.ok)throw new Error(record(data)&&typeof data.error==='string'?data.error:'No pudimos iniciar sesión.');
 if(!record(data)||typeof data.token!=='string'||!/^[A-Za-z0-9._~+\/=\-]{8,2048}$/.test(data.token))throw new Error('No pudimos validar la sesión.');
 return data.token;
}
