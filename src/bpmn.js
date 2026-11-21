import { parseXML, serializeXML, element, localName, childElements, attribute, textContent } from './xml.js';
import { computeLayout } from './layout.js';
import { computeRoute, computeArcRoute, computeBranchRoute } from './router.js';

/**
 * BPMN 2.0 import and export of meta models, executable by the
 * Imixs-Workflow engine.
 *
 * Only files written by this exporter are accepted on import: a meta model
 * opened and saved in a full BPMN modeler (e.g. Open-BPMN) becomes a
 * technical model. The diagram interchange part (DI) is ignored on import,
 * the auto layout is applied instead. On export, DI is generated from the
 * auto layout with the default sizes of Open-BPMN, so the file can still be
 * viewed there.
 *
 * Pure functions, DOM-free.
 */

/** Value of the 'exporter' attribute that identifies meta models. */
export const EXPORTER = 'imixs.meta.diagram';

/** Version written to 'exporterVersion'. */
export const EXPORTER_VERSION = '0.0.1';

const NAMESPACES = {
    'xmlns:bpmn2': 'http://www.omg.org/spec/BPMN/20100524/MODEL',
    'xmlns:bpmndi': 'http://www.omg.org/spec/BPMN/20100524/DI',
    'xmlns:dc': 'http://www.omg.org/spec/DD/20100524/DC',
    'xmlns:di': 'http://www.omg.org/spec/DD/20100524/DI',
    'xmlns:imixs': 'http://www.imixs.org/bpmn2',
    'xmlns:xs': 'http://www.w3.org/2001/XMLSchema',
    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance'
};

const PROCESS_ID = 'process_1';

/** BPMN element per node type, and back. */
const BPMN_ELEMENTS = {
    start: 'startEvent',
    event: 'intermediateCatchEvent',
    task: 'task',
    gateway: 'exclusiveGateway',
    end: 'endEvent'
};
const NODE_TYPES = Object.fromEntries(Object.entries(BPMN_ELEMENTS).map(([type, name]) => [name, type]));

/** Model-level Imixs items and the diagram property they are stored in. */
const MODEL_ITEMS = {
    txtworkflowmodelversion: 'version',
    txtplugins: 'plugins',
    txtfieldmapping: 'fieldmapping'
};

/** Default sizes of Open-BPMN, used for the generated DI. */
const DI_SIZES = {
    start: { width: 36, height: 36, shape: 'circle' },
    event: { width: 36, height: 36, shape: 'circle' },
    end: { width: 36, height: 36, shape: 'circle' },
    gateway: { width: 50, height: 50, shape: 'diamond' },
    task: { width: 110, height: 50, shape: 'rect' }
};

/**
 * Returns the JSON model of a new meta model:
 * start → init event → task → end, with the default Imixs configuration.
 */
export function newModel() {
    return {
        type: 'metamodel',
        properties: {
            name: 'New Process',
            documentation: '',
            version: 'default-en-1.0',
            plugins: [
                'org.imixs.workflow.engine.plugins.RulePlugin',
                'org.imixs.workflow.engine.plugins.SplitAndJoinPlugin',
                'org.imixs.workflow.engine.plugins.OwnerPlugin',
                'org.imixs.workflow.engine.plugins.ApproverPlugin',
                'org.imixs.workflow.engine.plugins.HistoryPlugin',
                'org.imixs.workflow.engine.plugins.ApplicationPlugin',
                'org.imixs.workflow.engine.plugins.IntervalPlugin',
                'org.imixs.workflow.engine.plugins.MailPlugin',
                'org.imixs.workflow.engine.plugins.ResultPlugin'
            ],
            fieldmapping: ['Creator|$creator', 'Owner|$owner', 'Editor|$editor']
        },
        nodes: [
            { id: 'n1', type: 'start', x: 0, y: 0, properties: { name: 'Start' } },
            { id: 'n2', type: 'event', x: 0, y: 0, properties: { name: 'Create' } },
            { id: 'n3', type: 'task', x: 0, y: 0, properties: { name: 'Task' } },
            { id: 'n4', type: 'end', x: 0, y: 0, properties: { name: 'End' } }
        ],
        edges: [
            { id: 'e1', source: 'n1', target: 'n2', properties: {} },
            { id: 'e2', source: 'n2', target: 'n3', properties: {} },
            { id: 'e3', source: 'n3', target: 'n4', properties: {} }
        ]
    };
}

