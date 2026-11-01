import { RestTrackingStore } from "../_shared/tracking/store.ts";
import { createDriverTripHandler } from "./handler.ts";
if (import.meta.main) {
  const store = new RestTrackingStore(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  Deno.serve(createDriverTripHandler(store));
}
