import { useCallback, useEffect, useRef, useState } from 'react';
import {
  detectDefaultQuality, loadPrefs, savePrefs, supportsCanvas2D,
  type QualityName, type RealisticDisplayOptions,
} from './quality';

// ============================================================================
// State machine for Realistic mode (no graphics code in here - it must stay
// cheap because it lives in the main bundle).
//
//   a farm opens   --default-->  loading --renderer ready--> on
//   user picks Standard:  any phase --> off   (remembered for THIS account)
//   user picks Realistic: off --> loading
//
// Realistic is the DEFAULT map mode. The Standard / Realistic choice is remembered
// per account (localStorage key scoped by the account id; never Firestore). The
// renderer module is only imported by <RealisticLayer>, which is only mounted in
// 'loading' / 'on'. Leaving 'on' unmounts it, which disposes the renderer.
// ============================================================================

export type RealisticPhase = 'off' | 'loading' | 'on';

export interface RealisticNotice {
  kind: 'error' | 'slow';
  text: string;
}

export interface RealisticMode {
  phase: RealisticPhase;
  /** The renderer exists (loading or on): mount <RealisticLayer>. */
  mounted: boolean;
  /** The realistic picture is what is on screen. */
  active: boolean;
  quality: QualityName;
  options: RealisticDisplayOptions;
  /** 0..1 while assets are being built (also when switching quality), otherwise null. */
  progress: number | null;
  notice: RealisticNotice | null;
  panelOpen: boolean;
  /** Switch between Standard and Realistic (the choice is remembered for this account). */
  requestToggle: () => void;
  togglePanel: () => void;
  setOption: <K extends keyof RealisticDisplayOptions>(key: K, value: RealisticDisplayOptions[K]) => void;
  chooseQuality: (q: QualityName) => void;
  dismissNotice: () => void;
  // Callbacks for <RealisticLayer>
  onProgress: (fraction: number) => void;
  onReady: () => void;
  onError: (message: string) => void;
  onSlow: () => void;
}

export const REALISTIC_MESSAGES = {
  unsupported: 'تعذّر تشغيل الوضع الواقعي على هذا الجهاز. تم الرجوع إلى العرض العادي ولم تتأثر أي بيانات.',
  failed: 'حدث خطأ أثناء تجهيز الوضع الواقعي. تم الرجوع إلى العرض العادي ولم تتأثر أي بيانات.',
  slow: 'الوضع الواقعي لسه بطيء على هذا الجهاز بعد ضبط الجودة تلقائياً. ممكن تحوّل لجودة أقل أو للعرض العادي بدون أي تأثير على بيانات المزرعة.',
} as const;

// ---- per-account map-mode preference --------------------------------------

export type MapModePreference = 'realistic' | 'standard';
const MODE_KEY_PREFIX = 'mango-farm-map-mode-v1:';

/** Realistic unless this account explicitly chose Standard. */
export function loadMapMode(scopeId: string | null | undefined): MapModePreference {
  try {
    if (!scopeId || typeof localStorage === 'undefined') return 'realistic';
    return localStorage.getItem(MODE_KEY_PREFIX + scopeId) === 'standard' ? 'standard' : 'realistic';
  } catch {
    return 'realistic';
  }
}

export function saveMapMode(scopeId: string | null | undefined, mode: MapModePreference): void {
  try {
    if (scopeId && typeof localStorage !== 'undefined') localStorage.setItem(MODE_KEY_PREFIX + scopeId, mode);
  } catch {
    /* private mode / quota: the preference is simply not remembered */
  }
}

/** The phase a farm opens in. Realistic needs a canvas; without one the app stays in Standard. */
export function initialPhase(scopeId: string | null | undefined): RealisticPhase {
  return loadMapMode(scopeId) === 'realistic' && supportsCanvas2D() ? 'loading' : 'off';
}

/**
 * @param scopeId the signed-in account (or local user) the preference belongs to.
 *                Changing it (another account) re-applies THAT account's choice.
 */
export function useRealisticMode(scopeId: string | null | undefined): RealisticMode {
  const [phase, setPhase] = useState<RealisticPhase>(() => initialPhase(scopeId));
  const [quality, setQuality] = useState<QualityName>(() => loadPrefs().quality ?? detectDefaultQuality());
  const pinnedQuality = useRef<boolean>(loadPrefs().quality !== null);
  const [options, setOptions] = useState<RealisticDisplayOptions>(() => loadPrefs().options);
  const [progress, setProgress] = useState<number | null>(() => (initialPhase(scopeId) === 'loading' ? 0 : null));
  const [notice, setNotice] = useState<RealisticNotice | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  // A different account signed in: open the farm the way THAT account last left it.
  const scopeRef = useRef(scopeId);
  useEffect(() => {
    if (scopeRef.current === scopeId) return;
    scopeRef.current = scopeId;
    const next = initialPhase(scopeId);
    setPhase(next);
    setProgress(next === 'loading' ? 0 : null);
    setPanelOpen(false);
    setNotice(null);
  }, [scopeId]);

  // Only DISPLAY preferences are remembered (this device).
  useEffect(() => {
    savePrefs({ quality: pinnedQuality.current ? quality : null, options });
  }, [quality, options]);

  // An error banner clears itself; the "slow" banner stays until the user acts.
  useEffect(() => {
    if (notice?.kind !== 'error') return undefined;
    const t = window.setTimeout(() => setNotice(null), 9000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const turnOff = useCallback(() => {
    setPhase('off');
    setProgress(null);
    setPanelOpen(false);
  }, []);

  const phaseRef = useRef<RealisticPhase>(phase);
  phaseRef.current = phase;

  const requestToggle = useCallback(() => {
    if (phaseRef.current === 'off') {
      if (!supportsCanvas2D()) {
        setNotice({ kind: 'error', text: REALISTIC_MESSAGES.unsupported });
        return;
      }
      saveMapMode(scopeRef.current, 'realistic');
      setNotice(null);
      setProgress(0);
      setPhase('loading');
    } else {
      saveMapMode(scopeRef.current, 'standard');
      turnOff();
    }
  }, [turnOff]);

  const onReady = useCallback(() => {
    setProgress(null);
    setPhase((p) => (p === 'loading' ? 'on' : p));
  }, []);

  // A renderer failure returns to Standard for this session but does NOT overwrite the
  // account's preference: the next opening simply tries Realistic again.
  const onError = useCallback((message: string) => {
    turnOff();
    setNotice({ kind: 'error', text: message });
  }, [turnOff]);

  const onSlow = useCallback(() => setNotice({ kind: 'slow', text: REALISTIC_MESSAGES.slow }), []);

  const chooseQuality = useCallback((q: QualityName) => {
    pinnedQuality.current = true;
    setNotice(null);
    setQuality(q);
  }, []);

  return {
    phase,
    mounted: phase === 'loading' || phase === 'on',
    active: phase === 'on',
    quality,
    options,
    progress,
    notice,
    panelOpen,
    requestToggle,
    togglePanel: () => setPanelOpen((v) => !v),
    setOption: (key, value) => setOptions((o) => ({ ...o, [key]: value })),
    chooseQuality,
    dismissNotice: () => setNotice(null),
    onProgress: setProgress,
    onReady,
    onError,
    onSlow,
  };
}
