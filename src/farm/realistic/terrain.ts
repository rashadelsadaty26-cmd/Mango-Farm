// ============================================================================
// Procedural sandy terrain for the ground AROUND the farm (Realistic mode).
//
// Everything is generated locally from world coordinates: no image files, no
// network, works offline. The same (x, y) always gives the same ground, so the
// landscape is continuous across chunks and zoom levels and never repeats.
//
// WHAT IS DRAWN (drone view, light from the upper left)
//   * A height field made of broad dunes, small wind-aligned dune crests,
//     shallow hollows and (when close) fine wind ripples. It is turned into
//     shading by a directional light, plus a soft occlusion in hollows - the
//     relief is readable but never exaggerated.
//   * Four ground tones - light beige, warm golden, darker compacted sand and
//     brown earth - blended by slow noise fields, so there are no circles, tiles
//     or hard edges; faint wind streaks and a little grain.
//   * Trampled, compacted ground hugging the fence.
//   * Sparse vegetation and stones: dry shrubs, straw grass tufts, small weeds
//     (a few more near the fence, where water collects), pebbles and gravel.
//     Placed per 96-unit world cell from a deterministic RNG, with bare areas and
//     slightly denser patches.
//
// HOW IT STAYS CHEAP
//   * The world is cut into square chunks of CHUNK_PX x CHUNK_PX pixels at a
//     resolution TIER (1, 1/2, 1/4, 1/8, 1/16 px per map unit). Far out, a chunk
//     covers a large area with few pixels; close up it covers a small one. A pan
//     or zoom frame is therefore a handful of drawImage calls.
//   * Chunks are generated lazily in small time slices, never while the user is
//     panning / zooming, and kept in an LRU cache with a hard pixel budget.
//   * While a chunk is missing the nearest coarser one is drawn (scaled), so
//     there is never a hole.
//   * Chunks that lie entirely inside the farm are skipped (the soil is drawn
//     over them anyway), and vegetation is never placed inside the farm or in the
//     clearance band around the fence (that band holds the edit controls).
//
// The pure functions at the top have no DOM dependency (verified in Node).
// ============================================================================

export interface Rect { x: number; y: number; w: number; h: number }

export const CHUNK_PX = 128;
export const TIERS = [1, 0.5, 0.25, 0.125, 0.0625] as const;
/** World size (map units) of one vegetation cell. */
export const VEG_CELL = 96;
/** Vegetation never grows within this distance of the farm's outer boundary. */
export const VEG_CLEARANCE = 100;

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

