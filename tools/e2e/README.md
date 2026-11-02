# Browser tests (optional, dev-only)

These Playwright suites drive the **real** `src/App.tsx` in headless Chromium. They are not part of `npm run verify` (which is
dependency-free); they need `esbuild` and `playwright` (+ a Chromium build) and are not wired into `package.json`.

```sh
npm i -D esbuild playwright && npx playwright install chromium
./tools/e2e/build.sh                 # bundles App.tsx with in-memory Firebase + icon stubs
node tools/e2e/t1-smoke.cjs          # ... t2-mobile, t3-search, t4-grid, t5-sound, t6-accounts, t7-soak, t8-realinput
```

* Firebase is replaced by an in-memory Firestore that records every write in `window.__fsWrites`, so tests can assert exactly what
  was (not) sent. Real Firebase security rules, real offline persistence and the service worker are **not** exercised.
* Tailwind is not needed: `make-css.cjs` shims the few utilities the page skeleton uses. Pixel-level styling of pre-existing,
  Tailwind-styled screens is therefore not what these tests judge; the new UI is plain CSS and is.
* Headless Chromium is not an iPhone: touch input is real (CDP touch events) but WebKit, iOS safe areas, the iOS audio session
  and GPU behaviour are not covered.
