// ============================================================================
// Scene model for Realistic mode: a PURE, read-only projection of the farm data.
//
//   farm records  --buildScene()-->  typed arrays indexed by DISPLAY cell
//
// It never writes anything and owns no graphics. The farm records stay the single
// source of truth; the scene is rebuilt (cheaply, ~1 ms for 1,800 cells) whenever
// they change. Positions come from the SAME constants and the SAME orientation
// mapping the standard map uses (GRID / displayCell / mirrorSlot / slotToPixel), so
// a tree, a canal or a landmark is drawn exactly where the standard renderer puts it.
//
// Everything is in "grid space": pixels relative to the top-left of display cell
// (0,0), i.e. the same origin the infrastructure SVG and the landmark layer use.
//
// Dependency-free (no React / canvas) so it can be tested in plain Node.
// ============================================================================

import { GRID, kindAt, type KindGrid } from '../infrastructure.ts';
import { displayCell, mirrorSlot, type MapOrientation } from '../orientation.ts';
import { PITCH_X, PITCH_Y, slotToPixel, stackOffsets, type LandmarkMap } from '../landmarks.ts';
import {
  getTreeHealthFlags, getVarietyAccent,
  type RetiredKind, type TreeDataLike,
} from '../treeVisuals.ts';
import { hashString } from './textures.ts';

export const CELL_NONE = 0;   // infrastructure / blank gap / nothing drawn as a tree
export const CELL_TREE = 1;   // a tree whose data has been entered
export const CELL_EMPTY = 2;  // a tree cell with no saved data yet
export const CELL_BASIN = 3;  // spray basin
export type CellClass = 0 | 1 | 2 | 3;

export const FLAG_DISEASED = 1;
export const FLAG_WEAK = 2;     // stored status "needs pruning" (shown as "ضعيفة")
export const FLAG_GRAFTED = 4;
export const FLAG_UPROOTED = 8;

export interface CellRecord extends TreeDataLike { type?: string }

/**
 * What a cell is, by exactly the rule MapCell uses to pick what to draw, so the two
 * renderers can never disagree about which cells hold a tree.
 */
export function classifyCell(data: CellRecord | undefined, gapKind: string | null): CellClass {
  const type = data?.type || 'tree';
  if (type === 'spray_tank') return CELL_BASIN;
  if (type === 'water_canal' || type === 'drainage' || type === 'road' || (!data?.type && gapKind)) return CELL_NONE;
  if (!data?.lastUpdated) return CELL_EMPTY;
  return CELL_TREE;
}

export type LandmarkShape =
  | 'tap' | 'basin' | 'tank' | 'pole' | 'electric' | 'building' | 'gate' | 'tools' | 'fuel' | 'flag' | 'plant' | 'marker';

const ICON_SHAPES: Array<[string[], LandmarkShape]> = [
  [['🚰', '🚿'], 'tap'],
  [['💧'], 'basin'],
  [['🛢️', '🛢'], 'tank'],
  [['💡'], 'pole'],
  [['🔌', '⚡'], 'electric'],
  [['🏠'], 'building'],
  [['🚪'], 'gate'],
  [['🔧', '🧰'], 'tools'],
  [['⛽'], 'fuel'],
  [['🚩'], 'flag'],
  [['🌿'], 'plant'],
];

/** Overhead shape for a landmark: by its preset type id, else by its icon, else a survey marker. */
export function landmarkShape(lm: { typeId?: string; icon: string }): LandmarkShape {
  switch (lm.typeId) {
    case 'preset_tap': return 'tap';
    case 'preset_basin': return 'basin';
    case 'preset_light_pole': return 'pole';
    case 'preset_utility': return 'marker';
    default: break;
  }
  for (const [icons, shape] of ICON_SHAPES) if (icons.includes(lm.icon)) return shape;
  return 'marker';
}

export interface SceneLandmark {
  id: string;
  name: string;
  shape: LandmarkShape;
  /** Grid-space centre. */
  x: number;
  y: number;
}

