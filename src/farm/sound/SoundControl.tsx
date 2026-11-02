import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, Volume2, VolumeX } from 'lucide-react';
import { FARM_SOUND_FORMATS, FARM_SOUND_PUBLIC_PATH, SOUND_MESSAGES } from './farmSound';
import type { FarmSoundApi } from './useFarmSound';

// Compact sound control for the Farm Layout toolbar: one button (state visible at a glance)
// that opens a small settings popover (toggle, volume, file availability, instructions).
// Nothing is rendered over the map.

export function SoundControl({ sound, realisticActive }: { sound: FarmSoundApi; realisticActive: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { enabled, status, availability, volume, error } = sound;
  const checkRef = useRef(sound.checkAvailability);
  checkRef.current = sound.checkAvailability;

  // Look for the file only when the settings are opened - never at startup.
  useEffect(() => { if (open) checkRef.current(); }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const playing = status === 'playing';
  const loading = status === 'loading';
  const stateText = loading ? 'جاري التحميل…' : playing ? 'يعمل' : enabled ? (realisticActive ? 'مفعّل' : 'مفعّل (في الوضع الواقعي)') : 'متوقف';
  const actionLabel = enabled ? '🔇 إيقاف صوت المزرعة' : '🔊 تشغيل صوت المزرعة';
  const missing = availability === 'missing';

  return (
    <div className="farm-sound" ref={rootRef} data-testid="sound-control">
      <button
        type="button"
        className="farm-sound-btn"
        data-on={enabled ? 'true' : 'false'}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        title="صوت المزرعة"
        data-testid="sound-button"
      >
        {loading ? <Loader2 size={14} className="farm-spin" aria-hidden="true" /> : enabled ? <Volume2 size={14} aria-hidden="true" /> : <VolumeX size={14} aria-hidden="true" />}
        <span>صوت المزرعة</span>
        <b data-testid="sound-state">{stateText}</b>
      </button>

      {open && (
        <div className="farm-sound-pop" role="dialog" aria-label="إعدادات صوت المزرعة" data-testid="sound-popover">
          <button
            type="button"
            className="farm-sound-toggle"
            data-on={enabled ? 'true' : 'false'}
            onClick={sound.toggle}
            data-testid="sound-toggle"
          >
            {actionLabel}
          </button>

          <label className="farm-sound-volume">
            <span>مستوى الصوت</span>
            <input
              type="range" min={0} max={100} step={1}
              value={Math.round(volume * 100)}
              onChange={(e) => sound.setVolume(Number(e.target.value) / 100)}
              aria-label="مستوى صوت المزرعة"
              data-testid="sound-volume"
            />
            <output>{Math.round(volume * 100)}%</output>
          </label>

          <p className="farm-sound-line" data-testid="sound-file-state" data-availability={availability}>
            {availability === 'checking' && 'جاري التحقق من ملف الصوت…'}
            {availability === 'available' && '✅ ملف الصوت موجود'}
            {availability === 'missing' && <><AlertCircle size={14} aria-hidden="true" /> {SOUND_MESSAGES.missing}</>}
            {availability === 'unreachable' && SOUND_MESSAGES.unreachable}
            {availability === 'unknown' && 'لم يتم التحقق من الملف بعد'}
          </p>
          {error && !missing && <p className="farm-sound-error" role="alert" data-testid="sound-error">{error}</p>}
          {enabled && !realisticActive && <p className="farm-sound-line">{SOUND_MESSAGES.waitingRealistic}</p>}

          <p className="farm-sound-help">
            الصوت من تسجيلك أنت: ضع الملف في <code dir="ltr">{FARM_SOUND_PUBLIC_PATH}</code> ثم أعد بناء/نشر التطبيق.
            الصيغة المدعومة: {FARM_SOUND_FORMATS}. لا يبدأ الصوت إلا بعد الضغط على التشغيل، ويعمل في الوضع الواقعي فقط.
          </p>
        </div>
      )}
    </div>
  );
}
