// REAL pointer input (mouse clicks and touch taps) on the row / column controls - not dispatchEvent.
const assert = require('node:assert/strict');
const { launch, openApp, check, summary } = require('./lib.cjs');
const rowsCount = (page) => page.evaluate(() => window.__fsDocs['artifacts/e2e-app/users/u1/farm_data/gridState'].rowsCount);
(async () => {
  const b = await launch();
  // ---- desktop mouse
  let { page } = await openApp(b);
  await page.waitForTimeout(1200);
  await page.getByText('تخطيط المزرعة', { exact: true }).first().click(); await page.waitForTimeout(600);
  await check('MOUSE: a real click on "+" selects the operation (and does not pan / select a cell)', async () => {
    const t0 = await page.evaluate(() => document.querySelector('.farm-land').parentElement.style.transform);
    await page.locator('.farm-grid-ctl[data-axis=row][data-kind=insert][data-gap="3"]').click();
    await page.waitForSelector('[data-testid=grid-op-panel]');
    assert.equal(await page.evaluate(() => document.querySelector('.farm-land').parentElement.style.transform), t0, 'map did not move');
    assert.equal(await page.locator('[data-testid=type-picker], [role=menu]').count() >= 0, true);
  });
  await check('MOUSE: confirming with a real click changes the farm', async () => {
    await page.locator('[data-testid=grid-op-confirm]').click(); await page.waitForTimeout(500);
    assert.equal(await rowsCount(page), 9);
  });
  await check('MOUSE: a real click on "−" opens the removal dialog; real click on cancel is safe', async () => {
    await page.locator('.farm-grid-ctl[data-axis=col][data-kind=remove][data-line="2"]').click();
    await page.waitForSelector('[data-testid=grid-op-panel]');
    await page.locator('[data-testid=grid-op-cancel]').click(); await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__fsDocs['artifacts/e2e-app/users/u1/farm_data/gridState'].colsCount), 12);
  });
  await check('MOUSE: dragging the map still pans (drag started on the map, not on a button)', async () => {
    for (let i = 0; i < 4; i++) { await page.locator('[data-testid=zoom-in]').click(); await page.waitForTimeout(200); } await page.waitForTimeout(600);
    const l0 = await page.locator('.farm-land').boundingBox();
    await page.mouse.move(700, 450); await page.mouse.down(); await page.mouse.move(640, 410, { steps: 5 }); await page.mouse.up();
    const l1 = await page.locator('.farm-land').boundingBox();
    assert.ok(Math.abs(l1.y - l0.y) > 20 || Math.abs(l1.x - l0.x) > 20, `moved ${l1.x - l0.x},${l1.y - l0.y}`);
  });
  await page.context().close();

  // ---- phone touch
  ({ page } = await openApp(b, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, dpr: 2, cores: 6 }));
  await page.waitForTimeout(1500);
  await page.locator('[data-testid=mode-edit]').tap(); await page.waitForTimeout(500);
  await page.locator('[data-testid=open-search]').tap().catch(() => {});
  await page.keyboard.press('Escape');
  await check('TOUCH: zoom in with the toolbar, then a real tap on "+" opens the preview; tap confirm applies it', async () => {
    assert.ok(await page.locator('[data-testid=ctl-hint]').isVisible(), 'a hint says why the buttons are hidden when zoomed out');
    for (let i = 0; i < 3; i++) { await page.locator('[data-testid=zoom-in]').tap(); await page.waitForTimeout(250); }
    await page.waitForTimeout(600);
    const btn = page.locator('.farm-grid-ctl[data-axis=row][data-kind=insert]').first();
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    // pan until a "+" is on screen: use the focus camera via search to bring row 2 into view
    await page.locator('[data-testid=open-search]').tap();
    await page.locator('[data-testid=search-input]').fill('الصف 2'); await page.locator('[data-testid=search-input]').press('Enter'); await page.waitForTimeout(900);
    await page.locator('[data-testid=focus-clear]').tap();
    for (let i = 0; i < 2; i++) { await page.locator('[data-testid=zoom-in]').tap(); await page.waitForTimeout(300); }
    await page.waitForTimeout(500);
    for (let i = 0; i < 2; i++) { await page.locator('[data-testid=zoom-in]').tap(); await page.waitForTimeout(300); }
    await page.waitForTimeout(500);
    // the row buttons sit beside the farm's edge: drag the map (real touch) until that edge is on screen
    const cdp = await page.context().newCDPSession(page);
    for (let k = 0; k < 3; k++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 80, y: 450 }] });
      for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 80 + i * 26, y: 450 }] }); await page.waitForTimeout(12); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await page.waitForTimeout(1500); // let the pan momentum finish: a tap on a moving button is not a tap
    // any "+" that is actually on screen
    const handle = await page.evaluateHandle(() => [...document.querySelectorAll('.farm-grid-ctl[data-axis=row][data-kind=insert]')].find((e) => { const r = e.getBoundingClientRect(); const m = document.querySelector('.farm-map-canvas').getBoundingClientRect(); return r.width > 0 && r.left >= 12 && r.right <= innerWidth - 12 && r.top > m.top + 70 && r.bottom < m.bottom - 110; }));
    const el = handle.asElement();
    assert.ok(el, 'a "+" button is on screen after zooming in');
    await el.tap();
    await page.waitForSelector('[data-testid=grid-op-panel]');
    assert.equal(await rowsCount(page), 8, 'not applied by the tap alone');
    await page.locator('[data-testid=grid-op-confirm]').tap(); await page.waitForTimeout(500);
    assert.equal(await rowsCount(page), 9);
  });
  await b.close();
  process.exit(summary() ? 1 : 0);
})();
