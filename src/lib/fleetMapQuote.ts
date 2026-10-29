import type { TaxiAdminClient } from './taxiAdminClient.ts';
import type { FleetMapPoint } from './fleetMapPresentation.ts';

/** The dashboard must use the base's server price, never nearby cells or a made-up minimum. */
export async function fleetMapQuote(
  client: Pick<TaxiAdminClient, 'context' | 'quote'>,
  tenantId: string | null,
  origin: FleetMapPoint,
  destination: FleetMapPoint,
): Promise<string> {
  const context = await client.context();
  const channels = context.channels.filter((channel) => tenantId === null || channel.tenantId === tenantId);
  if (channels.length !== 1) return 'Selecciona la base y el canal en Zonas y tarifas para cotizar.';
  const channel = channels[0];
  const quote = await client.quote(channel.tenantId, channel.waba, origin, destination);
  if (quote.state === 'priced' && quote.cents !== null) {
    return 'Tarifa de la base: ' + new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(quote.cents / 100);
  }
  return quote.state === 'uncovered' || quote.state === 'outside_service_area'
    ? 'Recorrido sin tarifa disponible en esta base.'
    : 'La base aún no tiene habilitada la cotización para este recorrido.';
}
