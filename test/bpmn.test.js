import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toBPMN, fromBPMN, newModel, EXPORTER } from '../src/bpmn.js';
import { parseXML, childElements, attribute, textContent, localName } from '../src/xml.js';
import { DiagramModel } from '../src/model.js';

/** New model with a gateway, a conditional event and documentation */
const sampleModel = () => {
    const model = new DiagramModel(newModel());
    model.setProperty(null, 'documentation', 'Approval <process> & more');
    const gateway = model.addGateway('n3');
    const submit = model.getOutgoing(gateway.id)[0].target;
    model.setProperty(submit, 'name', 'Submit');
    const review = model.appendTask(submit);
    const decide = model.addConditionalGateway(review.id);
    const approved = model.addConditionalTask(decide.id);
    model.setProperty(model.getIncoming(approved.id)[0].id, 'condition', 'approved == true');
    model.connect(decide.id, 'n3');
    return model;
};

/** Model without layout positions, for comparisons */
const withoutPositions = json => ({
    ...json,
    nodes: json.nodes.map(({ x, y, ...node }) => node)
});

test('export writes the exporter and the Imixs configuration', () => {
    const root = parseXML(toBPMN(new DiagramModel(newModel()).toJSON()));
    assert.equal(localName(root.name), 'definitions');
    assert.equal(attribute(root, 'exporter'), EXPORTER);
    const items = childElements(childElements(root, 'extensionElements')[0], 'item');
    const names = items.map(item => attribute(item, 'name'));
    assert.deepEqual(names, ['txtworkflowmodelversion', 'txtplugins', 'txtfieldmapping']);
    assert.equal(childElements(items[1], 'value').length, 9);
});

test('export maps node types to BPMN elements with Imixs ids', () => {
    const root = parseXML(toBPMN(new DiagramModel(newModel()).toJSON()));
    const process = childElements(root, 'process')[0];
    const names = childElements(process).map(child => localName(child.name));
    assert.deepEqual(names, ['documentation', 'startEvent', 'intermediateCatchEvent', 'task', 'endEvent',
        'sequenceFlow', 'sequenceFlow', 'sequenceFlow']);
    assert.equal(attribute(childElements(process, 'task')[0], 'processid'), '100');
    assert.equal(attribute(childElements(process, 'intermediateCatchEvent')[0], 'activityid'), '10');
    const task = childElements(process, 'task')[0];
    assert.equal(textContent(childElements(task, 'incoming')[0]), 'e2');
    assert.equal(textContent(childElements(task, 'outgoing')[0]), 'e3');
});

test('conditional flows get a condition expression', () => {
    const root = parseXML(toBPMN(sampleModel().toJSON()));
    const process = childElements(root, 'process')[0];
    const conditions = childElements(process, 'sequenceFlow')
        .flatMap(flow => childElements(flow, 'conditionExpression'))
        .map(textContent);
    // The existing target becomes the first conditional branch, then the new task and the loop
    assert.deepEqual(conditions, ['', 'approved == true', '']);
});

test('export generates diagram interchange for every element', () => {
    const model = sampleModel();
    const root = parseXML(toBPMN(model.toJSON()));
    const plane = childElements(childElements(root, 'BPMNDiagram')[0], 'BPMNPlane')[0];
    assert.equal(childElements(plane, 'BPMNShape').length, model.nodes.length);
    assert.equal(childElements(plane, 'BPMNEdge').length, model.edges.length);
    const edge = childElements(plane, 'BPMNEdge')[0];
    assert.ok(childElements(edge, 'waypoint').length >= 2);
});

test('import of an exported model restores the model', () => {
    const model = sampleModel();
    const restored = fromBPMN(toBPMN(model.toJSON()));
    assert.deepEqual(withoutPositions(restored), withoutPositions(model.toJSON()));
});

test('models from other modelers are rejected', () => {
    const openBpmn = readFileSync(new URL('../bpmn/imixs.bpmn', import.meta.url), 'utf8');
    assert.throws(() => fromBPMN(openBpmn), /not created by Imixs-Diagram \(exporter: org.openbpmn\)/);
    assert.throws(() => fromBPMN('<root/>'), /not a BPMN 2.0 model/);
});

test('unsupported BPMN elements are rejected', () => {
    const xml = toBPMN(new DiagramModel(newModel()).toJSON())
        .replace('<bpmn2:endEvent', '<bpmn2:parallelGateway id="x"/><bpmn2:endEvent');
    assert.throws(() => fromBPMN(xml), /'parallelGateway' is not supported/);
});

