// Dependency-free checks for Realistic (drone view) mode: scene mapping, cell classification,
// resource lifecycle (create / dispose / repeated toggling) and renderer culling.
// Run:  node scripts/verify-realistic.ts      (Node >= 22.18, or --experimental-strip-types)
import assert from 'node:assert/strict';
import { GRID, buildKindGrid } from '../src/farm/infrastructure.ts';
import { displayCell, getGridOrigin, mirrorKindGrid, mirrorSlot, type MapOrientation } from '../src/farm/orientation.ts';
import { PITCH_X, PITCH_Y, slotToPixel } from '../src/farm/landmarks.ts';
import {
  CELL_BASIN, CELL_EMPTY, CELL_NONE, CELL_TREE, FLAG_DISEASED, FLAG_GRAFTED, FLAG_UPROOTED, FLAG_WEAK,
  buildScene, classifyCell, landmarkShape, type CellRecord,
} from '../src/farm/realistic/scene.ts';
import { buildAssets, getLiveCanvasCount, type CanvasFactory } from '../src/farm/realistic/textures.ts';
import { RealisticRenderer } from '../src/farm/realistic/renderer.ts';
import { DEFAULT_DISPLAY_OPTIONS, QUALITY_PROFILES } from '../src/farm/realistic/quality.ts';

let passed = 0;
const test = async (name: string, fn: () => void | Promise<void>) => { await fn(); passed++; console.log('  ok  ' + name); };
const ORIENTATIONS: MapOrientation[] = ['original', 'mirror-x', 'mirror-y'];

// ---- a canvas that records nothing but behaves enough for the code paths under test ----
let created = 0;
const fakeCtx = () => {
  const target: Record<string, unknown> = {};
  return new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      if (prop === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      if (prop === 'createPattern') return () => ({});
      if (prop === 'measureText') return () => ({ width: 40 });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop() {} });
      return () => undefined;
    },
    set(t, prop: string, v) { t[prop] = v; return true; },
  });
};
const fakeCanvas: CanvasFactory = (width, height) => {
  created++;
  const ctx = fakeCtx();
  return { width, height, getContext: () => ctx };
};
class FakePath { d?: string; constructor(d?: string) { this.d = d; } }
const yieldNow = async () => {};

const rows = 6, cols = 8;
const rowLabels = ['A', 'B', 'C', 'D', 'E', 'F'];
const cells: Record<string, CellRecord> = {
  'A-1': { type: 'tree', lastUpdated: 'x', variety: 'عويس', status: 'سليمة' },
  'A-2': { type: 'tree', lastUpdated: 'x', status: 'مصابة بآفة/مرض' },
  'A-3': { type: 'tree', lastUpdated: 'x', status: 'تحتاج تقليم' },
  'A-4': { type: 'tree', lastUpdated: 'x', status: 'تحتاج تقليم', disease: 'أكاروس' },
  'A-5': { type: 'tree', lastUpdated: 'x', status: 'مقلوعة' },
  'A-6': { type: 'tree', lastUpdated: 'x', status: 'مطعمة' },
  'B-1': { type: 'spray_tank' },
  'B-2': { type: 'water_canal' },
  'B-3': { type: 'road' },
  'B-4': { type: 'drainage' },
  'B-5': { type: 'tree' }, // saved type but no data entered yet
  'C-1': { type: 'tree', lastUpdated: 'x' }, // inside a gap row below
};
const rowGapKinds = { 2: 'road' };
const colGapKinds: Record<number, string> = {};
const kindGrid = buildKindGrid(cells, rowLabels, cols, rowGapKinds, colGapKinds);
const landmarks = {
  t: { id: 't', name: 'حنفية', icon: '🚰', kind: 'custom', typeId: 'preset_tap', position: { x: 2, y: 3 }, createdAt: '', updatedAt: '' },
  l: { id: 'l', name: 'عمود', icon: '💡', kind: 'custom', position: { x: 4, y: 2 }, createdAt: '', updatedAt: '' },
};
const sceneFor = (orientation: MapOrientation) => buildScene({
  rows, cols, rowLabels, cells, orientation, kindGrid, displayKindGrid: mirrorKindGrid(kindGrid, orientation),
  rowGapKinds, colGapKinds, landmarks,
});

console.log('Cell classification (must match MapCell)');
await test('tree / empty / basin / infrastructure, including a gap row', () => {
  assert.equal(classifyCell(undefined, null), CELL_EMPTY);
  assert.equal(classifyCell({ type: 'tree', lastUpdated: 'x' }, null), CELL_TREE);
  assert.equal(classifyCell({ type: 'tree' }, null), CELL_EMPTY);
  assert.equal(classifyCell({ type: 'spray_tank' }, null), CELL_BASIN);
  for (const t of ['water_canal', 'drainage', 'road']) assert.equal(classifyCell({ type: t }, null), CELL_NONE);
  assert.equal(classifyCell(undefined, 'road'), CELL_NONE);              // blank cell in a gap row
  assert.equal(classifyCell({ type: 'tree', lastUpdated: 'x' }, 'road'), CELL_TREE); // explicit tree record still shows
});

