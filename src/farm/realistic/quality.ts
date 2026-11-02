// ============================================================================
// Quality profiles + preferences for Realistic (drone) mode.
//
// Tiny and dependency-free on purpose: the main bundle imports this file, while
// the heavy modules (textures.ts, renderer.ts) are only loaded - via dynamic
// import() - AFTER the user confirms the mode.
// ============================================================================

export type QualityName = 'high' | 'mobile' | 'low';

export interface QualityProfile {
  name: QualityName;
  /** Seamless ground tile edge length (px). */
  soilTile: number;
  /** Road / water / concrete tile edge length (px). */
  detailTile: number;
  /** Canopy sprite edge length (px) at full resolution. Mip levels halve it twice. */
  canopySize: number;
  /** Number of distinct canopy sprites (trees pick one by a stable hash). */
  canopyVariants: number;
  /** Leaves painted into every canopy sprite. */
  leavesPerCanopy: number;
  /** Upper bound for devicePixelRatio used by the canvas. */
  dprCap: number;
  /** Upper bound for canvas backing-store pixels (width * height * dpr^2). */
  maxPixels: number;
  /** Vector leaf detail on very close zoom + tree basins. */
  closeDetail: boolean;
  /** Highest terrain resolution (canvas px per map unit) generated for the ground outside the fence. */
  terrainRes: number;
  /** Total terrain-cache size in canvas pixels (the cache is an LRU, it never grows past this). */
  terrainBudget: number;
  /** 0..1: density of the small exterior details (shrubs, stones, grass). */
  terrainDetail: number;
}

export const QUALITY_PROFILES: Record<QualityName, QualityProfile> = {
  high: {
    name: 'high', soilTile: 512, detailTile: 256, canopySize: 192, canopyVariants: 12,
    leavesPerCanopy: 420, dprCap: 2, maxPixels: 4_200_000, closeDetail: true,
    terrainRes: 1, terrainBudget: 14_000_000, terrainDetail: 1,
  },
  // Phones (iPhone in particular): the SAME tree artwork at a smaller sprite size, a lower
  // pixel-ratio cap, and a cheaper ground. Not a "broken" low-end look.
  mobile: {
    name: 'mobile', soilTile: 256, detailTile: 128, canopySize: 144, canopyVariants: 10,
    leavesPerCanopy: 300, dprCap: 1.5, maxPixels: 2_300_000, closeDetail: true,
    terrainRes: 0.55, terrainBudget: 5_000_000, terrainDetail: 0.7,
  },
  low: {
    name: 'low', soilTile: 256, detailTile: 128, canopySize: 96, canopyVariants: 6,
    leavesPerCanopy: 150, dprCap: 1, maxPixels: 1_600_000, closeDetail: false,
    terrainRes: 0.35, terrainBudget: 2_500_000, terrainDetail: 0.4,
  },
};

export interface RealisticDisplayOptions {
  /** Status markers (infected / weak / grafted / uprooted) and variety marks. */
  showStatus: boolean;
  /** Tree numbers (the existing coordinate labels). */
  showNumbers: boolean;
  /** Irrigation canals and drains. Roads and ground are always drawn. */
  showIrrigation: boolean;
  /** Names of custom equipment (landmarks) and the spray basin. */
  showEquipmentLabels: boolean;
}

export const DEFAULT_DISPLAY_OPTIONS: RealisticDisplayOptions = {
  showStatus: true,
  showNumbers: true,
  showIrrigation: true,
  showEquipmentLabels: true,
};

export interface RealisticPrefs {
  quality: QualityName | null;
  options: RealisticDisplayOptions;
}

// NOTE: only DISPLAY preferences are remembered (localStorage, this device).
// Whether the mode is ON is deliberately never stored: the confirmation dialog
// must appear every time. Nothing is written to Firestore.
const PREFS_KEY = 'mango-farm-realistic-prefs-v1';

export function loadPrefs(): RealisticPrefs {
  const fallback: RealisticPrefs = { quality: null, options: { ...DEFAULT_DISPLAY_OPTIONS } };
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<RealisticPrefs> & { options?: Partial<RealisticDisplayOptions> };
    const o: Partial<RealisticDisplayOptions> = parsed.options ?? {};
    const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
    return {
      quality: parsed.quality === 'high' || parsed.quality === 'mobile' || parsed.quality === 'low' ? parsed.quality : null,
      options: {
        showStatus: bool(o.showStatus, DEFAULT_DISPLAY_OPTIONS.showStatus),
        showNumbers: bool(o.showNumbers, DEFAULT_DISPLAY_OPTIONS.showNumbers),
        showIrrigation: bool(o.showIrrigation, DEFAULT_DISPLAY_OPTIONS.showIrrigation),
        showEquipmentLabels: bool(o.showEquipmentLabels, DEFAULT_DISPLAY_OPTIONS.showEquipmentLabels),
      },
    };
  } catch {
    return fallback;
  }
}

export function savePrefs(prefs: RealisticPrefs): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode / quota: the preference simply is not remembered */
  }
}

export interface DeviceClass {
  /** A phone or tablet (touch-first device), judged from capabilities - never from screen width alone. */
  mobile: boolean;
  ios: boolean;
  /** Low-end hint from the reported memory / core count. */
  weak: boolean;
}

/** What kind of device is this? Capability based: pointer type, touch points, platform, memory, cores. */
export function detectDeviceClass(): DeviceClass {
  try {
    const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
    const ua = nav.userAgent || '';
    const iPhoneLike = /iPhone|iPod/.test(ua);
    // iPadOS reports a desktop Mac UA but has touch points.
    const iPadOS = nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1;
    const ios = iPhoneLike || iPadOS || /iPad/.test(ua);
    const androidMobile = /Android/.test(ua) && /Mobile|Tablet|SM-|Pixel/.test(ua);
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && !matchMedia('(hover: hover)').matches;
    const uaMobile = nav.userAgentData?.mobile === true;
    const weak = (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 2)
      || (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 2);
    return { mobile: ios || androidMobile || uaMobile || coarse, ios, weak };
  } catch {
    return { mobile: false, ios: false, weak: false };
  }
}

/** Default quality from what the device reports. Users can always switch. */
export function detectDefaultQuality(): QualityName {
  const d = detectDeviceClass();
  if (d.weak) return 'low';
  return d.mobile ? 'mobile' : 'high';
}

/** True when a 2D canvas can be created at all (the only hard requirement). */
export function supportsCanvas2D(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext && !!c.getContext('2d') && typeof Path2D !== 'undefined';
  } catch {
    return false;
  }
}
