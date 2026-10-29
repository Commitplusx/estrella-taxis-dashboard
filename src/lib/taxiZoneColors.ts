import { gridDisk } from "h3-js";
import type { AdminZone } from "../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/adminContracts.ts";

const palette = ["#d97706", "#7c3aed", "#0891b2", "#e11d48", "#65a30d", "#2563eb", "#ea580c", "#c026d3", "#0d9488", "#b45309", "#475569", "#be123c"];
function labelHash(label: string): number {
  let hash = 2166136261;
  for (const character of label) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export function zoneColor(label: string, colors: ReadonlyMap<string, string>): string {
  return colors.get(label) ?? palette[labelHash(label) % palette.length];
}

/** Give neighboring zones different colors; repeated names always share their color. */
export function buildZoneColors(zones: readonly AdminZone[]): ReadonlyMap<string, string> {
  const byCell = new Map(zones.map((zone) => [zone.cell, zone.label]));
  const neighbors = new Map<string, Set<string>>();
  for (const zone of zones) {
    let adjacent = neighbors.get(zone.label);
    if (!adjacent) { adjacent = new Set(); neighbors.set(zone.label, adjacent); }
    for (const cell of gridDisk(zone.cell, 1)) {
      const label = byCell.get(cell);
      if (label !== undefined && label !== zone.label) adjacent.add(label);
    }
  }
  const names = [...neighbors.keys()].sort((a, b) =>
    (neighbors.get(b)?.size ?? 0) - (neighbors.get(a)?.size ?? 0) || a.localeCompare(b, "es"));
  const colors = new Map<string, string>();
  for (const name of names) {
    const used = new Set([...neighbors.get(name) ?? []].map((other) => colors.get(other)));
    const offset = labelHash(name) % palette.length;
    const available = palette.map((_, index) => palette[(offset + index) % palette.length]).find((color) => !used.has(color));
    // A disconnected named area may touch more regions than a planar coloring bound.
    colors.set(name, available ?? `hsl(${labelHash(name) % 360} 68% 42%)`);
  }
  return colors;
}
