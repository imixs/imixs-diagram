import { validate, findUnreachable, assignImixsIds } from './rules.js';
import { validateTree, TREE_NODE_TYPES } from './tree.js';

/** Default name of new nodes per type. */
const DEFAULT_NAMES = {
    task: 'Task',
    event: 'Event',
    end: 'End',
    unit: 'New Unit',
    skill: 'New Skill'
};

/**
 * DiagramModel holds the diagram data (nodes and edges).
 *
 * The model is the single source of truth: the view never keeps state of
 * its own. Every change fires a 'change' event so that views can re-render.
 *
 * The model is changed only by structure operations. Each operation runs
 * as a transaction: it is applied, the result is checked against the Imixs
 * rules (see rules.js), and it is rolled back if it adds an error.
 * Incomplete parts (an event without target, a gateway without branch)
 * are allowed while modeling, so users can build a gateway with its events
 * first and connect them afterwards.
 */
export class DiagramModel extends EventTarget {

    /**
     * @param {object} data - plain JSON model ({ type, properties, nodes, edges })
     */
    constructor(data = {}) {
        super();
        this.type = data.type || 'metamodel';
        this.properties = { ...data.properties };
        this.nodes = (data.nodes || []).map(node => ({ ...node, properties: node.properties || {} }));
        this.edges = (data.edges || []).map(edge => ({ ...edge, properties: edge.properties || {} }));
        this.#assignImixsIds();
    }

    /**
     * Returns the node with the given id or undefined.
     */
    getNode(id) {
        return this.nodes.find(node => node.id === id);
    }

    /**
     * Returns the edge with the given id or undefined.
     */
    getEdge(id) {
        return this.edges.find(edge => edge.id === id);
    }

    /**
     * Returns all edges leaving the given node, in model order.
     */
    getOutgoing(id) {
        return this.edges.filter(edge => edge.source === id);
    }

    /**
     * Returns all edges entering the given node, in model order.
     */
    getIncoming(id) {
        return this.edges.filter(edge => edge.target === id);
    }

    /**
     * Returns the problems of the current model ({ id, severity, message },
     * severity 'error' or 'incomplete'). Empty if the model is valid.
     */
    validate() {
        const treeNodeType = TREE_NODE_TYPES[this.type];
        return treeNodeType ? validateTree(this.nodes, this.edges, treeNodeType) : validate(this.nodes, this.edges);
    }

    /**
     * A conditional flow is a branch of a gateway that follows an event.
     * It carries a condition.
     */
    isConditionalFlow(edgeId) {
        const edge = this.getEdge(edgeId);
        return !!edge && this.#isConditionalGateway(edge.source);
    }

    /**
     * Returns true if the named operation can be applied with the given
     * arguments without adding an error. The model is not changed.
     */
    canApply(operation, ...args) {
        return this.#dryRun(operation, args) !== null;
    }

    /**
     * Adds a new task after a task (with an event in between) or after an
     * event without target. If the element already has a successor, the
     * new task is inserted between them.
     * Returns the new task or null.
     */
    appendTask(nodeId) {
        return this.#apply('appendTask', nodeId);
    }

    /**
     * Inserts a new task (with the event it needs) on an edge.
     * Returns the new task or null.
     */
    insertTask(edgeId) {
        return this.#apply('insertTask', edgeId);
    }

    /**
     * Adds a gateway after a task. Every branch of it leads to an event.
     * Returns the new gateway or null.
     */
    addGateway(taskId) {
        return this.#apply('addGateway', taskId);
    }

    /**
     * Adds a conditional gateway after an event, or event + conditional
     * gateway after a task. Its branches are conditional flows to tasks.
     * Returns the new gateway or null.
     */
    addConditionalGateway(nodeId) {
        return this.#apply('addConditionalGateway', nodeId);
    }

    /**
     * Makes a task without successor the final state: task → end.
     * Returns the new end or null.
     */
    appendEnd(taskId) {
        return this.#apply('appendEnd', taskId);
    }

    /**
     * Adds a new event without target to a gateway that follows a task.
     * Returns the new event or null.
     */
    addEvent(gatewayId) {
        return this.#apply('addEvent', gatewayId);
    }

