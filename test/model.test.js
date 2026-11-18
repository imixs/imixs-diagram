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

test('moveNode updates the position and fires a change event', () => {
    const model = new DiagramModel(data);
    let event = null;
    model.addEventListener('change', e => event = e);
    model.moveNode('n1', 50.4, -30);
    assert.equal(model.getNode('n1').x, 50);
    assert.equal(model.getNode('n1').y, 0);
    assert.equal(event.detail.reason, 'move');
});
