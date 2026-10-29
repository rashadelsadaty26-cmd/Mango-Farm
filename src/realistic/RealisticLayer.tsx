import React, { useCallback, useEffect, useRef } from 'react';
import type { KindGrid } from '../infrastructure';
import type { LandmarkMap } from '../landmarks';
import type { MapOrientation } from '../orientation';
import type { QualityName, RealisticDisplayOptions } from './quality';
import { REALISTIC_MESSAGES } from './useRealisticMode';
import { QUALITY_PROFILES, supportsCanvas2D } from './quality';
import type { RealisticRenderer, ViewState } from './renderer';

// ============================================================================
// Owns the realistic canvas and the lifecycle of everything expensive.
//
//  * The heavy modules (textures, renderer, scene) are imported with import()
//    here, i.e. only after the user confirmed - never at app start.
//  * Textures are generated in small steps with yields to the browser, so the
//    interface keeps responding while the loading indicator is shown.
//  * No timers or animation loop: the renderer redraws when the pan/zoom handler
//    in App.tsx calls viewListenerRef, or when the farm data / options change.
//  * Unmounting (switching back to Standard Mode) disposes the renderer: every
//    texture canvas is released, the view listener and observers are removed.
//
// The canvas has pointer-events: none. All taps still land on the real DOM cells
// and landmark badges, so selection and editing are exactly the existing ones.
// ============================================================================

export interface RealisticLayerProps {
  quality: QualityName;
  options: RealisticDisplayOptions;
  /** True once the realistic picture should be on screen (loading finished). */
  visible: boolean;
  rows: number;
  cols: number;
  rowLabels: string[];
  cells: Record<string, any>;
  orientation: MapOrientation;
  displayKindGrid: KindGrid;
  kindGrid: KindGrid;
  rowGapKinds: Record<number, string>;
  colGapKinds: Record<number, string>;
  landmarks: LandmarkMap;
  /** Where display cell (0,0) is drawn inside the land (orientation dependent). */
  gridOrigin: { left: number; top: number };
  containerRef: React.RefObject<HTMLDivElement>;
  landRef: React.RefObject<HTMLDivElement>;
  getView: () => ViewState;
  /** App.tsx calls this after every pan/zoom transform write. */
  viewListenerRef: React.MutableRefObject<(() => void) | null>;
  onProgress: (fraction: number) => void;
  onReady: () => void;
  onError: (message: string) => void;
  onSlow: () => void;
}

interface Modules {
  scene: typeof import('./scene');
}

export function RealisticLayer(props: RealisticLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<RealisticRenderer | null>(null);
  const modulesRef = useRef<Modules | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const { quality } = props;

  /** Reads where the DOM map put things (content space, before pan/zoom). */
  const measure = useCallback(() => {
    const r = rendererRef.current;
    const p = latest.current;
    const land = p.landRef.current;
    const container = p.containerRef.current;
    if (!r || !land || !container) return;
    r.setGeometry({
      landX: land.offsetLeft,
      landY: land.offsetTop,
      landW: land.offsetWidth,
      landH: land.offsetHeight,
      gridX: land.offsetLeft + land.clientLeft + p.gridOrigin.left,
      gridY: land.offsetTop + land.clientTop + p.gridOrigin.top,
    });
    r.resize(container.clientWidth, container.clientHeight, window.devicePixelRatio || 1);
  }, []);

  /** Pushes the current farm data, geometry and options into the renderer and draws. */
  const sync = useCallback(() => {
    const r = rendererRef.current;
    const mods = modulesRef.current;
    if (!r || !mods) return;
    const p = latest.current;
    r.setScene(mods.scene.buildScene({
      rows: p.rows, cols: p.cols, rowLabels: p.rowLabels, cells: p.cells, orientation: p.orientation,
      displayKindGrid: p.displayKindGrid, kindGrid: p.kindGrid, rowGapKinds: p.rowGapKinds,
      colGapKinds: p.colGapKinds, landmarks: p.landmarks,
    }));
    r.setOptions(p.options);
    measure();
    r.setVisible(p.visible);
  }, [measure]);

  // ---- Create the renderer (first time) or swap its textures (quality change). ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!supportsCanvas2D()) { latest.current.onError(REALISTIC_MESSAGES.unsupported); return; }
        latest.current.onProgress(0);
        const [textures, rendererMod, scene] = await Promise.all([import('./textures'), import('./renderer'), import('./scene')]);
        if (cancelled) return;
        const assets = await textures.buildAssets(QUALITY_PROFILES[quality], textures.defaultCanvasFactory, {
          onProgress: (f) => { if (!cancelled) latest.current.onProgress(f); },
          isCancelled: () => cancelled,
        });
        if (!assets) return; // cancelled mid-build: buildAssets already released what it made
        if (cancelled || !canvasRef.current) { assets.dispose(); return; }

        modulesRef.current = { scene };
        if (rendererRef.current) {
          rendererRef.current.swapAssets(assets);
        } else {
          rendererRef.current = new rendererMod.RealisticRenderer({
            canvas: canvasRef.current,
            assets,
            getView: () => latest.current.getView(),
            onSlow: () => latest.current.onSlow(),
            onFatal: () => latest.current.onError(REALISTIC_MESSAGES.failed),
          });
          // Pan / zoom: App.tsx calls this right after it writes the DOM transform, so the
          // canvas and the cells move in the same frame.
          latest.current.viewListenerRef.current = () => rendererRef.current?.draw();
          const ro = new ResizeObserver(() => { measure(); rendererRef.current?.draw(); });
          if (latest.current.containerRef.current) ro.observe(latest.current.containerRef.current);
          if (latest.current.landRef.current) ro.observe(latest.current.landRef.current);
          observerRef.current = ro;
        }
        sync();
        latest.current.onReady();
      } catch (error) {
        if (!cancelled) {
          console.error('Realistic mode failed to start:', error);
          latest.current.onError(REALISTIC_MESSAGES.failed);
        }
      }
    })();
    return () => { cancelled = true; };
    // `quality` is the only trigger: data changes go through the sync effect below.
  }, [quality, sync, measure]);

  // ---- Farm data / options / visibility changed. ----
  const { rows, cols, rowLabels, cells, orientation, displayKindGrid, kindGrid, rowGapKinds, colGapKinds, landmarks, gridOrigin, options, visible } = props;
  useEffect(() => {
    sync();
  }, [sync, rows, cols, rowLabels, cells, orientation, displayKindGrid, kindGrid, rowGapKinds, colGapKinds, landmarks, gridOrigin, options, visible]);

  // ---- Leaving Realistic mode: release everything. ----
  useEffect(() => {
    const viewListenerRef = props.viewListenerRef;
    return () => {
      viewListenerRef.current = null;
      observerRef.current?.disconnect();
      observerRef.current = null;
      rendererRef.current?.dispose();
      rendererRef.current = null;
      modulesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="farm-realistic-canvas"
      aria-hidden="true"
      style={{ display: props.visible ? 'block' : 'none' }}
    />
  );
}
