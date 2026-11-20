/**
 * Geometric shape per node type. Used by the edge layer to compute where
 * an edge touches the node border.
 */
const SHAPES = {
    start: 'circle',
    event: 'circle',
    end: 'circle',
    gateway: 'diamond',
    task: 'rect'
};

/**
 * NodeLayer renders the nodes of a model as absolutely positioned HTML
 * elements. Positions come from the model (computed by the layout), sizes
 * are defined by CSS only.
 */
export class NodeLayer {

    /**
     * @param {HTMLElement} container - element that holds the node elements
     * @param {DiagramModel} model
     */
    constructor(container, model) {
        this.container = container;
        this.model = model;
        this.elements = new Map();
    }

    /**
     * Creates missing node elements, removes deleted ones and updates
     * position and label of all nodes.
     */
    render() {
        const ids = new Set(this.model.nodes.map(node => node.id));
        for (const [id, element] of this.elements) {
            if (!ids.has(id)) {
                element.remove();
                this.elements.delete(id);
            }
        }
        for (const node of this.model.nodes) {
            let element = this.elements.get(node.id);
            if (!element) {
                element = this.#createElement(node);
                this.elements.set(node.id, element);
                this.container.append(element);
            }
            element.style.left = node.x + 'px';
            element.style.top = node.y + 'px';
            element.querySelector('.imixs-node__label').textContent = node.properties.name || '';
            const description = element.querySelector('.imixs-node__description');
            description.textContent = node.properties.description || '';
            description.hidden = !node.properties.description;
        }
    }

    /**
     * Returns the rendered size of a node, defined by CSS.
     */
    getSize(id) {
        const element = this.elements.get(id);
        return { width: element.offsetWidth, height: element.offsetHeight };
    }

    /**
     * Returns position, size and shape of a node in canvas coordinates.
     */
    getBounds(id) {
        const node = this.model.getNode(id);
        return {
            x: node.x,
            y: node.y,
            ...this.getSize(id),
            shape: SHAPES[node.type] || 'rect'
        };
    }

    /**
     * Returns the HTML element of a node or undefined.
     */
    getElement(id) {
        return this.elements.get(id);
    }

    #createElement(node) {
        const element = document.createElement('div');
        element.className = `imixs-node imixs-node--${node.type}`;
        element.dataset.id = node.id;

        const label = document.createElement('span');
        label.className = 'imixs-node__label';
        const description = document.createElement('span');
        description.className = 'imixs-node__description';
        element.append(label, description);
        return element;
    }
}
