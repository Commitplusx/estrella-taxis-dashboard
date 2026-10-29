import { FleetApi } from "../_shared/tracking/auth.ts";
import { RestTrackingStore } from "../_shared/tracking/store.ts";
import { createTaxiAdminHandler } from "./handler.ts";
if (import.meta.main) {
  const required = [
    "SUPABASE_SERVICE_ROLE_KEY",
    "TAXI_WORKER_SECRET",
    "TAXI_YCLOUD_WEBHOOK_SECRET",
    "YCLOUD_API_KEY",
    "TRACCAR_EMAIL",
    "TRACCAR_PASSWORD",
    "DEEPSEEK_API_KEY",
  ];
  Deno.serve(createTaxiAdminHandler({
    fleet: new FleetApi(
      Deno.env.get("TRACCAR_URL") ?? "https://taxis.estrella-eats.mx/api",
    ),
    store: new RestTrackingStore(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    ),
    runtimeReady: Deno.env.get("TAXI_BOT_ENABLED") === "true" &&
      (Deno.env.get("TAXI_WORKER_SECRET") ?? "").length >= 32 &&
      required.every((key) => (Deno.env.get(key) ?? "").length > 0),
  }));
}
