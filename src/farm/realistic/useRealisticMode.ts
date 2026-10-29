import { useCallback, useEffect, useRef, useState } from 'react';
import {
  detectDefaultQuality, loadPrefs, savePrefs,
  type QualityName, type RealisticDisplayOptions,
} from './quality';

// ============================================================================
// State machine for Realistic mode (no graphics code in here - it must stay
// cheap because it lives in the main bundle).
//
//   off --click--> confirm --confirm--> loading --renderer ready--> on
//    ^                |                    |                          |
//    +----cancel------+----click / error---+------click / error-------+
//
// Nothing expensive exists while the phase is 'off' or 'confirm': the renderer
// module is only imported by <RealisticLayer>, which is only mounted in
// 'loading' / 'on'. Leaving 'on' unmounts it, which disposes the renderer.
// ============================================================================

export type RealisticPhase = 'off' | 'confirm' | 'loading' | 'on';

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
  requestToggle: () => void;
  confirm: () => void;
  cancel: () => void;
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
  slow: 'الوضع الواقعي بطيء على هذا الجهاز. يمكنك التحويل إلى جودة أقل دون أي تأثير على بيانات المزرعة.',
} as const;

export function useRealisticMode(): RealisticMode {
  const [phase, setPhase] = useState<RealisticPhase>('off');
  const [quality, setQuality] = useState<QualityName>(() => loadPrefs().quality ?? detectDefaultQuality());
  const pinnedQuality = useRef<boolean>(loadPrefs().quality !== null);
  const [options, setOptions] = useState<RealisticDisplayOptions>(() => loadPrefs().options);
  const [progress, setProgress] = useState<number | null>(null);
  const [notice, setNotice] = useState<RealisticNotice | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  // Only DISPLAY preferences are remembered (this device). Whether the mode is on is never stored.
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

  const phaseRef = useRef<RealisticPhase>('off');
  phaseRef.current = phase;

  // Off -> ask first. Already loading / on -> straight back to Standard Mode, no second dialog.
  const requestToggle = useCallback(() => {
    if (phaseRef.current === 'off') setPhase('confirm');
    else turnOff();
  }, [turnOff]);

  const confirm = useCallback(() => {
    setNotice(null);
    setProgress(0);
    setPhase('loading');
  }, []);

  const cancel = useCallback(() => setPhase('off'), []);

  const onReady = useCallback(() => {
    setProgress(null);
    setPhase((p) => (p === 'loading' ? 'on' : p));
  }, []);

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
    confirm,
    cancel,
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
