/**
 * Módulo de Mantenimiento Preventivo
 * 
 * Usa el último servicio registrado; los datos inválidos quedan sin evaluar.
 */

export interface MaintenanceRule {
  id: string;
  name: string;
  intervalKm: number; 
  warningThresholdKm: number; 
  lastServiceKm?: number;
}

export interface MaintenanceAlert {
  deviceId: number;
  odometerKm: number;
  rule: MaintenanceRule;
  kmToNextService: number;
  status: 'WARNING' | 'DUE' | 'OK' | 'UNKNOWN';
  error?: string;
}

const DEFAULT_RULES: MaintenanceRule[] = [
  { id: 'oil_change', name: 'Cambio de Aceite', intervalKm: 5000, warningThresholdKm: 200 },
  { id: 'tires', name: 'Rotación de Llantas', intervalKm: 10000, warningThresholdKm: 300 },
  { id: 'brakes', name: 'Revisión de Frenos', intervalKm: 15000, warningThresholdKm: 500 },
];

/**
 * Valida que una regla de mantenimiento tenga sentido lógico
 */
function isValidRule(rule: MaintenanceRule): boolean {
  if (!rule || typeof rule !== 'object') return false;
  if (!Number.isFinite(rule.intervalKm) || rule.intervalKm <= 0) return false;
  if (!Number.isFinite(rule.warningThresholdKm) || rule.warningThresholdKm < 0) return false;
  // El threshold no puede ser más grande que el intervalo mismo
  if (rule.warningThresholdKm >= rule.intervalKm) return false;
  if (rule.lastServiceKm !== undefined && (!Number.isFinite(rule.lastServiceKm) || rule.lastServiceKm < 0)) return false;
  return true;
}

/**
 * Chequea si el vehículo necesita mantenimiento basado en su odómetro.
 * @param deviceId ID del dispositivo
 * @param odometerKm Kilometraje total actual
 * @param rules Reglas personalizadas (opcional, usa defaults si no se mandan)
 */
export function checkMaintenance(
  deviceId: number, 
  odometerKm: number, 
  rules: MaintenanceRule[] = DEFAULT_RULES
): MaintenanceAlert[] {
  
  if (!Number.isSafeInteger(deviceId) || deviceId<=0 || !Number.isFinite(odometerKm) || odometerKm<0 || odometerKm>10_000_000) {
    return [{
      deviceId: Number.isSafeInteger(deviceId) && deviceId>0 ? deviceId : -1,
      odometerKm: 0,
      rule: { id: 'error', name: 'Error de Input', intervalKm: 1, warningThresholdKm: 0 },
      kmToNextService: 0,
      status: 'UNKNOWN',
      error: 'No se puede evaluar el mantenimiento sin una unidad y un odómetro válidos.'
    }];
  }

  const alerts: MaintenanceAlert[] = [];
  const safeRules = Array.isArray(rules) ? rules : DEFAULT_RULES;

  for (const rule of safeRules) {
    if (!isValidRule(rule)) {
      alerts.push({deviceId,odometerKm,rule:{id:'invalid-rule',name:'Regla sin evaluar',intervalKm:1,warningThresholdKm:0},kmToNextService:0,status:'UNKNOWN',error:'Revisa el intervalo y el último servicio de esta regla.'});
      continue;
    }

    // El odómetro nunca reinicia el mantenimiento por sí solo.
    const lastServiceKm = rule.lastServiceKm ?? 0;
    if (lastServiceKm > odometerKm) {
      alerts.push({deviceId,odometerKm,rule,kmToNextService:0,status:'UNKNOWN',error:'El último servicio supera el odómetro actual. Revisa los registros.'});
      continue;
    }
    const nextServiceTarget = lastServiceKm + rule.intervalKm;
    
    // Cuántos km faltan
    let kmToNextService = nextServiceTarget - odometerKm;
    
    // Fix: Si por problemas de floats el kmToNextService queda en -0.0001
    if (Math.abs(kmToNextService) < 0.001) {
      kmToNextService = 0;
    }

    let status: 'WARNING' | 'DUE' | 'OK' = 'OK';

    if (kmToNextService <= 0) {
      status = 'DUE'; // Ya se pasó!
    } else if (kmToNextService <= rule.warningThresholdKm) {
      status = 'WARNING'; // Ya casi toca
    }

    if (status !== 'OK') {
      alerts.push({
        deviceId,
        odometerKm: Number(odometerKm.toFixed(2)),
        rule,
        kmToNextService: Number(kmToNextService.toFixed(2)),
        status
      });
    }
  }

  return alerts;
}
