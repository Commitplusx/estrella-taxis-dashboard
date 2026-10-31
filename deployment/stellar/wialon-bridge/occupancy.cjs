'use strict';
/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
/** Exact switch values only. Missing, null, boolean and unexpected values stay unknown.
 * @param {unknown} params
 * @returns {URLSearchParams}
 */
function occupancyParams(params) {
  const value = record(params) && record(params.io_3) ? params.io_3.v : undefined;
  const occupied = value === 0 || value === '0' ? true : value === 1 || value === '1' ? false : null;
  return new URLSearchParams({
    taxiAvailability: occupied === null ? 'unknown' : occupied ? 'occupied' : 'free',
    // Explicit unknown overwrites an old false even when Traccar copies position attributes.
    occupied: occupied === null ? 'unknown' : String(occupied),
  });
}
module.exports = { occupancyParams };
