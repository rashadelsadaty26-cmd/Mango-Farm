const assert = require('node:assert/strict');
const { launch, openApp, wav, check, summary } = require('./lib.cjs');
const audio = (page) => page.evaluate(() => window.__audioLog);
async function enterEdit(page) { await page.getByText('تخطيط المزرعة', { exact: true }).first().click(); await page.waitForSelector('[data-testid=sound-control]'); }
const state = (page) => page.locator('[data-testid=sound-state]').innerText();

(async () => {
  const b = await launch();
  // ---------- file missing ----------
  let { page, errors } = await openApp(b, { audio: null });
  await page.waitForTimeout(1000);
  await check('nothing audio-related happens at startup (no AudioContext, no request for the file)', async () => {
    const a = await audio(page); assert.equal(a.contexts, 0); assert.deepEqual(a.fetches, []);
  });
  await enterEdit(page);
  await check('the sound control lives in Farm Layout, is compact, and shows its state (off by default)', async () => {
    assert.equal(await page.locator('.farm-map-canvas [data-testid=sound-control]').count(), 0, 'not over the map');
    assert.match(await state(page), /متوقف/);
    const bb = await page.locator('[data-testid=sound-button]').boundingBox(); assert.ok(bb.height <= 44 && bb.width < 260, `${bb.width}x${bb.height}`);
    const a = await audio(page); assert.equal(a.contexts, 0);
  });
  await check('opening the settings looks for the file with ONE tiny HEAD request and shows the Arabic "missing" message', async () => {
    await page.locator('[data-testid=sound-button]').click();
    await page.waitForTimeout(500);
    assert.match(await page.locator('[data-testid=sound-file-state]').innerText(), /ملف صوت المزرعة غير موجود بعد/);
    const a = await audio(page); assert.deepEqual(a.fetches.map((f) => f.method), ['HEAD']); assert.equal(a.contexts, 0);
    const help = await page.locator('[data-testid=sound-popover]').innerText();
    assert.match(help, /public\/audio\/farm-ambience\.mp3/); assert.match(help, /MP3/);
    assert.ok(await page.locator('[data-testid=sound-volume]').isVisible());
    assert.match(await page.locator('[data-testid=sound-toggle]').innerText(), /🔊 تشغيل صوت المزرعة/);
  });
  await check('enabling with no file fails safely: message shown, nothing plays, the map still works', async () => {
    await page.locator('[data-testid=sound-toggle]').click(); await page.waitForTimeout(600);
    assert.match(await page.locator('[data-testid=sound-file-state]').innerText(), /غير موجود/);
    assert.match(await state(page), /متوقف/);
    await page.keyboard.press('Escape');
    await page.locator('[data-testid=zoom-in]').click(); await page.waitForTimeout(300);
    const real = errors.filter((e) => !/Failed to load resource/.test(e));
    assert.equal(real.length, 0, real.join('\n'));
  });
  await page.context().close();

  // ---------- SPA host answers missing files with index.html (200 text/html) ----------
  ({ page, errors } = await openApp(b, { audio: { status: 200, type: 'text/html', body: Buffer.from('<html>app</html>') } }));
  await enterEdit(page); await page.locator('[data-testid=sound-button]').click(); await page.waitForTimeout(500);
  await check('a 200 text/html answer (SPA fallback) is treated as missing, not as audio', async () => {
    assert.match(await page.locator('[data-testid=sound-file-state]').innerText(), /غير موجود/);
  });
  await page.context().close();

  // ---------- file present ----------
  ({ page, errors } = await openApp(b, { audio: { status: 200, type: 'audio/wav', body: wav() } }));
  await page.waitForTimeout(800); await enterEdit(page);
  await page.locator('[data-testid=sound-button]').click(); await page.waitForTimeout(500);
  await check('file present: availability shown, still nothing loaded or decoded', async () => {
    assert.match(await page.locator('[data-testid=sound-file-state]').innerText(), /ملف الصوت موجود/);
    const a = await audio(page); assert.equal(a.contexts, 0); assert.ok(a.fetches.every((f) => f.method === 'HEAD'));
  });
  await check('an explicit tap starts the sound: label flips to "إيقاف", state "يعمل", ONE context, ONE download', async () => {
    await page.locator('[data-testid=sound-toggle]').click(); await page.waitForTimeout(1200);
    assert.match(await page.locator('[data-testid=sound-toggle]').innerText(), /🔇 إيقاف صوت المزرعة/);
    assert.match(await state(page), /يعمل/);
    const a = await audio(page); assert.equal(a.contexts, 1); assert.equal(a.fetches.filter((f) => f.method === 'GET').length, 1);
  });
  await check('zoom, pan and quality changes do not restart or reload the sound', async () => {
    await page.keyboard.press('Escape');
    for (let i = 0; i < 4; i++) { await page.locator('[data-testid=zoom-in]').click(); await page.waitForTimeout(150); }
    await page.mouse.move(600, 400); await page.mouse.down(); await page.mouse.move(500, 350, { steps: 5 }); await page.mouse.up();
    await page.locator('[data-testid=zoom-reset]').click(); await page.waitForTimeout(300);
    const a = await audio(page); assert.equal(a.contexts, 1); assert.equal(a.fetches.filter((f) => f.method === 'GET').length, 1);
    assert.match(await state(page), /يعمل/);
  });
  await check('volume slider is remembered for THIS account only (never Firestore)', async () => {
    await page.locator('[data-testid=sound-button]').click();
    await page.locator('[data-testid=sound-volume]').fill('25'); await page.waitForTimeout(150);
    assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('mango-farm-sound-v1:u1'))), { volume: 0.25 });
    assert.equal(await page.evaluate(() => window.__fsWrites.length), 0);
  });
  await check('switching to Standard pauses it ("waiting"), returning to Realistic resumes without a new download', async () => {
    await page.keyboard.press('Escape');
    await page.locator('[data-testid=toolbar-more]').click(); await page.locator('[data-testid=toggle-realistic]').click(); await page.waitForTimeout(800);
    assert.match(await state(page), /مفعّل/);
    await page.locator('[data-testid=toolbar-more]').click(); await page.locator('[data-testid=toggle-realistic]').click(); await page.waitForTimeout(2500);
    assert.match(await state(page), /يعمل/);
    const a = await audio(page); assert.equal(a.contexts, 1); assert.equal(a.fetches.filter((f) => f.method === 'GET').length, 1);
  });
  await check('disabling stops it; enabling again reuses the decoded audio (no second download)', async () => {
    await page.locator('[data-testid=sound-button]').click();
    await page.locator('[data-testid=sound-toggle]').click(); await page.waitForTimeout(400);
    assert.match(await state(page), /متوقف/);
    await page.locator('[data-testid=sound-toggle]').click(); await page.waitForTimeout(1000);
    assert.match(await state(page), /يعمل/);
    const a = await audio(page); assert.equal(a.fetches.filter((f) => f.method === 'GET').length, 1);
  });
  await check('the sound control is usable on a phone (no clipping, one-hand reachable)', async () => {
    await page.setViewportSize({ width: 360, height: 740 }); await page.waitForTimeout(400);
    const pop = await page.locator('[data-testid=sound-popover]').boundingBox();
    if (pop) { assert.ok(pop.x >= 0 && pop.x + pop.width <= 360, `popover ${pop.x}..${pop.x + pop.width}`); }
  });
  console.log('page errors:', JSON.stringify(errors));
  await page.context().close();

  // ---------- fresh load never auto-plays even if the volume was remembered ----------
  ({ page, errors } = await openApp(b, { audio: { status: 200, type: 'audio/wav', body: wav() }, localStorage: { 'mango-farm-sound-v1:u1': JSON.stringify({ volume: 0.8 }) } }));
  await enterEdit(page); await page.waitForTimeout(800);
  await check('a reload never auto-plays: sound is off, nothing created, remembered volume is restored', async () => {
    assert.match(await state(page), /متوقف/);
    const a = await audio(page); assert.equal(a.contexts, 0); assert.deepEqual(a.fetches, []);
    await page.locator('[data-testid=sound-button]').click();
    assert.equal(await page.locator('[data-testid=sound-volume]').inputValue(), '80');
  });
  await b.close();
  process.exit(summary() ? 1 : 0);
})();
