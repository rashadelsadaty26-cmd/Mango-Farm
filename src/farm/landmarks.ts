// ============================================================================
// Farm landmarks ("custom farm objects"): water taps, basins, light poles, ...
//
// A landmark is NOT a tree and NOT a cell. It lives in its own collection, keyed
// by its own stable id, and its position is expressed on an independent "slot
// lattice" that is laid over the original farm grid:
//
//        x:   0    1    2    3    4    ...   (half-steps; 2*cols+1 columns)
//   y: 0      +    -    +    -    +
//      1      |   TREE   |   TREE   |        TREE (r,c)  = lattice (2c+1, 2r+1)
//      2      +    -    +    -    +          vertical gutter  = (even x, odd y)
//      3      |   TREE   |   TREE   |        horizontal gutter = (odd x, even y)
//                                             intersection     = (even x, even y)
//
// Tree cells keep their original ids and (row, column) positions; the lattice
// only describes the gutters between them. Adding rows/columns appends to the
// end of the lattice, so an existing landmark's coordinates never change.
// Nothing here reads or writes tree records.
//
// This file is dependency-free (no React / Firebase) so it can be unit tested
// in plain Node.
// ============================================================================

import { GRID, kindAt, type KindGrid } from './infrastructure.ts';

export interface SlotPos {
  /** Lattice column (half-steps). Even = gutter, odd = tree column. */
  x: number;
  /** Lattice row (half-steps). Even = gutter, odd = tree row. */
  y: number;
}

export interface FarmLandmark {
  /** Stable unique id (also the storage key). Never reused, never derived from a tree id. */
  id: string;
  name: string;
  /** Emoji (or short symbol) drawn on the map. */
  icon: string;
  /**
   * Free-form category for future object types ('custom' for everything the
   * user creates today). Adding new kinds needs no change to tree data.
   */
  kind: string;
  position: SlotPos;
  createdAt: string;
  updatedAt: string;
  /** Room for future per-kind data without a schema change. */
  meta?: Record<string, unknown>;
}

export type LandmarkMap = Record<string, FarmLandmark>;

export const DEFAULT_LANDMARK_ICON = '📍';
export const DEFAULT_LANDMARK_KIND = 'custom';
export const MAX_LANDMARK_NAME = 40;
export const MAX_LANDMARKS = 500;

/** Built-in icon choices. The dialog also accepts any custom emoji. */
export const LANDMARK_ICON_CHOICES: { icon: string; label: string }[] = [
  { icon: '🚰', label: 'حنفية' },
  { icon: '💧', label: 'مياه' },
  { icon: '🚿', label: 'رشاش' },
  { icon: '🛢️', label: 'خزان' },
  { icon: '💡', label: 'عمود إنارة' },
  { icon: '🔌', label: 'كهرباء' },
  { icon: '⚡', label: 'مولد' },
  { icon: '🏠', label: 'مبنى' },
  { icon: '🚪', label: 'بوابة' },
  { icon: '🔧', label: 'صيانة' },
  { icon: '🧰', label: 'معدات' },
  { icon: '⛽', label: 'وقود' },
  { icon: '🚩', label: 'علامة' },
  { icon: '🌿', label: 'نبات' },
  { icon: '📍', label: 'موقع' },
  { icon: '⭐', label: 'مهم' },
];

// ---------------------------------------------------------------------------
// 1. Lattice <-> pixels (pixels are relative to the top-left of cell (0,0))
// ---------------------------------------------------------------------------

export const PITCH_X = GRID.cellW + GRID.gap;
export const PITCH_Y = GRID.cellH + GRID.gap;

/** Horizontal pixel position of lattice column `h`. */
export function xOf(h: number): number {
  return h % 2 === 0
    ? (h / 2) * PITCH_X - GRID.gap / 2
    : ((h - 1) / 2) * PITCH_X + GRID.cellW / 2;
}

