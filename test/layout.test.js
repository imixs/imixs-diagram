import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout } from '../src/layout.js';

const SIZES = { start: [40, 40], end: [40, 40], gateway: [50, 50], task: [120, 60] };

const layout = (nodes, edges) => {
    const types = new Map(nodes.map(node => [node.id, node.type]));
    return computeLayout(nodes, edges, id => {
        const [width, height] = SIZES[types.get(id)];
        return { width, height };
    });
};

const node = (id, type) => ({ id, type });
const edge = (id, source, target) => ({ id, source, target });
const centerY = (result, id, height) => result.positions.get(id).y + height / 2;

test('a chain is placed in one row from left to right with aligned centers', () => {
    const result = layout(
        [node('n1', 'start'), node('n2', 'task'), node('n3', 'end')],
        [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')]);
    const p = id => result.positions.get(id);
    assert.ok(p('n1').x < p('n2').x && p('n2').x < p('n3').x);
    assert.equal(centerY(result, 'n1', 40), centerY(result, 'n2', 60));
    assert.equal(centerY(result, 'n3', 40), centerY(result, 'n2', 60));
    assert.equal(result.arcEdges.size, 0);
});

test('the second branch of a gateway opens a new row below', () => {
    const result = layout(
        [node('n1', 'start'), node('g', 'gateway'), node('a', 'task'), node('b', 'task')],
        [edge('e1', 'n1', 'g'), edge('e2', 'g', 'a'), edge('e3', 'g', 'b')]);
    const a = result.positions.get('a');
    const b = result.positions.get('b');
    assert.equal(a.x, b.x);
    assert.ok(b.y > a.y);
    assert.equal(centerY(result, 'a', 60), centerY(result, 'g', 50));
});

test('a merge node is placed right of all its predecessors', () => {
    // g → a → m and g → b → c → m
    const result = layout(
        [node('n1', 'start'), node('g', 'gateway'), node('a', 'task'),
            node('b', 'task'), node('c', 'task'), node('m', 'task')],
        [edge('e1', 'n1', 'g'), edge('e2', 'g', 'a'), edge('e3', 'a', 'm'),
            edge('e4', 'g', 'b'), edge('e5', 'b', 'c'), edge('e6', 'c', 'm')]);
    assert.ok(result.positions.get('m').x > result.positions.get('c').x);
    // a → m skips the column of c, but c lies in another row: a straight edge, no arc
    assert.equal(result.arcEdges.has('e3'), false);
});

test('loops are detected as back edges and do not move nodes to the right', () => {
    const result = layout(
        [node('n1', 'start'), node('a', 'task'), node('b', 'task')],
        [edge('e1', 'n1', 'a'), edge('e2', 'a', 'b'), edge('e3', 'b', 'a')]);
    assert.ok(result.arcEdges.has('e3'));
    assert.ok(result.positions.get('a').x < result.positions.get('b').x);
});

test('nodes never share a position', () => {
    const result = layout(
        [node('n1', 'start'), node('g', 'gateway'), node('a', 'task'), node('b', 'task'),
            node('g2', 'gateway'), node('c', 'task'), node('d', 'end')],
        [edge('e1', 'n1', 'g'), edge('e2', 'g', 'a'), edge('e3', 'g', 'b'),
            edge('e4', 'b', 'g2'), edge('e5', 'g2', 'c'), edge('e6', 'g2', 'd'), edge('e7', 'a', 'd')]);
    const keys = [...result.positions.values()].map(p => `${p.x}/${p.y}`);
    assert.equal(new Set(keys).size, keys.length);
});

test('width and height cover all nodes plus margin', () => {
    const result = layout([node('n1', 'start')], []);
    assert.deepEqual(result.positions.get('n1'), { x: 40, y: 40 });
    assert.equal(result.width, 120);
    assert.equal(result.height, 120);
});

test('gateway branches in lower rows of the next column are branch edges', () => {
    const result = layout(
        [node('n1', 'start'), node('g', 'gateway'), node('a', 'task'), node('b', 'task'), node('c', 'task'),
            node('d', 'task')],
        [edge('e1', 'n1', 'g'), edge('e2', 'g', 'a'), edge('e3', 'g', 'b'), edge('e4', 'g', 'c'),
            edge('e5', 'a', 'd'), edge('e6', 'g', 'd')]);
    // e2 stays in the row of the gateway, e6 skips a column
    assert.deepEqual([...result.branchEdges].sort(), ['e3', 'e4']);
});

test('a merge from a lower row into the next column is a merge edge', () => {
    // start → gateway → task t; second branch gateway → b → c → t (merges back)
    const result = layout(
        [node('n1', 'start'), node('g', 'gateway'), node('b', 'task'), node('c', 'start'), node('t', 'task')],
        [edge('e1', 'n1', 'g'), edge('e2', 'g', 't'), edge('e3', 'g', 'b'), edge('e4', 'b', 'c'),
            edge('e5', 'c', 't')]);
    assert.deepEqual([...result.mergeEdges], ['e5']);
});

test('a merge is no merge edge if a node lies in between in the target column', () => {
    // three branches of g; the third merges into t (row 0), but u (row 1) is in t's column
    const result = layout(
        [node('g', 'gateway'), node('a', 'task'), node('t', 'task'), node('b', 'task'), node('u', 'task'),
            node('c', 'task')],
        [edge('e1', 'g', 'a'), edge('e2', 'a', 't'), edge('e3', 'g', 'b'), edge('e4', 'b', 'u'),
            edge('e5', 'g', 'c'), edge('e6', 'c', 't')]);
    assert.equal(result.mergeEdges.has('e6'), false);
});

test('an edge in one row skipping only empty columns is no arc', () => {
    // g → t in row 0; t lies further right because of the branch g → b → c → t
    const result = layout(
        [node('g', 'gateway'), node('t', 'task'), node('b', 'task'), node('c', 'task')],
        [edge('e1', 'g', 't'), edge('e2', 'g', 'b'), edge('e3', 'b', 'c'), edge('e4', 'c', 't')]);
    assert.ok(result.positions.get('t').x > result.positions.get('c').x);
    assert.equal(result.arcEdges.has('e1'), false);
});
