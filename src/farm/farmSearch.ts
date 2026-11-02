// ============================================================================
// Smart farm search and "أنا فين؟" (where am I?) - ONE parser, ONE resolver.
//
// This is a DESCRIPTION-based location inside the farm map. It never reads the
// phone's GPS and never writes anything: it maps a sentence ("بين شجرة ١٢ وشجرة
// ١٣", "الصف ٣ والعمود ٠٥", "عند حوض الرش", a landmark's saved name) onto the real
// grid model and returns a FocusTarget in GRID SPACE: pixels measured from the
// top-left of DISPLAYED cell (0,0), i.e. the same origin the infrastructure layer,
// the landmark layer and the realistic renderer use. Mirroring is therefore
// respected by construction (positions go through displayCell / mirrorSlot).
//
// Honesty rules enforced here:
//   * Nothing is guessed. A description that matches several places returns
//     'ambiguous' with every candidate; one that matches nothing returns 'none'.
//   * A midpoint is always flagged `approximate` (it is a drawing coordinate, not a
//     measurement).
//   * Normalising the query never changes a stored label or id.
//
// Dependency-free (no React / DOM) so it runs in plain Node for the verifier.
// ============================================================================

import { GRID, kindAt, type KindGrid } from './infrastructure.ts';
import { displayCell, mirrorSlot, type MapOrientation } from './orientation.ts';
import { slotToPixel, stackOffsets, type LandmarkMap } from './landmarks.ts';

// ---------------------------------------------------------------------------
// 1. Normalisation
// ---------------------------------------------------------------------------

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_INDIC = '۰۱۲۳۴۵۶۷۸۹';

/**
 * Lower-cases, maps Arabic-Indic / Persian digits to 0-9, folds the usual spelling
 * variants (أإآ->ا, ى->ي, ة->ه, ؤ->و, ئ->ي), drops diacritics / tatweel / punctuation and
 * separates digits glued to letters ("الصف3" -> "الصف 3"). Keeps '-' between digits
 * (coordinates such as 12-07).
 */
export function normalizeQuery(text: string): string {
  let out = String(text ?? '').normalize('NFKC').toLowerCase();
  out = out.replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)));
  out = out.replace(/[۰-۹]/g, (d) => String(PERSIAN_INDIC.indexOf(d)));
  out = out
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // diacritics + tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[–—−ـ]/g, '-')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ') // punctuation -> space
    .replace(/(\p{L})(\d)/gu, '$1 $2')
    .replace(/(\d)(\p{L})/gu, '$1 $2')
    .replace(/(?<!\d)-|-(?!\d)/g, ' ') // a dash that is not between digits
    .replace(/\s+/g, ' ')
    .trim();
  return out;
}

