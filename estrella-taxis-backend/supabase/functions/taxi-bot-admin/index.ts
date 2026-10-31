import { FleetApi } from "../_shared/tracking/auth.ts";
import { RestTrackingStore } from "../_shared/tracking/store.ts";
import { createTaxiAdminHandler } from "./handler.ts";
if (import.meta.main) {
  const fleet=new FleetApi(Deno.env.get('TRACCAR_URL')??'https://taxis.estrella-eats.mx/api');
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
    fleet,
    accountManager:signal=>fleet.jobSession(Deno.env.get('TRACCAR_EMAIL')??'',Deno.env.get('TRACCAR_PASSWORD')??'',signal),
    store: new RestTrackingStore(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    ),
    runtimeReady: Deno.env.get("TAXI_BOT_ENABLED") === "true" &&
      (Deno.env.get("TAXI_WORKER_SECRET") ?? "").length >= 32 &&
      required.every((key) => (Deno.env.get(key) ?? "").length > 0),
    neighborhoodModelKey:Deno.env.get('DEEPSEEK_API_KEY')??'',
    simulationRefresh:{url:'https://taxis.estrella-eats.mx/taxi-gps-refresh',secret:Deno.env.get('TAXI_WORKER_SECRET')??''},
  }));
}
