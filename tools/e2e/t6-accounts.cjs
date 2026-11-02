const assert = require('node:assert/strict');
const { launch, openApp, seedFarm, check, summary } = require('./lib.cjs');
const ids = (page) => page.evaluate(() => [...document.querySelectorAll('[data-cell-id]')].map((e) => e.getAttribute('data-cell-id')));
const isRealistic = (page) => page.evaluate(() => !!document.querySelector('.farm-land.farm-realistic') && !!document.querySelector('canvas.farm-realistic-canvas'));

(async () => {
  const b = await launch();
  const farmA = seedFarm('u1', { rows: 8, cols: 12 });
  const farmB = seedFarm('u2', { rows: 5, cols: 6 });
  let { page, errors } = await openApp(b, { uid: 'u1', docs: { u2: farmB }, farm: farmA });
  await page.waitForTimeout(1500);

  await check('first open of an account: Realistic Mode is the default (fresh localStorage)', async () => {
    assert.ok(await isRealistic(page));
    assert.equal(await page.evaluate(() => localStorage.getItem('mango-farm-map-mode-v1:u1')), null, 'nothing stored just by opening');
  });
  await check('choosing Standard is remembered for THIS account only', async () => {
    await page.locator('[data-testid=toolbar-more]').click(); await page.locator('[data-testid=toggle-realistic]').click(); await page.waitForTimeout(600);
    assert.ok(!(await isRealistic(page)));
    assert.equal(await page.evaluate(() => localStorage.getItem('mango-farm-map-mode-v1:u1')), 'standard');
    assert.equal(await page.evaluate(() => localStorage.getItem('mango-farm-map-mode-v1:u2')), null);
  });
  await check('switching Standard <-> Realistic never changes the farm data, ids or count, and writes nothing', async () => {
    const before = (await ids(page)).sort();
    const doc0 = await page.evaluate(() => JSON.stringify(window.__fsDocs['artifacts/e2e-app/users/u1/farm_data/gridState']));
    for (let i = 0; i < 3; i++) {
      await page.locator('[data-testid=toolbar-more]').click(); await page.locator('[data-testid=toggle-realistic]').click(); await page.waitForTimeout(2200);
      assert.ok(await isRealistic(page), 'realistic on');
      assert.deepEqual((await ids(page)).sort(), before);
      await page.locator('[data-testid=toolbar-more]').click(); await page.locator('[data-testid=toggle-realistic]').click(); await page.waitForTimeout(500);
      assert.ok(!(await isRealistic(page)), 'standard on');
      assert.deepEqual((await ids(page)).sort(), before);
    }
    assert.equal(await page.evaluate(() => JSON.stringify(window.__fsDocs['artifacts/e2e-app/users/u1/farm_data/gridState'])), doc0);
    assert.equal(await page.evaluate(() => window.__fsWrites.length), 0);
  });
  await check('another account on the same device sees ITS OWN farm and ITS OWN mode default (Realistic)', async () => {
    await page.evaluate(() => window.__signIn('u2')); await page.waitForTimeout(2500);
    const idsB = await ids(page);
    assert.equal(idsB.length, 5 * 6);
    assert.ok(idsB.every((i) => ['أ', 'ب', 'ت', 'ث', 'ج'].includes(i.split('-')[0])));
    assert.ok(await isRealistic(page), 'u2 never chose Standard, so the default applies');
  });
  await check('signing back in as the first account restores THAT account\'s Standard choice and farm', async () => {
    await page.evaluate(() => window.__signIn('u1')); await page.waitForTimeout(2000);
    assert.equal((await ids(page)).length, 8 * 12);
    assert.ok(!(await isRealistic(page)));
  });
  await check('signed-out state shows no farm data', async () => {
    await page.evaluate(() => window.__signIn(null)); await page.waitForTimeout(800);
    assert.equal(await page.locator('[data-cell-id]').count(), 0);
  });
  await check('no Firestore write of any kind happened while switching accounts and modes', async () => {
    assert.equal((await page.evaluate(() => window.__fsWrites)).length, 0);
  });
  console.log('page errors:', JSON.stringify(errors));
  await page.context().close();

  // a stored "standard" preference is honoured at startup, with no Realistic canvas ever created
  ({ page, errors } = await openApp(b, { uid: 'u1', farm: farmA, localStorage: { 'mango-farm-map-mode-v1:u1': 'standard' } }));
  await page.waitForTimeout(1200);
  await check('a saved Standard preference opens Standard directly (renderer not even loaded)', async () => {
    assert.ok(!(await isRealistic(page)));
    assert.equal(await page.locator('canvas.farm-realistic-canvas').count(), 0);
  });
  await page.context().close();

  // Realistic prefs: quality defaults on a phone-like device
  ({ page } = await openApp(b, { uid: 'u1', farm: farmA, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, dpr: 3, cores: 6 }));
  await page.waitForTimeout(1500);
  await check('on a phone-class device the mobile quality preset is selected, and the canvas backing store is capped (<= 1.5x of 390 css px)', async () => {
    const w = await page.locator('canvas.farm-realistic-canvas').evaluate((c) => c.width);
    assert.ok(w <= 390 * 1.5 + 2, `canvas width ${w}`);
    await page.locator('[data-testid=toolbar-more]').click();
    await page.getByText('خيارات العرض الواقعي').click();
    const pressed = await page.locator('[role=radiogroup][aria-label="جودة العرض"] [aria-checked=true]').innerText();
    assert.match(pressed, /جوال/);
  });
  await b.close();
  process.exit(summary() ? 1 : 0);
})();
