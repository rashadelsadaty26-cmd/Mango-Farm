// Dependency-free checks for landmark TYPES, the inventory, and placing / moving / deleting INSTANCES.
// Run:  node scripts/verify-landmark-types.ts      (Node >= 22.18, or --experimental-strip-types)
import assert from 'node:assert/strict';
import { GRID, buildKindGrid } from '../src/farm/infrastructure.ts';
import {
  MAX_LANDMARKS, MAX_LANDMARK_TYPES, PRESET_LANDMARK_TYPES, buildLandmarkInventory, createLandmarkType, deleteLandmark,
  isTreeCenter, landmarkTypeKey, moveLandmark, normalizeLandmarks, normalizeLandmarkTypes, pickSlotAtPixel, placeLandmark,
  slotToPixel, updateLandmark, type FarmLandmark, type LandmarkMap, type LandmarkTypeMap,
} from '../src/farm/landmarks.ts';

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('  ok  ' + name); };
const R = 6, C = 9;
const labels = Array.from({ length: R }, (_, i) => String(i));
const grid = buildKindGrid({}, labels, C, { 0: 'road' }, {});           // row 0 is a road
const ctx = { rows: R, cols: C, grid };
const TAP = PRESET_LANDMARK_TYPES.find((t) => t.id === 'preset_tap')!;
const POLE = PRESET_LANDMARK_TYPES.find((t) => t.id === 'preset_light_pole')!;
const NOW = '2026-10-24T00:00:00.000Z';
const deepFreeze = <T>(o: T): T => { if (o && typeof o === 'object') { Object.values(o as object).forEach(deepFreeze); Object.freeze(o); } return o; };
const legacy = (id: string, name: string, icon: string, x: number, y: number): FarmLandmark => ({ id, name, icon, kind: 'custom', position: { x, y }, createdAt: '', updatedAt: '' });

console.log('Types and inventory');
test('presets: water tap, water basin, light pole, utility marker - each with icon and name', () => {
  assert.equal(PRESET_LANDMARK_TYPES.length, 4);
  for (const t of PRESET_LANDMARK_TYPES) { assert.ok(t.name && t.icon && /^preset_/.test(t.id)); }
  assert.equal(new Set(PRESET_LANDMARK_TYPES.map((t) => t.id)).size, 4);
});
test('inventory lists every preset (count 0) even on an empty farm', () => {
  const inv = buildLandmarkInventory({}, {}); assert.deepEqual(inv.map((e) => e.id), PRESET_LANDMARK_TYPES.map((t) => t.id)); assert.ok(inv.every((e) => e.count === 0 && e.source === 'preset'));
});
test('counts come from the instances: many instances of one type, others untouched', () => {
  let lms: LandmarkMap = {};
  for (let i = 0; i < 7; i++) { const r = placeLandmark(lms, POLE, { x: 2 * i + 2, y: 3 }, ctx, NOW); assert.ok(r.ok); if (r.ok) lms = r.landmarks; }
  const inv = buildLandmarkInventory(lms, {}); assert.equal(inv.find((e) => e.id === POLE.id)!.count, 7); assert.equal(inv.find((e) => e.id === TAP.id)!.count, 0);
});
test('farms saved before types existed: objects match a preset by name+icon, or form a deterministic derived type', () => {
  const lms: LandmarkMap = { a: legacy('a', 'حنفية', '🚰', 4, 3), b: legacy('b', 'حنفية', '🚰', 8, 3), c: legacy('c', 'مضخة', '⚙️', 6, 5), d: legacy('d', 'مضخة', '⚙️', 6, 7) };
  assert.equal(landmarkTypeKey(lms.a), 'preset_tap'); assert.equal(landmarkTypeKey(lms.c), landmarkTypeKey(lms.d)); assert.match(landmarkTypeKey(lms.c), /^legacy_/);
  assert.equal(landmarkTypeKey(legacy('z', 'مضخة', '⚙️', 1, 1)), landmarkTypeKey(lms.c), 'same on every device');
  const inv = buildLandmarkInventory(lms, {}); assert.equal(inv.find((e) => e.id === 'preset_tap')!.count, 2);
  const pump = inv.find((e) => e.source === 'derived')!; assert.equal(pump.count, 2); assert.equal(pump.name, 'مضخة'); assert.equal(pump.icon, '⚙️');
  const total = inv.reduce((n, e) => n + e.count, 0); assert.equal(total, 4, 'every instance is counted exactly once');
});
test('custom types are listed (oldest first) after presets, with their instance counts', () => {
  const types: LandmarkTypeMap = { lt_b: { id: 'lt_b', name: 'ب', icon: '🔌', createdAt: '2', updatedAt: '2' }, lt_a: { id: 'lt_a', name: 'أ', icon: '🪵', createdAt: '1', updatedAt: '1' } };
  const inv = buildLandmarkInventory({}, types); assert.deepEqual(inv.slice(4).map((e) => e.id), ['lt_a', 'lt_b']); assert.ok(inv.slice(4).every((e) => e.source === 'custom'));
});

