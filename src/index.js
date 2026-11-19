import { DiagramModel } from './model.js';
import { NodeLayer } from './nodes.js';
import { EdgeLayer } from './edges.js';
import { Editor } from './editor.js';
import { PanZoom } from './panzoom.js';
import { PropertyPanel } from './properties.js';
import { computeLayout } from './layout.js';
import { toBPMN, fromBPMN, newModel } from './bpmn.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Creates a diagram editor inside the given host element. The host is
 * split into the diagram canvas (top) and the property panel (bottom).
 *
 * Every structural change of the model triggers a new layout. The computed
 * positions are written back to the model (change reason 'layout'), then
 * all views re-render. Property changes only re-render, without layout.
 *
 * @param {HTMLElement} element - host element, must be attached to the document
 * @param {string|object} [source] - BPMN 2.0 XML written by Imixs-Diagram, a JSON model
 *   ({ type, properties, nodes, edges }), or nothing for a new model
 * @throws {Error} if the BPMN file was not created by Imixs-Diagram
 * @returns {{ getModel: function(): object, getBPMN: function(): string, validate: function(): object[], onChange: function(function(object)): void }}
 */
export function createDiagram(element, source) {
    const data = typeof source === 'string' ? fromBPMN(source) : source || newModel();
    element.classList.add('imixs-editor');
    const canvas = document.createElement('div');
    canvas.className = 'imixs-diagram';
    canvas.tabIndex = 0;
    const panel = document.createElement('div');
    panel.className = 'imixs-properties';
    element.append(canvas, panel);

    // Edges are drawn below the nodes, so arrow heads end at the node border
    const content = document.createElement('div');
    content.className = 'imixs-diagram__content';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'imixs-diagram__edges');
    const nodeContainer = document.createElement('div');
    nodeContainer.className = 'imixs-diagram__nodes';
    content.append(svg, nodeContainer);
    canvas.append(content);

    const model = new DiagramModel(data);
    const errors = model.validate().filter(problem => problem.severity === 'error');
    if (errors.length > 0) {
        console.warn('Imixs-Diagram: the loaded model violates the Imixs rules', errors);
    }
    const nodeLayer = new NodeLayer(nodeContainer, model);
    const edgeLayer = new EdgeLayer(svg, model, nodeLayer);
    let layout = null;
    const panZoom = new PanZoom(canvas, content, () => ({ width: layout.width, height: layout.height }));
    const editor = new Editor(canvas, content, model, nodeLayer, edgeLayer, panZoom);
    const propertyPanel = new PropertyPanel(panel, model);
    panZoom.onChange(() => editor.updatePosition());
    editor.onSelectionChange(selection => propertyPanel.show(selection));
    editor.onEditRequest(() => propertyPanel.focus());

    const relayout = () => {
        // Nodes must exist in the DOM before their CSS size can be measured
        nodeLayer.render();
        layout = computeLayout(model.nodes, model.edges, id => nodeLayer.getSize(id));
        model.applyLayout(layout.positions);
    };

    model.addEventListener('change', event => {
        const reason = event.detail.reason;
        if (reason !== 'layout' && reason !== 'properties') {
            relayout();
            return;
        }
        content.style.width = layout.width + 'px';
        content.style.height = layout.height + 'px';
        nodeLayer.render();
        edgeLayer.render(layout.arcEdges);
        editor.render();
    });
    relayout();
    panZoom.fitIfNeeded();

    return {
        /** Returns the current model as plain JSON. */
        getModel: () => model.toJSON(),

        /** Returns the current model as BPMN 2.0 XML, ready to be saved. */
        getBPMN: () => toBPMN(model.toJSON()),

        /** Returns the problems of the current model ({ id, severity, message }), e.g. before saving. */
        validate: () => model.validate(),

        /** Registers a callback that receives the current model after each change. */
        onChange: callback => model.addEventListener('change', () => callback(model.toJSON()))
    };
}
