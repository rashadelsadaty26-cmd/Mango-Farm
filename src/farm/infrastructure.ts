// ============================================================================
// Connected-cell infrastructure engine.
//
// Roads, irrigation canals ("water") and drainage canals are stored exactly as
// before: either a per-cell `type` ('water_canal' | 'drainage' | 'road') or a
// whole row/column flagged through rowGapKinds / colGapKinds. Nothing here is
// persisted. Everything is derived at render time from that data, so adding or
// removing one cell automatically changes the geometry of its neighbours.
//
// The renderer draws each kind as ONE network of polylines (a handful of <path>
// elements for the entire map) instead of one coloured div per cell. Straight
// runs, bends, T-junctions and crossings merge geometrically because they are
// strokes of the same path; 2x2 blocks of one kind get a filled body so a wide
// area reads as a pond/yard rather than a lattice of thin channels.
//
// This file is intentionally dependency-free (no React) so it can be unit
// tested in plain Node.
// ============================================================================

export type InfraKind = 'water' | 'road' | 'drainage' | 'gap';

// Physical grid metrics. App.tsx uses the same constants for the CSS grid so the
// overlay can never drift away from the cells it sits on.
const CELL_H = 65;
export const GRID = {
  cellW: 55,
  cellH: CELL_H,
  gap: 4,
  labelColW: 50,
  // The header row is just the first implicit grid row, so it shares gridAutoRows.
  headerH: CELL_H,
  pad: 24,
} as const;

/** Top-left of cell (row 0, col 0) relative to the padding box of the land. */
export const GRID_ORIGIN = {
  left: GRID.pad + GRID.labelColW + GRID.gap,
  top: GRID.pad + GRID.headerH + GRID.gap,
} as const;

export const INFRA_KINDS: InfraKind[] = ['gap', 'drainage', 'road', 'water'];

const KIND_TO_CODE: Record<InfraKind, number> = { water: 1, road: 2, drainage: 3, gap: 4 };
const CODE_TO_KIND: (InfraKind | null)[] = [null, 'water', 'road', 'drainage', 'gap'];

// Direction bits for a connection mask.
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

export type InfraShape = 'isolated' | 'end' | 'straight' | 'corner' | 'tee' | 'cross';

// ---------------------------------------------------------------------------
// 1. Which infrastructure kind does each cell have?
// ---------------------------------------------------------------------------

export interface KindGrid {
  rows: number;
  cols: number;
  /** rows*cols codes, row-major: 0 none, 1 water, 2 road, 3 drainage, 4 gap */
  codes: Uint8Array;
  /** Cheap string fingerprint. Equal signature => identical geometry. */
  signature: string;
  hasAny: boolean;
}

/**
 * Same precedence the map has always used: an explicit cell type wins,
 * otherwise the row gap kind, otherwise the column gap kind.
 */
export function resolveInfraKind(
  cellType: string | undefined,
  rowGapKind: string | undefined,
  colGapKind: string | undefined,
): InfraKind | null {
  if (cellType === 'water_canal') return 'water';
  if (cellType === 'drainage') return 'drainage';
  if (cellType === 'road') return 'road';
  const gap = rowGapKind || colGapKind;
  return gap === 'road' || gap === 'drainage' || gap === 'gap' ? gap : null;
}

export function buildKindGrid(
  cells: Record<string, { type?: string } | undefined>,
  rowLabels: string[],
  colsCount: number,
  rowGapKinds: Record<number, string>,
  colGapKinds: Record<number, string>,
): KindGrid {
  const rows = rowLabels.length;
  const codes = new Uint8Array(rows * colsCount);
  const chars: string[] = new Array(rows * colsCount);
  let hasAny = false;

  for (let r = 0; r < rows; r++) {
    const label = rowLabels[r];
    const rowGap = rowGapKinds[r];
    for (let c = 0; c < colsCount; c++) {
      const kind = resolveInfraKind(cells[`${label}-${c + 1}`]?.type, rowGap, colGapKinds[c]);
      const code = kind ? KIND_TO_CODE[kind] : 0;
      const i = r * colsCount + c;
      codes[i] = code;
      chars[i] = String.fromCharCode(48 + code);
      if (code) hasAny = true;
    }
  }

  return { rows, cols: colsCount, codes, signature: `${rows}x${colsCount}:${chars.join('')}`, hasAny };
}

export function kindAt(grid: KindGrid, r: number, c: number): InfraKind | null {
  if (r < 0 || c < 0 || r >= grid.rows || c >= grid.cols) return null;
  return CODE_TO_KIND[grid.codes[r * grid.cols + c]];
}

