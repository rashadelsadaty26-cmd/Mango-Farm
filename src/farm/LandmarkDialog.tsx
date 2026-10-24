import React from 'react';
import { AlertTriangle, Plus, Save, Trash2, X } from 'lucide-react';
import {
  LANDMARK_ICON_CHOICES, MAX_LANDMARK_NAME, sanitizeIcon,
  type FarmLandmark, type SlotPos,
} from './landmarks';

// ============================================================================
// UI for custom farm objects. Pure presentation: App.tsx owns the state and the
// persistence, this file only renders the form and reports what the user did.
// ============================================================================

export interface LandmarkDraft {
  /** Stable id, generated ONCE when the dialog opens (so a retried save re-writes the same key). */
  id: string;
  mode: 'create' | 'edit';
  name: string;
  icon: string;
  position: SlotPos | null;
}

export interface LandmarkDialogProps {
  draft: LandmarkDraft;
  /** Text describing the chosen slot, e.g. "بين 003-004 و 003-005". */
  locationText: string | null;
  /** Why the chosen slot cannot be used (null = fine). */
  locationProblem: string | null;
  error: string;
  onChange: (patch: Partial<LandmarkDraft>) => void;
  onPickLocation: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}

export function LandmarkDialog({
  draft, locationText, locationProblem, error, onChange, onPickLocation, onSave, onCancel, onDelete,
}: LandmarkDialogProps) {
  const isCreate = draft.mode === 'create';
  const iconIsPreset = LANDMARK_ICON_CHOICES.some((c) => c.icon === draft.icon);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label={isCreate ? 'إنشاء عنصر جديد' : 'تعديل العنصر'}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden max-h-[92vh] flex flex-col" dir="rtl">
        <div className="bg-emerald-800 text-white px-6 py-4 flex justify-between items-center flex-none">
          <h2 className="text-xl font-bold flex items-center gap-2 m-0">
            <span aria-hidden="true">{draft.icon || '📍'}</span>
            {isCreate ? 'إنشاء عنصر جديد' : 'تعديل العنصر'}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="إغلاق"
            className="text-emerald-100 hover:text-white transition-colors p-1 rounded-full hover:bg-emerald-600"
          >
            <X size={20} />
          </button>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); onSave(); }}
          className="p-6 flex flex-col gap-5 overflow-y-auto"
        >
          {/* 1. Name */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="landmark-name" className="text-sm font-semibold text-gray-700">اسم العنصر</label>
            <input
              id="landmark-name"
              type="text"
              value={draft.name}
              maxLength={MAX_LANDMARK_NAME + 10}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="مثال: حوض ماء"
              autoFocus={isCreate}
              className="w-full p-2.5 border border-gray-300 rounded-lg bg-gray-50 focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>

          {/* 2. Icon */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-gray-700">الأيقونة</span>
            <div className="grid grid-cols-8 gap-1.5" role="group" aria-label="اختر أيقونة">
              {LANDMARK_ICON_CHOICES.map((c) => (
                <button
                  key={c.icon}
                  type="button"
                  title={c.label}
                  aria-label={c.label}
                  aria-pressed={draft.icon === c.icon}
                  onClick={() => onChange({ icon: c.icon })}
                  className={`h-9 rounded-lg border text-lg leading-none transition-colors ${
                    draft.icon === c.icon
                      ? 'bg-emerald-100 border-emerald-600 ring-2 ring-emerald-300'
                      : 'bg-gray-50 border-gray-200 hover:bg-emerald-50'
                  }`}
                >
                  {c.icon}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="landmark-icon" className="text-xs font-semibold text-gray-500 whitespace-nowrap">أو اكتب رمزاً/إيموجي:</label>
              <input
                id="landmark-icon"
                type="text"
                value={iconIsPreset ? '' : draft.icon}
                onChange={(e) => onChange({ icon: e.target.value.trim() ? sanitizeIcon(e.target.value, 'last') : '' })}
                placeholder="🙂"
                className="w-20 p-2 text-center text-lg border border-gray-300 rounded-lg bg-gray-50 focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
          </div>

          {/* 3. Location */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-gray-700">الموقع على الخريطة</span>
            <div
              className={`rounded-lg border px-3 py-2.5 text-sm ${
                locationProblem
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : locationText
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    : 'border-dashed border-gray-300 bg-gray-50 text-gray-500'
              }`}
              aria-live="polite"
            >
              {locationProblem ?? locationText ?? 'لم يتم اختيار موقع بعد'}
            </div>
            <button
              type="button"
              onClick={onPickLocation}
              className="self-start flex items-center gap-1.5 bg-stone-100 hover:bg-stone-200 border border-stone-300 text-stone-800 text-sm font-bold px-3 py-2 rounded-lg transition-colors"
            >
              <Plus size={14} />
              {draft.position ? 'تغيير الموقع على الخريطة' : 'اختيار الموقع على الخريطة'}
            </button>
            <p className="text-xs text-gray-500 m-0 leading-relaxed">
              يمكن وضع العنصر في الفراغ بين الأشجار فقط؛ لا يستبدل شجرة ولا يغيّر بياناتها.
            </p>
          </div>

          {error && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-4 border-t border-gray-100">
            <button
              type="submit"
              className="flex-1 bg-emerald-700 hover:bg-emerald-800 text-white font-bold py-3 px-4 rounded-xl transition-colors shadow-md flex items-center justify-center gap-2"
            >
              <Save size={18} />
              {isCreate ? 'حفظ العنصر' : 'حفظ التعديلات'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold py-3 px-4 rounded-xl transition-colors border border-gray-300"
            >
              إلغاء
            </button>
          </div>

          {!isCreate && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="flex items-center justify-center gap-1.5 text-red-700 hover:bg-red-50 border border-red-200 text-sm font-bold py-2 rounded-xl transition-colors"
            >
              <Trash2 size={15} /> حذف العنصر
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bottom bar shown while the user taps the map to choose a location.
// ---------------------------------------------------------------------------

export function PlacementBar({
  icon, locationText, problem, canConfirm, onConfirm, onCancel,
}: {
  icon: string;
  locationText: string | null;
  problem: string | null;
  canConfirm: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-x-3 z-40 mx-auto max-w-lg bg-white rounded-2xl shadow-2xl border border-emerald-200 p-3 flex flex-col gap-2"
      style={{ bottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      dir="rtl"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2 text-sm">
        <span className="text-xl leading-none" aria-hidden="true">{icon || '📍'}</span>
        <div className="flex-1">
          <div className="font-bold text-emerald-900">اضغط على الفراغ بين الأشجار لتحديد الموقع</div>
          <div className={problem ? 'text-red-600 font-semibold' : locationText ? 'text-emerald-800' : 'text-gray-500'}>
            {problem ?? locationText ?? 'النقاط الخضراء هي الأماكن المتاحة.'}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!canConfirm}
          onClick={onConfirm}
          className="flex-1 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-bold py-2.5 rounded-xl transition-colors"
        >
          تأكيد الموقع
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold py-2.5 rounded-xl border border-gray-300 transition-colors"
        >
          رجوع
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delete confirmation (same pattern as the existing "reset farm" confirmation).
// ---------------------------------------------------------------------------

export function DeleteLandmarkConfirm({
  landmark, onConfirm, onCancel,
}: { landmark: Pick<FarmLandmark, 'name' | 'icon'>; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4" role="alertdialog" aria-modal="true" aria-label="تأكيد حذف العنصر">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" dir="rtl">
        <div className="p-6 flex flex-col gap-4">
          <div className="flex items-center gap-2 text-red-600">
            <AlertTriangle size={22} />
            <h2 className="text-lg font-bold text-gray-800 m-0">حذف «{landmark.icon} {landmark.name}»؟</h2>
          </div>
          <p className="text-sm text-gray-600 m-0 leading-relaxed">
            سيتم حذف هذا العنصر من الخريطة نهائياً. الأشجار والمروى والمصارف والطرق لن تتأثر.
          </p>
          <div className="flex gap-3 mt-2">
            <button
              type="button"
              onClick={onConfirm}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 px-4 rounded-xl transition-colors"
            >
              نعم، احذف
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold py-2.5 px-4 rounded-xl transition-colors border border-gray-300"
            >
              إلغاء
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
