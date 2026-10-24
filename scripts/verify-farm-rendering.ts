// Dependency-free checks for the connected-cell engine and tree status mapping.
// Run:  node scripts/verify-farm-rendering.ts      (Node >= 22.18, or --experimental-strip-types)
import assert from 'node:assert/strict';
import {
  buildKindGrid, buildInfraPaths, getConnectionMask, classifyMask, resolveInfraKind, kindAt, N, E, S, W, GRID,
} from '../src/farm/infrastructure.ts';
import {
  getTreeHealthFlags, getTreeTone, getVarietyAccent, VARIETY_ACCENTS,
  getRetiredKind, statusLabel, STATUS_GRAFTED, STATUS_UPROOTED, STATUS_NEEDS_PRUNING, TONE_COLORS,
} from '../src/farm/treeVisuals.ts';

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('  ok  ' + name); };

// Build a grid from ASCII art: W water, R road, D drainage, . none
const rowLabels = (n: number) => Array.from({ length: n }, (_, i) => 'r' + i);
function grid(art: string[]) {
  const cells: Record<string, { type?: string }> = {};
  art.forEach((line, r) => [...line].forEach((ch, c) => {
    const type = ({ W: 'water_canal', R: 'road', D: 'drainage' } as Record<string, string>)[ch];
    if (type) cells[`r${r}-${c + 1}`] = { type };
  }));
  return buildKindGrid(cells, rowLabels(art.length), art[0].length, {}, {});
}
const shapeAt = (g: ReturnType<typeof grid>, r: number, c: number) => classifyMask(getConnectionMask(g, r, c));

console.log('Connectivity shapes');
test('all 16 neighbour masks classify correctly (4 corners, 4 tees, 2 straights, 4 ends, cross, isolated)', () => {
  const expected: Record<number, string> = {
    0: 'isolated',
    [N]: 'end', [E]: 'end', [S]: 'end', [W]: 'end',
    [N | S]: 'straight', [E | W]: 'straight',
    [N | E]: 'corner', [E | S]: 'corner', [S | W]: 'corner', [W | N]: 'corner',
    [N | E | S]: 'tee', [E | S | W]: 'tee', [S | W | N]: 'tee', [W | N | E]: 'tee',
    [N | E | S | W]: 'cross',
  };
  for (let m = 0; m < 16; m++) assert.equal(classifyMask(m), expected[m], 'mask ' + m);
});

test('the shape drawn in the grid matches the neighbours, for every kind', () => {
  for (const ch of ['W', 'R', 'D']) {
    // centre cell (2,2) is rebuilt with each neighbour subset; mask must equal the subset
    for (let subset = 0; subset < 16; subset++) {
      const art = Array.from({ length: 5 }, () => [...'.....']);
      art[2][2] = ch;
      if (subset & N) art[1][2] = ch;
      if (subset & E) art[2][3] = ch;
      if (subset & S) art[3][2] = ch;
      if (subset & W) art[2][1] = ch;
      const g = grid(art.map((l) => l.join('')));
      assert.equal(getConnectionMask(g, 2, 2), subset);
    }
  }
});

test('exact shape table on a hand-made network', () => {
  const g = grid([
    'W.W.W.W.W',
    'W.W.WWWWW',
    'WWWWW.W.W',
    '..W...W..',
    '..W..WWW.',
  ]);
  assert.equal(getConnectionMask(g, 1, 0), N | S);
  assert.equal(shapeAt(g, 0, 0), 'end');
  assert.equal(getConnectionMask(g, 2, 0), N | E);
  assert.equal(shapeAt(g, 2, 2), 'cross');
  assert.equal(getConnectionMask(g, 1, 4), N | E | S);
  assert.equal(shapeAt(g, 1, 4), 'tee');
  assert.equal(getConnectionMask(g, 4, 6), W | E | N);
});

test('different kinds never connect (road next to drainage stays separate)', () => {
  const g = grid(['RD', 'RD']);
  assert.equal(getConnectionMask(g, 0, 0), S);
  assert.equal(getConnectionMask(g, 0, 1), S);
});

console.log('Add / remove recalculates automatically');
test('adding a cell above/below/left/right connects immediately; removing reverts', () => {
  const base = grid(['.....', '.....', '..W..', '.....', '.....']);
  assert.equal(shapeAt(base, 2, 2), 'isolated');
  const sigBase = base.signature;
  const dirs: [string, number, number, number][] = [['above', 1, 2, S], ['below', 3, 2, N], ['left', 2, 1, E], ['right', 2, 3, W]];
  for (const [name, r, c, expectNeighborBit] of dirs) {
    const art = ['.....', '.....', '..W..', '.....', '.....'].map((l) => [...l]);
    art[r][c] = 'W';
    const g = grid(art.map((l) => l.join('')));
    assert.equal(getConnectionMask(g, r, c) & expectNeighborBit, expectNeighborBit, `${name}: new cell sees old`);
    assert.equal(shapeAt(g, 2, 2), 'end', `${name}: old cell became an end`);
    assert.notEqual(g.signature, sigBase);
    // remove again -> identical geometry/signature
    assert.equal(grid(['.....', '.....', '..W..', '.....', '.....']).signature, sigBase);
  }
  // Straight -> T -> cross by adding arms, then back by removing
  const straight = grid(['..W..', '..W..', '..W..']);
  assert.equal(shapeAt(straight, 1, 2), 'straight');
  const tee = grid(['..W..', '..WW.', '..W..']);
  assert.equal(shapeAt(tee, 1, 2), 'tee');
  const cross = grid(['..W..', '.WWW.', '..W..']);
  assert.equal(shapeAt(cross, 1, 2), 'cross');
  const corner = grid(['..W..', '..WW.', '.....']);
  assert.equal(shapeAt(corner, 1, 2), 'corner');
  // removing the centre of a straight line splits it into two ends
  const split = grid(['..W..', '.....', '..W..']);
  assert.equal(shapeAt(split, 0, 2), 'isolated');
});