console.log('Scene = the existing farm, nothing invented, nothing moved');
await test('every stored cell id appears exactly once, at the display position of the orientation mapping', () => {
  for (const o of ORIENTATIONS) {
    const sc = sceneFor(o);
    assert.equal(sc.ids.length, rows * cols);
    assert.equal(new Set(sc.ids).size, rows * cols);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const d = displayCell(r, c, rows, cols, o);
      assert.equal(sc.ids[d.row * cols + d.col], `${rowLabels[r]}-${c + 1}`);
    }
  }
});
await test('tree seeds depend on the storage id only (a mirrored tree keeps its identity / look)', () => {
  const a = sceneFor('original'); const b = sceneFor('mirror-x');
  for (let i = 0; i < a.ids.length; i++) {
    const j = b.ids.indexOf(a.ids[i]);
    assert.equal(a.seed[i], b.seed[j]);
    assert.equal(a.cls[i], b.cls[j]);
    assert.equal(a.flags[i], b.flags[j]);
  }
});
await test('status flags preserve the existing meanings (diseased / weak / grafted / uprooted, independent facts)', () => {
  const sc = sceneFor('original');
  const f = (id: string) => sc.flags[sc.ids.indexOf(id)];
  assert.equal(f('A-1'), 0);
  assert.equal(f('A-2'), FLAG_DISEASED);
  assert.equal(f('A-3'), FLAG_WEAK);
  assert.equal(f('A-4'), FLAG_WEAK | FLAG_DISEASED);
  assert.equal(f('A-5'), FLAG_UPROOTED);
  assert.equal(f('A-6'), FLAG_GRAFTED);
});
await test('infrastructure is the mirrored kind grid the standard layer receives (same object for original)', () => {
  assert.equal(sceneFor('original').infra, kindGrid);
  assert.equal(sceneFor('mirror-y').infra.signature, mirrorKindGrid(kindGrid, 'mirror-y').signature);
});
await test('landmarks sit where the standard landmark layer puts them, for every orientation', () => {
  for (const o of ORIENTATIONS) {
    const sc = sceneFor(o);
    for (const lm of sc.landmarks) {
      const src = landmarks[lm.id as 't' | 'l'];
      const p = slotToPixel(mirrorSlot(src.position, rows, cols, o));
      assert.deepEqual({ x: lm.x, y: lm.y }, p);
    }
  }
  assert.equal(landmarkShape({ typeId: 'preset_tap', icon: 'x' }), 'tap');
  assert.equal(landmarkShape({ icon: '💡' }), 'pole');
  assert.equal(landmarkShape({ icon: '🦄' }), 'marker');
});
await test('scene size equals the cell area of the standard grid', () => {
  const sc = sceneFor('original');
  assert.equal(sc.width, cols * GRID.cellW + (cols - 1) * GRID.gap);
  assert.equal(sc.height, rows * GRID.cellH + (rows - 1) * GRID.gap);
  assert.equal(PITCH_X, GRID.cellW + GRID.gap); assert.equal(PITCH_Y, GRID.cellH + GRID.gap);
});

console.log('Resource lifecycle');
await test('building and disposing assets releases every canvas (20 toggles, no growth)', async () => {
  const before = getLiveCanvasCount();
  let peak = 0;
  for (let i = 0; i < 20; i++) {
    const a = await buildAssets(QUALITY_PROFILES.high, fakeCanvas, { yieldToUi: yieldNow });
    assert.ok(a);
    peak = Math.max(peak, getLiveCanvasCount());
    a!.dispose();
    a!.dispose(); // idempotent
    assert.equal(getLiveCanvasCount(), before);
  }
  assert.ok(peak > before);
});
await test('canvas count is bounded by the quality profile, independent of the farm size', async () => {
  for (const q of Object.values(QUALITY_PROFILES)) {
    const base = getLiveCanvasCount();
    const a = (await buildAssets(q, fakeCanvas, { yieldToUi: yieldNow }))!;
    // soil, road, water, concrete, macro, basin + per variant: 3 mips + 1 shadow
    assert.equal(getLiveCanvasCount() - base, 6 + q.canopyVariants * 4);
    a.dispose();
  }
});
await test('cancelling mid-build releases what was already made and returns null', async () => {
  const base = getLiveCanvasCount();
  let steps = 0;
  const a = await buildAssets(QUALITY_PROFILES.low, fakeCanvas, { yieldToUi: yieldNow, isCancelled: () => ++steps > 4 });
  assert.equal(a, null);
  assert.equal(getLiveCanvasCount(), base);
});
await test('a failure while building releases everything and rethrows (host then falls back to Standard Mode)', async () => {
  const base = getLiveCanvasCount();
  let n = 0;
  const flaky: CanvasFactory = (w, h) => { if (++n === 9) throw new Error('out of memory'); return fakeCanvas(w, h); };
  await assert.rejects(buildAssets(QUALITY_PROFILES.low, flaky, { yieldToUi: yieldNow }), /out of memory/);
  assert.equal(getLiveCanvasCount(), base);
});

