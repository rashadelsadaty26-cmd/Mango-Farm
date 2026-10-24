// Dependency-free checks for the landmark (custom farm object) model.
// Run:  node scripts/verify-landmarks.ts      (Node >= 22.18, or --experimental-strip-types)
import assert from 'node:assert/strict';
import { GRID, buildKindGrid } from '../src/farm/infrastructure.ts';
import {
  PITCH_X, PITCH_Y, isSlotInBounds, isTreeCenter, pixelToSlot, slotAdjacentCells, slotBlockedReason, slotKey,
  slotShape, slotToPixel, xOf, yOf, describeSlot, normalizeLandmarks, sanitizeIcon, validateLandmarkName,
  generateLandmarkId, stackOffsets, DEFAULT_LANDMARK_ICON, MAX_LANDMARK_NAME,
  type FarmLandmark, type LandmarkMap,
} from '../src/farm/landmarks.ts';

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('  ok  ' + name); };

const ROWS = 6, COLS = 8;
const labels = Array.from({ length: ROWS }, (_, i) => 'r' + i);
const emptyGrid = buildKindGrid({}, labels, COLS, {}, {});
const ctx = (landmarks: LandmarkMap = {}, grid = emptyGrid, ignoreId?: string) => ({ rows: ROWS, cols: COLS, grid, landmarks, ignoreId });
const mk = (id: string, x: number, y: number): FarmLandmark => ({
  id, name: 'n' + id, icon: '💧', kind: 'custom', position: { x, y }, createdAt: 'a', updatedAt: 'a',
});

console.log('Slot lattice');
test('trees sit at (odd,odd); gutters and intersections are the other parities', () => {
  assert.equal(isTreeCenter({ x: 1, y: 1 }), true);
  assert.equal(slotShape({ x: 2, y: 1 }), 'vertical-gutter');
  assert.equal(slotShape({ x: 1, y: 2 }), 'horizontal-gutter');
  assert.equal(slotShape({ x: 2, y: 2 }), 'intersection');
  assert.equal(slotShape({ x: 3, y: 3 }), null);
});
test('a slot borders exactly the right trees (2 for a gutter, 4 for an intersection)', () => {
  assert.deepEqual(slotAdjacentCells({ x: 2, y: 1 }), [[0, 0], [0, 1]]);   // between tree (0,0) and (0,1)
  assert.deepEqual(slotAdjacentCells({ x: 1, y: 2 }), [[0, 0], [1, 0]]);   // between (0,0) and (1,0)
  assert.deepEqual(slotAdjacentCells({ x: 2, y: 2 }), [[0, 0], [0, 1], [1, 0], [1, 1]]);
  assert.deepEqual(slotAdjacentCells({ x: 3, y: 3 }), []);
});
test('pixel positions lie in the gutters, strictly between the neighbouring tree cells', () => {
  // vertical gutter between col 0 and col 1: x must be between cell0's right edge and cell1's left edge
  assert.equal(xOf(2), GRID.cellW + GRID.gap / 2);
  assert.ok(xOf(2) > GRID.cellW && xOf(2) < PITCH_X);
  assert.equal(yOf(2), GRID.cellH + GRID.gap / 2);
  // a tree centre is the middle of its cell
  assert.equal(xOf(1), GRID.cellW / 2);
  assert.equal(yOf(1), GRID.cellH / 2);
  // the gutter is wide enough for a 20px badge
  assert.ok(GRID.gap >= 20);
});
test('every valid slot round-trips through pixels (so taps land where the badge is drawn)', () => {
  let n = 0;
  for (let x = 1; x <= 2 * COLS - 1; x++) for (let y = 1; y <= 2 * ROWS - 1; y++) {
    if (isTreeCenter({ x, y })) continue;
    const p = slotToPixel({ x, y });
    assert.deepEqual(pixelToSlot(p.x, p.y, ROWS, COLS), { x, y });
    n++;
  }
  assert.ok(n > 100);
});
test('tapping a tree snaps to a neighbouring gutter, never to the tree itself', () => {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const slot = pixelToSlot(c * PITCH_X + GRID.cellW / 2, r * PITCH_Y + GRID.cellH / 2, ROWS, COLS);
    assert.ok(slot && !isTreeCenter(slot), `tree ${r},${c}`);
  }
});
test('taps outside the farm snap to the nearest interior slot instead of failing', () => {
  const s = pixelToSlot(-500, -500, ROWS, COLS)!;
  assert.ok(isSlotInBounds(s, ROWS, COLS));
  const t = pixelToSlot(99999, 99999, ROWS, COLS)!;
  assert.ok(isSlotInBounds(t, ROWS, COLS));
  assert.equal(pixelToSlot(NaN, 0, ROWS, COLS), null);
});
test('no lattice means no slot (1x1 farm has no gutter)', () => {
  assert.equal(pixelToSlot(10, 10, 1, 1), null);
});
test('landmark coordinates are independent of farm growth (adding rows/columns never moves one)', () => {
  const p = slotToPixel({ x: 5, y: 4 });
  // Same slot, bigger farm: identical pixel position and still valid.
  assert.deepEqual(slotToPixel({ x: 5, y: 4 }), p);
  assert.equal(slotBlockedReason({ x: 5, y: 4 }, { ...ctx(), rows: ROWS + 5, cols: COLS + 5 }), null);
});