/** Column number from the digits the user typed: "05" -> 5, "058" -> 58, "5" -> 5, "0100" -> 100. */
export function parseColumnDigits(raw: string): number | null {
  const stripped = raw.length > 1 && raw[0] === '0' ? raw.slice(1) : raw;
  const n = Number(stripped);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** Row number from typed digits (leading zeros are tolerated). */
export function parseRowDigits(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

// ---------------------------------------------------------------------------
// 2. Model
// ---------------------------------------------------------------------------

export interface SearchFarm {
  rows: number;
  cols: number;
  orientation: MapOrientation;
  /** Display number of each LOGICAL row / column (null = unnumbered). */
  rowNumbers: Array<number | null>;
  colNumbers: Array<number | null>;
  /** Display text, e.g. "3" / "05" / "010" ('' when unnumbered). */
  rowLabels: string[];
  colLabels: string[];
  rowKeys: string[];
  colKeys: number[];
  cells: Record<string, { type?: string; lastUpdated?: string } | undefined>;
  landmarks: LandmarkMap;
  /** Infrastructure in LOGICAL layout. */
  kindGrid: KindGrid;
  coordinateAt: (r: number, c: number) => string | null;
}

export interface Rect { x: number; y: number; w: number; h: number }

export interface FocusShape extends Rect { shape: 'rect' | 'ellipse' }

export type FocusKind = 'tree' | 'row' | 'column' | 'between' | 'landmark' | 'infra' | 'basin' | 'cell';

export interface FocusTarget {
  /** Stable for the same answer, so re-selecting restarts the highlight. */
  id: string;
  kind: FocusKind;
  title: string;
  subtitle?: string;
  /** Grid-space shapes to leave undimmed and outline. */
  shapes: FocusShape[];
  /** Grid-space bounds used by the camera. */
  bounds: Rect;
  /** Temporary location marker (never persisted). */
  marker?: { x: number; y: number; label: string; approximate: boolean };
  /** Small labels at the two ends of a row / column. */
  ends?: Array<{ x: number; y: number; label: string }>;
  /** Extra explanation (approximation note, "choose a position on the row", ...). */
  note?: string;
}

export interface SearchOption { id: string; label: string; detail?: string; target: FocusTarget }

export type SearchMode = 'search' | 'where';

export type SearchOutcome =
  | { status: 'empty' }
  | { status: 'ok'; target: FocusTarget }
  | { status: 'ambiguous'; message: string; options: SearchOption[]; truncated: boolean }
  | { status: 'none'; message: string };

export const MESSAGES = {
  empty: 'اكتب وصف المكان: شجرة، صف، عمود، أو اسم عنصر في المزرعة.',
  none: 'مفيش نتيجة مطابقة. جرّب رقم الصف أو العمود أو اسم عنصر محفوظ في المزرعة.',
  notEnough: 'الوصف ده مش كفاية لتحديد مكان واحد. اكتب رقم الصف أو العمود أو شجرتين متجاورتين.',
  ambiguousTree: 'في أكثر من شجرة بنفس الرقم. اختر الصحيحة:',
  ambiguousGeneric: 'في أكثر من نتيجة مطابقة. اختر الصحيحة:',
  ambiguousRow: 'حدد رقم الصف. اختر الصف المقصود:',
  approximate: 'ده منتصف تقريبي على الخريطة وليس قياس GPS.',
  farApart: 'الشجرتين بعيدين عن بعض، فالنقطة تقريبية جداً (منتصف المسافة على الخريطة، مش قياس GPS).',
  rowOnlyWhere: 'الصف معروف لكن مكانك عليه لا. أضف العمود أو شجرتين تقف بينهما.',
  notATree: 'الخلية دي مش شجرة (طريق أو مروى أو مصرف).',
} as const;

const MAX_OPTIONS = 60;

// ---------------------------------------------------------------------------
// 3. Geometry (grid space, DISPLAY layout)
// ---------------------------------------------------------------------------

const pitchX = () => GRID.cellW + GRID.gap;
const pitchY = () => GRID.cellH + GRID.gap;

function cellRect(farm: SearchFarm, r: number, c: number): Rect {
  const d = displayCell(r, c, farm.rows, farm.cols, farm.orientation);
  return { x: d.col * pitchX(), y: d.row * pitchY(), w: GRID.cellW, h: GRID.cellH };
}
const centerOf = (rc: Rect) => ({ x: rc.x + rc.w / 2, y: rc.y + rc.h / 2 });

export function unionRects(rects: Rect[]): Rect {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const inflate = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 });

export const cellIdAt = (farm: SearchFarm, r: number, c: number) => `${farm.rowKeys[r]}-${farm.colKeys[c]}`;

function isTreeCell(farm: SearchFarm, r: number, c: number): boolean {
  const rec = farm.cells[cellIdAt(farm, r, c)];
  if (rec?.type && rec.type !== 'tree') return false;
  return kindAt(farm.kindGrid, r, c) === null;
}

const rowIndexOf = (farm: SearchFarm, n: number) => farm.rowNumbers.indexOf(n);
const colIndexOf = (farm: SearchFarm, n: number) => farm.colNumbers.indexOf(n);

// ---------------------------------------------------------------------------
// 4. Targets
// ---------------------------------------------------------------------------

function treeTarget(farm: SearchFarm, r: number, c: number, mode: SearchMode): FocusTarget {
  const rect = cellRect(farm, r, c);
  const ctr = centerOf(rect);
  const size = GRID.cellW + 16;
  const coord = farm.coordinateAt(r, c) ?? `صف ${r + 1} · عمود ${c + 1}`;
  return {
    id: `tree:${cellIdAt(farm, r, c)}`,
    kind: 'tree',
    title: `شجرة ${coord}`,
    shapes: [{ x: ctr.x - size / 2, y: ctr.y - size / 2, w: size, h: size, shape: 'ellipse' }],
    bounds: inflate(rect, 10),
    marker: mode === 'where' ? { x: ctr.x, y: ctr.y, label: 'إنت هنا', approximate: false } : undefined,
  };
}

function cellLocationTarget(farm: SearchFarm, r: number, c: number, mode: SearchMode): FocusTarget {
  if (isTreeCell(farm, r, c)) return treeTarget(farm, r, c, mode);
  const rect = cellRect(farm, r, c);
  const ctr = centerOf(rect);
  return {
    id: `cell:${cellIdAt(farm, r, c)}`,
    kind: 'cell',
    title: `الموقع ${farm.coordinateAt(r, c) ?? ''}`.trim(),
    shapes: [{ ...rect, shape: 'rect' }],
    bounds: inflate(rect, 10),
    marker: mode === 'where' ? { x: ctr.x, y: ctr.y, label: 'إنت هنا', approximate: false } : undefined,
  };
}

function rowTarget(farm: SearchFarm, r: number, mode: SearchMode): FocusTarget {
  const first = cellRect(farm, r, 0);
  const rowY = first.y;
  const width = farm.cols * pitchX() - GRID.gap;
  const band: Rect = { x: -8, y: rowY - 6, w: width + 16, h: GRID.cellH + 12 };
  const a = centerOf(cellRect(farm, r, 0));
  const b = centerOf(cellRect(farm, r, farm.cols - 1));
  const firstLabel = farm.coordinateAt(r, firstNumbered(farm.colNumbers) ?? 0);
  const lastLabel = farm.coordinateAt(r, lastNumbered(farm.colNumbers) ?? farm.cols - 1);
  const num = farm.rowLabels[r] || String(r + 1);
  return {
    id: `row:${farm.rowKeys[r]}`,
    kind: 'row',
    title: `الصف ${num}`,
    subtitle: firstLabel && lastLabel ? `من ${firstLabel} إلى ${lastLabel}` : undefined,
    shapes: [{ ...band, shape: 'rect' }],
    bounds: band,
    ends: [
      { x: a.x, y: rowY - 6, label: 'بداية الصف' },
      { x: b.x, y: rowY - 6, label: 'نهاية الصف' },
    ],
    note: mode === 'where' ? MESSAGES.rowOnlyWhere : undefined,
  };
}

function columnTarget(farm: SearchFarm, c: number, mode: SearchMode): FocusTarget {
  const first = cellRect(farm, 0, c);
  const colX = first.x;
  const height = farm.rows * pitchY() - GRID.gap;
  const band: Rect = { x: colX - 6, y: -8, w: GRID.cellW + 12, h: height + 16 };
  const a = centerOf(cellRect(farm, 0, c));
  const b = centerOf(cellRect(farm, farm.rows - 1, c));
  return {
    id: `col:${farm.colKeys[c]}`,
    kind: 'column',
    title: `العمود ${farm.colLabels[c] || c + 1}`,
    shapes: [{ ...band, shape: 'rect' }],
    bounds: band,
    ends: [
      { x: colX + GRID.cellW / 2, y: a.y, label: 'بداية العمود' },
      { x: colX + GRID.cellW / 2, y: b.y, label: 'نهاية العمود' },
    ],
    note: mode === 'where' ? MESSAGES.rowOnlyWhere : undefined,
  };
}

function betweenTarget(farm: SearchFarm, a: [number, number], b: [number, number], mode: SearchMode): FocusTarget {
  const ra = cellRect(farm, a[0], a[1]);
  const rb = cellRect(farm, b[0], b[1]);
  const ca = centerOf(ra);
  const cb = centerOf(rb);
  const mid = { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
  const dist = Math.hypot(ca.x - cb.x, ca.y - cb.y);
  const far = dist > pitchX() * 3;
  const size = GRID.cellW + 10;
  const la = farm.coordinateAt(a[0], a[1]) ?? '';
  const lb = farm.coordinateAt(b[0], b[1]) ?? '';
  return {
    id: `between:${cellIdAt(farm, a[0], a[1])}|${cellIdAt(farm, b[0], b[1])}`,
    kind: 'between',
    title: `بين شجرة ${la} وشجرة ${lb}`,
    shapes: [
      { x: ca.x - size / 2, y: ca.y - size / 2, w: size, h: size, shape: 'ellipse' },
      { x: cb.x - size / 2, y: cb.y - size / 2, w: size, h: size, shape: 'ellipse' },
    ],
    bounds: inflate(unionRects([ra, rb]), 14),
    marker: { x: mid.x, y: mid.y, label: mode === 'where' ? 'إنت هنا' : 'منتصف تقريبي', approximate: true },
    note: far ? MESSAGES.farApart : MESSAGES.approximate,
  };
}

function landmarkTarget(farm: SearchFarm, id: string, mode: SearchMode): FocusTarget | null {
  const lm = farm.landmarks[id];
  if (!lm) return null;
  const list = Object.values(farm.landmarks);
  const offsets = stackOffsets(list);
  const p = slotToPixel(mirrorSlot(lm.position, farm.rows, farm.cols, farm.orientation));
  const x = p.x + (offsets[id] ?? 0);
  const y = p.y;
  const size = 46;
  return {
    id: `landmark:${id}`,
    kind: 'landmark',
    title: lm.name,
    shapes: [{ x: x - size / 2, y: y - size / 2, w: size, h: size, shape: 'ellipse' }],
    bounds: { x: x - 60, y: y - 60, w: 120, h: 120 },
    marker: mode === 'where' ? { x, y, label: 'إنت هنا', approximate: false } : undefined,
  };
}

// ---- infrastructure components (a drain / canal / road is one connected run of cells) ----

type InfraWord = 'drainage' | 'water' | 'road';
const INFRA_LABEL: Record<InfraWord, string> = { drainage: 'مصرف', water: 'مروى', road: 'طريق' };
const KIND_OF: Record<InfraWord, 'drainage' | 'water' | 'road'> = { drainage: 'drainage', water: 'water', road: 'road' };

export function infraComponents(grid: KindGrid, kind: 'drainage' | 'water' | 'road'): Array<Array<[number, number]>> {
  const seen = new Uint8Array(grid.rows * grid.cols);
  const out: Array<Array<[number, number]>> = [];
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
    const i = r * grid.cols + c;
    if (seen[i] || kindAt(grid, r, c) !== kind) continue;
    const queue: Array<[number, number]> = [[r, c]];
    seen[i] = 1;
    const cells: Array<[number, number]> = [];
    while (queue.length) {
      const [cr, cc] = queue.pop() as [number, number];
      cells.push([cr, cc]);
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = cr + dr; const nc = cc + dc;
        if (nr < 0 || nc < 0 || nr >= grid.rows || nc >= grid.cols) continue;
        const ni = nr * grid.cols + nc;
        if (seen[ni] || kindAt(grid, nr, nc) !== kind) continue;
        seen[ni] = 1;
        queue.push([nr, nc]);
      }
    }
    cells.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    out.push(cells);
  }
  return out;
}

