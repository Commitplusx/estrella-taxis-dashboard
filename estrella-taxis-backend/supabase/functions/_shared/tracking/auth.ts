import { ids, positiveId, record, TrackingError } from './contracts.ts';
import { readJson, requestJson, type Fetcher } from './http.ts';
import type { TrackingStore } from './store.ts';
export interface FleetDevice { id: number; name: string; status?:'online'|'offline'|'unknown' }
export interface FleetIdentity {userId:number;admin:boolean;cookie:string}
export interface FleetSession extends FleetIdentity { devices: FleetDevice[] }
export class FleetApi {
  readonly base: string;
  private readonly fetcher: Fetcher;
  constructor(base: string, fetcher: Fetcher = fetch) {
    const url=new URL(base); if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid Traccar URL.');
    this.base=base.replace(/\/$/,'');this.fetcher=fetcher;
  }
  async identity(req: Request): Promise<FleetIdentity> {
    const token=req.headers.get('x-traccar-token'); const supplied=req.headers.get('x-traccar-session');
    let cookie: string;
    let user: unknown;
    if (token && !supplied && /^[A-Za-z0-9._~+\/=\-]{8,2048}$/.test(token)) {
      const url=new URL(`${this.base}/session`); url.searchParams.set('token',token);
      const loaded=await requestJson(this.fetcher,url,{ headers:{ Accept:'application/json' }, signal:req.signal });
      user=loaded.data; cookie=loaded.response.headers.get('set-cookie')?.split(';')[0] ?? '';
    } else if (supplied && !token && /^JSESSIONID=[A-Za-z0-9._~\-]{8,512}$/.test(supplied)) {
      cookie=supplied;
      user=(await requestJson(this.fetcher,`${this.base}/session`,{ headers:{ Accept:'application/json', Cookie:cookie }, signal:req.signal })).data;
    } else throw new TrackingError(401,'missing_session','Inicia sesión para consultar tu flota.');
    if (!record(user) || !positiveId(user.id) || user.disabled === true || !/^JSESSIONID=[A-Za-z0-9._~\-]{8,512}$/.test(cookie)) throw new TrackingError(401,'invalid_session','La sesión de tracking ya no está disponible.');
    return{userId:user.id,admin:user.administrator===true,cookie};
  }
  async session(req:Request):Promise<FleetSession>{
    const identity=await this.identity(req);
    const data=await this.get('/devices',identity.cookie,req.signal);
    if (!Array.isArray(data) || data.length > 10000) throw new TrackingError(502,'invalid_devices','No pudimos validar las unidades de tu cuenta.');
    const devices: FleetDevice[]=[];
    for (const item of data) {
      if (!record(item) || !positiveId(item.id) || typeof item.name !== 'string') throw new TrackingError(502,'invalid_devices','El proveedor devolvió una unidad no válida.');
      devices.push({ id:item.id, name:item.name.slice(0,120),status:item.status==='online'?'online':item.status==='offline'?'offline':'unknown' });
    }
    return {...identity,devices};
  }
  async get(path: string, cookie: string, signal?: AbortSignal, maxBytes=2097152): Promise<unknown> {
    return (await requestJson(this.fetcher,`${this.base}${path}`,{ headers:{ Accept:'application/json', Cookie:cookie },signal },10000,maxBytes)).data;
  }
  async write(path: string, method: 'POST' | 'PUT' | 'DELETE', cookie: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (!/^\/(?:users(?:\/[1-9][0-9]*)?|permissions)$/.test(path)) throw new Error('Invalid account administration path.');
    let response: Response;
    try {
      response = await this.fetcher(this.base + path, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify(payload), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000), redirect: 'error' });
    } catch { throw new TrackingError(503, 'account_write_uncertain', 'No se confirmó el cambio en Traccar. Comprueba la misma solicitud.'); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new TrackingError(503, 'account_write_uncertain', 'Traccar no confirmó el cambio de acceso. Comprueba la misma solicitud.');
    }
    if (response.status === 204) return null;
    return await readJson(response, 2097152);
  }
  async jobSession(email:string,password:string,signal?:AbortSignal):Promise<FleetSession> {
    if(!email || !password) throw new TrackingError(503,'job_not_configured','Falta configurar la cuenta del cálculo programado.');
    const result=await requestJson(this.fetcher,`${this.base}/session`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams({email,password}),signal});
    const cookie=result.response.headers.get('set-cookie')?.split(';')[0] ?? '';
    return this.session(new Request('https://internal.invalid',{headers:{'x-traccar-session':cookie},signal}));
  }
}
export function selectDevices(session: FleetSession, requested: unknown, max=25): FleetDevice[] {
  const selected=ids(requested,max); const allowed=new Map(session.devices.map((device)=>[device.id,device]));
  return selected.map((id)=>{ const device=allowed.get(id); if (!device) throw new TrackingError(403,'device_forbidden','Una de las unidades no pertenece a tu cuenta.'); return device; });
}
export async function requireFeature(store: TrackingStore, session: FleetSession, feature: 'auditoria_ia' | 'score_diario'): Promise<void> {
  if (session.admin) return;
  const profiles=await store.read('perfiles',new URLSearchParams({ select:'empresa_id',traccar_user_id:`eq.${session.userId}`,limit:'2' }));
  if (profiles.length !== 1 || !record(profiles[0]) || typeof profiles[0].empresa_id !== 'string') throw new TrackingError(403,'company_required','Tu cuenta necesita una empresa asignada para usar este análisis.');
  const companies=await store.read('empresas',new URLSearchParams({ select:'id,activo,paquete:paquetes(permisos_sistema,activo)',id:`eq.${profiles[0].empresa_id}`,limit:'1' }));
  const company=companies[0]; const plan=record(company) ? company.paquete : null;
  if (!record(company) || company.activo !== true || !record(plan) || plan.activo !== true || !record(plan.permisos_sistema) || plan.permisos_sistema[feature] !== true) throw new TrackingError(403,'feature_forbidden','Esta función no está habilitada para tu empresa.');
}
