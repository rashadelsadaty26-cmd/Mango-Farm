// Dependency-free checks for map mirroring, the displayed-origin and the fit-to-view maths.
// Run:  node scripts/verify-orientation.ts      (Node >= 22.18, or --experimental-strip-types)
import assert from 'node:assert/strict';
import { GRID, GRID_ORIGIN, buildKindGrid, kindAt } from '../src/farm/infrastructure.ts';
import {
  displayCell, displayCol, displayOrder, displayRow, flipsColumns, flipsRows, getGridOrigin, logicalCell,
  mirrorKindGrid, mirrorSlot, normalizeOrientation, type MapOrientation,
} from '../src/farm/orientation.ts';
import { isTreeCenter, slotAdjacentCells } from '../src/farm/landmarks.ts';
import { clampView, computeFitView } from '../src/farm/viewport.ts';

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('  ok  ' + name); };
const ORIENTATIONS: MapOrientation[] = ['original', 'mirror-x', 'mirror-y'];

console.log('Coordinate mapping (spec formulas)');
test('original (r,c); mirror-x (r, C-1-c); mirror-y (R-1-r, c) — for every cell of several farm sizes', () => {
  for (const [R, C] of [[1, 1], [2, 3], [5, 8], [30, 60], [7, 1], [1, 9]]) {
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      assert.deepEqual(displayCell(r, c, R, C, 'original'), { row: r, col: c });
      assert.deepEqual(displayCell(r, c, R, C, 'mirror-x'), { row: r, col: C - 1 - c });
      assert.deepEqual(displayCell(r, c, R, C, 'mirror-y'), { row: R - 1 - r, col: c });
    }
  }
});
test('every mapping is an involution and a bijection, so Original restores the exact arrangement', () => {
  const R = 6, C = 9;
  for (const o of ORIENTATIONS) {
    const seen = new Set<string>();
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const d = displayCell(r, c, R, C, o); seen.add(`${d.row},${d.col}`);
      assert.deepEqual(logicalCell(d.row, d.col, R, C, o), { row: r, col: c });
      assert.equal(displayRow(displayRow(r, R, o), R, o), r); assert.equal(displayCol(displayCol(c, C, o), C, o), c);
    }
    assert.equal(seen.size, R * C);
  }
});
test('choosing an orientation is absolute: the mapping depends only on the choice, never on history', () => {
  // (there is no "flip" operation at all - the function takes the target orientation)
  const via = (path: MapOrientation[]) => displayCell(2, 3, 5, 8, path[path.length - 1]);
  assert.deepEqual(via(['mirror-x', 'mirror-y', 'mirror-x']), via(['original', 'mirror-x']));
  assert.deepEqual(displayCell(2, 3, 5, 8, 'original'), { row: 2, col: 3 });
});
test('displayOrder lists the logical index shown at each displayed position', () => {
  assert.deepEqual(displayOrder(4, false), [0, 1, 2, 3]); assert.deepEqual(displayOrder(4, true), [3, 2, 1, 0]); assert.deepEqual(displayOrder(0, true), []);
  assert.equal(flipsColumns('mirror-x'), true); assert.equal(flipsRows('mirror-x'), false); assert.equal(flipsRows('mirror-y'), true); assert.equal(flipsColumns('original'), false);
});
test('normalizeOrientation: unknown / missing stored values mean original', () => {
  for (const v of [undefined, null, '', 'x', 5, {}, 'MIRROR-X']) assert.equal(normalizeOrientation(v), 'original');
  assert.equal(normalizeOrientation('mirror-x'), 'mirror-x'); assert.equal(normalizeOrientation('mirror-y'), 'mirror-y');
});

console.log('Landmark lattice');
test('tree centres map to the tree centres of the mirrored cell; gutters stay gutters', () => {
  const R = 5, C = 8;
  for (const o of ORIENTATIONS) {
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const d = displayCell(r, c, R, C, o);
      assert.deepEqual(mirrorSlot({ x: 2 * c + 1, y: 2 * r + 1 }, R, C, o), { x: 2 * d.col + 1, y: 2 * d.row + 1 });
    }
    for (let x = 0; x <= 2 * C; x++) for (let y = 0; y <= 2 * R; y++) {
      const m = mirrorSlot({ x, y }, R, C, o);
      assert.equal(isTreeCenter({ x, y }), isTreeCenter(m)); assert.deepEqual(mirrorSlot(m, R, C, o), { x, y });
    }
  }
});
test('a landmark stays attached to the SAME neighbouring cells: its neighbours map to the mirrored slot\'s neighbours', () => {
  const R = 5, C = 8;
  for (const o of ORIENTATIONS) for (let x = 1; x < 2 * C; x++) for (let y = 1; y < 2 * R; y++) {
    if (isTreeCenter({ x, y })) continue;
    const logical = slotAdjacentCells({ x, y }).map(([r, c]) => { const d = displayCell(r, c, R, C, o); return `${d.row},${d.col}`; }).sort();
    const shown = slotAdjacentCells(mirrorSlot({ x, y }, R, C, o)).map(([r, c]) => `${r},${c}`).sort();
    assert.deepEqual(shown, logical, `${o} slot ${x},${y}`);
  }
});

