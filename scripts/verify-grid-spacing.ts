// Runtime spacing checks: the whole visual grid shares one active gap metric.
// Run with: node --experimental-strip-types scripts/verify-grid-spacing.ts
import assert from 'node:assert/strict';
import {
  applyGridGap, DEFAULT_GRID_GAP, GRID, MAX_GRID_GAP, MIN_GRID_GAP,
  buildKindGrid, buildInfraPaths, getInfrastructureScale, getOverlaySize,
} from '../src/farm/infrastructure.ts';
import { getGridOrigin } from '../src/farm/orientation.ts';
import { pixelToSlot, slotToPixel } from '../src/farm/landmarks.ts';

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('  ok  ' + name); };
const kinds = buildKindGrid({ 'أ-1': { type: 'road' }, 'أ-2': { type: 'road' }, 'أ-3': { type: 'road' } }, ['أ'], 3, {}, {});

try {
  test('spacing is clamped to safe runtime bounds', () => {
    assert.equal(applyGridGap(-200), MIN_GRID_GAP);
    assert.equal(applyGridGap(999), MAX_GRID_GAP);
    assert.equal(applyGridGap(Number.NaN), DEFAULT_GRID_GAP);
  });
  test('grid, overlay, and infrastructure geometry all resolve the active gap', () => {
    applyGridGap(MIN_GRID_GAP);
    const compact = getOverlaySize(4, 3);
    const compactOrigin = getGridOrigin('original');
    const compactPaths = buildInfraPaths(kinds, 'road', 0).chains;
    const compactSlot = slotToPixel({ x: 2, y: 1 });
    const compactScale = getInfrastructureScale();

    applyGridGap(MAX_GRID_GAP);
    const wide = getOverlaySize(4, 3);
    const wideOrigin = getGridOrigin('original');
    const widePaths = buildInfraPaths(kinds, 'road', 0).chains;
    const wideSlot = slotToPixel({ x: 2, y: 1 });
    const wideScale = getInfrastructureScale();

    assert.ok(wide.width > compact.width);
    assert.ok(wide.height > compact.height);
    assert.equal(wideOrigin.left - compactOrigin.left, MAX_GRID_GAP - MIN_GRID_GAP);
    assert.notEqual(widePaths, compactPaths);
    assert.ok(wideSlot.x > compactSlot.x);
    assert.ok(wideScale > compactScale);
    assert.deepEqual(pixelToSlot(wideSlot.x, wideSlot.y, 2, 3), { x: 2, y: 1 });
  });
  test('resetting to default restores legacy layout metrics', () => {
    applyGridGap(DEFAULT_GRID_GAP);
    assert.equal(GRID.gap, DEFAULT_GRID_GAP);
    assert.deepEqual(getOverlaySize(1, 1), { width: GRID.cellW, height: GRID.cellH });
    assert.equal(getGridOrigin('original').left, GRID.pad + GRID.labelColW + DEFAULT_GRID_GAP);
  });
} finally {
  applyGridGap(DEFAULT_GRID_GAP);
}
console.log(`\n${passed} grid spacing checks passed`);
