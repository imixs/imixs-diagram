import { DiagramModel } from './model.js';
import { NodeLayer } from './nodes.js';
import { EdgeLayer } from './edges.js';
import { Editor } from './editor.js';
import { PanZoom } from './panzoom.js';
import { computeLayout } from './layout.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Creates a diagram editor inside the given host element.
 *
 * Every structural change of the model triggers a new layout. The computed
 * positions are written back to the model (change reason 'layout'), then
 * all views re-render.
 *
 * @param {HTMLElement} element - host element, must be attached to the document
 * @param {object} data - plain JSON model ({ type, nodes, edges })
 * @returns {{ getModel: function(): object, onChange: function(function(object)): void }}
 */
export function createDiagram(element, data) {
    element.classList.add('imixs-diagram');
    element.tabIndex = 0;

    // Edges are drawn below the nodes, so arrow heads end at the node border
    const content = document.createElement('div');
    content.className = 'imixs-diagram__content';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'imixs-diagram__edges');
    const nodeContainer = document.createElement('div');
    nodeContainer.className = 'imixs-diagram__nodes';
    content.append(svg, nodeContainer);
    element.append(content);

    const model = new DiagramModel(data);
    const nodeLayer = new NodeLayer(nodeContainer, model);
    const edgeLayer = new EdgeLayer(svg, model, nodeLayer);
    let layout = null;
    const panZoom = new PanZoom(element, content, () => ({ width: layout.width, height: layout.height }));
    const editor = new Editor(element, content, model, nodeLayer, edgeLayer, panZoom);
    panZoom.onChange(() => editor.updatePosition());

    const relayout = () => {
        // Nodes must exist in the DOM before their CSS size can be measured
        nodeLayer.render();
        layout = computeLayout(model.nodes, model.edges, id => nodeLayer.getSize(id));
        model.applyLayout(layout.positions);
    };

    model.addEventListener('change', event => {
        if (event.detail.reason !== 'layout') {
            relayout();
    panZoom.fitIfNeeded();
            return;
        }
        content.style.width = layout.width + 'px';
        content.style.height = layout.height + 'px';
        nodeLayer.render();
        edgeLayer.render(layout.arcEdges);
        editor.render();
    });
    relayout();

    return {
        /** Returns the current model as plain JSON. */
        getModel: () => model.toJSON(),

        /** Registers a callback that receives the current model after each change. */
        onChange: callback => model.addEventListener('change', () => callback(model.toJSON()))
    };
}
