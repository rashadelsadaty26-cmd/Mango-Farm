// ============================================================================
// Pure mapping from stored tree data -> how the tree is drawn.
// Nothing here writes or rewrites stored values: health and pruning stay two
// independent facts and are only combined at draw time.
// ============================================================================

export interface TreeDataLike {
  type?: string;
  variety?: string;
  status?: string;
  disease?: string;
  lastUpdated?: string;
}

// Stored identifiers (kept identical to MANGO_VARIETIES / TREE_STATUS / DISEASES in App.tsx).
export const UNSPECIFIED_VARIETY = 'غير محدد';
export const STATUS_NEEDS_PRUNING = 'تحتاج تقليم';
export const STATUS_DISEASED = 'مصابة بآفة/مرض';
// Two further values of the SAME `status` field. They are drawn identically
// (black) but stay distinct in storage, so grafted and uprooted can always be
// told apart in data, filters and exports.
export const STATUS_GRAFTED = 'مطعمة';
export const STATUS_UPROOTED = 'مقلوعة';
export const NO_DISEASE = 'لا يوجد';

/**
 * DISPLAY labels for stored status values. Only the label changes: the stored
 * value of the "needs pruning" status stays 'تحتاج تقليم' so existing records,
 * pruning dates and history are untouched (no migration).
 */
export const STATUS_LABELS: Record<string, string> = {
  [STATUS_NEEDS_PRUNING]: 'ضعيفة',
};

/** Text shown to the user for a stored status value. Unknown values pass through. */
export function statusLabel(status: string | undefined): string {
  if (!status) return '';
  return STATUS_LABELS[status] ?? status;
}

// Spellings that mean "grafted" / "uprooted". The canonical constants above are
// what the app writes; the extra spellings only make the black tone tolerant of
// equivalent values that may already exist in saved data. Nothing is rewritten.
const GRAFTED_ALIASES = ['مطعمة', 'مطعم', 'تم التطعيم', 'تطعيم', 'grafted'];
const UPROOTED_ALIASES = ['مقلوعة', 'مقلوع', 'مقتلعة', 'مجتثة', 'تم القلع', 'قلع', 'uprooted'];

/** Strip Arabic diacritics/tatweel and unify alef/ya/ta-marbuta variants for comparison only. */
function normalizeStatusText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .trim()
    .toLowerCase();
}
const GRAFTED_SET = new Set(GRAFTED_ALIASES.map(normalizeStatusText));
const UPROOTED_SET = new Set(UPROOTED_ALIASES.map(normalizeStatusText));

export type RetiredKind = 'grafted' | 'uprooted';

/** Which black status (if any) a stored status value represents. */
export function getRetiredKind(status: string | undefined): RetiredKind | null {
  if (!status) return null;
  const key = normalizeStatusText(status);
  if (GRAFTED_SET.has(key)) return 'grafted';
  if (UPROOTED_SET.has(key)) return 'uprooted';
  return null;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type TreeTone = 'healthy' | 'prune' | 'disease' | 'prune-disease' | 'black';

export interface TreeHealthFlags {
  diseased: boolean;
  needsPruning: boolean;
  /** Grafted / uprooted. Optional so older callers that build flags by hand keep working. */
  retired?: RetiredKind | null;
}

/**
 * Independent facts.
 *  - diseased: the status says so, OR a disease/pest is recorded
 *  - needsPruning: the status says so
 *  - retired: the status is grafted / uprooted (drawn black)
 * A tree recorded as "needs pruning" that also has a disease recorded is BOTH.
 * The disease / pruning facts are still reported for a black tree (the stored
 * disease and pruning data are never altered); only the canopy colour is black.
 */
export function getTreeHealthFlags(data: TreeDataLike): TreeHealthFlags {
  return {
    diseased: data.status === STATUS_DISEASED || (!!data.disease && data.disease !== NO_DISEASE),
    needsPruning: data.status === STATUS_NEEDS_PRUNING,
    retired: getRetiredKind(data.status),
  };
}

export function getTreeTone(flags: TreeHealthFlags): TreeTone {
  if (flags.retired) return 'black';
  if (flags.diseased && flags.needsPruning) return 'prune-disease';
  if (flags.diseased) return 'disease';
  if (flags.needsPruning) return 'prune';
  return 'healthy';
}

/** Canopy colours are unchanged from the original design. */
export const TONE_COLORS: Record<TreeTone, string> = {
  healthy: '#059669',
  prune: '#d97706',
  disease: '#dc2626',
  // Orange stays dominant; the red lives in a patch on the canopy.
  'prune-disease': '#d97706',
  // Grafted and uprooted trees.
  black: '#111111',
};

export const DISEASE_RED = '#dc2626';

// ---------------------------------------------------------------------------
// Variety accents
// ---------------------------------------------------------------------------

export interface VarietyAccent {
  /** Stored identifier, exactly as it appears in the variety list. */
  variety: string;
  color: string;
}

// Muted, fruit-like tones. Each is drawn as a small cluster with a thin light
// ring so it reads on green, orange and red canopies alike. They are chosen to
// be far apart in hue/lightness from each other and from the status colours.
export const VARIETY_ACCENTS: VarietyAccent[] = [
  { variety: 'جحراوي', color: '#e8d4a2' }, // sandy beige
  { variety: 'عويس', color: '#e9c349' },  // golden yellow
  { variety: 'فونس', color: '#b394c4' },  // dusty mauve
  { variety: 'كيت', color: '#f3f0e4' },   // cream
  { variety: 'نعومي', color: '#86b2d6' }, // soft sky blue
  { variety: 'زبدية', color: '#eba9a3' }, // salmon pink
  { variety: 'تيمور', color: '#7a3f63' }, // plum
  { variety: 'أخرى', color: '#bcc3be' },  // neutral grey
];

// Alternate spelling that users may have typed for Kahrawi. Same accent.
const VARIETY_ALIASES: Record<string, string> = { 'كحراوي': 'جحراوي' };

const ACCENT_BY_VARIETY: Record<string, string> = Object.fromEntries(
  VARIETY_ACCENTS.map((a) => [a.variety, a.color]),
);

/**
 * Accent colour for a stored variety, or null when no accent applies.
 * Unspecified/empty -> no accent. A variety that isn't in the list (legacy data)
 * gets the neutral "other" accent rather than being silently dropped.
 */
export function getVarietyAccent(variety: string | undefined): string | null {
  if (!variety || variety === UNSPECIFIED_VARIETY) return null;
  const key = VARIETY_ALIASES[variety] ?? variety;
  return ACCENT_BY_VARIETY[key] ?? ACCENT_BY_VARIETY['أخرى'];
}