console.log('Renderer');
const makeRenderer = async (view: { scale: number; x: number; y: number }) => {
  const assets = (await buildAssets(QUALITY_PROFILES.low, fakeCanvas, { yieldToUi: yieldNow }))!;
  const canvas = fakeCanvas(10, 10);
  const state = { view };
  const r = new RealisticRenderer({ canvas, assets, getView: () => state.view, Path2DCtor: FakePath as unknown as typeof Path2D });
  const sc = sceneFor('original');
  r.setScene(sc);
  const o = getGridOrigin('original');
  r.setGeometry({ landX: 64, landY: 64, landW: 900, landH: 800, gridX: 64 + 2 + o.left, gridY: 64 + 2 + o.top });
  r.setOptions({ ...DEFAULT_DISPLAY_OPTIONS });
  r.resize(1200, 800, 1);
  return { r, state, canvas, sc };
};
await test('only trees inside the viewport are visited (culling), and zooming in draws fewer', async () => {
  const { r, state, sc } = await makeRenderer({ scale: 0.3, x: 0, y: 0 });
  r.setVisible(true);
  const total = Array.from(sc.cls).filter((c) => c === CELL_TREE || c === CELL_EMPTY || c === CELL_BASIN).length;
  assert.ok(r.stats.treesDrawn > 0 && r.stats.treesDrawn <= total);
  const far = r.stats.treesDrawn;
  state.view = { scale: 3, x: -400, y: -300 }; r.draw();
  assert.ok(r.stats.treesDrawn < far);
  r.dispose();
});
await test('draw() is a no-op when neither the view nor the data changed', async () => {
  const { r } = await makeRenderer({ scale: 1, x: 0, y: 0 });
  r.setVisible(true);
  const n = r.stats.draws;
  r.draw(); r.draw();
  assert.equal(r.stats.draws, n);
  r.invalidate(); r.draw();
  assert.equal(r.stats.draws, n + 1);
  r.dispose();
});
await test('dispose() releases the textures, the backing store and stops drawing', async () => {
  const base = getLiveCanvasCount();
  const { r, canvas } = await makeRenderer({ scale: 1, x: 0, y: 0 });
  r.setVisible(true);
  const n = r.stats.draws;
  r.dispose(); r.dispose();
  assert.equal(canvas.width, 0);
  assert.equal(getLiveCanvasCount(), base);
  r.invalidate(); r.draw();
  assert.equal(r.stats.draws, n);
});
await test('repeated create / draw / dispose cycles do not accumulate canvases', async () => {
  const base = getLiveCanvasCount();
  for (let i = 0; i < 15; i++) { const { r } = await makeRenderer({ scale: 0.5, x: -10, y: -10 }); r.setVisible(true); r.dispose(); }
  assert.equal(getLiveCanvasCount(), base);
});
await test('repeated drawing failures reach onFatal after 3 attempts (host falls back to Standard Mode)', async () => {
  const assets = (await buildAssets(QUALITY_PROFILES.low, fakeCanvas, { yieldToUi: yieldNow }))!;
  const failing = { width: 10, height: 10, getContext: () => new Proxy({}, { get: () => () => { throw new Error('context lost'); } }) };
  let fatal = 0;
  const r = new RealisticRenderer({ canvas: failing, assets, getView: () => ({ scale: 1, x: 0, y: 0 }), Path2DCtor: FakePath as unknown as typeof Path2D, onFatal: () => { fatal++; } });
  r.setScene(sceneFor('original')); r.resize(100, 100, 1); r.setVisible(true);
  assert.equal(fatal, 0);          // first failed draw (inside setVisible): not yet fatal, never throws
  r.invalidate(); r.draw();
  assert.equal(fatal, 0);
  r.invalidate(); r.draw();
  assert.equal(fatal, 1);
  r.dispose();
});

console.log(`\n${passed} realistic-mode checks passed (${created} fake canvases created)`);