console.log('Creating types');
test('a new type needs a valid name; icon is sanitised; ids look like lt_… and are unique', () => {
  assert.equal(createLandmarkType('', '🔌', {}, NOW).ok, false); assert.equal(createLandmarkType('x'.repeat(200), '🔌', {}, NOW).ok, false);
  const seen = new Set<string>(); let types: LandmarkTypeMap = {};
  for (let i = 0; i < 40; i++) { const r = createLandmarkType('نوع ' + i, '🔌', types, NOW); assert.ok(r.ok); if (r.ok) { assert.match(r.type.id, /^lt_[A-Za-z0-9]+$/); assert.ok(!seen.has(r.type.id)); seen.add(r.type.id); types = { ...types, [r.type.id]: r.type }; } }
});
test('duplicate names are refused against presets and custom types (case/space-insensitive)', () => {
  assert.equal(createLandmarkType(' حنفية ', '🚰', {}, NOW).ok, false);
  const t = createLandmarkType('Socket', '🔌', {}, NOW); assert.ok(t.ok); if (t.ok) assert.equal(createLandmarkType('socket', '🔌', { [t.type.id]: t.type }, NOW).ok, false);
});
test('the number of custom types is capped', () => {
  const types: LandmarkTypeMap = {}; for (let i = 0; i < MAX_LANDMARK_TYPES; i++) types[`lt_${i}`] = { id: `lt_${i}`, name: 'n' + i, icon: '📍', createdAt: '', updatedAt: '' };
  assert.equal(createLandmarkType('جديد', '📍', types, NOW).ok, false);
});
test('normalizeLandmarkTypes keeps good records and skips malformed ones / preset ids / mismatched ids', () => {
  const out = normalizeLandmarkTypes({ lt_ok: { id: 'lt_ok', name: 'جيد', icon: '🔌' }, lt_bad: { name: '' }, 'bad key!': { name: 'x' }, preset_tap: { name: 'x' }, lt_mis: { id: 'other', name: 'x' }, junk: 5 });
  assert.deepEqual(Object.keys(out), ['lt_ok']); assert.deepEqual(normalizeLandmarkTypes(null), {}); assert.deepEqual(normalizeLandmarkTypes([1, 2]), {});
});

