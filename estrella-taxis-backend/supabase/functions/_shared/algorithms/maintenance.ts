/**
 * Módulo de Mantenimiento Preventivo
 * 
 * Versión Robusta:
 * - Validación de reglas (intervalos válidos, no ceros, no negativos).
 * - Protección contra odómetros basura (saltos abruptos del GPS).
 * - Manejo seguro de ciclos.
 */

export interface MaintenanceRule {
  id: string;
  name: string;
  intervalKm: number; 
  warningThresholdKm: number; 
}

export interface MaintenanceAlert {
  deviceId: number;
  odometerKm: number;
  rule: MaintenanceRule;
  kmToNextService: number;
  status: 'WARNING' | 'DUE' | 'OK';
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
  
  if (!Number.isFinite(deviceId) || !Number.isFinite(odometerKm)) {
    return [{
      deviceId: deviceId || -1,
      odometerKm: 0,
      rule: { id: 'error', name: 'Error de Input', intervalKm: 1, warningThresholdKm: 0 },
      kmToNextService: 0,
      status: 'OK',
      error: 'Inputs inválidos. odometerKm debe ser numérico.'
    }];
  }

  // Odómetro negativo es imposible en el mundo real, ignorar
  if (odometerKm < 0) return [];
  
  // Si el GPS escupe un odómetro billonario (bug de hardware), ignorar
  if (odometerKm > 10_000_000) return []; 

  const alerts: MaintenanceAlert[] = [];
  const safeRules = Array.isArray(rules) ? rules : DEFAULT_RULES;

  for (const rule of safeRules) {
    if (!isValidRule(rule)) {
      console.warn(`[MANTENIMIENTO] Regla inválida omitida:`, rule);
      continue;
    }

    // Calculamos el próximo servicio usando módulo seguro
    const completedCycles = Math.floor(odometerKm / rule.intervalKm);
    const nextServiceTarget = (completedCycles + 1) * rule.intervalKm;
    
    // Cuántos km faltan
    let kmToNextService = nextServiceTarget - odometerKm;
    
    // Fix: Si por problemas de floats el kmToNextService queda en -0.0001
    if (kmToNextService < 0.001 && kmToNextService > -0.001) {
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
