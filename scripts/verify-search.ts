// Dependency-free checks for the farm search / "أنا فين؟" resolver.
// Run:  node scripts/verify-search.ts      (Node >= 22.18, or --experimental-strip-types)
import assert from 'node:assert/strict';
import {
  completions, normalizeQuery, parseColumnDigits, searchFarm, type FocusTarget, type SearchFarm, type SearchOutcome,
} from '../src/farm/farmSearch.ts';
import { buildCoordinateMap } from '../src/farm/coordinates.ts';
import { GRID, buildKindGrid } from '../src/farm/infrastructure.ts';
import { cellIdFor, insertLine, legacyColKeys, legacyRowKeys } from '../src/farm/gridEdit.ts';
import { displayCell, type MapOrientation } from '../src/farm/orientation.ts';
import { slotToPixel } from '../src/farm/landmarks.ts';
import type { FarmLandmark } from '../src/farm/landmarks.ts';

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('  ok  ' + name); };

const lm = (id: string, name: string, x: number, y: number): FarmLandmark => ({
  id, name, icon: '🚰', kind: 'custom', position: { x, y }, createdAt: '', updatedAt: '',
});

interface Opts { rows?: number; cols?: number; orientation?: MapOrientation; unlabeledRows?: number[]; unlabeledCols?: number[] }

function makeFarm(o: Opts = {}, tweak?: (cells: Record<string, any>, keys: { r: string[]; c: number[] }) => void): SearchFarm {
  const rows = o.rows ?? 30; const cols = o.cols ?? 60;
  const rowKeys = legacyRowKeys(rows); const colKeys = legacyColKeys(cols);
  const cells: Record<string, any> = {};
  for (const r of rowKeys) for (const c of colKeys) cells[cellIdFor(r, c)] = { type: 'tree', lastUpdated: 'x' };
  tweak?.(cells, { r: rowKeys, c: colKeys });
  const map = buildCoordinateMap(rows, cols, o.unlabeledRows ?? [], o.unlabeledCols ?? []);
  const rowNumbers = map.rowLabels.map((l) => (l ? Number(l) : null));
  const colNumbers = map.colLabels.map((l) => (l ? Number(l.slice(1)) : null));
  return {
    rows, cols, orientation: o.orientation ?? 'original', rowNumbers, colNumbers,
    rowLabels: map.rowLabels, colLabels: map.colLabels, rowKeys, colKeys, cells, landmarks: {},
    kindGrid: buildKindGrid(cells, rowKeys, cols, {}, {}, colKeys), coordinateAt: map.coordinateAt,
  };
}
const ok = (o: SearchOutcome): FocusTarget => { assert.equal(o.status, 'ok', JSON.stringify(o).slice(0, 200)); return (o as { target: FocusTarget }).target; };
const center = (t: FocusTarget) => ({ x: t.shapes[0].x + t.shapes[0].w / 2, y: t.shapes[0].y + t.shapes[0].h / 2 });
const treeCenter = (f: SearchFarm, r: number, c: number) => {
  const d = displayCell(r, c, f.rows, f.cols, f.orientation);
  return { x: d.col * (GRID.cellW + GRID.gap) + GRID.cellW / 2, y: d.row * (GRID.cellH + GRID.gap) + GRID.cellH / 2 };
};

console.log('Normalisation');
test('Arabic-Indic and Western digits normalise identically; spelling variants fold', () => {
  assert.equal(normalizeQuery('شجرة ١٢'), 'شجره 12');
  assert.equal(normalizeQuery('الشجرة 12'), 'الشجره 12');
  assert.equal(normalizeQuery('العمود ٠٥'), 'العمود 05');
  assert.equal(normalizeQuery('الصف٣'), 'الصف 3');
  assert.equal(normalizeQuery('  آخره،  '), 'اخره');
  assert.equal(normalizeQuery('12-07'), '12-07');
  assert.equal(normalizeQuery('١٢-٠٧'), '12-07');
});
test('column digits follow the single-zero-prefix rule', () => {
  assert.equal(parseColumnDigits('05'), 5);
  assert.equal(parseColumnDigits('058'), 58);
  assert.equal(parseColumnDigits('5'), 5);
  assert.equal(parseColumnDigits('0100'), 100);
  assert.equal(parseColumnDigits('0'), null);
  assert.equal(parseColumnDigits('00'), null);
});
test('normalising never touches the stored labels', () => {
  const f = makeFarm();
  const before = JSON.stringify([f.rowLabels, f.colLabels, f.rowKeys, f.colKeys]);
  searchFarm('العمود ٠٥', f); searchFarm('الصف ٣', f);
  assert.equal(JSON.stringify([f.rowLabels, f.colLabels, f.rowKeys, f.colKeys]), before);
  assert.equal(f.colLabels[4], '05');
});