/** One rect per horizontal run of cells (display layout), capped, so long networks stay cheap to draw. */
function runsOf(farm: SearchFarm, cells: Array<[number, number]>): Rect[] {
  const byRow = new Map<number, number[]>();
  for (const [r, c] of cells) {
    const d = displayCell(r, c, farm.rows, farm.cols, farm.orientation);
    const list = byRow.get(d.row) ?? [];
    list.push(d.col);
    byRow.set(d.row, list);
  }
  const rects: Rect[] = [];
  for (const [row, cols] of byRow) {
    cols.sort((a, b) => a - b);
    let start = cols[0]; let prev = cols[0];
    const flush = () => rects.push({ x: start * pitchX(), y: row * pitchY(), w: (prev - start) * pitchX() + GRID.cellW, h: GRID.cellH });
    for (let i = 1; i < cols.length; i++) {
      if (cols[i] === prev + 1) { prev = cols[i]; continue; }
      flush(); start = cols[i]; prev = cols[i];
    }
    flush();
  }
  return rects;
}

function componentTarget(farm: SearchFarm, kind: InfraWord, cells: Array<[number, number]>, mode: SearchMode): FocusTarget {
  const rects = runsOf(farm, cells).slice(0, 80);
  const first = cells[0];
  const where = farm.coordinateAt(first[0], first[1]) ?? `صف ${first[0] + 1} · عمود ${first[1] + 1}`;
  const single = cells.length === 1;
  const ctr = single ? centerOf(cellRect(farm, first[0], first[1])) : null;
  return {
    id: `infra:${kind}:${cellIdAt(farm, first[0], first[1])}`,
    kind: 'infra',
    title: INFRA_LABEL[kind],
    subtitle: `يبدأ قرب ${where} · ${cells.length} خلية`,
    shapes: rects.map((r) => ({ ...inflate(r, 4), shape: 'rect' as const })),
    bounds: unionRects(rects),
    marker: mode === 'where' && ctr ? { x: ctr.x, y: ctr.y, label: 'إنت هنا', approximate: false } : undefined,
    note: mode === 'where' && !ctr ? 'ده عنصر ممتد، فمش هقدر أحدد مكانك عليه بالظبط. أضف العمود أو الصف.' : undefined,
  };
}

