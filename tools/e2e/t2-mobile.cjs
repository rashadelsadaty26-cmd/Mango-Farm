const assert = require('node:assert/strict');
const { launch, openApp, check, summary } = require('./lib.cjs');

const rect = (page, sel) => page.locator(sel).first().evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right }; });
const view = (page) => page.evaluate(() => { const el = document.querySelector('.farm-land').parentElement; const m = /matrix\(([^)]+)\)|translate3d\(([^)]*)\)\s*scale\(([^)]*)\)|translate\(([^)]*)\)\s*scale\(([^)]*)\)/.exec(el.style.transform || ''); return { t: el.style.transform }; });
async function pinch(page, cx, cy, d0, d1, steps = 8) {
  const cdp = await page.context().newCDPSession(page);
  const pts = (d) => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(d0) });
  for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d0 + (d1 - d0) * i / steps) }); await page.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function swipe(page, x0, y0, x1, y1, steps = 10) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps }] }); await page.waitForTimeout(12); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const scaleOf = (page) => page.evaluate(() => { const el = document.querySelector('.farm-land').parentElement; const t = el.style.transform; const m = /scale\(([-\d.e]+)\)/.exec(t); return m ? Number(m[1]) : NaN; });

(async () => {
  const b = await launch();
  const { page, errors } = await openApp(b, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, dpr: 3 });
  await page.waitForTimeout(1200);

  await check('phone layout uses the fixed compact header (no collapsing wrapper, no handle)', async () => {
    assert.equal(await page.locator('[data-testid=mobile-header]').count(), 1);
    assert.equal(await page.locator('.farm-header-collapse, .farm-header-handle').count(), 0);
    const pos = await page.locator('[data-testid=mobile-header]').evaluate((e) => getComputedStyle(e).position);
    assert.equal(pos, 'fixed');
    const r = await rect(page, '[data-testid=mobile-header]');
    assert.equal(r.y, 0); assert.ok(r.h >= 44 && r.h <= 60, `height ${r.h}`);
  });
  await check('header shows the farm name and a المزيد button; it is slim', async () => {
    assert.match(await page.locator('.farm-mheader-title').innerText(), /مزرعة/);
    assert.ok(await page.locator('[data-testid=more-menu-button]').isVisible());
  });
  await check('the header never moves: touch swipes, pinch and wheel on the map leave its rectangle unchanged', async () => {
    const before = await rect(page, '[data-testid=mobile-header]');
    await swipe(page, 200, 500, 200, 250);
    await swipe(page, 200, 300, 200, 600);
    await swipe(page, 300, 500, 80, 500);
    await pinch(page, 195, 450, 80, 220);
    await page.mouse.move(200, 400); await page.mouse.wheel(0, 600); await page.waitForTimeout(250);
    const after = await rect(page, '[data-testid=mobile-header]');
    assert.deepEqual(after, before);
    assert.equal(await page.evaluate(() => window.scrollY), 0, 'the page itself did not scroll');
  });
  await check('المزيد contains every previous header action (sync, storage kind, modes, legend, sign out) and sign-out works', async () => {
    await page.locator('[data-testid=more-menu-button]').tap();
    const menu = page.locator('[data-testid=more-menu]');
    assert.ok(await menu.isVisible());
    const text = await menu.innerText();
    for (const t of ['تمت المزامنة', 'سحابي', 'الإدارة والبيانات', 'تخطيط المزرعة', 'دليل الألوان', 'تسجيل الخروج']) assert.ok(text.includes(t), `missing "${t}" in menu: ${text}`);
    const r = await menu.evaluate((e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, b: b.bottom }; });
    assert.ok(r.l >= 0 && r.r <= 390 && r.b <= 844, 'menu not clipped by the viewport');
    await page.locator('[data-testid=logout-button]').tap();
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__signOutCalls), 1);
  });
  await b.close();
  const { page: p2 } = await (async () => { const o = await openApp(await launch(), { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, dpr: 3 }); return o; })();
  await p2.waitForTimeout(1200);

  await check('bottom toolbar is centred at the bottom, above the safe area, and below the header', async () => {
    const r = await rect(p2, '[data-testid=map-toolbar]');
    assert.ok(Math.abs(r.x + r.w / 2 - 195) <= 2, `centre ${r.x + r.w / 2}`);
    assert.ok(r.b <= 844 - 8 && r.b >= 844 - 40, `bottom gap ${844 - r.b}`);
    assert.ok(r.w <= 380, `width ${r.w}`);
    assert.ok(r.y > 100);
    const h = await rect(p2, '[data-testid=mobile-header]');
    assert.ok(r.y > h.b);
  });
  await check('toolbar buttons have >= 40px touch targets and Arabic accessible names', async () => {
    const btns = p2.locator('[data-testid=map-toolbar] button');
    const n = await btns.count();
    assert.ok(n >= 6);
    for (let i = 0; i < n; i++) {
      const bb = await btns.nth(i).boundingBox();
      assert.ok(bb.width >= 40 && bb.height >= 40, `button ${i} ${bb.width}x${bb.height}`);
      const label = await btns.nth(i).getAttribute('aria-label');
      assert.match(label, /[\u0600-\u06FF]/, `button ${i} label ${label}`);
    }
    assert.match(await p2.locator('[data-testid=open-where]').innerText(), /📍 أنا فين؟/);
  });
  await check('the initial view does not put the toolbar over the last row of trees', async () => {
    const bar = await rect(p2, '[data-testid=map-toolbar]');
    const bottomCell = await p2.evaluate(() => { let max = 0; document.querySelectorAll('[data-cell-id]').forEach((e) => { const r = e.getBoundingClientRect(); if (r.height > 0) max = Math.max(max, r.bottom); }); return max; });
    assert.ok(bottomCell <= bar.y + 1, `lowest cell ${bottomCell} vs toolbar top ${bar.y}`);
  });
  await check('real two-finger pinch zooms the map, in and out, and the farm cannot be lost', async () => {
    await p2.locator('[data-testid=zoom-reset]').tap(); await p2.waitForTimeout(200);
    const s0 = await scaleOf(p2);
    await pinch(p2, 195, 450, 60, 240); await p2.waitForTimeout(250);
    const s1 = await scaleOf(p2);
    assert.ok(s1 > s0 * 1.5, `zoom in ${s0} -> ${s1}`);
    for (let i = 0; i < 4; i++) await pinch(p2, 195, 450, 260, 40);
    await p2.waitForTimeout(250);
    const s2 = await scaleOf(p2);
    assert.ok(s2 < s1 && s2 >= 0.15 - 1e-6, `zoom out ${s2}`);
    const land = await rect(p2, '.farm-land');
    assert.ok(land.r > 0 && land.x < 390 && land.b > 46 && land.y < 844, 'the land is still on screen');
  });
  await check('one-finger drag pans, and the toolbar stays exactly where it was', async () => {
    const bar0 = await rect(p2, '[data-testid=map-toolbar]');
    await p2.locator('[data-testid=zoom-reset]').tap();
    await pinch(p2, 195, 450, 60, 200);
    const l0 = await rect(p2, '.farm-land');
    await swipe(p2, 250, 500, 150, 420);
    const l1 = await rect(p2, '.farm-land');
    assert.ok(Math.abs(l1.x - l0.x) > 20, 'the land moved');
    assert.deepEqual(await rect(p2, '[data-testid=map-toolbar]'), bar0);
  });
  await check('there is no page scroll / overscroll while gesturing (touch-action on the map)', async () => {
    const ta = await p2.locator('.farm-map-canvas').first().evaluate((e) => getComputedStyle(e).touchAction);
    assert.equal(ta, 'none');
    assert.equal(await p2.evaluate(() => document.scrollingElement.scrollTop), 0);
  });
  await check('narrow (320px) and wide (820px) screens keep the toolbar inside the viewport and centred', async () => {
    for (const w of [320, 820]) {
      await p2.setViewportSize({ width: w, height: 700 }); await p2.waitForTimeout(400);
      const r = await rect(p2, '[data-testid=map-toolbar]');
      assert.ok(r.x >= 0 && r.r <= w + 0.5, `${w}: ${r.x}..${r.r}`);
      assert.ok(Math.abs(r.x + r.w / 2 - w / 2) <= 2, `${w}: centre ${r.x + r.w / 2}`);
    }
  });
  console.log('page errors:', JSON.stringify(errors));
  const bad = summary();
  process.exit(bad ? 1 : 0);
})();
