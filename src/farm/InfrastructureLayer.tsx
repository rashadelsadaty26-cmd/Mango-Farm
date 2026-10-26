import React, { useMemo } from 'react';
import {
  GRID, getInfrastructureScale, buildGapPath, buildInfraPaths, getOverlaySize,
  type InfraKind, type InfraPaths, type KindGrid,
} from './infrastructure';

// ============================================================================
// One absolutely-positioned SVG that sits under the trees and over the land.
// Each kind is a few concentric strokes of ONE shared network path, so bends,
// T-junctions and crossings are seamless by construction. The grid cells above
// it are untouched and still receive every tap / selection / edit.
//
// Cost: ~6-8 <path> elements per kind present, regardless of map size.
// Textures are SVG <pattern> paints (rasterised once, tiled), never per-cell nodes.
// ============================================================================

interface Layer {
  /** Stroke width in design units; multiplied by INFRA_SCALE when drawn. */
  w: number;
  color: string;
  opacity?: number;
  /** Optional texture/ripple layer. Hidden when zoomed out. */
  detail?: boolean;
  dash?: string;
  className?: string;
  /** Drawn on the inset geometry (ends a little short of a dead end = closed headwall). */
  inner?: boolean;
}

// ---- Irrigation canal: natural water in a soft, wet bank ----------------------
const WATER_LAYERS: Layer[] = [
  { w: 44, color: '#b9c6a4', opacity: 0.5 },   // bank fading into the land
  { w: 37, color: '#8da384', opacity: 0.92 },  // wet bank
  { w: 31, color: '#6cb8d2' },                 // shallows
  { w: 24, color: '#4fa3c6' },                 // body
  { w: 13, color: '#3b8fb7', opacity: 0.8 },   // deeper centre
  { w: 24, color: 'url(#farm-pat-water)', detail: true },
  // Faint cross-channel ripple lines with irregular spacing. Each pattern starts
  // with a zero-length dash so no ripple sits on a junction. Dash periods are
  // 138.8 and 101.8; the CSS keyframes drift by exactly one period (seamless loop).
  { w: 20, color: '#ffffff', opacity: 0.17, detail: true, dash: '0 18 1.4 38 2.2 27 1.2 51', className: 'farm-water-flow' },
  { w: 11, color: '#ffffff', opacity: 0.15, detail: true, dash: '0 22 1.2 46 1.6 31', className: 'farm-water-flow farm-water-flow--slow' },
];
// Rounded dead ends: cap radius is resolved against the active runtime spacing.

// ---- Road: compacted earth, crowned centre, worn tracks -----------------------
const ROAD_LAYERS: Layer[] = [
  { w: 59, color: '#d9ccb0', opacity: 0.45 },  // soft shoulder
  { w: 55, color: '#bfae8c' },                 // defined edge
  { w: 51, color: '#cdbf9f' },                 // bed
  { w: 32, color: '#bba988', opacity: 0.32 },  // wheel-worn tracks
  { w: 15, color: '#d8ccb0', opacity: 0.55 },  // crowned centre
  { w: 51, color: 'url(#farm-pat-road)', detail: true },
];

// ---- Drainage: narrow concrete-lined trench -------------------------------------
// Deliberately different from the other two networks: roads are wide and warm
// beige, canals are bright blue with ripples, a drain is a NARROW, COOL-GREY
// lined ditch with a dark floor and a thin damp strip. Outer layers run to the cell edge; "inner" layers stop a
// wall's thickness short of every dead end, which closes the end with a
// concrete headwall instead of an open, ragged cut.
const DRAIN_WALL = 4; // design units: thickness of the headwall at a dead end
const DRAIN_LAYERS: Layer[] = [
  { w: 47, color: '#aab4a6', opacity: 0.34 },            // soil verge fading into the land
  { w: 39, color: '#d3d6cf' },                           // concrete lining (light)
  { w: 36, color: '#8f9791' },                           // lining edge line
  { w: 33, color: '#d3d6cf', inner: true },              // inner rim
  { w: 29, color: '#4b5a57', inner: true },              // trench wall shadow
  { w: 23, color: '#667874', inner: true },              // trench floor
  { w: 11, color: '#86a6a2', opacity: 0.8, inner: true }, // damp strip along the floor
  // No cross-joint dashes: a fixed dash pattern cannot avoid junction mouths on
  // chains of arbitrary length, and stray ticks across a junction look broken.
];

const GAP_COLOR = '#e0dac4';

