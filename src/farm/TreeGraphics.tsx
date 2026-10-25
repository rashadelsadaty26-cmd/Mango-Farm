import React from 'react';
import type { TreeTone } from './treeVisuals';

// ============================================================================
// The tree artwork is defined ONCE (below) and every tree on the map is a
// single <svg><use/></svg>. Per-tree appearance is driven by CSS custom
// properties (see index.css, ".ft-*"), which cross the <use> boundary:
//
//   tone class    -> canopy colours, red disease patch / dot
//   --ft-accent   -> small variety-coloured fruit cluster
//   --ft-detail-display (set on .farm-map-low-zoom) -> hides shading when zoomed out
//
// This keeps the per-tree DOM cost to two nodes instead of one node per path.
// ============================================================================

export const TREE_SYMBOL_ID = 'farm-mango-tree';

// The artwork is drawn in a 100x100 space but only occupies x 26..97, y 13..84.
// Cropping the view to that area (the symbol itself is untouched) lets the canopy
// fill its cell, so trees are drawn about 40% larger without changing the cell.
const TREE_VIEWBOX = '20 8 84 80';

// The original organic silhouette and trunk are unchanged.
const CANOPY_PATH =
  'M48 84 C48 76 46 69 44 63 C37 63 31 59 29 53 C26 47 30 41 36 39 C34 32 39 25 46 24 C48 17 55 13 62 17 C69 13 78 17 80 24 C87 25 92 31 91 38 C97 43 96 51 91 56 C87 61 81 63 74 61 C72 69 67 76 66 84 Z';
const SHADE_PATH =
  'M38 42 C42 31 51 27 60 28 C68 28 75 32 78 38 C68 34 59 36 52 42 C47 46 43 50 38 50 C35 48 35 45 38 42 Z';
const LIGHT_PATH = 'M62 22 C68 19 74 21 77 26 C70 25 66 27 61 30 C59 27 59 24 62 22 Z';
const TRUNK_PATH =
  'M47 84 C50 72 51 64 53 55 C55 52 60 52 63 55 C60 65 59 74 61 84 Z';

// Disease patch used when a tree is BOTH diseased and needs pruning. It sits
// inside the canopy silhouette and covers roughly a third of it, so the orange
// pruning colour stays dominant.
const PATCH_PATH =
  'M63 35 C68 28 80 28 86 34 C92 40 90 49 83 53 C76 57 66 55 62 48 C59 43 60 38 63 35 Z';

// Variety accent: a small cluster of three fruit, drawn as one path.
const ACCENT_PATH =
  'M34.2 45a5.8 5.8 0 1 0 11.6 0a5.8 5.8 0 1 0 -11.6 0Z' +
  'M45.2 49.5a5.8 5.8 0 1 0 11.6 0a5.8 5.8 0 1 0 -11.6 0Z' +
  'M35.7 54.5a5.8 5.8 0 1 0 11.6 0a5.8 5.8 0 1 0 -11.6 0Z';

/** Render once, anywhere inside the map. Zero-size, not display:none (keeps <use> reliable). */
export const TreeSymbols = React.memo(function TreeSymbols() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <g id={TREE_SYMBOL_ID}>
          <path className="ft-canopy" d={CANOPY_PATH} />
          <path className="ft-detail ft-shade" d={SHADE_PATH} />
          <path className="ft-detail ft-light" d={LIGHT_PATH} />
          <path className="ft-patch" d={PATCH_PATH} />
          <path className="ft-trunk" d={TRUNK_PATH} />
          <circle className="ft-dot" cx="78" cy="39" r="4.2" />
          <path className="ft-accent" d={ACCENT_PATH} />
        </g>
      </defs>
    </svg>
  );
});

export const MangoTree = React.memo(function MangoTree({
  tone,
  accent,
}: {
  tone: TreeTone;
  accent: string | null;
}) {
  return (
    <svg
      className={`farm-natural-tree ft-${tone}${accent ? ' ft-has-accent' : ''}`}
      style={accent ? ({ '--ft-accent': accent } as React.CSSProperties) : undefined}
      viewBox={TREE_VIEWBOX}
      role="img"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid meet"
    >
      <use href={`#${TREE_SYMBOL_ID}`} />
    </svg>
  );
});
