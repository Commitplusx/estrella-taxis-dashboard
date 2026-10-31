---
version: 1
slug: "src-pages-mappage-tsx"
primary_target: "src/pages/MapPage.tsx"
related_targets: ["src/components/FleetSimulationPanel.tsx","src/components/TaxiSimulationPanel.tsx","src/components/taxiSimulation.css"]
---

# Dispatch simulation in Mapa en Vivo

Mode: Operate. User corrected the placement to the EXISTING live map comparison button and supplied its screenshot. Preserve the established white/gray/blue fleet map and sidebar. No separate Bot tab. This supersedes the earlier component brief.

## Direction contract

THESIS: Explain why a nearby taxi is or is not eligible, in the existing map where the administrator already works.

OWN-WORLD: Inherit the live OpenStreetMap canvas, existing vehicle symbols, Lucide toolbar and restrained white admin controls. Text explains availability; green on a GPS marker is not dispatch eligibility.

STORY: Open the existing comparison tool, mark origin/destination on the SAME map, run the shared server selector, inspect reasons for every unit, change a hypothetical condition, and compare before/after. No real offers or trip mutations.

FIRST VIEWPORT: Keep the map visible next to a scrollable right drawer on desktop; mobile uses a bottom sheet leaving the map above. Compact close and run controls remain reachable while scrolling; mobile navigation stays suppressed until the tool closes. The explicit simulation notice explains the action. No duplicate map inside the drawer.

FORM: Code-led extension of the existing map feature; no new visual world or comp. The existing screenshot supplied by the user is placement authority, not a reproduction target.

FINISH: Verify desktop/mobile and actual user width. Animated candidate lines last fewer than ten seconds and respect reduced motion. Show the production GPS snapshot time, before/after and actual exclusion reasons. Review and document the final map integration.
