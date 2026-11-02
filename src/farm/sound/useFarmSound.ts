import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { createBrowserSoundEngine, type FarmSoundEngine, type SoundSnapshot } from './farmSound';

export interface FarmSoundApi extends SoundSnapshot {
  toggle: () => void;
  setVolume: (v: number) => void;
  checkAvailability: () => void;
}

// One engine per account (the remembered volume is scoped by it). Creating the engine
// allocates no audio resources: the AudioContext / fetch / decode all wait for enable().
export function useFarmSound(scopeId: string | null, realisticActive: boolean): FarmSoundApi {
  const ref = useRef<{ scope: string | null; engine: FarmSoundEngine } | null>(null);
  if (!ref.current || ref.current.scope !== scopeId) {
    ref.current?.engine.dispose();
    ref.current = { scope: scopeId, engine: createBrowserSoundEngine(scopeId) };
  }
  const engine = ref.current.engine;
  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);

  useEffect(() => { engine.setSceneActive(realisticActive); }, [engine, realisticActive]);

  useEffect(() => {
    const onVis = () => engine.setPageVisible(document.visibilityState !== 'hidden');
    onVis();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [engine]);

  // Stop playing when the app unmounts (not `dispose`: React StrictMode runs effect cleanups once
  // during development and the engine must stay usable afterwards).
  useEffect(() => () => { engine.disable(); }, [engine]);

  const toggle = useCallback(() => engine.toggle(), [engine]);
  const setVolume = useCallback((v: number) => engine.setVolume(v), [engine]);
  const checkAvailability = useCallback(() => { void engine.checkAvailability(); }, [engine]);
  return { ...snap, toggle, setVolume, checkAvailability };
}