function basinTarget(farm: SearchFarm, r: number, c: number, mode: SearchMode): FocusTarget {
  const rect = cellRect(farm, r, c);
  const ctr = centerOf(rect);
  return {
    id: `basin:${cellIdAt(farm, r, c)}`,
    kind: 'basin',
    title: 'حوض رش',
    subtitle: `عند ${farm.coordinateAt(r, c) ?? `صف ${r + 1} · عمود ${c + 1}`}`,
    shapes: [{ ...inflate(rect, 8), shape: 'rect' }],
    bounds: inflate(rect, 40),
    marker: mode === 'where' ? { x: ctr.x, y: ctr.y, label: 'إنت هنا', approximate: false } : undefined,
  };
}

// ---------------------------------------------------------------------------
// 5. Parsing
// ---------------------------------------------------------------------------

interface Ref {
  row?: number;
  col?: number;
  tree?: number;
  coord?: { row: number; col: number };
  /** The segment mentioned a row / column / tree / number that could not be parsed. */
  invalid?: boolean;
}

const P = '[وبلف]?(?:ال)?'; // optional conjunction / preposition + definite article
const RE_COORD = /(\d+)\s*-\s*(\d+)/;
const RE_ROW = new RegExp(`(?:^|\\s)${P}(?:صف|صفوف)\\s*(?:رقم\\s*)?(\\d+)`);
const RE_COL = new RegExp(`(?:^|\\s)${P}(?:عمود|عامود)\\s*(?:رقم\\s*)?(\\d+)`);
const RE_TREE = new RegExp(`(?:^|\\s)${P}شجره\\s*(?:رقم\\s*)?(\\d+)`);
const RE_BARE = /(?:^|\s)(\d+)(?:\s|$)/;

