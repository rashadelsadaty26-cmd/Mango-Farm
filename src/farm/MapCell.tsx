import React from 'react';
import { AlertTriangle, Bug, Leaf } from 'lucide-react';
import { MangoTree } from './TreeGraphics';
import type { InfraKind } from './infrastructure';
import {
  NO_DISEASE, UNSPECIFIED_VARIETY,
  getTreeHealthFlags, getTreeTone, getVarietyAccent, type TreeDataLike,
} from './treeVisuals';

export interface MapCellProps {
  cellId: string;
  /** The stored cell record (identity is stable across edits to *other* cells). */
  data: TreeDataLike | undefined;
  /** Effective infrastructure kind (cell type, else row/column gap kind). */
  infraKind: InfraKind | null;
  /** Row/column gap kind regardless of cell type (blank cells in a gap draw nothing). */
  gapKind: string | null;
  label: string;
  editMode: boolean;
  selected: boolean;
}

function StatusBadge({ diseased, needsPruning }: { diseased: boolean; needsPruning: boolean }) {
  if (diseased && needsPruning) {
    // Both facts at once: pruning first (dominant), disease second.
    return (
      <div className="farm-tree-status-badge farm-tree-status-badge--both" title="تحتاج تقليم ومصابة">
        <AlertTriangle size={10} className="text-amber-600" />
        <Bug size={10} className="text-red-600" />
      </div>
    );
  }
  return (
    <div
      className={`farm-tree-status-badge ${diseased ? 'text-red-600' : needsPruning ? 'text-amber-600' : 'text-emerald-600'}`}
      title="حالة الشجرة"
    >
      {diseased ? <Bug size={12} /> : needsPruning ? <AlertTriangle size={12} /> : <Leaf size={12} />}
    </div>
  );
}

function describeTree(cellId: string, data: TreeDataLike | undefined): string {
  if (!data?.lastUpdated) return `شجرة ${cellId}`;
  const { diseased, needsPruning } = getTreeHealthFlags(data);
  const parts = [`شجرة ${cellId}`];
  if (data.variety && data.variety !== UNSPECIFIED_VARIETY) parts.push(data.variety);
  if (needsPruning) parts.push('تحتاج تقليم');
  if (diseased) parts.push(data.disease && data.disease !== NO_DISEASE ? `مصابة: ${data.disease}` : 'مصابة');
  return parts.join(' — ');
}

function MapCellImpl({ cellId, data, infraKind, gapKind, label, editMode, selected }: MapCellProps) {
  const type = data?.type || 'tree';
  const isInfra = infraKind !== null;

  let content: React.ReactNode = null;

  if (type === 'spray_tank') {
    content = (
      <div className="farm-spray-tank" aria-label="حوض رش" title="حوض رش">
        <div className="farm-spray-tank-icon">🛢️</div>
        <span>حوض رش</span>
      </div>
    );
  } else if (type === 'water_canal' || type === 'drainage' || type === 'road' || (!data?.type && gapKind)) {
    // Drawn by the infrastructure layer.
    content = null;
  } else if (!data?.lastUpdated) {
    // A tree cell counts as "entered" only once the user has saved its data.
    content = (
      <div className="relative w-full h-full flex flex-col items-center justify-end">
        <div className="farm-tree-visual w-full h-[95%]">
          <div className="farm-flat-empty-tree" aria-hidden="true"><span /></div>
        </div>
      </div>
    );
  } else {
    // Health and pruning are independent facts; they are only combined here.
    const flags = getTreeHealthFlags(data);
    const tone = getTreeTone(flags);
    content = (
      <div className="relative w-full h-full flex flex-col items-center justify-end">
        <StatusBadge diseased={flags.diseased} needsPruning={flags.needsPruning} />
        <div className="farm-tree-visual w-full h-[95%]">
          <MangoTree tone={tone} accent={getVarietyAccent(data.variety)} />
        </div>
      </div>
    );
  }

  return (
    <div
      data-cell-id={cellId}
      data-infra-kind={isInfra ? infraKind : undefined}
      data-selected={selected ? 'true' : undefined}
      className={`farm-map-cell relative w-full h-full flex items-center justify-center ${isInfra ? 'farm-map-infrastructure-cell' : ''} ${
        editMode ? 'cursor-pointer hover:bg-white/30' : type === 'tree' ? 'cursor-pointer' : 'cursor-default'
      }`}
      title={editMode ? `تعديل: ${cellId}` : type === 'tree' ? describeTree(cellId, data) : ''}
    >
      <div className={`relative z-[1] w-full h-full ${isInfra ? 'pointer-events-none' : ''}`}>{content}</div>
      {label && !isInfra && <span className="farm-map-cell-label">{label}</span>}
    </div>
  );
}

// Shallow prop comparison is enough: `data` keeps its identity unless that very
// cell was edited, so changing one tree re-renders one cell, not the whole map.
export const MapCell = React.memo(MapCellImpl);
