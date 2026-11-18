/**
 * Geometric shape per node type. Used by the edge layer to compute where
 * an edge touches the node border.
 */
const SHAPES = {
    start: 'circle',
    end: 'circle',
    task: 'rect'
};

/**
 * NodeLayer renders the nodes of a model as absolutely positioned HTML
 * elements and lets the user move them with the mouse (or touch).
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
        this.render();
    }

    /**
     * Creates missing node elements and updates the position of all nodes.
     */
    render() {
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
        }
    }

    /**
     * Returns position, size and shape of a node in canvas coordinates.
     * The size comes from the rendered element, so it is defined by CSS.
     */
    getBounds(id) {
        const node = this.model.getNode(id);
        const element = this.elements.get(id);
        return {
            x: node.x,
            y: node.y,
            width: element.offsetWidth,
            height: element.offsetHeight,
            shape: SHAPES[node.type] || 'rect'
        };
    }

    #createElement(node) {
        const element = document.createElement('div');
        element.className = `imixs-node imixs-node--${node.type}`;
        element.dataset.id = node.id;

        const label = document.createElement('span');
        label.className = 'imixs-node__label';
        element.append(label);

        this.#enableDrag(element, node.id);
        return element;
    }

    /**
     * Drag & drop based on pointer events. Pointer capture keeps the drag
     * alive even if the pointer leaves the element during fast moves.
     */
    #enableDrag(element, id) {
        element.addEventListener('pointerdown', event => {
            if (event.button !== 0) {
                return;
            }
            event.preventDefault();
            const node = this.model.getNode(id);
            const start = { pointerX: event.clientX, pointerY: event.clientY, x: node.x, y: node.y };

            element.setPointerCapture(event.pointerId);
            element.classList.add('is-dragging');

            const onMove = moveEvent => {
                this.model.moveNode(id,
                    start.x + moveEvent.clientX - start.pointerX,
                    start.y + moveEvent.clientY - start.pointerY);
            };
            const onEnd = () => {
                element.classList.remove('is-dragging');
                element.removeEventListener('pointermove', onMove);
                element.removeEventListener('pointerup', onEnd);
                element.removeEventListener('pointercancel', onEnd);
            };

            element.addEventListener('pointermove', onMove);
            element.addEventListener('pointerup', onEnd);
            element.addEventListener('pointercancel', onEnd);
        });
    }
}
