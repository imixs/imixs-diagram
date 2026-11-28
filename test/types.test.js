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