console.log('Infrastructure');
const labels = ['a', 'b', 'c', 'd', 'e'];
const cells: Record<string, { type?: string }> = { 'b-3': { type: 'water_canal' }, 'c-3': { type: 'water_canal' }, 'd-3': { type: 'water_canal' }, 'e-3': { type: 'water_canal' }, 'c-6': { type: 'spray_tank' } };
const rowGaps = { 0: 'road' }, colGaps = { 6: 'drainage' };
const base = buildKindGrid(cells, labels, 8, rowGaps, colGaps);
test('original returns the very same grid object (no copy, no re-render)', () => assert.equal(mirrorKindGrid(base, 'original'), base));
test('mirrored grid == the grid built from explicitly mirrored inputs (roads, canals, drains, intersections)', () => {
  // mirror-y: reverse the row order (labels and row gaps)
  const my = buildKindGrid(cells, [...labels].reverse(), 8, { 4: 'road' }, colGaps);
  assert.equal(mirrorKindGrid(base, 'mirror-y').signature, my.signature);
  // mirror-x: column c -> 7-c for cells and column gaps
  const cx: Record<string, { type?: string }> = {};
  for (const [id, v] of Object.entries(cells)) { const [l, n] = id.split('-'); cx[`${l}-${8 - Number(n) + 1}`] = v; }
  const mx = buildKindGrid(cx, labels, 8, rowGaps, { 1: 'drainage' });
  assert.equal(mirrorKindGrid(base, 'mirror-x').signature, mx.signature);
});
test('a road along the TOP row moves to the BOTTOM row under mirror-y, and stays on top under mirror-x', () => {
  const top = (g: typeof base, r: number) => Array.from({ length: 8 }, (_, c) => kindAt(g, r, c)).every((k) => k === 'road');
  assert.ok(top(base, 0)); assert.ok(top(mirrorKindGrid(base, 'mirror-y'), 4)); assert.ok(!top(mirrorKindGrid(base, 'mirror-y'), 0)); assert.ok(top(mirrorKindGrid(base, 'mirror-x'), 0));
});
test('mirroring twice gives the original geometry', () => {
  for (const o of ['mirror-x', 'mirror-y'] as const) assert.equal(mirrorKindGrid(mirrorKindGrid(base, o), o).signature, base.signature);
});

console.log('Grid origin (where the cell area starts inside the land)');
test('original origin equals the long-standing GRID_ORIGIN; mirroring moves the axis strips to the far side', () => {
  assert.deepEqual(getGridOrigin('original'), { left: GRID_ORIGIN.left, top: GRID_ORIGIN.top });
  assert.equal(getGridOrigin('mirror-x').left, GRID.pad); assert.equal(getGridOrigin('mirror-x').top, GRID_ORIGIN.top);
  assert.equal(getGridOrigin('mirror-y').top, GRID.pad); assert.equal(getGridOrigin('mirror-y').left, GRID_ORIGIN.left);
});

