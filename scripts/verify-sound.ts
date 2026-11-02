// Dependency-free checks for the ambient farm sound engine (fake AudioContext / fetch).
// Run:  node scripts/verify-sound.ts      (Node >= 22.18, or --experimental-strip-types)
import assert from 'node:assert/strict';
import {
  DEFAULT_VOLUME, FARM_SOUND_PUBLIC_PATH, FARM_SOUND_URL, FarmSoundEngine, MAX_DECODE_BYTES, SOUND_MESSAGES, loadVolume,
  type ContextLike, type SoundDeps,
} from '../src/farm/sound/farmSound.ts';

let passed = 0;
const test = async (name: string, fn: () => void | Promise<void>) => { await fn(); passed++; console.log('  ok  ' + name); };
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };

function fakeContext() {
  const log: string[] = [];
  const sources: any[] = [];
  const gainEvents: Array<[string, number]> = [];
  let state = 'suspended';
  const ctx: ContextLike & { log: string[]; sources: any[]; gainEvents: typeof gainEvents } = {
    log, sources, gainEvents,
    currentTime: 0,
    get state() { return state; },
    destination: {},
    createGain: () => ({
      gain: {
        value: 0,
        cancelScheduledValues() {}, setValueAtTime(v) { gainEvents.push(['set', v]); },
        linearRampToValueAtTime(v) { gainEvents.push(['ramp', v]); },
      },
      connect() {}, disconnect() {},
    }),
    createBufferSource: () => {
      const s: any = { buffer: null, loop: false, onended: null, started: false, stopped: false,
        connect() {}, disconnect() {}, start() { s.started = true; log.push('start'); }, stop() { s.stopped = true; log.push('stop'); } };
      sources.push(s); return s;
    },
    decodeAudioData: async (d: ArrayBuffer) => { log.push('decode'); if (d.byteLength === 3) throw new Error('bad'); return { duration: 60 }; },
    resume: async () => { state = 'running'; log.push('resume'); },
    suspend: async () => { state = 'suspended'; log.push('suspend'); },
    close: async () => { log.push('close'); },
  } as any;
  return ctx;
}

const res = (o: { ok?: boolean; type?: string; bytes?: number; length?: number } = {}) => ({
  ok: o.ok ?? true, status: o.ok === false ? 404 : 200,
  headers: { get: (n: string) => (n === 'content-type' ? (o.type ?? 'audio/mpeg') : n === 'content-length' ? String(o.length ?? o.bytes ?? 100) : null) },
  arrayBuffer: async () => new ArrayBuffer(o.bytes ?? 100),
});

function setup(over: Partial<SoundDeps> & { response?: ReturnType<typeof res> } = {}) {
  const ctx = fakeContext();
  let creates = 0; let fetches = 0;
  const store: Record<string, string> = {};
  const engine = new FarmSoundEngine({
    scopeId: 'u1',
    storage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    createContext: () => { creates++; return ctx; },
    fetchImpl: async () => { fetches++; return over.response ?? res(); },
    createElement: () => null,
    ...over,
  });
  return { engine, ctx, store, counts: () => ({ creates, fetches }) };
}

console.log('Location and laziness');
await test('the recording lives at one exact path and the URL points to it', () => {
  assert.equal(FARM_SOUND_PUBLIC_PATH, 'public/audio/farm-ambience.mp3');
  assert.ok(FARM_SOUND_URL.endsWith('/audio/farm-ambience.mp3'));
});
await test('constructing the engine and changing scene / visibility creates NO audio context and fetches nothing', async () => {
  const { engine, counts } = setup();
  engine.setSceneActive(true); engine.setPageVisible(false); engine.setPageVisible(true); engine.setVolume(0.3);
  await settle();
  assert.deepEqual(counts(), { creates: 0, fetches: 0 });
  assert.equal(engine.getSnapshot().status, 'off');
  assert.equal(engine.getSnapshot().enabled, false);
});
await test('nothing plays before the user enables it, even with Realistic on screen', async () => {
  const { engine, ctx } = setup();
  engine.setSceneActive(true); await settle();
  assert.equal(ctx.sources.length, 0);
});

