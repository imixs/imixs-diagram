import { DiagramModel } from './model.js';
import { NodeLayer } from './nodes.js';
import { EdgeLayer } from './edges.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Creates a diagram editor inside the given host element.
 *
 * @param {HTMLElement} element - host element, must be attached to the document
 * @param {object} data - plain JSON model ({ type, nodes, edges })
 * @returns {{ getModel: function(): object, onChange: function(function(object)): void }}
 */
export function createDiagram(element, data) {
    element.classList.add('imixs-diagram');

    // Edges are drawn below the nodes, so arrow heads end at the node border
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'imixs-diagram__edges');
    const nodeContainer = document.createElement('div');
    nodeContainer.className = 'imixs-diagram__nodes';
    element.append(svg, nodeContainer);

    const model = new DiagramModel(data);
    const nodeLayer = new NodeLayer(nodeContainer, model);
    const edgeLayer = new EdgeLayer(svg, model, nodeLayer);

    model.addEventListener('change', () => {
        nodeLayer.render();
        edgeLayer.render();
    });

    return {
        /** Returns the current model as plain JSON. */
        getModel: () => model.toJSON(),

        /** Registers a callback that receives the current model after each change. */
        onChange: callback => model.addEventListener('change', () => callback(model.toJSON()))
    };
}