function Bands({
  paths, innerPaths, layers, roundCaps,
}: { paths: InfraPaths; innerPaths?: InfraPaths; layers: Layer[]; roundCaps: boolean }) {
  return (
    <>
      {layers.map((layer, i) => {
        const p = layer.inner && innerPaths ? innerPaths : paths;
        return (
        <g
          key={i}
          className={layer.detail ? 'farm-infra-detail' : undefined}
          stroke={layer.color}
          strokeWidth={layer.w * getInfrastructureScale()}
          strokeLinejoin="round"
          // Dashed ripple layers must stay butt-capped or the dashes turn into dots.
          strokeLinecap={roundCaps && !layer.dash ? 'round' : 'butt'}
          opacity={layer.opacity}
        >
          {p.chains && (
            <path d={p.chains} fill="none" strokeDasharray={layer.dash} className={layer.className} />
          )}
          {/* 2x2+ blocks become a filled body (no ripples/dashes on those). */}
          {p.blocks && !layer.dash && <path d={p.blocks} fill={layer.color} />}
        </g>
        );
      })}
    </>
  );
}

export const InfrastructureLayer = React.memo(function InfrastructureLayer({
  grid, origin, gridGap,
}: { grid: KindGrid; /** Where cell (0,0) is drawn (orientation dependent, see getGridOrigin). */ origin: { left: number; top: number }; gridGap: number }) {
  // Geometry depends on both the saved network and the current visual cell pitch.
  // A spacing change deliberately rebuilds only these compact SVG paths.
  const scale = getInfrastructureScale();
  const geometry = useMemo(() => {
    const out: Partial<Record<InfraKind, InfraPaths>> & { gap?: InfraPaths; drainageInner?: InfraPaths } = {};
    out.gap = { chains: '', blocks: buildGapPath(grid) };
    out.drainage = buildInfraPaths(grid, 'drainage', 0);
    out.drainageInner = buildInfraPaths(grid, 'drainage', DRAIN_WALL * scale);
    out.road = buildInfraPaths(grid, 'road', 0);
    out.water = buildInfraPaths(grid, 'water', (WATER_LAYERS[0].w * scale) / 2);
    return out;
  }, [grid.signature, gridGap, grid, scale]);

  if (!grid.hasAny) return null;

  const { width, height } = getOverlaySize(grid.rows, grid.cols);
  const has = (p?: InfraPaths) => !!p && (p.chains !== '' || p.blocks !== '');

  return (
    <svg
      className="farm-infra-layer"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{
        position: 'absolute',
        left: origin.left,
        top: origin.top,
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: 0,
      }}
      shapeRendering="geometricPrecision"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* Tiny tiles, rasterised once and repeated: subtle texture without per-cell DOM. */}
        <pattern id="farm-pat-road" width="26" height="26" patternUnits="userSpaceOnUse">
          <circle cx="4" cy="5" r="0.9" fill="#a39373" opacity="0.35" />
          <circle cx="15" cy="9" r="0.7" fill="#eee5cc" opacity="0.6" />
          <circle cx="21" cy="19" r="1" fill="#a39373" opacity="0.3" />
          <circle cx="9" cy="21" r="0.8" fill="#eee5cc" opacity="0.55" />
          <circle cx="23" cy="3" r="0.6" fill="#b3a483" opacity="0.4" />
          <circle cx="12" cy="15" r="0.6" fill="#a39373" opacity="0.3" />
        </pattern>
        <pattern id="farm-pat-drain" width="22" height="22" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="4" r="0.8" fill="#5f7268" opacity="0.28" />
          <circle cx="13" cy="8" r="0.7" fill="#d4dccf" opacity="0.5" />
          <circle cx="18" cy="17" r="0.9" fill="#5f7268" opacity="0.25" />
          <circle cx="7" cy="18" r="0.7" fill="#d4dccf" opacity="0.45" />
        </pattern>
        <pattern id="farm-pat-water" width="46" height="46" patternUnits="userSpaceOnUse">
          <path d="M4 12q6-3 12 0" stroke="#ffffff" strokeOpacity="0.2" strokeWidth="1.1" strokeLinecap="round" fill="none" />
          <path d="M26 30q6-3 12 0" stroke="#ffffff" strokeOpacity="0.17" strokeWidth="1.1" strokeLinecap="round" fill="none" />
          <path d="M14 40q4-2 8 0" stroke="#ffffff" strokeOpacity="0.12" strokeWidth="1" strokeLinecap="round" fill="none" />
          <circle cx="34" cy="9" r="1.4" fill="#2f7ea6" opacity="0.18" />
          <circle cx="9" cy="28" r="1.2" fill="#2f7ea6" opacity="0.15" />
        </pattern>
      </defs>

      {geometry.gap && geometry.gap.blocks !== '' && (
        <path d={geometry.gap.blocks} fill={GAP_COLOR} opacity="0.85" />
      )}
      {has(geometry.drainage) && (
        <Bands paths={geometry.drainage!} innerPaths={geometry.drainageInner} layers={DRAIN_LAYERS} roundCaps={false} />
      )}
      {has(geometry.road) && <Bands paths={geometry.road!} layers={ROAD_LAYERS} roundCaps={false} />}
      {has(geometry.water) && <Bands paths={geometry.water!} layers={WATER_LAYERS} roundCaps />}
    </svg>
  );
});

// Re-export so App only needs one import for sizing math.
export { GRID };
