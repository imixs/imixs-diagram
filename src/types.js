import { computeLayout } from './layout.js';
import { computeTreeLayout, newOrgChart, newSkillMap } from './tree.js';
import { computePackLayout } from './pack.js';
import { newModel } from './bpmn.js';

/**
 * Profiles of the diagram types. Everything that differs between the meta
 * model, the org chart and the skill map is described here, so the views
 * (index.js, editor.js, properties.js) never ask for the type themselves.
 *
 * A profile has:
 *  - layout(nodes, edges, sizeOf): the layout function
 *  - create(): JSON model of a new, empty diagram
 *  - tree: the diagram is a tree and always has its root
 *  - bpmn: the diagram can be exported as BPMN 2.0
 *  - relayoutOnProperties: property changes need a new layout (boxes grow with their text)
 *  - bubbles: zoomable bubble navigation instead of fit on load (skill map)
 *  - panOnNodes: dragging a node pans the view
 *  - editor: options of the action bar
 *      actions: action bar and Del key; nodeActions: { node type: [[label, tooltip, model operation]] }
 *      (shown if the operation adds no rule error); openButton: "Edit" fires onOpen;
 *      deleteTitle: tooltip of Delete; deleteSubtree: offer "Delete Subtree";
 *      markNew: mark created nodes as unfinished until the host reloads
 *  - panel: the property panel, or null for none
 *      fields: { diagram, node, edge } fields per element kind (a kind without fields
 *      does not open the panel); diagramProperties: ⚙ button and double click on
 *      the canvas; caption(element): title of the panel; className: extra CSS class
 *
 * Panel fields: { key, label, type, readOnly, row, narrow, when(model, element) }.
 * Field types: text, textarea, checkbox (default checked), messages (meta
 * workflow messages, offered from the workflows set with setWorkflows) and
 * roles (read-only columns of an org unit). Consecutive fields with the same
 * `row` share one line; `narrow` fields there only take the space they need.
 * A field with `when` is only shown if it returns true.
 */

/** Name and documentation, as every BPMN element has them. */
const NAME = { key: 'name', label: 'Name', type: 'text' };
const DOCUMENTATION = { key: 'documentation', label: 'Documentation', type: 'textarea' };

const METAMODEL = {
    layout: computeLayout,
    create: newModel,
    tree: false,
    bpmn: true,
    relayoutOnProperties: false,
    bubbles: false,
    panOnNodes: false,
    editor: {
        actions: true,
        openButton: false,
        deleteSubtree: false,
        markNew: false,
        nodeActions: {
            task: [
                ['+ Task', 'Add an event and a new task', 'appendTask'],
                ['+ Condition', 'Add an event with a conditional gateway', 'addConditionalGateway'],
                ['+ Gateway', 'Add a gateway, every branch gets its own event', 'addGateway'],
                ['+ End', 'Make this task the final state', 'appendEnd']
            ],
            event: [
                ['+ Task', 'Add a new task as target of this event', 'appendTask'],
                ['+ Condition', 'Turn this into a conditional event', 'addConditionalGateway']
            ],
            gateway: [
                ['+ Event', 'Add a new event, connect it afterwards', 'addEvent'],
                ['+ Task', 'Add a conditional flow to a new task', 'addConditionalTask']
            ]
        }
    },
    panel: {
        diagramProperties: true,
        fields: {
            diagram: [
                NAME,
                { key: 'version', label: 'Model Version', type: 'text' },
                DOCUMENTATION
            ],
            node: [
                { ...NAME, row: 'name' },
                {
                    key: 'processid', label: 'Process ID', type: 'text', readOnly: true, row: 'name', narrow: true,
                    when: (model, node) => node.type === 'task'
                },
                {
                    key: 'activityid', label: 'Activity ID', type: 'text', readOnly: true, row: 'name', narrow: true,
                    when: (model, node) => node.type === 'event'
                },
                {
                    key: 'public', label: 'Public', type: 'checkbox', row: 'name', narrow: true,
                    when: (model, node) => node.type === 'event'
                },
                // Meta workflow: messages that start a core process or are received from one
                {
                    key: 'messages', label: 'Messages', type: 'messages',
                    when: (model, node) => node.type === 'event'
                },
                DOCUMENTATION
            ],
            edge: [
                NAME,
                {
                    key: 'condition', label: 'Condition', type: 'text',
                    when: (model, edge) => model.isConditionalFlow(edge.id)
                },
                DOCUMENTATION
            ]
        }
    }
};

const ORGCHART = {
    layout: computeTreeLayout,
    create: newOrgChart,
    tree: true,
    bpmn: false,
    // Unit boxes grow with their description
    relayoutOnProperties: true,
    bubbles: false,
    panOnNodes: false,
    editor: {
        actions: true,
        openButton: true,
        deleteTitle: 'Delete, the children move up (Del)',
        deleteSubtree: true,
        markNew: true,
        nodeActions: {
            unit: [
                ['+ Child', 'Add a subordinate unit', 'addChild'],
                ['+ Sibling', 'Add a unit on the same level', 'addSibling']
            ]
        }
    },
    // Only the roles of a unit, read-only; the host edits units in its own form
    panel: {
        diagramProperties: false,
        caption: unit => `Roles - ${unit.properties.name || unit.id}`,
        className: 'imixs-properties--roles',
        fields: {
            node: [{ key: 'roles', label: 'Roles', type: 'roles' }]
        }
    }
};

const SKILLMAP = {
    layout: computePackLayout,
    create: newSkillMap,
    tree: true,
    bpmn: false,
    relayoutOnProperties: true,
    bubbles: true,
    panOnNodes: true,
    // The bubble navigator has its own toolbar
    editor: { actions: false, openButton: false, deleteSubtree: false, markNew: false, nodeActions: {} },
    panel: null
};

const TYPES = { metamodel: METAMODEL, orgchart: ORGCHART, skillmap: SKILLMAP };

/**
 * Returns the profile of a diagram type ('metamodel' if none is given).
 *
 * @param {string} [type]
 * @throws {Error} for an unknown type
 */
export function getDiagramType(type = 'metamodel') {
    const profile = TYPES[type];
    if (!profile) {
        throw new Error(`Unknown diagram type: ${type}`);
    }
    return profile;
}
