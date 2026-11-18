/** Default name of new nodes per type. */
const DEFAULT_NAMES = {
    task: 'Task',
    end: 'End'
};

/** Node types that can be inserted on an edge (they have a successor). */
const INSERTABLE_TYPES = ['task', 'gateway'];

/** Node types that can be appended after a node without successor. */
const APPENDABLE_TYPES = ['task', 'gateway', 'end'];

/**
 * DiagramModel holds the diagram data (nodes and edges).
 *
 * The model is the single source of truth: the view never keeps state of
 * its own. Every change fires a 'change' event so that views can re-render.
 *
 * The model is changed only by structure operations (insert, append,
 * add branch, connect, delete), so it always stays a valid process:
 * every node is reachable from the start node.
 */
export class DiagramModel extends EventTarget {

    /**
     * @param {object} data - plain JSON model ({ type, nodes, edges })
     */
    constructor(data = {}) {
        super();
        this.type = data.type || 'metamodel';
        this.nodes = (data.nodes || []).map(node => ({ ...node, properties: node.properties || {} }));
        this.edges = (data.edges || []).map(edge => ({ ...edge, properties: edge.properties || {} }));
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
     * Appends a new node of the given type after a node: source → new.
     * Returns the new node or null if the operation is not allowed.
     */
    appendNode(sourceId, type) {
        const source = this.getNode(sourceId);
        if (!source || source.type === 'end' || !APPENDABLE_TYPES.includes(type)) {
            return null;
        }
        const node = this.#createNode(type);
        this.#createEdge(sourceId, node.id);
        this.#fireChange('append', node);
        return node;
    }

    /**
     * Inserts a new node on an edge: A → B becomes A → new → B.
     * The existing edge keeps its id and properties and now ends at the new node.
     * Returns the new node or null if the operation is not allowed.
     */
    insertOnEdge(edgeId, type) {
        const edge = this.getEdge(edgeId);
        if (!edge || !INSERTABLE_TYPES.includes(type)) {
            return null;
        }
        const node = this.#createNode(type);
        this.#createEdge(node.id, edge.target);
        edge.target = node.id;
        this.#fireChange('insert', node);
        return node;
    }

    /**
     * Adds a new branch to a gateway: gateway → new task → new end.
     * Returns the new task or null if the node is not a gateway.
     */
    addBranch(gatewayId) {
        const gateway = this.getNode(gatewayId);
        if (!gateway || gateway.type !== 'gateway') {
            return null;
        }
        const task = this.#createNode('task');
        const end = this.#createNode('end');
        this.#createEdge(gatewayId, task.id);
        this.#createEdge(task.id, end.id);
        this.#fireChange('branch', task);
        return task;
    }

    /**
     * Returns the nodes a new edge from the given node may point to.
     * Used to merge branches and to create loops ("connect to…").
     */
    getConnectTargets(sourceId) {
        const source = this.getNode(sourceId);
        if (!source || source.type === 'end') {
            return [];
        }
        return this.nodes.filter(node =>
            node.id !== sourceId &&
            node.type !== 'start' &&
            !this.#hasEdge(sourceId, node.id));
    }

    /**
     * Creates an edge between two existing nodes.
     * Returns the new edge or null if the connection is not allowed.
     */
    connect(sourceId, targetId) {
        if (!this.getConnectTargets(sourceId).some(node => node.id === targetId)) {
            return null;
        }
        const edge = this.#createEdge(sourceId, targetId);
        this.#fireChange('connect', edge);
        return edge;
    }

    /**
     * A node can be deleted if it is not the start node and has at most
     * one successor. Gateways with several branches are reduced first by
     * deleting branches.
     */
    canDeleteNode(id) {
        const node = this.getNode(id);
        return !!node && node.type !== 'start' && this.getOutgoing(id).length <= 1;
    }

    /**
     * Deletes a node. Its predecessors are connected to its successor
     * (A → X → B becomes A → B). Returns true if the node was deleted.
     */
    deleteNode(id) {
        if (!this.canDeleteNode(id)) {
            return false;
        }
        const node = this.getNode(id);
        const [outgoing] = this.getOutgoing(id);
        const successor = outgoing && outgoing.target !== id ? outgoing.target : null;

        this.edges = this.edges.filter(edge => edge !== outgoing);
        for (const edge of this.getIncoming(id)) {
            if (successor && edge.source !== successor && !this.#hasEdge(edge.source, successor)) {
                edge.target = successor;
            } else {
                this.edges = this.edges.filter(e => e !== edge);
            }
        }
        this.nodes = this.nodes.filter(n => n !== node);
        this.#removeNodes(this.#findUnreachable(this.edges));
        this.#fireChange('delete', node);
        return true;
    }

    /**
     * An edge can be deleted if it is one of several branches of its source
     * or one of several edges entering its target (a merge or a loop).
     */
    canDeleteEdge(id) {
        const edge = this.getEdge(id);
        return !!edge &&
            (this.getOutgoing(edge.source).length > 1 || this.getIncoming(edge.target).length > 1);
    }

    /**
     * Returns the ids of the nodes that would be removed together with the
     * given edge, because they are no longer reachable from the start node.
     */
    previewDeleteEdge(id) {
        return this.#findUnreachable(this.edges.filter(edge => edge.id !== id));
    }

    /**
     * Deletes an edge and all nodes that are no longer reachable from the
     * start node (deletes a whole branch). Returns the ids of removed nodes.
     */
    deleteEdge(id) {
        if (!this.canDeleteEdge(id)) {
            return [];
        }
        const edge = this.getEdge(id);
        this.edges = this.edges.filter(e => e !== edge);
        const removed = this.#findUnreachable(this.edges);
        this.#removeNodes(removed);
        this.#fireChange('delete', edge);
        return removed;
    }

    /**
     * Sets the display name of a node.
     */
    renameNode(id, name) {
        const node = this.getNode(id);
        if (!node) {
            return;
        }
        node.properties.name = name;
        this.#fireChange('rename', node);
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
            nodes: this.nodes,
            edges: this.edges
        });
    }

