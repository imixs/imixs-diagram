import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DiagramModel } from '../src/model.js';
import { newModel } from '../src/bpmn.js';

/** start → init event → task, the smallest model */
const minimal = () => new DiagramModel({
    nodes: [
        { id: 'n1', type: 'start' },
        { id: 'n2', type: 'event' },
        { id: 'n3', type: 'task' }
    ],
    edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' }
    ]
});

/** Compact notation of the model, e.g. ['start>event', 'event>task'] */
const shape = model => model.edges.map(edge =>
    `${model.getNode(edge.source).type}>${model.getNode(edge.target).type}`);

/** Ids of problems with the given severity */
const problems = (model, severity) =>
    model.validate().filter(problem => problem.severity === severity).map(problem => problem.id);

const assertNoErrors = model => assert.deepEqual(problems(model, 'error'), []);

test('restores and serializes a model with diagram properties', () => {
    const model = new DiagramModel({ properties: { name: 'Invoice' }, nodes: [{ id: 'n1', type: 'start', x: 10 }] });
    const json = model.toJSON();
    assert.equal(json.properties.name, 'Invoice');
    assert.deepEqual(json.nodes[0].properties, {});
    json.nodes[0].x = 999;
    assert.equal(model.getNode('n1').x, 10);
});

test('applyLayout stores positions and fires a layout event', () => {
    const model = minimal();
    let event = null;
    model.addEventListener('change', e => event = e);
    model.applyLayout(new Map([['n1', { x: 5, y: 6 }]]));
    assert.deepEqual({ x: model.getNode('n1').x, y: model.getNode('n1').y }, { x: 5, y: 6 });
    assert.equal(event.detail.reason, 'layout');
});

test('appendTask creates event and task', () => {
    const model = minimal();
    const task = model.appendTask('n3');
    assert.equal(task.type, 'task');
    assert.deepEqual(shape(model), ['start>event', 'event>task', 'task>event', 'event>task']);
    assertNoErrors(model);
});

test('appendTask on a task with successor inserts the new task', () => {
    const model = minimal();
    model.appendTask('n3');
    const task = model.appendTask('n3');
    assert.equal(model.getOutgoing('n3').length, 1);
    assert.equal(model.getNode(model.getOutgoing(task.id)[0].target).type, 'event');
    assertNoErrors(model);
});

test('appendTask after a final task moves the end', () => {
    const model = minimal();
    const end = model.appendEnd('n3');
    const task = model.appendTask('n3');
    assert.equal(model.getOutgoing(task.id)[0].target, end.id);
    assert.deepEqual(model.validate(), []);
});

test('appendEnd makes a task the final state, only once', () => {
    const model = minimal();
    assert.equal(model.appendEnd('n3').type, 'end');
    assert.equal(model.appendEnd('n3'), null);
    assert.deepEqual(model.validate(), []);
});

test('insertTask on any edge keeps the model free of errors', () => {
    for (const edgeId of ['e1', 'e2']) {
        const model = minimal();
        assert.ok(model.insertTask(edgeId), `insert on ${edgeId}`);
        assertNoErrors(model);
    }
});

test('addGateway after a task creates a gateway with a first event', () => {
    const model = minimal();
    const gateway = model.addGateway('n3');
    const event = model.getOutgoing(gateway.id)[0].target;
    assert.equal(model.getNode(event).type, 'event');
    assert.deepEqual(problems(model, 'incomplete'), [event]);
    assertNoErrors(model);
});

test('addGateway keeps the existing event as first branch', () => {
    const model = minimal();
    model.appendTask('n3');
    const event = model.getOutgoing('n3')[0].target;
    const gateway = model.addGateway('n3');
    assert.equal(model.getOutgoing(gateway.id)[0].target, event);
    assert.equal(model.addGateway('n3'), null);
    assertNoErrors(model);
});

test('gateway: add events first, connect them later', () => {
    const model = minimal();
    const gateway = model.addGateway('n3');
    const second = model.addEvent(gateway.id);
    assert.equal(model.getOutgoing(gateway.id).length, 2);
    assert.deepEqual(problems(model, 'incomplete').length, 2);
    // Two events of the same gateway may lead to the same task
    const [first] = model.getOutgoing(gateway.id).map(edge => edge.target);
    const target = model.appendTask(first);
    assert.ok(model.connect(second.id, target.id));
    assertNoErrors(model);
});

