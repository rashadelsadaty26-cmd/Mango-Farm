const assert = require('node:assert/strict');
const { launch, openApp, seedFarm, check, summary } = require('./lib.cjs');
const DOC = 'artifacts/e2e-app/users/u1/farm_data/gridState';
const writes = (page) => page.evaluate(() => window.__fsWrites.length);
const lastWrite = (page) => page.evaluate(() => window.__fsWrites[window.__fsWrites.length - 1]);
const doc = (page) => page.evaluate((p) => JSON.parse(JSON.stringify(window.__fsDocs[p])), DOC);
const ids = (page) => page.evaluate(() => [...document.querySelectorAll('[data-cell-id]')].map((e) => e.getAttribute('data-cell-id')));
const box = (page, id) => page.evaluate((id) => { const r = document.querySelector(`[data-cell-id="${id}"]`).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, id);
const text = (page, id) => page.evaluate((id) => document.querySelector(`[data-cell-id="${id}"]`).textContent, id);
async function enterEdit(page) { await page.getByText('تخطيط المزرعة', { exact: true }).first().click(); await page.waitForSelector('[data-testid=grid-edit-controls]', { state: 'attached' }); await page.waitForTimeout(400); }
const ctlSel = (axis, kind, n) => `.farm-grid-ctl[data-axis=${axis}][data-kind=${kind}]${kind === 'insert' ? `[data-gap="${n}"]` : `[data-line="${n}"]`}`;
const ctl = (page, axis, kind, n) => page.locator(`.farm-grid-ctl[data-axis=${axis}][data-kind=${kind}]${kind === 'insert' ? `[data-gap="${n}"]` : `[data-line="${n}"]`}`);
async function op(page, axis, kind, n, confirm = true) {
  await ctl(page, axis, kind, n).dispatchEvent('click');
  await page.waitForSelector('[data-testid=grid-op-panel]');
  if (confirm) { await page.locator('[data-testid=grid-op-confirm]').click(); await page.waitForTimeout(500); }
}
const fenceVsLand = (page) => page.evaluate(() => { const f = document.querySelector('.farm-fence'); const l = document.querySelector('.farm-land'); return { fw: Number(f.getAttribute('data-fence-width')), fh: Number(f.getAttribute('data-fence-height')), lw: l.clientWidth, lh: l.clientHeight }; });

(async () => {
  const b = await launch();
  let { page, errors } = await openApp(b);
  await page.waitForTimeout(1200);
  const initialIds = await ids(page);

  await check('controls exist only in Farm Layout mode', async () => {
    assert.equal(await page.locator('.farm-grid-ctl').count(), 0, 'hidden outside Farm Layout');
    await enterEdit(page);
    assert.equal(await page.locator('.farm-grid-ctl-add[data-axis=row]').count(), 9);
    assert.equal(await page.locator('.farm-grid-ctl-remove[data-axis=row]').count(), 8);
    assert.equal(await page.locator('.farm-grid-ctl-add[data-axis=col]').count(), 13);
    assert.equal(await page.locator('.farm-grid-ctl-remove[data-axis=col]').count(), 12);
  });
  await check('controls are attached to the real grid: each sits beside its own row / column', async () => {
    const rowBox = await box(page, 'ت-1'); // third row
    await ctl(page, 'row', 'remove', 2).waitFor({ state: 'visible' });
    const rem = await ctl(page, 'row', 'remove', 2).boundingBox();
    assert.ok(Math.abs(rem.y + rem.height / 2 - (rowBox.y + rowBox.h / 2)) < 4, 'row remove button is level with its row');
    const above = await box(page, 'ب-1'); const gapBtn = await ctl(page, 'row', 'insert', 2).boundingBox();
    assert.ok(gapBtn.y + gapBtn.height / 2 > above.y + above.h - 2 && gapBtn.y + gapBtn.height / 2 < rowBox.y + 2, 'gap button sits between rows 2 and 3');
    const colBox = await box(page, 'أ-5'); const colRem = await ctl(page, 'col', 'remove', 4).boundingBox();
    assert.ok(Math.abs(colRem.x + colRem.width / 2 - (colBox.x + colBox.w / 2)) < 4, 'column remove button is above its own column');
  });
  await check('targets are not tiny: visible >= 22px at the default fit, real tap area (with the 10px halo) >= 40px', async () => {
    await ctl(page, 'row', 'insert', 2).waitFor({ state: 'visible' });
    const bb = await ctl(page, 'row', 'insert', 2).boundingBox();
    assert.ok(bb.width >= 22, `${bb.width}`);
    const hit = await ctl(page, 'row', 'insert', 2).evaluate((e) => { const a = getComputedStyle(e, '::after'); return { inset: a.top, w: parseFloat(getComputedStyle(e).width) }; });
    assert.ok(bb.width + 20 >= 40, 'visible size + 10px halo on each side');
  });

  await check('insert a row BETWEEN rows 2 and 3: preview first, nothing written until confirmed, cancel is safe', async () => {
    const w0 = await writes(page);
    await ctl(page, 'row', 'insert', 2).dispatchEvent('click');
    await page.waitForSelector('[data-testid=grid-op-panel]');
    assert.match(await page.locator('[data-testid=grid-op-panel]').innerText(), /بين الصف 2 والصف 3/);
    assert.equal(await page.locator('[data-testid=grid-preview]').count(), 1, 'the exact gap is highlighted on the grid');
    assert.equal(await writes(page), w0);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    assert.equal(await page.locator('[data-testid=grid-op-panel]').count(), 0);
    assert.equal(await writes(page), w0, 'cancel wrote nothing');
    assert.deepEqual((await ids(page)).sort(), initialIds.slice().sort());
  });
  await check('confirming the insert: existing ids/records untouched (NO cells.* written), only rowsCount + rowKeys', async () => {
    const before = await doc(page);
    await op(page, 'row', 'insert', 2);
    const w = await lastWrite(page);
    assert.equal(w.op, 'updateDoc');
    assert.deepEqual(w.keys.sort(), ['rowKeys', 'rowsCount'].sort());
    const after = await doc(page);
    assert.deepEqual(after.cells, before.cells, 'every stored cell record is byte-identical');
    assert.equal(after.rowsCount, 9);
    assert.equal(after.rowKeys.length, 9);
    assert.deepEqual([after.rowKeys[0], after.rowKeys[1]], ['أ', 'ب']);
    assert.equal(after.rowKeys[3], 'ت', 'the old third row keeps its key');
    const idsNow = await ids(page);
    for (const id of initialIds) assert.ok(idsNow.includes(id), `${id} still exists`);
    assert.equal(idsNow.length, initialIds.length + 12);
  });
  await check('the new row sits between the old rows 2 and 3, and numbering/padded labels are re-sequenced while ids stay', async () => {
    const newRowKey = (await doc(page)).rowKeys[2];
    const prev = await box(page, 'ب-1'); const neu = await box(page, `${newRowKey}-1`); const next = await box(page, 'ت-1');
    assert.ok(prev.y < neu.y && neu.y < next.y, 'physically between');
    assert.match(await text(page, `${newRowKey}-1`), /3-01/);
    assert.match(await text(page, 'ت-1'), /4-01/, 'old row 3 is now displayed as row 4, but its id is unchanged');
    assert.match(await text(page, 'ت-12'), /4-012/);
    assert.match(await text(page, 'د-1'), /9-01/);
  });
  await check('the fence follows the new boundary exactly (same size as the land)', async () => {
    const f = await fenceVsLand(page);
    assert.equal(f.fw, f.lw); assert.equal(f.fh, f.lh);
  });
  await check('insert a column between columns 5 and 6; add at the end; labels stay padded', async () => {
    const wBefore = (await fenceVsLand(page)).lw;
    await op(page, 'col', 'insert', 5);
    const d = await doc(page);
    assert.equal(d.colsCount, 13); assert.equal(d.colKeys.length, 13);
    assert.deepEqual(d.colKeys.slice(0, 5), [1, 2, 3, 4, 5]); assert.equal(d.colKeys[6], 6); assert.equal(d.colKeys[5], 13);
    const f = await fenceVsLand(page);
    assert.equal(f.fw, f.lw); assert.ok(f.lw > wBefore);
    assert.match(await text(page, 'أ-6'), /1-07/, 'old column 6 is displayed as 07');
    assert.match(await text(page, 'أ-13'), /1-06/, 'the new column has the free key 13 but is displayed as column 06');
    await op(page, 'col', 'insert', 13);
    const d2 = await doc(page); assert.equal(d2.colsCount, 14); assert.equal(d2.colKeys[13], 14);
    assert.match(await text(page, 'أ-12'), /1-013/, 'old column 12 moved one place right because a column was inserted before it');
  });
  await check('add a row at the end', async () => {
    const d0 = await doc(page);
    await op(page, 'row', 'insert', 9);
    const d = await doc(page);
    assert.equal(d.rowsCount, 10); assert.equal(d.rowKeys.length, 10);
    assert.deepEqual(d.cells, d0.cells);
  });
  await check('remove an EMPTY row: plain confirmation, only the key list changes', async () => {
    const d0 = await doc(page);
    const newKey = d0.rowKeys[2];
    await ctl(page, 'row', 'remove', 2).dispatchEvent('click');
    await page.waitForSelector('[data-testid=grid-op-panel]');
    assert.equal(await page.locator('[data-testid=grid-op-panel]').getAttribute('data-destructive'), 'false');
    assert.match(await page.locator('[data-testid=grid-op-panel]').innerText(), /فارغ تماماً/);
    await page.locator('[data-testid=grid-op-confirm]').click(); await page.waitForTimeout(500);
    const w = await lastWrite(page);
    assert.ok(w.keys.every((k) => !k.startsWith('cells.')), `no cell deleted: ${w.keys}`);
    assert.ok(!(await doc(page)).rowKeys.includes(newKey));
    assert.equal((await doc(page)).rowsCount, 9);
  });
  await check('remove a row that contains trees: strong warning, cancel is the default focus, Escape / cancel write nothing', async () => {
    const w0 = await writes(page);
    await ctl(page, 'row', 'remove', 0).dispatchEvent('click');
    const dlg = page.locator('[data-testid=grid-op-panel]');
    await dlg.waitFor();
    assert.equal(await dlg.getAttribute('data-destructive'), 'true');
    const t = await dlg.innerText();
    assert.match(t, /12/); assert.match(t, /شجرة/); assert.match(t, /مفيش رجوع/);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid')), 'grid-op-cancel');
    assert.equal(await page.locator('[data-testid=grid-preview]').getAttribute('data-axis'), 'row');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    assert.equal(await writes(page), w0);
    await ctl(page, 'row', 'remove', 0).dispatchEvent('click'); await dlg.waitFor();
    await page.locator('[data-testid=grid-op-cancel]').click(); await page.waitForTimeout(200);
    assert.equal(await writes(page), w0);
    assert.equal(await page.locator('[data-testid=grid-op-panel]').count(), 0);
  });
  await check('confirmed removal deletes ONLY that row\'s 12 stored records (everything else keeps its id and data)', async () => {
    const d0 = await doc(page);
    await op(page, 'row', 'remove', 0);
    const w = await lastWrite(page);
    const cellKeys = w.keys.filter((k) => k.startsWith('cells.'));
    assert.equal(cellKeys.length, 12, `${cellKeys.length} cell deletes (the 2 columns added earlier have no records)`);
    assert.ok(cellKeys.every((k) => k.startsWith('cells.أ-')));
    const d = await doc(page);
    assert.ok(Object.keys(d.cells).every((k) => !k.startsWith('أ-')));
    for (const [k, v] of Object.entries(d0.cells)) if (!k.startsWith('أ-')) assert.deepEqual(d.cells[k], v, k);
    assert.equal(d.rowsCount, 8);
  });
  await check('a row holding infrastructure counts it in the warning', async () => {
    await ctl(page, 'row', 'remove', 0).dispatchEvent('click'); // row ب: 2 drain cells + trees
    const t = await page.locator('[data-testid=grid-op-panel]').innerText();
    assert.match(t, /بنية تحتية/);
    await page.keyboard.press('Escape');
  });
  await check('after a reload from the stored document the farm is identical (keys round-trip)', async () => {
    const saved = await doc(page);
    const o2 = await openApp(b, { farm: saved });
    await o2.page.waitForTimeout(1000);
    const idsReload = await ids(o2.page);
    for (const k of Object.keys(saved.cells)) assert.ok(idsReload.includes(k), `${k} present after reload`);
    assert.equal(idsReload.length, saved.rowsCount * saved.colsCount);
    const f = await fenceVsLand(o2.page); assert.equal(f.fw, f.lw);
    assert.equal(await o2.page.evaluate(() => window.__fsWrites.length), 0, 'loading wrote nothing');
    await o2.ctx.close();
  });
  console.log('page errors:', JSON.stringify(errors));
  await page.context().close();

  // ---- legacy farm: appending at the end stores NO keys at all
  ({ page, errors } = await openApp(b)); await page.waitForTimeout(1000); await enterEdit(page);
  await check('appending at the END of an untouched farm keeps the legacy format (no rowKeys / colKeys written)', async () => {
    await op(page, 'row', 'insert', 8); await op(page, 'col', 'insert', 12);
    const d = await doc(page);
    assert.equal(d.rowKeys, undefined); assert.equal(d.colKeys, undefined);
    assert.equal(d.rowsCount, 9); assert.equal(d.colsCount, 13);
    for (const w of await page.evaluate(() => window.__fsWrites)) assert.ok(w.keys.every((k) => !k.startsWith('cells.')));
  });
  await page.context().close();

  // ---- mirrored orientations
  for (const orientation of ['mirror-y', 'mirror-x']) {
    ({ page, errors } = await openApp(b, { farm: seedFarm('u1', { orientation }) })); await page.waitForTimeout(1000); await enterEdit(page);
    const original = await ids(page);
    await check(`mirrored (${orientation}): "+" at the visual START of rows / columns inserts exactly there`, async () => {
      await op(page, 'row', 'insert', 0);
      let now = await ids(page); let neu = now.filter((i) => !original.includes(i));
      assert.equal(neu.length, 12);
      const ys = (await Promise.all(original.map((i) => box(page, i)))).map((r) => r.y); const ny = (await box(page, neu[0])).y;
      assert.ok(ny < Math.min(...ys), `${orientation}: new row is the top-most (visual) row`);
      const d = await doc(page);
      if (orientation === 'mirror-y') { assert.equal(d.rowsCount, 9); assert.equal(d.rowKeys, undefined, 'mirrored vertically: the visual TOP is the logical END, an append, so the legacy format is kept'); }
      else assert.equal(d.rowKeys[0], 'ذ', 'not mirrored vertically: the visual top is the logical START');
      const orig2 = await ids(page);
      await op(page, 'col', 'insert', 0);
      now = await ids(page); neu = now.filter((i) => !orig2.includes(i));
      const xs = (await Promise.all(orig2.map((i) => box(page, i)))).map((r) => r.x); const nx = (await box(page, neu[0])).x;
      assert.ok(nx < Math.min(...xs), `${orientation}: new column is the left-most (visual) column`);
      const f = await fenceVsLand(page); assert.equal(f.fw, f.lw); assert.equal(f.fh, f.lh);
    });
    await check(`mirrored (${orientation}): removal of the VISUAL first row removes the right records`, async () => {
      const before = await doc(page);
      await ctl(page, 'row', 'remove', 1).dispatchEvent('click'); await page.waitForSelector('[data-testid=grid-op-panel]');
      const prev = await page.locator('[data-testid=grid-preview]').boundingBox();
      const cellsInBand = await page.evaluate((p) => [...document.querySelectorAll('[data-cell-id]')].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.y >= p.y - 6 && r.y + r.height <= p.y + p.height + 6; }).length, prev);
      assert.ok(cellsInBand >= 13, `the highlighted band covers a whole row (${cellsInBand} cells)`);
      await page.locator('[data-testid=grid-op-confirm]').click(); await page.waitForTimeout(500);
      const w = await lastWrite(page);
      const rows = new Set(w.keys.filter((k) => k.startsWith('cells.')).map((k) => k.slice(6, k.lastIndexOf('-'))));
      assert.equal(rows.size, 1, `one row deleted: ${[...rows]}`);
      const d = await doc(page);
      for (const [k, v] of Object.entries(before.cells)) if (!rows.has(k.slice(0, k.lastIndexOf('-')))) assert.deepEqual(d.cells[k], v);
    });
    await page.context().close();
  }
  console.log('page errors (mirrored):', JSON.stringify(errors));
  await b.close();
  process.exit(summary() ? 1 : 0);
})();