console.log('Placement rules');
test('allowed in a free gutter; refused on a tree, outside the farm, or on the outer edge', () => {
  assert.equal(slotBlockedReason({ x: 2, y: 1 }, ctx()), null);
  assert.equal(slotBlockedReason({ x: 3, y: 3 }, ctx()), 'tree-center');
  assert.equal(slotBlockedReason({ x: 0, y: 2 }, ctx()), 'out-of-bounds');
  assert.equal(slotBlockedReason({ x: 2 * COLS, y: 2 }, ctx()), 'out-of-bounds');
  assert.equal(slotBlockedReason({ x: 2, y: 2 * ROWS }, ctx()), 'out-of-bounds');
  assert.equal(slotBlockedReason({ x: 1.5, y: 2 }, ctx()), 'invalid');
});
test('an occupied slot is refused, but a landmark may keep/leave its own slot when moving', () => {
  const lms = { a: mk('a', 2, 1) };
  assert.equal(slotBlockedReason({ x: 2, y: 1 }, ctx(lms)), 'occupied');
  assert.equal(slotBlockedReason({ x: 2, y: 1 }, ctx(lms, emptyGrid, 'a')), null);
  assert.equal(slotBlockedReason({ x: 4, y: 1 }, ctx(lms, emptyGrid, 'a')), null);
});
test('roads, drains and blank gap bands block the slots around them; trees and a single canal cell do not', () => {
  // r2 = road row; column 5 = drainage; one canal cell at (r4, c1)
  const g = buildKindGrid({ 'r4-2': { type: 'water_canal' } }, labels, COLS, { 2: 'road' }, { 5: 'drainage' });
  assert.equal(slotBlockedReason({ x: 2, y: 5 }, ctx({}, g)), 'infrastructure'); // row 2 neighbours -> road
  assert.equal(slotBlockedReason({ x: 1, y: 4 }, ctx({}, g)), 'infrastructure'); // gutter above road row
  assert.equal(slotBlockedReason({ x: 10, y: 1 }, ctx({}, g)), 'infrastructure'); // next to drain column 5
  assert.equal(slotBlockedReason({ x: 2, y: 1 }, ctx({}, g)), null);             // plain gutter, rows 0
  // beside ONE canal cell: allowed (a tap next to a canal is the common case)
  assert.equal(slotBlockedReason({ x: 2, y: 9 }, ctx({}, g)), null);
  // two canal cells side by side: the gutter between them is inside the canal body
  const g2 = buildKindGrid({ 'r4-2': { type: 'water_canal' }, 'r4-3': { type: 'water_canal' } }, labels, COLS, {}, {});
  assert.equal(slotBlockedReason({ x: 4, y: 9 }, ctx({}, g2)), 'infrastructure');
});
test('validation of name and icon', () => {
  assert.ok(validateLandmarkName('   '));
  assert.ok(validateLandmarkName('x'.repeat(MAX_LANDMARK_NAME + 1)));
  assert.equal(validateLandmarkName('حوض ماء'), null);
  assert.equal(sanitizeIcon(''), DEFAULT_LANDMARK_ICON);
  assert.equal(sanitizeIcon('💡 extra'), '💡');
  assert.equal(sanitizeIcon('🛢️'), '🛢️');
  assert.equal(sanitizeIcon('💧💡', 'last'), '💡');
});

