// Dependency-free checks for direct row / column editing.
// Run:  node scripts/verify-grid-edit.ts      (Node >= 22.18, or --experimental-strip-types)
import assert from 'node:assert/strict';
import {
  analyzeRemoval, cellIdFor, gapToLogicalIndex, getRowLabel, insertLine, legacyColKeys, legacyRowKeys,
  lineToLogicalIndex, nextColKey, nextRowKey, removeLine, resolveColKeys, resolveRowKeys, splitCellId,
  storableKeys, type GridModel,
} from '../src/farm/gridEdit.ts';
import { buildCoordinateMap } from '../src/farm/coordinates.ts';
import { buildKindGrid, kindAt } from '../src/farm/infrastructure.ts';
import { displayCell } from '../src/farm/orientation.ts';

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('  ok  ' + name); };

type LM = { position: { x: number; y: number }; name: string };
function farm(rows: number, cols: number): GridModel<LM> {
  const cells: Record<string, any> = {};
  const rowKeys = legacyRowKeys(rows);
  const colKeys = legacyColKeys(cols);
  for (const r of rowKeys) for (const c of colKeys) cells[cellIdFor(r, c)] = { type: 'tree', status: `s-${r}-${c}`, variety: 'عويس', lastUpdated: '2026-01-01' };
  return { rowKeys, colKeys, cells, unlabeledRows: [], unlabeledCols: [], rowGapKinds: {}, colGapKinds: {}, landmarks: {} };
}
const snapshot = (m: GridModel<LM>) => JSON.stringify(m.cells);

console.log('Keys');
test('legacy keys reproduce the historical ids (no migration for existing farms)', () => {
  assert.deepEqual(legacyRowKeys(3), ['أ', 'ب', 'ت']);
  assert.equal(getRowLabel(28), 'أأ');
  assert.deepEqual(legacyColKeys(4), [1, 2, 3, 4]);
  assert.deepEqual(resolveRowKeys(3, undefined), legacyRowKeys(3));
  assert.deepEqual(resolveColKeys(3, undefined), [1, 2, 3]);
  assert.deepEqual(storableKeys(legacyRowKeys(5), legacyColKeys(5)), { rowKeys: undefined, colKeys: undefined });
});
test('invalid stored keys (wrong length, duplicates, bad values) fall back to legacy instead of corrupting ids', () => {
  assert.deepEqual(resolveRowKeys(3, ['أ', 'ب']), legacyRowKeys(3));
  assert.deepEqual(resolveRowKeys(2, ['أ', 'أ']), legacyRowKeys(2));
  assert.deepEqual(resolveRowKeys(2, ['أ-1', 'ب']), legacyRowKeys(2));
  assert.deepEqual(resolveColKeys(3, [1, 1, 2]), [1, 2, 3]);
  assert.deepEqual(resolveColKeys(2, [0, 1]), [1, 2]);
  assert.deepEqual(resolveColKeys(3, [1, 5, 9]), [1, 5, 9]);
});
test('splitCellId round-trips and rejects malformed ids', () => {
  assert.deepEqual(splitCellId('هـ-12'), { rowKey: 'هـ', colKey: 12 });
  assert.equal(splitCellId('nodash'), null);
  assert.equal(splitCellId('أ-0'), null);
  assert.equal(splitCellId('-5'), null);
});