    /**
     * Adds a conditional flow to a new task to a conditional gateway.
     * Returns the new task or null.
     */
    addConditionalTask(gatewayId) {
        return this.#apply('addConditionalTask', gatewayId);
    }

    /**
     * Returns the tasks a transition from the given element may lead to
     * (merges and loops, "connect to…").
     */
    getConnectTargets(sourceId) {
        return this.nodes.filter(node => node.type === 'task' && this.canApply('connect', sourceId, node.id));
    }

    /**
     * Creates a transition to an existing task. The event in between is
     * created automatically where the rules require it.
     * Returns the new edge to the target or null.
     */
    connect(sourceId, targetId) {
        return this.#apply('connect', sourceId, targetId);
    }

    /**
     * Returns true if the node can be deleted.
     */
    canDeleteNode(id) {
        return this.canApply('deleteNode', id);
    }

    /**
     * Deletes a node. A task followed by an event is deleted together with
     * that event, its predecessors are connected to the following task
     * (E1 → T → E2 → X becomes E1 → X). Returns true if the node was deleted.
     */
    deleteNode(id) {
        return this.#apply('deleteNode', id) !== null;
    }

    /**
     * Org chart: adds a new unit below the given unit.
     * Returns the new unit or null.
     */
    addChild(parentId) {
        return this.#apply('addChild', parentId);
    }

    /**
     * Org chart: adds a new unit with the same parent, placed right after
     * the given unit. Returns the new unit or null (e.g. for the root).
     */
    addSibling(unitId) {
        return this.#apply('addSibling', unitId);
    }

    /**
     * Org chart: returns the ids of the units that deleteSubtree() would remove.
     */
    previewDeleteSubtree(unitId) {
        return this.#dryRun('deleteSubtree', [unitId]) || [];
    }

    /**
     * Org chart: deletes a unit with all its descendants (not the root).
     * Returns the ids of removed units.
     */
    deleteSubtree(unitId) {
        return this.#apply('deleteSubtree', unitId) || [];
    }

    /**
     * Returns true if the edge can be deleted.
     */
    canDeleteEdge(id) {
        return this.canApply('deleteEdge', id);
    }

    /**
     * Returns the ids of the nodes that would be removed together with the
     * given edge.
     */
    previewDeleteEdge(id) {
        return this.#dryRun('deleteEdge', [id]) || [];
    }

    /**
     * Deletes an edge together with everything that is no longer reachable
     * (deletes a whole branch). Returns the ids of removed nodes.
     */
    deleteEdge(id) {
        return this.#apply('deleteEdge', id) || [];
    }

    /**
     * Sets a property of a node, an edge or (id null) the diagram itself.
     * Fires a change event with reason 'properties'; no new layout is needed.
     */
    setProperty(id, key, value) {
        const target = id === null ? this : this.getNode(id) || this.getEdge(id);
        if (!target) {
            return;
        }
        target.properties[key] = value;
        this.#fireChange('properties', target);
    }

    /**
     * Stores node positions computed by the layout algorithm.
     *
     * @param {Map<string, {x:number, y:number}>} positions
     */
    applyLayout(positions) {
        for (const node of this.nodes) {
            const position = positions.get(node.id);
            if (position) {
                node.x = position.x;
                node.y = position.y;
            }
        }
        this.#fireChange('layout', null);
    }

    /**
     * Returns a deep copy of the model as plain JSON, ready for persistence.
     */
    toJSON() {
        return structuredClone({
            type: this.type,
            properties: this.properties,
            nodes: this.nodes,
            edges: this.edges
        });
    }

    // ---- Transactions ---------------------------------------------------

    /**
     * Structure operations. Each one changes nodes and edges and returns a
     * result, or null if it does not apply. Validation happens afterwards.
     */
    #operations = {
        appendTask: nodeId => {
            const type = this.#typeOf(nodeId);
            if (type !== 'task' && type !== 'event') {
                return null;
            }
            const out = this.#outgoing(nodeId);
            if (out) {
                return this.#operations.insertTask(out.id);
            }
            const task = this.#createNode('task');
            if (type === 'event') {
                this.#createEdge(nodeId, task.id);
            } else {
                const event = this.#createNode('event');
                this.#createEdge(nodeId, event.id);
                this.#createEdge(event.id, task.id);
            }
            return task;
        },