/** Vertical pixel position of lattice row `h`. */
export function yOf(h: number): number {
  return h % 2 === 0
    ? (h / 2) * PITCH_Y - GRID.gap / 2
    : ((h - 1) / 2) * PITCH_Y + GRID.cellH / 2;
}

export function slotToPixel(slot: SlotPos): { x: number; y: number } {
  return { x: xOf(slot.x), y: yOf(slot.y) };
}

export const slotKey = (slot: SlotPos): string => `${slot.x},${slot.y}`;

const isOdd = (n: number) => Math.abs(n) % 2 === 1;

/** A tree sits at (odd, odd). Those are never landmark slots. */
export function isTreeCenter(slot: SlotPos): boolean {
  return isOdd(slot.x) && isOdd(slot.y);
}

export type SlotShape = 'vertical-gutter' | 'horizontal-gutter' | 'intersection';

export function slotShape(slot: SlotPos): SlotShape | null {
  if (isTreeCenter(slot)) return null;
  if (!isOdd(slot.x) && isOdd(slot.y)) return 'vertical-gutter';
  if (isOdd(slot.x) && !isOdd(slot.y)) return 'horizontal-gutter';
  return 'intersection';
}

/** The tree cells (row, col) that border a slot: 2 for a gutter, 4 for an intersection. */
export function slotAdjacentCells(slot: SlotPos): Array<[number, number]> {
  const shape = slotShape(slot);
  if (shape === 'vertical-gutter') {
    const r = (slot.y - 1) / 2;
    const c = slot.x / 2;
    return [[r, c - 1], [r, c]];
  }
  if (shape === 'horizontal-gutter') {
    const r = slot.y / 2;
    const c = (slot.x - 1) / 2;
    return [[r - 1, c], [r, c]];
  }
  if (shape === 'intersection') {
    const r = slot.y / 2;
    const c = slot.x / 2;
    return [[r - 1, c - 1], [r - 1, c], [r, c - 1], [r, c]];
  }
  return [];
}

// ---------------------------------------------------------------------------
// 2. Validation
// ---------------------------------------------------------------------------

export type SlotBlockReason = 'invalid' | 'out-of-bounds' | 'tree-center' | 'infrastructure' | 'occupied';

export const SLOT_BLOCK_MESSAGES: Record<SlotBlockReason, string> = {
  invalid: 'الموقع غير صالح.',
  'out-of-bounds': 'اختر مكاناً بين شجرتين داخل حدود المزرعة.',
  'tree-center': 'هذا مكان شجرة. اختر الفراغ بين الأشجار.',
  infrastructure: 'هذا المكان على طريق أو مصرف أو مروى. اختر فراغاً بين الأشجار.',
  occupied: 'يوجد عنصر آخر في هذا المكان.',
};

export interface SlotContext {
  rows: number;
  cols: number;
  /** Connected-infrastructure grid (null = ignore infrastructure). */
  grid: KindGrid | null;
  landmarks: LandmarkMap;
  /** Landmark being moved: its own current slot does not count as "occupied". */
  ignoreId?: string | null;
}

/** Slots that exist at all: interior gutters, never a tree centre. */
export function isSlotInBounds(slot: SlotPos, rows: number, cols: number): boolean {
  return (
    Number.isInteger(slot.x) && Number.isInteger(slot.y) &&
    slot.x >= 1 && slot.x <= 2 * cols - 1 &&
    slot.y >= 1 && slot.y <= 2 * rows - 1
  );
}

/**
 * Whether a landmark may sit in this slot. Returns null when it is allowed.
 *
 * Infrastructure rule (a landmark must never sit on a road / drain / canal):
 *  - roads, drainage and blank "gap" bands are drawn across the whole cell AND
 *    the gutter around it, so any such neighbour blocks the slot;
 *  - a canal band stays inside its own cell, so a tap or pole right beside a
 *    canal is fine. It is only blocked when two or more neighbours are canal
 *    (the slot is then inside the canal/pond body).
 */
