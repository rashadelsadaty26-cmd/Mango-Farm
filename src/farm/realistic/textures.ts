// ============================================================================
// Procedural assets for Realistic mode. Nothing here is downloaded and nothing
// calls an image-generation service: every texture is synthesised locally from a
// seeded PRNG, so the mode works offline and a given farm always looks the same.
//
//   ground tiles   seamless sand / dirt-road / water / concrete tiles (noise + pebbles)
//   macro map      one small low-frequency tint map stretched over the whole land
//   canopies       a handful of mango-crown sprites (+ 2 mip levels + a soft shadow)
//   basin          the wet ring around a tree trunk
//
// The number of canvases is bounded by the quality profile and independent of the
// number of trees (a tree only PICKS a sprite). Every canvas is created through
// one tracked factory so dispose() can release all of them and tests can prove it.
//
// No DOM access except through the injected CanvasFactory, so this file also runs
// in Node (scripts/verify-realistic.ts uses a fake factory).
// ============================================================================

import type { QualityProfile } from './quality.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Cnv = any; // HTMLCanvasElement | OffscreenCanvas | node-canvas Canvas
export type Ctx = CanvasRenderingContext2D;
export type CanvasFactory = (width: number, height: number) => Cnv;

export const defaultCanvasFactory: CanvasFactory = (width, height) => {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
};

// ---------------------------------------------------------------------------
// Seeded randomness + tileable value noise
// ---------------------------------------------------------------------------

