// ============================================================================
// Display-only tree coordinates ("12-07" = row 12, column 7).
//
// FORMAT
//   row     plain number, no leading zeros        1, 2, 10, 25
//   column  literal zero + ordinary decimal       01, 09, 010, 058, 0100
//   tree    "<row>-<column>"                      "1-01", "2-09", "10-010"
//
// The column always begins with one literal zero, followed by its ordinary
// decimal representation. It is intentionally NOT fixed-width padding: 10 ->
// "010", 58 -> "058", and 100 -> "0100".
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

/** Kept for backwards-compatible utility signatures; the display rule is a literal zero prefix. */
export const MIN_COLUMN_DIGITS = 1;

/** 12 -> "12". Rows are never padded. Non-positive / non-integer input yields ''. */
export function formatRowNumber(n: number): string {
  if (!Number.isInteger(n) || n < 1) return '';
  return String(n);
}

/** Legacy width helper. The requested format does not use fixed-width padding. */
export function columnDigits(_largestColumnNumber: number): number {
  return 1;
}

/** 7 -> "07", 10 -> "010", 58 -> "058", 100 -> "0100". */
export function formatColumnNumber(n: number, _digits: number = MIN_COLUMN_DIGITS): string {
  if (!Number.isInteger(n) || n < 1) return '';
  return `0${n}`;
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

/** "12-07" for a numbered row + numbered column, otherwise null. */
export function formatCoordinate(rowNumber: number | null, colNumber: number | null, colDigits: number = MIN_COLUMN_DIGITS): string | null {
  if (rowNumber == null || colNumber == null) return null;
  const r = formatRowNumber(rowNumber);
  const c = formatColumnNumber(colNumber, colDigits);
  return r && c ? `${r}-${c}` : null;
}

export interface CoordinateMap {
  /** Header text per physical row, no leading zeros ('' for an unnumbered row). */
  rowLabels: string[];
  /** Column text (literal zero prefix) per physical column ('' for an unnumbered column). */
  colLabels: string[];
  /** Coordinate of the cell at a physical position, or null when its row/column is unnumbered. */
  /** Legacy compatibility field. The column format is always a single zero prefix. */
  colDigits: number;
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
  const largestColumn = colNumbers.reduce<number>((max, n) => (n != null && n > max ? n : max), 0);
  const colDigits = columnDigits(largestColumn);
  const coordinateAt = (r: number, c: number) => formatCoordinate(rowNumbers[r] ?? null, colNumbers[c] ?? null, colDigits);
  return {
    rowLabels: rowNumbers.map((n) => (n == null ? '' : formatRowNumber(n))),
    colLabels: colNumbers.map((n) => (n == null ? '' : formatColumnNumber(n, colDigits))),
    colDigits,
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
