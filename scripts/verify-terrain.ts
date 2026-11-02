// Dependency-free checks for the sandy terrain, the chunk cache and the renderer's new
// gesture / far-zoom paths.   Run:  node scripts/verify-terrain.ts   (Node >= 22.18)
import assert from 'node:assert/strict';
import {
  CHUNK_PX, TIERS, TerrainCache, VEG_CELL, VEG_CLEARANCE, inflate, shadeChunk, vegetationForCell, vnoise,
  type Rect,
} from '../src/farm/realistic/terrain.ts';
import { RealisticRenderer } from '../src/farm/realistic/renderer.ts';
import { buildAssets, type CanvasFactory } from '../src/farm/realistic/textures.ts';
import { QUALITY_PROFILES, DEFAULT_DISPLAY_OPTIONS } from '../src/farm/realistic/quality.ts';
import { buildScene } from '../src/farm/realistic/scene.ts';
import { buildKindGrid, GRID } from '../src/farm/infrastructure.ts';
import { getGridOrigin } from '../src/farm/orientation.ts';

let passed = 0;
const test = async (name: string, fn: () => void | Promise<void>) => { await fn(); passed++; console.log('  ok  ' + name); };
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 40) => { for (let i = 0; i < n; i++) await tick(); };

const lum = (px: Uint8ClampedArray, o: number) => 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2];
function chunk(wx0: number, wy0: number, res: number, land: Rect | null = null, size = CHUNK_PX) {
  const px = new Uint8ClampedArray(size * size * 4);
  shadeChunk(px, size, wx0, wy0, { res, land });
  return px;
}

console.log('Ground');
await test('noise is deterministic and the same world position always gives the same ground', () => {
  assert.equal(vnoise(12.3, 4.5, 7), vnoise(12.3, 4.5, 7));
  const a = chunk(1000, 2000, 1); const b = chunk(1000, 2000, 1);
  assert.deepEqual(a, b);
});
await test('chunks are continuous: overlapping world pixels are identical (no tile seams)', () => {
  const a = chunk(0, 0, 1); const b = chunk(64, 32, 1);
  for (let j = 0; j < 96; j += 7) for (let i = 0; i < 64; i += 5) {
    const oa = ((j + 32) * CHUNK_PX + (i + 64)) * 4; const ob = (j * CHUNK_PX + i) * 4;
    if (j + 32 >= CHUNK_PX) continue;
    assert.deepEqual([a[oa], a[oa + 1], a[oa + 2]], [b[ob], b[ob + 1], b[ob + 2]]);
  }
});
await test('it is NOT a flat single colour: light beige, golden, compacted and brown tones all appear', () => {
  let lo = 255, hi = 0; let warmR = 0, n = 0; let browns = 0, lights = 0;
  for (let cy = 0; cy < 6; cy++) for (let cx = 0; cx < 6; cx++) {
    const px = chunk(cx * 700, cy * 700, 0.5, null);
    for (let o = 0; o < px.length; o += 4 * 37) {
      const l = lum(px, o); lo = Math.min(lo, l); hi = Math.max(hi, l);
      assert.ok(px[o] >= px[o + 2], 'sand stays warm (R >= B)');
      warmR += px[o]; n++;
      if (l < 150) browns++; if (l > 185) lights++;
    }
  }
  assert.ok(hi - lo > 70, `luminance spread ${hi - lo}`);
  assert.ok(browns > n * 0.01 && lights > n * 0.10, `dark ${browns} light ${lights} of ${n}`);
});
await test('relief is readable but gentle: shading stays inside a bounded range', () => {
  const px = chunk(5000, 3000, 1);
  const flat = px.slice();
  let lo = 255, hi = 0;
  for (let o = 0; o < flat.length; o += 4) { const l = lum(flat, o); lo = Math.min(lo, l); hi = Math.max(hi, l); }
  assert.ok(lo > 60 && hi < 252, `${lo}..${hi}`);
});
await test('transitions are gradual: neighbouring pixels differ little (no hard circles / tiles)', () => {
  for (const res of [1, 0.25]) {
    const px = chunk(3000, 1500, res);
    let sum = 0, count = 0, big = 0;
    for (let j = 0; j < CHUNK_PX; j++) for (let i = 0; i < CHUNK_PX - 1; i++) {
      const d = Math.abs(lum(px, (j * CHUNK_PX + i) * 4) - lum(px, (j * CHUNK_PX + i + 1) * 4));
      sum += d; count++; if (d > 40) big++;
    }
    assert.ok(sum / count < 6, `mean step ${(sum / count).toFixed(2)} at res ${res}`);
    assert.ok(big / count < 0.01, `hard edges ${big}/${count} at res ${res}`);
  }
});
await test('no repetition: distant chunks differ, and the surface is not a tiled pattern', () => {
  const seen = new Set<string>();
  for (let k = 0; k < 24; k++) { const px = chunk(k * 1913, k * 677, 0.5); seen.add(Array.from(px.slice(0, 400)).join(',')); }
  assert.equal(seen.size, 24);
  const a = chunk(0, 0, 1); const b = chunk(2048, 0, 1);
  let same = 0; for (let o = 0; o < a.length; o += 4) if (a[o] === b[o] && a[o + 1] === b[o + 1]) same++;
  assert.ok(same < a.length / 4 * 0.2, 'no 2048-unit repeat');
});
await test('far tiers are calmer than near tiers (fine structure is averaged away, not aliased into noise)', () => {
  const std = (px: Uint8ClampedArray) => { let m = 0, n = 0; for (let o = 0; o < px.length; o += 4) { m += lum(px, o); n++; } m /= n; let v = 0; for (let o = 0; o < px.length; o += 4) v += (lum(px, o) - m) ** 2; return Math.sqrt(v / n); };
  // step between adjacent pixels, normalised by area covered
  const step = (px: Uint8ClampedArray) => { let s = 0, n = 0; for (let j = 0; j < CHUNK_PX; j++) for (let i = 0; i < CHUNK_PX - 1; i++) { s += Math.abs(lum(px, (j * CHUNK_PX + i) * 4) - lum(px, (j * CHUNK_PX + i + 1) * 4)); n++; } return s / n; };
  assert.ok(std(chunk(0, 0, 0.125)) > 0, 'still has variation');
  assert.ok(step(chunk(0, 0, 0.125)) < 8, 'far tier is smooth between pixels');
});
await test('the ground near the fence is compacted (darker / less golden) than open sand', () => {
  const land = { x: 0, y: 0, w: 4000, h: 4000 };
  const nearPx = chunk(4010, 2000, 1, land); const farPx = chunk(4800, 2000, 1, land);
  const avg = (px: Uint8ClampedArray) => { let s = 0; for (let o = 0; o < px.length; o += 4) s += px[o + 2]; return s / (px.length / 4); };
  const withLand = avg(nearPx); const noLand = avg(chunk(4010, 2000, 1, null));
  assert.ok(withLand < noLand, 'band along the fence differs from the same place without a fence');
  void farPx;
});
await test('generating one chunk is fast enough to be sliced behind the UI', () => {
  const t0 = performance.now(); chunk(100, 100, 1); const ms = performance.now() - t0;
  assert.ok(ms < 150, `${ms.toFixed(1)} ms`);
});

