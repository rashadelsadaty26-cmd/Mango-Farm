import React, { useEffect } from 'react';
import { Loader2, SlidersHorizontal, X } from 'lucide-react';
import { STATUS_NEEDS_PRUNING, statusLabel } from '../treeVisuals';
import type { RealisticMode } from './useRealisticMode';
import type { RealisticDisplayOptions } from './quality';

// ============================================================================
// UI for Realistic mode. Pure presentation over the useRealisticMode() state.
// ============================================================================

/** The compact toolbar buttons (they live in the existing zoom / reset toolbar). */
export function RealisticToolbarButtons({ mode }: { mode: RealisticMode }) {
  const { phase, active, panelOpen } = mode;
  const loading = phase === 'loading';
  return (
    <>
      <div className="w-full h-px bg-gray-200 my-1" />
      <button
        type="button"
        onClick={mode.requestToggle}
        aria-pressed={active || loading}
        data-realistic-button="true"
        title={active ? 'العودة إلى العرض العادي' : 'الوضع الواقعي (عرض الدرون)'}
        className={`relative flex flex-col items-center justify-center gap-0.5 rounded px-1 py-1.5 transition-colors ${
          active || loading ? 'bg-emerald-600 text-white shadow-inner' : 'text-gray-700 hover:bg-emerald-50 hover:text-emerald-700'
        }`}
      >
        <span className="text-[17px] leading-none" aria-hidden="true">🛰️</span>
        <span className="text-[9px] font-bold leading-none tracking-tight" dir="ltr">Realistic</span>
        {(active || loading) && (
          <span
            aria-hidden="true"
            className={`absolute -top-1 -left-1 h-2.5 w-2.5 rounded-full border-2 border-white ${loading ? 'bg-amber-400 animate-pulse' : 'bg-lime-300'}`}
          />
        )}
      </button>
      {active && (
        <button
          type="button"
          onClick={mode.togglePanel}
          aria-expanded={panelOpen}
          title="خيارات العرض الواقعي"
          className={`p-2 rounded transition-colors ${panelOpen ? 'bg-emerald-50 text-emerald-700' : 'text-gray-700 hover:bg-emerald-50 hover:text-emerald-700'}`}
        >
          <SlidersHorizontal size={18} />
        </button>
      )}
    </>
  );
}

/** Mandatory confirmation: nothing expensive exists until the user presses the confirm button. */
export function RealisticConfirmDialog({ mode }: { mode: RealisticMode }) {
  const open = mode.phase === 'confirm';
  const { cancel } = mode;
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, cancel]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" dir="rtl" onClick={cancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="realistic-dialog-title"
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 bg-emerald-800 px-5 py-4 text-white">
          <span className="text-xl" aria-hidden="true">🛰️</span>
          <h2 id="realistic-dialog-title" className="text-lg font-bold">تفعيل الوضع الواقعي ثلاثي التفاصيل</h2>
        </div>
        <div className="space-y-3 px-5 py-4 text-sm leading-7 text-gray-700">
          <p>سيتم تحويل خريطة المزرعة إلى عرض واقعي من أعلى يشبه تصوير الدرون، مع تفاصيل للأشجار والتربة والطرق ومرافق الري.</p>
          <p>قد يستهلك هذا الوضع موارد إضافية من الجهاز، وقد يؤثر على سلاسة الحركة والتكبير في الأجهزة الضعيفة.</p>
          <p className="font-bold text-gray-900">هل تريد تفعيل الوضع الواقعي؟</p>
        </div>
        <div className="flex gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3">
          <button
            type="button"
            onClick={mode.confirm}
            className="flex-1 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-800 active:bg-emerald-900"
          >
            تفعيل الوضع الواقعي
          </button>
          <button
            type="button"
            autoFocus
            onClick={mode.cancel}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 transition-colors hover:bg-gray-100"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

const OPTION_LABELS: Array<[keyof RealisticDisplayOptions, string]> = [
  ['showNumbers', 'أرقام الأشجار'],
  ['showStatus', 'مؤشرات الحالة'],
  ['showIrrigation', 'الري والمصارف'],
  ['showEquipmentLabels', 'أسماء المعدات'],
];

function LegendRow({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">{children}</svg>
      <span>{label}</span>
    </span>
  );
}

