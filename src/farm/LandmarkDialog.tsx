import React, { useState } from 'react';
import { AlertTriangle, Check, Move, Plus, Save, Trash2, Undo2, X } from 'lucide-react';
import {
  LANDMARK_ICON_CHOICES, MAX_LANDMARK_NAME, MAX_LANDMARK_NOTE, sanitizeIcon,
  type FarmLandmark, type LandmarkTypeEntry,
} from './landmarks';

// ============================================================================
// UI for farm landmarks. Pure presentation: App.tsx owns the state and the
// persistence; this file only renders and reports what the user did.
//
//   LandmarkPalette         قائمة العناصر: pick a type (with its instance count) to
//                           place it repeatedly, create a type, or open a placed object
//   PlacementBar            stays on screen while placing/moving; one obvious "done"
//   LandmarkDetailsDialog   inspect / edit ONE placed object (type, note, move, delete)
//   DeleteLandmarkConfirm   confirmation that names the single object being deleted
// ============================================================================

const MODAL = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4';

function ModalHeader({ icon, title, onClose }: { icon: string; title: string; onClose: () => void }) {
  return (
    <div className="bg-emerald-800 text-white px-5 py-3.5 flex justify-between items-center flex-none">
      <h2 className="text-lg font-bold flex items-center gap-2 m-0">
        <span aria-hidden="true">{icon}</span>
        {title}
      </h2>
      <button
        type="button"
        onClick={onClose}
        aria-label="إغلاق"
        className="text-emerald-100 hover:text-white transition-colors p-1 rounded-full hover:bg-emerald-600"
      >
        <X size={20} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icon picker (shared by "new type")
// ---------------------------------------------------------------------------

function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  const isPreset = LANDMARK_ICON_CHOICES.some((c) => c.icon === value);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold text-gray-700">الأيقونة</span>
      <div className="grid grid-cols-8 gap-1.5" role="group" aria-label="اختر أيقونة">
        {LANDMARK_ICON_CHOICES.map((c) => (
          <button
            key={c.icon}
            type="button"
            title={c.label}
            aria-label={c.label}
            aria-pressed={value === c.icon}
            onClick={() => onChange(c.icon)}
            className={`h-9 rounded-lg border text-lg leading-none transition-colors ${
              value === c.icon ? 'bg-emerald-100 border-emerald-600 ring-2 ring-emerald-300' : 'bg-gray-50 border-gray-200 hover:bg-emerald-50'
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
          value={isPreset ? '' : value}
          onChange={(e) => onChange(e.target.value.trim() ? sanitizeIcon(e.target.value, 'last') : '')}
          placeholder="🙂"
          className="w-20 p-2 text-center text-lg border border-gray-300 rounded-lg bg-gray-50 focus:ring-2 focus:ring-emerald-500 outline-none"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

export interface PlacedItem {
  landmark: FarmLandmark;
  /** e.g. "بين 3-04 و 3-05" */
  where: string;
  conflict: boolean;
}

export interface LandmarkPaletteProps {
  inventory: LandmarkTypeEntry[];
  placed: PlacedItem[];
  /** Start placing this type (palette closes; placement bar takes over). */
  onPick: (typeId: string) => void;
  /** Create a type. Returns an error message, or null on success (App then starts placing it). */
  onCreateType: (name: string, icon: string) => string | null;
  /** Only offered for custom types with no placed instances. */
  onDeleteType: (typeId: string) => void;
  onOpenLandmark: (id: string) => void;
  onClose: () => void;
}

export function LandmarkPalette({ inventory, placed, onPick, onCreateType, onDeleteType, onOpenLandmark, onClose }: LandmarkPaletteProps) {
  const [tab, setTab] = useState<'types' | 'placed'>('types');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📍');
  const [error, setError] = useState('');
  const total = inventory.reduce((n, t) => n + t.count, 0);

  const submitType = () => {
    const problem = onCreateType(name, icon);
    if (problem) setError(problem);
  };

  return (
    <div className={MODAL} role="dialog" aria-modal="true" aria-label="قائمة العناصر">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col" dir="rtl">
        <ModalHeader icon="📍" title="قائمة العناصر" onClose={onClose} />

        <div className="flex border-b border-gray-200 flex-none text-sm font-bold" role="tablist">
          {([['types', 'الأنواع'], ['placed', `الموضوعة (${total})`]] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`flex-1 py-2.5 transition-colors ${tab === key ? 'text-emerald-800 border-b-2 border-emerald-700 bg-emerald-50' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="p-4 overflow-y-auto flex flex-col gap-4">
          {tab === 'types' && (
            <>
              <p className="text-xs text-gray-500 m-0 leading-relaxed">
                اختر نوعاً ثم اضغط على الفراغات بين الأشجار لوضع أي عدد منه. العدد بجانب كل نوع هو ما تم وضعه فعلاً.
              </p>
              <div className="grid grid-cols-2 gap-2.5" data-testid="palette-types">
                {inventory.map((t) => (
                  <div key={t.id} className="relative">
                    <button
                      type="button"
                      data-type-id={t.id}
                      onClick={() => onPick(t.id)}
                      className="w-full flex items-center gap-2.5 text-right p-2.5 rounded-xl border border-gray-200 bg-gray-50 hover:bg-emerald-50 hover:border-emerald-400 transition-colors"
                    >
                      <span className="text-2xl leading-none flex-none" aria-hidden="true">{t.icon}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-bold text-gray-800 truncate">{t.name}</span>
                        <span className="block text-[11px] text-gray-500">{t.count === 0 ? 'لم يُوضع بعد' : `${t.count} موضوع`}</span>
                      </span>
                      <span className="flex-none min-w-[22px] h-[22px] px-1 rounded-full bg-emerald-700 text-white text-[11px] font-bold flex items-center justify-center" data-count>{t.count}</span>
                    </button>
                    {t.source === 'custom' && t.count === 0 && (
                      <button
                        type="button"
                        title="حذف هذا النوع (غير مستخدم)"
                        aria-label={`حذف النوع ${t.name}`}
                        onClick={() => onDeleteType(t.id)}
                        className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-white border border-red-200 text-red-600 flex items-center justify-center shadow-sm hover:bg-red-50"
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {!creating ? (
                <button
                  type="button"
                  onClick={() => { setCreating(true); setError(''); }}
                  className="self-start flex items-center gap-1.5 bg-sky-700 hover:bg-sky-800 text-white text-sm font-bold px-3.5 py-2 rounded-lg transition-colors"
                >
                  <Plus size={15} /> نوع جديد
                </button>
              ) : (
                <form
                  onSubmit={(e) => { e.preventDefault(); submitType(); }}
                  className="rounded-xl border border-sky-200 bg-sky-50/50 p-3.5 flex flex-col gap-3"
                >
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="landmark-type-name" className="text-sm font-semibold text-gray-700">اسم النوع</label>
                    <input
                      id="landmark-type-name"
                      type="text"
                      value={name}
                      maxLength={MAX_LANDMARK_NAME + 10}
                      onChange={(e) => { setName(e.target.value); setError(''); }}
                      placeholder="مثال: مأخذ كهرباء"
                      autoFocus
                      className="w-full p-2.5 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                  </div>
                  <IconPicker value={icon} onChange={(v) => { setIcon(v); setError(''); }} />
                  {error && (
                    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div>
                  )}
                  <div className="flex gap-2">
                    <button type="submit" className="flex-1 bg-emerald-700 hover:bg-emerald-800 text-white font-bold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-1.5">
                      <Check size={16} /> حفظ والبدء بالوضع
                    </button>
                    <button type="button" onClick={() => { setCreating(false); setError(''); }} className="px-4 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold rounded-xl border border-gray-300 transition-colors">
                      إلغاء
                    </button>
                  </div>
                </form>
              )}
            </>
          )}

          {tab === 'placed' && (
            placed.length === 0 ? (
              <div className="text-sm text-gray-500 leading-relaxed py-3">لا توجد عناصر موضوعة بعد. اختر نوعاً من تبويب «الأنواع» لبدء الوضع.</div>
            ) : (
              <div className="flex flex-col -mx-1" data-testid="palette-placed">
                {placed.map(({ landmark, where, conflict }) => (
                  <button
                    key={landmark.id}
                    type="button"
                    data-landmark-row={landmark.id}
                    onClick={() => onOpenLandmark(landmark.id)}
                    className="w-full flex items-center gap-2 text-right px-2 py-2 hover:bg-emerald-50 border-b border-gray-100 last:border-b-0 rounded"
                  >
                    <span className="text-lg leading-none" aria-hidden="true">{landmark.icon}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-bold text-gray-800 truncate">{landmark.name}</span>
                      <span className="block text-[11px] text-gray-500 truncate">{where}</span>
                    </span>
                    {conflict && <AlertTriangle size={14} className="text-amber-600 flex-none" />}
                  </button>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Placement bar (placing a type repeatedly, or moving one object)
// ---------------------------------------------------------------------------

export interface PlacementBarProps {
  mode: 'place' | 'move';
  icon: string;
  name: string;
  /** Instances of this type placed in this session / in total. */
  placedNow: number;
  total: number;
  /** Latest outcome (placed / refused), announced politely. */
  message: { text: string; tone: 'ok' | 'error' } | null;
  canUndo: boolean;
  onUndo: () => void;
  onChangeType: () => void;
  onDone: () => void;
}

export function PlacementBar({ mode, icon, name, placedNow, total, message, canUndo, onUndo, onChangeType, onDone }: PlacementBarProps) {
  const moving = mode === 'move';
  return (
    <div
      className="fixed inset-x-3 z-40 mx-auto max-w-lg bg-white rounded-2xl shadow-2xl border border-emerald-200 p-3 flex flex-col gap-2"
      style={{ bottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      dir="rtl"
      data-testid="placement-bar"
    >
      <div className="flex items-start gap-2.5 text-sm">
        <span className="text-2xl leading-none" aria-hidden="true">{icon || '📍'}</span>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-emerald-900">
            {moving ? `اضغط على المكان الجديد لنقل «${name}»` : `اضغط على الفراغات بين الأشجار لوضع «${name}»`}
          </div>
          <div role="status" aria-live="polite" className={message ? (message.tone === 'error' ? 'text-red-600 font-semibold' : 'text-emerald-700 font-semibold') : 'text-gray-500'}>
            {message?.text ?? (moving ? 'النقاط الخضراء هي الأماكن المتاحة.' : `النقاط الخضراء هي الأماكن المتاحة · وُضع الآن: ${placedNow} · الإجمالي: ${total}`)}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onDone}
          data-testid="placement-done"
          className="flex-1 bg-emerald-700 hover:bg-emerald-800 text-white font-bold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-1.5"
        >
          <Check size={16} /> {moving ? 'إلغاء النقل' : 'انتهيت'}
        </button>
        {!moving && (
          <>
            <button
              type="button"
              disabled={!canUndo}
              onClick={onUndo}
              data-testid="placement-undo"
              className="px-3 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed text-gray-800 font-bold rounded-xl border border-gray-300 transition-colors flex items-center gap-1.5"
            >
              <Undo2 size={15} /> تراجع
            </button>
            <button
              type="button"
              onClick={onChangeType}
              className="px-3 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold rounded-xl border border-gray-300 transition-colors"
            >
              نوع آخر
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Details of ONE placed object
// ---------------------------------------------------------------------------

export interface LandmarkDetailsProps {
  landmark: FarmLandmark;
  inventory: LandmarkTypeEntry[];
  /** e.g. "بين 3-04 و 3-05" */
  where: string;
  conflict: boolean;
  /** Current type id of this object. */
  typeKey: string;
  onSave: (patch: { typeId: string; note: string }) => void;
  onMove: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function LandmarkDetailsDialog({ landmark, inventory, where, conflict, typeKey, onSave, onMove, onDelete, onClose }: LandmarkDetailsProps) {
  const [typeId, setTypeId] = useState(typeKey);
  const [note, setNote] = useState(typeof landmark.meta?.note === 'string' ? (landmark.meta.note as string) : '');
  const chosen = inventory.find((t) => t.id === typeId);

  return (
    <div className={MODAL} role="dialog" aria-modal="true" aria-label="تفاصيل العنصر">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden max-h-[92vh] flex flex-col" dir="rtl">
        <ModalHeader icon={chosen?.icon ?? landmark.icon} title={chosen?.name ?? landmark.name} onClose={onClose} />
        <div className="p-5 flex flex-col gap-4 overflow-y-auto">
          <div className={`rounded-lg border px-3 py-2.5 text-sm ${conflict ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
            <div className="font-bold">الموقع</div>
            <div data-testid="landmark-where">{where}</div>
            {conflict && <div className="mt-1 text-xs">الموقع الحالي يتداخل مع طريق أو مصرف؛ يُفضّل نقل العنصر.</div>}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="landmark-type" className="text-sm font-semibold text-gray-700">النوع</label>
            <select
              id="landmark-type"
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
              className="w-full p-2.5 border border-gray-300 rounded-lg bg-gray-50 focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              {inventory.map((t) => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}
            </select>
            <p className="text-xs text-gray-500 m-0">تغيير النوع يخص هذا العنصر وحده.</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="landmark-note" className="text-sm font-semibold text-gray-700">ملاحظة (اختياري)</label>
            <textarea
              id="landmark-note"
              value={note}
              rows={2}
              maxLength={MAX_LANDMARK_NOTE}
              onChange={(e) => setNote(e.target.value)}
              className="w-full p-2.5 border border-gray-300 rounded-lg bg-gray-50 focus:ring-2 focus:ring-emerald-500 outline-none resize-none"
            />
          </div>

          <div className="flex gap-2 pt-3 border-t border-gray-100">
            <button
              type="button"
              onClick={() => onSave({ typeId, note })}
              className="flex-1 bg-emerald-700 hover:bg-emerald-800 text-white font-bold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-1.5"
            >
              <Save size={16} /> حفظ
            </button>
            <button
              type="button"
              onClick={onMove}
              data-testid="landmark-move"
              className="flex-1 bg-sky-700 hover:bg-sky-800 text-white font-bold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-1.5"
            >
              <Move size={16} /> نقل
            </button>
          </div>
          <button
            type="button"
            onClick={onDelete}
            data-testid="landmark-delete"
            className="flex items-center justify-center gap-1.5 text-red-700 hover:bg-red-50 border border-red-200 text-sm font-bold py-2 rounded-xl transition-colors"
          >
            <Trash2 size={15} /> حذف هذا العنصر فقط
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delete confirmation (same pattern as the existing "reset farm" confirmation).
// ---------------------------------------------------------------------------

export function DeleteLandmarkConfirm({
  landmark, where, onConfirm, onCancel,
}: { landmark: Pick<FarmLandmark, 'name' | 'icon'>; where: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4" role="alertdialog" aria-modal="true" aria-label="تأكيد حذف العنصر">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" dir="rtl">
        <div className="p-6 flex flex-col gap-4">
          <div className="flex items-center gap-2 text-red-600">
            <AlertTriangle size={22} />
            <h2 className="text-lg font-bold text-gray-800 m-0">حذف «{landmark.icon} {landmark.name}» هذا؟</h2>
          </div>
          <p className="text-sm text-gray-600 m-0 leading-relaxed">
            سيتم حذف هذا العنصر وحده ({where}). العناصر الأخرى من نفس النوع والأشجار والمروى والمصارف والطرق لن تتأثر.
          </p>
          <div className="flex gap-3 mt-2">
            <button
              type="button"
              onClick={onConfirm}
              data-testid="confirm-delete"
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
