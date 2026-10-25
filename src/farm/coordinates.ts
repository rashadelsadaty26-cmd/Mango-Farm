// ============================================================================
// Display-only tree coordinates ("12-07" = row 12, column 7).
//
// FORMAT
//   row     plain number, no leading zeros        1, 2, 10, 25
//   column  zero-padded to a CONSISTENT width     01, 02, 09, 10, 22   (060 on a 100+ column farm)
//   tree    "<row>-<column>"                      "1-01", "12-07", "30-60"
//
// Padding only the column keeps the two parts distinguishable at a glance
// ("3-04" can only be row 3, column 4) and a coordinate is unambiguous: the row
// never has a leading zero and every column has the same width.
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

/** Smallest width of a column number ("01"). Wider farms grow it for ALL columns (see columnDigits). */
export const MIN_COLUMN_DIGITS = 2;

/** 12 -> "12". Rows are never padded. Non-positive / non-integer input yields ''. */
export function formatRowNumber(n: number): string {
  if (!Number.isInteger(n) || n < 1) return '';
  return String(n);
}

/**
 * Width every column number is padded to: at least 2, and as many digits as the
 * LARGEST column number needs, so all column labels of one farm share a width
 * (60 columns -> 2 digits "01".."60"; 100+ columns -> 3 digits "001".."120").
 */
export function columnDigits(largestColumnNumber: number): number {
  const digits = Number.isInteger(largestColumnNumber) && largestColumnNumber > 0 ? String(largestColumnNumber).length : 0;
  return Math.max(MIN_COLUMN_DIGITS, digits);
}

/** 7 -> "07" (width 2) / "007" (width 3). Non-positive / non-integer input yields ''. */
export function formatColumnNumber(n: number, digits: number = MIN_COLUMN_DIGITS): string {
  if (!Number.isInteger(n) || n < 1) return '';
  return String(n).padStart(Math.max(MIN_COLUMN_DIGITS, digits), '0');
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
  /** Zero-padded header text per physical column ('' for an unnumbered column). */
  colLabels: string[];
  /** Coordinate of the cell at a physical position, or null when its row/column is unnumbered. */
  /** Width every column number is padded to on this farm. */
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
