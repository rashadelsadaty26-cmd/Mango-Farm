import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { FocusTarget } from '../farmSearch';

// ============================================================================
// Search result / "إنت هنا" presentation. Pure UI state: nothing here is stored,
// written to Firestore or kept after a reload.
//
//   * A screen-space SVG over the map: a dimming layer with a hole around the
//     target (fades out over ~3 s), and a persistent outline around the target.
//   * HTML markers ("إنت هنا", row ends) positioned from the same projection.
//
// The projection is   screen = (gridOffset + gridPoint) * scale + pan
// - the same one the DOM map and the realistic canvas use - so it works in
// Standard and Realistic mode alike, follows pan / zoom frame by frame (App.tsx
// calls `listenerRef.current()` from the transform write), respects mirroring (the
// target is already in DISPLAY grid space) and costs nothing while no target exists.
// ============================================================================

export const DIM_FADE_MS = 3000;

export interface FocusOverlayProps {
  target: FocusTarget | null;
  /** Changes on every selection so the dim fade restarts even for the same target. */
  epoch: number;
  containerRef: React.RefObject<HTMLDivElement>;
  getView: () => { scale: number; x: number; y: number };
  /** Content-space position of grid-space (0,0) (top-left of displayed cell (0,0)). */
  getGridOffset: () => { x: number; y: number } | null;
  /** App.tsx calls this after every pan / zoom transform write. */
  listenerRef: React.MutableRefObject<(() => void) | null>;
  onClear: () => void;
}

const PAD = 6;

export function FocusOverlay({ target, epoch, containerRef, getView, getGridOffset, listenerRef, onClear }: FocusOverlayProps) {
  const dimRef = useRef<SVGPathElement>(null);
  const shapeRefs = useRef<Array<SVGElement | null>>([]);
  const markerRef = useRef<HTMLDivElement>(null);
  const endRefs = useRef<Array<HTMLDivElement | null>>([]);
  const dimDoneRef = useRef(false);
  const targetRef = useRef(target);
  targetRef.current = target;
  const sizeRef = useRef({ w: 0, h: 0 });

  const update = useCallback(() => {
    const t = targetRef.current;
    const container = containerRef.current;
    if (!t || !container) return;
    const off = getGridOffset();
    if (!off) return;
    const v = getView();
    const sx = (gx: number) => (off.x + gx) * v.scale + v.x;
    const sy = (gy: number) => (off.y + gy) * v.scale + v.y;
    const { w: W, h: H } = sizeRef.current;

    let hole = '';
    t.shapes.forEach((s, i) => {
      const x = sx(s.x) - PAD; const y = sy(s.y) - PAD;
      const w = s.w * v.scale + PAD * 2; const h = s.h * v.scale + PAD * 2;
      const el = shapeRefs.current[i * 2]; const halo = shapeRefs.current[i * 2 + 1];
      for (const node of [el, halo]) {
        if (!node) continue;
        if (s.shape === 'ellipse') {
          node.setAttribute('cx', String(x + w / 2)); node.setAttribute('cy', String(y + h / 2));
          node.setAttribute('rx', String(w / 2)); node.setAttribute('ry', String(h / 2));
        } else {
          node.setAttribute('x', String(x)); node.setAttribute('y', String(y));
          node.setAttribute('width', String(w)); node.setAttribute('height', String(h));
          node.setAttribute('rx', String(Math.min(14, h / 2)));
        }
      }
      if (s.shape === 'ellipse') {
        const rx = w / 2; const ry = h / 2; const cx = x + rx; const cy = y + ry;
        hole += `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
      } else {
        hole += `M${x} ${y}h${w}v${h}h${-w}Z`;
      }
    });
    if (dimRef.current && !dimDoneRef.current) dimRef.current.setAttribute('d', `M0 0H${W}V${H}H0Z${hole}`);

    if (t.marker && markerRef.current) {
      markerRef.current.style.transform = `translate3d(${sx(t.marker.x)}px, ${sy(t.marker.y)}px, 0)`;
    }
    t.ends?.forEach((e, i) => {
      const node = endRefs.current[i];
      if (node) node.style.transform = `translate3d(${sx(e.x)}px, ${sy(e.y)}px, 0)`;
    });
  }, [containerRef, getGridOffset, getView]);

  // Track the container size (cheap; replaces a layout read on every frame).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const measure = () => { sizeRef.current = { w: container.clientWidth, h: container.clientHeight }; update(); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, [containerRef, update]);

  // Subscribe to pan / zoom only while a target exists.
  useEffect(() => {
    if (!target) return undefined;
    listenerRef.current = update;
    return () => { if (listenerRef.current === update) listenerRef.current = null; };
  }, [target, update, listenerRef]);

  // Restart the fade for each new selection.
  useLayoutEffect(() => {
    dimDoneRef.current = false;
    if (dimRef.current) dimRef.current.style.display = '';
    update();
  }, [target, epoch, update]);

  // Escape clears the selection.
  useEffect(() => {
    if (!target) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClear(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, onClear]);

  if (!target) return null;
  shapeRefs.current.length = target.shapes.length * 2;

  return (
    <div className="farm-focus" data-testid="focus-overlay" data-focus-kind={target.kind} data-focus-id={target.id}>
      <svg className="farm-focus-svg" width="100%" height="100%" aria-hidden="true" focusable="false">
        <path
          key={`dim-${epoch}`}
          ref={dimRef}
          className="farm-focus-dim"
          data-testid="focus-dim"
          fillRule="evenodd"
          style={{ animationDuration: `${DIM_FADE_MS}ms` }}
          onAnimationEnd={() => { dimDoneRef.current = true; if (dimRef.current) dimRef.current.style.display = 'none'; }}
        />
        {target.shapes.map((s, i) => {
          const Tag = s.shape === 'ellipse' ? 'ellipse' : 'rect';
          return (
            <React.Fragment key={`${target.id}-${i}`}>
              <Tag ref={(n: SVGElement | null) => { shapeRefs.current[i * 2 + 1] = n; }} className="farm-focus-halo" />
              <Tag ref={(n: SVGElement | null) => { shapeRefs.current[i * 2] = n; }} className="farm-focus-outline" data-testid="focus-outline" />
            </React.Fragment>
          );
        })}
      </svg>

      {target.ends?.map((e, i) => (
        <div key={`${target.id}-end-${i}`} ref={(n) => { endRefs.current[i] = n; }} className="farm-focus-pos">
          <span className="farm-focus-end">{e.label}</span>
        </div>
      ))}

      {target.marker && (
        <div ref={markerRef} className="farm-focus-pos" data-testid="focus-marker">
          <div className="farm-focus-pin" data-approx={target.marker.approximate ? 'true' : undefined}>
            <span className="farm-focus-pin-label">{target.marker.label}</span>
            <span className="farm-focus-pin-dot" aria-hidden="true" />
          </div>
        </div>
      )}

      <div className="farm-focus-chip" role="status" aria-live="polite" data-testid="focus-chip">
        <div className="farm-focus-chip-text">
          <strong>{target.title}</strong>
          {target.subtitle && <span>{target.subtitle}</span>}
          {target.note && <span className="farm-focus-note">{target.note}</span>}
        </div>
        <button type="button" className="farm-focus-clear" onClick={onClear} aria-label="مسح التحديد والعودة للشكل العادي" title="مسح التحديد" data-testid="focus-clear">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
