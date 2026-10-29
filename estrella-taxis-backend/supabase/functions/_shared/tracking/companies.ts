import { record, TrackingError } from './contracts.ts';
import { parseTaxiCompanyPackageAssignment, type TaxiCompanyPackageAssignment } from './packages.ts';

export interface TaxiBase extends TaxiCompanyPackageAssignment {
  plan: { nombre: string; activo: boolean; incluye_whatsapp: boolean } | null;
}

export interface TaxiBaseList {
  bases: TaxiBase[];
  canManage: boolean;
}

export const taxiBaseColumns = 'id,nombre_empresa,ciudad,activo,paquete_id,paquete:paquetes(nombre,activo,incluye_whatsapp)';

export function parseTaxiBase(value: unknown): TaxiBase {
  const base = parseTaxiCompanyPackageAssignment(value);
  if (!record(value) || !(value.paquete === null || record(value.paquete))) {
    throw new TrackingError(502, 'invalid_base_data', 'No pudimos comprobar el plan de la base.');
  }
  const plan = value.paquete;
  if (plan !== null && (typeof plan.nombre !== 'string' || !plan.nombre.trim() || plan.nombre.length > 120 ||
    typeof plan.activo !== 'boolean' || typeof plan.incluye_whatsapp !== 'boolean')) {
    throw new TrackingError(502, 'invalid_base_data', 'El plan de la base no tiene el formato esperado.');
  }
  return { ...base, plan: plan === null ? null : {
    nombre: String(plan.nombre), activo: plan.activo === true, incluye_whatsapp: plan.incluye_whatsapp === true,
  } };
}

export function parseTaxiBaseResponse(value: unknown): TaxiBase {
  if (!record(value) || !record(value.plan) && value.plan !== null) {
    throw new Error('El servidor devolvió una base no válida.');
  }
  return parseTaxiBase({ ...value, paquete: value.plan });
}

export function parseTaxiBaseList(value: unknown): TaxiBaseList {
  if (!record(value) || !Array.isArray(value.bases) || value.bases.length > 100 || typeof value.canManage !== 'boolean') {
    throw new Error('No pudimos leer las bases.');
  }
  const bases = value.bases.map(parseTaxiBaseResponse);
  if (new Set(bases.map(base => base.id)).size !== bases.length) {
    throw new Error('La lista de bases contiene registros repetidos.');
  }
  return { bases, canManage: value.canManage };
}