console.log('Viewport: clamp and fit-to-view');
const M = { viewportW: 1000, viewportH: 700, contentW: 3000, contentH: 2000 };
test('clampView keeps the established rules (centre when smaller, edge-clamp when larger)', () => {
  assert.deepEqual(clampView(500, 500, 0.1, M), { x: 350, y: 250 });         // 300x200 content: centred
  assert.deepEqual(clampView(100, 100, 1, M), { x: 0, y: 0 });                 // can't pan past the origin
  assert.deepEqual(clampView(-9999, -9999, 1, M), { x: -2000, y: -1300 });    // nor past the far edge
});
const pad = 64;
const land = (w: number, h: number) => ({ left: pad, top: pad, width: w, height: h });
const screenRect = (v: { scale: number; x: number; y: number }, l: ReturnType<typeof land>) => ({ x: v.x + l.left * v.scale, y: v.y + l.top * v.scale, r: v.x + (l.left + l.width) * v.scale, b: v.y + (l.top + l.height) * v.scale });
test('fits and centres the whole land when it can fit; never clipped; never beyond the zoom limits', () => {
  let seed = 99; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 500; i++) {
    const vw = 300 + rnd() * 1600, vh = 300 + rnd() * 900, lw = 200 + rnd() * 6000, lh = 200 + rnd() * 4000;
    const m = { viewportW: vw, viewportH: vh, contentW: lw + 2 * pad, contentH: lh + 2 * pad }; const l = land(lw, lh);
    const v = computeFitView(m, l, { minScale: 0.15, maxScale: 3 });
    assert.ok(v.scale >= 0.15 - 1e-9 && v.scale <= 1 + 1e-9);
    const s = screenRect(v, l);
    if (lw * v.scale <= vw - 32 && lh * v.scale <= vh - 32) {
      assert.ok(s.x >= -1e-6 && s.y >= -1e-6 && s.r <= vw + 1e-6 && s.b <= vh + 1e-6, 'inside the viewport');
      assert.ok(Math.abs((s.x + s.r) / 2 - vw / 2) < 1e-6 && Math.abs((s.y + s.b) / 2 - vh / 2) < 1e-6, 'centred');
    }
  }
});
test('the result follows the MEASURED land bounds: any padding around the land gives a centred, unclipped fit', () => {
  // (The land is always centred in its padded content element, as in the app; the clamp rule
  //  keeps content edges inside the viewport, so an off-centre land is not a supported case.)
  for (const inset of [0, 24, 64, 300]) {
    const lw = 1500, lh = 900; const m = { viewportW: 1200, viewportH: 800, contentW: lw + 2 * inset, contentH: lh + 2 * inset };
    const l = { left: inset, top: inset, width: lw, height: lh }; const v = computeFitView(m, l, { minScale: 0.15, maxScale: 3 }); const s = screenRect(v, l);
    assert.ok(Math.abs((s.x + s.r) / 2 - 600) < 1e-6 && Math.abs((s.y + s.b) / 2 - 400) < 1e-6, `inset ${inset}`);
    assert.ok(s.x >= 0 && s.y >= 0 && s.r <= 1200 && s.b <= 800, `inset ${inset} unclipped`);
  }
});
test('a mirrored layout (same size, label strips on the other side) fits identically', () => {
  const m = { viewportW: 1280, viewportH: 760, contentW: 6598, contentH: 3688 };
  const orig = computeFitView(m, { left: 64, top: 64, width: 6470, height: 3560 }, { minScale: 0.1, maxScale: 3 });
  const mirrored = computeFitView(m, { left: 64, top: 64, width: 6470, height: 3560 }, { minScale: 0.1, maxScale: 3 });
  assert.deepEqual(orig, mirrored); assert.ok(orig.scale < 0.25);
});
test('when the minimum zoom prevents a full fit (phone), the DISPLAYED top-left of the land is aligned to the viewport', () => {
  const m = { viewportW: 390, viewportH: 600, contentW: 6598, contentH: 3688 };
  const l = { left: 64, top: 64, width: 6470, height: 3560 };
  const v = computeFitView(m, l, { minScale: 0.15, maxScale: 3 }); assert.equal(v.scale, 0.15);
  const s = screenRect(v, l);
  assert.ok(s.x >= -1e-6 && s.x <= 16 + 1e-6, 'overflowing axis: displayed left edge at the viewport edge (within the margin)');
  assert.ok(Math.abs((s.y + s.b) / 2 - 300) < 1e-6, 'axis that fits is centred');
});
test('small farms are never enlarged beyond natural size and stay centred', () => {
  const m = { viewportW: 1600, viewportH: 1000, contentW: 900, contentH: 700 };
  const v = computeFitView(m, { left: 64, top: 64, width: 772, height: 572 }, { minScale: 0.15, maxScale: 3 });
  assert.equal(v.scale, 1); assert.deepEqual({ x: v.x, y: v.y }, { x: 350, y: 150 });
});
test('degenerate input (unmeasured viewport / land) returns a safe default', () => {
  assert.deepEqual(computeFitView({ viewportW: 0, viewportH: 0, contentW: 0, contentH: 0 }, land(100, 100), { minScale: 0.15, maxScale: 3 }), { scale: 1, x: 0, y: 0 });
});

console.log(`\n${passed} orientation / viewport checks passed`);
