import React from 'react';
import { GRID, getOverlaySize } from './infrastructure';

// ============================================================================
// Farm Layout mode used to outline every cell with its own dashed CSS outline
// (1,800 outlined boxes repainted on every zoom frame). The same picture is now
// ONE SVG: a single dashed rectangle tile repeated by an SVG <pattern>. It is
// symmetric, so it needs no mirroring, and it takes no pointer events.
// ============================================================================

export const EditGridOverlay = React.memo(function EditGridOverlay({
  rows, cols, origin,
}: { rows: number; cols: number; origin: { left: number; top: number } }) {
  const { width, height } = getOverlaySize(rows, cols);
  const pitchX = GRID.cellW + GRID.gap;
  const pitchY = GRID.cellH + GRID.gap;
  return (
    <svg
      className="farm-edit-grid"
      width={width}
      height={height}
      style={{ position: 'absolute', left: origin.left, top: origin.top, pointerEvents: 'none' }}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern id="farm-edit-grid-tile" width={pitchX} height={pitchY} patternUnits="userSpaceOnUse">
          <rect
            x="0.5" y="0.5" width={GRID.cellW - 1} height={GRID.cellH - 1}
            fill="none" stroke="rgba(92,78,54,0.3)" strokeWidth="1" strokeDasharray="4 3"
          />
        </pattern>
      </defs>
      <rect x="0" y="0" width={width} height={height} fill="url(#farm-edit-grid-tile)" />
    </svg>
  );
});
