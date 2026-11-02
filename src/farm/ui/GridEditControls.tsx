import React, { useEffect, useRef } from 'react';
import { AlertTriangle, Minus, Plus, X } from 'lucide-react';
import { GRID } from '../infrastructure';
import { flipsColumns, flipsRows, getGridOrigin, type MapOrientation } from '../orientation';
import { gapToLogicalIndex, lineToLogicalIndex, type Axis, type RemovalImpact } from '../gridEdit';

// ============================================================================
// Farm Layout: direct row / column editing.
//
//  <GridEditControls>  lives INSIDE the land element, so every button is positioned
//                      in the map's own (grid) coordinates: it pans/zooms with the
//                      farm and belongs to one specific row / column / gap. A
//                      counter-scale (--farm-ctl-k, written by the pan/zoom code)
//                      keeps the buttons a usable size when zoomed out.
//  <GridOpPanel>       the confirmation. Tapping a control never changes the farm by
//                      itself: it only selects the operation, the exact line / gap is
//                      highlighted on the grid, and the farm changes only on confirm.
// ============================================================================

export interface GridOp {
  type: 'insert' | 'remove';
  axis: Axis;
  /** Insert: LOGICAL index the new line gets. Remove: LOGICAL index of the line. */
  index: number;
  /** DISPLAY gap (insert, 0..count) or DISPLAY line (remove) - what is drawn / highlighted. */
  display: number;
}

const pitchX = () => GRID.cellW + GRID.gap;
const pitchY = () => GRID.cellH + GRID.gap;
/** Distance of the control column / row from the land's edge (outside the fence). */
const OFFSET = 40;

export interface GridEditControlsProps {
  rows: number;
  cols: number;
  orientation: MapOrientation;
  /** Display number per LOGICAL row / column ('' = unnumbered). */
  rowLabels: string[];
  colLabels: string[];
  pending: GridOp | null;
  onRequest: (op: GridOp) => void;
}

const rowName = (labels: string[], logical: number) => (labels[logical] ? `الصف ${labels[logical]}` : `صف بدون رقم (${logical + 1})`);
const colName = (labels: string[], logical: number) => (labels[logical] ? `العمود ${labels[logical]}` : `عمود بدون رقم (${logical + 1})`);

/** "بين الصف 3 والصف 4" / "قبل الصف 1" / "بعد الصف 30" for a DISPLAY gap. */
export function describeGap(axis: Axis, gap: number, count: number, reversed: boolean, labels: string[]): string {
  const name = axis === 'row' ? rowName : colName;
  const at = (displayLine: number) => name(labels, lineToLogicalIndex(displayLine, count, reversed));
  if (count === 0) return '';
  if (gap <= 0) return `قبل ${at(0)}`;
  if (gap >= count) return `بعد ${at(count - 1)}`;
  return `بين ${at(gap - 1)} و${at(gap)}`;
}

