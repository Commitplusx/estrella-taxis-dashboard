import { config } from "./supabase";
import {
  DRIVER_TRIP_TOKEN,
  type DriverTripAction,
  type DriverTripView,
  parseDriverTrip,
} from "../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/driverTripContracts";
export type { DriverTripAction, DriverTripView };
export class DriverTripError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "DriverTripError";
  }
}
export function driverTripToken(hash: string): string | null {
  const token = hash.startsWith("#") ? hash.slice(1) : hash;
  return DRIVER_TRIP_TOKEN.test(token) ? token : null;
}
export async function loadDriverTrip(
  token: string,
  signal: AbortSignal,
  command?: { action: DriverTripAction; requestId: string },
): Promise<DriverTripView> {
  const request = {
    action: command?.action ?? "read",
    token,
    ...(command ? { requestId: command.requestId } : {}),
  };
  let response: Response;
  try {
    response = await fetch(config.url + "/functions/v1/driver-trip", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.publicKey },
      body: JSON.stringify(request),
      signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]),
      cache: "no-store",
      redirect: "error",
    });
  } catch (error: unknown) {
    if (signal.aborted) throw error;
    throw new DriverTripError(
      "No pudimos confirmar la conexión. Actualiza el viaje para comprobar el cambio.",
      0,
    );
  }
  const raw: unknown = await response.json().catch((): unknown => null);
  if (!response.ok) {
    const message = typeof raw === "object" && raw !== null && "error" in raw &&
        typeof raw.error === "string"
      ? raw.error
      : "No pudimos comprobar el viaje. Intenta de nuevo.";
    throw new DriverTripError(message, response.status);
  }
  if (typeof raw !== "object" || raw === null || !("trip" in raw)) {
    throw new DriverTripError(
      "El viaje llegó incompleto. Actualiza para comprobarlo.",
      503,
    );
  }
  try {
    return parseDriverTrip(raw.trip);
  } catch {
    throw new DriverTripError(
      "No pudimos validar los datos del viaje. Actualiza para comprobarlo.",
      503,
    );
  }
}
