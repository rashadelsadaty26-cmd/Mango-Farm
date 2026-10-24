// Dependency-free checks for the display-only tree coordinate system.
// Run:  node scripts/verify-coordinates.ts      (Node >= 22.18, or --experimental-strip-types)
import assert from 'node:assert/strict';
import {
  buildAxisNumbers, buildCoordinateMap, formatCoordinate, padCoordPart, parseCellId,
} from '../src/farm/coordinates.ts';

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('  ok  ' + name); };

// Mirror of App.tsx's internal id scheme, only to prove ids are independent of coordinates.
const LETTERS = ['أ','ب','ت','ث','ج','ح','خ','د','ذ','ر','ز','س','ش','ص','ض','ط','ظ','ع','غ','ف','ق','ك','ل','م','ن','هـ','و','ي'];
function rowId(index: number): string {
  let n = index + 1; let label = '';
  while (n > 0) { n -= 1; label = LETTERS[n % LETTERS.length] + label; n = Math.floor(n / LETTERS.length); }
  return label;
}
const allCoords = (rows: number, cols: number, ur: number[] = [], uc: number[] = []) => {
  const m = buildCoordinateMap(rows, cols, ur, uc);
  const out: string[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const x = m.coordinateAt(r, c); if (x) out.push(x); }
  return { m, out };
};

console.log('Format');
test('zero padding to 3 digits, larger numbers grow, invalid -> empty', () => {
  assert.equal(padCoordPart(1), '001'); assert.equal(padCoordPart(12), '012');
  assert.equal(padCoordPart(999), '999'); assert.equal(padCoordPart(1000), '1000');
  assert.equal(padCoordPart(0), ''); assert.equal(padCoordPart(-3), ''); assert.equal(padCoordPart(1.5), '');
});
test('spec examples: 001-001, 001-012, 012-007, 030-060', () => {
  const { m } = allCoords(30, 60);
  assert.equal(m.coordinateAt(0, 0), '001-001');
  assert.equal(m.coordinateAt(0, 11), '001-012');
  assert.equal(m.coordinateAt(11, 6), '012-007');
  assert.equal(m.coordinateAt(29, 59), '030-060');
  assert.equal(formatCoordinate(null, 5), null);
});

console.log('Boundaries');
test('rows 9/10 and columns 9/10 and the final row/column', () => {
  const { m } = allCoords(30, 60);
  assert.equal(m.coordinateAt(8, 8), '009-009');
  assert.equal(m.coordinateAt(8, 9), '009-010');
  assert.equal(m.coordinateAt(9, 8), '010-009');
  assert.equal(m.coordinateAt(9, 9), '010-010');
  assert.equal(m.rowLabels[29], '030'); assert.equal(m.colLabels[59], '060');
});

console.log('Uniqueness');
test('default 30x60 farm: 1800 distinct coordinates', () => {
  const { out } = allCoords(30, 60);
  assert.equal(out.length, 1800); assert.equal(new Set(out).size, 1800);
});
test('unique with unnumbered rows/columns mixed in (and none of them get a coordinate)', () => {
  const ur = [2, 9, 10, 20], uc = [0, 5, 6, 30, 59];
  const { m, out } = allCoords(30, 60, ur, uc);
  assert.equal(out.length, (30 - ur.length) * (60 - uc.length));
  assert.equal(new Set(out).size, out.length);
  for (const r of ur) for (let c = 0; c < 60; c++) assert.equal(m.coordinateAt(r, c), null);
  for (const c of uc) for (let r = 0; r < 30; r++) assert.equal(m.coordinateAt(r, c), null);
});
test('randomised unnumbered sets are always unique and gap-free per axis', () => {
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 200; i++) {
    const rows = 1 + Math.floor(rnd() * 40), cols = 1 + Math.floor(rnd() * 70);
    const ur = Array.from({ length: rows }, (_, k) => k).filter(() => rnd() < 0.2);
    const uc = Array.from({ length: cols }, (_, k) => k).filter(() => rnd() < 0.2);
    const { out } = allCoords(rows, cols, ur, uc);
    assert.equal(new Set(out).size, out.length);
    const nums = buildAxisNumbers(rows, ur).filter((n): n is number => n !== null);
    nums.forEach((n, k) => assert.equal(n, k + 1)); // 1..N with no gaps or repeats
  }
});