function hash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0,1]. */
export function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x); const iy = Math.floor(y);
  const fx = x - ix; const fy = y - iy;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash(ix, iy, seed); const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed); const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const smooth = (t: number, a: number, b: number) => {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
const cellSeed = (i: number, j: number) => (Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ 0x5bd1e995) >>> 0;

// ---------------------------------------------------------------------------
// Ground shading (pure)
// ---------------------------------------------------------------------------

export interface ShadeParams {
  /** Pixels per map unit of this tier. */
  res: number;
  /** The farm's land rect (map units). Used only for the compacted band near the fence. */
  land: Rect | null;
}

const WIND = 0.42; // radians: direction the sand is combed in
const CA = Math.cos(WIND); const SA = Math.sin(WIND);
const LIGHT: [number, number, number] = [-0.52, -0.62, 0.59];
const LIGHT_LEN = Math.hypot(...LIGHT);

type RGB = [number, number, number];
const C_LIGHT: RGB = [235, 218, 178];
const C_GOLD: RGB = [225, 189, 120];
const C_COMPACT: RGB = [190, 162, 116];
const C_EARTH: RGB = [158, 123, 86];

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Distance (map units) from a point to the outside of a rect; 0 inside. */
function distOutside(x: number, y: number, r: Rect): number {
  const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
  const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

interface Field { h: number; hollow: number; compact: number }

const RA = Math.cos(0.63); const RB = Math.sin(0.63);
/** Warped + rotated coordinates for the blotchy colour / hollow fields: no grid-aligned shapes. */
function blotch(x: number, y: number, out: { u: number; v: number }): void {
  const wx = x + (vnoise(x / 260 + 2, y / 260, 41) - 0.5) * 230;
  const wy = y + (vnoise(x / 240, y / 250 + 5, 42) - 0.5) * 230;
  out.u = wx * RA + wy * RB; out.v = -wx * RB + wy * RA;
}
const BL = { u: 0, v: 0 };

function field(x: number, y: number, lod: number, out: Field): void {
  let wx = x; let wy = y;
  if (lod >= 1) { // domain warp: bends crests and patches into natural, irregular shapes
    wx += (vnoise(x / 310, y / 310, 11) - 0.5) * 140;
    wy += (vnoise(x / 290 + 7, y / 290, 12) - 0.5) * 140;
  }
  const big = vnoise(wx / 950, wy / 760, 13) * 0.55 + vnoise(wx / 410, wy / 300, 14) * 0.28;
  let h = big;
  if (lod >= 1) {
    const rx = wx * CA + wy * SA; const ry = -wx * SA + wy * CA;
    const crest = 1 - Math.abs(vnoise(rx / 240, ry / 95, 15) * 2 - 1);
    h += crest * crest * 0.05 * smooth(vnoise(wx / 700, wy / 650, 16), 0.35, 0.65);
  }
  blotch(x, y, BL);
  const hollow = smooth(vnoise(BL.u / 520 + 3, BL.v / 430, 17) * 0.75 + vnoise(BL.u / 170, BL.v / 150, 43) * 0.25, 0.6, 0.78);
  h -= hollow * 0.1;
  const compact = smooth(vnoise(BL.u / 340, BL.v / 300, 20) * 0.8 + vnoise(BL.u / 120, BL.v / 110, 44) * 0.2, 0.55, 0.76);
  if (lod >= 2) { // fine wind ripples, only in loose (not compacted) sand
    const ph = (x * CA + y * SA) / 8.5 + vnoise(x / 60, y / 60, 18) * 5;
    h += Math.sin(ph * 6.2832) * 0.00032 * smooth(vnoise(x / 280, y / 240, 19), 0.5, 0.85) * (1 - compact);
  }
  out.h = h; out.hollow = hollow; out.compact = compact;
}

/**
 * Fills `px` (RGBA, size*size) with the ground whose top-left corner is (wx0, wy0) in map
 * units. Deterministic and continuous: pixel centres are at world position (wx0 + (i+.5)/res).
 */
export function shadeChunk(px: Uint8ClampedArray, size: number, wx0: number, wy0: number, p: ShadeParams): void {
  const { res, land } = p;
  const lod = res >= 0.4 ? 2 : res >= 0.2 ? 1 : 0;
  // Far out the same landscape is drawn calmer: the fine structure is averaged away instead of aliasing into noise.
  const con = lod >= 2 ? 1 : lod === 1 ? 0.7 : 0.45;
  const n = size + 2;
  const H = new Float32Array(n * n);
  const HO = new Float32Array(n * n);
  const CP = new Float32Array(n * n);
  const f: Field = { h: 0, hollow: 0, compact: 0 };
  for (let j = -1; j <= size; j++) {
    for (let i = -1; i <= size; i++) {
      field(wx0 + (i + 0.5) / res, wy0 + (j + 0.5) / res, lod, f);
      const k = (j + 1) * n + (i + 1);
      H[k] = f.h; HO[k] = f.hollow; CP[k] = f.compact;
    }
  }
  // Slope exaggeration: slopes are tiny per map unit, so scale them up to a gentle, readable relief.
  const K = 230;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = (j + 1) * n + (i + 1);
      const x = wx0 + (i + 0.5) / res; const y = wy0 + (j + 0.5) / res;
      const dhx = (H[k + 1] - H[k - 1]) * res * 0.5;
      const dhy = (H[k + n] - H[k - n]) * res * 0.5;
      const nx = -K * dhx; const ny = -K * dhy;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const lam = (nx * LIGHT[0] + ny * LIGHT[1] + LIGHT[2]) * inv / LIGHT[2];
      const lit = Math.min(1.22, Math.max(0.62, 0.9 + 0.5 * (lam - 1) * con));
      const hollow = HO[k] * con; const compact = CP[k] * (0.4 + 0.6 * con);

      blotch(x, y, BL);
      const warm = vnoise(BL.u / 700 + 9, BL.v / 600, 21);
      const earth = smooth(vnoise(BL.u / 250, BL.v / 210 + 5, 22) * 0.8 + vnoise(BL.u / 90, BL.v / 80, 45) * 0.2, 0.7, 0.86);
      let c = mix(C_LIGHT, C_GOLD, warm);
      c = mix(c, C_COMPACT, compact * 0.85);
      c = mix(c, C_EARTH, earth * 0.75 * con);
      if (land) {
        const t = Math.max(0, 1 - distOutside(x, y, land) / 70);
        if (t > 0) c = mix(c, C_COMPACT, t * 0.38); // trampled ground along the fence
      }
      let m = lit * (1 - 0.12 * hollow);
      if (lod >= 1) {
        // faint wind streaks combed along the wind direction
        const streak = vnoise((x * CA + y * SA) / 260, (-x * SA + y * CA) / 3.2, 23);
        m *= 0.97 + 0.06 * streak * smooth(vnoise(x / 400, y / 380, 24), 0.3, 0.7);
      }
      if (lod >= 2) m *= 0.97 + 0.06 * hash(Math.floor(x * 3.1), Math.floor(y * 3.1), 25); // grain
      const o = (j * size + i) * 4;
      px[o] = Math.max(0, Math.min(255, c[0] * m));
      px[o + 1] = Math.max(0, Math.min(255, c[1] * m));
      px[o + 2] = Math.max(0, Math.min(255, c[2] * m * 0.99));
      px[o + 3] = 255;
    }
  }
}

