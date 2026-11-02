// ============================================================================
// Optional ambient farm sound (Realistic mode).
//
//  * The recording is the USER'S OWN file at  public/audio/farm-ambience.mp3
//    (served at <base>/audio/farm-ambience.mp3). Nothing is generated, downloaded
//    from elsewhere or substituted. A missing file is a normal, safe state.
//  * NOTHING is created, fetched or decoded until the user enables the sound
//    (a tap = the user gesture that browsers / iPhone Safari require). Then the
//    file is fetched once, decoded once and played through Web Audio:
//      - AudioBufferSourceNode with loop = true is sample-accurate, so the loop is
//        gapless and click-free (an <audio loop> element has an audible seam);
//      - a GainNode gives a working volume control on iPhone, where
//        HTMLMediaElement.volume is read-only;
//      - start / stop are short gain ramps, so toggling never clicks.
//    A very large file (> MAX_DECODE_BYTES) would be a memory risk once decoded to
//    PCM, so it streams through an <audio loop> element instead (volume then
//    follows the platform's limits).
//  * Exactly one source exists at a time. Playback is independent of the map: it
//    is not tied to rendering, zoom, pan or quality changes. It pauses when the
//    page is hidden or Realistic mode is not on screen, and resumes by itself.
//  * Only the VOLUME is remembered (localStorage, scoped per account). Nothing is
//    sent to Firestore. "Enabled" is never remembered: sound must always start
//    from an explicit tap.
//
// This module has no React and takes its browser dependencies as arguments so
// that it can be verified in plain Node (scripts/verify-sound.ts).
// ============================================================================

const BASE = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';

/** The one and only location of the recording (relative to /public). */
export const FARM_SOUND_PUBLIC_PATH = 'public/audio/farm-ambience.mp3';
export const FARM_SOUND_URL = `${BASE.endsWith('/') ? BASE : `${BASE}/`}audio/farm-ambience.mp3`;
export const FARM_SOUND_FORMATS = 'MP3 (الأفضل)، ويُفضَّل أن يكون مقطعاً متكرراً مدته من دقيقة إلى 3 دقائق وحجمه أقل من 8 ميجابايت';

export const MAX_DECODE_BYTES = 24 * 1024 * 1024;
export const DEFAULT_VOLUME = 0.5;
const FADE_IN_S = 0.8;
const FADE_OUT_S = 0.4;

export type SoundAvailability = 'unknown' | 'checking' | 'available' | 'missing' | 'unreachable';
export type SoundStatus = 'off' | 'loading' | 'playing' | 'waiting' | 'error';

export const SOUND_MESSAGES = {
  missing: 'ملف صوت المزرعة غير موجود بعد',
  unreachable: 'تعذر التحقق من ملف الصوت الآن (لا يوجد اتصال)',
  unsupported: 'تعذر تشغيل ملف الصوت: الصيغة غير مدعومة أو الملف تالف',
  noAudio: 'الصوت غير مدعوم في هذا المتصفح',
  loadFailed: 'تعذر تحميل ملف الصوت',
  waitingRealistic: 'الصوت مفعّل وسيعمل في الوضع الواقعي',
} as const;

export interface SoundSnapshot {
  /** The user turned the sound on (this session). */
  enabled: boolean;
  /** Realistic mode is what is on screen. */
  sceneActive: boolean;
  status: SoundStatus;
  availability: SoundAvailability;
  volume: number;
  error: string | null;
}

// ---- minimal structural types of what we use (so tests can fake them) ----

export interface GainLike { gain: { value: number; cancelScheduledValues(t: number): void; setValueAtTime(v: number, t: number): void; linearRampToValueAtTime(v: number, t: number): void }; connect(n: unknown): void; disconnect(): void }
export interface SourceLike { buffer: unknown; loop: boolean; onended: (() => void) | null; connect(n: unknown): void; disconnect(): void; start(when?: number): void; stop(when?: number): void }
export interface ContextLike {
  currentTime: number;
  state: string;
  destination: unknown;
  createGain(): GainLike;
  createBufferSource(): SourceLike;
  decodeAudioData(data: ArrayBuffer): Promise<unknown>;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
}
export interface ElementLike { src: string; loop: boolean; volume: number; preload: string; play(): Promise<void>; pause(): void; removeAttribute(n: string): void; load(): void; addEventListener(t: string, f: () => void): void }