export function slotBlockedReason(slot: SlotPos, ctx: SlotContext): SlotBlockReason | null {
  if (!slot || !Number.isInteger(slot.x) || !Number.isInteger(slot.y)) return 'invalid';
  if (isTreeCenter(slot)) return 'tree-center';
  if (!isSlotInBounds(slot, ctx.rows, ctx.cols)) return 'out-of-bounds';

  if (ctx.grid) {
    let water = 0;
    for (const [r, c] of slotAdjacentCells(slot)) {
      const kind = kindAt(ctx.grid, r, c);
      if (kind === 'road' || kind === 'drainage' || kind === 'gap') return 'infrastructure';
      if (kind === 'water') water += 1;
    }
    if (water >= 2) return 'infrastructure';
  }

  const key = slotKey(slot);
  for (const lm of Object.values(ctx.landmarks)) {
    if (lm.id !== ctx.ignoreId && slotKey(lm.position) === key) return 'occupied';
  }
  return null;
}

export function validateLandmarkName(raw: string): string | null {
  const name = (raw ?? '').trim();
  if (!name) return 'اكتب اسم العنصر.';
  if (name.length > MAX_LANDMARK_NAME) return `الاسم طويل جداً (الحد ${MAX_LANDMARK_NAME} حرفاً).`;
  return null;
}

/**
 * One user-perceived character of the input, else the default icon.
 * `pick: 'first'` (default) is for stored/pasted values ("💡x" -> "💡");
 * `pick: 'last'` is for a live text box, so typing a new emoji replaces the old one.
 */
export function sanitizeIcon(raw: string | undefined | null, pick: 'first' | 'last' = 'first'): string {
  const text = (raw ?? '').trim();
  if (!text) return DEFAULT_LANDMARK_ICON;
  const Segmenter = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  const parts = Segmenter
    ? Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (p) => p.segment)
    : Array.from(text); // fallback: code points
  if (parts.length === 0) return DEFAULT_LANDMARK_ICON;
  return pick === 'last' ? parts[parts.length - 1] : parts[0];
}

// ---------------------------------------------------------------------------
// 3. Picking a slot from a point on the map
// ---------------------------------------------------------------------------

/** Nearest lattice index to pixel `v` along one axis, within [lo, hi]. */
function nearestIndex(v: number, pos: (h: number) => number, lo: number, hi: number, parity?: 0 | 1): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (let h = lo; h <= hi; h++) {
    if (parity !== undefined && h % 2 !== parity) continue;
    const d = Math.abs(pos(h) - v);
    if (d < bestD) { bestD = d; best = h; }
  }
  return best;
}

/**
 * Snap a point (pixels relative to cell (0,0)'s top-left) to the nearest valid
 * slot position. A point over a tree snaps to the closest gutter next to it.
 * Returns null only when the farm is too small to have any gutter.
 */
export function pixelToSlot(px: number, py: number, rows: number, cols: number): SlotPos | null {
  if (rows < 1 || cols < 1 || !Number.isFinite(px) || !Number.isFinite(py)) return null;
  const xMin = 1, xMax = 2 * cols - 1, yMin = 1, yMax = 2 * rows - 1;

  // Only search lattice indices near the point (keeps this O(1) on a 120-wide lattice).
  const nearX = Math.max(xMin, Math.min(xMax, Math.round((px / PITCH_X) * 2)));
  const nearY = Math.max(yMin, Math.min(yMax, Math.round((py / PITCH_Y) * 2)));
  const xLo = Math.max(xMin, nearX - 3), xHi = Math.min(xMax, nearX + 3);
  const yLo = Math.max(yMin, nearY - 3), yHi = Math.min(yMax, nearY + 3);

  const hx = nearestIndex(px, xOf, xLo, xHi);
  const hy = nearestIndex(py, yOf, yLo, yHi);
  if (hx === null || hy === null) return null;

  if (!(isOdd(hx) && isOdd(hy))) return { x: hx, y: hy };

  // Over a tree: move to the nearest gutter on whichever axis is closer.
  const gx = nearestIndex(px, xOf, xLo, xHi, 0);
  const gy = nearestIndex(py, yOf, yLo, yHi, 0);
  const dx = gx === null ? Infinity : Math.abs(xOf(gx) - px);
  const dy = gy === null ? Infinity : Math.abs(yOf(gy) - py);
  if (dx === Infinity && dy === Infinity) return null;
  return dx <= dy ? { x: gx as number, y: hy } : { x: hx, y: gy as number };
}