console.log('Descriptions');
test('slots are described with the app\'s own coordinates', () => {
  const at = (r: number, c: number) => `${String(r + 1).padStart(3, '0')}-${String(c + 1).padStart(3, '0')}`;
  assert.equal(describeSlot({ x: 2, y: 1 }, at, ROWS, COLS), 'بين 001-001 و 001-002');
  assert.match(describeSlot({ x: 2, y: 2 }, at, ROWS, COLS), /4 أشجار/);
});

console.log('Storage');
test('ids are unique, stable-format and never collide with an existing key', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) { const id = generateLandmarkId(); assert.match(id, /^lm_[A-Za-z0-9]+$/); seen.add(id); }
  assert.equal(seen.size, 2000);
  const taken = { lm_x: mk('lm_x', 2, 1) };
  for (let i = 0; i < 200; i++) assert.ok(!(generateLandmarkId(taken) in taken));
});
test('normalizeLandmarks keeps good records, skips malformed ones, never throws', () => {
  const good = mk('lm_ok', 2, 1);
  const out = normalizeLandmarks({
    lm_ok: good,
    bad1: null,
    bad2: { id: 'bad2', name: '', icon: 'x', position: { x: 2, y: 1 } },
    bad3: { id: 'bad3', name: 'n', icon: 'x', position: { x: 'a', y: 1 } },
    'bad key!': { id: 'bad key!', name: 'n', icon: 'x', position: { x: 2, y: 1 } },
    mismatch: { id: 'other', name: 'n', icon: 'x', position: { x: 2, y: 1 } },
  });
  assert.deepEqual(Object.keys(out), ['lm_ok']);
  assert.deepEqual(out.lm_ok.position, { x: 2, y: 1 });
  for (const junk of [undefined, null, 5, 'str', [], [1, 2]]) assert.deepEqual(normalizeLandmarks(junk), {});
});
test('a farm saved before landmarks existed loads as "no landmarks"', () => {
  assert.deepEqual(normalizeLandmarks(undefined), {});
});
test('landmarks never touch tree records: they live in a separate collection with their own keys', () => {
  const cells = { 'أ-1': { type: 'tree', status: 'سليمة', lastUpdated: 'x' } };
  const frozen = JSON.stringify(cells);
  const lms = normalizeLandmarks({ lm_1: mk('lm_1', 2, 1) });
  assert.equal(JSON.stringify(cells), frozen);
  assert.ok(!('أ-1' in lms) && Object.keys(lms).every((k) => k.startsWith('lm_')));
});
test('two landmarks in one slot are fanned out, not hidden', () => {
  const off = stackOffsets([mk('a', 2, 1), mk('b', 2, 1), mk('c', 4, 1)]);
  assert.ok(off.a !== undefined && off.b !== undefined && off.a !== off.b);
  assert.equal(off.c, undefined);
  assert.equal(slotKey({ x: 2, y: 1 }), '2,1');
});

console.log(`\n${passed} landmark checks passed`);
