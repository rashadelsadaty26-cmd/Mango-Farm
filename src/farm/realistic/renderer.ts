// ============================================================================
// Realistic (drone-view) renderer - Canvas 2D.
//
// WHY CANVAS 2D (and not WebGL): the standard map is a DOM grid whose cells are the
// hit-test / selection / editing surface, and all roads, canals and drains already
// have exact vector geometry (buildInfraPaths -> SVG path strings). Canvas 2D can
// consume those very strings through Path2D, so the realistic view is guaranteed to
// follow the real layout, while ~1,800 pre-rendered canopy sprites per frame is far
// inside what 2D canvas does without a GPU shader pipeline. WebGL would add context-
// loss handling and a larger memory footprint for no visible gain here.
//
// HOW IT STAYS ATTACHED TO THE FARM
//   * It draws in the SAME content space as the DOM map: the pan/zoom transform
//     (scale, x, y) is read from App.tsx and applied to the canvas context, so a tree
//     can never drift from its cell at any zoom level.
//   * Positions come from scene.ts (a pure projection of the farm records).
//   * The canvas ignores pointer events. Taps still hit the real DOM cells and
//     landmark badges, so selection, details, editing and mirroring are unchanged.
//
// WHEN IT DRAWS: only when the view or the data changed (no animation loop, no
// timers). Per frame it visits only the trees inside the viewport (the display
// lattice is the spatial index) and picks a level of detail from the zoom.
// ============================================================================

import {
  GRID, buildGapPath, buildInfraPaths, getInfrastructureScale,
  type InfraPaths,
} from '../infrastructure.ts';
import type { RealisticDisplayOptions } from './quality.ts';
import {
  CELL_BASIN, CELL_EMPTY, CELL_NONE, CELL_TREE,
  FLAG_DISEASED, FLAG_GRAFTED, FLAG_UPROOTED, FLAG_WEAK, NO_ACCENT,
  type FarmScene,
} from './scene.ts';
import { drawLandmarkShape, drawSprayBasin } from './objects.ts';
import { makeRng, type Cnv, type Ctx, type RealisticAssets } from './textures.ts';

export interface ViewState { scale: number; x: number; y: number }

/** Where things are in the DOM map's content space (pixels, before the pan/zoom transform). */
export interface Geometry {
  /** Top-left of display cell (0,0). */
  gridX: number;
  gridY: number;
  /** The land element's box (axis strips, padding and cells). */
  landX: number;
  landY: number;
  landW: number;
  landH: number;
}

export interface RendererInit {
  canvas: Cnv;
  assets: RealisticAssets;
  getView: () => ViewState;
  /** Path2D constructor (injectable for Node-based tests). */
  Path2DCtor?: typeof Path2D;
  /** Called once when drawing is persistently slow on the high profile. */
  onSlow?: () => void;
  /** Called when drawing fails repeatedly; the host should fall back to the standard map. */
  onFatal?: (error: unknown) => void;
}

// Colours that carry status. They are the SAME hues as the standard map's legend.
const RED = '#dc2626';
const AMBER = '#d97706';
const DARK = '#111111';

/** Nominal crown diameter: a fraction of the cell width. Status rings are drawn at this size. */
const CANOPY_D = GRID.cellW * 0.94;
/** Sprites keep a margin around the crown (for the lobes' edge), so they are drawn a bit larger. */
const SPRITE_SCALE = 1.14;

// The cell gap is user-adjustable (GRID.gap is mutable), so pitch and stroke scale are read live.
const pitchX = () => GRID.cellW + GRID.gap;
const pitchY = () => GRID.cellH + GRID.gap;

interface Layer {
  /** Width in design units; multiplied by INFRA_SCALE like the standard layer. */
  w: number;
  style: string; // colour, or 'pat:road' | 'pat:water' | 'pat:concrete'
  alpha?: number;
  inner?: boolean;
  dash?: number[];
  /** Skipped when zoomed far out. */
  detail?: boolean;
}

