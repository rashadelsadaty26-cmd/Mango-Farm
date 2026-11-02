const assert = require('node:assert/strict');
const { launch, openApp, seedFarm, check, summary } = require('./lib.cjs');

const LM = { lm_tap: { id: 'lm_tap', name: 'حنفية الكهرباء', icon: '🚰', kind: 'custom', position: { x: 4, y: 4 }, createdAt: '', updatedAt: '' } };
const T = (page) => page.evaluate(() => document.querySelector('.farm-land').parentElement.style.transform);
const writes = (page) => page.evaluate(() => window.__fsWrites.length);
const cellBox = (page, id) => page.evaluate((id) => { const e = document.querySelector(`[data-cell-id="${id}"]`); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; }, id);
const container = (page) => page.evaluate(() => { const r = document.querySelector('.farm-map-canvas').getBoundingClientRect(); return { x: r.x, y: r.y }; });
const markerPos = (page) => page.evaluate(() => { const p = document.querySelector('[data-testid=focus-marker] .farm-focus-pin-dot'); const r = p.getBoundingClientRect(); return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; });
const outline = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid=focus-outline]')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; }));
async function ask(page, text, mode = 'search') {
  if (!(await page.locator('[data-testid=search-panel]').count())) await page.locator(mode === 'where' ? '[data-testid=open-where]' : '[data-testid=open-search]').click();
  else await page.locator(`[data-testid=search-panel] [role=tab]`).nth(mode === 'where' ? 1 : 0).click();
  const input = page.locator('[data-testid=search-input]');
  await input.fill(text); await input.press('Enter'); await page.waitForTimeout(450);
}