function parseRef(seg: string): Ref {
  const ref: Ref = {};
  const coord = RE_COORD.exec(seg);
  if (coord) {
    const row = parseRowDigits(coord[1]); const col = parseColumnDigits(coord[2]);
    if (row && col) ref.coord = { row, col }; else ref.invalid = true;
    return ref;
  }
  const row = RE_ROW.exec(seg);
  if (row) { const n = parseRowDigits(row[1]); if (n) ref.row = n; else ref.invalid = true; }
  const col = RE_COL.exec(seg);
  if (col) { const n = parseColumnDigits(col[1]); if (n) ref.col = n; else ref.invalid = true; }
  const tree = RE_TREE.exec(seg);
  if (tree) {
    // A tree number is the COLUMN number inside a row (the app's coordinates are row-column).
    const n = parseColumnDigits(tree[1]); if (n) ref.tree = n; else ref.invalid = true;
  } else if (!row && !col) {
    const bare = RE_BARE.exec(seg);
    if (bare) { const n = parseColumnDigits(bare[1]); if (n) ref.tree = n; else ref.invalid = true; }
  }
  return ref;
}

const hasKeyword = (s: string, word: string) => new RegExp(`(?:^|\\s)${P}${word}(?=\\s|$)`).test(s);

const STOP = new Set([
  'انا', 'واقف', 'واقفه', 'موجود', 'موجوده', 'عند', 'قدام', 'جنب', 'قريب', 'من', 'في', 'ف', 'الي', 'علي', 'عن',
  'عايز', 'عايزه', 'اوصل', 'روح', 'وريني', 'ودوني', 'دلني', 'فين', 'ابحث', 'دور', 'بحث', 'مكان', 'ده', 'دي', 'هو', 'هي',
  'و', 'بين', 'ال', 'اول', 'اخر', 'لاخره', 'مياه', 'الماء', 'ماء',
]);

const stripArticle = (w: string) => (w.startsWith('وال') ? w.slice(3) : w.startsWith('ال') && w.length > 3 ? w.slice(2) : w);

function contentTokens(text: string): string[] {
  return text.split(' ').map(stripArticle).filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t));
}

// ---------------------------------------------------------------------------
// 6. Resolution
// ---------------------------------------------------------------------------

type Cell = [number, number];

