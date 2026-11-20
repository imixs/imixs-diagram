import { DiagramModel } from './model.js';
import { NodeLayer } from './nodes.js';
import { EdgeLayer } from './edges.js';
import { Editor } from './editor.js';
import { PanZoom } from './panzoom.js';
import { PropertyPanel } from './properties.js';
import { computeLayout } from './layout.js';
import { computeTreeLayout, newOrgChart } from './tree.js';
import { toBPMN, fromBPMN, newModel } from './bpmn.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Creates a diagram inside the given host element.
 *
 * Two kinds of diagrams are supported, selected by the `type` of the model:
 *  - 'metamodel' (default): Imixs process editor with action bar and a
 *    property panel below the canvas, stored as BPMN 2.0
 *  - 'orgchart': org chart with a top-down tree layout and no property
 *    panel; "Edit" or a double click on a unit fires onOpen() so the host
 *    can open its own form
 *
 * Every structural change of the model triggers a new layout. The computed
 * positions are written back to the model (change reason 'layout'), then
 * all views re-render. Property changes only re-render, without layout.
 *
 * @param {HTMLElement} element - host element, must be attached to the document
 * @param {string|object} [source] - BPMN 2.0 XML written by Imixs-Diagram, a JSON model
 *   ({ type, properties, nodes, edges }), or nothing for a new meta model
 * @param {{propertyPanel?: boolean}} [options] - the property panel is shown for meta models by default
 * @throws {Error} if the BPMN file was not created by Imixs-Diagram
 */
export function createDiagram(element, source, options = {}) {
    let data = typeof source === 'string' ? fromBPMN(source) : source || newModel();
    const isMetamodel = (data.type || 'metamodel') === 'metamodel';
    if (!isMetamodel && !data.nodes?.length) {
        // An org chart always has its root
        data = { ...newOrgChart(), ...data, nodes: newOrgChart().nodes, edges: [] };
    }
    const showPanel = options.propertyPanel ?? isMetamodel;

    element.classList.add('imixs-editor');
    const canvas = document.createElement('div');
    canvas.className = 'imixs-diagram';
    canvas.tabIndex = 0;
    element.append(canvas);
    const panel = showPanel ? document.createElement('div') : null;
    if (panel) {
        panel.className = 'imixs-properties';
        element.append(panel);
    }

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
        console.warn(`Imixs-Diagram: the loaded ${model.type} violates its rules`, errors);
    }
    const nodeLayer = new NodeLayer(nodeContainer, model);
    const edgeLayer = new EdgeLayer(svg, model, nodeLayer);
    let layout = null;
    const panZoom = new PanZoom(canvas, content, () => ({ width: layout.width, height: layout.height }));
    const editor = new Editor(canvas, content, model, nodeLayer, edgeLayer, panZoom, { openButton: !isMetamodel });
    const propertyPanel = panel ? new PropertyPanel(panel, model) : null;
    const openListeners = [];
    panZoom.onChange(() => editor.updatePosition());
    editor.onSelectionChange(selection => propertyPanel?.show(selection));
    editor.onEditRequest(selection => {
        propertyPanel?.focus();
        const node = selection?.kind === 'node' ? model.getNode(selection.id) : null;
        if (node) {
            for (const callback of openListeners) {
                callback(structuredClone(node));
            }
        }
    });

    const computePositions = isMetamodel ? computeLayout : computeTreeLayout;
    const relayout = () => {
        // Nodes must exist in the DOM before their CSS size can be measured
        nodeLayer.render();
        layout = computePositions(model.nodes, model.edges, id => nodeLayer.getSize(id));
        model.applyLayout(layout.positions);
    };

    model.addEventListener('change', event => {
        const reason = event.detail.reason;
        // Org chart boxes grow with their description, so properties need a new layout there
        if (reason !== 'layout' && (reason !== 'properties' || !isMetamodel)) {
            relayout();
            return;
        }
        content.style.width = layout.width + 'px';
        content.style.height = layout.height + 'px';
        nodeLayer.render();
        edgeLayer.render(layout.arcEdges, layout.routing);
        editor.render();
    });
    relayout();
    panZoom.fitIfNeeded();

    return {
        /** Returns the current model as plain JSON. */
        getModel: () => model.toJSON(),

        /** Returns the current meta model as BPMN 2.0 XML, ready to be saved. */
        getBPMN: () => {
            if (!isMetamodel) {
                throw new Error('BPMN export is only available for meta models.');
            }
            return toBPMN(model.toJSON());
        },

        /** Returns the problems of the model ({ id, severity, message }), e.g. before saving. */
        validate: () => model.validate(),

        /**
         * Sets a property of a node, an edge or (id null) the diagram, e.g. the
         * name of an org unit after the host saved its form.
         */
        setProperty: (id, key, value) => model.setProperty(id, key, value),

        /** Registers a callback that receives the current model after each change. */
        onChange: callback => model.addEventListener('change', () => callback(model.toJSON())),

        /** Registers a callback that receives a copy of a node when it is opened by double click. */
        onOpen: callback => openListeners.push(callback)
    };
}
