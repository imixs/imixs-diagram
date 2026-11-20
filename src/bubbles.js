/**
 * BubbleNavigator lets users jump into and out of the bubbles of a skill map
 * and offers the editing toolbar.
 *
 * One bubble is the focus: the camera shows it filling the screen, its
 * sub-skills are labeled, deeper levels are visible as small bubbles.
 *  - Click on a bubble with sub-skills: zoom into it.
 *  - Click on a leaf inside the focus: select it as target of the toolbar.
 *  - Click on the focused bubble itself or on the background, or Esc:
 *    zoom out one level.
 *  - Click on a deeper leaf: zoom to its parent so it becomes readable.
 *  - The breadcrumb shows the path from the root and jumps to any level.
 *
 * The toolbar below the breadcrumb works on the target: the selected leaf,
 * or the focused bubble if no leaf is selected. Skills created in this
 * session are marked as unfinished, as in the org chart.
 *
 * Focus, selection and the marks are pure view state, not stored in the model.
 */
export class BubbleNavigator {

    /**
     * @param {HTMLElement} host - canvas element (clicks, keys, breadcrumb)
     * @param {DiagramModel} model
     * @param {NodeLayer} nodeLayer
     * @param {PanZoom} panZoom - camera
     * @param {function(): object} getLayout - current pack layout (circles, parents)
     * @param {{onEdit?: function(object)}} [options] - called with the node to open on "Edit"
     */
    constructor(host, model, nodeLayer, panZoom, getLayout, options = {}) {
        this.host = host;
        this.model = model;
        this.nodeLayer = nodeLayer;
        this.panZoom = panZoom;
        this.getLayout = getLayout;
        this.onEdit = options.onEdit || (() => {});
        this.focus = null;
        this.selected = null;
        this.newSkills = new Set();
        this.camera = null;
        this.animateCamera = true;

        this.panel = document.createElement('nav');
        this.panel.className = 'imixs-breadcrumb';
        this.path = document.createElement('div');
        this.path.className = 'imixs-breadcrumb__path';
        this.tools = document.createElement('div');
        this.tools.className = 'imixs-breadcrumb__tools';
        this.panel.append(this.path, this.tools);
        host.append(this.panel);

        host.addEventListener('click', event => this.#onClick(event));
        host.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                this.zoomOut();
            }
        });
    }

    /**
     * Moves the focus to the given bubble.
     *
     * @param {string} id - node id
     * @param {boolean} [animate] - smooth camera move (default true)
     */
    focusOn(id, animate = true) {
        if (!this.getLayout().circles.has(id)) {
            return;
        }
        this.focus = id;
        this.selected = null;
        this.animateCamera = animate;
        this.render();
    }

    /**
     * Zooms out to the parent of the focused bubble.
     */
    zoomOut() {
        const parent = this.getLayout().parents.get(this.focus);
        if (parent) {
            this.focusOn(parent);
        }
    }

    /**
     * Updates labels, marks, breadcrumb and toolbar after a model or view
     * change, and moves the camera if the focused bubble moved or changed
     * its size. If the focused bubble was deleted, the focus moves to the root.
     */
    render() {
        const { parents, circles } = this.getLayout();
        if (!this.focus || !this.model.getNode(this.focus)) {
            this.focus = this.#root();
        }
        if (this.selected && !this.model.getNode(this.selected)) {
            this.selected = null;
        }
        for (const node of this.model.nodes) {
            const element = this.nodeLayer.getElement(node.id);
            const isFocus = node.id === this.focus;
            element?.classList.toggle('is-focus', isFocus);
            element?.classList.toggle('is-labelled', isFocus || parents.get(node.id) === this.focus);
            element?.classList.toggle('is-target', node.id === this.selected);
            element?.classList.toggle('is-incomplete', this.newSkills.has(node.id));
        }
        this.#renderPath();
        this.#renderTools();

        const circle = circles.get(this.focus);
        const key = circle && `${circle.x}/${circle.y}/${circle.r}`;
        if (circle && key !== this.camera) {
            this.camera = key;
            this.panZoom.focusRect({ x: circle.x - circle.r, y: circle.y - circle.r, width: 2 * circle.r, height: 2 * circle.r },
                this.animateCamera);
            this.animateCamera = true;
        }
    }

    #root() {
        const { parents } = this.getLayout();
        return this.model.nodes.find(node => !parents.has(node.id))?.id ?? null;
    }

    #ancestors(id) {
        const { parents } = this.getLayout();
        const path = [];
        for (let current = id; current; current = parents.get(current)) {
            path.unshift(current);
        }
        return path;
    }

    #renderPath() {
        const items = [];
        for (const id of this.#ancestors(this.focus)) {
            if (items.length > 0) {
                const separator = document.createElement('span');
                separator.textContent = '›';
                items.push(separator);
            }
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = this.model.getNode(id).properties.name || id;
            button.disabled = id === this.focus;
            button.addEventListener('click', () => this.focusOn(id));
            items.push(button);
        }
        this.path.replaceChildren(...items);
    }

    /** Toolbar for the target: the selected leaf or the focused bubble. */
    #renderTools() {
        const target = this.model.getNode(this.selected || this.focus);
        if (!target) {
            this.tools.replaceChildren();
            return;
        }
        const name = document.createElement('span');
        name.className = 'imixs-breadcrumb__target';
        name.textContent = target.properties.name || target.id;
        const items = [name];
        const button = (text, title, action) => {
            const element = document.createElement('button');
            element.type = 'button';
            element.textContent = text;
            element.title = title;
            element.addEventListener('click', action);
            items.push(element);
        };
        if (this.model.canApply('addChild', target.id)) {
            button('+ Child', 'Add a sub-skill', () => this.#addChild(target.id));
        }
        if (this.model.canApply('addSibling', target.id)) {
            button('+ Sibling', 'Add a skill on the same level', () => this.#addSibling(target.id));
        }
        button('Edit', 'Open this skill (double click)', () => this.onEdit(structuredClone(target)));
        this.tools.replaceChildren(...items);
    }

    #addChild(id) {
        const skill = this.model.addChild(id);
        if (!skill) {
            return;
        }
        this.newSkills.add(skill.id);
        // A leaf becomes a parent: jump into it, so the new sub-skill is visible
        if (id !== this.focus) {
            this.focus = id;
        }
        this.selected = skill.id;
        this.render();
    }

    #addSibling(id) {
        const skill = this.model.addSibling(id);
        if (!skill) {
            return;
        }
        this.newSkills.add(skill.id);
        // The sibling of the focused bubble lies outside of it: show the parent
        if (id === this.focus) {
            this.focus = this.getLayout().parents.get(id);
        }
        this.selected = skill.id;
        this.render();
    }

    #onClick(event) {
        // event.detail > 1: second click of a double click, which opens the skill instead
        if (this.panZoom.moved || event.detail > 1 ||
            event.target.closest('.imixs-actions, .imixs-zoom, .imixs-breadcrumb')) {
            return;
        }
        const element = event.target.closest('.imixs-node');
        if (!element) {
            this.zoomOut();
            return;
        }
        const id = element.dataset.id;
        const { parents } = this.getLayout();
        const hasChildren = [...parents.values()].includes(id);
        if (id === this.focus) {
            this.zoomOut();
        } else if (hasChildren) {
            this.focusOn(id);
        } else if (parents.get(id) === this.focus) {
            this.selected = id;
            this.render();
        } else {
            // A leaf deeper inside: show its parent so it becomes readable
            this.focusOn(parents.get(id));
        }
    }
}
