import { config } from './supabase';
import { parsePublicTaxiTracking, type PublicTaxiTracking } from './taxiTrackingContracts';

export class PublicTaxiTrackingError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'PublicTaxiTrackingError';
    this.status = status;
    this.code = code;
  }
}

function messageForStatus(status: number): string {
  if (status === 400) return 'El enlace de seguimiento no es válido. Pide que te lo compartan otra vez.';
  if (status === 404) return 'Este enlace de seguimiento ya no está disponible.';
  return 'No pudimos actualizar la ubicación. Vamos a intentarlo de nuevo.';
}

export async function fetchPublicTaxiTracking(token: string, signal: AbortSignal): Promise<PublicTaxiTracking> {
  const endpoint = new URL(`${config.url}/functions/v1/track-position`);
  endpoint.searchParams.set('token', token);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: { apikey: config.publicKey },
      cache: 'no-store',
      redirect: 'error',
      signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]),
    });
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new PublicTaxiTrackingError('No pudimos conectar con el seguimiento. Revisa tu conexión; volveremos a intentar.', 0, 'network_error');
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch((): unknown => null);
    const code = typeof body === 'object' && body !== null && !Array.isArray(body) &&
      'code' in body && typeof body.code === 'string' ? body.code : 'tracking_unavailable';
    throw new PublicTaxiTrackingError(messageForStatus(response.status), response.status, code);
  }

  const body: unknown = await response.json().catch((): unknown => null);
  try {
    return parsePublicTaxiTracking(body);
  } catch {
    throw new PublicTaxiTrackingError('El seguimiento recibió datos incompletos. Estamos intentando actualizarlo.', 502, 'invalid_response');
  }
}
