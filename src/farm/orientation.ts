// ============================================================================
// Map orientation (mirroring).
//
// The farm has ONE logical coordinate system: the stored cell ids
// (`<rowLetter>-<column>`), the row/column indexes and the landmark lattice.
// Mirroring never touches it. It only changes WHERE a logical position is drawn:
//
//   original      (r, c)           ->  (r, c)
//   mirror-x      (r, c)           ->  (r, C - 1 - c)      left  <-> right
//   mirror-y      (r, c)           ->  (R - 1 - r, c)      top   <-> bottom
//
// Every mapping here is an involution (applying it twice gives the original),
// so the same function converts logical -> display and display -> logical, and
// choosing an orientation is always an ABSOLUTE choice, never "flip again".
//
// The landmark lattice (see landmarks.ts) has 2*C + 1 columns of half-steps and
// 2*R + 1 rows; the same reflection applies to it: x -> 2*C - x, y -> 2*R - y.
// Tree centres (odd, odd) map to tree centres, gutters map to gutters.
//
// Dependency-free (no React / Firebase) so it can be tested in plain Node.
// ============================================================================

import { GRID, type KindGrid } from './infrastructure.ts';

export type MapOrientation = 'original' | 'mirror-x' | 'mirror-y';

export const DEFAULT_ORIENTATION: MapOrientation = 'original';

export const ORIENTATION_OPTIONS: ReadonlyArray<{
  value: MapOrientation;
  label: string;
  english: string;
}> = [
  { value: 'original', label: 'الاتجاه الأصلي', english: 'Original Orientation' },
  { value: 'mirror-x', label: 'عكس أفقي', english: 'Mirror Left ↔ Right' },
  { value: 'mirror-y', label: 'عكس رأسي', english: 'Mirror Top ↕ Bottom' },
];

/** Defensive read of a stored value: anything unknown means "original". */
export function normalizeOrientation(value: unknown): MapOrientation {
  return value === 'mirror-x' || value === 'mirror-y' ? value : DEFAULT_ORIENTATION;
}

/** Columns are reversed (left <-> right). */
export const flipsColumns = (o: MapOrientation): boolean => o === 'mirror-x';
/** Rows are reversed (top <-> bottom). */
export const flipsRows = (o: MapOrientation): boolean => o === 'mirror-y';

// ---------------------------------------------------------------------------
// 1. Tree grid (zero-based row / column indexes)
// ---------------------------------------------------------------------------

/** Displayed row index of logical row `r` (and, being an involution, the reverse). */
export function displayRow(r: number, rows: number, o: MapOrientation): number {
  return flipsRows(o) ? rows - 1 - r : r;
}

/** Displayed column index of logical column `c` (and the reverse). */
export function displayCol(c: number, cols: number, o: MapOrientation): number {
  return flipsColumns(o) ? cols - 1 - c : c;
}

/** Where logical cell (r, c) is drawn. */
export function displayCell(r: number, c: number, rows: number, cols: number, o: MapOrientation): { row: number; col: number } {
  return { row: displayRow(r, rows, o), col: displayCol(c, cols, o) };
}

/** Which logical cell is drawn at displayed position (row, col). Same function: the mapping is an involution. */
export const logicalCell = displayCell;

/**
 * Logical index shown at each displayed position along one axis:
 * `[0, 1, 2]` normally, `[2, 1, 0]` when the axis is reversed.
 */
export function displayOrder(count: number, reversed: boolean): number[] {
  return Array.from({ length: count }, (_, i) => (reversed ? count - 1 - i : i));
}

// ---------------------------------------------------------------------------
// 2. Landmark lattice
// ---------------------------------------------------------------------------

export interface LatticePoint {
  x: number;
  y: number;
}

/** Where lattice point `slot` is drawn (and the reverse). Gutters stay gutters, trees stay trees. */
export function mirrorSlot<T extends LatticePoint>(slot: T, rows: number, cols: number, o: MapOrientation): LatticePoint {
  return {
    x: flipsColumns(o) ? 2 * cols - slot.x : slot.x,
    y: flipsRows(o) ? 2 * rows - slot.y : slot.y,
  };
}

// ---------------------------------------------------------------------------
// 3. Infrastructure (roads, canals, drains, blank bands)
// ---------------------------------------------------------------------------

/**
 * The same kind grid, re-laid-out for display. Connectivity, bends, T-junctions
 * and dead ends are symmetric under a reflection, so the existing geometry
 * builders can run on the mirrored grid unchanged: what the user sees is exactly
 * the mirror image of the original network.
 *
 * Returns the SAME object for `original` (no copy, no re-render).
 */
export function mirrorKindGrid(grid: KindGrid, o: MapOrientation): KindGrid {
  if (o === 'original') return grid;
  const { rows, cols, codes } = grid;
  const next = new Uint8Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    const dr = displayRow(r, rows, o);
    for (let c = 0; c < cols; c++) {
      next[dr * cols + displayCol(c, cols, o)] = codes[r * cols + c];
    }
  }
  const chars: string[] = new Array(rows * cols);
  for (let i = 0; i < next.length; i++) chars[i] = String.fromCharCode(48 + next[i]);
  // Same signature format as buildKindGrid: equal signature => identical geometry.
  return { rows, cols, codes: next, signature: `${rows}x${cols}:${chars.join('')}`, hasAny: grid.hasAny };
}

// ---------------------------------------------------------------------------
// 4. Where the cell area starts inside the land
// ---------------------------------------------------------------------------

/**
 * The land is a CSS grid: [label column][cells...] under a [header row][cell rows...].
 * Mirroring moves those two axis strips to the opposite edge together with the
 * cells, so the offset of cell (0,0) - and therefore the origin shared by the
 * infrastructure and landmark overlays - depends on the orientation.
 */
export function getGridOrigin(o: MapOrientation): { left: number; top: number } {
  return {
    left: GRID.pad + (flipsColumns(o) ? 0 : GRID.labelColW + GRID.gap),
    top: GRID.pad + (flipsRows(o) ? 0 : GRID.headerH + GRID.gap),
  };
}
