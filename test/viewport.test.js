import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampScale, fitToView, toDiagram, toScreen, zoomAt, MIN_SCALE, MAX_SCALE } from '../src/viewport.js';

test('toScreen and toDiagram are inverse transforms', () => {
    const view = { x: 30, y: -20, scale: 2 };
    assert.deepEqual(toScreen(view, { x: 10, y: 10 }), { x: 50, y: 0 });
    assert.deepEqual(toDiagram(view, { x: 50, y: 0 }), { x: 10, y: 10 });
});

test('zoomAt keeps the diagram point under the mouse in place', () => {
    const view = { x: 10, y: 20, scale: 1 };
    const mouse = { x: 200, y: 100 };
    const before = toDiagram(view, mouse);
    const zoomed = zoomAt(view, 2, mouse);
    assert.equal(zoomed.scale, 2);
    assert.deepEqual(toDiagram(zoomed, mouse), before);
});

test('zoom factor is limited', () => {
    assert.equal(clampScale(100), MAX_SCALE);
    assert.equal(clampScale(0.01), MIN_SCALE);
    assert.equal(zoomAt({ x: 0, y: 0, scale: 1 }, 10, { x: 0, y: 0 }).scale, MAX_SCALE);
});

test('fitToView shrinks a large diagram and centers it', () => {
    const view = fitToView({ width: 1000, height: 400 }, { width: 500, height: 400 });
    assert.equal(view.scale, 0.5);
    assert.deepEqual({ x: view.x, y: view.y }, { x: 0, y: 100 });
});

test('fitToView never enlarges a small diagram', () => {
    const view = fitToView({ width: 200, height: 100 }, { width: 600, height: 300 });
    assert.deepEqual(view, { x: 200, y: 100, scale: 1 });
});