console.log('Rows, columns, cells');
test('row search with Arabic and Western digits resolves the same row and spans the whole row', () => {
  const f = makeFarm();
  const a = ok(searchFarm('الصف ٣', f)); const b = ok(searchFarm('الصف 3', f));
  assert.equal(a.id, b.id);
  assert.equal(a.kind, 'row'); assert.equal(a.title, 'الصف 3');
  const width = 60 * (GRID.cellW + GRID.gap) - GRID.gap;
  assert.ok(a.shapes[0].w >= width && a.shapes[0].x <= 0, 'band covers first to last tree');
  assert.equal(a.shapes[0].y + 6, 2 * (GRID.cellH + GRID.gap));
  assert.equal(a.ends?.length, 2);
  assert.equal(a.subtitle, 'من 3-01 إلى 3-060');
});
test('column search uses the padded labels: ٠٥, 05, 5 -> 05 ; 058 -> 58', () => {
  const f = makeFarm();
  assert.equal(ok(searchFarm('العمود ٠٥', f)).title, 'العمود 05');
  assert.equal(ok(searchFarm('العمود 05', f)).id, ok(searchFarm('عمود 5', f)).id);
  assert.equal(ok(searchFarm('العمود 058', f)).title, 'العمود 058');
  assert.equal(ok(searchFarm('العمود 58', f)).id, ok(searchFarm('العمود 058', f)).id);
});
test('"الصف ٣ والعمود ٠٥" resolves one cell; full coordinates work in any digit system', () => {
  const f = makeFarm();
  const t = ok(searchFarm('الصف ٣ والعمود ٠٥', f));
  assert.equal(t.title, 'شجرة 3-05');
  assert.deepEqual(center(t), treeCenter(f, 2, 4));
  assert.equal(ok(searchFarm('12-07', f)).title, 'شجرة 12-07');
  assert.equal(ok(searchFarm('١٢-٠٧', f)).id, ok(searchFarm('12-07', f)).id);
  assert.equal(ok(searchFarm('شجرة 12-07', f)).title, 'شجرة 12-07');
});
test('"الشجر من أول الصف 3 لآخره" selects the full row; without a number the user must choose the row', () => {
  const f = makeFarm();
  const t = ok(searchFarm('الشجر من أول الصف ٣ لآخره', f));
  assert.equal(t.kind, 'row'); assert.equal(t.title, 'الصف 3');
  const amb = searchFarm('الشجر من أول الصف لآخره', f);
  assert.equal(amb.status, 'ambiguous');
  assert.equal((amb as any).options.length, 30);
});

console.log('Trees and midpoints');
test('a bare tree number is ambiguous (one tree per row) and every option is a real tree', () => {
  const f = makeFarm();
  const o = searchFarm('شجرة ١٢', f);
  assert.equal(o.status, 'ambiguous');
  const opts = (o as any).options;
  assert.equal(opts.length, 30);
  assert.equal(opts[0].target.title, 'شجرة 1-012');
  assert.equal(opts[29].target.title, 'شجرة 30-012');
});
test('the row narrows an ambiguous tree number to exactly one tree', () => {
  const f = makeFarm();
  const t = ok(searchFarm('الشجرة 12 في الصف 4', f));
  assert.equal(t.title, 'شجرة 4-012');
});
test('midpoint between two trees of one row = average of their ACTUAL world coordinates, flagged approximate', () => {
  const f = makeFarm();
  const t = ok(searchFarm('واقف بين شجرة ١٢ وشجرة ١٣ في الصف 5', f, 'where'));
  assert.equal(t.kind, 'between');
  const a = treeCenter(f, 4, 11); const b = treeCenter(f, 4, 12);
  assert.ok(Math.abs(t.marker!.x - (a.x + b.x) / 2) < 1e-9 && Math.abs(t.marker!.y - (a.y + b.y) / 2) < 1e-9);
  assert.equal(t.marker!.label, 'إنت هنا');
  assert.equal(t.marker!.approximate, true);
  assert.match(t.note!, /تقريبي/);
});
test('"بين الشجرة ١٢ والشجرة ١٣" without a row is ambiguous across rows, then resolved by choosing', () => {
  const f = makeFarm();
  const o = searchFarm('بين الشجرة ١٢ والشجرة ١٣', f);
  assert.equal(o.status, 'ambiguous');
  assert.equal((o as any).options.length, 30);
  const picked = (o as any).options[6].target as FocusTarget;
  const a = treeCenter(f, 6, 11); const b = treeCenter(f, 6, 12);
  assert.equal(picked.marker!.x, (a.x + b.x) / 2);
  assert.equal(picked.marker!.label, 'منتصف تقريبي');
});
test('explicit coordinates: unique result; a bare second number inherits the first tree\'s row', () => {
  const f = makeFarm();
  const t = ok(searchFarm('بين 3-012 و 3-013', f));
  assert.equal(t.title, 'بين شجرة 3-012 وشجرة 3-013');
  const t2 = ok(searchFarm('بين شجرة 3-012 و 13', f));
  assert.equal(t2.id, t.id);
});
test('trees far apart get the stronger "very approximate" note', () => {
  const f = makeFarm();
  const t = ok(searchFarm('بين 3-01 و 3-040', f));
  assert.match(t.note!, /بعيدين/);
});
test('a midpoint cannot be computed for an unknown tree: no result, no marker', () => {
  const f = makeFarm();
  const o = searchFarm('بين الشجرة 12 والشجرة 999', f);
  assert.equal(o.status, 'none');
  assert.equal(searchFarm('بين شجرة', f).status, 'none');
});
test('midpoint, row and column use DISPLAY positions for every orientation', () => {
  for (const orientation of ['original', 'mirror-x', 'mirror-y'] as const) {
    const f = makeFarm({ orientation, rows: 6, cols: 8 });
    const t = ok(searchFarm('بين 2-03 و 2-04', f));
    const a = treeCenter(f, 1, 2); const b = treeCenter(f, 1, 3);
    assert.equal(t.marker!.x, (a.x + b.x) / 2, orientation);
    assert.equal(t.marker!.y, (a.y + b.y) / 2, orientation);
    const row = ok(searchFarm('الصف 2', f));
    assert.equal(row.shapes[0].y + 6, displayCell(1, 0, 6, 8, orientation).row * (GRID.cellH + GRID.gap), orientation);
  }
});