console.log('Insert');
test('inserting a row BETWEEN rows keeps every existing id and record byte-for-byte', () => {
  const m = farm(4, 5);
  const before = snapshot(m);
  const next = insertLine(m, 'row', 2);
  assert.equal(snapshot(next), before, 'cells object untouched');
  assert.equal(next.rowKeys.length, 5);
  assert.deepEqual(next.rowKeys.slice(0, 2), m.rowKeys.slice(0, 2));
  assert.deepEqual(next.rowKeys.slice(3), m.rowKeys.slice(2));
  assert.ok(!m.rowKeys.includes(next.rowKeys[2]), 'the new key is unused');
  assert.equal(next.cells[cellIdFor(next.rowKeys[2], 1)], undefined, 'new row starts empty');
});
test('inserting a column between columns: same guarantees, new key unique', () => {
  const m = farm(3, 4);
  const next = insertLine(m, 'col', 1);
  assert.equal(snapshot(next), snapshot(m));
  assert.deepEqual(next.colKeys, [1, 5, 2, 3, 4]);
});
test('appending (end) on an untouched farm yields exactly the legacy next key, so nothing new is stored', () => {
  const m = farm(30, 60);
  const r = insertLine(m, 'row', 30);
  const c = insertLine(m, 'col', 60);
  assert.equal(r.rowKeys[30], getRowLabel(30));
  assert.equal(c.colKeys[60], 61);
  assert.deepEqual(storableKeys(r.rowKeys, m.colKeys), { rowKeys: undefined, colKeys: undefined });
});
test('a mid-grid insert makes keys non-legacy, so they are stored; and they validate on reload', () => {
  const m = insertLine(farm(3, 3), 'row', 1);
  const stored = storableKeys(m.rowKeys, m.colKeys);
  assert.ok(stored.rowKeys);
  assert.deepEqual(resolveRowKeys(4, stored.rowKeys), m.rowKeys);
});
test('inserting at the first and last position works and bad indexes throw', () => {
  const m = farm(2, 2);
  assert.equal(insertLine(m, 'row', 0).rowKeys.length, 3);
  assert.equal(insertLine(m, 'col', 2).colKeys.length, 3);
  assert.throws(() => insertLine(m, 'row', -1), RangeError);
  assert.throws(() => insertLine(m, 'row', 3), RangeError);
  assert.throws(() => insertLine(m, 'col', 1.5), RangeError);
});
test('repeated inserts never create duplicate keys', () => {
  let m = farm(3, 3);
  for (let i = 0; i < 40; i++) { m = insertLine(m, 'row', i % (m.rowKeys.length + 1)); m = insertLine(m, 'col', i % (m.colKeys.length + 1)); }
  assert.equal(new Set(m.rowKeys).size, m.rowKeys.length);
  assert.equal(new Set(m.colKeys).size, m.colKeys.length);
  assert.equal(Object.keys(m.cells).length, 9, 'no record was added, removed or renamed');
});
test('after an insert, numbering stays sequential and the padded column labels are unchanged', () => {
  const m = insertLine(insertLine(farm(3, 11), 'row', 1), 'col', 5);
  const map = buildCoordinateMap(m.rowKeys.length, m.colKeys.length, m.unlabeledRows, m.unlabeledCols);
  assert.deepEqual(map.rowLabels, ['1', '2', '3', '4']);
  assert.equal(map.colLabels[0], '01');
  assert.equal(map.colLabels[9], '010');
  assert.equal(map.colLabels[11], '012');
  assert.equal(map.coordinateAt(3, 11), '4-012');
});
test('a tree keeps its stored id, status and data after rows/columns are inserted around it', () => {
  const m = farm(4, 6);
  const id = cellIdFor(m.rowKeys[2], m.colKeys[3]);
  const rec = m.cells[id];
  let next = insertLine(m, 'row', 0); next = insertLine(next, 'row', 3); next = insertLine(next, 'col', 2); next = insertLine(next, 'col', 7);
  assert.equal(next.cells[id], rec);
  assert.equal(next.rowKeys.indexOf(m.rowKeys[2]), 4, 'physically moved, identity unchanged');
});

console.log('Index-based settings and landmarks follow their lines');
test('unlabeled rows/columns and gap kinds shift with the physical index', () => {
  const m = { ...farm(5, 5), unlabeledRows: [1, 3], rowGapKinds: { 1: 'road', 3: 'drainage' } as Record<number, string>, unlabeledCols: [2], colGapKinds: { 2: 'gap' } as Record<number, string> };
  const r = insertLine(m, 'row', 2);
  assert.deepEqual(r.unlabeledRows, [1, 4]);
  assert.deepEqual(r.rowGapKinds, { 1: 'road', 4: 'drainage' });
  const c = insertLine(m, 'col', 2);
  assert.deepEqual(c.unlabeledCols, [3]);
  assert.deepEqual(c.colGapKinds, { 3: 'gap' });
  const noShift = insertLine(m, 'row', 5);
  assert.deepEqual(noShift.unlabeledRows, [1, 3]);
});
test('infrastructure stays attached to its cells (same kind at the same row/column keys)', () => {
  const m = farm(4, 4);
  m.cells[cellIdFor(m.rowKeys[2], m.colKeys[1])] = { type: 'water_canal' };
  const next = insertLine(m, 'row', 1);
  const grid = buildKindGrid(next.cells, next.rowKeys, next.colKeys.length, next.rowGapKinds, next.colGapKinds, next.colKeys);
  assert.equal(kindAt(grid, 3, 1), 'water');
  assert.equal(kindAt(grid, 2, 1), null);
});
test('landmarks keep their neighbours when a row is inserted (lattice y shifts past the new row)', () => {
  const m = farm(4, 4);
  m.landmarks = {
    top: { position: { x: 2, y: 0 }, name: 'top' },       // above row 0
    g1: { position: { x: 2, y: 2 }, name: 'g1' },          // between rows 0 and 1
    side: { position: { x: 2, y: 5 }, name: 'side' },      // beside row 2
    bottom: { position: { x: 4, y: 8 }, name: 'bottom' },  // below the last row
  };
  const next = insertLine(m, 'row', 2); // new row between old rows 1 and 2
  assert.deepEqual(next.landmarks.top.position, { x: 2, y: 0 });
  assert.deepEqual(next.landmarks.g1.position, { x: 2, y: 2 });
  assert.deepEqual(next.landmarks.side.position, { x: 2, y: 7 }, 'still beside the same tree row');
  assert.deepEqual(next.landmarks.bottom.position, { x: 4, y: 10 });
  const col = insertLine(m, 'col', 0);
  assert.equal(col.landmarks.g1.position.x, 4);
  assert.equal(col.landmarks.top.position.y, 0);
});

