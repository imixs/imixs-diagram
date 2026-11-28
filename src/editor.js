/**
 * Editor handles selection and structure actions.
 *
 * Clicking a node or an edge selects it and shows an action bar with the
 * structure operations that are allowed for it. All actions change the
 * model only; the views re-render from the model.
 *
 * The selection is pure view state and is not stored in the model.
 * Other views (the property panel) are notified when it changes.
 * The action bar lives outside the zoomed content, so it keeps its size
 * at every zoom level.
 *
 * The actions come from the editor options of the diagram type profile
 * (src/types.js). With `openButton` (org chart) the action bar offers an
 * "Edit" button that fires the open request, so the host can open its own
 * form. A double click fires the edit request (the property panel opens).
 * With `markNew`, nodes created in this session are marked as unfinished
 * until the host reloads the diagram after editing them (view state, not stored).
 */
export class Editor {

    /**
     * @param {HTMLElement} host - focusable host element (keyboard events)
     * @param {HTMLElement} content - element holding nodes and edges
     * @param {DiagramModel} model
     * @param {NodeLayer} nodeLayer
     * @param {EdgeLayer} edgeLayer
     * @param {PanZoom} panZoom - converts between screen and diagram coordinates
     * @param {object} [options] - editor options of the diagram type profile (src/types.js);
     *   `actions: false` only selects, without action bar and delete key
     */
    constructor(host, content, model, nodeLayer, edgeLayer, panZoom, options = {}) {
        this.options = options;
        this.openButton = !!options.openButton;
        this.actions = options.actions ?? true;
        this.host = host;
        this.content = content;
        this.model = model;
        this.nodeLayer = nodeLayer;
        this.edgeLayer = edgeLayer;
        this.panZoom = panZoom;
        this.selection = null;
        this.selectionKey = null;
        this.anchor = null;
        this.selectionListeners = [];
        this.editListeners = [];
        this.openListeners = [];
        this.newUnits = new Set();

        this.bar = document.createElement('div');
        this.bar.className = 'imixs-actions';
        this.bar.hidden = true;
        host.append(this.bar);

        host.addEventListener('pointerdown', event => this.#onPointerDown(event));
        content.addEventListener('dblclick', event => this.#onDoubleClick(event));
        host.addEventListener('keydown', event => this.#onKeyDown(event));
    }

    /**
     * Registers a callback that receives the new selection
     * ({ kind: 'node' | 'edge', id } or null for the diagram itself).
     */
    onSelectionChange(callback) {
        this.selectionListeners.push(callback);
    }

    /**
     * Registers a callback that is called when the user wants to edit the
     * selected element (double click).
     */
    onEditRequest(callback) {
        this.editListeners.push(callback);
    }

    /**
     * Registers a callback that is called when the user wants to open the
     * host's form of the selected element ("Edit" button).
     */
    onOpenRequest(callback) {
        this.openListeners.push(callback);
    }

    /**
     * Updates the selection highlight and the action bar.
     * Called after each model change.
     */
    render() {
        const selection = this.selection;
        if (selection && !this.#selectedElement(selection)) {
            this.selection = null;
        }
        const key = this.selection ? `${this.selection.kind}:${this.selection.id}` : null;
        if (key !== this.selectionKey) {
            this.selectionKey = key;
            for (const callback of this.selectionListeners) {
                callback(this.selection);
            }
        }
        for (const element of this.content.querySelectorAll('.is-selected, .is-incomplete, .is-invalid')) {
            element.classList.remove('is-selected', 'is-incomplete', 'is-invalid');
        }
        // Mark unfinished parts (allowed while modeling) and rule errors
        for (const problem of this.model.validate()) {
            const view = this.nodeLayer.getElement(problem.id) || this.edgeLayer.getElement(problem.id);
            view?.classList.add(problem.severity === 'error' ? 'is-invalid' : 'is-incomplete');
        }
        for (const id of this.newUnits) {
            this.nodeLayer.getElement(id)?.classList.add('is-incomplete');
        }
        this.bar.replaceChildren();
        this.bar.hidden = true;
        if (!this.selection) {
            return;
        }
        this.#selectedView(this.selection)?.classList.add('is-selected');
        if (!this.actions) {
            return;
        }
        if (this.selection.kind === 'node') {
            this.#renderNodeActions(this.model.getNode(this.selection.id));
        } else {
            this.#renderEdgeActions(this.model.getEdge(this.selection.id));
        }
        this.bar.hidden = this.bar.childElementCount === 0;
    }

    /**
     * Moves the action bar to its anchor after the view was panned or zoomed.
     */
    updatePosition() {
        if (!this.anchor) {
            return;
        }
        const point = this.panZoom.toScreen(this.anchor);
        this.bar.style.left = Math.round(point.x) + 'px';
        this.bar.style.top = Math.round(point.y) + 'px';
    }

    #select(selection) {
        this.selection = selection;
        this.render();
    }

    #selectedElement(selection) {
        return selection.kind === 'node' ? this.model.getNode(selection.id) : this.model.getEdge(selection.id);
    }

    #selectedView(selection) {
        return selection.kind === 'node'
            ? this.nodeLayer.getElement(selection.id)
            : this.edgeLayer.getElement(selection.id);
    }

