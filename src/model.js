import { METAMODEL_KIND, isConditionalGateway } from './ops-metamodel.js';
import { treeKind } from './ops-tree.js';

/**
 * Rules and structure operations per diagram type: the meta model in
 * ops-metamodel.js, the trees in ops-tree.js.
 */
const KINDS = {
    metamodel: METAMODEL_KIND,
    orgchart: treeKind('unit', 'New Unit'),
    skillmap: treeKind('skill', 'New Skill')
};

/** Maximum number of undo steps. */
const HISTORY_LIMIT = 100;

/**
 * DiagramModel holds the diagram data (nodes and edges).
 *
 * The model is the single source of truth: the view never keeps state of
 * its own. Every change fires a 'change' event so that views can re-render.
 *
 * The model is changed only by structure operations. The operations and
 * rules of each diagram type live in their own module (ops-metamodel.js,
 * ops-tree.js); this class runs them as transactions: an operation is
 * applied, the result is checked against the rules of the type, and it is
 * rolled back if it adds an error. An operation the type does not have
 * does not apply.
 * Incomplete parts (an event without target, a gateway without branch)
 * are allowed while modeling, so users can build a gateway with its events
 * first and connect them afterwards.
 *
 * Every operation and property change can be undone: the model keeps
 * snapshots of its earlier states. Consecutive changes of the same property
 * (typing) form one undo step.
 */
export class DiagramModel extends EventTarget {

    /**
     * @param {object} data - plain JSON model ({ type, properties, nodes, edges })
     * @throws {Error} for an unknown diagram type
     */
    constructor(data = {}) {
        super();
        this.type = data.type || 'metamodel';
        this.#kind = KINDS[this.type];
        if (!this.#kind) {
            throw new Error(`Unknown diagram type: ${this.type}`);
        }
        this.properties = { ...data.properties };
        this.nodes = (data.nodes || []).map(node => ({ ...node, properties: node.properties || {} }));
        this.edges = (data.edges || []).map(edge => ({ ...edge, properties: edge.properties || {} }));
        this.#assignImixsIds();
    }

    #kind;
    #undoStack = [];
    #redoStack = [];
    #lastProperty = null;

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
        return this.#kind.validate(this.nodes, this.edges);
    }

    /**
     * A conditional flow is a branch of a gateway that follows an event.
     * It carries a condition.
     */
    isConditionalFlow(edgeId) {
        const edge = this.getEdge(edgeId);
        return !!edge && isConditionalGateway(this, edge.source);
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
     * Returns the flow that starts the gateway branch of the given node: its
     * only incoming flow, if that comes from a gateway and can be deleted.
     * Deleting this flow deletes the branch (see deleteEdge). Returns null
     * if the node does not start a branch.
     */
    getBranchEdge(id) {
        const incoming = this.getIncoming(id);
        return incoming.length === 1 && this.#typeOf(incoming[0].source) === 'gateway' &&
            this.canDeleteEdge(incoming[0].id) ? incoming[0] : null;
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
        // Typing changes the same text property again and again: one undo step.
        // Other values (a list of messages, a flag) are a step each.
        const property = typeof value === 'string' ? `${id}/${key}` : null;
        if (!property || property !== this.#lastProperty) {
            this.#record(this.#snapshot());
        }
        this.#lastProperty = property;
        target.properties[key] = value;
        this.#fireChange('properties', target);
    }

    /** Returns true if there is a change to undo. */
    canUndo() {
        return this.#undoStack.length > 0;
    }

    /** Returns true if there is an undone change to redo. */
    canRedo() {
        return this.#redoStack.length > 0;
    }

    /**
     * Restores the state before the last change. Fires a change event with
     * reason 'undo'. Returns false if there is nothing to undo.
     */
    undo() {
        return this.#travel(this.#undoStack, this.#redoStack, 'undo');
    }

    /**
     * Restores the last undone change. Fires a change event with reason
     * 'redo'. Returns false if there is nothing to redo.
     */
    redo() {
        return this.#travel(this.#redoStack, this.#undoStack, 'redo');
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
     * Context of the structure operations: helpers to change nodes and edges.
     */
    #tx = {
        model: this,
        typeOf: id => this.getNode(id)?.type,
        outgoing: id => this.getOutgoing(id)[0],
        createNode: type => this.#createNode(type),
        createEdge: (source, target, properties) => this.#createEdge(source, target, properties),
        removeNodes: ids => this.#removeNodes(ids)
    };

    /**
     * Applies an operation as a transaction and fires a change event.
     * Returns the result of the operation or null if it was rolled back.
     */
    #apply(operation, ...args) {
        const before = this.#snapshot();
        const result = this.#transaction(operation, args, false);
        if (result !== null) {
            this.#record(before);
            this.#lastProperty = null;
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
        const run = this.#kind.operations[operation];
        let result = run ? run(this.#tx, ...args) : null;
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

    // ---- History --------------------------------------------------------

    #snapshot() {
        return structuredClone({ properties: this.properties, nodes: this.nodes, edges: this.edges });
    }

    /** Stores a state for undo; a new change makes the redo steps obsolete. */
    #record(snapshot) {
        this.#undoStack.push(snapshot);
        if (this.#undoStack.length > HISTORY_LIMIT) {
            this.#undoStack.shift();
        }
        this.#redoStack = [];
    }

    /** Moves from the current state to the last state of `from`, keeping the current one in `to`. */
    #travel(from, to, reason) {
        const snapshot = from.pop();
        if (!snapshot) {
            return false;
        }
        to.push(this.#snapshot());
        this.properties = snapshot.properties;
        this.nodes = snapshot.nodes;
        this.edges = snapshot.edges;
        this.#lastProperty = null;
        this.#fireChange(reason, null);
        return true;
    }

    // ---- Helpers --------------------------------------------------------

    /** Numbers the engine needs (meta model: processid, activityid). */
    #assignImixsIds() {
        this.#kind.assignIds(this);
    }

    #typeOf(id) {
        return this.getNode(id)?.type;
    }


    #createNode(type) {
        const node = { id: this.#nextId('n', this.nodes), type, x: 0, y: 0, properties: {} };
        const name = this.#kind.names[type];
        if (name) {
            node.properties.name = name;
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

    #fireChange(reason, element) {
        this.dispatchEvent(Object.assign(new Event('change'), { detail: { reason, element } }));
    }
}