    #createNode(type) {
        const node = { id: this.#nextId('n', this.nodes), type, x: 0, y: 0, properties: {} };
        if (DEFAULT_NAMES[type]) {
            node.properties.name = DEFAULT_NAMES[type];
        }
        this.nodes.push(node);
        return node;
    }

    #createEdge(source, target) {
        const edge = { id: this.#nextId('e', this.edges), source, target, properties: {} };
        this.edges.push(edge);
        return edge;
    }

    #hasEdge(source, target) {
        return this.edges.some(edge => edge.source === source && edge.target === target);
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

    /**
     * Returns the ids of all nodes that are not reachable from a start node
     * using the given edges. Returns an empty list if there is no start node.
     */
    #findUnreachable(edges) {
        const starts = this.nodes.filter(node => node.type === 'start').map(node => node.id);
        if (starts.length === 0) {
            return [];
        }
        const reached = new Set(starts);
        const queue = [...starts];
        while (queue.length > 0) {
            const id = queue.shift();
            for (const edge of edges) {
                if (edge.source === id && !reached.has(edge.target)) {
                    reached.add(edge.target);
                    queue.push(edge.target);
                }
            }
        }
        return this.nodes.filter(node => !reached.has(node.id)).map(node => node.id);
    }

    #removeNodes(ids) {
        if (ids.length === 0) {
            return;
        }
        const removed = new Set(ids);
        this.nodes = this.nodes.filter(node => !removed.has(node.id));
        this.edges = this.edges.filter(edge => !removed.has(edge.source) && !removed.has(edge.target));
    }

    /**
     * Fires a 'change' event with { reason, element } as detail. A plain
     * Event is used because CustomEvent is not global in Node 18.
     */
    #fireChange(reason, element) {
        this.dispatchEvent(Object.assign(new Event('change'), { detail: { reason, element } }));
    }
}
