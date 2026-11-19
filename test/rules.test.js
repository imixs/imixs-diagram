import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/rules.js';

const node = (id, type) => ({ id, type });
const edge = (source, target) => ({ id: `${source}-${target}`, source, target });

/** Ids of problems with the given severity */
const ids = (problems, severity = 'error') =>
    problems.filter(problem => problem.severity === severity).map(problem => problem.id);

/** start → init event → task → end */
const minimal = () => ({
    nodes: [node('s', 'start'), node('e1', 'event'), node('t1', 'task'), node('end', 'end')],
    edges: [edge('s', 'e1'), edge('e1', 't1'), edge('t1', 'end')]
});

test('a minimal Imixs model is valid', () => {
    const { nodes, edges } = minimal();
    assert.deepEqual(validate(nodes, edges), []);
});

test('start must be followed by an event', () => {
    const errors = validate([node('s', 'start'), node('t1', 'task')], [edge('s', 't1')]);
    assert.ok(ids(errors).includes('s'));
});

test('a transition between two tasks needs an event', () => {
    const { nodes, edges } = minimal();
    nodes.push(node('t2', 'task'));
    edges.push(edge('t1', 't2'));
    const errors = validate(nodes, edges);
    assert.ok(ids(errors).includes('t1'));
    assert.ok(ids(errors).includes('t2'));
});

test('a task has at most one successor', () => {
    const { nodes, edges } = minimal();
    nodes.push(node('e2', 'event'));
    edges.push(edge('t1', 'e2'), edge('e2', 't1'));
    assert.ok(ids(validate(nodes, edges)).includes('t1'));
});

test('an event without state change leads back to the same task', () => {
    // t1 → gateway → [event → t2, event "save" → t1]
    const nodes = [node('s', 'start'), node('e1', 'event'), node('t1', 'task'), node('g', 'gateway'),
        node('e2', 'event'), node('t2', 'task'), node('save', 'event')];
    const edges = [edge('s', 'e1'), edge('e1', 't1'), edge('t1', 'g'),
        edge('g', 'e2'), edge('e2', 't2'), edge('g', 'save'), edge('save', 't1')];
    assert.deepEqual(ids(validate(nodes, edges)), []);
});

test('branches of a gateway after a task must be events', () => {
    const nodes = [node('s', 'start'), node('e1', 'event'), node('t1', 'task'), node('g', 'gateway'), node('t2', 'task')];
    const edges = [edge('s', 'e1'), edge('e1', 't1'), edge('t1', 'g'), edge('g', 't2')];
    assert.ok(ids(validate(nodes, edges)).includes('g'));
});

test('branches of a conditional gateway must be tasks', () => {
    const nodes = [node('s', 'start'), node('e1', 'event'), node('t1', 'task'), node('e2', 'event'),
        node('g', 'gateway'), node('t2', 'task'), node('e3', 'event')];
    const valid = [edge('s', 'e1'), edge('e1', 't1'), edge('t1', 'e2'), edge('e2', 'g'), edge('g', 't2')];
    assert.deepEqual(ids(validate(nodes.slice(0, 6), valid)), []);
    const errors = validate(nodes, [...valid, edge('g', 'e3'), edge('e3', 't2')]);
    assert.ok(ids(errors).includes('g'));
});

test('follow-up events are not allowed', () => {
    const { nodes, edges } = minimal();
    nodes.push(node('e2', 'event'));
    edges[1] = edge('e1', 'e2');
    edges.push(edge('e2', 't1'));
    assert.ok(ids(validate(nodes, edges)).includes('e1'));
});

test('an end must follow a task', () => {
    const nodes = [node('s', 'start'), node('e1', 'event'), node('end', 'end')];
    const errors = validate(nodes, [edge('s', 'e1'), edge('e1', 'end')]);
    assert.ok(ids(errors).includes('end'));
});

test('missing targets and branches are only incomplete', () => {
    // t1 → gateway → event without target
    const nodes = [node('s', 'start'), node('e1', 'event'), node('t1', 'task'), node('g', 'gateway'), node('e2', 'event')];
    const edges = [edge('s', 'e1'), edge('e1', 't1'), edge('t1', 'g'), edge('g', 'e2')];
    const problems = validate(nodes, edges);
    assert.deepEqual(ids(problems), []);
    assert.deepEqual(ids(problems, 'incomplete'), ['e2']);
    const empty = validate(nodes.slice(0, 4), edges.slice(0, 3));
    assert.deepEqual(ids(empty, 'incomplete'), ['g']);
});

test('a task without successor is incomplete', () => {
    const { nodes, edges } = minimal();
    const problems = validate(nodes.slice(0, 3), edges.slice(0, 2));
    assert.deepEqual(ids(problems), []);
    assert.deepEqual(ids(problems, 'incomplete'), ['t1']);
});

test('unreachable elements are reported', () => {
    const { nodes, edges } = minimal();
    nodes.push(node('t9', 'task'));
    assert.ok(ids(validate(nodes, edges)).includes('t9'));
});
