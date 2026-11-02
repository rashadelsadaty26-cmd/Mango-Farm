# Mango Farm implementation notes

## Upgrade: Realistic-by-default map, direct row/column editing, search, fixed header, bottom toolbar, terrain, sound

**Data safety.** No existing record, id, status, coordinate, orientation or ownership rule changed. Two *optional* farm fields were added
(`rowKeys`, `colKeys`) and are written only after a mid-grid insert / delete; a farm without them behaves exactly as before.

### Row / column editing (`src/farm/gridEdit.ts`, `ui/GridEditControls.tsx`)
* Stored cell ids are `<rowKey>-<colKey>`. Historically both were derived from the *position*, so inserting a row between rows would have
  renamed every later tree. Each physical row/column now carries a stable key (`rowKeys[i]`, `colKeys[i]`); absent = the legacy sequence
  (`getRowLabel(i)`, `i + 1`), so existing ids resolve identically and **no migration runs**.
* **Insert** creates one new key between its neighbours: no existing cell record is read, renamed or rewritten (verified: the Firestore update
  contains only `rowsCount` + `rowKeys`). Numbering (`1,2,3…`) and padded column labels (`01…010…0100`) are display-only and re-sequence automatically.
* **Remove** deletes only that line's records, after a confirmation that lists what is lost (trees / infrastructure / empty records). Custom
  landmarks beside the line are *kept* and move to the merged gutter. The last remaining row/column cannot be removed.
* `unlabeledRows/Cols`, `rowGapKinds/colGapKinds` and the landmark lattice are shifted consistently (landmarks keep their neighbours).
* Controls sit in the land's own coordinates (+ between lines, − on a line, outside the fence), scale with the map, show an exact preview band
  and apply only on confirmation. Mirroring is handled by mapping the *displayed* gap to the *logical* index. Appending to an untouched farm keeps the legacy format.
* Buttons are hidden below a minimum zoom (0.36 mouse / 0.45 touch) with an on-screen hint; the map keeps a 128 px margin so edge buttons can be panned to mid-screen.

### Search and "📍 أنا فين؟" (`farm/farmSearch.ts`, `ui/SearchPanel.tsx`, `ui/FocusOverlay.tsx`)
One parser for both. Normalises Arabic-Indic/Persian/Western digits and spelling variants; understands tree, row, column, padded column labels,
`12-07`, "between two trees", "from the start of the row to its end", saved landmark names, spray basins and drain/canal/road runs. Ambiguity →
list to choose from; nothing found → message and the camera does not move. A tree number is the *column number inside a row*, so a bare "شجرة 12" is
ambiguous by design (one per row). Midpoints use the real display coordinates and are always labelled approximate (not GPS). The highlight/marker is
screen-space overlay UI state only (dim fades in ~3 s, outline stays until cleared) and is never stored.

### Header, toolbar, layout
Phone header is `position: fixed`, slim, never hides/animates (old hide-on-scroll logic and CSS removed). It shows the farm name, a compact
view/layout switch and **المزيد** (sync, storage kind, modes, legend, sign out). The bottom-centre floating toolbar has zoom ±, fit, search,
`📍 أنا فين؟` and an overflow menu (Standard/Realistic, realistic options, legend). The map is fitted/centred/panned in the area above the toolbar
(`insetBottom`). `index.html` now declares `viewport-fit=cover`; the app root uses `100dvh`; all insets use `env(safe-area-inset-*)`.

### Realistic mode
* Default on open (no confirmation dialog); the Standard/Realistic choice is remembered per account in `localStorage` (`mango-farm-map-mode-v1:<uid>`), never Firestore.
* Quality presets: `high` (desktop), new `mobile` (same tree artwork at a smaller sprite size, DPR cap 1.5, cheaper ground) and `low`. Chosen from capabilities
  (touch/pointer, platform, memory, cores) - not screen width.
* Tree sprites, positions, statuses and labels are unchanged.
* **Fence** (`ui/FarmFence.tsx`): an SVG in the land's own padding, sized from the same constants as the CSS grid, so it is identical in both modes and follows
  row/column edits and mirroring by construction. It never covers cells, labels or roads.
* **Terrain** (`realistic/terrain.ts`): procedural dunes, hollows, ripples, four ground tones, compacted ground at the fence, sparse shrubs/grass/weeds/stones/gravel;
  deterministic per world position (no tiles, works offline), vegetation excluded from the farm and a 100-unit clearance around it.

### Mobile performance (what was actually slow)
Per-frame ground used three full-viewport pattern fills + a large image; every tree used save/translate/rotate/restore; roads and canals were re-stroked each
frame; pinch used an eased target (lag) and `getBoundingClientRect` per event. Now: cached terrain chunks (LRU, generated in idle slices, never mid-gesture);
one `setTransform` per tree; cheap detail while a gesture moves and full detail on settle; a baked bitmap for the whole-farm view; cached container rect;
direct (un-eased) two-finger pinch + pan; automatic resolution step-down (to 60 %) if gesture frames stay slow; rendering/terrain paused while the page is hidden.

### Ambient sound (`farm/sound/*`)
Optional, Farm Layout only (button + popover), plays only in Realistic mode and only after a tap. Recording path: **`public/audio/farm-ambience.mp3`**
(see `public/audio/README.txt`). Web Audio gapless loop + gain (works on iPhone); nothing is created/fetched until enabled; file availability is checked with
one HEAD request only when the settings open; a missing file (404 or SPA `index.html`) shows «ملف صوت المزرعة غير موجود بعد». Only the volume is remembered (per account, localStorage).
The service worker caches the file after the first successful download.

## Verification
`npm run verify` (dependency-free): farm rendering 22, coordinates 14, landmarks 18, orientation/viewport 20, landmark types 23, realistic 16, grid-edit 26,
search 27, sound 18, terrain/renderer 28. Optional real-browser suites live in `tools/e2e` (see its README).

---

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
