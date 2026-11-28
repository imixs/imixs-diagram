import { validate, findUnreachable, assignImixsIds } from './rules.js';

/**
 * Structure operations, rules and numbering of the meta model (Imixs
 * process). Plain functions, called by DiagramModel inside a transaction:
 * each operation changes nodes and edges through the transaction context
 * `tx` and returns a result, or null if it does not apply. The model
 * validates afterwards and rolls back if a new error appears.
 *
 * The context `tx` offers: model, typeOf(id), outgoing(id) (the single
 * outgoing edge), createNode(type), createEdge(source, target, properties),
 * removeNodes(ids).
 */

/**
 * A gateway that follows an event; its branches are conditional flows.
 *
 * @param {DiagramModel} model
 * @param {string} id
 */
export function isConditionalGateway(model, id) {
    if (model.getNode(id)?.type !== 'gateway') {
        return false;
    }
    const incoming = model.getIncoming(id)[0];
    return !!incoming && model.getNode(incoming.source)?.type === 'event';
}

/** Removes everything that can no longer be reached from the start. */
function removeUnreachable(tx) {
    tx.removeNodes(findUnreachable(tx.model.nodes, tx.model.edges));
}

const operations = {
    appendTask(tx, nodeId) {
        const type = tx.typeOf(nodeId);
        if (type !== 'task' && type !== 'event') {
            return null;
        }
        const out = tx.outgoing(nodeId);
        if (out) {
            return operations.insertTask(tx, out.id);
        }
        const task = tx.createNode('task');
        if (type === 'event') {
            tx.createEdge(nodeId, task.id);
        } else {
            const event = tx.createNode('event');
            tx.createEdge(nodeId, event.id);
            tx.createEdge(event.id, task.id);
        }
        return task;
    },

    insertTask(tx, edgeId) {
        const edge = tx.model.getEdge(edgeId);
        if (!edge) {
            return null;
        }
        const task = tx.createNode('task');
        const event = tx.createNode('event');
        const target = edge.target;
        if (tx.typeOf(edge.source) === 'event' || isConditionalGateway(tx.model, edge.source)) {
            // The source must be followed by a task: source → new task → event → target
            edge.target = task.id;
            tx.createEdge(task.id, event.id);
            tx.createEdge(event.id, target);
        } else {
            // The source may be followed by an event: source → event → new task → target
            edge.target = event.id;
            tx.createEdge(event.id, task.id);
            tx.createEdge(task.id, target);
        }
        return task;
    },

    addGateway(tx, taskId) {
        if (tx.typeOf(taskId) !== 'task') {
            return null;
        }
        const out = tx.outgoing(taskId);
        const successor = out ? tx.typeOf(out.target) : null;
        const gateway = tx.createNode('gateway');
        if (successor === 'event') {
            // The existing event becomes the first branch
            const event = out.target;
            out.target = gateway.id;
            tx.createEdge(gateway.id, event);
            return gateway;
        }
        if (successor === null) {
            // Gateway with a first event; the event is connected later
            const event = tx.createNode('event');
            tx.createEdge(taskId, gateway.id);
            tx.createEdge(gateway.id, event.id);
            return gateway;
        }
        if (successor === 'end') {
            // The end moves behind a new task in the first branch
            const end = out.target;
            const event = tx.createNode('event');
            const task = tx.createNode('task');
            out.target = gateway.id;
            tx.createEdge(gateway.id, event.id);
            tx.createEdge(event.id, task.id);
            tx.createEdge(task.id, end);
            return gateway;
        }
        return null;
    },

    addConditionalGateway(tx, nodeId) {
        const type = tx.typeOf(nodeId);
        const out = tx.outgoing(nodeId);
        if (type === 'event') {
            if (out && tx.typeOf(out.target) !== 'task') {
                return null;
            }
            const gateway = tx.createNode('gateway');
            if (out) {
                // The existing target becomes the first conditional branch
                const task = out.target;
                out.target = gateway.id;
                tx.createEdge(gateway.id, task, { condition: '' });
            } else {
                tx.createEdge(nodeId, gateway.id);
            }
            return gateway;
        }
        if (type !== 'task') {
            return null;
        }
        if (out && tx.typeOf(out.target) === 'event') {
            return operations.addConditionalGateway(tx, out.target);
        }
        if (out && tx.typeOf(out.target) !== 'end') {
            return null;
        }
        const event = tx.createNode('event');
        const gateway = tx.createNode('gateway');
        const end = out ? out.target : null;
        if (out) {
            out.target = event.id;
        } else {
            tx.createEdge(nodeId, event.id);
        }
        tx.createEdge(event.id, gateway.id);
        if (end) {
            // The end moves behind a new task in the first branch
            const task = tx.createNode('task');
            tx.createEdge(gateway.id, task.id, { condition: '' });
            tx.createEdge(task.id, end);
        }
        return gateway;
    },

    appendEnd(tx, taskId) {
        if (tx.typeOf(taskId) !== 'task' || tx.outgoing(taskId)) {
            return null;
        }
        const end = tx.createNode('end');
        tx.createEdge(taskId, end.id);
        return end;
    },

    addEvent(tx, gatewayId) {
        if (tx.typeOf(gatewayId) !== 'gateway' || isConditionalGateway(tx.model, gatewayId)) {
            return null;
        }
        const event = tx.createNode('event');
        tx.createEdge(gatewayId, event.id);
        return event;
    },

    addConditionalTask(tx, gatewayId) {
        if (!isConditionalGateway(tx.model, gatewayId)) {
            return null;
        }
        const task = tx.createNode('task');
        tx.createEdge(gatewayId, task.id, { condition: '' });
        return task;
    },

    connect(tx, sourceId, targetId) {
        const type = tx.typeOf(sourceId);
        if (tx.typeOf(targetId) !== 'task') {
            return null;
        }
        if (isConditionalGateway(tx.model, sourceId)) {
            return tx.createEdge(sourceId, targetId, { condition: '' });
        }
        if (type === 'event' && !tx.outgoing(sourceId)) {
            return tx.createEdge(sourceId, targetId);
        }
        if (type === 'gateway' || (type === 'task' && !tx.outgoing(sourceId))) {
            // Every transition gets its own event, even to the same task
            const event = tx.createNode('event');
            tx.createEdge(sourceId, event.id);
            return tx.createEdge(event.id, targetId);
        }
        return null;
    },

    deleteNode(tx, id) {
        const model = tx.model;
        const node = model.getNode(id);
        if (!node || node.type === 'start') {
            return null;
        }
        const outgoing = model.getOutgoing(id);
        if (node.type === 'gateway') {
            // A gateway with one branch is bridged, without branch it is removed
            if (outgoing.length > 1) {
                return null;
            }
            const incoming = model.getIncoming(id)[0];
            if (incoming && outgoing.length === 1) {
                incoming.target = outgoing[0].target;
            }
            tx.removeNodes([id]);
            return node;
        }
        if (node.type === 'event') {
            // Only if nothing behind the event gets lost
            tx.removeNodes([id]);
            return findUnreachable(model.nodes, model.edges).length === 0 ? node : null;
        }
        if (node.type === 'task' && outgoing.length === 1 && tx.typeOf(outgoing[0].target) === 'event') {
            const event = outgoing[0].target;
            const next = tx.outgoing(event)?.target;
            if (next && next !== id) {
                // E1 → T → E2 → X becomes E1 → X
                for (const edge of model.getIncoming(id)) {
                    edge.target = next;
                }
                tx.removeNodes([id, event]);
                removeUnreachable(tx);
                return node;
            }
        }
        if (node.type === 'task' && outgoing.some(edge => tx.typeOf(edge.target) === 'gateway')) {
            // Would silently remove the whole gateway; delete it first
            return null;
        }
        // Remove the element, its end and a following event without target.
        // The predecessors stay without target and can be connected again.
        const followers = outgoing
            .map(edge => edge.target)
            .filter(target => tx.typeOf(target) === 'end' ||
                (tx.typeOf(target) === 'event' && !tx.outgoing(target)));
        tx.removeNodes([id, ...followers]);
        removeUnreachable(tx);
        return node;
    },

    deleteEdge(tx, id) {
        const model = tx.model;
        const edge = model.getEdge(id);
        if (!edge) {
            return null;
        }
        const before = new Set(model.nodes.map(node => node.id));
        model.edges = model.edges.filter(e => e !== edge);
        removeUnreachable(tx);
        const after = new Set(model.nodes.map(node => node.id));
        return [...before].filter(nodeId => !after.has(nodeId));
    }
};

/**
 * The meta model kind for DiagramModel: default names of new nodes, rules,
 * numbering and structure operations.
 */
export const METAMODEL_KIND = {
    names: { task: 'Task', event: 'Event', end: 'End' },
    validate,
    operations,

    /** Stores processid (tasks) and activityid (events) for the engine. */
    assignIds(model) {
        for (const [id, value] of assignImixsIds(model.nodes, model.edges)) {
            const node = model.getNode(id);
            node.properties[node.type === 'task' ? 'processid' : 'activityid'] = value;
        }
    }
};