test('an event can lead back to its own task (no state change)', () => {
    const model = minimal();
    const gateway = model.addGateway('n3');
    const save = model.addEvent(gateway.id);
    assert.ok(model.getConnectTargets(save.id).some(node => node.id === 'n3'));
    assert.ok(model.connect(save.id, 'n3'));
    assertNoErrors(model);
});

test('a gateway after a task offers no conditional tasks', () => {
    const model = minimal();
    const gateway = model.addGateway('n3');
    assert.equal(model.canApply('addConditionalTask', gateway.id), false);
});

test('addConditionalGateway after a task creates event and empty conditional gateway', () => {
    const model = minimal();
    const gateway = model.addConditionalGateway('n3');
    assert.equal(model.getNode(model.getIncoming(gateway.id)[0].source).type, 'event');
    assert.deepEqual(problems(model, 'incomplete'), [gateway.id]);
    const task = model.addConditionalTask(gateway.id);
    const flow = model.getIncoming(task.id)[0];
    assert.ok(model.isConditionalFlow(flow.id));
    assert.equal(flow.properties.condition, '');
    assert.equal(model.addEvent(gateway.id), null);
    assertNoErrors(model);
});

test('addConditionalGateway after an event keeps its target as first branch', () => {
    const model = minimal();
    const gateway = model.addConditionalGateway('n2');
    assert.equal(model.getOutgoing(gateway.id)[0].target, 'n3');
    assertNoErrors(model);
});

test('connect from a task with successor is not allowed', () => {
    const model = minimal();
    model.appendTask('n3');
    assert.deepEqual(model.getConnectTargets('n3'), []);
});

test('deleting a task removes its event and bridges the flow', () => {
    const model = minimal();
    const middle = model.appendTask('n3');
    model.appendTask(middle.id);
    assert.ok(model.deleteNode(middle.id));
    assert.deepEqual(shape(model), ['start>event', 'event>task', 'task>event', 'event>task']);
    assertNoErrors(model);
});

test('deleting the last task leaves its event without target', () => {
    const model = minimal();
    const last = model.appendTask('n3');
    const event = model.getIncoming(last.id)[0].source;
    assert.ok(model.deleteNode(last.id));
    assert.deepEqual(problems(model, 'incomplete'), [event]);
    assertNoErrors(model);
});

test('an event can be deleted only if nothing behind it gets lost', () => {
    const model = minimal();
    const gateway = model.addGateway('n3');
    const event = model.addEvent(gateway.id);
    assert.ok(model.deleteNode(event.id));
    assert.equal(model.deleteNode('n2'), false);
});

test('start and gateways with several branches cannot be deleted', () => {
    const model = minimal();
    assert.equal(model.deleteNode('n1'), false);
    const gateway = model.addGateway('n3');
    model.addEvent(gateway.id);
    assert.equal(model.canDeleteNode(gateway.id), false);
});

test('a gateway with one branch is bridged when deleted', () => {
    const model = minimal();
    const gateway = model.addGateway('n3');
    assert.ok(model.deleteNode(gateway.id));
    assert.deepEqual(shape(model), ['start>event', 'event>task', 'task>event']);
    assertNoErrors(model);
});

test('deleteEdge removes a whole branch', () => {
    const model = minimal();
    const gateway = model.addGateway('n3');
    const event = model.addEvent(gateway.id);
    model.appendTask(event.id);
    const branch = model.getIncoming(event.id)[0];
    assert.equal(model.previewDeleteEdge(branch.id).length, 2);
    assert.equal(model.deleteEdge(branch.id).length, 2);
    assertNoErrors(model);
});

test('the init flow cannot be deleted', () => {
    const model = minimal();
    assert.equal(model.canDeleteEdge('e1'), false);
    assert.deepEqual(model.deleteEdge('e1'), []);
    assert.equal(model.nodes.length, 3);
});

test('a rejected operation leaves the model unchanged and fires no event', () => {
    const model = minimal();
    const before = model.toJSON();
    let fired = false;
    model.addEventListener('change', () => fired = true);
    assert.equal(model.deleteNode('n1'), false);
    assert.equal(model.appendEnd('n2'), null);
    assert.deepEqual(model.toJSON(), before);
    assert.equal(fired, false);
});

test('canApply does not change the model', () => {
    const model = minimal();
    const before = model.toJSON();
    assert.ok(model.canApply('appendTask', 'n3'));
    assert.deepEqual(model.toJSON(), before);
});

