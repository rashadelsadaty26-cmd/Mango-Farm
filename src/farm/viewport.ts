// ============================================================================
// Viewport math for the pan/zoom surface (pure, no DOM).
//
// There is ONE viewport system: a `transform: translate(x, y) scale(s)` applied
// to the content element. This module holds the two calculations App.tsx needs:
//
//   clampView      keeps the content inside / centred in the viewport
//   computeFitView the "reset view" target: scale + position that shows the
//                  whole land, centred, from the land's ACTUAL rendered bounds
//
// computeFitView never assumes where the farm's top-left corner is. It is given
// the measured rectangle of the land inside the content (which is what the
// browser really laid out for the current mirror orientation), so it is correct
// for every orientation, label placement and grid size.
// ============================================================================

export interface ViewMetrics {
  viewportW: number;
  viewportH: number;
  /** Unscaled size of the transformed content element (including its padding). */
  contentW: number;
  contentH: number;
}

export interface ViewState {
  scale: number;
  x: number;
  y: number;
}

/** Rectangle of the land inside the content element, in unscaled content pixels. */
export interface LandBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Same rule the map has always used: content smaller than the viewport is
 * centred; larger content may be panned until its edge meets the viewport edge.
 */
export function clampView(x: number, y: number, scale: number, m: ViewMetrics): { x: number; y: number } {
  const { viewportW, viewportH, contentW, contentH } = m;
  if (!viewportW || !viewportH || !contentW || !contentH) return { x, y };
  const scaledW = contentW * scale;
  const scaledH = contentH * scale;
  return {
    x: scaledW <= viewportW ? (viewportW - scaledW) / 2 : Math.min(0, Math.max(viewportW - scaledW, x)),
    y: scaledH <= viewportH ? (viewportH - scaledH) / 2 : Math.min(0, Math.max(viewportH - scaledH, y)),
  };
}

export interface FitOptions {
  minScale: number;
  maxScale: number;
  /** Empty space kept around the land, in screen pixels. */
  margin?: number;
  /** Reset never enlarges a farm beyond this (default 1 = natural size). */
  maxFitScale?: number;
}

/**
 * Scale + position that shows the whole land, centred, inside the viewport.
 *
 *  - The scale is the largest one at which the land fits, limited to the map's
 *    existing zoom limits (and to `maxFitScale`).
 *  - On an axis where the land fits, it is centred using its measured bounds.
 *  - On an axis where it cannot fit (a phone-sized viewport can need a scale
 *    below the minimum zoom), the land's leading edge as DISPLAYED is aligned to
 *    the viewport edge, so the view starts at the displayed top-left, whichever
 *    corner of the original farm that is.
 */
export function computeFitView(m: ViewMetrics, land: LandBounds, opts: FitOptions): ViewState {
  const margin = opts.margin ?? 16;
  const { viewportW, viewportH } = m;
  if (!viewportW || !viewportH || !land.width || !land.height) return { scale: 1, x: 0, y: 0 };

  const availW = Math.max(1, viewportW - margin * 2);
  const availH = Math.max(1, viewportH - margin * 2);
  const wanted = Math.min(availW / land.width, availH / land.height, opts.maxFitScale ?? 1);
  const scale = Math.min(Math.max(opts.minScale, wanted), opts.maxScale);

  const place = (viewport: number, start: number, size: number) => {
    const scaled = size * scale;
    return scaled <= viewport - margin * 2
      ? (viewport - scaled) / 2 - start * scale // centred
      : margin - start * scale; //                  leading edge at the margin
  };

  const pos = clampView(place(viewportW, land.left, land.width), place(viewportH, land.top, land.height), scale, m);
  return { scale, x: pos.x, y: pos.y };
}
