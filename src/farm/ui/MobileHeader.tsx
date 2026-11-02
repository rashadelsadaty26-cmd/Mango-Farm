import React, { useEffect, useRef, useState } from 'react';
import { Cloud, CloudOff, Eye, LogOut, MoreVertical, Palette, Pencil, RefreshCw } from 'lucide-react';

// Slim FIXED header for phones. It never hides, slides or animates on scroll / pan / zoom
// (the old hide-on-scroll header and its swipe tracking are gone). Everything that used to be
// reachable from the header is still reachable: the view / layout switch stays one tap away
// and every secondary action lives in "المزيد".

export interface MobileHeaderProps {
  farmName: string;
  mode: 'view' | 'edit';
  onModeChange: (mode: 'view' | 'edit') => void;
  syncStatus: 'offline' | 'syncing' | 'synced' | 'error' | string;
  isCloud: boolean;
  /** Present only for a signed-in cloud account. */
  onLogout?: () => void;
  username?: string;
  onToggleLegend: () => void;
}

const SYNC_LABEL: Record<string, string> = {
  syncing: 'جاري المزامنة', synced: 'تمت المزامنة', error: 'مشكلة في المزامنة', offline: 'غير متصل — محفوظ محلياً',
};

export function MobileHeader({ farmName, mode, onModeChange, syncStatus, isCloud, onLogout, username, onToggleLegend }: MobileHeaderProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const syncText = SYNC_LABEL[syncStatus] ?? SYNC_LABEL.synced;
  return (
    <>
      <header className="farm-mheader" data-testid="mobile-header" ref={rootRef}>
        <h1 className="farm-mheader-title" title={farmName}>{farmName}</h1>
        <div className="farm-mheader-seg" role="group" aria-label="نمط الشاشة">
          <button type="button" data-active={mode === 'view'} aria-pressed={mode === 'view'} onClick={() => onModeChange('view')} aria-label="الإدارة والبيانات" title="الإدارة والبيانات"><Eye size={17} aria-hidden="true" /></button>
          <button type="button" data-active={mode === 'edit'} aria-pressed={mode === 'edit'} onClick={() => onModeChange('edit')} aria-label="تخطيط المزرعة" title="تخطيط المزرعة" data-testid="mode-edit"><Pencil size={16} aria-hidden="true" /></button>
        </div>
        <button type="button" className="farm-mheader-more" aria-expanded={open} aria-haspopup="menu" aria-label="المزيد" onClick={() => setOpen((v) => !v)} data-testid="more-menu-button">
          <MoreVertical size={20} aria-hidden="true" /><span>المزيد</span>
        </button>

        {open && (
          <div className="farm-mheader-menu" role="menu" data-testid="more-menu">
            <div className="farm-mheader-row" role="none">
              {syncStatus === 'syncing' ? <RefreshCw size={15} className="farm-spin" aria-hidden="true" /> : syncStatus === 'offline' || syncStatus === 'error' ? <CloudOff size={15} aria-hidden="true" /> : <Cloud size={15} aria-hidden="true" />}
              <span>{syncText}</span>
              <small>{isCloud ? 'سحابي' : 'محلي'}</small>
            </div>
            {username && <div className="farm-mheader-row" role="none"><span>الحساب: {username}</span></div>}
            <button type="button" role="menuitem" onClick={() => { onModeChange('view'); setOpen(false); }} data-active={mode === 'view'}><Eye size={16} aria-hidden="true" /><span>الإدارة والبيانات</span></button>
            <button type="button" role="menuitem" onClick={() => { onModeChange('edit'); setOpen(false); }} data-active={mode === 'edit'}><Pencil size={16} aria-hidden="true" /><span>تخطيط المزرعة</span></button>
            <button type="button" role="menuitem" onClick={() => { onToggleLegend(); setOpen(false); }}><Palette size={16} aria-hidden="true" /><span>دليل الألوان والرموز</span></button>
            {onLogout && (
              <button type="button" role="menuitem" className="farm-mheader-danger" onClick={() => { setOpen(false); onLogout(); }} data-testid="logout-button"><LogOut size={16} aria-hidden="true" /><span>تسجيل الخروج</span></button>
            )}
          </div>
        )}
      </header>
      <div className="farm-mheader-spacer" aria-hidden="true" />
    </>
  );
}