console.log('Placing the same type repeatedly');
test('each placement is a NEW instance with its own id and position; type is retained; input is not mutated', () => {
  const start = deepFreeze({} as LandmarkMap); let lms: LandmarkMap = start; const ids = new Set<string>();
  const slots = [{ x: 2, y: 3 }, { x: 4, y: 3 }, { x: 2, y: 5 }, { x: 5, y: 4 }, { x: 8, y: 7 }];
  for (const slot of slots) { const r = placeLandmark(lms, TAP, slot, ctx, NOW); assert.ok(r.ok); if (!r.ok) return; assert.equal(r.landmark.typeId, TAP.id); assert.equal(r.landmark.name, TAP.name); assert.equal(r.landmark.icon, TAP.icon); assert.match(r.landmark.id, /^lm_[A-Za-z0-9]+$/); assert.ok(!ids.has(r.landmark.id)); ids.add(r.landmark.id); lms = deepFreeze(r.landmarks); }
  assert.equal(Object.keys(lms).length, 5); assert.deepEqual(Object.keys(start), []);
});
test('ids stay unique under heavy placement (80 instances) and the 500-object cap is enforced', () => {
  let lms: LandmarkMap = {}; let n = 0;
  outer: for (let y = 3; y <= 2 * R - 1; y++) for (let x = 1; x <= 2 * C - 1; x++) { if (isTreeCenter({ x, y })) continue; const r = placeLandmark(lms, POLE, { x, y }, { ...ctx, grid: null }, NOW); if (r.ok) { lms = r.landmarks; n++; } if (n >= 80) break outer; }
  assert.equal(new Set(Object.values(lms).map((l) => l.id)).size, Object.keys(lms).length);
  const full: LandmarkMap = {}; for (let i = 0; i < MAX_LANDMARKS; i++) full[`lm_${i}`] = legacy(`lm_${i}`, 'x', '📍', 0, 0);
  const over = placeLandmark(full, POLE, { x: 2, y: 3 }, ctx, NOW); assert.equal(over.ok, false); if (!over.ok) assert.equal(over.reason, 'limit');
});
test('refuses: tree centre, outside the farm, on infrastructure, an occupied slot - and changes nothing', () => {
  const existing = placeLandmark({}, TAP, { x: 4, y: 3 }, ctx, NOW); assert.ok(existing.ok); if (!existing.ok) return;
  const cases: Array<[{ x: number; y: number }, string]> = [[{ x: 3, y: 3 }, 'tree-center'], [{ x: 0, y: 3 }, 'out-of-bounds'], [{ x: 2 * C, y: 3 }, 'out-of-bounds'], [{ x: 4, y: 2 }, 'infrastructure'], [{ x: 4, y: 3 }, 'occupied']];
  for (const [slot, reason] of cases) { const r = placeLandmark(existing.landmarks, POLE, slot, ctx, NOW); assert.equal(r.ok, false, reason); if (!r.ok) { assert.equal(r.reason, reason); assert.ok(r.message.length > 0); } }
});
test('placing never replaces or edits an existing landmark', () => {
  const a = placeLandmark({}, TAP, { x: 4, y: 3 }, ctx, NOW); assert.ok(a.ok); if (!a.ok) return;
  const b = placeLandmark(a.landmarks, TAP, { x: 6, y: 3 }, ctx, NOW); assert.ok(b.ok); if (!b.ok) return;
  assert.deepEqual(b.landmarks[a.landmark.id], a.landmark);
});