test('setProperty changes nodes, edges and the diagram itself', () => {
    const model = minimal();
    let event = null;
    model.addEventListener('change', e => event = e);
    model.setProperty('n3', 'name', 'Approve');
    assert.equal(model.getNode('n3').properties.name, 'Approve');
    assert.equal(event.detail.reason, 'properties');
    model.setProperty('e1', 'documentation', 'Init');
    assert.equal(model.getEdge('e1').properties.documentation, 'Init');
    model.setProperty(null, 'name', 'Invoice');
    assert.equal(model.toJSON().properties.name, 'Invoice');
});

test('tasks and events get stable Imixs numbers', () => {
    const model = minimal();
    assert.equal(model.getNode('n3').properties.processid, 100);
    assert.equal(model.getNode('n2').properties.activityid, 10);
    const task = model.appendTask('n3');
    const event = model.getIncoming(task.id)[0].source;
    assert.equal(task.properties.processid, 200);
    assert.equal(model.getNode(event).properties.activityid, 10);
    assert.equal(model.getNode('n3').properties.processid, 100);
});

test('undo and redo restore structure operations', () => {
    const model = minimal();
    const before = shape(model);
    assert.equal(model.canUndo(), false);
    model.appendTask('n3');
    const after = shape(model);
    const reasons = [];
    model.addEventListener('change', e => reasons.push(e.detail.reason));
    assert.equal(model.undo(), true);
    assert.deepEqual(shape(model), before);
    assert.equal(model.canRedo(), true);
    assert.equal(model.redo(), true);
    assert.deepEqual(shape(model), after);
    assert.deepEqual(reasons, ['undo', 'redo']);
    assert.equal(model.redo(), false);
});

test('rejected operations and dry runs are no undo steps', () => {
    const model = minimal();
    model.canApply('appendTask', 'n3');
    assert.equal(model.deleteNode('n1'), false);
    assert.equal(model.canUndo(), false);
});

test('typing into one property is one undo step', () => {
    const model = minimal();
    model.setProperty('n3', 'name', 'A');
    model.setProperty('n3', 'name', 'Ap');
    model.setProperty('n3', 'name', 'Approve');
    model.setProperty(null, 'name', 'Invoice');
    model.undo();
    assert.equal(model.properties.name, undefined);
    assert.equal(model.getNode('n3').properties.name, 'Approve');
    model.undo();
    assert.equal(model.getNode('n3').properties.name, undefined);
    assert.equal(model.canUndo(), false);
});

test('a new change discards the redo steps', () => {
    const model = minimal();
    model.appendTask('n3');
    model.undo();
    model.appendEnd('n3');
    assert.equal(model.canRedo(), false);
});

test('getBranchEdge finds the flow that starts a gateway branch', () => {
    const model = minimal();
    const gateway = model.addGateway('n3');
    const event = model.addEvent(gateway.id);
    const task = model.appendTask(event.id);
    const branch = model.getBranchEdge(event.id);
    assert.equal(branch.source, gateway.id);
    assert.equal(model.getBranchEdge(task.id), null);
    assert.equal(model.getBranchEdge('n2'), null);
    assert.deepEqual(model.deleteEdge(branch.id).sort(), [event.id, task.id].sort());
    assertNoErrors(model);
});

test('a conditional branch is deleted from its task', () => {
    const model = minimal();
    const gateway = model.addConditionalGateway('n3');
    const task = model.addConditionalTask(gateway.id);
    const branch = model.getBranchEdge(task.id);
    assert.ok(branch);
    model.deleteEdge(branch.id);
    assert.equal(model.getNode(gateway.id) !== undefined, true);
    assertNoErrors(model);
});

test('changes of list or flag properties are an undo step each', () => {
    const model = minimal();
    model.setProperty('n2', 'messages', ['Offer:create']);
    model.setProperty('n2', 'messages', ['Offer:create', 'Order:create']);
    model.undo();
    assert.deepEqual(model.getNode('n2').properties.messages, ['Offer:create']);
});

test('an unknown diagram type is rejected', () => {
    assert.throws(() => new DiagramModel({ type: 'flowchart' }), /Unknown diagram type/);
});

test('operations of another diagram type do not apply', () => {
    const meta = new DiagramModel(newModel());
    const start = meta.nodes.find(node => node.type === 'start');
    assert.equal(meta.canApply('addChild', start.id), false);
    assert.equal(meta.addChild(start.id), null);

    const chart = new DiagramModel({ type: 'orgchart', nodes: [{ id: 'n1', type: 'unit', properties: {} }] });
    assert.equal(chart.canApply('appendTask', 'n1'), false);
    assert.equal(chart.addChild('n1').properties.name, 'New Unit');
    assert.equal(chart.getNode('n1').properties.processid, undefined);
});
