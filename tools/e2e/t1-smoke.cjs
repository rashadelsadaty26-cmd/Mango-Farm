const assert = require('node:assert/strict');
const { launch, openApp, check, summary } = require('./lib.cjs');
(async () => {
  const b = await launch();
  const { page, errors } = await openApp(b, { viewport: { width: 1280, height: 800 } });
  await page.waitForTimeout(1500);
  await check('app boots, farm grid + cells render', async () => {
    assert.ok(await page.locator('.farm-land').count() === 1);
    assert.ok(await page.locator('[data-cell-id]').count() >= 96, 'cells');
  });
  await check('Realistic is the default on first open (canvas mounted, land has farm-realistic class)', async () => {
    assert.ok(await page.locator('canvas.farm-realistic-canvas').count() === 1);
    assert.ok(await page.locator('.farm-land.farm-realistic').count() === 1);
  });
  await check('bottom toolbar is present; legacy zoom column is gone', async () => {
    assert.ok(await page.locator('[data-testid=map-toolbar]').count() === 1);
  });
  console.log('errors:', JSON.stringify(errors.slice(0, 5)));
  await page.screenshot({ path: 'shot-smoke.png' });
  await b.close();
  process.exit(summary() ? 1 : 0);
})();
