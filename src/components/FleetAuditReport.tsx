import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import type { AuditReport } from '../lib/trackingContracts';
export function FleetAuditReport({report,onClose}:{report:AuditReport;onClose:()=>void}) {
  const names=new Map(report.devices.map((device)=>[device.id,device.name]));
  const date=new Intl.DateTimeFormat('es-MX',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'America/Mexico_City'});
  return <section className="fleet-audit" aria-labelledby="fleet-audit-title">
    <header className="fleet-audit-heading"><div><h3 id="fleet-audit-title">Revisión de la flota</h3><p>{date.format(new Date(report.period.from))} — {date.format(new Date(report.period.to))}</p></div>
      <button type="button" onClick={onClose} aria-label="Cerrar análisis"><X size={18}/></button></header>
    <p className="fleet-audit-scope">{report.facts.units} unidades · {report.facts.distanceKm.toLocaleString('es-MX')} km registrados · {report.facts.eventCount} eventos</p>
    {report.narrative && <p className="fleet-audit-summary">{report.narrative.summary}</p>}
    {report.narrativeStatus!=='generated' && <p className="fleet-audit-notice" role="status">{report.narrativeStatus==='not_configured'?'La redacción con IA aún no está configurada.':'La IA no respondió con un análisis válido.'} Puedes revisar abajo los hallazgos calculados con los datos del GPS.</p>}
    {report.facts.findings.length ? <ul className="fleet-audit-findings">{report.facts.findings.map((finding)=>{
      const recommendation=report.narrative?.recommendations.find((item)=>item.findingId===finding.id);
      return <li key={finding.id}><AlertTriangle size={18} aria-hidden="true"/><div><p className="fleet-audit-unit">{names.get(finding.deviceId)}</p><h4>{finding.title}</h4><p>{finding.evidence}</p>{recommendation && <p className="fleet-audit-action">Siguiente paso: {recommendation.text}</p>}</div></li>;
    })}</ul>:<p className="fleet-audit-empty"><CheckCircle2 size={18} aria-hidden="true"/>No aparecieron señales con las reglas de este análisis. Revisa también la cobertura del GPS.</p>}
    {report.facts.warnings.length>0 && <div className="fleet-audit-warnings"><h4>Datos por revisar</h4><ul>{report.facts.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></div>}
    <footer>Los avisos señalan qué revisar; requieren comprobación antes de tomar una decisión sobre un conductor.</footer>
  </section>;
}