// Compacted dirt road: soft shoulder, defined edge, textured bed, worn wheel tracks, crowned centre.
const ROAD_LAYERS: Layer[] = [
  { w: 61, style: 'rgba(206,190,154,0.42)' },
  { w: 55, style: '#b3a07a' },
  { w: 51, style: 'pat:road' },
  { w: 33, style: 'rgba(104,84,54,0.30)' },
  { w: 20, style: 'rgba(120,98,66,0.12)', detail: true },
  { w: 15, style: 'rgba(232,220,190,0.50)' },
];
// Irrigation canal: damp bank, wet edge, shallows, textured water, deeper centre, ripples.
const WATER_LAYERS: Layer[] = [
  { w: 48, style: 'rgba(86,70,44,0.34)' },
  { w: 41, style: 'rgba(104,88,58,0.70)' },
  { w: 34, style: '#5aaec9' },
  { w: 28, style: 'pat:water' },
  { w: 14, style: 'rgba(14,70,110,0.34)' },
  { w: 20, style: 'rgba(255,255,255,0.20)', dash: [0, 22, 1.5, 40, 2.2, 28, 1.3, 55], detail: true },
];
// Drain: concrete-lined trench with a dark floor.
const DRAIN_LAYERS: Layer[] = [
  { w: 47, style: 'rgba(104,96,76,0.34)' },
  { w: 39, style: 'pat:concrete' },
  { w: 36, style: 'rgba(86,94,88,0.85)' },
  { w: 33, style: 'pat:concrete', inner: true },
  { w: 29, style: '#3f4c49', inner: true },
  { w: 23, style: '#5a706b', inner: true },
  { w: 11, style: 'rgba(134,166,162,0.55)', inner: true, detail: true },
];