/**
 * Converts a JSON model into a BPMN 2.0 document.
 *
 * @param {{properties:object, nodes:object[], edges:object[]}} model - see DiagramModel.toJSON()
 * @returns {string} BPMN 2.0 XML
 */
export function toBPMN(model) {
    const properties = model.properties || {};
    const extras = properties.bpmn || {};
    const processId = extras.process?.id || PROCESS_ID;
    const typeOf = id => model.nodes.find(node => node.id === id)?.type;
    const isConditional = edge => typeOf(edge.source) === 'gateway' &&
        model.edges.some(e => e.target === edge.source && typeOf(e.source) === 'event');

    const items = Object.entries(MODEL_ITEMS)
        .filter(([, key]) => properties[key] !== undefined)
        .map(([name, key]) => element('imixs:item', { name, type: 'xs:string' },
            [].concat(properties[key]).map(value => element('imixs:value', {}, [{ cdata: String(value) }]))));

    const flowNodes = model.nodes.map(node => withExtras(`bpmn2:${BPMN_ELEMENTS[node.type]}`, {
        id: node.id,
        name: node.properties.name || null,
        'imixs:processid': node.type === 'task' ? node.properties.processid : null,
        'imixs:activityid': node.type === 'event' ? node.properties.activityid : null,
        gatewayDirection: node.type === 'gateway' ? 'Diverging' : null
    }, node, [
        ...model.edges.filter(edge => edge.target === node.id).map(edge => element('bpmn2:incoming', {}, [{ text: edge.id }])),
        ...model.edges.filter(edge => edge.source === node.id).map(edge => element('bpmn2:outgoing', {}, [{ text: edge.id }]))
    ]));

    const flows = model.edges.map(edge => withExtras('bpmn2:sequenceFlow', {
        id: edge.id,
        sourceRef: edge.source,
        targetRef: edge.target,
        name: edge.properties.name || null
    }, edge, isConditional(edge)
        ? [element('bpmn2:conditionExpression',
            { id: `expression_${edge.id}`, 'xsi:type': 'bpmn2:tFormalExpression' },
            [{ cdata: edge.properties.condition || '' }])]
        : []));

    const process = withExtras('bpmn2:process', { id: processId, name: properties.name || null, processType: 'Public' },
        { id: processId, properties: { documentation: properties.documentation, bpmn: extras.process } },
        [...flowNodes, ...flows]);

    const definitions = element('bpmn2:definitions', {
        ...NAMESPACES,
        ...extras.attributes,
        exporter: EXPORTER,
        exporterVersion: EXPORTER_VERSION,
        targetNamespace: 'http://www.imixs.org/bpmn2'
    }, [
        element('bpmn2:extensionElements', {}, [...items, ...(extras.extensions || [])]),
        ...(extras.elements || []),
        process,
        diagramInterchange(model, processId)
    ]);
    return serializeXML(definitions);
}

/**
 * Reads a BPMN 2.0 document written by toBPMN().
 *
 * Everything this module does not handle itself (unknown attributes,
 * extension elements such as imixs:items of an event, event definitions,
 * messages, further namespaces) is kept in `properties.bpmn` of the element
 * or the diagram and written back unchanged by toBPMN(). So a meta model
 * can be edited in Open-BPMN and in this editor alternately.
 *
 * @param {string} xml
 * @returns {{type:string, properties:object, nodes:object[], edges:object[]}} JSON model
 * @throws {Error} if the file is not a meta model written by this exporter
 */