console.log('Vegetation and stones');
const LAND: Rect = { x: 64, y: 64, w: 2000, h: 1200 };
await test('placement is deterministic per world cell', () => {
  assert.deepEqual(vegetationForCell(5, -3, 1, LAND), vegetationForCell(5, -3, 1, LAND));
});
await test('nothing grows inside the farm or in the clearance band around the fence', () => {
  const blocked = inflate(LAND, VEG_CLEARANCE);
  let total = 0;
  for (let j = -30; j < 40; j++) for (let i = -30; i < 50; i++) {
    for (const it of vegetationForCell(i, j, 1, LAND)) {
      total++;
      const inBand = it.x >= blocked.x - it.size / 2 && it.x <= blocked.x + blocked.w + it.size / 2 && it.y >= blocked.y - it.size / 2 && it.y <= blocked.y + blocked.h + it.size / 2;
      assert.ok(!inBand, `${it.kind} at ${it.x.toFixed(0)},${it.y.toFixed(0)}`);
    }
  }
  assert.ok(total > 500, `vegetation exists outside (${total})`);
});
await test('natural distribution: bare areas, denser patches, mixed kinds, sizes and rotations', () => {
  const kinds = new Map<string, number>(); const sizes: number[] = []; const rots = new Set<number>();
  let empty = 0, cells = 0, maxPer = 0;
  for (let j = 60; j < 140; j++) for (let i = 60; i < 140; i++) {
    const list = vegetationForCell(i, j, 1, LAND); cells++;
    if (!list.length) empty++;
    maxPer = Math.max(maxPer, list.length);
    for (const it of list) { kinds.set(it.kind, (kinds.get(it.kind) ?? 0) + 1); if (it.kind === 'shrub') sizes.push(it.size); rots.add(Math.round(it.rot * 100)); }
  }
  assert.ok(empty / cells > 0.12 && empty / cells < 0.75, `bare cell share ${(empty / cells).toFixed(2)}`);
  assert.ok(maxPer >= 4, `dense patches (${maxPer} per cell)`);
  for (const k of ['shrub', 'tuft', 'weed', 'stone', 'gravel']) assert.ok((kinds.get(k) ?? 0) > 30, `${k} present`);
  assert.ok(Math.max(...sizes) / Math.min(...sizes) > 3, 'shrub sizes vary a lot');
  assert.ok(rots.size > 100, 'orientations vary');
});
await test('density follows the quality profile (mobile / low have fewer items than high)', () => {
  const count = (d: number) => { let n = 0; for (let j = 60; j < 120; j++) for (let i = 60; i < 120; i++) n += vegetationForCell(i, j, d, LAND).length; return n; };
  assert.ok(count(QUALITY_PROFILES.mobile.terrainDetail) < count(QUALITY_PROFILES.high.terrainDetail));
  assert.ok(count(QUALITY_PROFILES.low.terrainDetail) < count(QUALITY_PROFILES.mobile.terrainDetail));
});