export const GridEditControls = React.memo(function GridEditControls({
  rows, cols, orientation, rowLabels, colLabels, pending, onRequest,
}: GridEditControlsProps) {
  const origin = getGridOrigin(orientation);
  const flipX = flipsColumns(orientation);
  const flipY = flipsRows(orientation);
  const landW = GRID.pad * 2 + GRID.labelColW + GRID.gap + cols * GRID.cellW + Math.max(0, cols - 1) * GRID.gap;
  const landH = GRID.pad * 2 + GRID.headerH + GRID.gap + rows * GRID.cellH + Math.max(0, rows - 1) * GRID.gap;
  const gridW = cols * pitchX() - GRID.gap;
  const gridH = rows * pitchY() - GRID.gap;

  // Row controls sit beside the row-label strip; column controls beside the header strip.
  const rowX = flipX ? landW + OFFSET : -OFFSET;
  const colY = flipY ? landH + OFFSET : -OFFSET;

  const items: React.ReactNode[] = [];

  // ---- rows (displayed top -> bottom) ----
  for (let g = 0; g <= rows; g++) {
    const logical = gapToLogicalIndex(g, rows, flipY);
    const label = `إضافة صف جديد ${describeGap('row', g, rows, flipY, rowLabels)}`;
    items.push(
      <button
        key={`rg-${g}`}
        type="button"
        className="farm-grid-ctl farm-grid-ctl-add"
        data-axis="row" data-kind="insert" data-gap={g}
        data-active={pending?.type === 'insert' && pending.axis === 'row' && pending.display === g ? 'true' : undefined}
        style={{ left: rowX, top: origin.top + g * pitchY() - GRID.gap / 2 }}
        aria-label={label}
        title={label}
        onClick={() => onRequest({ type: 'insert', axis: 'row', index: logical, display: g })}
      >
        <Plus size={16} strokeWidth={3} aria-hidden="true" />
      </button>,
    );
  }
  for (let d = 0; d < rows; d++) {
    const logical = lineToLogicalIndex(d, rows, flipY);
    const label = `حذف ${rowName(rowLabels, logical)}`;
    items.push(
      <button
        key={`rr-${d}`}
        type="button"
        className="farm-grid-ctl farm-grid-ctl-remove"
        data-axis="row" data-kind="remove" data-line={d}
        data-active={pending?.type === 'remove' && pending.axis === 'row' && pending.display === d ? 'true' : undefined}
        style={{ left: rowX, top: origin.top + d * pitchY() + GRID.cellH / 2 }}
        aria-label={label}
        title={label}
        onClick={() => onRequest({ type: 'remove', axis: 'row', index: logical, display: d })}
      >
        <Minus size={16} strokeWidth={3} aria-hidden="true" />
      </button>,
    );
  }

  // ---- columns (displayed left -> right) ----
  for (let g = 0; g <= cols; g++) {
    const logical = gapToLogicalIndex(g, cols, flipX);
    const label = `إضافة عمود جديد ${describeGap('col', g, cols, flipX, colLabels)}`;
    items.push(
      <button
        key={`cg-${g}`}
        type="button"
        className="farm-grid-ctl farm-grid-ctl-add"
        data-axis="col" data-kind="insert" data-gap={g}
        data-active={pending?.type === 'insert' && pending.axis === 'col' && pending.display === g ? 'true' : undefined}
        style={{ left: origin.left + g * pitchX() - GRID.gap / 2, top: colY }}
        aria-label={label}
        title={label}
        onClick={() => onRequest({ type: 'insert', axis: 'col', index: logical, display: g })}
      >
        <Plus size={16} strokeWidth={3} aria-hidden="true" />
      </button>,
    );
  }
  for (let d = 0; d < cols; d++) {
    const logical = lineToLogicalIndex(d, cols, flipX);
    const label = `حذف ${colName(colLabels, logical)}`;
    items.push(
      <button
        key={`cr-${d}`}
        type="button"
        className="farm-grid-ctl farm-grid-ctl-remove"
        data-axis="col" data-kind="remove" data-line={d}
        data-active={pending?.type === 'remove' && pending.axis === 'col' && pending.display === d ? 'true' : undefined}
        style={{ left: origin.left + d * pitchX() + GRID.cellW / 2, top: colY }}
        aria-label={label}
        title={label}
        onClick={() => onRequest({ type: 'remove', axis: 'col', index: logical, display: d })}
      >
        <Minus size={16} strokeWidth={3} aria-hidden="true" />
      </button>,
    );
  }

  // ---- preview of the pending operation, drawn ON the grid ----
  let preview: React.ReactNode = null;
  if (pending) {
    if (pending.axis === 'row') {
      const y = pending.type === 'insert'
        ? origin.top + pending.display * pitchY() - GRID.gap / 2 - 5
        : origin.top + pending.display * pitchY() - 4;
      const h = pending.type === 'insert' ? 10 : GRID.cellH + 8;
      preview = <div className={`farm-grid-preview farm-grid-preview-${pending.type}`} style={{ left: origin.left - 6, top: y, width: gridW + 12, height: h }} data-testid="grid-preview" data-axis="row" />;
    } else {
      const x = pending.type === 'insert'
        ? origin.left + pending.display * pitchX() - GRID.gap / 2 - 5
        : origin.left + pending.display * pitchX() - 4;
      const w = pending.type === 'insert' ? 10 : GRID.cellW + 8;
      preview = <div className={`farm-grid-preview farm-grid-preview-${pending.type}`} style={{ left: x, top: origin.top - 6, width: w, height: gridH + 12 }} data-testid="grid-preview" data-axis="col" />;
    }
  }

  return (
    <div className="farm-grid-ctl-layer" data-grid-ctl-layer="" data-testid="grid-edit-controls">
      {preview}
      {items}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------

export interface GridOpPanelProps {
  op: GridOp;
  rows: number;
  cols: number;
  orientation: MapOrientation;
  rowLabels: string[];
  colLabels: string[];
  /** Impact of a removal (null for an insertion). */
  impact: RemovalImpact | null;
  onConfirm: () => void;
  onCancel: () => void;
}

const nf = (n: number) => String(n);

export function GridOpPanel({ op, rows, cols, orientation, rowLabels, colLabels, impact, onConfirm, onCancel }: GridOpPanelProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const isRow = op.axis === 'row';
  const noun = isRow ? 'صف' : 'عمود';
  const labels = isRow ? rowLabels : colLabels;
  const count = isRow ? rows : cols;
  const reversed = isRow ? flipsRows(orientation) : flipsColumns(orientation);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  useEffect(() => {
    if (op.type === 'remove') cancelRef.current?.focus();
  }, [op]);

  if (op.type === 'insert') {
    const where = describeGap(op.axis, op.display, count, reversed, labels);
    return (
      <div className="farm-gridop-bar" role="dialog" aria-label={`إضافة ${noun} جديد`} data-testid="grid-op-panel">
        <div className="farm-gridop-text">
          <strong>إضافة {noun} جديد {where}</strong>
          <span>
            سيظهر {noun === 'صف' ? 'الصف' : 'العمود'} الجديد فارغاً وتتحدّث أرقام {isRow ? 'الصفوف' : 'الأعمدة'} بعده تلقائياً.
            الأشجار الحالية ومعرّفاتها وبياناتها لا تتغير.
          </span>
        </div>
        <div className="farm-gridop-actions">
          <button type="button" className="farm-gridop-confirm" onClick={onConfirm} data-testid="grid-op-confirm">إضافة</button>
          <button type="button" className="farm-gridop-cancel" onClick={onCancel}>إلغاء</button>
        </div>
      </div>
    );
  }

  const target = isRow ? rowLabels[op.index] ? `الصف ${rowLabels[op.index]}` : `الصف (بدون رقم) رقم ${op.index + 1}` : colLabels[op.index] ? `العمود ${colLabels[op.index]}` : `العمود (بدون رقم) رقم ${op.index + 1}`;
  if (impact?.blocked) {
    return (
      <div className="farm-gridop-bar" role="alertdialog" aria-label="لا يمكن الحذف" data-testid="grid-op-panel">
        <div className="farm-gridop-text"><strong>لا يمكن حذف {target}</strong><span>لازم يفضل في المزرعة {noun} واحد على الأقل.</span></div>
        <div className="farm-gridop-actions"><button type="button" className="farm-gridop-cancel" onClick={onCancel}>حسناً</button></div>
      </div>
    );
  }
  const destructive = Boolean(impact?.destructive);
  return (
    <div className="farm-gridop-backdrop" onClick={onCancel}>
      <div
        className="farm-gridop-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="gridop-title"
        data-testid="grid-op-panel"
        data-destructive={destructive ? 'true' : 'false'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="farm-gridop-dialog-head" data-destructive={destructive ? 'true' : 'false'}>
          <AlertTriangle size={20} aria-hidden="true" />
          <h2 id="gridop-title">حذف {target}</h2>
          <button type="button" className="farm-gridop-x" onClick={onCancel} aria-label="إغلاق"><X size={18} /></button>
        </div>
        <div className="farm-gridop-dialog-body">
          {destructive && impact ? (
            <>
              <p>الحذف هيمسح بيانات محفوظة ومفيش رجوع بعده:</p>
              <ul>
                {impact.trees > 0 && <li><b>{nf(impact.trees)}</b> شجرة ببياناتها (الصنف والحالة والملاحظات)</li>}
                {impact.items > 0 && <li><b>{nf(impact.items)}</b> عنصر بنية تحتية (مروى / مصرف / طريق / حوض رش)</li>}
                {impact.placeholders > 0 && <li>{nf(impact.placeholders)} خلية فارغة مسجّلة</li>}
              </ul>
              {impact.landmarksMoved.length > 0 && (
                <p className="farm-gridop-keep">
                  العناصر المخصصة المجاورة ({impact.landmarksMoved.map((l) => l.name || 'بدون اسم').join('، ')}) <b>لن تُحذف</b>؛ هتنتقل للفاصل المجاور.
                </p>
              )}
            </>
          ) : (
            <p>{target} فارغ تماماً (مفيش أشجار أو عناصر محفوظة فيه). هيتم حذفه من الشبكة وتتحدّث أرقام {isRow ? 'الصفوف' : 'الأعمدة'} بعده.</p>
          )}
          {impact?.specialLine && <p>ملاحظة: هذا {noun} معلَّم «{impact.specialLine}».</p>}
          <p className="farm-gridop-small">باقي الأشجار تحتفظ بمعرّفاتها وبياناتها كما هي.</p>
        </div>
        <div className="farm-gridop-dialog-foot">
          <button type="button" className="farm-gridop-danger" onClick={onConfirm} data-testid="grid-op-confirm">
            {destructive ? `حذف ${isRow ? 'الصف' : 'العمود'} وبياناته نهائياً` : `حذف ${isRow ? 'الصف' : 'العمود'}`}
          </button>
          <button type="button" ref={cancelRef} className="farm-gridop-cancel" onClick={onCancel} data-testid="grid-op-cancel">إلغاء</button>
        </div>
      </div>
    </div>
  );
}