    #renderNodeActions(node) {
        for (const [text, title, operation] of this.options.nodeActions?.[node.type] || []) {
            if (this.model.canApply(operation, node.id)) {
                this.#button(text, title, () => this.#selectResult(this.model[operation](node.id)));
            }
        }

        const targets = this.model.getConnectTargets(node.id);
        if (targets.length > 0) {
            const select = document.createElement('select');
            select.title = 'Connect to an existing task (merge or loop)';
            select.append(new Option('Connect to…', ''));
            for (const target of targets) {
                select.append(new Option(`${target.properties.name || label(target.type)} (${target.id})`, target.id));
            }
            select.addEventListener('change', () => {
                if (select.value) {
                    this.model.connect(node.id, select.value);
                }
            });
            this.bar.append(select);
        }

        if (this.openButton) {
            this.#button('Edit', 'Open the form of this element', () => {
                for (const callback of this.openListeners) {
                    callback(this.selection);
                }
            });
        }
        if (this.model.getBranchEdge(node.id)) {
            this.#button('Delete Branch', 'Delete this branch with everything only reachable through it (Del)',
                () => this.#deleteSelection(), 'is-danger');
        } else if (this.model.canDeleteNode(node.id)) {
            this.#button('Delete', this.options.deleteTitle || 'Delete (Del)', () => this.#deleteSelection(), 'is-danger');
        }
        if (this.options.deleteSubtree && this.model.getOutgoing(node.id).length > 0 &&
            this.model.canApply('deleteSubtree', node.id)) {
            this.#button('Delete Subtree', 'Delete with all subordinate units', () => {
                const count = this.model.previewDeleteSubtree(node.id).length;
                if (window.confirm(`Delete this unit with ${count - 1} subordinate unit(s)?`)) {
                    this.model.deleteSubtree(node.id);
                }
            }, 'is-danger');
        }

        const bounds = this.nodeLayer.getBounds(node.id);
        this.#placeBar(bounds.x, bounds.y);
    }

    #renderEdgeActions(edge) {
        if (this.model.canApply('insertTask', edge.id)) {
            this.#button('+ Task', 'Insert a task on this flow',
                () => this.#selectResult(this.model.insertTask(edge.id)));
        }
        if (this.model.canDeleteEdge(edge.id)) {
            const isBranch = this.model.getNode(edge.source)?.type === 'gateway';
            this.#button(isBranch ? 'Delete Branch' : 'Delete', 'Delete this flow and everything behind it (Del)',
                () => this.#deleteSelection(), 'is-danger');
        }
        this.#placeBar(this.selection.x, this.selection.y);
    }

    /** Places the action bar above the given diagram point. */
    #placeBar(x, y) {
        this.anchor = { x, y };
        this.updatePosition();
    }

    #button(text, title, action, className) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.title = title;
        if (className) {
            button.classList.add(className);
        }
        button.addEventListener('click', action);
        this.bar.append(button);
    }

    /** Selects a node created by an operation; keeps the selection otherwise. */
    #selectResult(result) {
        if (this.options.markNew && result?.type) {
            this.newUnits.add(result.id);
        }
        if (result && result.type) {
            this.#select({ kind: 'node', id: result.id });
        }
    }

    #deleteSelection() {
        const selection = this.selection;
        if (!selection) {
            return;
        }
        if (selection.kind === 'node') {
            // The first element of a gateway branch deletes the whole branch
            const branch = this.model.getBranchEdge(selection.id);
            if (branch) {
                this.#deleteEdge(branch.id);
            } else {
                this.model.deleteNode(selection.id);
            }
            return;
        }
        this.#deleteEdge(selection.id);
    }

    /** Deletes a flow with everything behind it; asks if more than one element gets lost. */
    #deleteEdge(id) {
        if (!this.model.canDeleteEdge(id)) {
            return;
        }
        const removed = this.model.previewDeleteEdge(id);
        if (removed.length > 1 &&
            !window.confirm(`Delete this branch with ${removed.length} elements?`)) {
            return;
        }
        this.model.deleteEdge(id);
    }

    #onPointerDown(event) {
        if (event.target.closest('.imixs-actions, .imixs-zoom, .imixs-breadcrumb, .imixs-properties')) {
            return;
        }
        const node = event.target.closest('.imixs-node');
        const edge = event.target.closest('.imixs-edge-group');
        if (node) {
            this.#select({ kind: 'node', id: node.dataset.id });
        } else if (edge) {
            const point = this.panZoom.eventToDiagram(event);
            this.#select({ kind: 'edge', id: edge.dataset.id, x: Math.round(point.x), y: Math.round(point.y) });
        } else {
            this.#select(null);
        }
    }

    #onDoubleClick(event) {
        if (event.target.closest('.imixs-node, .imixs-edge-group')) {
            this.#requestEdit();
        }
    }

    #requestEdit() {
        for (const callback of this.editListeners) {
            callback(this.selection);
        }
    }

    #onKeyDown(event) {
        if (event.target.closest('input, select, textarea')) {
            return;
        }
        if (this.actions && (event.key === 'Delete' || event.key === 'Backspace')) {
            event.preventDefault();
            this.#deleteSelection();
        } else if (event.key === 'Escape') {
            this.#select(null);
        }
    }
}

/** Display label of a node type. */
function label(type) {
    return type.charAt(0).toUpperCase() + type.slice(1);
}