console.log('Remove');
test('analyzeRemoval counts trees, items and placeholders and flags what is destructive', () => {
  const m = farm(3, 4);
  m.cells[cellIdFor(m.rowKeys[1], 1)] = { type: 'road' };
  m.cells[cellIdFor(m.rowKeys[1], 2)] = { type: 'spray_tank' };
  m.cells[cellIdFor(m.rowKeys[1], 3)] = { type: 'tree' };
  const a = analyzeRemoval(m, 'row', 1);
  assert.deepEqual([a.trees, a.items, a.placeholders, a.records], [1, 2, 1, 4]);
  assert.equal(a.destructive, true);
  assert.equal(a.blocked, false);
  const empty = insertLine(m, 'row', 1);
  const e = analyzeRemoval(empty, 'row', 1);
  assert.deepEqual([e.records, e.destructive], [0, false]);
});
test('removing a row deletes ONLY that row\'s records; every other id and record is identical', () => {
  const m = farm(4, 5);
  const next = removeLine(m, 'row', 1);
  assert.equal(next.rowKeys.length, 3);
  for (const [id, rec] of Object.entries(m.cells)) {
    const { rowKey } = splitCellId(id)!;
    if (rowKey === m.rowKeys[1]) assert.equal(next.cells[id], undefined);
    else assert.equal(next.cells[id], rec, id);
  }
  assert.equal(Object.keys(next.cells).length, 15);
});
test('removing a column deletes only that column; input model is not mutated', () => {
  const m = farm(3, 4);
  const before = snapshot(m);
  const next = removeLine(m, 'col', 2);
  assert.equal(snapshot(m), before);
  assert.equal(Object.keys(next.cells).length, 9);
  assert.ok(Object.keys(next.cells).every((id) => splitCellId(id)!.colKey !== 3));
  assert.deepEqual(next.colKeys, [1, 2, 4]);
});
test('insert then remove of the same new line restores the original model exactly', () => {
  const m = { ...farm(4, 4), unlabeledRows: [2], rowGapKinds: { 2: 'road' } as Record<number, string>, landmarks: { a: { position: { x: 2, y: 3 }, name: 'a' }, b: { position: { x: 4, y: 6 }, name: 'b' } } };
  for (const axis of ['row', 'col'] as const) for (let i = 0; i <= 4; i++) {
    const back = removeLine(insertLine(m, axis, i), axis, i);
    assert.deepEqual(back.rowKeys, m.rowKeys);
    assert.deepEqual(back.colKeys, m.colKeys);
    assert.deepEqual(back.cells, m.cells);
    assert.deepEqual(back.unlabeledRows, m.unlabeledRows);
    assert.deepEqual(back.rowGapKinds, m.rowGapKinds);
    assert.deepEqual(back.landmarks, m.landmarks, `${axis} ${i}`);
  }
});
test('removal never deletes a landmark: those beside the removed trees move to the merged gutter', () => {
  const m = farm(3, 3);
  m.landmarks = { beside: { position: { x: 2, y: 3 }, name: 'حنفية' }, below: { position: { x: 2, y: 4 }, name: 'x' }, far: { position: { x: 2, y: 6 }, name: 'y' } };
  const impact = analyzeRemoval(m, 'row', 1);
  assert.deepEqual(impact.landmarksMoved, [{ id: 'beside', name: 'حنفية' }]);
  assert.equal(impact.destructive, true, 'a landmark in the way still requires the confirmation text');
  const next = removeLine(m, 'row', 1);
  assert.equal(Object.keys(next.landmarks).length, 3);
  assert.deepEqual(next.landmarks.beside.position, { x: 2, y: 2 });
  assert.deepEqual(next.landmarks.below.position, { x: 2, y: 2 });
  assert.deepEqual(next.landmarks.far.position, { x: 2, y: 4 });
});
test('the last remaining row/column cannot be removed', () => {
  const m = farm(1, 1);
  assert.equal(analyzeRemoval(m, 'row', 0).blocked, true);
  assert.throws(() => removeLine(m, 'row', 0), RangeError);
  assert.throws(() => removeLine(m, 'col', 0), RangeError);
});
test('removing a numbered row renumbers later rows sequentially while keeping their ids', () => {
  const m = farm(4, 3);
  const keep = m.rowKeys[3];
  const next = removeLine(m, 'row', 1);
  const map = buildCoordinateMap(3, 3, next.unlabeledRows, next.unlabeledCols);
  assert.deepEqual(map.rowLabels, ['1', '2', '3']);
  assert.equal(next.rowKeys[2], keep);
  assert.ok(next.cells[cellIdFor(keep, 1)]);
});
test('removing an unnumbered road row shifts the later unnumbered index', () => {
  const m = { ...farm(5, 2), unlabeledRows: [1, 3], rowGapKinds: { 1: 'road', 3: 'gap' } as Record<number, string> };
  const next = removeLine(m, 'row', 1);
  assert.deepEqual(next.unlabeledRows, [2]);
  assert.deepEqual(next.rowGapKinds, { 2: 'gap' });
  assert.equal(analyzeRemoval(m, 'row', 1).specialLine, 'طريق');
});