console.log('Playback');
await test('enable() in Realistic mode: fetch once, decode once, ONE looping source with fade-in', async () => {
  const { engine, ctx, counts } = setup();
  engine.setSceneActive(true);
  engine.enable(); await settle();
  assert.equal(ctx.sources.length, 1);
  assert.equal(ctx.sources[0].loop, true, 'sample-accurate loop');
  assert.equal(ctx.sources[0].started, true);
  assert.deepEqual(counts(), { creates: 1, fetches: 1 });
  assert.equal(engine.getSnapshot().status, 'playing');
  assert.deepEqual(ctx.gainEvents.slice(0, 2), [['set', 0], ['ramp', DEFAULT_VOLUME]]);
  assert.equal(engine.stats.decodes, 1);
});
await test('repeated enable / scene / visibility changes never create a second simultaneous instance', async () => {
  const { engine, ctx } = setup();
  engine.setSceneActive(true);
  engine.enable(); engine.enable(); engine.toggle(); engine.toggle(); await settle();
  engine.setSceneActive(true); engine.setPageVisible(true); await settle();
  assert.ok(engine.stats.alive <= 1, `alive ${engine.stats.alive}`);
  for (let i = 0; i < 5; i++) { engine.setPageVisible(false); engine.setPageVisible(true); await settle(); assert.ok(engine.stats.alive <= 1); }
  assert.equal(engine.stats.alive, 1);
  assert.equal(engine.stats.decodes, 1, 'decoded only once');
  assert.ok(ctx.sources.filter((s) => s.started && !s.stopped).length <= 1);
});
await test('disabling stops with a fade-out; scene off (Standard mode) pauses; back to Realistic resumes', async () => {
  const { engine, ctx } = setup();
  engine.setSceneActive(true); engine.enable(); await settle();
  engine.setSceneActive(false); await settle();
  assert.equal(engine.getSnapshot().status, 'waiting');
  assert.equal(ctx.sources[0].stopped, true);
  assert.equal(engine.stats.alive, 0);
  engine.setSceneActive(true); await settle();
  assert.equal(engine.getSnapshot().status, 'playing');
  assert.equal(engine.stats.alive, 1);
  engine.disable(); await settle();
  assert.equal(engine.getSnapshot().status, 'off');
  assert.equal(engine.stats.alive, 0);
  assert.equal(engine.stats.fetches, 1, 'the file is not downloaded again');
});
await test('enabled while Standard mode is shown: waits, and starts as soon as Realistic is on', async () => {
  const { engine, ctx } = setup();
  engine.enable(); await settle();
  assert.equal(engine.getSnapshot().status, 'waiting');
  assert.equal(ctx.sources.length, 0);
  engine.setSceneActive(true); await settle();
  assert.equal(ctx.sources.length, 1);
});
await test('a hidden page stops the sound and a visible page resumes it', async () => {
  const { engine } = setup();
  engine.setSceneActive(true); engine.enable(); await settle();
  engine.setPageVisible(false); await settle();
  assert.equal(engine.stats.alive, 0);
  engine.setPageVisible(true); await settle();
  assert.equal(engine.stats.alive, 1);
});
await test('volume is clamped, applied live through the gain node and remembered per account (volume only)', async () => {
  const { engine, ctx, store } = setup();
  engine.setSceneActive(true); engine.enable(); await settle();
  engine.setVolume(2); assert.equal(engine.getSnapshot().volume, 1);
  engine.setVolume(-1); assert.equal(engine.getSnapshot().volume, 0);
  engine.setVolume(0.25);
  assert.deepEqual(ctx.gainEvents.at(-1), ['ramp', 0.25]);
  assert.deepEqual(Object.keys(store), ['mango-farm-sound-v1:u1']);
  assert.deepEqual(JSON.parse(store['mango-farm-sound-v1:u1']), { volume: 0.25 }, 'no "enabled" flag is stored');
  assert.equal(loadVolume({ getItem: (k) => store[k] ?? null, setItem() {} }, 'u1'), 0.25);
  assert.equal(loadVolume({ getItem: (k) => store[k] ?? null, setItem() {} }, 'other-user'), DEFAULT_VOLUME);
  assert.equal(loadVolume({ getItem: () => 'garbage', setItem() {} }, 'u1'), DEFAULT_VOLUME);
});