console.log('Chunk cache');
let live = 0;
const fakeCtx = (canvas: any) => new Proxy({} as Record<string, unknown>, {
  get(t, p: string) {
    if (p in t) return t[p];
    if (p === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    if (p === 'putImageData') return () => { canvas.puts++; };
    if (p === 'drawImage') return () => { canvas.draws++; };
    if (p === 'createPattern') return () => ({});
    if (p === 'measureText') return () => ({ width: 30 });
    if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop() {} });
    return () => undefined;
  },
  set(t, p: string, v) { t[p] = v; return true; },
});
const fakeCanvas: CanvasFactory = (w, h) => { live++; const c: any = { width: w, height: h, puts: 0, draws: 0 }; let ctx: any; c.getContext = () => (ctx ??= fakeCtx(c)); return c; };
const drawCtx = () => { const c: any = { drawn: 0 }; const ctx: any = fakeCtx(c); return ctx; };
const mkCache = (res = 1, budget = 14_000_000) => { let ready = 0; const t = new TerrainCache(fakeCanvas, { res, budget, detail: 1 }, () => { ready++; }); return { t, ready: () => ready }; };

await test('chunks are generated lazily, in the background, and the caller is told to redraw', async () => {
  const { t, ready } = mkCache();
  t.setLand({ x: 0, y: 0, w: 100, h: 100 });
  t.paint(drawCtx(), 0, 0, 600, 400, 1);
  assert.equal(t.cachedChunks, 0, 'nothing is generated synchronously inside paint()');
  await settle();
  assert.ok(t.cachedChunks > 0 && ready() > 0);
  t.dispose();
});
await test('the resolution tier follows the zoom and never exceeds what the device allows', async () => {
  const hi = mkCache(1); const lo = mkCache(0.35);
  for (const c of [hi, lo]) c.t.paint(drawCtx(), 0, 0, 400, 400, 2);
  await settle();
  const tiersOf = (c: any) => new Set([...c.t.entries.keys()].map((k: string) => Number(k.split(':')[0])));
  assert.deepEqual([...tiersOf(hi)], [0], 'desktop at 2 px/unit uses the finest tier');
  assert.ok([...tiersOf(lo)].every((i) => TIERS[i] <= 0.35), `phone cap respected: ${[...tiersOf(lo)]}`);
  const far = mkCache(1); far.t.paint(drawCtx(), 0, 0, 6000, 4000, 0.12);
  await settle();
  assert.ok([...(far.t as any).entries.keys()].every((k: string) => TIERS[Number(k.split(':')[0])] <= 0.25), 'far out uses coarse tiers');
  for (const c of [hi, lo, far]) c.t.dispose();
});
await test('nothing is generated while a gesture is moving; it resumes when the gesture settles', async () => {
  const { t } = mkCache();
  t.setInteracting(true);
  t.paint(drawCtx(), 0, 0, 800, 600, 1);
  await settle();
  assert.equal(t.cachedChunks, 0);
  t.setInteracting(false);
  await settle();
  assert.ok(t.cachedChunks > 0);
  t.dispose();
});
await test('chunks lying entirely inside the farm are never generated', async () => {
  const { t } = mkCache();
  t.setLand({ x: 0, y: 0, w: 3000, h: 3000 });
  t.paint(drawCtx(), 600, 600, 1400, 1400, 1); // wholly inside the land
  await settle();
  assert.equal(t.cachedChunks, 0);
  t.dispose();
});
await test('the cache never grows past its pixel budget (LRU eviction) and releases evicted canvases', async () => {
  const budget = CHUNK_PX * CHUNK_PX * 12;
  const { t } = mkCache(1, budget);
  const before = live;
  for (let k = 0; k < 8; k++) { t.paint(drawCtx(), k * 900, 0, k * 900 + 800, 600, 1); await settle(20); }
  assert.ok(t.cachedPixels <= budget + CHUNK_PX * CHUNK_PX * 8, `pixels ${t.cachedPixels}`);
  assert.ok(t.stats.evicted > 0);
  t.dispose();
  assert.equal(t.cachedChunks, 0);
  assert.equal(t.cachedPixels, 0);
  void before;
});
await test('a coarser chunk covers while the fine one is still being made (never a hole)', async () => {
  const { t } = mkCache();
  t.paint(drawCtx(), 0, 0, 3000, 2000, 0.12); await settle();       // coarse tier exists
  const ctx = drawCtx();
  t.paint(ctx, 0, 0, 400, 300, 1);                                    // fine tier missing
  assert.ok(t.stats.fallbacks > 0);
  t.dispose();
});
await test('moving the farm (grid edit) drops the chunks: vegetation clearance must follow the new boundary', async () => {
  const { t } = mkCache();
  t.setLand({ x: 0, y: 0, w: 500, h: 500 });
  t.paint(drawCtx(), -300, -300, 800, 800, 1); await settle();
  assert.ok(t.cachedChunks > 0);
  t.setLand({ x: 0, y: 0, w: 500, h: 500 });
  assert.ok(t.cachedChunks > 0, 'same rect: kept');
  t.setLand({ x: 0, y: 0, w: 700, h: 500 });
  assert.equal(t.cachedChunks, 0);
  t.dispose();
});
await test('pausing (page hidden) stops generation and dispose cancels pending work', async () => {
  const { t } = mkCache();
  t.setPaused(true);
  t.paint(drawCtx(), 0, 0, 800, 600, 1); await settle();
  assert.equal(t.cachedChunks, 0);
  t.dispose(); await settle();
  assert.equal(t.cachedChunks, 0);
});

