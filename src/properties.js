/**
 * Fields shown in the property panel, per element kind. Every element and
 * the diagram itself have at least a name and a documentation (as in BPMN).
 * A field with a `when(model, element)` function is only shown if it
 * returns true. Read-only fields show values maintained by the model.
 * Field types: text, textarea, checkbox (default checked) and messages
 * (meta workflow messages, offered from the technical workflows set with
 * setWorkflows). Consecutive fields with the same `row` share one line;
 * `narrow` fields there only take the space they need (e.g. ids).
 */
const FIELDS = {
    diagram: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'version', label: 'Model Version', type: 'text' },
        { key: 'documentation', label: 'Documentation', type: 'textarea' }
    ],
    node: [
        { key: 'name', label: 'Name', type: 'text', row: 'name' },
        {
            key: 'processid', label: 'Process ID', type: 'text', readOnly: true, row: 'name', narrow: true,
            when: (model, node) => node.type === 'task'
        },
        {
            key: 'activityid', label: 'Activity ID', type: 'text', readOnly: true, row: 'name', narrow: true,
            when: (model, node) => node.type === 'event'
        },
        {
            key: 'public', label: 'Public', type: 'checkbox', row: 'name', narrow: true,
            when: (model, node) => node.type === 'event'
        },
        // Meta workflow: messages that start a core process or are received from one
        {
            key: 'messages', label: 'Messages', type: 'messages',
            when: (model, node) => node.type === 'event'
        },
        { key: 'documentation', label: 'Documentation', type: 'textarea' }
    ],
    edge: [
        { key: 'name', label: 'Name', type: 'text' },
        {
            key: 'condition', label: 'Condition', type: 'text',
            when: (model, edge) => model.isConditionalFlow(edge.id)
        },
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
        this.workflows = null;
        this.show(null);
    }

    /**
     * Sets the core workflows offered for meta workflow messages, as
     * { group: [message names] }; null shows a text field instead.
     */
    setWorkflows(workflows) {
        this.workflows = workflows || null;
        this.show(this.selection);
    }

    /**
     * Shows the properties of a node or edge ({ kind, id }) or of the
     * diagram (null).
     */
    show(selection) {
        this.selection = selection;
        const kind = selection ? selection.kind : 'diagram';
        const id = selection ? selection.id : null;
        const element = this.#getElement(kind, id);

        const title = document.createElement('div');
        title.className = 'imixs-properties__title';
        title.textContent = this.#title(kind, element);

        const form = document.createElement('div');
        form.className = 'imixs-properties__form';
        let row = null;
        for (const field of FIELDS[kind]) {
            if (field.when && !field.when(this.model, element)) {
                continue;
            }
            const fieldElement = this.#createField(field, id, element);
            if (!field.row) {
                row = null;
                form.append(fieldElement);
                continue;
            }
            if (row?.dataset.row !== field.row) {
                row = document.createElement('div');
                row.className = 'imixs-properties__row';
                row.dataset.row = field.row;
                form.append(row);
            }
            row.append(fieldElement);
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

    #createField(field, id, element) {
        const value = element.properties[field.key];
        // The messages field holds several controls, a label would forward clicks
        const label = document.createElement(field.type === 'messages' ? 'div' : 'label');
        label.className = `imixs-properties__field imixs-properties__field--${field.type}`;
        label.classList.toggle('imixs-properties__field--narrow', !!field.narrow);

        const caption = document.createElement('span');
        caption.className = 'imixs-properties__label';
        caption.textContent = field.label;

        if (field.type === 'messages') {
            label.append(caption, this.#createMessages(id, value || []));
            return label;
        }
        if (field.type === 'checkbox') {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = value !== false;
            checkbox.addEventListener('change', () => this.model.setProperty(id, field.key, checkbox.checked));
            label.append(caption, checkbox);
            return label;
        }
        const input = document.createElement(field.type === 'textarea' ? 'textarea' : 'input');
        if (field.type !== 'textarea') {
            input.type = 'text';
        }
        input.value = value ?? '';
        if (field.readOnly) {
            input.readOnly = true;
        } else {
            input.addEventListener('input', () => this.model.setProperty(id, field.key, input.value));
        }

        label.append(caption, input);
        return label;
    }

    /**
     * List of meta workflow messages ('Group:Message') with a remove button
     * each, and a row to add one: workflow and message from the technical
     * workflows, or a text field if the host did not set them.
     */
    #createMessages(id, messages) {
        const container = document.createElement('div');
        container.className = 'imixs-messages';
        const update = list => {
            this.model.setProperty(id, 'messages', list);
            this.show(this.selection);
        };

        // The messages in their own line, the row to add one below
        const list = document.createElement('div');
        list.className = 'imixs-messages__list';
        for (const message of messages) {
            const chip = document.createElement('span');
            chip.className = 'imixs-messages__item';
            chip.textContent = message;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.textContent = '×';
            remove.title = 'Remove this message';
            remove.addEventListener('click', () => update(messages.filter(m => m !== message)));
            chip.append(remove);
            list.append(chip);
        }
        if (messages.length > 0) {
            container.append(list);
        }

        const add = document.createElement('div');
        add.className = 'imixs-messages__add';
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = '+ Add';
        let selected;
        if (this.workflows) {
            const group = document.createElement('select');
            const message = document.createElement('select');
            group.append(new Option('Workflow…', ''), ...Object.keys(this.workflows).map(name => new Option(name, name)));
            const fillMessages = () => message.replaceChildren(new Option('Message…', ''),
                ...(this.workflows[group.value] || []).map(name => new Option(name, name)));
            group.addEventListener('change', fillMessages);
            fillMessages();
            add.append(group, message);
            selected = () => group.value && message.value ? `${group.value}:${message.value}` : '';
        } else {
            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = 'Workflow:Message';
            input.addEventListener('keydown', event => {
                if (event.key === 'Enter') {
                    button.click();
                }
            });
            add.append(input);
            selected = () => input.value.trim();
        }
        button.addEventListener('click', () => {
            const name = selected();
            if (name && !messages.includes(name)) {
                update([...messages, name]);
            }
        });
        add.append(button);
        container.append(add);
        return container;
    }
}