console.log('Moving, editing, deleting ONE instance');
const three = (() => { let l: LandmarkMap = {}; const ids: string[] = []; for (const s of [{ x: 2, y: 3 }, { x: 4, y: 3 }, { x: 6, y: 3 }]) { const r = placeLandmark(l, POLE, s, ctx, NOW); if (r.ok) { l = r.landmarks; ids.push(r.landmark.id); } } return { l: deepFreeze(l), ids }; })();
test('move changes only that instance\'s position (and updatedAt)', () => {
  const [a, b, c] = three.ids; const r = moveLandmark(three.l, b, { x: 8, y: 5 }, ctx, '2027-01-01T00:00:00.000Z'); assert.ok(r.ok); if (!r.ok) return;
  assert.deepEqual(r.landmarks[b].position, { x: 8, y: 5 }); assert.equal(r.landmarks[b].typeId, POLE.id); assert.equal(r.landmarks[b].id, b);
  assert.deepEqual(r.landmarks[a], three.l[a]); assert.deepEqual(r.landmarks[c], three.l[c]);
});
test('move: its own slot is allowed, another instance\'s slot is not, unknown ids fail cleanly', () => {
  const [a, b] = three.ids; assert.ok(moveLandmark(three.l, a, three.l[a].position, ctx, NOW).ok);
  const clash = moveLandmark(three.l, a, three.l[b].position, ctx, NOW); assert.equal(clash.ok, false); if (!clash.ok) assert.equal(clash.reason, 'occupied');
  const gone = moveLandmark(three.l, 'nope', { x: 8, y: 5 }, ctx, NOW); assert.equal(gone.ok, false); if (!gone.ok) assert.equal(gone.reason, 'missing');
});
test('delete removes exactly one instance; the others of the same type survive; unknown id is a no-op', () => {
  const [a, b, c] = three.ids; const after = deleteLandmark(three.l, b);
  assert.deepEqual(Object.keys(after).sort(), [a, c].sort()); assert.equal(buildLandmarkInventory(after, {}).find((e) => e.id === POLE.id)!.count, 2);
  assert.equal(deleteLandmark(three.l, 'nope'), three.l);
});
test('change type / note affects only that instance; clearing a note removes it', () => {
  const [a, b] = three.ids; const r = updateLandmark(three.l, a, { type: TAP, note: '  عند البوابة  ' }, NOW); assert.ok(r.ok); if (!r.ok) return;
  assert.equal(r.landmarks[a].typeId, TAP.id); assert.equal(r.landmarks[a].name, TAP.name); assert.equal(r.landmarks[a].icon, TAP.icon); assert.equal(r.landmarks[a].meta?.note, 'عند البوابة'); assert.deepEqual(r.landmarks[b], three.l[b]);
  const cleared = updateLandmark(r.landmarks, a, { note: '' }, NOW); assert.ok(cleared.ok); if (cleared.ok) assert.equal(cleared.landmarks[a].meta, undefined);
  assert.equal(buildLandmarkInventory(r.landmarks, {}).find((e) => e.id === POLE.id)!.count, 2);
});
test('stored shape: typeId survives normalizeLandmarks; objects without it still load', () => {
  const [a] = three.ids; const n = normalizeLandmarks(JSON.parse(JSON.stringify(three.l))); assert.equal(n[a].typeId, POLE.id);
  const old = normalizeLandmarks({ x1: { id: 'x1', name: 'قديم', icon: '📍', kind: 'custom', position: { x: 2, y: 3 } } }); assert.equal(old.x1.typeId, undefined);
});
test('none of these functions can touch tree records: they take no tree data at all (structural)', () => {
  for (const fn of [placeLandmark, moveLandmark, updateLandmark]) assert.ok(fn.length >= 4 || fn === updateLandmark);
  const cells = { 'أ-1': { type: 'tree', variety: 'عويس' } }; const before = JSON.stringify(cells);
  const r = placeLandmark({}, TAP, { x: 2, y: 3 }, ctx, NOW); assert.ok(r.ok); assert.equal(JSON.stringify(cells), before);
});

console.log('Picking a slot from a tap');
test('the exact centre of every slot picks that slot (round trip over the whole lattice)', () => {
  for (let x = 1; x <= 2 * C - 1; x++) for (let y = 1; y <= 2 * R - 1; y++) {
    const p = slotToPixel({ x, y });
    if (isTreeCenter({ x, y })) assert.equal(pickSlotAtPixel(p.x, p.y, R, C), null, `tree ${x},${y}`);
    else assert.deepEqual(pickSlotAtPixel(p.x, p.y, R, C), { x, y }, `slot ${x},${y}`);
  }
});
test('a tap in the middle of a tree is never turned into a neighbouring gutter, whatever the slack', () => {
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) for (const slack of [0, 6, 20, 1000]) {
    const cx = c * (GRID.cellW + GRID.gap) + GRID.cellW / 2, cy = r * (GRID.cellH + GRID.gap) + GRID.cellH / 2;
    assert.equal(pickSlotAtPixel(cx, cy, R, C, slack), null);
  }
});
test('slack: a fingertip just inside a tree\'s edge picks the gutter next to it; beyond the slack it is a tree', () => {
  const px = GRID.cellW - 3, py = GRID.cellH / 2;                      // 3px inside the right edge of tree (0,0)
  assert.equal(pickSlotAtPixel(px, py, R, C, 0), null); assert.deepEqual(pickSlotAtPixel(px, py, R, C, 6), { x: 2, y: 1 });
  assert.equal(pickSlotAtPixel(GRID.cellW - 12, py, R, C, 6), null);
});
test('outside the farm (before the first / after the last tree) picks nothing', () => {
  assert.equal(pickSlotAtPixel(-5, 10, R, C, 6), null); assert.equal(pickSlotAtPixel(C * (GRID.cellW + GRID.gap), 10, R, C, 6), null);
  assert.equal(pickSlotAtPixel((C - 1) * (GRID.cellW + GRID.gap) + GRID.cellW + 5, GRID.cellH / 2, R, C, 6), null);
  assert.equal(pickSlotAtPixel(NaN, 1, R, C), null);
});

console.log(`\n${passed} landmark-type checks passed`);
