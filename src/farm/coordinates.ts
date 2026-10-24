// ============================================================================
// Display-only tree coordinates ("001-012" = row 1, column 12).
//
// IMPORTANT: this module never produces or changes storage identifiers.
// Firestore / localStorage keep using the original cell ids (`<rowLetter>-<n>`,
// generated from the PHYSICAL row/column index in App.tsx). Everything here is
// derived on the fly from:
//   - the physical position of a cell (rowIndex, colIndex), and
//   - which physical rows/columns are marked «بدون رقم» (unnumbered).
//
// Numbering rule (same one the grid headers already follow): unnumbered
// rows/columns stay in the grid but consume no number, so the next numbered
// row/column continues the sequence. Numbers are therefore unique per axis, and
// a coordinate is unique per cell by construction.
// ============================================================================

/** Minimum digits for a zero-padded axis number ("001"). Larger numbers simply grow ("1000"). */
export const COORD_DIGITS = 3;

/** 7 -> "007". Non-positive / non-integer input yields ''. */
export function padCoordPart(n: number): string {
  if (!Number.isInteger(n) || n < 1) return '';
  return String(n).padStart(COORD_DIGITS, '0');
}

/**
 * Sequential 1-based numbers for `count` physical positions, skipping the
 * unnumbered ones (which get null). Out-of-range / duplicate indices in
 * `unnumbered` are harmless.
 */
export function buildAxisNumbers(count: number, unnumbered: readonly number[]): Array<number | null> {
  const hidden = new Set(unnumbered);
  let next = 0;
  return Array.from({ length: count }, (_, index) => {
    if (hidden.has(index)) return null;
    next += 1;
    return next;
  });
}

/** "001-012" for numbered row + numbered column, otherwise null. */
export function formatCoordinate(rowNumber: number | null, colNumber: number | null): string | null {
  if (rowNumber == null || colNumber == null) return null;
  const r = padCoordPart(rowNumber);
  const c = padCoordPart(colNumber);
  return r && c ? `${r}-${c}` : null;
}

export interface CoordinateMap {
  /** Padded header text per physical row ('' for an unnumbered row). */
  rowLabels: string[];
  /** Padded header text per physical column ('' for an unnumbered column). */
  colLabels: string[];
  /** Coordinate of the cell at a physical position, or null when its row/column is unnumbered. */
  coordinateAt: (rowIndex: number, colIndex: number) => string | null;
  /**
   * Text that identifies a cell to a person: its coordinate, or - for a cell in
   * an unnumbered row/column - its physical position, e.g. "صف 5 · عمود 3 (بدون رقم)".
   */
  describeAt: (rowIndex: number, colIndex: number) => string;
}

export function buildCoordinateMap(
  rowsCount: number,
  colsCount: number,
  unnumberedRows: readonly number[],
  unnumberedCols: readonly number[],
): CoordinateMap {
  const rowNumbers = buildAxisNumbers(rowsCount, unnumberedRows);
  const colNumbers = buildAxisNumbers(colsCount, unnumberedCols);
  const coordinateAt = (r: number, c: number) => formatCoordinate(rowNumbers[r] ?? null, colNumbers[c] ?? null);
  return {
    rowLabels: rowNumbers.map((n) => (n == null ? '' : padCoordPart(n))),
    colLabels: colNumbers.map((n) => (n == null ? '' : padCoordPart(n))),
    coordinateAt,
    describeAt: (r, c) => coordinateAt(r, c) ?? `صف ${r + 1} · عمود ${c + 1} (بدون رقم)`,
  };
}

/**
 * Split a stored cell id (`<rowLabel>-<columnNumber>`) into its parts. The row
 * label never contains '-', and the column is the stored 1-based physical
 * column, so the split is unambiguous. Returns null for anything malformed.
 */
export function parseCellId(cellId: string): { rowLabel: string; colIndex: number } | null {
  const dash = cellId.lastIndexOf('-');
  if (dash <= 0) return null;
  const col = Number(cellId.slice(dash + 1));
  if (!Number.isInteger(col) || col < 1) return null;
  return { rowLabel: cellId.slice(0, dash), colIndex: col - 1 };
}
