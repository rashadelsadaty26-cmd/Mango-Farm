import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MapPin, Search, X } from 'lucide-react';
import {
  completions, EXAMPLES, MESSAGES, searchFarm,
  type FocusTarget, type SearchFarm, type SearchMode, type SearchOption,
} from '../farmSearch';

// One panel for both "بحث" and "📍 أنا فين؟": same parser (farmSearch.ts), same
// states. Only the placeholder, the example text and the marker label differ.

type View =
  | { status: 'idle' }
  | { status: 'none'; message: string }
  | { status: 'ambiguous'; message: string; options: SearchOption[]; truncated: boolean }
  | { status: 'error'; message: string };

export interface SearchPanelProps {
  mode: SearchMode;
  onModeChange: (mode: SearchMode) => void;
  onClose: () => void;
  /** null while the farm data is still loading. */
  farm: SearchFarm | null;
  onSelect: (target: FocusTarget, mode: SearchMode) => void;
}

const COPY: Record<SearchMode, { placeholder: string; hint: string }> = {
  search: { placeholder: 'ابحث: شجرة ١٢، الصف ٣، العمود ٠٥، حوض الرش…', hint: 'ابحث عن شجرة أو صف أو عمود أو عنصر في المزرعة' },
  where: { placeholder: 'أنا واقف بين الشجرة ١٢ والشجرة ١٣…', hint: 'اوصف مكانك داخل المزرعة وهنعلّمه على الخريطة (مش GPS)' },
};

export function SearchPanel({ mode, onModeChange, onClose, farm, onSelect }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>({ status: 'idle' });
  const [showSuggestions, setShowSuggestions] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const loading = farm === null;

  useEffect(() => { inputRef.current?.focus(); }, [mode]);

  const suggestions = useMemo(() => {
    if (!farm || !showSuggestions || !query.trim()) return [];
    try { return completions(query, farm); } catch { return []; }
  }, [farm, query, showSuggestions]);

  const run = useCallback((text: string) => {
    if (!farm) return;
    try {
      const outcome = searchFarm(text, farm, mode);
      if (outcome.status === 'ok') { onSelect(outcome.target, mode); return; }
      if (outcome.status === 'ambiguous') { setView({ status: 'ambiguous', message: outcome.message, options: outcome.options, truncated: outcome.truncated }); return; }
      if (outcome.status === 'none') { setView({ status: 'none', message: outcome.message }); return; }
      setView({ status: 'none', message: MESSAGES.empty });
    } catch (err) {
      console.error('Farm search failed', err);
      setView({ status: 'error', message: 'حصلت مشكلة أثناء البحث. جرّب صياغة تانية.' });
    }
  }, [farm, mode, onSelect]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); setShowSuggestions(false); run(query); }
    else if (e.key === 'Escape') {
      e.stopPropagation();
      if (suggestions.length) setShowSuggestions(false); else onClose();
    }
  };

  return (
    <div className="farm-search-panel" role="dialog" aria-label={mode === 'where' ? 'أنا فين؟' : 'بحث في المزرعة'} data-testid="search-panel" data-mode={mode}>
      <div className="farm-search-head">
        <div className="farm-search-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'search'} data-active={mode === 'search'} onClick={() => { onModeChange('search'); setView({ status: 'idle' }); }}>
            <Search size={14} aria-hidden="true" /> بحث
          </button>
          <button type="button" role="tab" aria-selected={mode === 'where'} data-active={mode === 'where'} onClick={() => { onModeChange('where'); setView({ status: 'idle' }); }}>
            <MapPin size={14} aria-hidden="true" /> أنا فين؟
          </button>
        </div>
        <button type="button" className="farm-search-x" onClick={onClose} aria-label="إغلاق البحث" title="إغلاق"><X size={18} aria-hidden="true" /></button>
      </div>

      <form className="farm-search-form" onSubmit={(e) => { e.preventDefault(); setShowSuggestions(false); run(query); }}>
        <input
          ref={inputRef}
          type="text"
          inputMode="text"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          dir="rtl"
          className="farm-search-input"
          data-testid="search-input"
          value={query}
          placeholder={COPY[mode].placeholder}
          aria-label={COPY[mode].hint}
          disabled={loading}
          onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); if (view.status !== 'idle') setView({ status: 'idle' }); }}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className="farm-search-go" disabled={loading || !query.trim()} data-testid="search-submit" aria-label={mode === 'where' ? 'حدد مكاني' : 'ابحث'}>
          {mode === 'where' ? 'حدد' : 'بحث'}
        </button>
      </form>

      <div className="farm-search-body" aria-live="polite">
        {loading && (
          <p className="farm-search-state" data-testid="search-loading"><Loader2 size={16} className="farm-spin" aria-hidden="true" /> بيانات المزرعة لسه بتتحمل…</p>
        )}

        {!loading && suggestions.length > 0 && view.status === 'idle' && (
          <ul className="farm-search-list" data-testid="search-suggestions">
            {suggestions.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => { setQuery(s.query); setShowSuggestions(false); run(s.query); }}>{s.label}</button>
              </li>
            ))}
          </ul>
        )}

        {!loading && view.status === 'idle' && suggestions.length === 0 && (
          <div className="farm-search-empty" data-testid="search-empty">
            <p>{COPY[mode].hint}</p>
            <div className="farm-search-examples">
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" onClick={() => { setQuery(ex); setShowSuggestions(false); run(ex); }}>{ex}</button>
              ))}
            </div>
          </div>
        )}

        {view.status === 'none' && <p className="farm-search-state farm-search-none" data-testid="search-none">{view.message}</p>}
        {view.status === 'error' && <p className="farm-search-state farm-search-error" data-testid="search-error">{view.message}</p>}

        {view.status === 'ambiguous' && (
          <div data-testid="search-ambiguous">
            <p className="farm-search-state">{view.message}</p>
            <ul className="farm-search-list">
              {view.options.map((o) => (
                <li key={o.id}>
                  <button type="button" onClick={() => onSelect(o.target, mode)} data-testid="search-option">
                    <span>{o.label}</span>
                    {o.detail && <small>{o.detail}</small>}
                  </button>
                </li>
              ))}
            </ul>
            {view.truncated && <p className="farm-search-state">فيه نتائج أكتر، أضف تفاصيل (رقم الصف مثلاً) لتضييق البحث.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
