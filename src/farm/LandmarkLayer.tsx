import React, { useMemo } from 'react';
import { GRID, GRID_ORIGIN, getOverlaySize } from './infrastructure';
import {
  PITCH_X, PITCH_Y, slotToPixel, stackOffsets,
  type FarmLandmark, type LandmarkMap, type SlotPos,
} from './landmarks';

// ============================================================================
// Landmarks are drawn in ONE absolutely-positioned layer over the land, using
// the same origin as the infrastructure SVG (GRID_ORIGIN). They are not grid
// cells, so they take no tree slot and cannot shift a tree. Because the layer
// lives inside the pan/zoom surface, positions stay exact while zooming/panning.
//
// The layer itself ignores pointers; only each badge is tappable. The existing
// map gesture handler resolves a tap with elementFromPoint(), so a badge is
// found through its data-landmark-id attribute (see App.tsx).
// ============================================================================

export interface LandmarkLayerProps {
  landmarks: LandmarkMap;
  rows: number;
  cols: number;
  selectedId: string | null;
  /** Ids whose slot is no longer valid (e.g. a road was drawn next to them). */
  conflictIds: ReadonlySet<string>;
  /** While choosing a location: show the tentative slot, and faint dots on every slot. */
  placing: boolean;
  ghost: { slot: SlotPos; icon: string; valid: boolean } | null;
  /** The landmark being moved is hidden from its old slot while the ghost shows the new one. */
  hiddenId: string | null;
}

const Badge = React.memo(function Badge({
  landmark, left, top, selected, conflict,
}: { landmark: FarmLandmark; left: number; top: number; selected: boolean; conflict: boolean }) {
  return (
    <div
      className="farm-landmark"
      role="button"
      tabIndex={-1}
      data-landmark-id={landmark.id}
      data-selected={selected ? 'true' : undefined}
      data-conflict={conflict ? 'true' : undefined}
      aria-label={landmark.name}
      title={conflict ? `${landmark.name} — الموقع الحالي يتداخل مع بنية تحتية، يُفضّل نقله` : landmark.name}
      style={{ left, top }}
    >
      <span aria-hidden="true">{landmark.icon}</span>
    </div>
  );
});

export const LandmarkLayer = React.memo(function LandmarkLayer({
  landmarks, rows, cols, selectedId, conflictIds, placing, ghost, hiddenId,
}: LandmarkLayerProps) {
  const list = useMemo(
    () => Object.values(landmarks).filter((lm) => lm.id !== hiddenId),
    [landmarks, hiddenId],
  );
  const offsets = useMemo(() => stackOffsets(list), [list]);
  const { width, height } = getOverlaySize(rows, cols);

  if (list.length === 0 && !placing && !ghost) return null;

  const ghostPx = ghost ? slotToPixel(ghost.slot) : null;

  return (
    <div
      className="farm-landmark-layer"
      style={{ left: GRID_ORIGIN.left, top: GRID_ORIGIN.top, width, height }}
      data-landmark-layer="true"
    >
      {placing && (
        // Every valid slot as a faint dot, from one tiled <pattern> (no per-slot DOM).
        <svg className="farm-slot-dots" width={width} height={height} aria-hidden="true" focusable="false" style={{ position: 'absolute', left: 0, top: 0 }}>
          <defs>
            <pattern id="farm-slot-pattern" width={PITCH_X} height={PITCH_Y} patternUnits="userSpaceOnUse">
              {/* vertical gutter (between two neighbours in a row) */}
              <circle cx={PITCH_X - GRID.gap / 2} cy={GRID.cellH / 2} r="2.4" fill="#047857" opacity="0.55" />
              {/* horizontal gutter (between two rows) */}
              <circle cx={GRID.cellW / 2} cy={PITCH_Y - GRID.gap / 2} r="2.4" fill="#047857" opacity="0.55" />
              {/* intersection of four trees */}
              <circle cx={PITCH_X - GRID.gap / 2} cy={PITCH_Y - GRID.gap / 2} r="2.4" fill="#047857" opacity="0.55" />
            </pattern>
          </defs>
          <rect x="0" y="0" width={width} height={height} fill="url(#farm-slot-pattern)" />
        </svg>
      )}

      {list.map((lm) => {
        const p = slotToPixel(lm.position);
        return (
          <Badge
            key={lm.id}
            landmark={lm}
            left={p.x + (offsets[lm.id] ?? 0)}
            top={p.y}
            selected={selectedId === lm.id}
            conflict={conflictIds.has(lm.id)}
          />
        );
      })}

      {ghost && ghostPx && (
        <div
          className="farm-landmark-ghost"
          data-invalid={ghost.valid ? undefined : 'true'}
          style={{ left: ghostPx.x, top: ghostPx.y }}
          aria-hidden="true"
        >
          <span>{ghost.icon}</span>
        </div>
      )}
    </div>
  );
});
