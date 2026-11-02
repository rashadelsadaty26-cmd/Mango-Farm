import React from 'react';
import { GRID } from '../infrastructure';
import { landBoxSize } from '../gridEdit';

// ============================================================================
// Boundary fence around the farm grid.
//
// It lives INSIDE the land element, so it is part of the map's content space: it
// pans and zooms with the transform, is identical in Standard and Realistic modes
// (the realistic canvas draws the ground behind it), and follows the grid by
// construction - its size is the land box computed from the same constants the CSS
// grid uses (landBoxSize), so adding / removing rows or columns resizes it, and
// mirroring (which only moves the label strips INSIDE the land box) cannot move it.
//
// The fence sits in the land's own padding (the cells start `GRID.pad` px from the
// edge), so it never covers a tree, label, road or canal.
//
// It is ONE <svg> of ~12 stroked paths (no filters, no blur): rails are drawn with
// a shadow, a lower and an upper rail and a highlight; posts are a dashed stroke
// with square caps, so the post spacing costs no extra DOM nodes.
// ============================================================================

const INSET = 9;
const POST_EVERY = 56;

export const FENCE_INSET = INSET;

export const FarmFence = React.memo(function FarmFence({ rows, cols }: { rows: number; cols: number }) {
  const { width, height } = landBoxSize(rows, cols, GRID);
  const w = width - INSET * 2;
  const h = height - INSET * 2;
  const rect = (dx = 0, dy = 0) => `M${INSET + dx} ${INSET + dy}h${w}v${h}h${-w}z`;
  const corners: Array<[number, number]> = [[INSET, INSET], [INSET + w, INSET], [INSET + w, INSET + h], [INSET, INSET + h]];

  return (
    <svg
      className="farm-fence"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
      data-fence-width={width}
      data-fence-height={height}
    >
      {/* cast shadow + trampled earth along the line */}
      <path d={rect(5, 6)} fill="none" stroke="rgba(32,22,8,0.30)" strokeWidth="8" strokeLinejoin="round" />
      <path d={rect()} fill="none" stroke="rgba(92,70,42,0.34)" strokeWidth="14" strokeLinejoin="round" />
      {/* lower rail (a little toward the farm: it is lower, so the top-down view shifts it) */}
      <path d={rect(1.6, 1.8)} fill="none" stroke="#5e4529" strokeWidth="3.6" strokeLinejoin="round" />
      {/* wire mesh between the rails */}
      <path className="farm-fence-detail" d={rect(0.8, 0.9)} fill="none" stroke="rgba(236,228,206,0.42)" strokeWidth="5" strokeDasharray="1.6 4.4" />
      {/* upper rail + light edge */}
      <path d={rect()} fill="none" stroke="#9c7445" strokeWidth="3.4" strokeLinejoin="round" />
      <path className="farm-fence-detail" d={rect(-0.9, -0.9)} fill="none" stroke="#dcbb85" strokeWidth="1.1" strokeLinejoin="round" />
      {/* posts: side, top cap, highlight */}
      <path d={rect(1.2, 1.5)} fill="none" stroke="#4a361f" strokeWidth="8.5" strokeLinecap="square" strokeDasharray={`0.01 ${POST_EVERY}`} />
      <path d={rect()} fill="none" stroke="#b58850" strokeWidth="6.5" strokeLinecap="square" strokeDasharray={`0.01 ${POST_EVERY}`} />
      <path className="farm-fence-detail" d={rect(-1, -1)} fill="none" stroke="#ecd3a2" strokeWidth="2.4" strokeLinecap="square" strokeDasharray={`0.01 ${POST_EVERY}`} />
      {/* heavier corner posts */}
      {corners.map(([x, y], i) => (
        <g key={i}>
          <rect x={x - 6.5 + 1.6} y={y - 6.5 + 1.9} width="13" height="13" rx="1.6" fill="#3f2d19" />
          <rect x={x - 6.5} y={y - 6.5} width="13" height="13" rx="1.6" fill="#a97b47" stroke="#5a4226" strokeWidth="1" />
          <rect className="farm-fence-detail" x={x - 4.2} y={y - 4.2} width="6" height="6" rx="1" fill="#dcbb85" opacity="0.7" />
        </g>
      ))}
    </svg>
  );
});