console.log('Gap rows/columns (road column 9, drainage column 10)');
test('gap columns resolve to a continuous run; explicit cell type wins', () => {
  const rows = rowLabels(6);
  const g = buildKindGrid({ 'r2-9': { type: 'water_canal' } }, rows, 12, {}, { 8: 'road', 9: 'drainage' });
  for (let r = 0; r < 6; r++) {
    if (r !== 2) assert.equal(kindAt(g, r, 8), 'road');
    assert.equal(kindAt(g, r, 9), 'drainage');
  }
  assert.equal(kindAt(g, 2, 8), 'water');                       // explicit type wins
  assert.equal(getConnectionMask(g, 0, 8), S);                  // road run is interrupted by the canal cell
  assert.equal(getConnectionMask(g, 0, 9) & E, 0);               // drainage never joins the road
  assert.equal(resolveInfraKind('tree', 'road', 'drainage'), 'road'); // row gap beats column gap, as before
  assert.equal(resolveInfraKind(undefined, undefined, undefined), null);
});
test('a road row crossing a road column forms an intersection', () => {
  const g = buildKindGrid({}, rowLabels(5), 5, { 2: 'road' }, { 2: 'road' });
  assert.equal(shapeAt(g, 2, 2), 'cross');
  assert.equal(shapeAt(g, 2, 0), 'end');
  assert.equal(shapeAt(g, 0, 2), 'end');
});

console.log('Geometry');
test('paths: runs are single polylines, ends reach the cell edge, blocks fill 2x2', () => {
  const run = grid(['R', 'R', 'R']);
  const p = buildInfraPaths(run, 'road', 0);
  assert.equal(p.blocks, '');
  assert.equal((p.chains.match(/M/g) || []).length, 1, 'one chain for a straight run');
  // vertical run of 3 rows x 1 col: from y=0 to the bottom of row 3, x at the cell centre.
  // (Derived from GRID so the check follows the grid metrics instead of hard-coding them.)
  assert.equal(p.chains, `M${GRID.cellW / 2} 0L${GRID.cellW / 2} ${3 * GRID.cellH + 2 * GRID.gap}`);
  const block = grid(['WW', 'WW']);
  assert.notEqual(buildInfraPaths(block, 'water', 22).blocks, '');
  const bend = grid(['WW', '.W']);
  const bp = buildInfraPaths(bend, 'water', 0);
  assert.equal((bp.chains.match(/M/g) || []).length, 1, 'a bend is ONE polyline (round join, no notch)');
  const tee = grid(['.W.', 'WWW']);
  assert.equal((buildInfraPaths(tee, 'water', 0).chains.match(/M/g) || []).length, 3, 'tee: three arms meeting at the junction');
  const loop = grid(['WWW', 'W.W', 'WWW']);
  assert.match(buildInfraPaths(loop, 'water', 0).chains, /Z/, 'closed loop is closed');
  const none = grid(['...']);
  assert.deepEqual(buildInfraPaths(none, 'water', 0), { chains: '', blocks: '' });
});
test('signature is stable for equal maps and changes for any edit', () => {
  assert.equal(grid(['W.', '.R']).signature, grid(['W.', '.R']).signature);
  assert.notEqual(grid(['W.', '.R']).signature, grid(['W.', '.D']).signature);
});
test('perf: 60x30 fully-populated map builds in well under a frame', () => {
  const art = Array.from({ length: 30 }, (_, r) => Array.from({ length: 60 }, (_, c) => ((r + c) % 7 === 0 || c % 5 === 0 ? 'W' : r % 4 === 0 ? 'R' : '.')).join(''));
  const t0 = performance.now();
  const g = grid(art);
  for (const [k, cap] of [['water', 22], ['road', 0], ['drainage', 0]] as const) buildInfraPaths(g, k, cap);
  const ms = performance.now() - t0;
  console.log(`      (${ms.toFixed(1)} ms)`);
  assert.ok(ms < 50);
});

