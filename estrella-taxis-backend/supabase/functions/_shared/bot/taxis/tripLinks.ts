const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const customerToken = new RegExp("^(?:[a-f0-9]{32}|" + uuid + ")$");
export function validTripUrlButton(title: unknown, url: unknown): boolean {
  if (typeof url !== "string") return false;
  if (title === "Ver mi viaje") {
    return /^https:\/\/stellar\.estrella-eats\.mx\/driver-trip#[a-f0-9]{64}$/
      .test(url);
  }
  return title === "Ver viaje en vivo" &&
    url.startsWith("https://stellar.estrella-eats.mx/track/") &&
    customerToken.test(
      url.slice("https://stellar.estrella-eats.mx/track/".length),
    );
}
export function validTripUrlCategory(title: unknown, key: unknown): boolean {
  if (title !== "Ver mi viaje" && title !== "Ver viaje en vivo") return false;
  return typeof key === "string" &&
    new RegExp(
      "^" + (title === "Ver mi viaje" ? "driver-assigned:" : "trip-assigned:") +
        uuid + "$",
    ).test(key);
}
