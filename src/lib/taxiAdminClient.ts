import { trackingCall } from "./trackingClient";
import {
  type AdminCommand,
  type AdminContext,
  type OperationsPage,
  parseContext,
  parseOperations,
  parseZones,
  type ZonePage,
} from "../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/adminContracts.ts";
import { record } from "../../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts";
export interface TaxiAdminClient {
  context: (signal?: AbortSignal) => Promise<AdminContext>;
  zones: (
    tenantId: string,
    waba: string,
    query: {
      source?: "base" | "catalog";
      cells?: string[];
      search?: string;
      after?: string;
    },
    signal?: AbortSignal,
  ) => Promise<ZonePage>;
  operations: (
    tenantId: string,
    waba: string,
    customer?: string,
    signal?: AbortSignal,
  ) => Promise<OperationsPage>;
  quote: (
    tenantId: string,
    waba: string,
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number },
  ) => Promise<{ state: string; cents: number | null }>;
  apply: (
    command: AdminCommand,
  ) => Promise<{ state: "saved" | "queued"; revision: number }>;
}
export const taxiAdminClient: TaxiAdminClient = {
  context: async (signal) =>
    parseContext(
      await trackingCall("taxi-bot-admin", { action: "context" }, signal),
    ),
  zones: async (tenantId, waba, query, signal) =>
    parseZones(
      await trackingCall("taxi-bot-admin", {
        action: "zones",
        tenantId,
        waba,
        ...query,
      }, signal),
    ),
  operations: async (tenantId, waba, customer, signal) =>
    parseOperations(
      await trackingCall("taxi-bot-admin", {
        action: "operations",
        tenantId,
        waba,
        ...(customer ? { customer } : {}),
      }, signal),
    ),
  quote: async (tenantId, waba, origin, destination) => {
    const q = await trackingCall("taxi-bot-admin", {
      action: "quote",
      tenantId,
      waba,
      origin,
      destination,
    });
    if (
      !record(q) ||
      ![
        "priced",
        "uncovered",
        "invalid_zone",
        "channel_unavailable",
        "outside_service_area",
      ].includes(String(q.state)) ||
      (q.state === "priced" &&
        (typeof q.cents !== "number" || !Number.isSafeInteger(q.cents) ||
          q.cents <= 0))
    ) throw new Error("No pudimos comprobar el precio.");
    return {
      state: String(q.state),
      cents: q.state === "priced" ? Number(q.cents) : null,
    };
  },
  apply: async (command) => {
    const q = await trackingCall("taxi-bot-admin", { ...command });
    if (
      !record(q) || (q.state !== "saved" && q.state !== "queued") ||
      typeof q.revision !== "number" || !Number.isSafeInteger(q.revision)
    ) throw new Error("No se confirmó el guardado.");
    return { state: q.state, revision: q.revision };
  },
};
