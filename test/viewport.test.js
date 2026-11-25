import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampScale, fitToView, fitRect, interpolateView, placePanel, toDiagram, toScreen, zoomAt, MIN_SCALE, MAX_SCALE } from '../src/viewport.js';

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

test('fitRect centers a rectangle and fills the host', () => {
    const view = fitRect({ x: 100, y: 100, width: 200, height: 200 }, { width: 800, height: 400 }, 1);
    assert.equal(view.scale, 2);
    assert.deepEqual(toScreen(view, { x: 200, y: 200 }), { x: 400, y: 200 });
});

test('interpolateView starts and ends at the given views', () => {
    const host = { width: 800, height: 400 };
    const from = { x: 0, y: 0, scale: 1 };
    const to = fitRect({ x: 100, y: 100, width: 50, height: 50 }, host);
    const start = interpolateView(from, to, 0, host);
    const end = interpolateView(from, to, 1, host);
    assert.ok(Math.abs(start.x) < 1e-9 && Math.abs(start.scale - 1) < 1e-9);
    assert.ok(Math.abs(end.x - to.x) < 1e-6 && Math.abs(end.scale - to.scale) < 1e-9);
});

test('placePanel puts the panel right of the anchor with a connector', () => {
    const anchor = { x: 100, y: 200, width: 36, height: 36 };
    const place = placePanel(anchor, { width: 360, height: 300 }, { width: 1200, height: 800 });
    assert.deepEqual(place, { x: 176, y: 194, link: { x1: 136, x2: 176, y: 218 } });
});

test('placePanel uses the left side if the right side has no room', () => {
    const anchor = { x: 1000, y: 100, width: 110, height: 50 };
    const place = placePanel(anchor, { width: 360, height: 300 }, { width: 1200, height: 800 });
    assert.equal(place.x, 600);
    assert.deepEqual(place.link, { x1: 960, x2: 1000, y: 125 });
});

test('placePanel keeps the panel inside the host and puts diagram properties top right', () => {
    const anchor = { x: 100, y: 700, width: 36, height: 36 };
    assert.equal(placePanel(anchor, { width: 360, height: 300 }, { width: 1200, height: 800 }).y, 488);
    assert.deepEqual(placePanel(null, { width: 360, height: 300 }, { width: 1200, height: 800 }),
        { x: 828, y: 12, link: null });
});
