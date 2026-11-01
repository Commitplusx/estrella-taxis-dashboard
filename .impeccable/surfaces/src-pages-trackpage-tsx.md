---
version: 1
slug: "src-pages-trackpage-tsx"
primary_target: "src/pages/TrackPage.tsx"
related_targets: ["src/components/CustomerTripMap.tsx","src/pages/customerTrip.css"]
---

# Customer taxi tracking

Mode: Operate. Extend Stellar's established white/blue map interface using the explicitly requested Estrella Eats tracker composition. References read: Estrella Eats TrackerPage.tsx, TrackerPage.css and its surface brief. The Eats home DESIGN.md is scoped to that home; its orange brand is not applied to Stellar.

THESIS: The passenger follows the taxi here. Remove duplicate destinations and vendor-facing actions from this private tracker.

OWN-WORLD: White/ink tracker shell, Outfit from the pinned reference, Stellar blue for the taxi, green pickup, readable status and driver separate from the unit. Vendor attribution remains small in the map, never a product action.

STORY: Customer opens the existing private link, sees the assigned taxi and signal age, opens trip details when needed, and returns to the map without leaving this page. No fare, invented ETA or trip stage.

FIRST VIEWPORT: Compact white brand header. Desktop map fills remaining viewport with a 410px details panel; 450px on wide screens. Mobile map occupies the area above a 286px summary sheet. Its 44px toggle opens details and returns to the map. Title, unit/driver and signal stay readable. The private map cannot leak a route token via tile Referer.

FORM: Code-led extension, direction pinned by the user's Estrella Eats tracker reference; no generated comp or concept seed. Signature interaction: the details sheet opens within the tracker, respecting reduced motion and hiding covered map controls from keyboard navigation. Preserve five-second visible polling and terminal privacy.

FINISH: Fresh finish review: ship, no material fixes. Local browser evidence covers mobile 390x844, desktop 1280x900 and 1919x915: no external product actions, horizontal overflow or page errors; summary fits. Mobile additionally covers sheet visibility/inert controls, failure recovery and stopped terminal polling. Detector findings: none. Captures: `.impeccable/review/{mobile,mobile-details,desktop,user-1919}.png`; functional evidence: `C:/Users/Kaleb/AppData/Local/Temp/stellar-inline-tracker-browser.json`. This records the local build and is not evidence of publication or a physical moving-taxi journey.

## Implemented contract — this route only

This is an extension of the incumbent customer tracker, not a new product-wide visual system. Compared with the previous tracker, the blue taxi (`#1d4ed8`), green pickup (`#167347`), white surfaces, Spanish status language and separate unit/driver identity remain. The viewport composition, Outfit typography and lighter separators below belong only to this route. A surface brief is sufficient; no global or local DESIGN.md/sidecar is introduced. Estrella Eats remains a read-only composition reference, including its separately scoped home design.

- **Palette:** White shell, ink (`#1d1d1f`), muted text (`#646469`) and dividers (`#e8e8ed`). Stellar blue identifies taxi/brand/focus; green (`#246a52`) identifies pickup and healthy signal copy. Amber warning copy/surfaces remain semantic (`#75500f` / `#fff2db`). Real OSM tiles retain their own cartography.
- **Type:** Self-hosted Outfit variable, weight range 100–900, `font-display: swap`; body 16px/1.5. Trip title is 30px/700/1.15, 26px on mobile and 23px on short mobile screens. Unit is 21px/650, 20px on mobile, with tabular figures. Driver copy is 14px desktop/13px mobile; signal title is 14px/500 desktop/13px mobile. The license, source and font hash live in `public/fonts/outfit/{README.md,OFL.txt}`. Do not change typography elsewhere to match this route.
- **Layout:** Shell uses `100dvh`; header is 74px desktop, 64px mobile and 56px on short mobile screens. The desktop panel is 410px, becoming 450px at 1450px; summary/body use 28px insets, then 32px on wide screens. At 767px and below, the collapsed sheet is 286px plus the bottom safe area, with 22px content insets. At heights of 600px and below it is 244px plus the safe area. The map fills the remaining area. Expanded details have their own bounded scroll area.
- **Shape and depth:** Dividers separate summary, pickup and destination instead of nested cards. Buttons, unit icon and warning surfaces use 10px corners; the mobile sheet has 20px top corners and a single upward shadow (`0 -6px 22px #1d1d1f12`). Do not generalize this sheet silhouette or shadow to other Stellar screens.
- **Interaction:** Controls have a 44px minimum height; focus uses a 3px Stellar-blue outline with 3px offset. Button background transitions last 160ms; the sheet transforms over 420ms with `cubic-bezier(.16,1,.3,1)`. Both transitions are removed for reduced motion. Closed mobile details are hidden; expanded mobile details hide the map visually and set its region `inert`/`aria-hidden` so covered controls cannot receive focus.

**The In-Page Tracking Rule.** Follow, recenter, refresh and read trip details inside this tracker. There is no external taxi/pickup OSM action or vendor button. The small OSM copyright attribution remains linked in the map; it is provider attribution, not a destination action. Tile requests use `strict-origin` referrers to avoid disclosing the private route token.

**The Observed State Rule.** Present the server's unit, driver, pickup, destination and signal age; add no fare, ETA or inferred trip stage. Preserve visible-only five-second polling, no overlapping reads, last-known-data error recovery and removal of live GPS at terminal states.

Not canonized: no material defects were reported in the fresh finish review; prior wrapped-label/zero-signal notes remain historical observations, not reusable design rules. Global product/design files, the Eats project and publication evidence are outside this documentation change.
