# Stellar Tracking

## Platform and users
Web administration in React/TypeScript and a separate Flutter Android app. The current deployment serves Servicio de Taxis Pompeyo Express in Comitán. Administrators configure the base, GPS units, owners/drivers, shifts, zones and the WhatsApp bot. Owners and drivers have narrower personal access.

## Product truth
Wialon supplies installed GPS telemetry through the existing bridge to Traccar. A taxi is one existing Traccar unit; accounts, owners and current drivers link to that unit without duplicating the vehicle. The driver in turn receives WhatsApp offers and must accept before the customer is told a taxi is assigned.

The backend owns trip state, prices, current confirmation tokens, dispatch and notifications. Customer conversation may be natural; normal booking requires a native pickup pin and the current confirmation button. The destination is optional. GPS hexagons belong to the base; written neighborhoods are a separate reference catalog. OpenStreetMap is the web map provider.

## Confirmed simulation scope
The administrator requested current GPS plus editable scenarios and clarified that this belongs in the existing Mapa en Vivo comparison tool, not another Bot tab. It must explain selection, allow changing a taxi's simulated position, availability and direction, compare against reality, and show projected offer rounds with restrained animations. Simulation must not create trips, apply hypothetical changes to shifts or real GPS, or send WhatsApp. Refreshing the real telemetry uses the normal Wialon bridge. Personal accounts must not gain access to the whole fleet through this tool.

## Stack and publication
Extend the existing Mapa en Vivo and its component language. Supabase functions, database, VPS bridge, GitHub/Vercel and the Android APK publish separately. Preserve unrelated local changes. Test results, illustrative data, provider acceptance and actual delivery/read must remain distinguishable.