export interface FarmScene {
  rows: number;
  cols: number;
  /** Per DISPLAY cell (index = displayRow * cols + displayCol). */
  cls: Uint8Array;
  flags: Uint8Array;
  /** Packed 0xRRGGBB variety accent, or 0xFFFFFFFF for none. */
  accent: Uint32Array;
  /** Stable per-tree hash of its storage id: picks sprite variant / tiny rotation. Independent of orientation. */
  seed: Uint32Array;
  /** Storage id of the tree drawn in each display cell (for tests and debugging). */
  ids: string[];
  /** Infrastructure in DISPLAY layout (same object InfrastructureLayer receives). */
  infra: KindGrid;
  landmarks: SceneLandmark[];
  /** Grid-space size of the cell area. */
  width: number;
  height: number;
}

export interface SceneInput {
  rows: number;
  cols: number;
  rowLabels: string[];
  cells: Record<string, CellRecord | undefined>;
  orientation: MapOrientation;
  /** Mirrored kind grid (what the standard infrastructure layer draws). */
  displayKindGrid: KindGrid;
  /** Logical kind grid (used to read the gap kind of a cell). */
  kindGrid: KindGrid;
  rowGapKinds: Record<number, string>;
  colGapKinds: Record<number, string>;
  landmarks: LandmarkMap;
}

export const NO_ACCENT = 0xffffffff;

function packRgb(color: string | null): number {
  if (!color || color[0] !== '#' || color.length < 7) return NO_ACCENT;
  return parseInt(color.slice(1, 7), 16);
}

export function buildScene(input: SceneInput): FarmScene {
  const { rows, cols, rowLabels, cells, orientation } = input;
  const total = rows * cols;
  const cls = new Uint8Array(total);
  const flags = new Uint8Array(total);
  const accent = new Uint32Array(total).fill(NO_ACCENT);
  const seed = new Uint32Array(total);
  const ids: string[] = new Array(total);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = `${rowLabels[r]}-${c + 1}`;
      const d = displayCell(r, c, rows, cols, orientation);
      const i = d.row * cols + d.col;
      ids[i] = id;
      seed[i] = hashString(id);
      const data = cells[id];
      const gap = input.rowGapKinds[r] || input.colGapKinds[c] || null;
      const klass = classifyCell(data, gap);
      cls[i] = klass;
      if (klass === CELL_TREE && data) {
        const h = getTreeHealthFlags(data);
        let f = 0;
        if (h.diseased) f |= FLAG_DISEASED;
        if (h.needsPruning) f |= FLAG_WEAK;
        const retired: RetiredKind | null | undefined = h.retired;
        if (retired === 'grafted') f |= FLAG_GRAFTED;
        if (retired === 'uprooted') f |= FLAG_UPROOTED;
        flags[i] = f;
        accent[i] = packRgb(getVarietyAccent(data.variety));
      }
    }
  }

  const list = Object.values(input.landmarks);
  const offsets = stackOffsets(list);
  const landmarks: SceneLandmark[] = list.map((lm) => {
    const p = slotToPixel(mirrorSlot(lm.position, rows, cols, orientation));
    return { id: lm.id, name: lm.name, shape: landmarkShape(lm), x: p.x + (offsets[lm.id] ?? 0), y: p.y };
  });

  return {
    rows, cols, cls, flags, accent, seed, ids,
    infra: input.displayKindGrid,
    landmarks,
    width: cols * PITCH_X - GRID.gap,
    height: rows * PITCH_Y - GRID.gap,
  };
}

/** Grid-space centre of display cell (displayRow, displayCol). */
export function cellCenter(displayRow: number, displayCol: number): { x: number; y: number } {
  return { x: displayCol * PITCH_X + GRID.cellW / 2, y: displayRow * PITCH_Y + GRID.cellH / 2 };
}

/** Kind of infrastructure at a LOGICAL cell, re-exported for tests that compare with the standard map. */
export { kindAt };
