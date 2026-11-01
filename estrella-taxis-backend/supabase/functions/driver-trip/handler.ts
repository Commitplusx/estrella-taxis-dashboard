import type { TrackingStore } from "../_shared/tracking/store.ts";
import { record, TrackingError, uuid } from "../_shared/tracking/contracts.ts";
import { readJson } from "../_shared/tracking/http.ts";
import {
  DRIVER_TRIP_TOKEN,
  parseDriverTrip,
} from "../_shared/bot/taxis/driverTripContracts.ts";
const origin = "https://stellar.estrella-eats.mx";
const headers = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "content-type, apikey, authorization, x-client-info",
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Vary": "Origin",
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
function result(raw: unknown) {
  if (!record(raw) || typeof raw.state !== "string") {
    throw new TrackingError(
      503,
      "driver_trip_unavailable",
      "No pudimos comprobar el viaje. Intenta de nuevo.",
    );
  }
  if (raw.state !== "ready") {
    const states: Record<string, [number, string]> = {
      not_found: [404, "Este enlace no corresponde a un viaje disponible."],
      expired: [
        410,
        "Este enlace ya venció o cambió el chofer. Pide ayuda a la base.",
      ],
      paused: [
        409,
        "La base pausó las acciones de este viaje. Contacta a la base.",
      ],
      request_conflict: [
        409,
        "La solicitud cambió. Actualiza el viaje antes de continuar.",
      ],
      trip_changed: [
        409,
        "El viaje cambió. Actualiza para comprobar su estado.",
      ],
    };
    const known = states[raw.state];
    throw new TrackingError(
      known?.[0] ?? 503,
      known ? raw.state : "driver_trip_unavailable",
      known?.[1] ?? "No pudimos comprobar el cambio. Actualiza el viaje.",
    );
  }
  return { tenantId: uuid(raw.tenantId), trip: parseDriverTrip(raw.trip) };
}
export function createDriverTripHandler(
  store: Pick<TrackingStore, "rpc" | "read">,
) {
  return async (req: Request): Promise<Response> => {
    try {
      const suppliedOrigin = req.headers.get("Origin");
      if (suppliedOrigin && suppliedOrigin !== origin) {
        return response({
          code: "origin_forbidden",
          error: "Abre el enlace desde el mensaje del viaje.",
        }, 403);
      }
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers });
      }
      if (req.method !== "POST") {
        return response({
          code: "method_not_allowed",
          error: "Usa el botón del viaje.",
        }, 405);
      }
      if (
        !req.headers.get("Content-Type")?.toLowerCase().startsWith(
          "application/json",
        )
      ) {
        return response({
          code: "invalid_content_type",
          error: "Solicitud no válida.",
        }, 415);
      }
      const body = await readJson(req, 2048);
      if (
        !record(body) || typeof body.token !== "string" ||
        !DRIVER_TRIP_TOKEN.test(body.token) ||
        !["read", "arrive", "finish"].includes(String(body.action))
      ) {
        return response({
          code: "invalid_request",
          error: "Abre de nuevo el enlace del viaje.",
        }, 400);
      }
      const keys = body.action === "read"
        ? "action,token"
        : "action,requestId,token";
      if (Object.keys(body).sort().join(",") !== keys) {
        return response({
          code: "invalid_request",
          error: "Solicitud no válida.",
        }, 400);
      }
      const request = body.action === "read" ? null : uuid(body.requestId);
      const current = result(
        await store.rpc("taxi_driver_trip_read", { p_token: body.token }),
      );
      const companies = await store.read(
        "empresas",
        new URLSearchParams({
          select:
            "id,activo,tipo_negocio,paquete:paquetes(activo,incluye_whatsapp)",
          id: "eq." + current.tenantId,
          limit: "1",
        }),
      );
      const company = companies[0],
        plan = record(company) ? company.paquete : null;
      if (
        companies.length !== 1 || !record(company) ||
        company.id !== current.tenantId || company.activo !== true ||
        company.tipo_negocio !== "taxi" || !record(plan) ||
        plan.activo !== true || plan.incluye_whatsapp !== true
      ) {
        return response({
          code: "driver_trip_paused",
          error: "La base debe revisar este viaje. Contacta a la base.",
        }, 403);
      }
      const view = body.action === "read" ? current : result(
        await store.rpc("taxi_driver_trip_apply", {
          p_token: body.token,
          p_request: request,
          p_action: body.action,
        }),
      );
      if (view.tenantId !== current.tenantId) {
        throw new Error("Driver trip scope changed");
      }
      return response({ trip: view.trip });
    } catch (error: unknown) {
      if (error instanceof TrackingError) {
        return response(
          { code: error.code, error: error.message },
          error.status,
        );
      }
      return response({
        code: "driver_trip_unavailable",
        error: "No pudimos comprobar el viaje. Intenta de nuevo.",
      }, 503);
    }
  };
}