export function fromBPMN(xml) {
    const root = parseXML(xml);
    if (localName(root.name) !== 'definitions') {
        throw new Error('The file is not a BPMN 2.0 model.');
    }
    const exporter = attribute(root, 'exporter');
    if (exporter !== EXPORTER) {
        throw new Error(`The BPMN model was not created by Imixs-Diagram (exporter: ${exporter || 'unknown'}). ` +
            'It is a technical model and can only be opened in a BPMN modeler such as Open-BPMN.');
    }
    const processes = childElements(root, 'process');
    if (processes.length !== 1) {
        throw new Error(processes.length === 0
            ? 'The BPMN model contains no process.'
            : 'The BPMN model contains several processes (pools), which a meta model does not support.');
    }
    const process = processes[0];

    // Model level: known Imixs items become properties, everything else is kept
    const properties = {};
    const extensions = [];
    for (const extension of childElements(root, 'extensionElements')) {
        for (const child of childElements(extension)) {
            const key = localName(child.name) === 'item' ? MODEL_ITEMS[attribute(child, 'name')] : undefined;
            if (key) {
                const values = childElements(child, 'value').map(textContent);
                properties[key] = key === 'version' ? values[0] || '' : values;
            } else {
                extensions.push(child);
            }
        }
    }
    Object.assign(properties, readProperties(process));
    const bpmn = {
        attributes: pick(root.attributes, key => !ROOT_ATTRIBUTES.includes(key)),
        extensions,
        elements: childElements(root).filter(child => !ROOT_CHILDREN.includes(localName(child.name))),
        process: compact({
            // Kept only if it differs, other elements (e.g. a collaboration) may refer to it
            id: attribute(process, 'id') !== PROCESS_ID ? attribute(process, 'id') : undefined,
            ...readExtras(process, PROCESS_ATTRIBUTES, [...ELEMENT_CHILDREN, 'sequenceFlow', ...Object.keys(NODE_TYPES)])
        })
    };
    const kept = compact(bpmn);
    if (kept) {
        properties.bpmn = kept;
    }

    const nodes = [];
    const edges = [];
    for (const child of childElements(process)) {
        const name = localName(child.name);
        if (name === 'sequenceFlow') {
            const edge = {
                id: attribute(child, 'id'),
                source: attribute(child, 'sourceRef'),
                target: attribute(child, 'targetRef'),
                properties: readProperties(child)
            };
            const condition = childElements(child, 'conditionExpression')[0];
            if (condition) {
                edge.properties.condition = textContent(condition);
            }
            edges.push(edge);
        } else if (NODE_TYPES[name]) {
            const node = { id: attribute(child, 'id'), type: NODE_TYPES[name], x: 0, y: 0, properties: readProperties(child) };
            for (const key of ['processid', 'activityid']) {
                const value = attribute(child, key);
                if (value !== undefined) {
                    node.properties[key] = Number(value);
                }
            }
            nodes.push(node);
        } else if (name !== 'documentation' && name !== 'extensionElements') {
            throw new Error(`The BPMN element '${name}' is not supported in a meta model.`);
        }
    }
    return { type: 'metamodel', properties, nodes, edges };
}

/** Attributes of flow nodes and sequence flows handled by this module (local names). */
const ELEMENT_ATTRIBUTES = ['id', 'name', 'sourceRef', 'targetRef', 'processid', 'activityid', 'gatewayDirection'];

/** Child elements of flow nodes and sequence flows handled by this module (local names). */
const ELEMENT_CHILDREN = ['documentation', 'extensionElements', 'incoming', 'outgoing', 'conditionExpression'];

/** Attributes of the process handled by this module (local names). */
const PROCESS_ATTRIBUTES = ['id', 'name', 'processType'];

/** Attributes of the definitions element written by this module. */
const ROOT_ATTRIBUTES = [...Object.keys(NAMESPACES), 'exporter', 'exporterVersion', 'targetNamespace'];

/** Child elements of the definitions element handled by this module (local names). */
const ROOT_CHILDREN = ['extensionElements', 'process', 'BPMNDiagram'];

/** Name, documentation and pass-through content of a flow node or sequence flow. */
function readProperties(el) {
    const properties = {};
    const name = attribute(el, 'name');
    if (name) {
        properties.name = name;
    }
    const documentation = childElements(el, 'documentation')[0];
    if (documentation && textContent(documentation)) {
        properties.documentation = textContent(documentation);
    }
    const extras = localName(el.name) === 'process' ? undefined : readExtras(el, ELEMENT_ATTRIBUTES, ELEMENT_CHILDREN);
    if (extras) {
        properties.bpmn = extras;
    }
    return properties;
}