(async () => {
  const b = await launch();
  const { page, errors } = await openApp(b, { farm: seedFarm('u1', { landmarks: LM }) });
  await page.waitForTimeout(1500);
  const w0 = await writes(page);

  await check('row search (Arabic digits): camera moves, outline spans exactly the row\'s cells, tree row chip shown', async () => {
    const t0 = await T(page);
    await ask(page, 'الصف ٣');
    assert.notEqual(await T(page), t0, 'camera moved');
    assert.ok(await page.locator('[data-testid=focus-overlay][data-focus-kind=row]').count());
    assert.match(await page.locator('[data-testid=focus-chip]').innerText(), /الصف 3/);
    const cells = await Promise.all(Array.from({ length: 12 }, (_, i) => cellBox(page, `ت-${i + 1}`)));
    const x0 = Math.min(...cells.map((c) => c.x)); const x1 = Math.max(...cells.map((c) => c.x + c.w)); const y0 = Math.min(...cells.map((c) => c.y)); const y1 = Math.max(...cells.map((c) => c.y + c.h));
    const [o] = await outline(page); const c = await container(page);
    assert.ok(o.x <= x0 + 1 && o.x + o.w >= x1 - 1, `outline x ${o.x}..${o.x + o.w} vs cells ${x0}..${x1}`);
    assert.ok(Math.abs(o.cy - (y0 + y1) / 2) < 10, `outline cy ${o.cy} vs ${(y0 + y1) / 2}`);
    void c;
  });
  await check('"الصف 3" and "الصف ٣" are the same result', async () => {
    const id1 = await page.locator('[data-testid=focus-overlay]').getAttribute('data-focus-id');
    await ask(page, 'الصف 3');
    assert.equal(await page.locator('[data-testid=focus-overlay]').getAttribute('data-focus-id'), id1);
  });
  await check('the rest of the map is dimmed, the dim fades out in ~3 s, and the highlight STAYS afterwards', async () => {
    await ask(page, 'الصف 2');
    const dim = page.locator('[data-testid=focus-dim]');
    const op0 = Number(await dim.evaluate((e) => getComputedStyle(e).opacity));
    assert.ok(op0 > 0.6, `dim opacity right after selecting: ${op0}`);
    await page.waitForTimeout(1500);
    const opMid = Number(await dim.evaluate((e) => getComputedStyle(e).opacity));
    assert.ok(opMid < op0 && opMid > 0, `mid-fade ${opMid}`);
    await page.waitForTimeout(2200);
    assert.ok(!(await dim.count()) || (await dim.evaluate((e) => getComputedStyle(e).display === 'none' || Number(getComputedStyle(e).opacity) === 0)), 'dim gone after ~3 s');
    assert.equal(await page.locator('[data-testid=focus-outline]').count(), 1, 'outline remains');
    assert.equal(await page.locator('[data-testid=focus-chip]').count(), 1);
  });
  await check('padded column label: "العمود ٠٥" == "العمود 05" and the title uses the stored label "05"', async () => {
    await ask(page, 'العمود ٠٥'); const a = await page.locator('[data-testid=focus-overlay]').getAttribute('data-focus-id');
    assert.match(await page.locator('[data-testid=focus-chip]').innerText(), /العمود 05/);
    await ask(page, 'العمود 05'); assert.equal(await page.locator('[data-testid=focus-overlay]').getAttribute('data-focus-id'), a);
    await ask(page, 'العمود 010'); assert.match(await page.locator('[data-testid=focus-chip]').innerText(), /العمود 010/);
  });
  await check('ambiguous tree number asks to choose; picking an option focuses exactly that tree', async () => {
    await page.locator('[data-testid=focus-clear]').click();
    await ask(page, 'شجرة ٣');
    assert.ok(await page.locator('[data-testid=search-ambiguous]').isVisible());
    const n = await page.locator('[data-testid=search-option]').count();
    assert.equal(n, 8);
    assert.equal(await page.locator('[data-testid=focus-overlay]').count(), 0, 'nothing selected until the user chooses');
    await page.locator('[data-testid=search-option]').nth(4).click();
    await page.waitForTimeout(400);
    assert.match(await page.locator('[data-testid=focus-chip]').innerText(), /5-03/);
    const tree = await cellBox(page, 'ج-3'); const [o] = await outline(page);
    assert.ok(Math.abs(o.cx - tree.cx) < 6 && Math.abs(o.cy - tree.cy) < 6, `outline ${o.cx},${o.cy} tree ${tree.cx},${tree.cy}`);
  });
  await check('nonexistent result: clear Arabic message, camera does NOT move, nothing highlighted', async () => {
    await page.locator('[data-testid=focus-clear]').click(); // clear the selection
    await page.locator('[data-testid=zoom-reset]').click(); await page.waitForTimeout(500);
    const t0 = await T(page);
    for (const q of ['الصف 99', 'العمود 0100', 'كلام ملوش وجود']) {
      await ask(page, q);
      assert.ok(await page.locator('[data-testid=search-none]').isVisible(), q);
      assert.match(await page.locator('[data-testid=search-none]').innerText(), /مفيش نتيجة|مش شجرة/);
      assert.equal(await T(page), t0, `camera moved for ${q}`);
      assert.equal(await page.locator('[data-testid=focus-overlay]').count(), 0);
    }
  });
  await check('custom landmark found by its saved name', async () => {
    await ask(page, 'عند حنفية الكهرباء');
    assert.match(await page.locator('[data-testid=focus-chip]').innerText(), /حنفية الكهرباء/);
  });
  await check('spray basin and drain are found by description', async () => {
    await ask(page, 'عند حوض الرش'); assert.match(await page.locator('[data-testid=focus-chip]').innerText(), /حوض رش/);
    await ask(page, 'عند مصرف المياه'); assert.match(await page.locator('[data-testid=focus-chip]').innerText(), /مصرف/);
  });
  await check('"أنا فين؟": between two trees puts "إنت هنا" at the midpoint of their ACTUAL positions', async () => {
    await ask(page, 'أنا واقف بين شجرة ٣ وشجرة ٤ في الصف ٢', 'where');
    assert.ok(await page.locator('[data-testid=focus-marker]').count());
    assert.match(await page.locator('[data-testid=focus-marker]').innerText(), /إنت هنا/);
    assert.match(await page.locator('[data-testid=focus-chip]').innerText(), /تقريبي/);
    const a = await cellBox(page, 'ب-3'); const bb = await cellBox(page, 'ب-4'); const m = await markerPos(page);
    assert.ok(Math.abs(m.cx - (a.cx + bb.cx) / 2) < 3 && Math.abs(m.cy - (a.cy + bb.cy) / 2) < 3, `marker ${m.cx},${m.cy} mid ${(a.cx + bb.cx) / 2},${(a.cy + bb.cy) / 2}`);
  });
  await check('the marker stays glued to the same farm spot during zoom and pan', async () => {
    const check1 = async (label) => { const a = await cellBox(page, 'ب-3'); const bb = await cellBox(page, 'ب-4'); const m = await markerPos(page); assert.ok(Math.abs(m.cx - (a.cx + bb.cx) / 2) < 3 && Math.abs(m.cy - (a.cy + bb.cy) / 2) < 3, `${label}: marker ${m.cx.toFixed(1)},${m.cy.toFixed(1)} vs ${((a.cx + bb.cx) / 2).toFixed(1)},${((a.cy + bb.cy) / 2).toFixed(1)}`); };
    await page.locator('[data-testid=zoom-in]').click(); await page.waitForTimeout(600); await check1('zoom in');
    await page.locator('[data-testid=zoom-in]').click(); await page.waitForTimeout(600); await check1('zoom in 2');
    await page.mouse.move(640, 300); await page.mouse.down(); await page.mouse.move(560, 260, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200); await check1('pan');
    await page.locator('[data-testid=zoom-out]').click(); await page.waitForTimeout(600); await check1('zoom out');
    await page.locator('[data-testid=zoom-reset]').click(); await page.waitForTimeout(600); await check1('reset');
  });
  await check('the marker survives a new search being typed and is replaced by the next result; it can be dismissed', async () => {
    await ask(page, 'أنا عند الصف ٣ والعمود ٠٥', 'where');
    assert.equal(await page.locator('[data-testid=focus-marker]').count(), 1);
    assert.match(await page.locator('[data-testid=focus-chip]').innerText(), /3-05/);
    await page.locator('[data-testid=focus-clear]').click();
    assert.equal(await page.locator('[data-testid=focus-overlay]').count(), 0);
  });
  await check('where-mode with only a row never invents a position on it', async () => {
    await ask(page, 'أنا عند الصف 3', 'where');
    assert.equal(await page.locator('[data-testid=focus-marker]').count(), 0);
    assert.match(await page.locator('[data-testid=focus-chip]').innerText(), /مكانك/);
  });
  await check('suggestions appear while typing', async () => {
    await page.locator('[data-testid=focus-clear]').click();
    await page.locator('[data-testid=open-search]').click();
    await page.locator('[data-testid=search-input]').fill('الصف');
    await page.waitForTimeout(100);
    assert.ok((await page.locator('[data-testid=search-suggestions] button').count()) >= 3);
    await page.keyboard.press('Escape'); await page.waitForTimeout(100);
    await page.keyboard.press('Escape'); await page.waitForTimeout(100);
    assert.equal(await page.locator('[data-testid=search-panel]').count(), 0, 'Escape closes suggestions then the panel');
  });
  await check('search works identically in STANDARD mode (same ids, aligned highlight and marker)', async () => {
    await page.locator('[data-testid=toolbar-more]').click();
    await page.locator('[data-testid=toggle-realistic]').click(); await page.waitForTimeout(800);
    assert.equal(await page.locator('canvas.farm-realistic-canvas').count(), 0);
    assert.equal(await page.locator('.farm-land.farm-realistic').count(), 0);
    await ask(page, 'أنا واقف بين شجرة ٣ وشجرة ٤ في الصف ٢', 'where');
    const a = await cellBox(page, 'ب-3'); const bb = await cellBox(page, 'ب-4'); const m = await markerPos(page);
    assert.ok(Math.abs(m.cx - (a.cx + bb.cx) / 2) < 3 && Math.abs(m.cy - (a.cy + bb.cy) / 2) < 3);
    const sel = await page.locator('[data-testid=focus-overlay]').getAttribute('data-focus-id');
    await page.locator('[data-testid=toolbar-more]').click();
    await page.locator('[data-testid=toggle-realistic]').click(); await page.waitForTimeout(2500);
    assert.equal(await page.locator('[data-testid=focus-overlay]').getAttribute('data-focus-id'), sel, 'selection survives the mode switch');
  });
  await check('NO search / highlight / marker / camera activity wrote anything to Firestore', async () => {
    assert.equal(await writes(page), w0, `writes: ${JSON.stringify(await page.evaluate(() => window.__fsWrites.map((w) => w.keys)))}`);
    const localKeys = await page.evaluate(() => Object.keys(localStorage));
    assert.ok(localKeys.every((k) => !/focus|marker|camera|search/i.test(k)), localKeys.join(','));
  });
  console.log('page errors:', JSON.stringify(errors));
  await b.close();
  process.exit(summary() ? 1 : 0);
})();