/**
 * Human text for a slot, built from the display coordinates of its neighbours,
 * e.g. "بين 003-004 و 003-005". `describeAt(row, col)` is the app's existing
 * coordinate formatter.
 */
export function describeSlot(
  slot: SlotPos,
  describeAt: (row: number, col: number) => string,
  rows: number,
  cols: number,
): string {
  const cells = slotAdjacentCells(slot).filter(([r, c]) => r >= 0 && c >= 0 && r < rows && c < cols);
  if (cells.length === 0) return 'خارج حدود المزرعة';
  const names = cells.map(([r, c]) => describeAt(r, c));
  if (names.length === 2) return `بين ${names[0]} و ${names[1]}`;
  return `وسط ${names.length} أشجار: ${names.join('، ')}`;
}

// ---------------------------------------------------------------------------
// 4. Storage helpers
// ---------------------------------------------------------------------------

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Collision-free id. Generated once per object, so a retried save re-writes the SAME key. */
export function generateLandmarkId(existing: LandmarkMap = {}): string {
  for (let attempt = 0; attempt < 8; attempt++) {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    const random = c?.randomUUID
      ? c.randomUUID().replace(/-/g, '').slice(0, 16)
      : Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    const id = `lm_${random}`;
    if (!existing[id]) return id;
  }
  return `lm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Defensive read of whatever came out of Firestore / localStorage. Malformed
 * entries are skipped (never thrown on, never "repaired" into someone else's
 * data); the surrounding farm still loads.
 */
export function normalizeLandmarks(raw: unknown): LandmarkMap {
  const out: LandmarkMap = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const pos = v.position as { x?: unknown; y?: unknown } | undefined;
    if (!ID_PATTERN.test(key)) continue;
    if (typeof v.id === 'string' && v.id !== key) continue;
    if (typeof v.name !== 'string' || !v.name.trim()) continue;
    if (!pos || !Number.isInteger(pos.x) || !Number.isInteger(pos.y)) continue;
    const position = { x: pos.x as number, y: pos.y as number };
    if (position.x < 0 || position.y < 0) continue;
    out[key] = {
      id: key,
      name: v.name.trim().slice(0, MAX_LANDMARK_NAME * 2),
      icon: typeof v.icon === 'string' && v.icon.trim() ? sanitizeIcon(v.icon) : DEFAULT_LANDMARK_ICON,
      kind: typeof v.kind === 'string' && v.kind ? v.kind : DEFAULT_LANDMARK_KIND,
      position,
      createdAt: typeof v.createdAt === 'string' ? v.createdAt : '',
      updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : '',
      ...(v.meta && typeof v.meta === 'object' && !Array.isArray(v.meta) ? { meta: v.meta as Record<string, unknown> } : {}),
    };
  }
  return out;
}

/**
 * Landmarks that share one slot (possible if two devices placed one offline)
 * are fanned out horizontally instead of hiding each other. Returns a pixel
 * offset per landmark id; nothing is stored.
 */
export function stackOffsets(landmarks: FarmLandmark[], step = 12): Record<string, number> {
  const groups = new Map<string, FarmLandmark[]>();
  for (const lm of landmarks) {
    const k = slotKey(lm.position);
    const g = groups.get(k);
    if (g) g.push(lm); else groups.set(k, [lm]);
  }
  const out: Record<string, number> = {};
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => (a.id < b.id ? -1 : 1));
    group.forEach((lm, i) => { out[lm.id] = (i - (group.length - 1) / 2) * step; });
  }
  return out;
}