console.log('Mirrored orientation');
test('a control drawn in displayed gap g inserts at the right LOGICAL index for every orientation', () => {
  const R = 6;
  for (let g = 0; g <= R; g++) {
    assert.equal(gapToLogicalIndex(g, R, false), g);
    assert.equal(gapToLogicalIndex(g, R, true), R - g);
  }
  for (let i = 0; i < R; i++) {
    assert.equal(lineToLogicalIndex(lineToLogicalIndex(i, R, true), R, true), i);
    assert.equal(lineToLogicalIndex(i, R, false), i);
  }
});
test('inserting through a mirrored gap puts the new row exactly where the control was drawn', () => {
  const R = 4, C = 3;
  for (const orientation of ['original', 'mirror-y'] as const) {
    const flipped = orientation === 'mirror-y';
    for (let gap = 0; gap <= R; gap++) {
      const m = farm(R, C);
      const next = insertLine(m, 'row', gapToLogicalIndex(gap, R, flipped));
      const newKey = next.rowKeys.find((k) => !m.rowKeys.includes(k))!;
      const newLogical = next.rowKeys.indexOf(newKey);
      // displayed row of the new line in the NEW grid must be `gap`
      assert.equal(displayCell(newLogical, 0, R + 1, C, orientation).row, gap, `${orientation} gap ${gap}`);
      // and every old row keeps its relative displayed order
      const order = m.rowKeys.map((k) => displayCell(next.rowKeys.indexOf(k), 0, R + 1, C, orientation).row);
      const oldOrder = m.rowKeys.map((_, i) => displayCell(i, 0, R, C, orientation).row);
      const rank = (a: number[]) => a.map((v) => a.filter((w) => w < v).length);
      assert.deepEqual(rank(order), rank(oldOrder));
    }
  }
});
test('same for columns with mirror-x', () => {
  const R = 3, C = 5;
  for (let gap = 0; gap <= C; gap++) {
    const m = farm(R, C);
    const next = insertLine(m, 'col', gapToLogicalIndex(gap, C, true));
    const newKey = next.colKeys.find((k) => !m.colKeys.includes(k))!;
    assert.equal(displayCell(0, next.colKeys.indexOf(newKey), R, C + 1, 'mirror-x').col, gap);
  }
});
test('nextRowKey / nextColKey fill the smallest unused key (deleted keys are reusable only because their data is gone)', () => {
  assert.equal(nextRowKey(['أ', 'ت']), 'ب');
  assert.equal(nextColKey([1, 2, 4]), 3);
});

console.log(`\n${passed} grid-edit checks passed`);