console.log('"أنا فين" mode');
test('where-mode puts the temporary marker on the located cell; search-mode does not', () => {
  const f = makeFarm();
  const w = ok(searchFarm('أنا عند الصف ٣ والعمود ٠٥', f, 'where'));
  assert.equal(w.marker?.label, 'إنت هنا');
  assert.deepEqual({ x: w.marker!.x, y: w.marker!.y }, treeCenter(f, 2, 4));
  assert.equal(ok(searchFarm('الصف 3 والعمود 05', f, 'search')).marker, undefined);
});
test('where-mode on a bare row never invents a position on it', () => {
  const t = ok(searchFarm('أنا عند الصف 3', makeFarm(), 'where'));
  assert.equal(t.marker, undefined);
  assert.match(t.note!, /مكانك/);
});

console.log('Landmarks, basins, drains');
test('custom landmark found by its saved name; located at its lattice pixel', () => {
  const f = makeFarm();
  f.landmarks = { a: lm('a', 'حنفية الكهرباء', 2, 2), b: lm('b', 'مولد', 4, 4) };
  const t = ok(searchFarm('مولد', f));
  const p = slotToPixel({ x: 4, y: 4 });
  assert.equal(t.kind, 'landmark');
  assert.deepEqual(center(t), p);
  assert.equal(ok(searchFarm('عند الحنفية', f)).title, 'حنفية الكهرباء');
  assert.equal(ok(searchFarm('عند مولد', f, 'where')).marker?.label, 'إنت هنا');
});
test('two landmarks with the same name are ambiguous; a typed number selects one', () => {
  const f = makeFarm();
  f.landmarks = { a: lm('a', 'حنفية 1', 2, 2), b: lm('b', 'حنفية 2', 4, 2) };
  assert.equal(searchFarm('حنفية', f).status, 'ambiguous');
  assert.equal(ok(searchFarm('حنفية ٢', f)).title, 'حنفية 2');
});
test('mirrored landmarks are located where they are drawn', () => {
  const f = makeFarm({ orientation: 'mirror-x', rows: 4, cols: 6 });
  f.landmarks = { a: lm('a', 'خزان', 2, 2) };
  const t = ok(searchFarm('خزان', f));
  const p = slotToPixel({ x: 2 * 6 - 2, y: 2 });
  assert.deepEqual(center(t), p);
});
test('"عند حوض الرش" finds spray basins; several basins -> choose; none -> clear message', () => {
  const none = searchFarm('عند حوض الرش', makeFarm());
  assert.equal(none.status, 'none');
  const one = makeFarm({}, (cells, k) => { cells[cellIdFor(k.r[4], k.c[9])] = { type: 'spray_tank' }; });
  const t = ok(searchFarm('عند حوض الرش', one));
  assert.equal(t.kind, 'basin');
  assert.deepEqual(center(t), treeCenter(one, 4, 9));
  const two = makeFarm({}, (cells, k) => { cells[cellIdFor(k.r[4], k.c[9])] = { type: 'spray_tank' }; cells[cellIdFor(k.r[8], k.c[2])] = { type: 'spray_tank' }; });
  assert.equal(searchFarm('حوض الرش', two).status, 'ambiguous');
});
test('"عند مصرف المياه" groups connected drain cells into places and highlights the whole run', () => {
  const f = makeFarm({}, (cells, k) => {
    for (let c = 0; c < 10; c++) cells[cellIdFor(k.r[3], k.c[c])] = { type: 'drainage' };
    for (let r = 10; r < 14; r++) cells[cellIdFor(k.r[r], k.c[30])] = { type: 'drainage' };
  });
  const o = searchFarm('عند مصرف المياه', f);
  assert.equal(o.status, 'ambiguous');
  assert.equal((o as any).options.length, 2);
  const single = makeFarm({}, (cells, k) => { for (let c = 0; c < 10; c++) cells[cellIdFor(k.r[3], k.c[c])] = { type: 'drainage' }; });
  const t = ok(searchFarm('مصرف', single));
  assert.equal(t.kind, 'infra');
  assert.equal(t.shapes.length, 1);
  assert.ok(t.shapes[0].w > 9 * (GRID.cellW + GRID.gap));
  assert.equal(searchFarm('مصرف', makeFarm()).status, 'none');
});
test('a tree number does not resolve to an infrastructure cell', () => {
  const f = makeFarm({}, (cells, k) => { cells[cellIdFor(k.r[0], k.c[11])] = { type: 'road' }; });
  const o = searchFarm('شجرة 12', f);
  assert.equal(o.status, 'ambiguous');
  assert.equal((o as any).options.length, 29, 'the road cell is not offered as a tree');
  assert.equal(searchFarm('1-012', f).status, 'none');
});

