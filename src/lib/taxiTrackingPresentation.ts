export function trackingPointUrl(
  lat: number | null,
  lng: number | null,
): string | null {
  if (
    lat === null || lng === null || !Number.isFinite(lat) ||
    !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180
  ) return null;
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}
export function trackingAge(time: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(time)) / 1000));
  return seconds < 60
    ? "hace unos segundos"
    : seconds < 3600
    ? `hace ${Math.floor(seconds / 60)} min`
    : `hace ${Math.floor(seconds / 3600)} h`;
}
export function trackingFresh(time: string, now: number): boolean {
  const age = now - Date.parse(time);
  return age >= -30000 && age <= 60000;
}
export function pickupText(text: string): string {
  return text.replace(
    /^Ubicación compartida\s*\([^)]*\)/i,
    "El punto que compartiste por WhatsApp",
  );
}