interface KindPaths { chains: Path2D | null; blocks: Path2D | null }

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class RealisticRenderer {
  private canvas: Cnv;
  private ctx: Ctx;
  private assets: RealisticAssets;
  private getView: () => ViewState;
  private P2D: typeof Path2D;
  private onSlow?: () => void;
  private onFatal?: (error: unknown) => void;

  private scene: FarmScene | null = null;
  private geom: Geometry = { gridX: 0, gridY: 0, landX: 0, landY: 0, landW: 0, landH: 0 };
  private opts: RealisticDisplayOptions = { showStatus: true, showNumbers: true, showIrrigation: true, showEquipmentLabels: true };

  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private visible = false;
  private disposed = false;
  private dirty = true;
  private last: ViewState = { scale: NaN, x: NaN, y: NaN };

  private patterns: { soil?: CanvasPattern; road?: CanvasPattern; water?: CanvasPattern; concrete?: CanvasPattern } = {};
  private infraSig = '';
  private infraPaths: { gap: Path2D | null; drain: KindPaths; drainInner: KindPaths; road: KindPaths; water: KindPaths } | null = null;

  private failures = 0;
  private slowStreak = 0;
  private slowReported = false;
  /** Exposed for diagnostics / tests. */
  public stats = { draws: 0, lastMs: 0, treesDrawn: 0 };

  constructor(init: RendererInit) {
    this.canvas = init.canvas;
    this.ctx = init.canvas.getContext('2d') as Ctx;
    this.assets = init.assets;
    this.getView = init.getView;
    this.P2D = init.Path2DCtor ?? (globalThis as { Path2D: typeof Path2D }).Path2D;
    this.onSlow = init.onSlow;
    this.onFatal = init.onFatal;
  }

  // ------------------------------------------------------------------ inputs

  setScene(scene: FarmScene) { this.scene = scene; this.dirty = true; }
  setGeometry(geom: Geometry) { this.geom = geom; this.dirty = true; }
  setOptions(opts: RealisticDisplayOptions) { this.opts = opts; this.dirty = true; }
  setVisible(visible: boolean) { this.visible = visible; this.dirty = true; if (visible) this.draw(); }

  /** Replaces the texture set (quality change) and releases the previous one. */
  swapAssets(next: RealisticAssets) {
    const old = this.assets;
    this.assets = next;
    this.patterns = {};
    this.slowStreak = 0;
    this.slowReported = false;
    this.dirty = true;
    old.dispose();
  }

  /** Backing-store size follows the container; device pixel ratio is capped by the quality profile. */
  resize(cssW: number, cssH: number, devicePixelRatio = 1) {
    if (this.disposed) return;
    const q = this.assets.quality;
    let dpr = Math.min(devicePixelRatio || 1, q.dprCap);
    const pixels = cssW * cssH * dpr * dpr;
    if (pixels > q.maxPixels) dpr *= Math.sqrt(q.maxPixels / pixels);
    dpr = Math.max(0.5, dpr);
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (w !== this.canvas.width || h !== this.canvas.height) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    this.patterns = {}; // patterns are tied to the context state, recreate lazily
    this.dirty = true;
  }

  invalidate() { this.dirty = true; }

  /** Releases everything this renderer owns. The canvas element itself is left to the host. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.visible = false;
    this.scene = null;
    this.infraPaths = null;
    this.patterns = {};
    this.assets.dispose();
    try { this.canvas.width = 0; this.canvas.height = 0; } catch { /* ignore */ }
  }

  // -------------------------------------------------------------------- draw

  /** Draws if the view or the data changed since the last draw. Cheap to call every frame. */
  draw() {
    if (this.disposed || !this.visible || !this.scene || !this.cssW) return;
    const v = this.getView();
    if (!this.dirty && v.scale === this.last.scale && v.x === this.last.x && v.y === this.last.y) return;
    const t0 = now();
    try {
      this.render(v);
      this.failures = 0;
    } catch (error) {
      this.failures++;
      if (this.failures >= 3) this.onFatal?.(error);
      return;
    }
    this.dirty = false;
    this.last = { scale: v.scale, x: v.x, y: v.y };
    const ms = now() - t0;
    this.stats.draws++;
    this.stats.lastMs = ms;
    this.watchSpeed(ms);
  }

  private watchSpeed(ms: number) {
    if (this.assets.quality.name !== 'high' || this.slowReported) return;
    this.slowStreak = ms > 34 ? this.slowStreak + 1 : Math.max(0, this.slowStreak - 2);
    if (this.slowStreak >= 24) { this.slowReported = true; this.onSlow?.(); }
  }

  private pattern(kind: 'soil' | 'road' | 'water' | 'concrete'): CanvasPattern | string {
    if (!this.patterns[kind]) {
      const src = this.assets[kind];
      const p = this.ctx.createPattern(src, 'repeat');
      if (!p) return kind === 'water' ? '#3f98bd' : kind === 'concrete' ? '#c3c7c0' : kind === 'road' ? '#cdbd98' : '#c9b385';
      this.patterns[kind] = p;
    }
    return this.patterns[kind] as CanvasPattern;
  }

  private ensureInfra(scene: FarmScene) {
    // Geometry depends on the network AND the current cell pitch (spacing setting).
    const sig = `${scene.infra.signature}|${GRID.gap}`;
    if (this.infraPaths && this.infraSig === sig) return;
    const scale = getInfrastructureScale();
    // Same cap radii as InfrastructureLayer: they decide where dead ends stop.
    const WATER_CAP = (44 * scale) / 2;
    const DRAIN_CAP = 4 * scale;
    const wrap = (p: InfraPaths): KindPaths => ({
      chains: p.chains ? new this.P2D(p.chains) : null,
      blocks: p.blocks ? new this.P2D(p.blocks) : null,
    });
    const gapD = buildGapPath(scene.infra);
    this.infraPaths = {
      gap: gapD ? new this.P2D(gapD) : null,
      drain: wrap(buildInfraPaths(scene.infra, 'drainage', 0)),
      drainInner: wrap(buildInfraPaths(scene.infra, 'drainage', DRAIN_CAP)),
      road: wrap(buildInfraPaths(scene.infra, 'road', 0)),
      water: wrap(buildInfraPaths(scene.infra, 'water', WATER_CAP)),
    };
    this.infraSig = sig;
  }

  private render(v: ViewState) {
    const ctx = this.ctx;
    const scene = this.scene as FarmScene;
    const { dpr } = this;
    const s = v.scale;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * v.x, dpr * v.y);
    ctx.imageSmoothingEnabled = true;
    (ctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = s < 0.5 ? 'medium' : 'high';

    // Visible rectangle in content space.
    const vx0 = -v.x / s;
    const vy0 = -v.y / s;
    const vx1 = (this.cssW - v.x) / s;
    const vy1 = (this.cssH - v.y) / s;

    this.paintGround(ctx, vx0, vy0, vx1, vy1, s);

    // ---- grid space from here on (origin = top-left of display cell (0,0)) ----
    ctx.translate(this.geom.gridX, this.geom.gridY);
    const gx0 = vx0 - this.geom.gridX;
    const gy0 = vy0 - this.geom.gridY;
    const gx1 = vx1 - this.geom.gridX;
    const gy1 = vy1 - this.geom.gridY;

    this.paintInfrastructure(ctx, scene, s);
    this.paintTrees(ctx, scene, s, gx0, gy0, gx1, gy1);
    this.paintLandmarks(ctx, scene, s, gx0, gy0, gx1, gy1);
  }

  // ------------------------------------------------------------------ ground

  private paintGround(ctx: Ctx, vx0: number, vy0: number, vx1: number, vy1: number, s: number) {
    const w = vx1 - vx0;
    const h = vy1 - vy0;
    const { landX, landY, landW, landH } = this.geom;

    // Open ground everywhere (also outside the farm): sand, in two scales so the tile never reads as a pattern.
    ctx.fillStyle = this.pattern('soil');
    ctx.fillRect(vx0, vy0, w, h);
    ctx.save();
    ctx.scale(1.37, 1.37);
    ctx.globalAlpha = 0.32;
    ctx.fillRect(vx0 / 1.37, vy0 / 1.37, w / 1.37, h / 1.37);
    ctx.restore();
    if (s >= 0.7) {
      ctx.save();
      ctx.scale(0.43, 0.43);
      ctx.globalAlpha = 0.26;
      ctx.fillRect(vx0 / 0.43, vy0 / 0.43, w / 0.43, h / 0.43);
      ctx.restore();
    }

    // Uncultivated land outside the farm is a little drier / paler than the worked soil.
    ctx.fillStyle = 'rgba(236,224,190,0.22)';
    ctx.fillRect(vx0, vy0, w, h);

    // Worked, slightly darker soil inside the farm.
    ctx.fillStyle = 'rgba(112,84,46,0.20)';
    ctx.fillRect(landX, landY, landW, landH);

    // Large-scale tint: damper / drier patches and a little weed growth, stretched over the land.
    // Stretched well beyond the land so its edge is never in view, even fully zoomed out.
    const reach = 2600;
    ctx.globalAlpha = 0.42;
    ctx.drawImage(this.assets.macro, landX - reach, landY - reach, landW + reach * 2, landH + reach * 2);
    ctx.globalAlpha = 1;

    // Boundary: a low earth bank with fence posts around the land.
    const inset = 2;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(96,74,44,0.55)';
    ctx.lineWidth = 7;
    ctx.strokeRect(landX + inset, landY + inset, landW - inset * 2, landH - inset * 2);
    ctx.strokeStyle = 'rgba(222,206,168,0.55)';
    ctx.lineWidth = 3;
    ctx.strokeRect(landX + inset - 1, landY + inset - 1, landW - inset * 2, landH - inset * 2);
    if (s >= 0.3) {
      ctx.strokeStyle = 'rgba(70,54,32,0.9)';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.setLineDash([0.1, 46]);
      ctx.strokeRect(landX + inset, landY + inset, landW - inset * 2, landH - inset * 2);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------- infrastructure

  private strokeLayers(ctx: Ctx, paths: KindPaths, inner: KindPaths | null, layers: Layer[], cap: CanvasLineCap, s: number) {
    ctx.lineJoin = 'round';
    for (const layer of layers) {
      if (layer.detail && s < 0.35) continue;
      const p = layer.inner && inner ? inner : paths;
      if (!p.chains && !p.blocks) continue;
      const style = layer.style.startsWith('pat:') ? this.pattern(layer.style.slice(4) as 'road' | 'water' | 'concrete') : layer.style;
      ctx.strokeStyle = style;
      ctx.fillStyle = style;
      ctx.lineWidth = layer.w * getInfrastructureScale();
      ctx.lineCap = layer.dash ? 'butt' : cap;
      ctx.setLineDash(layer.dash ?? []);
      ctx.globalAlpha = layer.alpha ?? 1;
      if (p.chains) ctx.stroke(p.chains);
      if (p.blocks && !layer.dash) { ctx.fill(p.blocks); ctx.stroke(p.blocks); }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  private paintInfrastructure(ctx: Ctx, scene: FarmScene, s: number) {
    if (!scene.infra.hasAny) return;
    this.ensureInfra(scene);
    const ip = this.infraPaths;
    if (!ip) return;
    ctx.save();

    // Blank bands ("gap" rows/columns): bare, pale soil.
    if (ip.gap) {
      ctx.fillStyle = this.pattern('soil');
      ctx.fill(ip.gap);
      ctx.fillStyle = 'rgba(238,226,192,0.42)';
      ctx.fill(ip.gap);
    }
    if (this.opts.showIrrigation) this.strokeLayers(ctx, ip.drain, ip.drainInner, DRAIN_LAYERS, 'butt', s);
    this.strokeLayers(ctx, ip.road, null, ROAD_LAYERS, 'butt', s);
    if (this.opts.showIrrigation) this.strokeLayers(ctx, ip.water, null, WATER_LAYERS, 'round', s);
    ctx.restore();
  }

  // ------------------------------------------------------------------- trees

  private paintTrees(ctx: Ctx, scene: FarmScene, s: number, gx0: number, gy0: number, gx1: number, gy1: number) {
    const { rows, cols, cls, flags, accent, seed } = scene;
    // Visible block of the display lattice: O(visible cells), never O(all cells).
    const margin = CANOPY_D;
    const c0 = Math.max(0, Math.floor((gx0 - margin) / pitchX()));
    const c1 = Math.min(cols - 1, Math.floor((gx1 + margin) / pitchX()));
    const r0 = Math.max(0, Math.floor((gy0 - margin) / pitchY()));
    const r1 = Math.min(rows - 1, Math.floor((gy1 + margin) / pitchY()));
    if (c1 < c0 || r1 < r0) { this.stats.treesDrawn = 0; return; }

    const canopies = this.assets.canopies;
    const nVar = canopies.length;
    const detail = this.assets.quality.closeDetail;
    const showBasins = detail && s >= 0.45;
    const wantLeafDetail = detail && s >= 1.5;
    const status = this.opts.showStatus;
    let drawn = 0;

    const halfW = GRID.cellW / 2;
    const halfH = GRID.cellH / 2;
    const sizeOf = (f: number, k: number) => (k === CELL_EMPTY ? 0.5 : f & FLAG_GRAFTED ? 0.8 : 1);

    // Pass 1: ground contact - tree basins and grounded shadows (batched, no state churn).
    if (showBasins) {
      ctx.globalAlpha = 0.9;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const i = r * cols + c;
        const k = cls[i];
        if (k !== CELL_TREE && k !== CELL_EMPTY) continue;
        ctx.drawImage(this.assets.basin, c * pitchX() + halfW - 44, r * pitchY() + halfH - 44, 88, 88);
      }
      ctx.globalAlpha = 1;
    }
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const i = r * cols + c;
      const k = cls[i];
      if (k !== CELL_TREE && k !== CELL_EMPTY) continue;
      const f = flags[i];
      if (f & FLAG_UPROOTED) continue;
      const d = CANOPY_D * SPRITE_SCALE * sizeOf(f, k) * (0.93 + ((seed[i] >>> 4) % 100) / 700);
      const variant = canopies[seed[i] % nVar];
      const sh = d * 1.5;
      ctx.drawImage(variant.shadow, c * pitchX() + halfW - sh / 2 + d * 0.12, r * pitchY() + halfH - sh / 2 + d * 0.16, sh, sh);
    }

    // Pass 2: canopies (+ stumps for uprooted trees).
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const i = r * cols + c;
      const k = cls[i];
      const x = c * pitchX() + halfW;
      const y = r * pitchY() + halfH;
      if (k === CELL_BASIN) {
        ctx.save();
        ctx.translate(x, y);
        drawSprayBasin(ctx, this.pattern('concrete'), GRID.cellW * 0.86, GRID.cellH * 0.66, s);
        ctx.restore();
        drawn++;
        continue;
      }
      if (k !== CELL_TREE && k !== CELL_EMPTY) continue;
      const f = flags[i];
      if (f & FLAG_UPROOTED) { this.paintStump(ctx, x, y); drawn++; continue; }

      const jitter = 0.93 + ((seed[i] >>> 4) % 100) / 700;
      const d = CANOPY_D * SPRITE_SCALE * sizeOf(f, k) * jitter;
      const variant = canopies[seed[i] % nVar];
      const needed = d * s * this.dpr;
      const level = needed <= variant.size / 4 ? 2 : needed <= variant.size / 2 ? 1 : 0;
      const sprite = variant.mips[level];
      if (s >= 0.3) {
        // A small stable turn (+-10 deg) so neighbouring crowns of one variant differ.
        const rot = (((seed[i] >>> 12) % 1000) / 1000 - 0.5) * 0.35;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);
        ctx.drawImage(sprite, -d / 2, -d / 2, d, d);
        ctx.restore();
      } else {
        ctx.drawImage(sprite, x - d / 2, y - d / 2, d, d);
      }
      drawn++;
    }

    // Pass 3 (very close zoom only): vector leaves over the sprite so foliage stays crisp.
    if (wantLeafDetail) {
      let budget = 36;
      for (let r = r0; r <= r1 && budget > 0; r++) for (let c = c0; c <= c1 && budget > 0; c++) {
        const i = r * cols + c;
        if (cls[i] !== CELL_TREE || (flags[i] & FLAG_UPROOTED)) continue;
        this.paintLeafDetail(ctx, c * pitchX() + halfW, r * pitchY() + halfH, CANOPY_D * sizeOf(flags[i], CELL_TREE), seed[i], s);
        budget--;
      }
    }

    // Pass 4: status indicators. Never the only carrier of status: shapes differ as well as colours.
    if (status) {
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const i = r * cols + c;
        const k = cls[i];
        if (k !== CELL_TREE && k !== CELL_EMPTY) continue;
        const x = c * pitchX() + halfW;
        const y = r * pitchY() + halfH;
        const f = flags[i];
        const d = CANOPY_D * sizeOf(f, k);
        if (k === CELL_EMPTY) { this.paintEmptyMark(ctx, x, y, d, s); continue; }
        if (f) this.paintStatus(ctx, x, y, d, f, s);
        if (accent[i] !== NO_ACCENT && !(f & FLAG_UPROOTED)) this.paintAccent(ctx, x, y, d, accent[i], s);
      }
    }
    this.stats.treesDrawn = drawn;
  }

  private paintStump(ctx: Ctx, x: number, y: number) {
    // Disturbed soil where the tree stood, and the cut stump.
    ctx.fillStyle = 'rgba(66,46,24,0.55)';
    ctx.beginPath(); ctx.ellipse(x, y, 21, 18, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(66,46,24,0.4)';
    ctx.beginPath(); ctx.ellipse(x + 3, y + 2, 14, 11, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7a5a34';
    ctx.beginPath(); ctx.arc(x, y, 5.4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3f2c15'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.strokeStyle = 'rgba(40,26,10,0.55)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(x, y, 2.8, 0, Math.PI * 2); ctx.stroke();
  }

  private paintEmptyMark(ctx: Ctx, x: number, y: number, d: number, s: number) {
    // A planting spot with no saved record: small young crown + dashed neutral ring.
    ctx.save();
    ctx.strokeStyle = 'rgba(244,244,240,0.85)';
    ctx.lineWidth = Math.max(1.8, 1.3 / s);
    ctx.setLineDash([Math.max(5, 3 / s), Math.max(5, 3 / s)]);
    ctx.beginPath(); ctx.arc(x, y, CANOPY_D * 0.5, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    void d;
  }

  private paintAccent(ctx: Ctx, x: number, y: number, d: number, rgb: number, s: number) {
    if (s < 0.85) return;
    const color = '#' + rgb.toString(16).padStart(6, '0');
    const pts: Array<[number, number]> = [[-0.2, 0.16], [-0.1, 0.22], [-0.27, 0.24]];
    for (const [px, py] of pts) {
      ctx.beginPath();
      ctx.arc(x + px * d, y + py * d, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
  }

  private paintStatus(ctx: Ctx, x: number, y: number, d: number, f: number, s: number) {
    const diseased = (f & FLAG_DISEASED) !== 0;
    const weak = (f & FLAG_WEAK) !== 0;
    const retired = (f & (FLAG_GRAFTED | FLAG_UPROOTED)) !== 0;
    const primary = retired ? DARK : diseased ? RED : AMBER;

    if (s < 0.3) {
      // Far out: one solid dot per flagged tree, readable at a glance.
      const r = Math.max(7, 3.6 / s);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = primary; ctx.fill();
      if (diseased && weak && !retired) {
        ctx.beginPath(); ctx.arc(x, y, r, Math.PI * 0.5, Math.PI * 1.5); ctx.fillStyle = AMBER; ctx.fill();
      }
      ctx.lineWidth = 1.3 / s; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      return;
    }

    // Ring around the crown.
    const R = d / 2 + 3;
    const lw = Math.max(2.8, 1.8 / s);
    ctx.lineWidth = lw;
    if (diseased && weak && !retired) {
      ctx.strokeStyle = RED; ctx.beginPath(); ctx.arc(x, y, R, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke();
      ctx.strokeStyle = AMBER; ctx.beginPath(); ctx.arc(x, y, R, Math.PI * 0.5, Math.PI * 1.5); ctx.stroke();
    } else {
      ctx.strokeStyle = primary;
      if (f & FLAG_UPROOTED) ctx.setLineDash([Math.max(7, 4 / s), Math.max(5, 3 / s)]);
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      if (retired && diseased) { ctx.strokeStyle = RED; ctx.lineWidth = lw * 0.7; ctx.beginPath(); ctx.arc(x, y, R - lw * 1.4, 0, Math.PI * 2); ctx.stroke(); }
    }
    // Thin light outline outside the ring keeps it visible over dark foliage and dark soil.
    ctx.lineWidth = Math.max(0.9, 0.7 / s);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.arc(x, y, R + lw * 0.65, 0, Math.PI * 2); ctx.stroke();

    // Corner badge: circle = infected, triangle = weak / follow-up, diamond = grafted / uprooted.
    const br = Math.min(15, Math.max(6.5, 4.6 / s));
    const bx = x + R * 0.74;
    const by = y - R * 0.74;
    ctx.lineWidth = Math.max(1, 0.9 / s);
    ctx.strokeStyle = '#ffffff';
    if (retired) {
      this.badge(ctx, 'diamond', bx, by, br, DARK);
      if (s >= 0.8) {
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1, 1.3 / s); ctx.lineCap = 'round';
        if (f & FLAG_UPROOTED) {
          const k = br * 0.34;
          ctx.beginPath(); ctx.moveTo(bx - k, by - k); ctx.lineTo(bx + k, by + k); ctx.moveTo(bx + k, by - k); ctx.lineTo(bx - k, by + k); ctx.stroke();
        } else {
          ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(bx, by, br * 0.22, 0, Math.PI * 2); ctx.fill();
        }
      }
      if (diseased) this.badge(ctx, 'circle', bx - br * 2, by, br * 0.85, RED);
    } else {
      if (diseased) this.badge(ctx, 'circle', bx, by, br, RED);
      if (weak) this.badge(ctx, 'triangle', diseased ? bx - br * 2.1 : bx, by, br, AMBER);
    }
  }

  private badge(ctx: Ctx, shape: 'circle' | 'triangle' | 'diamond', x: number, y: number, r: number, fill: string) {
    ctx.beginPath();
    if (shape === 'circle') ctx.arc(x, y, r, 0, Math.PI * 2);
    else if (shape === 'diamond') { ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r * 1.15, y); ctx.lineTo(x, y + r * 1.15); ctx.lineTo(x - r * 1.15, y); ctx.closePath(); }
    else { ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r * 1.1, y + r * 0.85); ctx.lineTo(x - r * 1.1, y + r * 0.85); ctx.closePath(); }
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.stroke();
  }

  /** Crisp vector foliage over the sprite for very close zoom. Deterministic per tree. */
  private paintLeafDetail(ctx: Ctx, x: number, y: number, d: number, seed: number, s: number) {
    const rng = makeRng(seed ^ 0x9e3779b9);
    const R = d * 0.3;
    const count = s >= 2.4 ? 80 : 56;
    ctx.save();
    ctx.lineCap = 'round';
    for (let n = 0; n < count; n++) {
      const a = rng() * Math.PI * 2;
      const dist = Math.sqrt(rng()) * R;
      const px = x + Math.cos(a) * dist;
      const py = y + Math.sin(a) * dist;
      const lit = (Math.cos(a) * -0.62 + Math.sin(a) * -0.78) * (dist / R);
      const g = 96 + lit * 46 + rng() * 34;
      const len = d * (0.055 + rng() * 0.03);
      const ang = rng() * Math.PI * 2;
      const c = Math.cos(ang), sn = Math.sin(ang);
      ctx.beginPath();
      const ax = px - (c * len) / 2, ay = py - (sn * len) / 2, bx = px + (c * len) / 2, by = py + (sn * len) / 2;
      const nx = -sn * len * 0.3, ny = c * len * 0.3;
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(px + nx, py + ny, bx, by);
      ctx.quadraticCurveTo(px - nx, py - ny, ax, ay);
      ctx.fillStyle = `rgba(${Math.round(g * 0.55)},${Math.round(g)},${Math.round(g * 0.32)},0.62)`;
      ctx.fill();
      if (s >= 2.2) {
        ctx.strokeStyle = 'rgba(190,214,120,0.5)';
        ctx.lineWidth = 0.35;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
    }
    ctx.restore();
  }

  // --------------------------------------------------------------- landmarks

  private paintLandmarks(ctx: Ctx, scene: FarmScene, s: number, gx0: number, gy0: number, gx1: number, gy1: number) {
    const list = scene.landmarks;
    const m = 40;
    // Same screen-size boost the standard badges get when the map is zoomed out.
    const k = s < 0.3 ? 2.8 : s < 0.55 ? 1.7 : 1;
    const labels: Array<{ text: string; x: number; y: number }> = [];
    for (const lm of list) {
      if (lm.x < gx0 - m || lm.x > gx1 + m || lm.y < gy0 - m || lm.y > gy1 + m) continue;
      ctx.save();
      ctx.translate(lm.x, lm.y);
      ctx.scale(k, k);
      drawLandmarkShape(ctx, lm.shape);
      ctx.restore();
      if (this.opts.showEquipmentLabels && s >= 0.6) labels.push({ text: lm.name, x: lm.x, y: lm.y + 16 * k });
    }

    if (this.opts.showEquipmentLabels && s >= 0.6) {
      // Basin labels: only when it is close enough to read, to keep the orchard uncluttered.
      if (s >= 0.7) {
        const { rows, cols, cls } = scene;
        const c0 = Math.max(0, Math.floor(gx0 / pitchX())); const c1 = Math.min(cols - 1, Math.floor(gx1 / pitchX()));
        const r0 = Math.max(0, Math.floor(gy0 / pitchY())); const r1 = Math.min(rows - 1, Math.floor(gy1 / pitchY()));
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
          if (cls[r * cols + c] === CELL_BASIN) labels.push({ text: 'حوض رش', x: c * pitchX() + GRID.cellW / 2, y: r * pitchY() + GRID.cellH / 2 + GRID.cellH * 0.45 });
        }
      }
      const px = 12 / s; // constant ~12 screen px
      ctx.save();
      ctx.font = `700 ${px}px Cairo, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineJoin = 'round';
      const placed: Array<[number, number, number, number]> = [];
      for (const l of labels) {
        const w = ctx.measureText(l.text).width;
        const box: [number, number, number, number] = [l.x - w / 2 - 2 / s, l.y, l.x + w / 2 + 2 / s, l.y + px * 1.3];
        if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue; // skip overlapping labels
        placed.push(box);
        ctx.lineWidth = 3.4 / s;
        ctx.strokeStyle = 'rgba(255,255,255,0.88)';
        ctx.strokeText(l.text, l.x, l.y);
        ctx.fillStyle = '#2b2416';
        ctx.fillText(l.text, l.x, l.y);
      }
      ctx.restore();
    }
  }
}

export { CELL_NONE };