/** Cells (logical) a reference may mean. `rowHint` narrows a bare tree number to one row. */
function resolveCells(farm: SearchFarm, ref: Ref, rowHint?: number): { cells: Cell[]; invalidRow?: boolean; notATree?: boolean } {
  if (ref.coord) {
    const r = rowIndexOf(farm, ref.coord.row); const c = colIndexOf(farm, ref.coord.col);
    if (r < 0 || c < 0) return { cells: [] };
    return isTreeCell(farm, r, c) ? { cells: [[r, c]] } : { cells: [], notATree: true };
  }
  const rowNumber = ref.row ?? rowHint;
  const colNumber = ref.col ?? ref.tree;
  if (rowNumber !== undefined && colNumber !== undefined) {
    const r = rowIndexOf(farm, rowNumber); const c = colIndexOf(farm, colNumber);
    if (r < 0 || c < 0) return { cells: [] };
    return isTreeCell(farm, r, c) || ref.col !== undefined ? { cells: [[r, c]] } : { cells: [], notATree: true };
  }
  if (ref.tree !== undefined) {
    const c = colIndexOf(farm, ref.tree);
    if (c < 0) return { cells: [] };
    const cells: Cell[] = [];
    for (let r = 0; r < farm.rows; r++) if (farm.rowNumbers[r] !== null && isTreeCell(farm, r, c)) cells.push([r, c]);
    return { cells };
  }
  return { cells: [] };
}

function firstNumbered(numbers: Array<number | null>): number | null {
  for (let i = 0; i < numbers.length; i++) if (numbers[i] !== null) return i;
  return null;
}
function lastNumbered(numbers: Array<number | null>): number | null {
  for (let i = numbers.length - 1; i >= 0; i--) if (numbers[i] !== null) return i;
  return null;
}

function option(id: string, label: string, target: FocusTarget, detail?: string): SearchOption {
  return { id, label, detail, target };
}

function ambiguous(message: string, options: SearchOption[]): SearchOutcome {
  return { status: 'ambiguous', message, options: options.slice(0, MAX_OPTIONS), truncated: options.length > MAX_OPTIONS };
}

function finish(message: string, options: SearchOption[]): SearchOutcome {
  if (options.length === 0) return { status: 'none', message: MESSAGES.none };
  if (options.length === 1) return { status: 'ok', target: options[0].target };
  return ambiguous(message, options);
}

function resolveBetween(farm: SearchFarm, a: Ref, b: Ref, mode: SearchMode): SearchOutcome {
  if (a.invalid || b.invalid) return { status: 'none', message: MESSAGES.none };
  // A row mentioned for either tree applies to both ("... في الصف 3").
  const rowHint = a.row ?? b.row;
  const A = resolveCells(farm, a, rowHint);
  const B = resolveCells(farm, b, rowHint);
  if (A.notATree || B.notATree) return { status: 'none', message: MESSAGES.notATree };
  if (!A.cells.length || !B.cells.length) return { status: 'none', message: MESSAGES.none };

  // Explicit coordinates for both trees may be anywhere on the farm; as soon as a tree is given
  // only by its number, the two trees must belong to the SAME row.
  const bothExplicit = Boolean(a.coord) && Boolean(b.coord);
  const pairs: Array<[Cell, Cell]> = [];
  for (const ca of A.cells) for (const cb of B.cells) {
    if (ca[0] === cb[0] && ca[1] === cb[1]) continue;
    if (!bothExplicit && ca[0] !== cb[0]) continue;
    pairs.push([ca, cb]);
  }
  const options = pairs.map(([ca, cb]) => {
    const t = betweenTarget(farm, ca, cb, mode);
    return option(t.id, t.title, t, `الصف ${farm.rowLabels[ca[0]] || ca[0] + 1}`);
  });
  return finish(MESSAGES.ambiguousTree, options);
}

