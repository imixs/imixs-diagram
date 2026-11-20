import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTreeLayout } from '../src/tree.js';
import { computeTreeRoute } from '../src/router.js';

const node = id => ({ id, type: 'unit' });
const edge = (source, target) => ({ id: `${source}-${target}`, source, target });
const layout = (nodes, edges, sizes = {}) =>
    computeTreeLayout(nodes, edges, id => sizes[id] || { width: 160, height: 56 });
const center = (position, width = 160) => position.x + width / 2;

test('children are placed in one row below their parent', () => {
    const result = layout([node('r'), node('a'), node('b')], [edge('r', 'a'), edge('r', 'b')]);
    const [r, a, b] = ['r', 'a', 'b'].map(id => result.positions.get(id));
    assert.ok(a.y > r.y);
    assert.equal(a.y, b.y);
    assert.ok(a.x + 160 < b.x, 'siblings do not overlap');
    assert.equal(result.routing, 'tree');
});

test('a parent is centered above its children', () => {
    const result = layout([node('r'), node('a'), node('b'), node('c')],
        [edge('r', 'a'), edge('r', 'b'), edge('r', 'c')]);
    const [r, a, c] = ['r', 'a', 'c'].map(id => result.positions.get(id));
    assert.equal(center(r), (center(a) + center(c)) / 2);
});

test('subtrees get the width they need and never overlap', () => {
    // r → a → (a1, a2, a3), r → b
    const nodes = ['r', 'a', 'b', 'a1', 'a2', 'a3'].map(node);
    const edges = [edge('r', 'a'), edge('r', 'b'), edge('a', 'a1'), edge('a', 'a2'), edge('a', 'a3')];
    const result = layout(nodes, edges);
    const a3 = result.positions.get('a3');
    const b = result.positions.get('b');
    assert.ok(b.x >= a3.x + 160, 'b is right of the whole subtree of a');
    const keys = [...result.positions.values()].map(p => `${p.x}/${p.y}`);
    assert.equal(new Set(keys).size, keys.length);
});

test('nodes of one level are top-aligned, even with different heights', () => {
    const result = layout([node('r'), node('a'), node('b')], [edge('r', 'a'), edge('r', 'b')],
        { a: { width: 160, height: 80 } });
    assert.equal(result.positions.get('a').y, result.positions.get('b').y);
});

test('cycles in invalid data do not break the layout', () => {
    const result = layout([node('a'), node('b')], [edge('a', 'b'), edge('b', 'a')]);
    assert.equal(result.positions.size, 2);
});

test('tree edges of siblings share one horizontal line', () => {
    const parent = { x: 100, y: 0, width: 160, height: 56 };
    const left = computeTreeRoute(parent, { x: 0, y: 116, width: 160, height: 56 });
    const right = computeTreeRoute(parent, { x: 200, y: 116, width: 160, height: 56 });
    assert.deepEqual(left, [{ x: 180, y: 56 }, { x: 180, y: 86 }, { x: 80, y: 86 }, { x: 80, y: 116 }]);
    assert.equal(right[1].y, left[1].y);
});

test('a single child directly below gets a straight edge', () => {
    const route = computeTreeRoute({ x: 0, y: 0, width: 160, height: 56 }, { x: 0, y: 116, width: 160, height: 56 });
    assert.deepEqual(route, [{ x: 80, y: 56 }, { x: 80, y: 116 }]);
});