/** Options panel + compact legend, loading indicator and notices. Rendered inside the map area. */
export function RealisticOverlays({ mode }: { mode: RealisticMode }) {
  const { options, quality, progress, notice } = mode;
  return (
    <>
      {mode.active && mode.panelOpen && (
        <div
          className="absolute top-4 right-[4.6rem] z-10 w-[13.5rem] max-w-[calc(100vw-6rem)] rounded-lg border border-gray-200 bg-white/95 p-3 text-xs text-gray-700 shadow-md backdrop-blur"
          dir="rtl"
          role="group"
          aria-label="خيارات العرض الواقعي"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="font-bold text-gray-900">🛰️ العرض الواقعي</span>
            <button type="button" onClick={mode.togglePanel} aria-label="إغلاق" className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X size={14} /></button>
          </div>
          <div className="space-y-1.5">
            {OPTION_LABELS.map(([key, label]) => (
              <label key={key} className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-emerald-600"
                  checked={options[key]}
                  onChange={(e) => mode.setOption(key, e.target.checked)}
                />
                {label}
              </label>
            ))}
          </div>
          <div className="mt-3 border-t border-gray-100 pt-2">
            <div className="mb-1 font-bold text-gray-900">الجودة</div>
            <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label="جودة العرض">
              {(['high', 'low'] as const).map((q) => (
                <button
                  key={q}
                  type="button"
                  role="radio"
                  aria-checked={quality === q}
                  onClick={() => mode.chooseQuality(q)}
                  className={`rounded-md border px-2 py-1 font-bold transition-colors ${quality === q ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                >
                  {q === 'high' ? 'عالية' : 'منخفضة'}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 border-t border-gray-100 pt-2">
            <div className="mb-1 font-bold text-gray-900">دليل الرموز</div>
            <div className="grid grid-cols-1 gap-1">
              <LegendRow label="مصابة"><circle cx="8" cy="8" r="5.5" fill="#dc2626" stroke="#fff" strokeWidth="1" /></LegendRow>
              <LegendRow label={statusLabel(STATUS_NEEDS_PRUNING)}><path d="M8 2l6 11H2z" fill="#d97706" stroke="#fff" strokeWidth="1" /></LegendRow>
              <LegendRow label="مطعّمة / مقلوعة"><path d="M8 1.5l6.5 6.5L8 14.5 1.5 8z" fill="#111" stroke="#fff" strokeWidth="1" /></LegendRow>
              <LegendRow label="بدون بيانات"><circle cx="8" cy="8" r="6" fill="none" stroke="#9ca3af" strokeWidth="1.6" strokeDasharray="3 2.5" /></LegendRow>
              <LegendRow label="سليمة: أخضر بلا علامة"><circle cx="8" cy="8" r="5.5" fill="#3f7a31" /></LegendRow>
            </div>
          </div>
        </div>
      )}

      {progress !== null && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center" dir="rtl" role="status" aria-live="polite">
          <div className="flex w-64 flex-col items-center gap-3 rounded-xl border border-gray-200 bg-white/95 px-5 py-4 shadow-lg">
            <Loader2 className="h-7 w-7 animate-spin text-emerald-700" />
            <div className="text-sm font-bold text-gray-800">جاري تجهيز العرض الواقعي…</div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
              <div className="h-full rounded-full bg-emerald-600 transition-[width] duration-150" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          </div>
        </div>
      )}

      {notice && (
        <div
          className={`absolute left-1/2 top-4 z-20 flex w-[min(28rem,calc(100vw-7rem))] -translate-x-1/2 items-start gap-3 rounded-lg border px-3 py-2.5 text-xs shadow-md ${
            notice.kind === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
          dir="rtl"
          role="alert"
        >
          <div className="flex-1 leading-6">
            {notice.text}
            {notice.kind === 'slow' && (
              <button type="button" onClick={() => mode.chooseQuality('low')} className="mr-2 rounded bg-amber-600 px-2 py-0.5 font-bold text-white hover:bg-amber-700">
                تخفيض الجودة
              </button>
            )}
          </div>
          <button type="button" onClick={mode.dismissNotice} aria-label="إغلاق" className="rounded p-0.5 opacity-60 hover:opacity-100"><X size={14} /></button>
        </div>
      )}
    </>
  );
}