        insertTask: edgeId => {
            const edge = this.getEdge(edgeId);
            if (!edge) {
                return null;
            }
            const task = this.#createNode('task');
            const event = this.#createNode('event');
            const target = edge.target;
            if (this.#typeOf(edge.source) === 'event' || this.#isConditionalGateway(edge.source)) {
                // The source must be followed by a task: source → new task → event → target
                edge.target = task.id;
                this.#createEdge(task.id, event.id);
                this.#createEdge(event.id, target);
            } else {
                // The source may be followed by an event: source → event → new task → target
                edge.target = event.id;
                this.#createEdge(event.id, task.id);
                this.#createEdge(task.id, target);
            }
            return task;
        },

        addGateway: taskId => {
            if (this.#typeOf(taskId) !== 'task') {
                return null;
            }
            const out = this.#outgoing(taskId);
            const successor = out ? this.#typeOf(out.target) : null;
            const gateway = this.#createNode('gateway');
            if (successor === 'event') {
                // The existing event becomes the first branch
                const event = out.target;
                out.target = gateway.id;
                this.#createEdge(gateway.id, event);
                return gateway;
            }
            if (successor === null) {
                // Gateway with a first event; the event is connected later
                const event = this.#createNode('event');
                this.#createEdge(taskId, gateway.id);
                this.#createEdge(gateway.id, event.id);
                return gateway;
            }
            if (successor === 'end') {
                // The end moves behind a new task in the first branch
                const end = out.target;
                const event = this.#createNode('event');
                const task = this.#createNode('task');
                out.target = gateway.id;
                this.#createEdge(gateway.id, event.id);
                this.#createEdge(event.id, task.id);
                this.#createEdge(task.id, end);
                return gateway;
            }
            return null;
        },

        addConditionalGateway: nodeId => {
            const type = this.#typeOf(nodeId);
            const out = this.#outgoing(nodeId);
            if (type === 'event') {
                if (out && this.#typeOf(out.target) !== 'task') {
                    return null;
                }
                const gateway = this.#createNode('gateway');
                if (out) {
                    // The existing target becomes the first conditional branch
                    const task = out.target;
                    out.target = gateway.id;
                    this.#createEdge(gateway.id, task, { condition: '' });
                } else {
                    this.#createEdge(nodeId, gateway.id);
                }
                return gateway;
            }
            if (type !== 'task') {
                return null;
            }
            if (out && this.#typeOf(out.target) === 'event') {
                return this.#operations.addConditionalGateway(out.target);
            }
            if (out && this.#typeOf(out.target) !== 'end') {
                return null;
            }
            const event = this.#createNode('event');
            const gateway = this.#createNode('gateway');
            const end = out ? out.target : null;
            if (out) {
                out.target = event.id;
            } else {
                this.#createEdge(nodeId, event.id);
            }
            this.#createEdge(event.id, gateway.id);
            if (end) {
                // The end moves behind a new task in the first branch
                const task = this.#createNode('task');
                this.#createEdge(gateway.id, task.id, { condition: '' });
                this.#createEdge(task.id, end);
            }
            return gateway;
        },

        appendEnd: taskId => {
            if (this.#typeOf(taskId) !== 'task' || this.#outgoing(taskId)) {
                return null;
            }
            const end = this.#createNode('end');
            this.#createEdge(taskId, end.id);
            return end;
        },

        addEvent: gatewayId => {
            if (this.#typeOf(gatewayId) !== 'gateway' || this.#isConditionalGateway(gatewayId)) {
                return null;
            }
            const event = this.#createNode('event');
            this.#createEdge(gatewayId, event.id);
            return event;
        },

        addConditionalTask: gatewayId => {
            if (!this.#isConditionalGateway(gatewayId)) {
                return null;
            }
            const task = this.#createNode('task');
            this.#createEdge(gatewayId, task.id, { condition: '' });
            return task;
        },

