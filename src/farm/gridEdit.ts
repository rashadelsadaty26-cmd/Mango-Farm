// ============================================================================
// Direct row / column editing of the farm grid (pure, dependency-free).
//
// THE PROBLEM THIS SOLVES
//   Stored tree ids are `<rowLabel>-<columnNumber>` and, historically, both parts
//   were derived from the PHYSICAL position (row 3 -> "ت", column 5 -> 5). That is
//   fine while rows/columns are only ever appended, but inserting a row in the
//   middle would shift every later position and therefore silently RENAME every
//   later tree. That must never happen.
//
// THE SOLUTION (no migration for existing farms)
//   Each physical row/column carries a STABLE key:
//     rowKeys[i]  the row label used inside cell ids      (string, no '-')
//     colKeys[i]  the column number used inside cell ids  (positive integer)
//   When a farm has no stored keys they are the legacy sequence
//   (getRowLabel(i) / i + 1), so every existing id resolves exactly as before.
//   Keys are written to the farm document ONLY after a mid-grid edit makes them
//   differ from the legacy sequence (see storableKeys).
//
//   Inserting a line creates ONE new key and puts it between its neighbours:
//   no existing cell record is touched, renamed or moved. Removing a line deletes
//   only the records that belong to that line's keys (after the UI confirmed it).
//
// EVERYTHING ELSE THAT IS INDEXED BY PHYSICAL POSITION is shifted consistently:
//   unlabeledRows / unlabeledCols, rowGapKinds / colGapKinds and the landmark
//   lattice (a landmark keeps its neighbours; none is ever deleted).
// ============================================================================

// 28 basic Arabic letters, then Excel-style compounds (same scheme the app always used).
export const ARABIC_BASE_LETTERS = [
  'أ', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر',
  'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف',
  'ق', 'ك', 'ل', 'م', 'ن', 'هـ', 'و', 'ي',
];

/** Legacy row label for a physical index (0 -> "أ", 28 -> "أأ" ...). */
export function getRowLabel(index: number): string {
  let n = index + 1;
  let label = '';
  while (n > 0) {
    n -= 1;
    const rem = n % ARABIC_BASE_LETTERS.length;
    label = ARABIC_BASE_LETTERS[rem] + label;
    n = Math.floor(n / ARABIC_BASE_LETTERS.length);
  }
  return label;
}

export type Axis = 'row' | 'col';

export const MAX_GRID_LINES = 500;

// ---------------------------------------------------------------------------
// 1. Keys
// ---------------------------------------------------------------------------

export const legacyRowKeys = (count: number): string[] => Array.from({ length: count }, (_, i) => getRowLabel(i));
export const legacyColKeys = (count: number): number[] => Array.from({ length: count }, (_, i) => i + 1);

/** Stored row keys if they are valid for `count` rows, otherwise the legacy sequence. */
export function resolveRowKeys(count: number, stored: unknown): string[] {
  if (Array.isArray(stored) && stored.length === count) {
    const seen = new Set<string>();
    let ok = true;
    for (const k of stored) {
      if (typeof k !== 'string' || !k || k.includes('-') || seen.has(k)) { ok = false; break; }
      seen.add(k);
    }
    if (ok) return stored.slice() as string[];
  }
  return legacyRowKeys(count);
}

/** Stored column keys if they are valid for `count` columns, otherwise the legacy sequence. */
export function resolveColKeys(count: number, stored: unknown): number[] {
  if (Array.isArray(stored) && stored.length === count) {
    const seen = new Set<number>();
    let ok = true;
    for (const k of stored) {
      if (!Number.isInteger(k) || k < 1 || seen.has(k as number)) { ok = false; break; }
      seen.add(k as number);
    }
    if (ok) return stored.slice() as number[];
  }
  return legacyColKeys(count);
}