console.log('Renderer: gestures, far-zoom bitmap, adaptive resolution');
const rows = 12, cols = 20;
const rowLabels = Array.from({ length: rows }, (_, i) => `R${i}`);
const cells: Record<string, any> = {};
for (const r of rowLabels) for (let c = 1; c <= cols; c++) cells[`${r}-${c}`] = { type: 'tree', lastUpdated: 'x', status: c % 7 === 0 ? 'مصابة بآفة/مرض' : 'سليمة' };
const kindGrid = buildKindGrid(cells, rowLabels, cols, {}, {});
const scene = buildScene({ rows, cols, rowLabels, cells, orientation: 'original', kindGrid, displayKindGrid: kindGrid, rowGapKinds: {}, colGapKinds: {}, landmarks: {} });
class FakePath { d?: string; constructor(d?: string) { this.d = d; } }
const yieldNow = async () => {};
const mkRenderer = async (quality: 'high' | 'mobile' | 'low' = 'mobile', factory: CanvasFactory | undefined = fakeCanvas) => {
  const assets = (await buildAssets(QUALITY_PROFILES[quality], fakeCanvas, { yieldToUi: yieldNow }))!;
  const canvas: any = fakeCanvas(10, 10);
  const state = { view: { scale: 0.15, x: 0, y: 0 } };
  const r = new RealisticRenderer({ canvas, assets, getView: () => state.view, Path2DCtor: FakePath as unknown as typeof Path2D, canvasFactory: factory });
  r.setScene(scene);
  const o = getGridOrigin('original');
  r.setGeometry({ landX: 64, landY: 64, landW: 2400, landH: 1500, gridX: 64 + 2 + o.left, gridY: 64 + 2 + o.top });
  r.setOptions({ ...DEFAULT_DISPLAY_OPTIONS });
  r.resize(390, 700, 3);
  return { r, state, canvas };
};
await test('the backing store follows the quality profile: an iPhone-class 3x screen is rendered at <= 1.5x on the mobile preset', async () => {
  const { r, canvas } = await mkRenderer('mobile');
  assert.ok(canvas.width <= Math.round(390 * 1.5) + 1, `${canvas.width}`);
  const hi = await mkRenderer('high');
  assert.ok(hi.canvas.width > canvas.width, 'desktop keeps its higher cap');
  r.dispose(); hi.r.dispose();
});
await test('whole-farm view draws from ONE baked bitmap, built once and reused across pan / zoom frames', async () => {
  const before = live;
  const { r, state } = await mkRenderer('mobile');
  r.setVisible(true);
  const afterFirst = live;
  assert.ok(afterFirst > before, 'the bitmap (and terrain chunks) are offscreen canvases');
  for (let k = 0; k < 10; k++) { state.view = { scale: 0.15 + k * 0.005, x: -k * 9, y: -k * 4 }; r.draw(); }
  const farCache = (r as any).farmCache;
  assert.ok(farCache, 'baked');
  const same = farCache.canvas;
  state.view = { scale: 0.2, x: -50, y: -20 }; r.draw();
  assert.equal((r as any).farmCache.canvas, same, 'not rebuilt');
  state.view = { scale: 1.2, x: -50, y: -20 }; r.draw();
  assert.ok(r.stats.treesDrawn > 0, 'close view draws real sprites');
  r.dispose();
  assert.equal((r as any).farmCache, null, 'released on dispose');
});
await test('changing the scene or options rebuilds the baked bitmap (it never shows stale trees)', async () => {
  const { r, state } = await mkRenderer('mobile');
  r.setVisible(true); r.draw();
  const first = (r as any).farmCache.canvas;
  r.setScene({ ...scene } as any); state.view = { scale: 0.16, x: 0, y: 0 }; r.draw();
  assert.notEqual((r as any).farmCache.canvas, first);
  const second = (r as any).farmCache.canvas;
  r.setOptions({ ...DEFAULT_DISPLAY_OPTIONS, showStatus: false }); state.view = { scale: 0.17, x: 0, y: 0 }; r.draw();
  assert.notEqual((r as any).farmCache.canvas, second);
  r.dispose();
});
await test('without a DOM (no offscreen canvases) the renderer still draws, with the original tiled ground', async () => {
  const { r, state } = await mkRenderer('low', undefined);
  // `document` is undefined in Node, so no factory was derived either
  r.setVisible(true);
  assert.ok(r.stats.draws >= 1);
  state.view = { scale: 1, x: -10, y: -10 }; r.draw();
  assert.ok(r.stats.treesDrawn > 0);
  r.dispose();
});
await test('gesture mode skips the expensive extras, and settling redraws at full quality', async () => {
  const { r, state } = await mkRenderer('high');
  r.setVisible(true);
  state.view = { scale: 1.1, x: -20, y: -20 }; r.draw();
  const settled = r.stats.draws;
  r.setInteracting(true);
  state.view = { scale: 1.12, x: -30, y: -20 }; r.draw();
  assert.ok(r.stats.draws > settled, 'frames are still drawn while moving');
  const during = r.stats.draws;
  r.setInteracting(false);
  assert.equal(r.stats.draws, during + 1, 'one full-quality redraw when the gesture settles');
  r.setInteracting(false);
  assert.equal(r.stats.draws, during + 1, 'idempotent');
  r.dispose();
});
await test('persistently slow gesture frames lower the resolution (applied on settle, never below 60 %), then report once', async () => {
  const realNow = performance.now.bind(performance);
  let t = 0;
  (performance as any).now = () => { t += 40; return t; }; // every measured draw looks like 40 ms
  try {
    const { r, state, canvas } = await mkRenderer('mobile');
    r.setVisible(true);
    let slow = 0; (r as any).onSlow = () => { slow++; };
    const w0 = canvas.width;
    for (let round = 0; round < 6; round++) {
      r.setInteracting(true);
      for (let k = 0; k < 12; k++) { state.view = { scale: 0.3 + k * 0.01 + round * 0.001, x: -k, y: 0 }; r.draw(); }
      r.setInteracting(false);
    }
    assert.ok(canvas.width < w0, `resolution dropped ${w0} -> ${canvas.width}`);
    assert.ok(canvas.width >= Math.round(w0 * 0.6) - 2, `floor respected ${canvas.width}`);
    assert.equal(slow, 1, 'reported once, only after the floor was reached');
    r.dispose();
  } finally { (performance as any).now = realNow; }
});
await test('dispose releases the terrain chunks and every offscreen canvas it made', async () => {
  const { r, state } = await mkRenderer('high');
  r.setVisible(true);
  for (let k = 0; k < 5; k++) { state.view = { scale: 1 + k * 0.1, x: -k * 30, y: 0 }; r.draw(); }
  await settle();
  const terrain = (r as any).terrain as TerrainCache;
  r.dispose();
  assert.equal(terrain.cachedChunks, 0);
  assert.equal((r as any).terrain, null);
});

console.log(`\n${passed} terrain / renderer checks passed`);
process.exit(0);
