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
export const NO_DISEASE = 'لا يوجد';

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type TreeTone = 'healthy' | 'prune' | 'disease' | 'prune-disease';

export interface TreeHealthFlags {
  diseased: boolean;
  needsPruning: boolean;
}

/**
 * Two independent facts.
 *  - diseased: the status says so, OR a disease/pest is recorded
 *  - needsPruning: the status says so
 * A tree recorded as "needs pruning" that also has a disease recorded is BOTH.
 */
export function getTreeHealthFlags(data: TreeDataLike): TreeHealthFlags {
  return {
    diseased: data.status === STATUS_DISEASED || (!!data.disease && data.disease !== NO_DISEASE),
    needsPruning: data.status === STATUS_NEEDS_PRUNING,
  };
}

export function getTreeTone(flags: TreeHealthFlags): TreeTone {
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
