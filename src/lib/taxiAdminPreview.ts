import { latLngToCell } from "h3-js";
import type { TaxiAdminClient } from "./taxiAdminClient";
import { record } from "../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contracts.ts";
import type {
  AdminContext,
  AdminZone,
} from "../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/adminContracts.ts";
/** DEV-only view of Pompeyo's H3 map. Credentials are synthetic; never writes. */
export function createTaxiAdminPreview(): TaxiAdminClient {
  const tenant = "11111111-1111-4111-8111-111111111111", waba = "+529630000001";
  const context: AdminContext = {
    actorId: 42,
    runtimeReady: false,
    canConfigure: true,
    tenants: [{ id: tenant, name: "Pompeyo" }],
    channels: [{
      tenantId: tenant,
      waba,
      name: "Pompeyo",
      city: "Comitán",
      enabled: false,
      dispatcher: "+529630000099",
      centerLat: 16.25,
      centerLng: -92.13,
      radiusKm: 20,
      pricingMode: "h3_zone_max",
      baseCents: null,
      perKmCents: null,
      revision: 0,
    }],
  };
  let cached: Promise<AdminZone[]> | null = null;
  const catalog = () =>
    cached ??= (async () => {
      if (!import.meta.env.DEV) {
        throw new Error(
          "La vista de zonas sólo está disponible en local.",
        );
      }
      const data: unknown =
        (await import("./fixtures/taxiH3Catalog.preview.json")).default;
      if (!Array.isArray(data)) {
        throw new Error("No pudimos leer las zonas de Pompeyo.");
      }
      const zones = data.map((z): AdminZone => {
        if (
          !record(z) || typeof z.cell !== "string" ||
          typeof z.label !== "string" || typeof z.cents !== "number"
        ) throw new Error("Celda de diseño no válida.");
        return {
          cell: z.cell,
          label: z.label,
          cents: z.cents,
          source: "base",
          assigned: true,
        };
      }).sort((a, b) => a.cell.localeCompare(b.cell));
      return zones;
    })();
  return {
    context: async () => context,
    zones: async (_tenant, _waba, q) => {
      const all = (await catalog()).filter((z) =>
        q.source === "catalog" || z.assigned
      );
      const matches = all.filter((z) =>
        (!q.cells || q.cells.includes(z.cell)) &&
        (!q.search || z.label.toLowerCase().includes(q.search.toLowerCase())) &&
        (!q.after || z.cell > q.after)
      );
      const cap = q.cells ? 500 : 100;
      return {
        zones: matches.slice(0, cap),
        hasMore: matches.length > cap,
        totalCells: all.length,
        totalAreas: new Set(all.map((z) => z.label)).size,
      };
    },
    operations: async () => ({ sessions: [], trips: [], deliveries: [] }),
    quote: async (_tenant, _waba, o, d) => {
      const zones = await catalog(),
        a = zones.find((z) =>
          z.assigned && z.cell === latLngToCell(o.lat, o.lng, 10)
        ),
        b = zones.find((z) =>
          z.assigned && z.cell === latLngToCell(d.lat, d.lng, 10)
        );
      return a && b
        ? { state: "priced", cents: Math.max(a.cents ?? 0, b.cents ?? 0) }
        : { state: "uncovered", cents: null };
    },
    apply: async () => {
      throw new Error(
        "Esta es una vista de diseño. No guarda cambios ni envía mensajes.",
      );
    },
  };
}