// ---------------------------------------------------------------------------
// 2. Connectivity of a single cell
// ---------------------------------------------------------------------------

/** Bitmask of the neighbours (N/E/S/W) that belong to the same kind. */
export function getConnectionMask(grid: KindGrid, r: number, c: number): number {
  const code = grid.codes[r * grid.cols + c];
  if (!code) return 0;
  let mask = 0;
  if (r > 0 && grid.codes[(r - 1) * grid.cols + c] === code) mask |= N;
  if (c < grid.cols - 1 && grid.codes[r * grid.cols + c + 1] === code) mask |= E;
  if (r < grid.rows - 1 && grid.codes[(r + 1) * grid.cols + c] === code) mask |= S;
  if (c > 0 && grid.codes[r * grid.cols + c - 1] === code) mask |= W;
  return mask;
}

function popcount4(m: number): number {
  return (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
}

export function classifyMask(mask: number): InfraShape {
  switch (popcount4(mask)) {
    case 0: return 'isolated';
    case 1: return 'end';
    case 2: return mask === (N | S) || mask === (E | W) ? 'straight' : 'corner';
    case 3: return 'tee';
    default: return 'cross';
  }
}

// ---------------------------------------------------------------------------
// 3. Geometry
// ---------------------------------------------------------------------------

export interface InfraPaths {
  /** Open polylines. Draw with stroke only. */
  chains: string;
  /** Closed rectangles filling 2x2+ blocks. Draw with fill AND stroke. */
  blocks: string;
}

const cx = (c: number) => c * (GRID.cellW + GRID.gap) + GRID.cellW / 2;
const cy = (r: number) => r * (GRID.cellH + GRID.gap) + GRID.cellH / 2;
const HALF_W = GRID.cellW / 2;
const HALF_H = GRID.cellH / 2;

const fmt = (n: number) => String(Math.round(n * 100) / 100);

export function getOverlaySize(rows: number, cols: number) {
  return {
    width: cols * GRID.cellW + Math.max(0, cols - 1) * GRID.gap,
    height: rows * GRID.cellH + Math.max(0, rows - 1) * GRID.gap,
  };
}

// Neighbour deltas for [N, E, S, W] -> bit order 1,2,4,8.
const DIR_BITS = [N, E, S, W];
const DIR_DR = [-1, 0, 1, 0];
const DIR_DC = [0, 1, 0, -1];
const OPPOSITE = [2, 3, 0, 1];

/**
 * Builds the polyline network for one kind.
 *
 * @param capRadius  Radius of the round cap used at dead ends (0 = square end
 *                   flush with the cell edge). Dead ends are always extended so
 *                   the finished stroke ends exactly on the cell boundary.
 */
export function buildInfraPaths(grid: KindGrid, kind: InfraKind, capRadius: number): InfraPaths {
  const { rows, cols, codes } = grid;
  const code = KIND_TO_CODE[kind];
  const total = rows * cols;

  const masks = new Uint8Array(total);
  let any = false;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (codes[i] === code) {
        masks[i] = getConnectionMask(grid, r, c);
        any = true;
      }
    }
  }
  if (!any) return { chains: '', blocks: '' };

  const isKind = (i: number) => codes[i] === code;
  const degree = (i: number) => popcount4(masks[i]);

  // Visited edges: east edge of node i, south edge of node i.
  const visE = new Uint8Array(total);
  const visS = new Uint8Array(total);
  const edgeVisited = (i: number, d: number) =>
    d === 1 ? visE[i] === 1 : d === 3 ? visE[i - 1] === 1 : d === 2 ? visS[i] === 1 : visS[i - cols] === 1;
  const markEdge = (i: number, d: number) => {
    if (d === 1) visE[i] = 1;
    else if (d === 3) visE[i - 1] = 1;
    else if (d === 2) visS[i] = 1;
    else visS[i - cols] = 1;
  };
  const neighbor = (i: number, d: number) => i + DIR_DR[d] * cols + DIR_DC[d];

  const parts: string[] = [];

  const pointOf = (i: number): [number, number] => [cx(i % cols), cy(Math.floor(i / cols))];

  const emit = (nodes: number[], closed: boolean) => {
    let pts = nodes.map(pointOf);

    if (!closed) {
      // Extend dead ends outward so they finish on the cell boundary.
      const extend = (end: number, prev: number) => {
        const [ex, ey] = pts[end];
        const [px, py] = pts[prev];
        const horizontal = ey === py;
        const ext = (horizontal ? HALF_W : HALF_H) - capRadius;
        if (ext <= 0) return;
        const sx = Math.sign(ex - px);
        const sy = Math.sign(ey - py);
        pts[end] = [ex + sx * ext, ey + sy * ext];
      };
      if (degree(nodes[0]) === 1) extend(0, 1);
      if (degree(nodes[nodes.length - 1]) === 1) extend(pts.length - 1, pts.length - 2);
    }

    // Drop collinear mid points. The geometry is identical, the string shorter.
    const slim: [number, number][] = [pts[0]];
    for (let k = 1; k < pts.length - 1; k++) {
      const [ax, ay] = slim[slim.length - 1];
      const [bx, by] = pts[k];
      const [dx, dy] = pts[k + 1];
      const straight = (ax === bx && bx === dx) || (ay === by && by === dy);
      if (!straight) slim.push(pts[k]);
    }
    slim.push(pts[pts.length - 1]);

    let d = `M${fmt(slim[0][0])} ${fmt(slim[0][1])}`;
    for (let k = 1; k < slim.length; k++) d += `L${fmt(slim[k][0])} ${fmt(slim[k][1])}`;
    if (closed) d += 'Z';
    parts.push(d);
  };

  const walk = (start: number, startDir: number) => {
    const nodes = [start];
    let cur = start;
    let dir = startDir;
    let closed = false;
    for (;;) {
      markEdge(cur, dir);
      const next = neighbor(cur, dir);
      if (next === start) { closed = true; break; }
      nodes.push(next);
      if (degree(next) !== 2) break;
      const incoming = OPPOSITE[dir];
      const remaining = masks[next] & ~DIR_BITS[incoming];
      dir = DIR_BITS.indexOf(remaining);
      cur = next;
    }
    if (closed) nodes.push(start);
    emit(nodes, closed);
  };

  // Chains begin and end at nodes that are not simple pass-through cells.
  for (let i = 0; i < total; i++) {
    if (!isKind(i)) continue;
    const deg = degree(i);
    if (deg === 0) {
      // Isolated cell: a short stub across the cell, capped like any end.
      const [x, y] = pointOf(i);
      const half = Math.max(0, HALF_W - capRadius);
      parts.push(`M${fmt(x - half)} ${fmt(y)}L${fmt(x + half)} ${fmt(y)}`);
      continue;
    }
    if (deg === 2) continue;
    for (let d = 0; d < 4; d++) {
      if (masks[i] & DIR_BITS[d] && !edgeVisited(i, d)) walk(i, d);
    }
  }

  // Whatever is left are closed loops made only of pass-through cells.
  for (let i = 0; i < total; i++) {
    if (!isKind(i) || degree(i) !== 2) continue;
    for (let d = 0; d < 4; d++) {
      if (masks[i] & DIR_BITS[d] && !edgeVisited(i, d)) walk(i, d);
    }
  }

  // Filled bodies for every 2x2 block, merged along rows.
  const blocks: string[] = [];
  for (let r = 0; r < rows - 1; r++) {
    let c = 0;
    while (c < cols - 1) {
      const full = (cc: number) =>
        isKind(r * cols + cc) && isKind(r * cols + cc + 1) &&
        isKind((r + 1) * cols + cc) && isKind((r + 1) * cols + cc + 1);
      if (!full(c)) { c++; continue; }
      let end = c;
      while (end + 1 < cols - 1 && full(end + 1)) end++;
      const x1 = cx(c), x2 = cx(end + 1), y1 = cy(r), y2 = cy(r + 1);
      blocks.push(`M${fmt(x1)} ${fmt(y1)}H${fmt(x2)}V${fmt(y2)}H${fmt(x1)}Z`);
      c = end + 1;
    }
  }

  return { chains: parts.join(''), blocks: blocks.join('') };
}

/**
 * Plain filled ground for "gap" (blank spacer) rows/columns. Rectangles are
 * grown by half a grid gap so neighbouring cells merge without a seam.
 */
export function buildGapPath(grid: KindGrid): string {
  const { rows, cols, codes } = grid;
  const code = KIND_TO_CODE.gap;
  const grow = GRID.gap / 2 + 0.5;
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      if (codes[r * cols + c] !== code) { c++; continue; }
      let end = c;
      while (end + 1 < cols && codes[r * cols + end + 1] === code) end++;
      const x1 = cx(c) - HALF_W - grow;
      const x2 = cx(end) + HALF_W + grow;
      const y1 = cy(r) - HALF_H - grow;
      const y2 = cy(r) + HALF_H + grow;
      out.push(`M${fmt(x1)} ${fmt(y1)}H${fmt(x2)}V${fmt(y2)}H${fmt(x1)}Z`);
      c = end + 1;
    }
  }
  return out.join('');
}
