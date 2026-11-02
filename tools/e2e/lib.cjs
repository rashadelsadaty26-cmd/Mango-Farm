const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROW_KEYS = ['أ', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د'];
function seedFarm(uid, o = {}) {
  const rows = o.rows ?? 8, cols = o.cols ?? 12;
  const cells = {};
  for (let r = 0; r < rows; r++) for (let c = 1; c <= cols; c++) cells[`${ROW_KEYS[r]}-${c}`] = { type: 'tree', lastUpdated: '2026-01-01', variety: 'عويس', status: (r + c) % 9 === 0 ? 'مصابة بآفة/مرض' : 'سليمة' };
  cells['ب-1'] = { type: 'drainage' }; cells['ب-2'] = { type: 'drainage' };
  cells['ج-6'] = { type: 'spray_tank' };
  return { ownerUid: uid, cells, rowsCount: rows, colsCount: cols, unlabeledRows: [], unlabeledCols: [], rowGapKinds: {}, colGapKinds: {}, landmarks: o.landmarks ?? {}, landmarkTypes: {}, mapOrientation: o.orientation ?? 'original' };
}

async function launch() { return chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); }

// opts: viewport, hasTouch, isMobile, uid, farm, audio: null | {status, type, body}, docs (extra docs by uid), localStorage
async function openApp(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport ?? { width: 1280, height: 800 }, hasTouch: !!opts.hasTouch, isMobile: !!opts.isMobile, deviceScaleFactor: opts.dpr ?? 1, reducedMotion: opts.reducedMotion ?? 'no-preference' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const uid = opts.uid ?? 'u1';
  const docs = { [`artifacts/e2e-app/users/${uid}/farm_data/gridState`]: opts.farm ?? seedFarm(uid) };
  for (const [u, f] of Object.entries(opts.docs ?? {})) docs[`artifacts/e2e-app/users/${u}/farm_data/gridState`] = f;
  await page.addInitScript(({ docs, uid, ls, cores }) => {
    if (cores) Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => cores });
    window.__fsDocs = docs; window.__fsWrites = [];
    window.__authUser = { uid, displayName: uid, email: uid + '@x' };
    for (const [k, v] of Object.entries(ls || {})) localStorage.setItem(k, v);
    window.__audioLog = { contexts: 0, fetches: [] };
    const AC = window.AudioContext;
    if (AC) window.AudioContext = class extends AC { constructor(...a) { super(...a); window.__audioLog.contexts++; } };
    const f = window.fetch;
    window.fetch = (...a) => { const u = String(a[0] && a[0].url || a[0]); if (u.includes('/audio/')) window.__audioLog.fetches.push({ url: u, method: (a[1] && a[1].method) || 'GET' }); return f.apply(window, a); };
  }, { docs, uid, ls: opts.localStorage, cores: opts.cores });
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><link rel="stylesheet" href="http://app.test/app.css"></head><body><div id="root"></div><script src="http://app.test/app.bundle.js"></script></body></html>`;
  await page.route('http://app.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname === '/app.css') return route.fulfill({ contentType: 'text/css', body: fs.readFileSync(path.join(__dirname, 'app.css')) });
    if (url.pathname === '/app.bundle.js') return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(__dirname, 'app.bundle.js')) });
    if (url.pathname === '/audio/farm-ambience.mp3') {
      const a = opts.audio;
      if (!a) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
      return route.fulfill({ status: a.status ?? 200, contentType: a.type ?? 'audio/wav', body: a.body ?? Buffer.alloc(0) });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://app.test/');
  if (!opts.noWait) await page.waitForSelector('.farm-land', { timeout: 15000 });
  return { ctx, page, errors, uid };
}

// A tiny valid mono 8-bit WAV (0.25 s of a soft tone)
function wav() {
  const rate = 8000, n = 2000; const buf = Buffer.alloc(44 + n);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write('data', 36); buf.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round(20 * Math.sin(i / 8));
  return buf;
}

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + String(e.message || e).split('\n').slice(0, 4).join('\n       ')); }
}
const summary = () => { console.log(`\n${passed} passed, ${failed} failed`); return failed; };
module.exports = { launch, openApp, seedFarm, wav, check, summary, ROW_KEYS };