        connect: (sourceId, targetId) => {
            const type = this.#typeOf(sourceId);
            if (this.#typeOf(targetId) !== 'task') {
                return null;
            }
            if (this.#isConditionalGateway(sourceId)) {
                return this.#createEdge(sourceId, targetId, { condition: '' });
            }
            if (type === 'event' && !this.#outgoing(sourceId)) {
                return this.#createEdge(sourceId, targetId);
            }
            if (type === 'gateway' || (type === 'task' && !this.#outgoing(sourceId))) {
                // Every transition gets its own event, even to the same task
                const event = this.#createNode('event');
                this.#createEdge(sourceId, event.id);
                return this.#createEdge(event.id, targetId);
            }
            return null;
        },

        addChild: parentId => {
            if (!this.#isTreeNode(parentId)) {
                return null;
            }
            const unit = this.#createNode(this.#typeOf(parentId));
            this.#createEdge(parentId, unit.id);
            return unit;
        },

        addSibling: unitId => {
            const parentEdge = this.getIncoming(unitId)[0];
            if (!this.#isTreeNode(unitId) || !parentEdge) {
                return null;
            }
            const unit = this.#createNode(this.#typeOf(unitId));
            const edge = this.#createEdge(parentEdge.source, unit.id);
            // Children are laid out in edge order: place the new unit right after the given one
            this.edges.splice(this.edges.indexOf(edge), 1);
            this.edges.splice(this.edges.indexOf(parentEdge) + 1, 0, edge);
            return unit;
        },

        deleteSubtree: unitId => {
            if (!this.#isTreeNode(unitId) || this.getIncoming(unitId).length === 0) {
                return null;
            }
            const removed = [];
            const collect = id => {
                removed.push(id);
                this.getOutgoing(id).forEach(edge => collect(edge.target));
            };
            collect(unitId);
            this.#removeNodes(removed);
            return removed;
        },

        deleteNode: id => {
            const node = this.getNode(id);
            if (!node || node.type === 'start') {
                return null;
            }
            if (this.#isTreeNode(id)) {
                // The children move up to the parent and take the place of the unit
                const parentEdge = this.getIncoming(id)[0];
                if (!parentEdge) {
                    return null;
                }
                const childEdges = this.getOutgoing(id);
                childEdges.forEach(edge => edge.source = parentEdge.source);
                const index = this.edges.indexOf(parentEdge);
                const others = edge => !childEdges.includes(edge);
                this.edges = [
                    ...this.edges.slice(0, index).filter(others),
                    ...childEdges,
                    ...this.edges.slice(index + 1).filter(others)
                ];
                this.#removeNodes([id]);
                return node;
            }
            const outgoing = this.getOutgoing(id);
            if (node.type === 'gateway') {
                // A gateway with one branch is bridged, without branch it is removed
                if (outgoing.length > 1) {
                    return null;
                }
                const incoming = this.getIncoming(id)[0];
                if (incoming && outgoing.length === 1) {
                    incoming.target = outgoing[0].target;
                }
                this.#removeNodes([id]);
                return node;
            }
            if (node.type === 'event') {
                // Only if nothing behind the event gets lost
                this.#removeNodes([id]);
                return findUnreachable(this.nodes, this.edges).length === 0 ? node : null;
            }
            if (node.type === 'task' && outgoing.length === 1 &&
                this.#typeOf(outgoing[0].target) === 'event') {
                const event = outgoing[0].target;
                const next = this.#outgoing(event)?.target;
                if (next && next !== id) {
                    // E1 → T → E2 → X becomes E1 → X
                    for (const edge of this.getIncoming(id)) {
                        edge.target = next;
                    }
                    this.#removeNodes([id, event]);
                    this.#removeUnreachable();
                    return node;
                }
            }
            if (node.type === 'task' && outgoing.some(edge => this.#typeOf(edge.target) === 'gateway')) {
                // Would silently remove the whole gateway; delete it first
                return null;
            }
            // Remove the element, its end and a following event without target.
            // The predecessors stay without target and can be connected again.
            const followers = outgoing
                .map(edge => edge.target)
                .filter(target => this.#typeOf(target) === 'end' ||
                    (this.#typeOf(target) === 'event' && !this.#outgoing(target)));
            this.#removeNodes([id, ...followers]);
            this.#removeUnreachable();
            return node;
        },

        deleteEdge: id => {
            const edge = this.getEdge(id);
            if (!edge) {
                return null;
            }
            const before = new Set(this.nodes.map(node => node.id));
            this.edges = this.edges.filter(e => e !== edge);
            this.#removeUnreachable();
            const after = new Set(this.nodes.map(node => node.id));
            return [...before].filter(nodeId => !after.has(nodeId));
        }
    };

    /**
     * Applies an operation as a transaction and fires a change event.
     * Returns the result of the operation or null if it was rolled back.
     */
    #apply(operation, ...args) {
        const result = this.#transaction(operation, args, false);
        if (result !== null) {
            this.#assignImixsIds();
            this.#fireChange(operation, result);
        }
        return result;
    }

    /** Runs an operation and always rolls it back. */
    #dryRun(operation, args) {
        return this.#transaction(operation, args, true);
    }

    /**
     * Runs an operation. It is rolled back if it does not apply, if it adds
     * an error, or if rollback is requested (dry run). Incomplete parts are
     * allowed, and errors that existed before (e.g. in a loaded model) are
     * tolerated.
     */
    #transaction(operation, args, rollback) {
        const backup = { nodes: structuredClone(this.nodes), edges: structuredClone(this.edges) };
        const errorsBefore = new Set(this.#errors());
        let result = this.#operations[operation](...args);
        if (result !== null && this.#errors().some(error => !errorsBefore.has(error))) {
            result = null;
        }
        if (rollback || result === null) {
            this.nodes = backup.nodes;
            this.edges = backup.edges;
        }
        return result;
    }

    /** Errors of the current model as comparable strings. */
    #errors() {
        return this.validate()
            .filter(problem => problem.severity === 'error')
            .map(problem => `${problem.id}: ${problem.message}`);
    }

