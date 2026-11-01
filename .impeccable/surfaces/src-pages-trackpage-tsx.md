---
version: 1
slug: "src-pages-trackpage-tsx"
primary_target: "src/pages/TrackPage.tsx"
related_targets: ["src/components/CustomerTripMap.tsx","src/pages/customerTrip.css"]
---

# Customer taxi tracking

Mode: Operate. Extend Stellar's established white/blue/OSM interface. User supplied screenshots of a Google watermark, driver name presented as the unit, and stale GPS mislabeled as missing pickup.

THESIS: Show the configured taxi number and its last known location without confusing the passenger about where they are being collected.

OWN-WORLD: Real OpenStreetMap streets, blue taxi and green pickup, calm Spanish,18px body, large controls, separate driver identity. No Google Maps dependency or external Google links on this page.

STORY: Customer receives one native "Ver viaje en vivo" button after driver acceptance, opens the existing private tracking route, follows the assigned unit, and can read the pickup/destination or open an OSM point.

FIRST VIEWPORT: Header and friendly trip title, map with readable follow/refresh controls. Desktop pairs map and details; mobile puts the map first. Unit and driver are distinct. Last GPS time is explicit; no invented arrival estimate from stale data.

FORM: Existing-product code extension, no new visual world or comp.5-second polling while visible, no overlapping reads, bounded network timeout, last known data on failure, GPS hidden at terminal state, no route or ETA fabrication.

FINISH: Synthetic desktop1280/mobile390 screenshots reviewed; ship, no material findings. Minor wrapped map labels and small redundant zero-signal icon are not design rules. Browser tests cover stale/fresh signal, connection failure/recovery and stopped polling on completion, with no Google links or overflow. Incumbent global design files preserved.
