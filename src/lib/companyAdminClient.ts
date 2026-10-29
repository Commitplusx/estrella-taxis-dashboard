import { trackingCall } from './trackingClient';
import { record } from '../../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts';
import { parseTaxiBaseList, parseTaxiBaseResponse, type TaxiBase, type TaxiBaseList } from '../../estrella-taxis-backend/supabase/functions/_shared/tracking/companies.ts';

export const companyAdminClient = {
  async list(signal?: AbortSignal): Promise<TaxiBaseList> {
    return parseTaxiBaseList(await trackingCall('taxi-bot-admin', { action: 'companies_list' }, signal));
  },
  async setActive(base: TaxiBase, active: boolean): Promise<TaxiBase> {
    const response = await trackingCall('taxi-bot-admin', {
      action: 'companies_set_active', companyId: base.id, expectedActive: base.activo, active,
    });
    if (!record(response) || response.state !== 'saved') throw new Error('No se confirmó el estado de la base. Actualiza la lista.');
    const saved = parseTaxiBaseResponse(response.base);
    if (saved.id !== base.id || saved.activo !== active) throw new Error('El estado recibido no coincide con el solicitado. Actualiza la lista.');
    return saved;
  },
};