/**
 * Returns what this module does not handle itself: unknown attributes, the
 * content of extensionElements and unknown child elements. Undefined if
 * there is nothing to keep.
 */
function readExtras(el, knownAttributes, knownChildren) {
    return compact({
        attributes: pick(el.attributes, key => !knownAttributes.includes(localName(key))),
        extensions: childElements(el, 'extensionElements').flatMap(extension => childElements(extension)),
        elements: childElements(el).filter(child => !knownChildren.includes(localName(child.name)))
    });
}

/**
 * Creates a BPMN element with documentation, the kept extension elements,
 * the given children and the kept unknown elements, in BPMN schema order.
 */
function withExtras(name, attributes, owner, children) {
    const extras = owner.properties.bpmn || {};
    const extensions = extras.extensions || [];
    return element(name, { ...attributes, ...extras.attributes }, [
        documentation(owner),
        ...(extensions.length > 0 ? [element('bpmn2:extensionElements', {}, extensions)] : []),
        ...children,
        ...(extras.elements || [])
    ]);
}

function documentation(owner) {
    const text = owner.properties.documentation;
    return element('bpmn2:documentation', { id: `documentation_${owner.id}` }, text ? [{ cdata: text }] : []);
}

/** Object with the entries whose key matches the filter. */
function pick(object, filter) {
    return Object.fromEntries(Object.entries(object).filter(([key]) => filter(key)));
}

/** Removes empty arrays, empty objects and undefined values; undefined if nothing is left. */
function compact(object) {
    const result = {};
    for (const [key, value] of Object.entries(object)) {
        const empty = value === undefined ||
            (Array.isArray(value) && value.length === 0) ||
            (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
        if (!empty) {
            result[key] = value;
        }
    }
    return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Generates the BPMN diagram interchange (shapes and edge waypoints) from
 * the auto layout, using the default sizes of Open-BPMN.
 */
function diagramInterchange(model, processId) {
    const typeOf = id => model.nodes.find(node => node.id === id).type;
    const layout = computeLayout(model.nodes, model.edges, id => DI_SIZES[typeOf(id)]);
    const bounds = id => ({ ...layout.positions.get(id), ...DI_SIZES[typeOf(id)] });

    const shapes = model.nodes.map(node => {
        const b = bounds(node.id);
        const children = [element('dc:Bounds', number({ height: b.height, width: b.width, x: b.x, y: b.y }))];
        if (node.type !== 'task') {
            // Labels of events and gateways are shown below the shape
            children.push(element('bpmndi:BPMNLabel', { id: `BPMNLabel_${node.id}` }, [
                element('dc:Bounds', number({ height: 20, width: 100, x: b.x + b.width / 2 - 50, y: b.y + b.height + 3 }))
            ]));
        }
        return element('bpmndi:BPMNShape', { bpmnElement: node.id, id: `BPMNShape_${node.id}` }, children);
    });

    const edges = model.edges.map(edge => {
        const source = bounds(edge.source);
        const target = bounds(edge.target);
        const route = layout.arcEdges.has(edge.id) ? computeArcRoute(source, target)
            : layout.branchEdges.has(edge.id) ? computeBranchRoute(source, target)
                : computeRoute(source, target);
        return element('bpmndi:BPMNEdge', {
            bpmnElement: edge.id,
            id: `BPMNEdge_${edge.id}`,
            sourceElement: `BPMNShape_${edge.source}`,
            targetElement: `BPMNShape_${edge.target}`
        }, route.map(point => element('di:waypoint', number({ x: point.x, y: point.y }))));
    });

    return element('bpmndi:BPMNDiagram', { id: 'BPMNDiagram_1', name: 'Imixs-Diagram' }, [
        element('bpmndi:BPMNPlane', { bpmnElement: processId, id: 'BPMNPlane_1' }, [...shapes, ...edges])
    ]);
}

/** Formats numbers like Open-BPMN does ("36.0"). */
function number(values) {
    return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, (Math.round(value * 10) / 10).toFixed(1)]));
}
