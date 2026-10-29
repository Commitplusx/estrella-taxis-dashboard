import { supabase } from './supabase';
import { record } from '../../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts';
export class TrackingClientError extends Error {
  readonly code:string;
  readonly status:number;
  constructor(message:string,code:string,status=0){super(message);this.code=code;this.status=status;}
}
export async function issueTrackingCredential(expiration: Date, signal?:AbortSignal): Promise<string> {
  const timeout=AbortSignal.timeout(10000);
  const response=await fetch('/api/session/token',{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({expiration:expiration.toISOString()}),signal:signal?AbortSignal.any([signal,timeout]):timeout});
  if (!response.ok) throw new Error('Inicia sesión otra vez para consultar tu flota.');
  const token=(await response.text()).trim();
  if (!/^[A-Za-z0-9._~+\/=\-]{8,2048}$/.test(token)) throw new Error('No pudimos validar la sesión de tracking.');
  return token;
}
async function sessionToken(signal?:AbortSignal): Promise<string> {
  const saved=localStorage.getItem('traccar_token'); if (saved) return saved;
  return issueTrackingCredential(new Date(Date.now()+10*60000), signal);
}
export async function trackingCall(name:'ai-insights'|'calculate-driving-scores'|'taxi-bot-admin', body:Record<string,unknown>, signal?:AbortSignal): Promise<unknown> {
  const token=await sessionToken(signal);
  const timeout=AbortSignal.timeout(90000);
  const {data,error}=await supabase.functions.invoke(name,{body,headers:{'x-traccar-token':token},signal:signal?AbortSignal.any([signal,timeout]):timeout});
  if (error) {
    if (record(error) && error.context instanceof Response) {
      const payload:unknown=await error.context.clone().json().catch(()=>null);
      if (record(payload) && typeof payload.error==='string') throw new TrackingClientError(payload.error,typeof payload.code==='string'?payload.code:'request_failed',error.context.status);
    }
    throw new Error('No pudimos consultar tracking. Revisa tu conexión y vuelve a intentar.');
  }
  const value:unknown=data; return value;
}
