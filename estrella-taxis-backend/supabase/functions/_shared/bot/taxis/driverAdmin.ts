import { positiveId, record, TrackingError } from '../../tracking/contracts.ts';
export interface BotDriver {
  deviceId: number; name: string; phone: string; active: boolean; version: string;
}
export interface DriverSetup {
  drivers: BotDriver[]; units: { id: number; name: string }[]; activeCount: number; zoneCount: number;
}
export function parseBotDriver(value: unknown): BotDriver {
  if (!record(value) || !positiveId(value.deviceId) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120 ||
    typeof value.phone !== 'string' || !/^\+[1-9][0-9]{7,14}$/.test(value.phone) || typeof value.active !== 'boolean' ||
    typeof value.version !== 'string' || !/^[a-f0-9]{32}$/.test(value.version)) {
    throw new TrackingError(502, 'invalid_driver', 'No pudimos comprobar los datos del conductor.');
  }
  return { deviceId: value.deviceId, name: value.name, phone: value.phone, active: value.active, version: value.version };
}
export function parseDriverSetup(value: unknown): DriverSetup {
  if (!record(value) || !Array.isArray(value.drivers) || value.drivers.length > 500 || !Array.isArray(value.units) || value.units.length > 10000 ||
    typeof value.activeCount !== 'number' || !Number.isSafeInteger(value.activeCount) || value.activeCount < 0 ||
    typeof value.zoneCount !== 'number' || !Number.isSafeInteger(value.zoneCount) || value.zoneCount < 0) throw new Error('No pudimos cargar los conductores de esta base.');
  const drivers = value.drivers.map(parseBotDriver);
  const units = value.units.map((unit: unknown) => {
    if (!record(unit) || !positiveId(unit.id) || typeof unit.name !== 'string' || !unit.name.trim() || unit.name.length > 120) throw new Error('No pudimos comprobar una unidad de Traccar.');
    return { id: unit.id, name: unit.name };
  });
  if (new Set(drivers.map(d => d.deviceId)).size !== drivers.length || new Set(units.map(d => d.id)).size !== units.length) throw new Error('La lista contiene unidades repetidas.');
  return { drivers, units, activeCount: value.activeCount, zoneCount: value.zoneCount };
}
