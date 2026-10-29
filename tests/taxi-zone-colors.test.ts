import test from 'node:test';
import assert from 'node:assert/strict';
import { latLngToCell, gridDisk } from 'h3-js';
import { buildZoneColors, zoneColor } from '../src/lib/taxiZoneColors.ts';
import type { AdminZone } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/adminContracts.ts';

const cells = gridDisk(latLngToCell(16.25, -92.13, 10), 1);
const zones: AdminZone[] = cells.map((cell, index) => ({ cell, label: index < 2 ? 'Centro' : `Zona ${index}`, cents: 4500, source: 'base', assigned: true }));

test('one named zone keeps its color across its cells and price changes', () => {
  const colors = buildZoneColors(zones);
  assert.equal(zoneColor(zones[0].label, colors), zoneColor(zones[1].label, colors));
  assert.deepEqual(buildZoneColors(zones.map((zone) => ({ ...zone, cents: 8900 }))), colors);
});

test('neighboring named zones differ, independent of API row order', () => {
  const colors = buildZoneColors(zones);
  assert.deepEqual(buildZoneColors([...zones].reverse()), colors);
  for (const zone of zones) for (const neighbor of zones) {
    if (zone.label !== neighbor.label && gridDisk(zone.cell, 1).includes(neighbor.cell)) {
      assert.notEqual(zoneColor(zone.label, colors), zoneColor(neighbor.label, colors));
    }
  }
});
