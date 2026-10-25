import React, { useMemo } from 'react';
import { getOverlaySize, type KindGrid } from './infrastructure';
import { mirrorSlot, type MapOrientation } from './orientation';
import {
  isTreeCenter, slotBlockedReason, slotKey, slotToPixel, stackOffsets,
  type FarmLandmark, type LandmarkMap,
} from './landmarks';

// ============================================================================
// Landmarks are drawn in ONE absolutely-positioned layer over the land, using
// the same origin as the infrastructure SVG. They are not grid cells, so they
// take no tree slot and cannot shift a tree. Because the layer lives inside the
// pan/zoom surface, positions stay exact while zooming/panning.
//
// Positions are stored on the LOGICAL slot lattice. Mirroring only changes where
// a slot is drawn (mirrorSlot), so a landmark always sits between the same two
// trees whatever the orientation.
//
// The layer itself ignores pointers; only each badge is tappable. The existing
// map gesture handler resolves a tap with elementFromPoint(), so a badge is
// found through its data-landmark-id attribute (see App.tsx).
// ============================================================================

export interface LandmarkLayerProps {
  landmarks: LandmarkMap;
  rows: number;
  cols: number;
  orientation: MapOrientation;
  /** Where cell (0,0) is drawn (see getGridOrigin). */
  origin: { left: number; top: number };
  selectedId: string | null;
  /** Ids whose slot is no longer valid (e.g. a road was drawn next to them). */
  conflictIds: ReadonlySet<string>;
  /** While placing/moving: a dot on every slot that can actually be used. */
  placing: boolean;
  /** Connected infrastructure (LOGICAL layout); decides which slots are usable. */
  kindGrid: KindGrid | null;
  /** The object being moved (its own slot stays available). */
  movingId?: string | null;
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
  landmarks, rows, cols, orientation, origin, selectedId, conflictIds, placing, kindGrid, movingId = null,
}: LandmarkLayerProps) {
  const list = useMemo(() => Object.values(landmarks), [landmarks]);
  const offsets = useMemo(() => stackOffsets(list), [list]);
  // Display position of every landmark: computed only when the landmarks, the
  // farm size or the orientation change, never while zooming or panning.
  const placed = useMemo(
    () => list.map((lm) => {
      const p = slotToPixel(mirrorSlot(lm.position, rows, cols, orientation));
      return { lm, x: p.x + (offsets[lm.id] ?? 0), y: p.y };
    }),
    [list, offsets, rows, cols, orientation],
  );
  // One <path> of small circles, one per slot the user may tap right now: not a tree,
  // inside the farm, not beside a road/drain, not already taken. Recomputed only
  // while placing and only when the farm, its infrastructure or the landmarks change.
  const slotDots = useMemo(() => {
    if (!placing) return '';
    const taken = new Set(list.filter((lm) => lm.id !== movingId).map((lm) => slotKey(lm.position)));
    const r = 3;
    let d = '';
    for (let x = 1; x <= 2 * cols - 1; x++) {
      for (let y = 1; y <= 2 * rows - 1; y++) {
        if (isTreeCenter({ x, y }) || taken.has(slotKey({ x, y }))) continue;
        if (slotBlockedReason({ x, y }, { rows, cols, grid: kindGrid, landmarks: {} })) continue;
        const p = slotToPixel(mirrorSlot({ x, y }, rows, cols, orientation));
        d += `M${p.x - r} ${p.y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
      }
    }
    return d;
  }, [placing, list, movingId, rows, cols, kindGrid, orientation]);
  const { width, height } = getOverlaySize(rows, cols);

  if (list.length === 0 && !placing) return null;

  return (
    <div
      className="farm-landmark-layer"
      style={{ left: origin.left, top: origin.top, width, height }}
      data-landmark-layer="true"
    >
      {placing && (
        <svg className="farm-slot-dots" width={width} height={height} aria-hidden="true" focusable="false" style={{ position: 'absolute', left: 0, top: 0 }}>
          <path d={slotDots} fill="#047857" opacity="0.65" />
        </svg>
      )}

      {placed.map(({ lm, x, y }) => (
        <Badge
          key={lm.id}
          landmark={lm}
          left={x}
          top={y}
          selected={selectedId === lm.id}
          conflict={conflictIds.has(lm.id)}
        />
      ))}
    </div>
  );
});
