/**
 * DiagramModel holds the diagram data (nodes and edges).
 *
 * The model is the single source of truth: the view never keeps state of
 * its own. Every change fires a 'change' event so that views can re-render.
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
     * Moves a node to a new position. Negative coordinates are not allowed.
     */
    moveNode(id, x, y) {
        const node = this.getNode(id);
        if (!node) {
            return;
        }
        node.x = Math.max(0, Math.round(x));
        node.y = Math.max(0, Math.round(y));
        this.#fireChange('move', node);
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

    #fireChange(reason, element) {
        this.dispatchEvent(new CustomEvent('change', { detail: { reason, element } }));
    }
}