export function makeRng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise on a lattice of `freq` cells that wraps, so tiles repeat without seams. */
function tileNoise(u: number, v: number, freq: number, seed: number): number {
  const x = u * freq;
  const y = v * freq;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const xa = ((x0 % freq) + freq) % freq;
  const ya = ((y0 % freq) + freq) % freq;
  const xb = (xa + 1) % freq;
  const yb = (ya + 1) % freq;
  const a = hash2(xa, ya, seed);
  const b = hash2(xb, ya, seed);
  const c = hash2(xa, yb, seed);
  const d = hash2(xb, yb, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(u: number, v: number, baseFreq: number, octaves: number, seed: number): number {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let f = baseFreq;
  for (let i = 0; i < octaves; i++) {
    sum += amp * tileNoise(u, v, f, seed + i * 31);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

type RGB = [number, number, number];
const hex = (s: string): RGB => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

// ---------------------------------------------------------------------------
// Tileable ground textures
// ---------------------------------------------------------------------------

interface TileSpec {
  dark: RGB;
  mid: RGB;
  light: RGB;
  baseFreq: number;
  octaves: number;
  /** Per-pixel grain amplitude, 0..1 of full range. */
  grain: number;
  seed: number;
  pebbles: number;
  pebbleDark: string;
  pebbleLight: string;
}

function paintTile(create: CanvasFactory, size: number, spec: TileSpec): Cnv {
  const canvas = create(size, size);
  const ctx = canvas.getContext('2d') as Ctx;
  const img = ctx.createImageData(size, size);
  const data = img.data;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const n = fbm(u, v, spec.baseFreq, spec.octaves, spec.seed);
      // Stretch the (narrow) fbm range so the three stops are all visible.
      const t = Math.min(1, Math.max(0, (n - 0.28) * 2.1));
      const c = t < 0.5 ? mix(spec.dark, spec.mid, t * 2) : mix(spec.mid, spec.light, (t - 0.5) * 2);
      const g = (hash2(x, y, spec.seed + 977) - 0.5) * spec.grain * 255;
      const i = (y * size + x) * 4;
      data[i] = c[0] + g;
      data[i + 1] = c[1] + g;
      data[i + 2] = c[2] + g * 0.9;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Pebbles, clods and specks. Kept clear of the edges so the tile stays seamless.
  const rng = makeRng(spec.seed ^ 0x5bd1e995);
  const count = Math.round((size * size) / 5200 * spec.pebbles);
  for (let i = 0; i < count; i++) {
    const r = 0.7 + rng() * 2.1 * (size / 256);
    const x = r + 2 + rng() * (size - 2 * r - 4);
    const y = r + 2 + rng() * (size - 2 * r - 4);
    ctx.fillStyle = spec.pebbleDark;
    ctx.beginPath();
    ctx.ellipse(x + r * 0.35, y + r * 0.45, r, r * 0.8, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = spec.pebbleLight;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.8, r * 0.62, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

function makeSoilTile(create: CanvasFactory, size: number): Cnv {
  return paintTile(create, size, {
    dark: hex('#a98f62'), mid: hex('#c9b385'), light: hex('#e0cfa5'),
    baseFreq: 4, octaves: 5, grain: 0.085, seed: 1201, pebbles: 1.1,
    pebbleDark: 'rgba(96,74,44,0.5)', pebbleLight: 'rgba(240,228,196,0.55)',
  });
}
function makeRoadTile(create: CanvasFactory, size: number): Cnv {
  return paintTile(create, size, {
    dark: hex('#b09b73'), mid: hex('#cdbd98'), light: hex('#e0d3b2'),
    baseFreq: 6, octaves: 4, grain: 0.1, seed: 3307, pebbles: 1.6,
    pebbleDark: 'rgba(92,72,44,0.5)', pebbleLight: 'rgba(248,240,214,0.6)',
  });
}
function makeWaterTile(create: CanvasFactory, size: number): Cnv {
  const tile = paintTile(create, size, {
    dark: hex('#2d7fa5'), mid: hex('#3f98bd'), light: hex('#6cb7d3'),
    baseFreq: 5, octaves: 4, grain: 0.03, seed: 5003, pebbles: 0,
    pebbleDark: 'rgba(0,0,0,0)', pebbleLight: 'rgba(0,0,0,0)',
  });
  const ctx = tile.getContext('2d') as Ctx;
  const rng = makeRng(77);
  ctx.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const x = 8 + rng() * (size - 40);
    const y = 6 + rng() * (size - 12);
    const len = (10 + rng() * 22) * (size / 256) * 1.6;
    ctx.strokeStyle = `rgba(255,255,255,${0.1 + rng() * 0.13})`;
    ctx.lineWidth = 0.8 + rng() * 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + len / 2, y - 2.5 - rng() * 2, x + len, y);
    ctx.stroke();
  }
  return tile;
}
function makeConcreteTile(create: CanvasFactory, size: number): Cnv {
  return paintTile(create, size, {
    dark: hex('#a9aea6'), mid: hex('#c3c7c0'), light: hex('#d9dbd4'),
    baseFreq: 5, octaves: 3, grain: 0.07, seed: 8111, pebbles: 0.5,
    pebbleDark: 'rgba(80,86,80,0.4)', pebbleLight: 'rgba(240,242,236,0.5)',
  });
}

/** Low-frequency tint stretched over the whole land: dry patches, damper soil, a little weed green. */
function makeMacroMap(create: CanvasFactory): Cnv {
  const w = 192;
  const h = 128;
  const canvas = create(w, h);
  const ctx = canvas.getContext('2d') as Ctx;
  const img = ctx.createImageData(w, h);
  const wet: RGB = hex('#7a5f38');
  const dry: RGB = hex('#f1e2b8');
  const weed: RGB = hex('#8a9a4c');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = fbm(x / w, y / h, 3, 4, 4242);
      const m = fbm(x / w, y / h, 5, 3, 9191);
      let c: RGB; let a: number;
      if (n < 0.42) { c = wet; a = (0.42 - n) * 1.1; }
      else if (n > 0.58) { c = dry; a = (n - 0.58) * 1.3; }
      else { c = weed; a = Math.max(0, m - 0.56) * 0.9; }
      const i = (y * w + x) * 4;
      img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2];
      img.data[i + 3] = Math.min(255, a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function makeBasinRing(create: CanvasFactory): Cnv {
  const s = 128;
  const canvas = create(s, s);
  const ctx = canvas.getContext('2d') as Ctx;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(84,60,32,0)');
  g.addColorStop(0.5, 'rgba(84,60,32,0.10)');
  g.addColorStop(0.68, 'rgba(70,48,24,0.30)');   // wet trench around the trunk
  g.addColorStop(0.82, 'rgba(236,220,184,0.26)'); // raised berm
  g.addColorStop(1, 'rgba(236,220,184,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return canvas;
}

// ---------------------------------------------------------------------------
// Mango canopy sprites
// ---------------------------------------------------------------------------

interface CanopyPalette { dark: RGB; mid: RGB; light: RGB; glint: RGB }

const PALETTES: CanopyPalette[] = [
  { dark: hex('#1f3f18'), mid: hex('#3b7230'), light: hex('#6f9a3a'), glint: hex('#a6c452') }, // deep glossy green
  { dark: hex('#27481d'), mid: hex('#47822f'), light: hex('#7aa63f'), glint: hex('#b9d062') }, // fresh green
  { dark: hex('#2b4420'), mid: hex('#566f2f'), light: hex('#86973f'), glint: hex('#bcc25f') }, // olive / dusty
];

interface Cluster { x: number; y: number; r: number }

export interface CanopyVariant {
  /** Sprite at full size, half and quarter size (mip chain). */
  mips: Cnv[];
  size: number;
  shadow: Cnv;
  /** Shadow canvas edge length in sprite pixels (larger than `size`: it carries the blur). */
  shadowSize: number;
}

const LIGHT_DIR = { x: -0.62, y: -0.78 }; // sun from the upper left (north-west)

function buildClusters(rng: () => number, S: number): Cluster[] {
  const out: Cluster[] = [{ x: S / 2, y: S / 2, r: 0.31 * S }];
  const ring = 12 + Math.floor(rng() * 3);
  const phase = rng() * Math.PI * 2;
  for (let i = 0; i < ring; i++) {
    const a = phase + (i / ring) * Math.PI * 2 + (rng() - 0.5) * 0.35;
    const d = (0.2 + rng() * 0.06) * S;
    const r = (0.135 + rng() * 0.05) * S;
    out.push({ x: S / 2 + Math.cos(a) * d, y: S / 2 + Math.sin(a) * d, r });
  }
  const rag = 7 + Math.floor(rng() * 4);
  for (let i = 0; i < rag; i++) {
    const a = rng() * Math.PI * 2;
    const d = (0.3 + rng() * 0.06) * S;
    const r = (0.06 + rng() * 0.035) * S;
    out.push({ x: S / 2 + Math.cos(a) * d, y: S / 2 + Math.sin(a) * d, r });
  }
  return out;
}

function silhouette(ctx: Ctx, clusters: Cluster[], dx = 0, dy = 0) {
  ctx.beginPath();
  for (const c of clusters) {
    ctx.moveTo(c.x + dx + c.r, c.y + dy);
    ctx.arc(c.x + dx, c.y + dy, c.r, 0, Math.PI * 2);
  }
}

function leafColor(p: CanopyPalette, lum: number): RGB {
  const l = Math.min(1, Math.max(0, lum));
  return l < 0.5 ? mix(p.dark, p.mid, l * 2) : mix(p.mid, p.light, (l - 0.5) * 2);
}

function paintLeaf(ctx: Ctx, x: number, y: number, ang: number, len: number, wid: number, fill: string) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  ctx.setTransform(c, s, -s, c, x, y);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(-len / 2, 0);
  ctx.quadraticCurveTo(0, -wid, len / 2, 0);
  ctx.quadraticCurveTo(0, wid, -len / 2, 0);
  ctx.fill();
}

function makeCanopy(create: CanvasFactory, S: number, seed: number, leaves: number): CanopyVariant {
  const rng = makeRng(seed);
  const palette = PALETTES[seed % PALETTES.length];
  const clusters = buildClusters(rng, S);
  const canvas = create(S, S);
  const ctx = canvas.getContext('2d') as Ctx;

  ctx.save();
  silhouette(ctx, clusters);
  ctx.clip();

  // 1. Base: lit from the north-west, dark in the lee.
  const base = ctx.createLinearGradient(S * 0.15, S * 0.1, S * 0.88, S * 0.95);
  base.addColorStop(0, css(palette.mid));
  base.addColorStop(1, css(palette.dark));
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);

  // 2. Every cluster is a little lit dome: gives the lobed, layered crown and the
  //    dark crevices between neighbouring lobes.
  const order = clusters.map((_, i) => i).sort(() => rng() - 0.5);
  for (const i of order) {
    const c = clusters[i];
    const g = ctx.createRadialGradient(c.x + LIGHT_DIR.x * c.r * 0.45, c.y + LIGHT_DIR.y * c.r * 0.45, c.r * 0.05, c.x, c.y, c.r * 1.02);
    g.addColorStop(0, css(palette.light, 0.78));
    g.addColorStop(0.55, css(palette.mid, 0.82));
    g.addColorStop(1, css(palette.dark, 0.9));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Leaves (mango leaves are long and lanceolate), shaded by their position in the lobe.
  const weights = clusters.map((c) => c.r * c.r);
  const total = weights.reduce((a, b) => a + b, 0);
  const pick = () => {
    let t = rng() * total;
    for (let i = 0; i < clusters.length; i++) { t -= weights[i]; if (t <= 0) return clusters[i]; }
    return clusters[0];
  };
  for (let i = 0; i < leaves; i++) {
    const c = pick();
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * c.r * 0.96;
    const px = c.x + Math.cos(a) * d;
    const py = c.y + Math.sin(a) * d;
    const lit = ((px - c.x) * LIGHT_DIR.x + (py - c.y) * LIGHT_DIR.y) / c.r; // -1..1
    const lum = 0.46 + lit * 0.36 + (rng() - 0.5) * 0.3;
    const len = S * (0.05 + rng() * 0.035);
    paintLeaf(ctx, px, py, rng() * Math.PI * 2, len, len * 0.3, css(leafColor(palette, lum), 0.9));
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // 4. Glints on the sunlit side + a few dark gaps where branches/ground show through.
  for (let i = 0; i < Math.round(leaves * 0.1); i++) {
    const c = pick();
    const px = c.x + LIGHT_DIR.x * c.r * (0.25 + rng() * 0.5) + (rng() - 0.5) * c.r * 0.7;
    const py = c.y + LIGHT_DIR.y * c.r * (0.25 + rng() * 0.5) + (rng() - 0.5) * c.r * 0.7;
    const len = S * (0.03 + rng() * 0.02);
    paintLeaf(ctx, px, py, rng() * Math.PI * 2, len, len * 0.3, css(palette.glint, 0.55));
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2;
    const d = rng() * S * 0.2;
    ctx.fillStyle = 'rgba(12,22,8,0.42)';
    ctx.beginPath();
    ctx.ellipse(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, S * (0.012 + rng() * 0.018), S * (0.008 + rng() * 0.014), rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // 5. Crown edge falls into shade.
  const rim = ctx.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.5);
  rim.addColorStop(0, 'rgba(8,20,6,0)');
  rim.addColorStop(1, 'rgba(8,20,6,0.38)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, S, S);
  ctx.restore();

  // Mip chain: halving repeatedly keeps far-zoom trees smooth instead of shimmering.
  const mips: Cnv[] = [canvas];
  for (let level = 1; level <= 2; level++) {
    const prev = mips[level - 1];
    const size = Math.max(8, Math.round(S / 2 ** level));
    const m = create(size, size);
    const mctx = m.getContext('2d') as Ctx;
    mctx.imageSmoothingEnabled = true;
    (mctx as any).imageSmoothingQuality = 'high';
    mctx.drawImage(prev, 0, 0, size, size);
    mips.push(m);
  }

  // Soft ground shadow. The silhouette is drawn far off-canvas and only its blurred
  // shadow is projected back: shadowBlur works in every browser (ctx.filter does not).
  const shadowSize = Math.round(S * 1.5);
  const shadow = create(shadowSize, shadowSize);
  const sctx = shadow.getContext('2d') as Ctx;
  const off = shadowSize * 2;
  sctx.shadowColor = 'rgba(20,14,4,0.62)';
  sctx.shadowBlur = S * 0.1;
  sctx.shadowOffsetX = off;
  sctx.shadowOffsetY = 0;
  sctx.fillStyle = '#000';
  silhouette(sctx, clusters, (shadowSize - S) / 2 - off, (shadowSize - S) / 2);
  sctx.fill();

  return { mips, size: S, shadow, shadowSize };
}

// ---------------------------------------------------------------------------
// The asset bundle
// ---------------------------------------------------------------------------

let liveCanvasCount = 0;
/** Number of canvases currently alive (created by an asset bundle and not yet disposed). */
export function getLiveCanvasCount(): number { return liveCanvasCount; }

export interface RealisticAssets {
  quality: QualityProfile;
  soil: Cnv;
  road: Cnv;
  water: Cnv;
  concrete: Cnv;
  macro: Cnv;
  basin: Cnv;
  canopies: CanopyVariant[];
  /** Releases every canvas (backing store set to 0x0). Safe to call twice. */
  dispose(): void;
}

const defaultYield = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export interface BuildOptions {
  onProgress?: (fraction: number) => void;
  isCancelled?: () => boolean;
  /** Lets the browser paint between steps. Replaceable for tests. */
  yieldToUi?: () => Promise<void>;
}

/**
 * Builds all assets in small steps (each well under a frame or two of work) and
 * yields to the browser between them, so the interface stays responsive while the
 * loading indicator is shown. Returns null if cancelled (everything created so far
 * is released first).
 */
export async function buildAssets(
  quality: QualityProfile,
  create: CanvasFactory = defaultCanvasFactory,
  opts: BuildOptions = {},
): Promise<RealisticAssets | null> {
  const yieldToUi = opts.yieldToUi ?? defaultYield;
  const all: Cnv[] = [];
  const track: CanvasFactory = (w, h) => {
    const c = create(w, h);
    all.push(c);
    liveCanvasCount++;
    return c;
  };
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    for (const c of all) { try { c.width = 0; c.height = 0; } catch { /* ignore */ } }
    liveCanvasCount -= all.length;
    all.length = 0;
  };

  const steps: Array<{ weight: number; run: () => void }> = [];
  const out: Partial<RealisticAssets> = { quality, canopies: [] };
  steps.push({ weight: 3, run: () => { out.soil = makeSoilTile(track, quality.soilTile); } });
  steps.push({ weight: 1, run: () => { out.road = makeRoadTile(track, quality.detailTile); } });
  steps.push({ weight: 1, run: () => { out.water = makeWaterTile(track, quality.detailTile); } });
  steps.push({ weight: 1, run: () => { out.concrete = makeConcreteTile(track, quality.detailTile); } });
  steps.push({ weight: 1, run: () => { out.macro = makeMacroMap(track); out.basin = makeBasinRing(track); } });
  for (let v = 0; v < quality.canopyVariants; v++) {
    steps.push({ weight: 2, run: () => { out.canopies!.push(makeCanopy(track, quality.canopySize, 101 + v * 7919, quality.leavesPerCanopy)); } });
  }
  const totalWeight = steps.reduce((s, st) => s + st.weight, 0);

  try {
    let done = 0;
    for (const step of steps) {
      if (opts.isCancelled?.()) { release(); return null; }
      step.run();
      done += step.weight;
      opts.onProgress?.(done / totalWeight);
      await yieldToUi();
    }
    if (opts.isCancelled?.()) { release(); return null; }
  } catch (err) {
    release();
    throw err;
  }

  return { ...(out as RealisticAssets), dispose: release };
}
