import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DiagramModel } from '../src/model.js';

const data = {
    type: 'metamodel',
    nodes: [
        { id: 'n1', type: 'start', x: 10, y: 20 },
        { id: 'n2', type: 'task', x: 100, y: 20, properties: { name: 'Review' } }
    ],
    edges: [{ id: 'e1', source: 'n1', target: 'n2' }]
};

/** start → task → end */
const chain = () => new DiagramModel({
    nodes: [
        { id: 'n1', type: 'start' },
        { id: 'n2', type: 'task' },
        { id: 'n3', type: 'end' }
    ],
    edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' }
    ]
});

/** Compact edge notation for assertions, e.g. ['n1>n2', 'n2>n3'] */
const links = model => model.edges.map(edge => `${edge.source}>${edge.target}`);

test('restores and serializes a model', () => {
    const model = new DiagramModel(data);
    const json = model.toJSON();
    assert.equal(json.nodes.length, 2);
    assert.equal(json.edges[0].target, 'n2');
    assert.deepEqual(json.nodes[0].properties, {});
    assert.equal(json.nodes[1].properties.name, 'Review');
});

test('toJSON returns a copy, not the internal state', () => {
    const model = new DiagramModel(data);
    model.toJSON().nodes[0].x = 999;
    assert.equal(model.getNode('n1').x, 10);
});

test('applyLayout stores positions and fires a layout event', () => {
    const model = new DiagramModel(data);
    let event = null;
    model.addEventListener('change', e => event = e);
    model.applyLayout(new Map([['n1', { x: 5, y: 6 }]]));
    assert.equal(model.getNode('n1').x, 5);
    assert.equal(model.getNode('n1').y, 6);
    assert.equal(model.getNode('n2').x, 100);
    assert.equal(event.detail.reason, 'layout');
});

test('insertOnEdge places a new node between source and target', () => {
    const model = chain();
    const node = model.insertOnEdge('e2', 'gateway');
    assert.equal(node.id, 'n4');
    assert.deepEqual(links(model), ['n1>n2', 'n2>n4', 'n4>n3']);
    assert.equal(model.insertOnEdge('e2', 'end'), null);
});

test('appendNode adds a successor, but not after an end node', () => {
    const model = new DiagramModel(data);
    const node = model.appendNode('n2', 'end');
    assert.equal(node.properties.name, 'End');
    assert.deepEqual(links(model), ['n1>n2', 'n2>n3']);
    assert.equal(model.appendNode('n3', 'task'), null);
});

test('addBranch adds a task with its own end to a gateway', () => {
    const model = chain();
    const gateway = model.insertOnEdge('e2', 'gateway');
    const task = model.addBranch(gateway.id);
    assert.equal(task.type, 'task');
    assert.equal(model.getOutgoing(gateway.id).length, 2);
    assert.equal(model.getNode(model.getOutgoing(task.id)[0].target).type, 'end');
    assert.equal(model.addBranch('n2'), null);
});

test('connect creates merges and loops but no duplicates', () => {
    const model = chain();
    const targets = model.getConnectTargets('n3').map(node => node.id);
    assert.deepEqual(targets, []);
    assert.deepEqual(model.getConnectTargets('n2').map(node => node.id), []);
    const task = model.insertOnEdge('e2', 'task');
    assert.ok(model.connect(task.id, 'n2'));
    assert.equal(model.connect(task.id, 'n2'), null);
    assert.equal(model.connect(task.id, 'n1'), null);
});

test('deleteNode bridges predecessor and successor', () => {
    const model = chain();
    assert.ok(model.deleteNode('n2'));
    assert.deepEqual(links(model), ['n1>n3']);
    assert.equal(model.getEdge('e1').target, 'n3');
});

test('start node and gateways with several branches cannot be deleted', () => {
    const model = chain();
    assert.equal(model.deleteNode('n1'), false);
    const gateway = model.insertOnEdge('e2', 'gateway');
    model.addBranch(gateway.id);
    assert.equal(model.canDeleteNode(gateway.id), false);
});

test('deleteNode does not create self loops or duplicate edges', () => {
    // n2 → n4 → n5 → n3 with loop n5 → n4: deleting n4 must not create n5 → n5
    const model = chain();
    const n4 = model.insertOnEdge('e2', 'task');
    const n5 = model.insertOnEdge(model.getOutgoing(n4.id)[0].id, 'task');
    model.connect(n5.id, n4.id);
    assert.ok(model.deleteNode(n4.id));
    assert.deepEqual(links(model), ['n1>n2', 'n2>n5', 'n5>n3']);
});

test('deleteEdge removes a whole branch', () => {
    const model = chain();
    const gateway = model.insertOnEdge('e2', 'gateway');
    const task = model.addBranch(gateway.id);
    const branch = model.getIncoming(task.id)[0];
    assert.equal(model.previewDeleteEdge(branch.id).length, 2);
    assert.equal(model.deleteEdge(branch.id).length, 2);
    assert.equal(model.nodes.length, 4);
    assert.equal(model.getOutgoing(gateway.id).length, 1);
});

test('deleteEdge keeps nodes that are still reachable', () => {
    const model = chain();
    const task = model.insertOnEdge('e2', 'task');
    const loop = model.connect(task.id, 'n2');
    assert.deepEqual(model.deleteEdge(loop.id), []);
    assert.equal(model.nodes.length, 4);
});

test('the only edge between two nodes cannot be deleted', () => {
    const model = chain();
    assert.equal(model.canDeleteEdge('e1'), false);
    assert.deepEqual(model.deleteEdge('e1'), []);
});

test('renameNode sets the name and fires a change event', () => {
    const model = chain();
    let event = null;
    model.addEventListener('change', e => event = e);
    model.renameNode('n2', 'Approve');
    assert.equal(model.getNode('n2').properties.name, 'Approve');
    assert.equal(event.detail.reason, 'rename');
});