function resolveRefOutcome(farm: SearchFarm, ref: Ref, mode: SearchMode): SearchOutcome {
  if (ref.invalid) return { status: 'none', message: MESSAGES.none };
  // row + column (no tree word needed): a cell.
  if (ref.row !== undefined && ref.col !== undefined) {
    const r = rowIndexOf(farm, ref.row); const c = colIndexOf(farm, ref.col);
    if (r < 0 || c < 0) return { status: 'none', message: MESSAGES.none };
    return { status: 'ok', target: cellLocationTarget(farm, r, c, mode) };
  }
  if (ref.coord || ref.tree !== undefined) {
    const res = resolveCells(farm, ref);
    if (res.notATree) return { status: 'none', message: MESSAGES.notATree };
    const options = res.cells.map(([r, c]) => {
      const t = treeTarget(farm, r, c, mode);
      return option(t.id, t.title, t, `الصف ${farm.rowLabels[r] || r + 1}`);
    });
    return finish(MESSAGES.ambiguousTree, options);
  }
  if (ref.row !== undefined) {
    const r = rowIndexOf(farm, ref.row);
    return r < 0 ? { status: 'none', message: MESSAGES.none } : { status: 'ok', target: rowTarget(farm, r, mode) };
  }
  if (ref.col !== undefined) {
    const c = colIndexOf(farm, ref.col);
    return c < 0 ? { status: 'none', message: MESSAGES.none } : { status: 'ok', target: columnTarget(farm, c, mode) };
  }
  return { status: 'none', message: MESSAGES.none };
}

function matchNamed(farm: SearchFarm, text: string, mode: SearchMode): SearchOption[] {
  const tokens = contentTokens(text);
  if (!tokens.length) return [];
  const joined = tokens.join(' ');
  const digits = text.split(' ').filter((t) => /^\d+$/.test(t));
  const options: SearchOption[] = [];

  // 1. Saved custom items, by name.
  for (const lm of Object.values(farm.landmarks)) {
    const name = normalizeQuery(lm.name);
    const nameTokens = name.split(' ').map(stripArticle);
    const nameJoined = nameTokens.join(' ');
    const hit = nameJoined === joined
      || tokens.every((t) => nameJoined.includes(t))
      || (nameJoined.length > 2 && joined.includes(nameJoined));
    if (!hit) continue;
    // "حنفية 2" must not also list "حنفية 1": a number typed by the user has to be in the name.
    if (!digits.every((d) => nameTokens.includes(d))) continue;
    const t = landmarkTarget(farm, lm.id, mode);
    if (t) options.push(option(t.id, t.title, t, 'عنصر مخصص'));
  }

  // 2. Spray basins (cells of type spray_tank).
  const sprayWords = tokens.some((t) => t === 'رش' || t === 'رشاش' || t === 'رشاشات');
  if (sprayWords && tokens.some((t) => t === 'حوض' || t === 'احواض' || t === 'خزان' || t === 'رش' || t === 'رشاش')) {
    for (let r = 0; r < farm.rows; r++) for (let c = 0; c < farm.cols; c++) {
      if (farm.cells[cellIdAt(farm, r, c)]?.type === 'spray_tank') {
        const t = basinTarget(farm, r, c, mode);
        options.push(option(t.id, t.title, t, t.subtitle));
      }
    }
  }

  // 3. Drains, canals, roads: each connected run is one place.
  const kinds: Array<[InfraWord, string[]]> = [
    ['drainage', ['مصرف', 'مصارف', 'صرف']],
    ['water', ['مروي', 'مراوي', 'ترعه', 'قناه', 'ري']],
    ['road', ['طريق', 'طرق', 'ممر']],
  ];
  for (const [kind, words] of kinds) {
    if (!tokens.some((t) => words.includes(t))) continue;
    for (const cells of infraComponents(farm.kindGrid, KIND_OF[kind])) {
      const t = componentTarget(farm, kind, cells, mode);
      options.push(option(t.id, t.title, t, t.subtitle));
    }
  }
  return options;
}

// ---------------------------------------------------------------------------
// 7. Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a description. `mode` only changes what the answer SHOWS: in 'where' mode a
 * located answer carries the "إنت هنا" marker; the resolution rules are identical.
 */
