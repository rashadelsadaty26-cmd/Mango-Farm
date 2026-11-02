import React, { useEffect, useRef, useState } from 'react';
import { Layers, Loader2, MapPin, MoreHorizontal, Palette, Search, SlidersHorizontal, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import type { SearchMode } from '../farmSearch';

// Compact floating map toolbar, bottom-centre of the map viewport (desktop and mobile).
// It owns no map logic: every action is a callback from App.tsx. Position and size
// are plain CSS (index.css, .farm-toolbar*), which respects the iPhone safe areas.

export interface MapToolbarProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  /** Which search panel is open, if any (highlights its button). */
  searchOpen: SearchMode | null;
  onSearch: () => void;
  onWhere: () => void;
  realisticActive: boolean;
  realisticLoading: boolean;
  onToggleRealistic: () => void;
  realisticOptionsOpen: boolean;
  onToggleRealisticOptions: () => void;
  legendOpen: boolean;
  onToggleLegend: () => void;
}

export function MapToolbar(p: MapToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e: PointerEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  const rl = p.realisticActive || p.realisticLoading;
  return (
    <div className="farm-toolbar-wrap" ref={rootRef}>
      {menuOpen && (
        <div className="farm-toolbar-menu" role="menu" aria-label="المزيد من أدوات الخريطة" data-testid="toolbar-menu">
          <button type="button" role="menuitemcheckbox" aria-checked={rl} onClick={() => { p.onToggleRealistic(); setMenuOpen(false); }} data-testid="toggle-realistic">
            {p.realisticLoading ? <Loader2 size={16} className="farm-spin" aria-hidden="true" /> : <Layers size={16} aria-hidden="true" />}
            <span>🛰️ الوضع الواقعي</span>
            <b data-on={rl ? 'true' : 'false'}>{rl ? 'يعمل' : 'متوقف'}</b>
          </button>
          {p.realisticActive && (
            <button type="button" role="menuitem" onClick={() => { p.onToggleRealisticOptions(); setMenuOpen(false); }} aria-expanded={p.realisticOptionsOpen}>
              <SlidersHorizontal size={16} aria-hidden="true" /><span>خيارات العرض الواقعي</span>
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => { p.onToggleLegend(); setMenuOpen(false); }} aria-expanded={p.legendOpen} data-testid="toggle-legend">
            <Palette size={16} aria-hidden="true" /><span>دليل الألوان والرموز</span>
          </button>
        </div>
      )}

      <div className="farm-toolbar" role="toolbar" aria-label="أدوات الخريطة" data-testid="map-toolbar">
        <button type="button" className="farm-tb-btn" onClick={p.onZoomIn} aria-label="تكبير" title="تكبير" data-testid="zoom-in"><ZoomIn size={19} aria-hidden="true" /></button>
        <button type="button" className="farm-tb-btn" onClick={p.onZoomOut} aria-label="تصغير" title="تصغير" data-testid="zoom-out"><ZoomOut size={19} aria-hidden="true" /></button>
        <button type="button" className="farm-tb-btn" onClick={p.onReset} aria-label="إعادة ضبط وعرض المزرعة كلها" title="عرض المزرعة كلها" data-testid="zoom-reset"><Maximize2 size={18} aria-hidden="true" /></button>
        <span className="farm-tb-sep" aria-hidden="true" />
        <button type="button" className="farm-tb-btn" data-active={p.searchOpen === 'search'} aria-pressed={p.searchOpen === 'search'} onClick={p.onSearch} aria-label="بحث في المزرعة" title="بحث عن شجرة أو صف أو عمود أو عنصر" data-testid="open-search"><Search size={19} aria-hidden="true" /></button>
        <button type="button" className="farm-tb-btn farm-tb-where" data-active={p.searchOpen === 'where'} aria-pressed={p.searchOpen === 'where'} onClick={p.onWhere} aria-label="أنا فين؟" title="حدد مكانك داخل المزرعة" data-testid="open-where">
          <MapPin size={18} aria-hidden="true" /><span>📍 أنا فين؟</span>
        </button>
        <span className="farm-tb-sep" aria-hidden="true" />
        <button type="button" className="farm-tb-btn" data-active={menuOpen} aria-expanded={menuOpen} aria-haspopup="menu" onClick={() => setMenuOpen((v) => !v)} aria-label="المزيد" title="المزيد" data-testid="toolbar-more">
          <MoreHorizontal size={20} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
