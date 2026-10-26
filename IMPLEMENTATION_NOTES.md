# Mango Farm implementation notes

## What changed

- Added a separate **Farm Analytics / تحليلات المزرعة** destination. It derives tree status, variety, row health, recorded disease, missing-information, timestamp, and infrastructure summaries from the active farm's existing records. Filters drive the record table and highlight matching sites on the *existing* farm map. The table supports search/sorting and CSV export; alert entries link to the existing tree details.
- Production/harvest, operations/scheduling, costs/revenue, and historical comparisons show explicit unavailable states because the existing schema inspected for this update does not provide reliable records for those categories. No sample values or speculative overdue tasks are generated.
- Centralized coordinate display remains display-only: row numbers have no leading zero, while every numbered column is shown as a literal `0` followed by the ordinary decimal number. Examples: `1-01`, `2-09`, `10-010`, `20-058`, `30-060`, `3-0100`. Unnumbered positions remain in the map and do not consume sequence numbers. Stored cell/tree IDs are not renamed.
- Added a Farm Layout spacing slider (8–48, default 28). The optional `gridGap` setting is persisted alongside the existing per-user farm state; farms without it keep the old default. Grid, infrastructure, and landmark geometry resolve the same active spacing.
- Tuned the mobile header transition to a 560 ms shared JS/CSS duration with coordinated easing and a fade, and adjusted the toggle cooldown to limit rapid restarts. Existing reduced-motion handling remains in CSS.
- Kept the existing ref-based requestAnimationFrame pan/zoom surface and tuned wheel-delta handling/zoom easing to avoid excessive frame-by-frame React state work.
- Added safeguards around ambiguous/failed farm reads so permission/network/cache failures are not treated as an empty farm eligible for automatic initialization. No Firebase rules, auth model, stored tree IDs, or farm ownership paths were intentionally changed.

## Schema limitations

The inspected current tree model supports status, variety, disease, pruning date, notes, and last-update information, alongside existing grid infrastructure. It does not provide a complete harvest ledger, operation/task history and due dates, expense/revenue ledger, or historical status snapshots. Corresponding analytics are therefore labeled unavailable rather than fabricated. If those features are needed later, they should be added as optional, backward-compatible records.

## Verification

`npm run verify` passed six dependency-free verification groups (99 checks total): farm rendering (22), coordinate formatting (14), landmarks (18), orientation/viewport (19), landmark types (23), and grid spacing (3). A TypeScript transpile/syntax scan of the TS/TSX source files also completed without parse/transpile errors.

`npm run build` could not be completed in this environment because Vite is not installed (`vite: not found`). Installing dependencies with `npm ci` did not complete in the available environment, so this is not a claim of successful production build or browser/Firebase end-to-end testing. After installing dependencies, run:

```sh
npm ci
npm run build
npm run verify
```
