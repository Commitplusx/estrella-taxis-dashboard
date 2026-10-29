import { FleetApi, requireFeature, selectDevices } from '../_shared/tracking/auth.ts';
import { dayPeriod, fingerprint, localDay, record, TrackingError, uuid } from '../_shared/tracking/contracts.ts';
import { corsHeaders, errorResponse, json, mapLimit, readJson } from '../_shared/tracking/http.ts';
import { analyzeDriving, SCORE_VERSION, scoreRow } from '../_shared/tracking/scoring.ts';
import { claimOperation, finishOperation, type TrackingStore } from '../_shared/tracking/store.ts';
export interface ScoreDependencies { fleet:FleetApi; store:TrackingStore; now:()=>number; job?:{secret:string;email:string;password:string} }
const scoreFields='device_id,device_name,score_date,score,score_label,harsh_braking,harsh_acceleration,overspeed_events,idle_minutes,distance_km,duration_minutes,max_speed_kmh,positions_analyzed,algorithm_version,quality,computed_at';
export function createScoresHandler(deps: ScoreDependencies): (req:Request)=>Promise<Response> {
  return async (req) => {
    if (req.method==='OPTIONS') return new Response('ok',{headers:corsHeaders});
    if (req.method!=='POST') return json({error:'Usa POST para consultar las calificaciones.',code:'method_not_allowed'},405);
    let operation: {user:number;key:string;lease:string} | null=null;
    try {
      const body=await readJson(req,16384);
      if (!record(body) || !['history','calculate'].includes(String(body.action)) || Object.keys(body).some((key)=>!['action','date','from','to','deviceIds','requestId'].includes(key))) throw new TrackingError(400,'invalid_request','Indica la operación, unidades y fecha.');
      const suppliedJob=req.headers.get('x-tracking-job-secret');
      if(suppliedJob && (!deps.job?.secret || deps.job.secret.length<32 || suppliedJob.length>512 || await fingerprint(suppliedJob)!==await fingerprint(deps.job.secret))) throw new TrackingError(401,'job_unauthorized','La tarea programada no está autorizada.');
      if(suppliedJob && body.action!=='calculate')throw new TrackingError(403,'job_operation_forbidden','La tarea sólo puede calcular calificaciones.');
      const session=suppliedJob && deps.job?await deps.fleet.jobSession(deps.job.email,deps.job.password,req.signal):await deps.fleet.session(req);
      const devices=selectDevices(session,body.deviceIds ?? (suppliedJob?session.devices.map((device)=>device.id):undefined),body.action==='history'?100:25);
      await requireFeature(deps.store,session,'score_diario');
      if (body.action==='history') {
        const from=dayPeriod(body.from ?? body.date ?? localDay(deps.now()),deps.now());
        const to=dayPeriod(body.to ?? body.date ?? localDay(deps.now()),deps.now());
        const span=Date.parse(to.from)-Date.parse(from.from);
        if (span<0 || span>30*86400000) throw new TrackingError(400,'invalid_history_period','El historial permite hasta 31 días.');
        const query=new URLSearchParams({select:scoreFields,device_id:`in.(${devices.map((device)=>device.id).join(',')})`,and:`(score_date.gte.${from.date},score_date.lte.${to.date})`,order:'score_date.desc,device_id.asc',limit:'3100'});
        const rows=await deps.store.read('driving_scores',query);
        const allowed=new Set(devices.map((device)=>device.id));
        if (rows.some((row)=>!record(row) || typeof row.device_id!=='number' || !allowed.has(row.device_id)
          || typeof row.score_date!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.score_date)
          || !Number.isFinite(Date.parse(row.score_date)) || new Date(row.score_date).toISOString().slice(0,10)!==row.score_date
          || row.score_date<from.date || row.score_date>to.date || typeof row.score!=='number'
          || !Number.isInteger(row.score) || row.score<0 || row.score>100)) throw new TrackingError(502,'invalid_history','El historial contiene datos fuera de las unidades, fechas o calificaciones solicitadas.');
        return json({rows,version:SCORE_VERSION});
      }
      const range=dayPeriod(body.date ?? localDay(deps.now()-86400000),deps.now());
      const hash=await fingerprint({date:range.date,devices:devices.map((device)=>device.id),version:SCORE_VERSION});
      const scheduledKey=`${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
      const key=uuid(body.requestId ?? (suppliedJob?scheduledKey:undefined));
      const claim=await claimOperation(deps.store,session.userId,key,'score',hash);
      if (claim.replay!==null) return json(claim.replay,claim.status);
      operation={user:session.userId,key,lease:claim.lease};
      const computationStarted=new Date(deps.now()).toISOString();
      // Leave time to persist the result within the two-minute operation lease.
      const analysisSignal=AbortSignal.any([req.signal,AbortSignal.timeout(65000)]);
      const analyses=await mapLimit(devices,3,async (device)=>{
        const query=new URLSearchParams({deviceId:String(device.id),from:range.from,to:range.to});
        const route=await deps.fleet.get(`/reports/route?${query}`,session.cookie,analysisSignal,4194304);
        if (!Array.isArray(route) || route.length>25000) throw new TrackingError(413,'route_too_large','La ruta excede el límite de 25,000 posiciones por unidad.');
        return {deviceId:device.id,...analyzeDriving(route,device,range.date,Date.parse(range.from),Date.parse(range.to))};
      });
      if(analysisSignal.aborted) throw new TrackingError(504,'analysis_timeout','El cálculo agotó su tiempo. Consulta el historial antes de intentarlo de nuevo.');
      const results=analyses.flatMap((item)=>item.score?[item.score]:[]);
      await deps.store.writeScores(results.map((score)=>({...scoreRow(score),computed_at:computationStarted})));
      const result={date:range.date,period:range,version:SCORE_VERSION,computed:results.length,results,
        omitted:analyses.filter((item)=>!item.score).map((item)=>({deviceId:item.deviceId,reason:'insufficient_telemetry',quality:item.quality}))};
      await finishOperation(deps.store,session.userId,key,claim.lease,result);
      return json(result);
    } catch (error:unknown) {
      const response=errorResponse(error);
      if (operation) {
        try { await finishOperation(deps.store,operation.user,operation.key,operation.lease,await response.clone().json(),response.status); }
        catch { return json({error:'No se confirmó el resultado. Consulta el historial antes de iniciar otro cálculo.',code:'result_uncertain'},503); }
      }
      return response;
    }
  };
}
