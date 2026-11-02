const assert = require('node:assert/strict');
const { launch, openApp, check, summary } = require('./lib.cjs');
const LET = ['أ','ب','ت','ث','ج','ح','خ','د','ذ','ر','ز','س','ش','ص','ض','ط','ظ','ع','غ','ف','ق','ك','ل','م','ن','هـ','و','ي','أأ','أب'];
const farm = (uid) => { const cells = {}; for (let r = 0; r < 30; r++) for (let c = 1; c <= 60; c++) cells[`${LET[r]}-${c}`] = { type: 'tree', lastUpdated: 'x', status: 'سليمة' }; return { ownerUid: uid, cells, rowsCount: 30, colsCount: 60, unlabeledRows: [], unlabeledCols: [], rowGapKinds: {}, colGapKinds: {}, landmarks: {}, landmarkTypes: {}, mapOrientation: 'original' }; };
(async () => {
  const b = await launch();
  const { page, errors, ctx } = await openApp(b, { farm: farm('u1'), viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, dpr: 3, cores: 6 });
  await page.waitForTimeout(2500);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return (await cdp.send('Runtime.getHeapUsage')).usedSize / 1e6; };
  const listeners = async () => (await cdp.send('Runtime.evaluate', { expression: 'document.getElementsByTagName("*").length' })).result.value;
  const cycle = async () => {
    for (let i = 0; i < 20; i++) { await page.mouse.move(195, 420); await page.mouse.wheel(0, -120); await page.waitForTimeout(20); }
    for (let i = 0; i < 25; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(20); }
    await page.mouse.down(); for (let i = 0; i < 20; i++) { await page.mouse.move(195 - i * 4, 420 - i * 2); await page.waitForTimeout(16); } await page.mouse.up();
    await page.locator('[data-testid=toolbar-more]').click(); await page.locator('[data-testid=toggle-realistic]').click(); await page.waitForTimeout(500);
    await page.locator('[data-testid=toolbar-more]').click(); await page.locator('[data-testid=toggle-realistic]').click(); await page.waitForTimeout(2500);
    await page.locator('[data-testid=zoom-reset]').click(); await page.waitForTimeout(200);
  };
  const samples = []; const nodes = [];
  for (let k = 0; k < 7; k++) { await cycle(); samples.push(await heap()); nodes.push(await listeners()); }
  console.log('heap MB after each cycle:', samples.map((x) => x.toFixed(1)).join(' '), '| DOM nodes:', nodes.join(' '));
  await check('repeated pan / zoom / Standard<->Realistic switching: JS heap does not keep growing', async () => {
    assert.ok(samples[6] < samples[2] * 1.25 + 3, `cycle3 ${samples[2].toFixed(1)} -> cycle7 ${samples[6].toFixed(1)}`);
  });
  await check('DOM node count is stable (no leaked elements)', async () => {
    assert.ok(Math.max(...nodes.slice(2)) - Math.min(...nodes.slice(2)) <= 40, nodes.join(','));
  });
  await check('no errors during the soak and the farm is still intact', async () => {
    assert.deepEqual(errors, []);
    assert.equal(await page.locator('[data-cell-id]').count(), 1800);
    assert.equal(await page.evaluate(() => window.__fsWrites.length), 0);
    assert.equal(await page.locator('canvas.farm-realistic-canvas').count(), 1, 'exactly one realistic canvas');
  });
  await b.close();
  process.exit(summary() ? 1 : 0);
})();
