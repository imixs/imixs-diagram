import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRoute, computeArcRoute, computeBranchRoute, toRoundedPath } from '../src/router.js';

const box = (x, y, width = 100, height = 50) => ({ x, y, width, height });

test('aligned nodes get a straight horizontal edge', () => {
    const route = computeRoute(box(0, 0), box(200, 0));
    assert.deepEqual(route, [{ x: 100, y: 25 }, { x: 200, y: 25 }]);
});

test('horizontal Z-shape when nodes are side by side', () => {
    const route = computeRoute(box(0, 0), box(200, 100));
    assert.deepEqual(route, [
        { x: 100, y: 25 }, { x: 150, y: 25 }, { x: 150, y: 125 }, { x: 200, y: 125 }
    ]);
});

test('vertical Z-shape when nodes are stacked', () => {
    const route = computeRoute(box(0, 0), box(150, 200));
    assert.deepEqual(route, [
        { x: 50, y: 50 }, { x: 50, y: 125 }, { x: 200, y: 125 }, { x: 200, y: 200 }
    ]);
});

test('edge to the left leaves the source on its left side', () => {
    const route = computeRoute(box(300, 0), box(0, 0));
    assert.deepEqual(route, [{ x: 300, y: 25 }, { x: 100, y: 25 }]);
});

test('slightly offset nodes get a straight edge instead of a small jog', () => {
    const route = computeRoute(box(0, 0), box(200, 12));
    assert.equal(route.length, 2);
    assert.equal(route[0].y, route[1].y);
});

test('straight edge from a circle attaches at the circle center height', () => {
    const circle = { x: 0, y: 20, width: 40, height: 40, shape: 'circle' };
    const route = computeRoute(circle, box(200, 0, 120, 60));
    assert.deepEqual(route, [{ x: 40, y: 40 }, { x: 200, y: 40 }]);
});

test('stacked nodes with a common width get a straight vertical edge', () => {
    const route = computeRoute(box(0, 0), box(40, 200));
    assert.equal(route.length, 2);
    assert.equal(route[0].x, route[1].x);
});

test('L-shape when nodes are too close for a Z-shape', () => {
    const route = computeRoute(box(0, 0), box(110, 60));
    assert.deepEqual(route, [{ x: 100, y: 25 }, { x: 160, y: 25 }, { x: 160, y: 60 }]);
});

test('all route segments are orthogonal', () => {
    const route = computeRoute(box(13, 27), box(250, 340, 40, 40));
    for (let i = 1; i < route.length; i++) {
        const a = route[i - 1];
        const b = route[i];
        assert.ok(a.x === b.x || a.y === b.y, `segment ${i} is not orthogonal`);
    }
});

test('rounded path uses a curve per corner', () => {
    const d = toRoundedPath([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }], 8);
    assert.equal(d, 'M 0 0 L 42 0 Q 50 0 50 8 L 50 50');
});

test('straight edge to a diamond attaches at its corner', () => {
    const diamond = { x: 200, y: 5, width: 50, height: 50, shape: 'diamond' };
    const route = computeRoute(box(0, 0, 120, 60), diamond);
    assert.deepEqual(route, [{ x: 120, y: 30 }, { x: 200, y: 30 }]);
});

test('arc route of a loop in one row runs above both nodes', () => {
    const route = computeArcRoute(box(300, 100), box(0, 100));
    assert.deepEqual(route, [
        { x: 350, y: 100 }, { x: 350, y: 75 }, { x: 50, y: 75 }, { x: 50, y: 100 }
    ]);
});

test('arc route from a lower node runs below both nodes', () => {
    const route = computeArcRoute(box(300, 200), box(0, 100));
    assert.deepEqual(route, [
        { x: 350, y: 250 }, { x: 350, y: 275 }, { x: 50, y: 275 }, { x: 50, y: 150 }
    ]);
});

test('branch route leaves the gateway downwards and enters the target from the left', () => {
    const gateway = { x: 0, y: 0, width: 50, height: 50, shape: 'diamond' };
    const event = { x: 110, y: 150, width: 36, height: 36, shape: 'circle' };
    assert.deepEqual(computeBranchRoute(gateway, event), [
        { x: 25, y: 50 }, { x: 25, y: 168 }, { x: 110, y: 168 }
    ]);
});