// ---------------------------------------------------------------------------
// Vegetation + stones (pure placement, canvas drawing)
// ---------------------------------------------------------------------------

export type VegKind = 'shrub' | 'tuft' | 'weed' | 'stone' | 'gravel';
export interface VegItem { kind: VegKind; x: number; y: number; size: number; rot: number; seed: number; tone: number }

/** The farm's land rect inflated by the clearance. Items inside it are dropped. */
export const inflate = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 });
const inside = (x: number, y: number, r: Rect) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/**
 * Everything that grows or lies in world cell (ci, cj). `detail` (0..1) scales the density.
 * `land` is the farm: nothing is placed within VEG_CLEARANCE of it.
 */
export function vegetationForCell(ci: number, cj: number, detail: number, land: Rect | null): VegItem[] {
  const out: VegItem[] = [];
  const r = rng(cellSeed(ci, cj));
  const x0 = ci * VEG_CELL; const y0 = cj * VEG_CELL;
  const cx = x0 + VEG_CELL / 2; const cy = y0 + VEG_CELL / 2;
  const blocked = land ? inflate(land, VEG_CLEARANCE) : null;
  const place = (kind: VegKind, size: number, tone: number): void => {
    const x = x0 + r() * VEG_CELL; const y = y0 + r() * VEG_CELL;
    if (blocked && inside(x, y, inflate(blocked, size / 2))) return;
    out.push({ kind, x, y, size, rot: r() * Math.PI * 2, seed: Math.floor(r() * 1e9), tone });
  };
  // Slow density field: bare stretches and slightly denser patches.
  const dens = vnoise(cx / 620 + 4, cy / 520, 31);
  const patch = Math.max(0, dens - 0.42) * 1.7; // 0 in bare areas
  const nearFence = land ? Math.max(0, 1 - distOutside(cx, cy, land) / 420) : 0;
  const d = Math.max(0.05, detail);

  if (r() < (0.06 + 0.45 * patch) * d) place('shrub', 8 + r() * r() * 26 + patch * 6, r());
  if (r() < 0.07 * d && patch > 0.05) place('shrub', 34 + r() * 26, r()); // the odd big dry bush
  const tufts = (patch > 0.02 ? 1 : 0) + (r() < 0.45 ? 1 : 0) + (patch > 0.35 ? 1 : 0);
  for (let t = 0; t < tufts; t++) if (r() < 0.8 * d) place('tuft', 7 + r() * 8, r());
  const weeds = r() < (0.10 + 0.5 * nearFence) * d ? 1 + Math.floor(r() * 2) : 0;
  for (let t = 0; t < weeds; t++) place('weed', 5 + r() * 5, r());
  if (r() < 0.34 * d) { const k = 1 + Math.floor(r() * 4); for (let t = 0; t < k; t++) place('stone', 1.6 + r() * r() * 5.5, r()); }
  if (r() < 0.22 * d) place('gravel', 10 + r() * 14, r());
  return out;
}

type Ctx2D = CanvasRenderingContext2D;

const SHRUB_TONES = ['#86825e', '#98926d', '#76724f', '#a39d7a'];
const STRAW_TONES = ['#c9b36a', '#b49a4f', '#d8c58a', '#bfa860'];
const WEED_TONES = ['#8a9a5a', '#7a8c52', '#98a468'];
const STONE_TONES = ['#a89f8d', '#8c8272', '#bdb4a0', '#9a8f7c'];