console.log('Unnumbered rows/columns');
test('spec example: 8, 9, [blank], 10, 11 for rows and for columns', () => {
  const n = buildAxisNumbers(12, [8]); // physical index 8 is the blank one
  assert.deepEqual(n.slice(6, 11), [7, 8, null, 9, 10]);
  const m = buildCoordinateMap(12, 12, [9], [9]); // blank is the 10th physical row/column
  assert.deepEqual(m.rowLabels.slice(7, 12), ['008', '009', '', '010', '011']);
  assert.deepEqual(m.colLabels.slice(7, 12), ['008', '009', '', '010', '011']);
  assert.equal(m.coordinateAt(10, 10), '010-010'); // physically row/col 11, visibly 10
});
test('trees BEFORE an unnumbered row/column keep their coordinate; only later ones continue the sequence', () => {
  const before = buildCoordinateMap(30, 60, [], []);
  const after = buildCoordinateMap(30, 60, [14], [29]);
  for (let r = 0; r < 14; r++) for (let c = 0; c < 29; c++) assert.equal(after.coordinateAt(r, c), before.coordinateAt(r, c));
  assert.equal(after.coordinateAt(15, 30), '015-030'); // physical (16, 31) continues from the blank
});
test('describeAt falls back to the physical position for an unnumbered cell', () => {
  const m = buildCoordinateMap(10, 10, [4], []);
  assert.equal(m.describeAt(4, 2), 'صف 5 · عمود 3 (بدون رقم)');
  assert.equal(m.describeAt(0, 0), '001-001');
});

console.log('Adding rows / columns');
test('appending rows/columns never changes an existing coordinate and never duplicates', () => {
  const ur = [3], uc = [7];
  const base = buildCoordinateMap(30, 60, ur, uc);
  const grown = buildCoordinateMap(33, 64, ur, uc);
  for (let r = 0; r < 30; r++) for (let c = 0; c < 60; c++) assert.equal(grown.coordinateAt(r, c), base.coordinateAt(r, c));
  const all = allCoords(33, 64, ur, uc).out;
  assert.equal(new Set(all).size, all.length);
  assert.equal(grown.coordinateAt(32, 63), '032-063');
});
test('an unnumbered index beyond the grid size is harmless', () => {
  const { out } = allCoords(5, 5, [99], [-1]);
  assert.equal(out.length, 25); assert.equal(new Set(out).size, 25);
});

console.log('Stored ids are independent of the display system');
test('parseCellId round-trips every stored id form, including multi-letter rows', () => {
  for (let r = 0; r < 800; r++) for (const col of [1, 9, 10, 60, 200]) {
    const id = `${rowId(r)}-${col}`;
    assert.deepEqual(parseCellId(id), { rowLabel: rowId(r), colIndex: col - 1 });
  }
  assert.equal(parseCellId('garbage'), null); assert.equal(parseCellId('أ-0'), null); assert.equal(parseCellId('أ-x'), null);
});
test('toggling unnumbered rows/columns changes labels but cannot change an id', () => {
  const ids = Array.from({ length: 30 }, (_, r) => Array.from({ length: 60 }, (_, c) => `${rowId(r)}-${c + 1}`)).flat();
  assert.equal(new Set(ids).size, 1800);
  const a = buildCoordinateMap(30, 60, [], []).coordinateAt(15, 30);
  const b = buildCoordinateMap(30, 60, [2, 3], [4]).coordinateAt(15, 30);
  assert.notEqual(a, b); // the label may move...
  assert.equal(`${rowId(15)}-31`, ids[15 * 60 + 30]); // ...the stored id of that physical cell does not
});

console.log(`\n${passed} coordinate checks passed`);
