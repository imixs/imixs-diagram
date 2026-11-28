import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDiagramType } from '../src/types.js';
import { DiagramModel } from '../src/model.js';

test('the meta model is the default type', () => {
    assert.equal(getDiagramType(), getDiagramType('metamodel'));
});

test('an unknown type is rejected', () => {
    assert.throws(() => getDiagramType('flowchart'), /Unknown diagram type/);
});

test('every type creates a valid empty diagram of its own type', () => {
    for (const type of ['metamodel', 'orgchart', 'skillmap']) {
        const data = getDiagramType(type).create();
        assert.equal(data.type, type);
        const errors = new DiagramModel(data).validate().filter(problem => problem.severity === 'error');
        assert.deepEqual(errors, [], type);
    }
});

test('the node actions of a type are operations of the model', () => {
    for (const type of ['metamodel', 'orgchart', 'skillmap']) {
        for (const actions of Object.values(getDiagramType(type).editor.nodeActions)) {
            for (const [, , operation] of actions) {
                assert.equal(typeof DiagramModel.prototype[operation], 'function', `${type}: ${operation}`);
            }
        }
    }
});

test('the org chart panel shows the roles of a unit only', () => {
    const panel = getDiagramType('orgchart').panel;
    assert.deepEqual(Object.keys(panel.fields), ['node']);
    assert.equal(panel.caption({ id: 'n1', properties: { name: 'Sales' } }), 'Roles - Sales');
    assert.equal(panel.diagramProperties, false);
});

test('only the meta model can be exported as BPMN', () => {
    assert.equal(getDiagramType('metamodel').bpmn, true);
    assert.equal(getDiagramType('orgchart').bpmn, false);
    assert.equal(getDiagramType('skillmap').bpmn, false);
});

test('the skill map panel shows the path and the description of a skill, read-only', () => {
    const panel = getDiagramType('skillmap').panel;
    assert.equal(panel.anchored, false);
    const model = new DiagramModel({
        type: 'skillmap',
        nodes: [
            { id: 's1', type: 'skill', properties: { name: 'Skills' } },
            { id: 's2', type: 'skill', properties: { name: 'AI' } },
            { id: 's3', type: 'skill', properties: { name: 'RAG', description: 'Grounded answers' } }
        ],
        edges: [{ id: 'e1', source: 's1', target: 's2' }, { id: 'e2', source: 's2', target: 's3' }]
    });
    const [path, description] = panel.fields.node;
    assert.equal(path.value(model, model.getNode('s3')), 'Skills › AI');
    assert.equal(path.value(model, model.getNode('s1')), '');
    assert.equal(description.key, 'description');
    assert.ok(panel.fields.node.every(field => field.type === 'info'));
    assert.equal(panel.caption(model.getNode('s3')), 'Skill - RAG');
});
