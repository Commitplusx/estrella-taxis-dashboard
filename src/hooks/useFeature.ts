import { useAuth } from '../context/AuthContext';

export type Feature = 
  | 'bot_voz'
  | 'bot_wa'
  | 'score_diario'
  | 'reporte_pdf'
  | 'enrutamiento_vectorial'
  | 'mapa_calor'
  | string;

export function useFeature(featureName: Feature): boolean {
  const { userRole, paqueteActual } = useAuth();

  // El superadmin siempre tiene acceso a todo el sistema internamente
  if (userRole === 'superadmin') return true;

  // Si no hay paquete asignado, asumimos plan básico (denegado por defecto para features pro)
  if (!paqueteActual) return false;

  // Features principales que son booleanos directos en el paquete
  if (featureName === 'bot_voz') return paqueteActual.incluye_bot;
  if (featureName === 'bot_wa') return paqueteActual.incluye_whatsapp;

  // Features basados en los permisos del sistema (algoritmos)
  if (paqueteActual.permisos_sistema) {
    return paqueteActual.permisos_sistema[featureName] === true;
  }

  return false;
}
