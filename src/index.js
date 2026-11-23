import { DiagramModel } from './model.js';
import { NodeLayer } from './nodes.js';
import { EdgeLayer } from './edges.js';
import { Editor } from './editor.js';
import { PanZoom } from './panzoom.js';
import { PropertyPanel } from './properties.js';
import { computeLayout } from './layout.js';
import { computeTreeLayout, newOrgChart, newSkillMap } from './tree.js';
import { computePackLayout } from './pack.js';
import { BubbleNavigator } from './bubbles.js';
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
 *  - 'skillmap': skill map as nested bubbles (circle packing); clicking a
 *    bubble zooms into it, the background or Esc zooms out
 *
 * Every structural change of the model triggers a new layout. The computed
 * positions are written back to the model (change reason 'layout'), then
 * all views re-render. Property changes only re-render, without layout.
 *
 * @param {HTMLElement} element - host element, must be attached to the document
 * @param {string|object} [source] - BPMN 2.0 XML written by Imixs-Diagram, a JSON model
 *   ({ type, properties, nodes, edges }), or nothing for a new meta model
 * @param {{propertyPanel?: boolean, workflows?: Object<string, string[]>}} [options] - the property
 *   panel is shown for meta models by default; `workflows` lists the core workflows (group
 *   name → message names) offered for the messages of meta workflow events
 * @throws {Error} if the BPMN file was not created by Imixs-Diagram
 */
export function createDiagram(element, source, options = {}) {
    let data = typeof source === 'string' ? fromBPMN(source) : source || newModel();
    const type = data.type || 'metamodel';
    const isMetamodel = type === 'metamodel';
    const isSkillMap = type === 'skillmap';
    if (!isMetamodel && !data.nodes?.length) {
        // A tree always has its root
        const empty = isSkillMap ? newSkillMap() : newOrgChart();
        data = { ...empty, ...data, nodes: empty.nodes, edges: [] };
    }
    const showPanel = options.propertyPanel ?? isMetamodel;

    element.classList.add('imixs-editor', `imixs-editor--${type}`);
    const canvas = document.createElement('div');
    canvas.className = `imixs-diagram imixs-diagram--${type}`;
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
    const panZoom = new PanZoom(canvas, content, () => ({ width: layout.width, height: layout.height }),
        { panOnNodes: isSkillMap });
    const editor = new Editor(canvas, content, model, nodeLayer, edgeLayer, panZoom,
        { openButton: !isMetamodel, actions: !isSkillMap });
    const propertyPanel = panel ? new PropertyPanel(panel, model) : null;
    if (options.workflows) {
        propertyPanel?.setWorkflows(options.workflows);
    }
    const openListeners = [];
    const open = node => openListeners.forEach(callback => callback(structuredClone(node)));
    const navigator = isSkillMap
        ? new BubbleNavigator(canvas, model, nodeLayer, panZoom, () => layout, { onEdit: open })
        : null;
    panZoom.onChange(() => editor.updatePosition());
    editor.onSelectionChange(selection => propertyPanel?.show(selection));
    editor.onEditRequest(selection => {
        propertyPanel?.focus();
        const node = selection?.kind === 'node' ? model.getNode(selection.id) : null;
        if (node) {
            open(node);
        }
    });

    const computePositions = isMetamodel ? computeLayout : isSkillMap ? computePackLayout : computeTreeLayout;
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
            if (reason === 'undo' || reason === 'redo') {
                // The selection may be unchanged, but its values are not
                propertyPanel?.show(editor.selection);
            }
            return;
        }
        content.style.width = layout.width + 'px';
        content.style.height = layout.height + 'px';
        nodeLayer.render(layout);
        edgeLayer.render(layout);
        editor.render();
        navigator?.render();
    });
    if (navigator) {
        // The first camera position is set without animation
        navigator.animateCamera = false;
    }
    const undoButton = panZoom.addButton('↶', 'Undo (Ctrl+Z)', () => model.undo(), true);
    const redoButton = panZoom.addButton('↷', 'Redo (Ctrl+Y)', () => model.redo(), true);
    const updateHistoryButtons = () => {
        undoButton.disabled = !model.canUndo();
        redoButton.disabled = !model.canRedo();
    };
    model.addEventListener('change', updateHistoryButtons);
    updateHistoryButtons();

    // Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo. Text fields keep their own undo.
    canvas.addEventListener('keydown', event => {
        if (!(event.ctrlKey || event.metaKey) || event.target.closest('input, select, textarea')) {
            return;
        }
        const key = event.key.toLowerCase();
        if (key === 'z' && !event.shiftKey) {
            event.preventDefault();
            model.undo();
        } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
            event.preventDefault();
            model.redo();
        }
    });

    relayout();
    if (!navigator) {
        panZoom.fitOnLoad();
    }

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

        /**
         * Sets the core workflows offered for the messages of meta workflow
         * events, as { group: [message names] }, e.g. after loading them from the server.
         */
        setWorkflows: workflows => propertyPanel?.setWorkflows(workflows),

        /** Undoes the last change; returns false if there is nothing to undo. */
        undo: () => model.undo(),

        /** Redoes the last undone change; returns false if there is nothing to redo. */
        redo: () => model.redo(),

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
