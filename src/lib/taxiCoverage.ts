import type { TaxiAdminClient } from "./taxiAdminClient";
import type { AdminZone } from "../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/adminContracts.ts";

/** Read the existing cursor API once per scope, rather than dropping cells outside the viewport. */
export async function loadTaxiCoverage(
  client: Pick<TaxiAdminClient, "zones">,
  tenantId: string,
  waba: string,
  source: "base" | "catalog",
  signal: AbortSignal,
  onProgress: (loaded: number, total: number) => void,
): Promise<AdminZone[]> {
  const zones: AdminZone[] = [];
  let after: string | undefined;
  let total: number | undefined;
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    signal.throwIfAborted();
    const page = await client.zones(tenantId, waba, { source, ...(after ? { after } : {}) }, signal);
    signal.throwIfAborted();
    if (page.totalCells > 10000) {
      throw new Error("La cobertura supera 10,000 celdas. Hace falta dividir el mapa antes de cargarlo completo.");
    }
    if (total !== undefined && total !== page.totalCells) {
      throw new Error("Las zonas cambiaron durante la carga. Pulsa Actualizar para verlas completas.");
    }
    total = page.totalCells;
    for (const zone of page.zones) {
      if (after && zone.cell <= after) throw new Error("No pudimos completar el mapa: la página de zonas se repitió.");
      zones.push(zone);
      after = zone.cell;
    }
    if (zones.length > total || zones.length > 10000) throw new Error("El total de zonas no coincide. Pulsa Actualizar.");
    onProgress(zones.length, total);
    if (!page.hasMore) {
      if (zones.length !== total) throw new Error("Faltaron zonas por cargar. Pulsa Actualizar para ver el mapa completo.");
      return zones;
    }
    if (!page.zones.length) throw new Error("No pudimos cargar la siguiente parte del mapa. Pulsa Actualizar.");
  }
  throw new Error("No pudimos completar el mapa en 100 páginas. Revisa la cobertura antes de continuar.");
}
