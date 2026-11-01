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
