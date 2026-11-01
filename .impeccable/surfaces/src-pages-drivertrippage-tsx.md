---
version: 1
slug: "src-pages-drivertrippage-tsx"
primary_target: "src/pages/DriverTripPage.tsx"
related_targets: ["src/components/DriverTripMap.tsx","src/pages/driverTrip.css"]
---

# Accepted trip for the WhatsApp driver

Mode: Operate. Extend Stellar's existing white/blue interface and OpenStreetMap; no replacement visual world. The user requests simple controls for older drivers opening a private link from WhatsApp.

THESIS: The assigned driver sees where to collect the passenger and where to take them, then explicitly announces arrival without needing the APK or a login form.

OWN-WORLD: Existing restrained light surfaces, blue action, Lucide icons, OSM tiles, readable Spanish and large touch targets. Synthetic review data says "de prueba".

STORY: Accept native offer → WhatsApp URL button → private trip details → Ya llegué → durable customer notice → separate confirmed finalization.

FIRST VIEWPORT: Trip title, unit and passenger details, route locations and the start of the map. The one arrival control stays at the viewport bottom with scrolling clearance. Unit metadata follows the title. No unsolicited fare.

FORM: Code-led extension of the incumbent operational interface. No comp or new design system. Body18px, heading30/36px, action68px; clear focus, reduced motion and safe-area padding.

FINISH: Desktop1280/mobile390 synthetic captures inspected; both reviewer fixes resolved. Additional320px invalid-link state has no overflow. Opening never writes; confirmation survives polling; uncertain action retries preserve UUID; terminal trips hide controls. A full-page screenshot places the fixed action at the original viewport bottom. Physical WhatsApp browser behavior remains untested and cannot be forced by a URL.

Publication: candidate only. User chose to prepare publication and leave production unchanged on November1,2026. The channel release gate defaults false until database, transport, endpoint and web are verified together.
