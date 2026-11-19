/**
 * Fields shown in the property panel, per element kind. Every element and
 * the diagram itself have at least a name and a documentation (as in BPMN).
 */
const FIELDS = {
    diagram: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'documentation', label: 'Documentation', type: 'textarea' }
    ],
    node: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'documentation', label: 'Documentation', type: 'textarea' }
    ],
    edge: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'documentation', label: 'Documentation', type: 'textarea' }
    ]
};

/**
 * PropertyPanel shows and edits the properties of the selected element,
 * or of the diagram itself if nothing is selected.
 *
 * Every input changes the model immediately. The form is only rebuilt when
 * the selection changes, so typing never loses focus.
 */
export class PropertyPanel {

    /**
     * @param {HTMLElement} container - element that holds the panel
     * @param {DiagramModel} model
     */
    constructor(container, model) {
        this.container = container;
        this.model = model;
        this.show(null);
    }

    /**
     * Shows the properties of a node or edge ({ kind, id }) or of the
     * diagram (null).
     */
    show(selection) {
        const kind = selection ? selection.kind : 'diagram';
        const id = selection ? selection.id : null;
        const element = this.#getElement(kind, id);

        const title = document.createElement('div');
        title.className = 'imixs-properties__title';
        title.textContent = this.#title(kind, element);

        const form = document.createElement('div');
        form.className = 'imixs-properties__form';
        for (const field of FIELDS[kind]) {
            form.append(this.#createField(field, id, element.properties[field.key]));
        }
        this.container.replaceChildren(title, form);
    }

    /**
     * Moves the focus into the first field and selects its text.
     */
    focus() {
        const input = this.container.querySelector('input, textarea');
        input?.focus();
        input?.select();
    }

    #getElement(kind, id) {
        if (kind === 'node') {
            return this.model.getNode(id);
        }
        if (kind === 'edge') {
            return this.model.getEdge(id);
        }
        return this.model;
    }

    #title(kind, element) {
        if (kind === 'node') {
            return `${element.type} · ${element.id}`;
        }
        if (kind === 'edge') {
            const name = id => this.model.getNode(id)?.properties.name || id;
            return `edge · ${name(element.source)} → ${name(element.target)}`;
        }
        return 'process';
    }

    #createField(field, id, value) {
        const label = document.createElement('label');
        label.className = `imixs-properties__field imixs-properties__field--${field.type}`;

        const caption = document.createElement('span');
        caption.className = 'imixs-properties__label';
        caption.textContent = field.label;

        const input = document.createElement(field.type === 'textarea' ? 'textarea' : 'input');
        if (field.type !== 'textarea') {
            input.type = 'text';
        }
        input.value = value || '';
        input.addEventListener('input', () => this.model.setProperty(id, field.key, input.value));

        label.append(caption, input);
        return label;
    }
}
