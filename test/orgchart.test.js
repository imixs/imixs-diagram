import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DiagramModel } from '../src/model.js';
import { newOrgChart, newSkillMap, validateTree } from '../src/tree.js';

/** root → (a → (a1, a2), b) */
const sample = () => {
    const model = new DiagramModel(newOrgChart());
    const a = model.addChild('n1');
    const b = model.addChild('n1');
    model.addChild(a.id);
    model.addChild(a.id);
    return { model, a, b };
};

/** Rule errors of the model */
const errors = model => model.validate().filter(problem => problem.severity === 'error');

/** Children of a unit in layout order */
const children = (model, id) => model.getOutgoing(id).map(edge => edge.target);

test('a new org chart has exactly one root', () => {
    const model = new DiagramModel(newOrgChart());
    assert.equal(model.nodes.length, 1);
    assert.deepEqual(model.validate(), []);
});

test('addChild adds units below a unit', () => {
    const { model, a, b } = sample();
    assert.deepEqual(children(model, 'n1'), [a.id, b.id]);
    assert.equal(children(model, a.id).length, 2);
    assert.equal(a.properties.name, 'New Unit');
    assert.deepEqual(errors(model), []);
});

test('addSibling places the new unit right after the given one', () => {
    const { model, a, b } = sample();
    const sibling = model.addSibling(a.id);
    assert.deepEqual(children(model, 'n1'), [a.id, sibling.id, b.id]);
    assert.equal(model.addSibling('n1'), null, 'the root has no siblings');
});

test('deleting a unit moves its children up to its place', () => {
    const { model, a, b } = sample();
    const [a1, a2] = children(model, a.id);
    assert.ok(model.deleteNode(a.id));
    assert.deepEqual(children(model, 'n1'), [a1, a2, b.id]);
    assert.deepEqual(errors(model), []);
});

test('the root cannot be deleted', () => {
    const { model } = sample();
    assert.equal(model.canDeleteNode('n1'), false);
    assert.equal(model.canApply('deleteSubtree', 'n1'), false);
    const single = new DiagramModel(newOrgChart());
    assert.equal(single.deleteNode('n1'), false);
});

test('deleteSubtree removes a unit with all descendants', () => {
    const { model, a, b } = sample();
    assert.equal(model.previewDeleteSubtree(a.id).length, 3);
    assert.equal(model.deleteSubtree(a.id).length, 3);
    assert.deepEqual(model.nodes.map(node => node.id), ['n1', b.id]);
    assert.deepEqual(errors(model), []);
});

test('meta model operations are not available in an org chart', () => {
    const { model, a } = sample();
    assert.equal(model.canApply('appendTask', a.id), false);
    assert.equal(model.canApply('insertTask', model.getIncoming(a.id)[0].id), false);
    assert.equal(model.canDeleteEdge(model.getIncoming(a.id)[0].id), false);
});

test('org charts get no Imixs numbers', () => {
    const { model, a } = sample();
    assert.equal(a.properties.processid, undefined);
});

test('validateTree finds several roots, several parents and cycles', () => {
    const unit = id => ({ id, type: 'unit' });
    const edge = (source, target) => ({ id: `${source}-${target}`, source, target });
    const ids = problems => problems.map(problem => problem.id);
    assert.ok(validateTree([unit('a'), unit('b')], []).some(p => p.message.includes('exactly one root')));
    assert.ok(ids(validateTree([unit('r'), unit('a'), unit('b')],
        [edge('r', 'a'), edge('r', 'b'), edge('a', 'b')])).includes('b'));
    assert.ok(ids(validateTree([unit('r'), unit('a'), unit('b')],
        [edge('a', 'b'), edge('b', 'a')])).includes('a'));
});

test('a skill map uses the same tree operations with skills', () => {
    const model = new DiagramModel(newSkillMap());
    const ml = model.addChild('n1');
    const nlp = model.addSibling(ml.id);
    model.addChild(ml.id);
    assert.equal(ml.type, 'skill');
    assert.equal(nlp.properties.name, 'New Skill');
    assert.deepEqual(model.validate(), []);
    assert.equal(model.canDeleteNode('n1'), false);
    assert.equal(model.deleteSubtree(ml.id).length, 2);
});