const sameArray = <T,>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** What to write to the farm document: `undefined` while the keys are still the legacy sequence. */
export function storableKeys(rowKeys: readonly string[], colKeys: readonly number[]): { rowKeys?: string[]; colKeys?: number[] } {
  return {
    rowKeys: sameArray(rowKeys, legacyRowKeys(rowKeys.length)) ? undefined : rowKeys.slice(),
    colKeys: sameArray(colKeys, legacyColKeys(colKeys.length)) ? undefined : colKeys.slice(),
  };
}

/** The stored id of the cell at (row key, column key). Never derived from a position. */
export const cellIdFor = (rowKey: string, colKey: number): string => `${rowKey}-${colKey}`;

/** Smallest unused row key (equals the legacy label when appending to an untouched farm). */
export function nextRowKey(existing: readonly string[]): string {
  const used = new Set(existing);
  for (let i = 0; i < MAX_GRID_LINES + existing.length + 1; i++) {
    const label = getRowLabel(i);
    if (!used.has(label)) return label;
  }
  return getRowLabel(existing.length);
}

export function nextColKey(existing: readonly number[]): number {
  const used = new Set(existing);
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

// ---------------------------------------------------------------------------
// 2. Display <-> logical positions (mirroring)
// ---------------------------------------------------------------------------

/**
 * A control drawn in the gap BEFORE displayed line `gap` (0..count) inserts at this
 * LOGICAL index. When the axis is mirrored, "before displayed line g" is "after
 * logical line count - g", i.e. logical insertion index count - g.
 */
export const gapToLogicalIndex = (gap: number, count: number, reversed: boolean): number => (reversed ? count - gap : gap);

/** Displayed line index -> logical line index (an involution). */
export const lineToLogicalIndex = (line: number, count: number, reversed: boolean): number => (reversed ? count - 1 - line : line);

// ---------------------------------------------------------------------------
// 3. The model that grid operations act on
// ---------------------------------------------------------------------------

export interface PositionedLike { position: { x: number; y: number } }

export interface GridModel<L extends PositionedLike = PositionedLike> {
  rowKeys: string[];
  colKeys: number[];
  cells: Record<string, any>;
  unlabeledRows: number[];
  unlabeledCols: number[];
  rowGapKinds: Record<number, string>;
  colGapKinds: Record<number, string>;
  landmarks: Record<string, L>;
}

const shiftIndexList = (list: readonly number[], from: number, delta: number): number[] =>
  list.map((i) => (i >= from ? i + delta : i)).sort((a, b) => a - b);

const shiftIndexMap = (map: Record<number, string>, from: number, delta: number): Record<number, string> => {
  const out: Record<number, string> = {};
  for (const [k, v] of Object.entries(map)) {
    const i = Number(k);
    if (!Number.isInteger(i)) continue;
    out[i >= from ? i + delta : i] = v;
  }
  return out;
};

function shiftLandmarks<L extends PositionedLike>(
  landmarks: Record<string, L>, axis: Axis, fn: (v: number) => number,
): Record<string, L> {
  const out: Record<string, L> = {};
  for (const [id, lm] of Object.entries(landmarks)) {
    const p = lm.position;
    const next = axis === 'row' ? { x: p.x, y: fn(p.y) } : { x: fn(p.x), y: p.y };
    out[id] = next.x === p.x && next.y === p.y ? lm : { ...lm, position: next };
  }
  return out;
}

/** Splits a stored cell id into its row key and column key (null when malformed). */
export function splitCellId(id: string): { rowKey: string; colKey: number } | null {
  const dash = id.lastIndexOf('-');
  if (dash <= 0) return null;
  const col = Number(id.slice(dash + 1));
  if (!Number.isInteger(col) || col < 1) return null;
  return { rowKey: id.slice(0, dash), colKey: col };
}

// ---------------------------------------------------------------------------
// 4. Insert
// ---------------------------------------------------------------------------

/**
 * Inserts ONE new empty row / column so that it becomes logical line `index`
 * (0 = before the first, count = after the last). No existing cell record changes.
 *
 * Landmark lattice (2*count + 1 half-steps, see landmarks.ts): positions at or above
 * the new line's top gutter (2*index) stay; everything beyond moves by one tree pitch
 * (2 half-steps). A landmark therefore always stays next to the same trees.
 */
export function insertLine<L extends PositionedLike>(model: GridModel<L>, axis: Axis, index: number): GridModel<L> {
  const count = axis === 'row' ? model.rowKeys.length : model.colKeys.length;
  if (!Number.isInteger(index) || index < 0 || index > count) throw new RangeError(`insertLine: index ${index} outside 0..${count}`);
  if (count >= MAX_GRID_LINES) throw new RangeError('insertLine: grid is already at the maximum size');

  const shiftLattice = (v: number) => (v >= 2 * index + 1 ? v + 2 : v);

  if (axis === 'row') {
    const key = nextRowKey(model.rowKeys);
    const rowKeys = [...model.rowKeys.slice(0, index), key, ...model.rowKeys.slice(index)];
    return {
      ...model,
      rowKeys,
      unlabeledRows: shiftIndexList(model.unlabeledRows, index, 1),
      rowGapKinds: shiftIndexMap(model.rowGapKinds, index, 1),
      landmarks: shiftLandmarks(model.landmarks, 'row', shiftLattice),
    };
  }
  const key = nextColKey(model.colKeys);
  const colKeys = [...model.colKeys.slice(0, index), key, ...model.colKeys.slice(index)];
  return {
    ...model,
    colKeys,
    unlabeledCols: shiftIndexList(model.unlabeledCols, index, 1),
    colGapKinds: shiftIndexMap(model.colGapKinds, index, 1),
    landmarks: shiftLandmarks(model.landmarks, 'col', shiftLattice),
  };
}

// ---------------------------------------------------------------------------
// 5. Remove
// ---------------------------------------------------------------------------

export interface RemovalImpact {
  axis: Axis;
  index: number;
  /** The stored key of the line (row label / column number) - for messages only. */
  key: string | number;
  /** Trees whose data was saved (they have a `lastUpdated`). */
  trees: number;
  /** Cells set to a non-tree type: canal, drain, road, spray basin. */
  items: number;
  /** Cells that exist only as an empty tree placeholder record. */
  placeholders: number;
  /** Total stored cell records that will be deleted. */
  records: number;
  /** Custom landmarks beside this line; they are KEPT and moved to the adjacent gutter. */
  landmarksMoved: Array<{ id: string; name: string }>;
  /** The line is marked unnumbered / road / drain / gap. */
  specialLine: string | null;
  /** Deleting this would leave the grid without any line. */
  blocked: boolean;
  /** True when anything of value is affected. Empty lines still go through a confirmation. */
  destructive: boolean;
}

const INFRA_TYPES = new Set(['water_canal', 'drainage', 'road', 'spray_tank']);

/** The stored cell ids of a line, whether or not a record exists for them. */
export function lineCellIds(model: Pick<GridModel, 'rowKeys' | 'colKeys'>, axis: Axis, index: number): string[] {
  return axis === 'row'
    ? model.colKeys.map((c) => cellIdFor(model.rowKeys[index], c))
    : model.rowKeys.map((r) => cellIdFor(r, model.colKeys[index]));
}

export function analyzeRemoval<L extends PositionedLike & { name?: string }>(model: GridModel<L>, axis: Axis, index: number): RemovalImpact {
  const keys = axis === 'row' ? model.rowKeys : model.colKeys;
  if (!Number.isInteger(index) || index < 0 || index >= keys.length) throw new RangeError(`analyzeRemoval: index ${index} outside 0..${keys.length - 1}`);
  let trees = 0; let items = 0; let placeholders = 0;
  for (const id of lineCellIds(model, axis, index)) {
    const rec = model.cells[id];
    if (!rec) continue;
    if (INFRA_TYPES.has(rec.type)) items++;
    else if (rec.lastUpdated) trees++;
    else placeholders++;
  }
  const moved: Array<{ id: string; name: string }> = [];
  for (const [id, lm] of Object.entries(model.landmarks)) {
    const v = axis === 'row' ? lm.position.y : lm.position.x;
    if (v === 2 * index + 1) moved.push({ id, name: lm.name ?? '' });
  }
  const gap = (axis === 'row' ? model.rowGapKinds : model.colGapKinds)[index];
  const unlabeled = (axis === 'row' ? model.unlabeledRows : model.unlabeledCols).includes(index);
  const specialLine = gap === 'road' ? 'طريق' : gap === 'drainage' ? 'مصرف' : unlabeled ? 'بدون رقم' : null;
  const records = trees + items + placeholders;
  return {
    axis, index, key: keys[index], trees, items, placeholders, records,
    landmarksMoved: moved, specialLine,
    blocked: keys.length <= 1,
    destructive: trees + items > 0 || moved.length > 0,
  };
}

/**
 * Removes line `index`. Only the records of that line are deleted (the caller has
 * confirmed this); every other record keeps its id. Landmarks beside the removed
 * trees move to the merged gutter - none is deleted.
 */
export function removeLine<L extends PositionedLike>(model: GridModel<L>, axis: Axis, index: number): GridModel<L> {
  const keys = axis === 'row' ? model.rowKeys : model.colKeys;
  if (!Number.isInteger(index) || index < 0 || index >= keys.length) throw new RangeError(`removeLine: index ${index} outside 0..${keys.length - 1}`);
  if (keys.length <= 1) throw new RangeError('removeLine: the grid must keep at least one line');

  const doomed = new Set(lineCellIds(model, axis, index));
  const cells: Record<string, any> = {};
  for (const [id, rec] of Object.entries(model.cells)) if (!doomed.has(id)) cells[id] = rec;

  // lattice: <= 2*index stays, 2*index+1 (beside the removed trees) joins the gutter above,
  // everything after moves one pitch back.
  const shiftLattice = (v: number) => (v === 2 * index + 1 ? 2 * index : v > 2 * index + 1 ? v - 2 : v);
  const dropIndex = (list: readonly number[]) => list.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i));
  const dropMap = (map: Record<number, string>) => {
    const out: Record<number, string> = {};
    for (const [k, v] of Object.entries(map)) {
      const i = Number(k);
      if (!Number.isInteger(i) || i === index) continue;
      out[i > index ? i - 1 : i] = v;
    }
    return out;
  };

  if (axis === 'row') {
    return {
      ...model,
      cells,
      rowKeys: model.rowKeys.filter((_, i) => i !== index),
      unlabeledRows: dropIndex(model.unlabeledRows),
      rowGapKinds: dropMap(model.rowGapKinds),
      landmarks: shiftLandmarks(model.landmarks, 'row', shiftLattice),
    };
  }
  return {
    ...model,
    cells,
    colKeys: model.colKeys.filter((_, i) => i !== index),
    unlabeledCols: dropIndex(model.unlabeledCols),
    colGapKinds: dropMap(model.colGapKinds),
    landmarks: shiftLandmarks(model.landmarks, 'col', shiftLattice),
  };
}

// ---------------------------------------------------------------------------
// 6. Land geometry (CSS grid box of the land element), used by overlays
// ---------------------------------------------------------------------------

/**
 * Outer size of the land element's content+padding box, derived from the same
 * constants the CSS grid uses. `gap`, `cellW`, ... are passed in so this file stays
 * free of imports (and testable with any spacing).
 */
export function landBoxSize(
  rows: number, cols: number,
  g: { cellW: number; cellH: number; gap: number; labelColW: number; headerH: number; pad: number },
): { width: number; height: number } {
  return {
    width: g.pad * 2 + g.labelColW + g.gap + cols * g.cellW + Math.max(0, cols - 1) * g.gap,
    height: g.pad * 2 + g.headerH + g.gap + rows * g.cellH + Math.max(0, rows - 1) * g.gap,
  };
}