export interface SoundDeps {
  url?: string;
  createContext?: () => ContextLike | null;
  createElement?: () => ElementLike | null;
  fetchImpl?: (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; status: number; headers: { get(n: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }>;
  storage?: { getItem(k: string): string | null; setItem(k: string, v: string): void } | null;
  /** Account the remembered volume belongs to. */
  scopeId?: string | null;
}

type Listener = () => void;

const prefKey = (scope: string | null | undefined) => `mango-farm-sound-v1:${scope ?? 'anonymous'}`;

export function loadVolume(storage: SoundDeps['storage'], scope: string | null | undefined): number {
  try {
    const raw = storage?.getItem(prefKey(scope));
    if (!raw) return DEFAULT_VOLUME;
    const v = Number((JSON.parse(raw) as { volume?: unknown }).volume);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

export class FarmSoundEngine {
  private deps: Required<Pick<SoundDeps, 'url'>> & SoundDeps;
  private listeners = new Set<Listener>();
  private ctx: ContextLike | null = null;
  private gain: GainLike | null = null;
  private source: SourceLike | null = null;
  private element: ElementLike | null = null;
  private buffer: unknown = null;
  private loadPromise: Promise<void> | null = null;
  private visible = true;
  private disposed = false;
  private token = 0;
  private snap: SoundSnapshot;
  /** For tests / diagnostics: how many sources were ever started and how many are alive. */
  public stats = { started: 0, alive: 0, fetches: 0, decodes: 0, contexts: 0 };

  constructor(deps: SoundDeps = {}) {
    this.deps = { ...deps, url: deps.url ?? FARM_SOUND_URL };
    this.snap = {
      enabled: false, sceneActive: false, status: 'off', availability: 'unknown',
      volume: loadVolume(deps.storage ?? null, deps.scopeId), error: null,
    };
  }

  // ---- observable state (useSyncExternalStore) ----
  getSnapshot = (): SoundSnapshot => this.snap;
  subscribe = (l: Listener): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(patch: Partial<SoundSnapshot>) {
    const next = { ...this.snap, ...patch };
    if (Object.keys(patch).every((k) => (this.snap as unknown as Record<string, unknown>)[k] === (next as unknown as Record<string, unknown>)[k])) return;
    this.snap = next;
    this.listeners.forEach((l) => l());
  }

  // ---- availability (a tiny HEAD request; only when the sound settings are opened) ----
  async checkAvailability(): Promise<SoundAvailability> {
    const f = this.deps.fetchImpl;
    if (!f) { this.set({ availability: 'unreachable' }); return 'unreachable'; }
    this.set({ availability: 'checking' });
    try {
      const res = await f(this.deps.url, { method: 'HEAD', cache: 'no-cache' });
      const type = (res.headers.get('content-type') || '').toLowerCase();
      // A single-page app host answers a missing file with index.html (200, text/html).
      const ok = res.ok && !type.includes('text/html');
      const availability: SoundAvailability = ok ? 'available' : 'missing';
      if (this.disposed) return availability;
      this.set({ availability, error: null });
      return availability;
    } catch {
      this.set({ availability: 'unreachable' });
      return 'unreachable';
    }
  }

  // ---- controls ----

  /** MUST be called from a user gesture (tap / click / key). */
  enable(): void {
    if (this.disposed || this.snap.enabled) return;
    this.set({ enabled: true, error: null });
    // Create + resume the context synchronously, inside the gesture (iOS Safari requirement).
    // Doing this lazily - only now - keeps everything else free of audio cost.
    this.ensureContext();
    void this.ctx?.resume().catch(() => undefined);
    this.sync();
  }

  disable(): void {
    if (this.disposed) return;
    this.set({ enabled: false, status: 'off', error: null });
    this.sync();
  }

  toggle(): void { if (this.snap.enabled) this.disable(); else this.enable(); }

  setVolume(volume: number): void {
    const v = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : DEFAULT_VOLUME));
    this.set({ volume: v });
    try { this.deps.storage?.setItem(prefKey(this.deps.scopeId), JSON.stringify({ volume: v })); } catch { /* not remembered */ }
    if (this.gain && this.ctx) {
      const t = this.ctx.currentTime;
      this.gain.gain.cancelScheduledValues(t);
      this.gain.gain.setValueAtTime(this.gain.gain.value, t);
      this.gain.gain.linearRampToValueAtTime(v, t + 0.08);
    }
    if (this.element) this.element.volume = v;
  }

  /** Realistic mode is on screen (true) or not (false). */
  setSceneActive(active: boolean): void {
    if (this.snap.sceneActive === active) return;
    this.set({ sceneActive: active });
    this.sync();
  }

  /** Page visibility: hidden pages must not keep playing (saves battery, avoids audio in the background). */
  setPageVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.sync();
  }

  dispose(): void {
    this.disposed = true;
    this.token++;
    this.stopNow();
    try { void this.ctx?.close(); } catch { /* ignore */ }
    this.ctx = null; this.gain = null; this.buffer = null; this.loadPromise = null;
    this.listeners.clear();
  }

  // ---- internals ----

  private shouldPlay(): boolean { return this.snap.enabled && this.snap.sceneActive && this.visible; }

  private sync(): void {
    if (this.disposed) return;
    if (this.shouldPlay()) { void this.start(); return; }
    this.stopSmooth();
    if (this.snap.enabled && !this.snap.sceneActive) this.set({ status: 'waiting' });
    else if (!this.snap.enabled && this.snap.status !== 'error') this.set({ status: 'off' });
  }

  private ensureContext(): ContextLike | null {
    if (this.ctx) return this.ctx;
    const ctx = this.deps.createContext?.() ?? null;
    if (!ctx) return null;
    this.ctx = ctx;
    this.stats.contexts++;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(ctx.destination);
    return ctx;
  }

  private async load(): Promise<void> {
    if (this.buffer || this.element) return;
    if (this.loadPromise) return this.loadPromise;
    const f = this.deps.fetchImpl;
    const ctx = this.ensureContext();
    this.loadPromise = (async () => {
      if (!f) throw Object.assign(new Error('no fetch'), { kind: 'loadFailed' });
      this.stats.fetches++;
      let res;
      try { res = await f(this.deps.url, { cache: 'force-cache' }); } catch { throw Object.assign(new Error('network'), { kind: 'unreachable' }); }
      const type = (res.headers.get('content-type') || '').toLowerCase();
      if (!res.ok || type.includes('text/html')) throw Object.assign(new Error('missing'), { kind: 'missing' });
      const length = Number(res.headers.get('content-length') || 0);
      if (length > MAX_DECODE_BYTES) {
        const el = this.deps.createElement?.() ?? null;
        if (!el) throw Object.assign(new Error('no element'), { kind: 'noAudio' });
        el.preload = 'auto'; el.loop = true; el.src = this.deps.url; el.volume = this.snap.volume;
        this.element = el;
        return;
      }
      if (!ctx) throw Object.assign(new Error('no audio'), { kind: 'noAudio' });
      const data = await res.arrayBuffer();
      try { this.stats.decodes++; this.buffer = await ctx.decodeAudioData(data); } catch { throw Object.assign(new Error('decode'), { kind: 'unsupported' }); }
    })();
    try { await this.loadPromise; } finally { this.loadPromise = null; }
  }

  private async start(): Promise<void> {
    if (this.source || (this.element && this.snap.status === 'playing')) return; // never a second instance
    const myToken = ++this.token;
    if (!this.ctx && !this.deps.createContext) { this.fail('noAudio'); return; }
    this.set({ status: this.buffer || this.element ? this.snap.status : 'loading' });
    if (!this.buffer && !this.element) this.set({ status: 'loading' });
    try {
      await this.load();
    } catch (e) {
      if (myToken !== this.token || this.disposed) return;
      const kind = (e as { kind?: keyof typeof SOUND_MESSAGES }).kind ?? 'loadFailed';
      if (kind === 'missing') this.set({ availability: 'missing' });
      this.fail(kind);
      return;
    }
    if (myToken !== this.token || this.disposed || !this.shouldPlay() || this.source) return;

    const ctx = this.ctx;
    try {
      if (this.element) {
        this.element.volume = this.snap.volume;
        await this.element.play();
        this.set({ status: 'playing', availability: 'available', error: null });
        return;
      }
      if (!ctx || !this.gain || !this.buffer) return;
      if (ctx.state === 'suspended') await ctx.resume();
      if (myToken !== this.token || !this.shouldPlay() || this.source) return;
      const src = ctx.createBufferSource();
      src.buffer = this.buffer;
      src.loop = true; // gapless, sample-accurate
      src.connect(this.gain);
      src.onended = () => { if (this.source === src) { this.source = null; this.stats.alive--; } try { src.disconnect(); } catch { /* ignore */ } };
      const t = ctx.currentTime;
      this.gain.gain.cancelScheduledValues(t);
      this.gain.gain.setValueAtTime(0, t);
      this.gain.gain.linearRampToValueAtTime(this.snap.volume, t + FADE_IN_S);
      src.start(t);
      this.source = src;
      this.stats.started++; this.stats.alive++;
      this.set({ status: 'playing', availability: 'available', error: null });
    } catch {
      this.fail('loadFailed');
    }
  }

  private fail(kind: keyof typeof SOUND_MESSAGES): void {
    const text = kind === 'unreachable' ? SOUND_MESSAGES.unreachable : SOUND_MESSAGES[kind] ?? SOUND_MESSAGES.loadFailed;
    // Nothing is left half-started: the user can simply try again.
    this.set({ status: 'error', error: text, enabled: kind === 'missing' ? false : this.snap.enabled && kind !== 'noAudio' && kind !== 'unsupported' });
    if (kind === 'unreachable') this.set({ availability: 'unreachable' });
  }

  private stopSmooth(): void {
    this.token++;
    if (this.element) { try { this.element.pause(); } catch { /* ignore */ } }
    const src = this.source; const ctx = this.ctx; const gain = this.gain;
    if (!src || !ctx || !gain) return;
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + FADE_OUT_S);
    try { src.stop(t + FADE_OUT_S + 0.02); } catch { /* already stopped */ }
    // onended clears `source`; also clear now so a quick re-enable creates ONE new source.
    this.source = null; this.stats.alive--;
    // Release the audio session once the fade has finished (not before: suspending now would cut the fade).
    setTimeout(() => {
      if (!this.disposed && !this.source && this.ctx === ctx) void ctx.suspend().catch(() => undefined);
    }, FADE_OUT_S * 1000 + 150);
  }

  private stopNow(): void {
    this.token++;
    try { this.element?.pause(); this.element?.removeAttribute('src'); this.element?.load(); } catch { /* ignore */ }
    this.element = null;
    if (this.source) { try { this.source.stop(); this.source.disconnect(); } catch { /* ignore */ } this.source = null; this.stats.alive--; }
  }
}

// ---- browser factory (the only place that touches window / AudioContext) ----

export function createBrowserSoundEngine(scopeId: string | null | undefined): FarmSoundEngine {
  const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : {};
  const Ctor = (w.AudioContext ?? w.webkitAudioContext) as (new () => ContextLike) | undefined;
  return new FarmSoundEngine({
    scopeId,
    storage: typeof localStorage !== 'undefined' ? localStorage : null,
    createContext: Ctor ? () => { try { return new Ctor(); } catch { return null; } } : () => null,
    createElement: typeof Audio !== 'undefined' ? () => new Audio() as unknown as ElementLike : () => null,
    fetchImpl: typeof fetch !== 'undefined' ? ((url, init) => fetch(url, init as RequestInit)) as SoundDeps['fetchImpl'] : undefined,
  });
}