console.log('Invalid / empty / unnumbered');
test('nonexistent targets return a clear message and no target (so the camera cannot move)', () => {
  const f = makeFarm();
  for (const q of ['الصف 99', 'العمود 0100', 'الصف 0', 'شجرة 500', 'كلام عشوائي مش موجود', '99-01', 'العمود 00']) {
    const o = searchFarm(q, f);
    assert.equal(o.status, 'none', q);
    assert.match((o as any).message, /./);
    assert.equal((o as any).target, undefined);
  }
  assert.equal(searchFarm('   ', f).status, 'empty');
  assert.equal(searchFarm('', f).status, 'empty');
});
test('unnumbered rows/columns cannot be addressed by number and numbering stays sequential', () => {
  const f = makeFarm({ rows: 5, cols: 6, unlabeledRows: [1], unlabeledCols: [2] });
  assert.equal(ok(searchFarm('الصف 2', f)).id, `row:${f.rowKeys[2]}`, 'row number 2 is the 3rd physical row');
  assert.equal(searchFarm('الصف 5', f).status, 'none');
  assert.equal(ok(searchFarm('العمود 3', f)).id, `col:${f.colKeys[3]}`);
});
test('search works after rows/columns were inserted (new keys, same ids for old trees)', () => {
  const f0 = makeFarm({ rows: 4, cols: 4 });
  const m = insertLine(insertLine({ rowKeys: f0.rowKeys, colKeys: f0.colKeys, cells: f0.cells, unlabeledRows: [], unlabeledCols: [], rowGapKinds: {}, colGapKinds: {}, landmarks: {} }, 'row', 1), 'col', 2);
  const map = buildCoordinateMap(m.rowKeys.length, m.colKeys.length, [], []);
  const f: SearchFarm = {
    ...f0, rows: m.rowKeys.length, cols: m.colKeys.length, rowKeys: m.rowKeys, colKeys: m.colKeys,
    rowLabels: map.rowLabels, colLabels: map.colLabels,
    rowNumbers: map.rowLabels.map(Number), colNumbers: map.colLabels.map((l) => Number(l.slice(1))),
    kindGrid: buildKindGrid(m.cells, m.rowKeys, m.colKeys.length, {}, {}, m.colKeys), coordinateAt: map.coordinateAt,
  };
  const t = ok(searchFarm('الصف 5 والعمود 5', f));
  assert.equal(t.title, 'شجرة 5-05');
  assert.equal(searchFarm('الصف 6', f).status, 'none');
});

console.log('Suggestions');
test('completions suggest rows / columns / names while typing and never throw', () => {
  const f = makeFarm();
  f.landmarks = { a: lm('a', 'حنفية الكهرباء', 2, 2) };
  assert.deepEqual(completions('الصف 1', f).map((c) => c.query).slice(0, 3), ['الصف 1', 'الصف 10', 'الصف 11']);
  assert.ok(completions('العمود 0', f).length > 0);
  assert.ok(completions('حنف', f).some((c) => c.label === 'حنفية الكهرباء'));
  assert.deepEqual(completions('', f), []);
  assert.doesNotThrow(() => completions('؟؟؟ ٠٠٠', f));
});

console.log(`\n${passed} search checks passed`);