console.log('Missing / broken file');
await test('missing file (404): clear Arabic state, no throw, sound switches itself off, app keeps working', async () => {
  const { engine, ctx } = setup({ response: res({ ok: false }) });
  engine.setSceneActive(true); engine.enable(); await settle();
  const s = engine.getSnapshot();
  assert.equal(s.availability, 'missing');
  assert.equal(s.enabled, false);
  assert.equal(ctx.sources.length, 0);
  assert.equal(SOUND_MESSAGES.missing, 'ملف صوت المزرعة غير موجود بعد');
});
await test('SPA hosts answer a missing file with index.html (200 text/html): treated as missing, never decoded', async () => {
  const { engine, ctx } = setup({ response: res({ type: 'text/html; charset=utf-8' }) });
  engine.setSceneActive(true); engine.enable(); await settle();
  assert.equal(engine.getSnapshot().availability, 'missing');
  assert.equal(ctx.log.includes('decode'), false);
  const { engine: e2 } = setup({ response: res({ type: 'text/html' }) });
  assert.equal(await e2.checkAvailability(), 'missing');
});
await test('checkAvailability: present / missing / offline are distinguished', async () => {
  assert.equal(await setup().engine.checkAvailability(), 'available');
  assert.equal(await setup({ response: res({ ok: false }) }).engine.checkAvailability(), 'missing');
  const off = setup({ fetchImpl: async () => { throw new TypeError('offline'); } });
  assert.equal(await off.engine.checkAvailability(), 'unreachable');
  assert.equal(off.counts().creates, 0, 'checking does not create an audio context');
});
await test('undecodable / unsupported data: friendly error, no source, no crash', async () => {
  const { engine, ctx } = setup({ response: res({ bytes: 3 }) });
  engine.setSceneActive(true); engine.enable(); await settle();
  const s = engine.getSnapshot();
  assert.equal(s.status, 'error');
  assert.equal(s.error, SOUND_MESSAGES.unsupported);
  assert.equal(ctx.sources.length, 0);
});
await test('no Web Audio support: friendly message, no throw', async () => {
  const { engine } = setup({ createContext: () => null });
  engine.setSceneActive(true); engine.enable(); await settle();
  assert.equal(engine.getSnapshot().status, 'error');
  assert.equal(engine.getSnapshot().error, SOUND_MESSAGES.noAudio);
});
await test('a very large file streams through an <audio loop> element instead of being decoded to PCM', async () => {
  const el: any = { src: '', loop: false, volume: 1, preload: '', played: 0, paused: 0, play: async () => { el.played++; }, pause: () => { el.paused++; }, removeAttribute() {}, load() {}, addEventListener() {} };
  const { engine, ctx } = setup({ response: res({ length: MAX_DECODE_BYTES + 1 }), createElement: () => el });
  engine.setSceneActive(true); engine.enable(); await settle();
  assert.equal(el.loop, true); assert.equal(el.played, 1);
  assert.equal(ctx.log.includes('decode'), false);
  engine.disable(); await settle();
  assert.equal(el.paused >= 1, true);
});
await test('disabling while the file is still loading never starts playback afterwards', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const { engine, ctx } = setup({ fetchImpl: async () => { await gate; return res(); } });
  engine.setSceneActive(true); engine.enable(); await settle();
  engine.disable(); release(); await settle();
  assert.equal(ctx.sources.length, 0);
  assert.equal(engine.getSnapshot().status, 'off');
});

console.log('Cleanup');
await test('dispose() stops playback, closes the context and drops listeners; later calls are no-ops', async () => {
  const { engine, ctx } = setup();
  let calls = 0; engine.subscribe(() => { calls++; });
  engine.setSceneActive(true); engine.enable(); await settle();
  engine.dispose();
  assert.equal(engine.stats.alive, 0);
  assert.ok(ctx.log.includes('close'));
  const before = calls;
  engine.enable(); engine.setVolume(0.9); await settle();
  assert.equal(calls, before);
  assert.equal(ctx.sources.length, 1);
});
await test('snapshot subscribers are notified on changes only (no render storms)', async () => {
  const { engine } = setup();
  let n = 0; engine.subscribe(() => { n++; });
  engine.setSceneActive(false); engine.setSceneActive(false); engine.setVolume(DEFAULT_VOLUME);
  assert.equal(n, 0);
  engine.setSceneActive(true); assert.equal(n, 1);
});

console.log(`\n${passed} sound checks passed`);
process.exit(0);