console.log('Tree status: health and pruning stay independent');
const cases = [
  { name: 'healthy', d: { status: 'سليمة', disease: 'لا يوجد' }, tone: 'healthy' },
  { name: 'pruning only', d: { status: 'تحتاج تقليم', disease: 'لا يوجد' }, tone: 'prune' },
  { name: 'diseased (status)', d: { status: 'مصابة بآفة/مرض', disease: 'لا يوجد' }, tone: 'disease' },
  { name: 'diseased (disease recorded, status healthy)', d: { status: 'سليمة', disease: 'عفن هبابي' }, tone: 'disease' },
  { name: 'diseased + needs pruning (tree 12-B)', d: { status: 'تحتاج تقليم', disease: 'عفن هبابي' }, tone: 'prune-disease' },
  { name: 'status diseased + disease named', d: { status: 'مصابة بآفة/مرض', disease: 'تشوه زهري' }, tone: 'disease' },
];
for (const c of cases) {
  test(c.name + ' -> ' + c.tone, () => {
    const frozen = JSON.stringify(c.d);
    assert.equal(getTreeTone(getTreeHealthFlags(c.d)), c.tone);
    assert.equal(JSON.stringify(c.d), frozen, 'stored values untouched');
  });
}

console.log('Grafted / uprooted trees are black; labels; stored data untouched');
test('grafted and uprooted both resolve to the black tone but stay distinct kinds', () => {
  const grafted = { status: STATUS_GRAFTED, disease: 'لا يوجد' };
  const uprooted = { status: STATUS_UPROOTED, disease: 'لا يوجد' };
  assert.equal(getTreeTone(getTreeHealthFlags(grafted)), 'black');
  assert.equal(getTreeTone(getTreeHealthFlags(uprooted)), 'black');
  assert.equal(getRetiredKind(grafted.status), 'grafted');
  assert.equal(getRetiredKind(uprooted.status), 'uprooted');
  assert.notEqual(STATUS_GRAFTED, STATUS_UPROOTED, 'distinct stored values');
  assert.equal(TONE_COLORS.black, '#111111');
});
test('black wins over a recorded disease / pruning date, but those facts are still reported and not modified', () => {
  const d = { status: STATUS_GRAFTED, disease: 'عفن هبابي', pruneDate: '2025-01-02' } as Record<string, string>;
  const frozen = JSON.stringify(d);
  const flags = getTreeHealthFlags(d);
  assert.equal(getTreeTone(flags), 'black');
  assert.equal(flags.diseased, true, 'disease is still reported');
  assert.equal(JSON.stringify(d), frozen, 'record untouched');
});
test('all other statuses keep their existing tones', () => {
  assert.equal(getRetiredKind('سليمة'), null);
  assert.equal(getRetiredKind(STATUS_NEEDS_PRUNING), null);
  assert.equal(getRetiredKind('مصابة بآفة/مرض'), null);
  assert.equal(getRetiredKind(undefined), null);
  assert.equal(getTreeTone(getTreeHealthFlags({ status: 'سليمة', disease: 'لا يوجد' })), 'healthy');
  assert.equal(TONE_COLORS.healthy, '#059669');
  assert.equal(TONE_COLORS.prune, '#d97706');
  assert.equal(TONE_COLORS.disease, '#dc2626');
});
test('equivalent spellings already in saved data also render black (with/without diacritics)', () => {
  for (const v of ['مطعّمة', 'مطعمة', 'تم التطعيم']) assert.equal(getRetiredKind(v), 'grafted', v);
  for (const v of ['مقلوعة', 'مقلوع', 'تم القلع']) assert.equal(getRetiredKind(v), 'uprooted', v);
});
test('"تحتاج تقليم" is DISPLAYED as «ضعيفة» but the stored value is unchanged', () => {
  assert.equal(STATUS_NEEDS_PRUNING, 'تحتاج تقليم', 'stored identifier unchanged');
  assert.equal(statusLabel(STATUS_NEEDS_PRUNING), 'ضعيفة');
  assert.equal(statusLabel('سليمة'), 'سليمة');
  assert.equal(statusLabel('legacy-unknown'), 'legacy-unknown');
  assert.equal(statusLabel(undefined), '');
});

console.log('Variety accents');
test('every stored variety is mapped; unspecified has none; accents are pairwise distinct', () => {
  const stored = ['غير محدد', 'عويس', 'فونس', 'كيت', 'نعومي', 'زبدية', 'تيمور', 'جحراوي', 'أخرى']; // MANGO_VARIETIES in App.tsx
  assert.equal(getVarietyAccent('غير محدد'), null);
  assert.equal(getVarietyAccent(undefined), null);
  const colors = stored.filter((v) => v !== 'غير محدد').map((v) => getVarietyAccent(v));
  assert.ok(colors.every(Boolean));
  assert.equal(new Set(colors).size, colors.length, 'all accents distinct');
  assert.equal(getVarietyAccent('كحراوي'), getVarietyAccent('جحراوي'), 'Kahrawi spelling alias');
  assert.equal(getVarietyAccent('legacy-unknown'), getVarietyAccent('أخرى'));
  assert.equal(VARIETY_ACCENTS.length, 8);
});

console.log(`\n${passed} checks passed`);