export function searchFarm(rawQuery: string, farm: SearchFarm, mode: SearchMode = 'search'): SearchOutcome {
  const q = normalizeQuery(rawQuery);
  if (!q) return { status: 'empty' };

  // (a) "between two trees / columns"
  const betweenAt = q.search(new RegExp(`(?:^|\\s)${P}بين(?=\\s)`));
  if (betweenAt >= 0) {
    const after = q.slice(q.indexOf('بين', betweenAt) + 3).trim();
    const parts = after.split(/\sو(?=(?:ال)?(?:شجره|صف|عمود|\d)|\s*(?:ال)?(?:شجره|صف|عمود|\d))/);
    if (parts.length >= 2) {
      const a = parseRef(parts[0]);
      // everything after the first "و" belongs to the second tree (it may carry "في الصف 3")
      const b = parseRef(parts.slice(1).join(' و '));
      return resolveBetween(farm, a, b, mode);
    }
    return { status: 'none', message: MESSAGES.notEnough };
  }

  // (b) "all the trees from the start of the row to its end"
  if (/(?:^|\s)اول(?=\s|$)/.test(q) && /(?:^|\s)(?:ل|الي|حتي)?(?:ال)?اخر/.test(q) && hasKeyword(q, '(?:صف|صفوف)')) {
    const m = RE_ROW.exec(q);
    if (m) {
      const n = parseRowDigits(m[1]);
      const r = n ? rowIndexOf(farm, n) : -1;
      return r < 0 ? { status: 'none', message: MESSAGES.none } : { status: 'ok', target: rowTarget(farm, r, mode) };
    }
    const options: SearchOption[] = [];
    for (let r = 0; r < farm.rows; r++) if (farm.rowNumbers[r] !== null) {
      const t = rowTarget(farm, r, mode);
      options.push(option(t.id, t.title, t, t.subtitle));
    }
    return finish(MESSAGES.ambiguousRow, options);
  }

  // (c) structural references (coordinate, row, column, tree number)
  const ref = parseRef(q);
  const structural = ref.coord || ref.row !== undefined || ref.col !== undefined || ref.tree !== undefined || ref.invalid;
  const mentionsStructure = hasKeyword(q, '(?:شجره|صف|صفوف|عمود|عامود)') || RE_COORD.test(q);
  if (structural && (mentionsStructure || /^\d+$/.test(q))) return resolveRefOutcome(farm, ref, mode);

  // (d) names: custom items, spray basins, drains / canals / roads
  const options = matchNamed(farm, q, mode);
  if (options.length) return finish(MESSAGES.ambiguousGeneric, options);

  if (structural) return resolveRefOutcome(farm, ref, mode);
  return { status: 'none', message: MESSAGES.none };
}

export interface Completion { id: string; label: string; query: string }

/** Cheap suggestions while typing (never moves the map). */
export function completions(rawQuery: string, farm: SearchFarm, limit = 6): Completion[] {
  const q = normalizeQuery(rawQuery);
  const out: Completion[] = [];
  const push = (label: string, query: string) => { if (out.length < limit && !out.some((o) => o.query === query)) out.push({ id: query, label, query }); };

  const rowM = new RegExp(`^${P}(?:صف|صفوف)\\s*(\\d*)$`).exec(q);
  const colM = new RegExp(`^${P}(?:عمود|عامود)\\s*(\\d*)$`).exec(q);
  const treeM = new RegExp(`^${P}شجره\\s*(\\d*)$`).exec(q);
  if (rowM) {
    for (let r = 0; r < farm.rows && out.length < limit; r++) {
      const label = farm.rowLabels[r];
      if (label && label.startsWith(rowM[1])) push(`الصف ${label}`, `الصف ${label}`);
    }
    return out;
  }
  if (colM) {
    for (let c = 0; c < farm.cols && out.length < limit; c++) {
      const label = farm.colLabels[c];
      const typed = colM[1];
      if (label && (label.startsWith(typed) || label.replace(/^0/, '').startsWith(typed))) push(`العمود ${label}`, `العمود ${label}`);
    }
    return out;
  }
  if (treeM) {
    for (let c = 0; c < farm.cols && out.length < limit; c++) {
      const n = farm.colNumbers[c];
      if (n !== null && String(n).startsWith(treeM[1].replace(/^0/, ''))) push(`شجرة ${n}`, `شجرة ${n}`);
    }
    return out;
  }
  if (q.length >= 1) {
    for (const lm of Object.values(farm.landmarks)) {
      if (normalizeQuery(lm.name).includes(q)) push(lm.name, lm.name);
    }
    const words: Array<[string, string]> = [['مصرف', 'مصرف'], ['حوض الرش', 'حوض الرش'], ['طريق', 'طريق'], ['مروى', 'مروى']];
    for (const [label, key] of words) if (normalizeQuery(label).startsWith(q.slice(0, 3)) || key.startsWith(q)) push(label, label);
  }
  return out;
}

/** Example descriptions shown in the empty state. */
export const EXAMPLES: ReadonlyArray<string> = [
  'الصف 3',
  'العمود 05',
  'شجرة 12',
  'بين الشجرة 12 والشجرة 13',
  'عند حوض الرش',
];