    // ---- Helpers --------------------------------------------------------

    /** Stores processid (tasks) and activityid (events) for the engine. */
    #assignImixsIds() {
        if (this.type !== 'metamodel') {
            return;
        }
        for (const [id, value] of assignImixsIds(this.nodes, this.edges)) {
            const node = this.getNode(id);
            node.properties[node.type === 'task' ? 'processid' : 'activityid'] = value;
        }
    }

    #typeOf(id) {
        return this.getNode(id)?.type;
    }

    /** An org chart unit or a skill map skill. */
    #isTreeNode(id) {
        return Object.values(TREE_NODE_TYPES).includes(this.#typeOf(id));
    }

    /** The single outgoing edge of a node, or undefined. */
    #outgoing(id) {
        return this.getOutgoing(id)[0];
    }

    /** A gateway that follows an event; its branches are conditional flows. */
    #isConditionalGateway(id) {
        if (this.#typeOf(id) !== 'gateway') {
            return false;
        }
        const incoming = this.getIncoming(id)[0];
        return !!incoming && this.#typeOf(incoming.source) === 'event';
    }

    #createNode(type) {
        const node = { id: this.#nextId('n', this.nodes), type, x: 0, y: 0, properties: {} };
        if (DEFAULT_NAMES[type]) {
            node.properties.name = DEFAULT_NAMES[type];
        }
        this.nodes.push(node);
        return node;
    }

    #createEdge(source, target, properties = {}) {
        const edge = { id: this.#nextId('e', this.edges), source, target, properties };
        this.edges.push(edge);
        return edge;
    }

    /**
     * Returns a new id with the given prefix and a number higher than all
     * numbers used by existing ids with that prefix.
     */
    #nextId(prefix, list) {
        let max = 0;
        for (const { id } of list) {
            const number = id.startsWith(prefix) ? Number(id.slice(prefix.length)) : NaN;
            if (Number.isInteger(number)) {
                max = Math.max(max, number);
            }
        }
        return prefix + (max + 1);
    }

    #removeNodes(ids) {
        const removed = new Set(ids);
        this.nodes = this.nodes.filter(node => !removed.has(node.id));
        this.edges = this.edges.filter(edge => !removed.has(edge.source) && !removed.has(edge.target));
    }

    #removeUnreachable() {
        this.#removeNodes(findUnreachable(this.nodes, this.edges));
    }

    #fireChange(reason, element) {
        this.dispatchEvent(Object.assign(new Event('change'), { detail: { reason, element } }));
    }
}