/** Draws one item. `res` is the pixel density of the target chunk: tiny details are skipped when they would be sub-pixel. */
export function drawVegItem(ctx: Ctx2D, it: VegItem, res: number): void {
  const px = it.size * res;
  if (px < 0.9 && it.kind !== 'gravel') return;
  const r = rng(it.seed);
  ctx.save();
  ctx.translate(it.x, it.y);
  switch (it.kind) {
    case 'shrub': {
      const R = it.size / 2;
      ctx.fillStyle = 'rgba(52,40,22,0.24)';
      ctx.beginPath(); ctx.ellipse(R * 0.35, R * 0.45, R * 1.15, R * 0.8, it.rot, 0, Math.PI * 2); ctx.fill();
      if (px < 5) { // distant: one soft blob
        ctx.fillStyle = SHRUB_TONES[Math.floor(it.tone * SHRUB_TONES.length)];
        ctx.beginPath(); ctx.ellipse(0, 0, R, R * 0.85, it.rot, 0, Math.PI * 2); ctx.fill();
        break;
      }
      const lobes = 5 + Math.floor(r() * 5);
      for (let l = 0; l < lobes; l++) {
        const a = r() * Math.PI * 2; const dd = r() * R * 0.55; const lr = R * (0.32 + r() * 0.3);
        ctx.fillStyle = SHRUB_TONES[Math.floor(r() * SHRUB_TONES.length)];
        ctx.beginPath(); ctx.ellipse(Math.cos(a) * dd, Math.sin(a) * dd, lr, lr * (0.7 + r() * 0.3), r() * 3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = 'rgba(235,236,190,0.22)';
      ctx.beginPath(); ctx.ellipse(-R * 0.25, -R * 0.3, R * 0.45, R * 0.32, it.rot, 0, Math.PI * 2); ctx.fill();
      if (px >= 9) { // dry twigs
        ctx.strokeStyle = 'rgba(86,66,40,0.55)'; ctx.lineWidth = Math.max(0.5, R * 0.07); ctx.lineCap = 'round';
        for (let t = 0; t < 4; t++) { const a = r() * Math.PI * 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9); ctx.stroke(); }
      }
      break;
    }
    case 'tuft':
    case 'weed': {
      const tones = it.kind === 'tuft' ? STRAW_TONES : WEED_TONES;
      const blades = it.kind === 'tuft' ? 7 + Math.floor(r() * 6) : 5 + Math.floor(r() * 4);
      ctx.lineCap = 'round';
      for (let b = 0; b < blades; b++) {
        const a = it.rot + (r() - 0.5) * 2.4; const len = it.size * (0.5 + r() * 0.6);
        ctx.strokeStyle = tones[Math.floor(r() * tones.length)];
        ctx.lineWidth = Math.max(0.5, it.size * 0.09);
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(Math.cos(a) * len * 0.5 + (r() - 0.5) * 2, Math.sin(a) * len * 0.5, Math.cos(a) * len, Math.sin(a) * len);
        ctx.stroke();
      }
      break;
    }
    case 'stone': {
      const R = it.size / 2;
      ctx.fillStyle = 'rgba(52,40,22,0.28)';
      ctx.beginPath(); ctx.ellipse(R * 0.45, R * 0.5, R * 1.1, R * 0.8, it.rot, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = STONE_TONES[Math.floor(it.tone * STONE_TONES.length)];
      ctx.beginPath(); ctx.ellipse(0, 0, R, R * 0.78, it.rot, 0, Math.PI * 2); ctx.fill();
      if (px >= 3) { ctx.fillStyle = 'rgba(255,250,235,0.35)'; ctx.beginPath(); ctx.ellipse(-R * 0.3, -R * 0.3, R * 0.45, R * 0.3, it.rot, 0, Math.PI * 2); ctx.fill(); }
      break;
    }
    case 'gravel': {
      const n = 6 + Math.floor(r() * 9);
      for (let g = 0; g < n; g++) {
        const gx = (r() - 0.5) * it.size; const gy = (r() - 0.5) * it.size; const gr = 0.5 + r() * 0.9;
        ctx.fillStyle = STONE_TONES[Math.floor(r() * STONE_TONES.length)];
        ctx.beginPath(); ctx.arc(gx, gy, gr, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Chunk cache
// ---------------------------------------------------------------------------

export type CanvasFactoryLike = (w: number, h: number) => any;

export interface TerrainConfig {
  /** Highest tier resolution (px per map unit) this device generates. */
  res: number;
  /** Hard cap on cached chunk pixels. */
  budget: number;
  /** 0..1 vegetation density. */
  detail: number;
}

interface Entry { canvas: any; tier: number; cx: number; cy: number; used: number }

const FLAT = '#d9c496';
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class TerrainCache {
  private entries = new Map<string, Entry>();
  private pixels = 0;
  private frame = 0;
  private queue: Array<{ key: string; tier: number; cx: number; cy: number }> = [];
  private queued = new Set<string>();
  private land: Rect | null = null;
  private interacting = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private paused = false;
  public stats = { generated: 0, evicted: 0, drawn: 0, fallbacks: 0, flat: 0 };

  private factory: CanvasFactoryLike;
  private cfg: TerrainConfig;
  private onReady: () => void;

  constructor(factory: CanvasFactoryLike, cfg: TerrainConfig, onReady: () => void) {
    this.factory = factory;
    this.cfg = cfg;
    this.onReady = onReady;
  }

  get cachedChunks() { return this.entries.size; }
  get cachedPixels() { return this.pixels; }

  /** The farm rect. A change drops every chunk (vegetation clearance moved). */
  setLand(land: Rect | null) {
    const same = this.land && land && this.land.x === land.x && this.land.y === land.y && this.land.w === land.w && this.land.h === land.h;
    if (same || (!this.land && !land)) return;
    this.land = land;
    this.clear();
  }

  setInteracting(on: boolean) {
    if (this.interacting === on) return;
    this.interacting = on;
    if (!on) this.schedule();
  }

  /** Pause generation (page hidden / realistic not visible). */
  setPaused(paused: boolean) {
    this.paused = paused;
    if (!paused) this.schedule();
  }

  clear() {
    for (const e of this.entries.values()) this.release(e);
    this.entries.clear();
    this.pixels = 0;
    this.queue = [];
    this.queued.clear();
  }

  dispose() {
    this.disposed = true;
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    this.clear();
  }

  private release(e: Entry) { try { e.canvas.width = 0; e.canvas.height = 0; } catch { /* ignore */ } }

  /** The coarsest allowed tier that is still at least ~0.8x as sharp as the screen needs (else the finest allowed). */
  private tierFor(pxPerUnit: number): number {
    let chosen = TIERS.length - 1;
    for (let t = TIERS.length - 1; t >= 0; t--) {
      if (TIERS[t] > this.cfg.res + 1e-9) continue; // finer than this device generates
      chosen = t;
      if (TIERS[t] >= pxPerUnit * 0.8) break;
    }
    return chosen;
  }

  private worldSize(tier: number) { return CHUNK_PX / TIERS[tier]; }

  /**
   * Draws the terrain covering the visible rect (map units). `ctx` already has the map transform
   * applied. Chunks wholly inside the farm are skipped.
   */
  paint(ctx: Ctx2D, vx0: number, vy0: number, vx1: number, vy1: number, pxPerUnit: number): void {
    if (this.disposed) return;
    this.frame++;
    const tier = this.tierFor(pxPerUnit);
    const size = this.worldSize(tier);
    const c0 = Math.floor(vx0 / size); const c1 = Math.floor(vx1 / size);
    const r0 = Math.floor(vy0 / size); const r1 = Math.floor(vy1 / size);
    const eps = 0.6 / Math.max(pxPerUnit, 1e-6); // overlap by ~half a device pixel: no seams
    const land = this.land;
    const wanted: Array<{ key: string; tier: number; cx: number; cy: number }> = [];
    const cxm = (vx0 + vx1) / 2; const cym = (vy0 + vy1) / 2;

    ctx.fillStyle = FLAT;
    ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0); // base: never a hole, even before the first chunk exists

    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const x = cx * size; const y = cy * size;
        if (land && x >= land.x && y >= land.y && x + size <= land.x + land.w && y + size <= land.y + land.h) continue; // fully inside the farm
        const key = `${tier}:${cx}:${cy}`;
        const e = this.entries.get(key);
        if (e) { e.used = this.frame; ctx.drawImage(e.canvas, x - eps, y - eps, size + eps * 2, size + eps * 2); this.stats.drawn++; continue; }
        if (!this.queued.has(key)) wanted.push({ key, tier, cx, cy });
        this.drawFallback(ctx, tier, cx, cy, size, eps);
      }
    }
    if (wanted.length) {
      wanted.sort((a, b) => Math.hypot((a.cx + 0.5) * size - cxm, (a.cy + 0.5) * size - cym) - Math.hypot((b.cx + 0.5) * size - cxm, (b.cy + 0.5) * size - cym));
      for (const w of wanted) { this.queue.push(w); this.queued.add(w.key); }
      this.schedule();
    }
  }

  /** The nearest coarser chunk that already exists, scaled up; otherwise the flat base shows through. */
  private drawFallback(ctx: Ctx2D, tier: number, cx: number, cy: number, size: number, eps: number) {
    const x = cx * size; const y = cy * size;
    for (let t = tier + 1; t < TIERS.length; t++) {
      const bigSize = this.worldSize(t);
      const bx = Math.floor(x / bigSize); const by = Math.floor(y / bigSize);
      const e = this.entries.get(`${t}:${bx}:${by}`);
      if (!e) continue;
      e.used = this.frame;
      const sx = ((x - bx * bigSize) / bigSize) * CHUNK_PX; const sy = ((y - by * bigSize) / bigSize) * CHUNK_PX;
      const sw = (size / bigSize) * CHUNK_PX;
      ctx.drawImage(e.canvas, sx, sy, sw, sw, x - eps, y - eps, size + eps * 2, size + eps * 2);
      this.stats.fallbacks++;
      return;
    }
    this.stats.flat++;
  }

  private schedule() {
    if (this.timer !== null || this.disposed || this.paused || this.interacting || !this.queue.length) return;
    this.timer = setTimeout(() => { this.timer = null; this.pump(); }, 0);
  }

  /** Generates queued chunks for about `budgetMs`, then yields to the browser. Never runs mid-gesture. */
  private pump() {
    if (this.disposed || this.paused || this.interacting) return;
    const start = now();
    let made = 0;
    while (this.queue.length && now() - start < 9) {
      const job = this.queue.shift() as { key: string; tier: number; cx: number; cy: number };
      this.queued.delete(job.key);
      if (this.entries.has(job.key)) continue;
      this.generate(job.tier, job.cx, job.cy);
      made++;
    }
    if (made) this.onReady();
    this.evict();
    this.schedule();
  }

  /** Synchronously generate one chunk (also used by tests). */
  generate(tier: number, cx: number, cy: number): void {
    const res = TIERS[tier];
    const size = this.worldSize(tier);
    const canvas = this.factory(CHUNK_PX, CHUNK_PX);
    const ctx = canvas.getContext('2d') as Ctx2D;
    const img = ctx.createImageData(CHUNK_PX, CHUNK_PX);
    shadeChunk(img.data, CHUNK_PX, cx * size, cy * size, { res, land: this.land });
    ctx.putImageData(img, 0, 0);

    // vegetation + stones: only at resolutions where they are worth drawing
    if (res >= 0.12) {
      const margin = 70; // items are drawn in every chunk they touch
      const i0 = Math.floor((cx * size - margin) / VEG_CELL); const i1 = Math.floor(((cx + 1) * size + margin) / VEG_CELL);
      const j0 = Math.floor((cy * size - margin) / VEG_CELL); const j1 = Math.floor(((cy + 1) * size + margin) / VEG_CELL);
      ctx.save();
      ctx.setTransform(res, 0, 0, res, -cx * size * res, -cy * size * res);
      const detail = res >= 0.4 ? this.cfg.detail : this.cfg.detail * 0.8;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        for (const it of vegetationForCell(i, j, detail, this.land)) {
          if (res < 0.3 && it.kind !== 'shrub') continue;
          drawVegItem(ctx, it, res);
        }
      }
      ctx.restore();
    }
    this.entries.set(`${tier}:${cx}:${cy}`, { canvas, tier, cx, cy, used: this.frame });
    this.pixels += CHUNK_PX * CHUNK_PX;
    this.stats.generated++;
  }

  /** LRU: drop the least recently drawn chunks until the budget fits (never the ones drawn this frame). */
  private evict() {
    if (this.pixels <= this.cfg.budget) return;
    const list = [...this.entries.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [key, e] of list) {
      if (this.pixels <= this.cfg.budget) break;
      if (e.used === this.frame) continue;
      this.release(e);
      this.entries.delete(key);
      this.pixels -= CHUNK_PX * CHUNK_PX;
      this.stats.evicted++;
    }
  }
}