/** An exported model, changed the way Open-BPMN would change it */
const editedInOpenBPMN = () => {
    const replace = (xml, search, replacement) => {
        assert.ok(xml.includes(search), `fixture: '${search}' not found`);
        return xml.replace(search, replacement);
    };
    let xml = toBPMN(new DiagramModel(newModel()).toJSON());
    xml = replace(xml, 'targetNamespace="http://www.imixs.org/bpmn2">',
        'targetNamespace="http://www.imixs.org/bpmn2" xmlns:open-bpmn="http://open-bpmn.org/XMLSchema">');
    xml = replace(xml, '<bpmn2:extensionElements>',
        '<bpmn2:extensionElements><imixs:item name="txtcustom" type="xs:string"><imixs:value><![CDATA[custom]]></imixs:value></imixs:item>');
    xml = replace(xml, '<bpmn2:process id="process_1"',
        '<bpmn2:message id="message_1" name="Mail"><bpmn2:documentation><![CDATA[Hello <b>World</b>]]></bpmn2:documentation></bpmn2:message>' +
        '<bpmn2:process isExecutable="false" id="process_1"');
    xml = replace(xml, '<bpmn2:documentation id="documentation_process_1"/>',
        '<bpmn2:documentation id="documentation_process_1"/><bpmn2:extensionElements><open-bpmn:auto-align>true</open-bpmn:auto-align></bpmn2:extensionElements>');
    xml = replace(xml, '<bpmn2:documentation id="documentation_n2"/>',
        '<bpmn2:documentation id="documentation_n2"/><bpmn2:extensionElements>' +
        '<imixs:item name="keymailenabled" type="xs:string"><imixs:value><![CDATA[1]]></imixs:value></imixs:item>' +
        '</bpmn2:extensionElements>');
    xml = replace(xml, '<bpmn2:outgoing>e2</bpmn2:outgoing>',
        '<bpmn2:outgoing>e2</bpmn2:outgoing><bpmn2:messageEventDefinition id="definition_1" messageRef="message_1"/>');
    xml = replace(xml, 'id="n3" name="Task"', 'id="n3" name="Task" open-bpmn:color="#ff0000"');
    return xml;
};

test('content edited in Open-BPMN is passed through unchanged', () => {
    const json = fromBPMN(editedInOpenBPMN());
    const root = parseXML(toBPMN(json));
    const process = childElements(root, 'process')[0];

    assert.equal(attribute(root, 'open-bpmn'), 'http://open-bpmn.org/XMLSchema');
    const items = childElements(childElements(root, 'extensionElements')[0], 'item').map(item => attribute(item, 'name'));
    assert.deepEqual(items, ['txtworkflowmodelversion', 'txtplugins', 'txtfieldmapping', 'txtcustom']);
    const message = childElements(root, 'message')[0];
    assert.equal(textContent(childElements(message, 'documentation')[0]), 'Hello <b>World</b>');

    assert.equal(attribute(process, 'isExecutable'), 'false');
    assert.equal(textContent(childElements(childElements(process, 'extensionElements')[0], 'auto-align')[0]), 'true');

    const event = childElements(process, 'intermediateCatchEvent')[0];
    const eventItem = childElements(childElements(event, 'extensionElements')[0], 'item')[0];
    assert.equal(attribute(eventItem, 'name'), 'keymailenabled');
    assert.equal(attribute(childElements(event, 'messageEventDefinition')[0], 'messageRef'), 'message_1');
    // BPMN schema order: documentation, extensionElements, incoming/outgoing, event definitions
    assert.deepEqual(childElements(event).map(child => localName(child.name)),
        ['documentation', 'extensionElements', 'incoming', 'outgoing', 'messageEventDefinition']);

    assert.equal(attribute(childElements(process, 'task')[0], 'color'), '#ff0000');
});

test('passed through content survives editing and repeated saving', () => {
    const model = new DiagramModel(fromBPMN(editedInOpenBPMN()));
    model.appendTask('n3');
    model.setProperty('n2', 'name', 'Create Request');
    const once = toBPMN(model.toJSON());
    const twice = toBPMN(fromBPMN(once));
    assert.equal(twice, once);
    assert.ok(once.includes('keymailenabled'));
});

test('several processes are rejected', () => {
    const xml = toBPMN(new DiagramModel(newModel()).toJSON())
        .replace('<bpmn2:process id="process_1"', '<bpmn2:process id="process_2"/><bpmn2:process id="process_1"');
    assert.throws(() => fromBPMN(xml), /several processes/);
});

test('message events: messages and the public flag become properties and are written back', () => {
    const json = fromBPMN(editedInOpenBPMN());
    // The message event definition of Open-BPMN refers to the message 'Mail'
    assert.deepEqual(json.nodes.find(node => node.id === 'n2').properties.messages, ['Mail']);

    const model = new DiagramModel(json);
    model.setProperty('n2', 'messages', ['Mail', 'Offer:Accepted']);
    model.setProperty('n2', 'public', false);
    const xml = toBPMN(model.toJSON());
    const root = parseXML(xml);

    // The loaded message is kept with its content, the new one is added
    const messages = childElements(root, 'message');
    assert.deepEqual(messages.map(m => [attribute(m, 'id'), attribute(m, 'name')]),
        [['message_1', 'Mail'], ['message_2', 'Offer:Accepted']]);
    assert.equal(textContent(childElements(messages[0], 'documentation')[0]), 'Hello <b>World</b>');

    const event = childElements(childElements(root, 'process')[0], 'intermediateCatchEvent')[0];
    assert.deepEqual(childElements(event, 'messageEventDefinition').map(d => attribute(d, 'messageRef')),
        ['message_1', 'message_2']);
    const items = childElements(childElements(event, 'extensionElements')[0], 'item');
    assert.deepEqual(items.map(item => attribute(item, 'name')), ['workflow.public', 'keymailenabled']);

    const properties = fromBPMN(xml).nodes.find(node => node.id === 'n2').properties;
    assert.deepEqual(properties.messages, ['Mail', 'Offer:Accepted']);
    assert.equal(properties.public, false);
    assert.equal(toBPMN(fromBPMN(xml)), xml);
});

test('public events and events without messages write nothing extra', () => {
    const xml = toBPMN(newModel());
    assert.ok(!xml.includes('bpmn2:message'));
    assert.ok(!xml.includes('workflow.public'));
});
