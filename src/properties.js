import { placePanel } from './viewport.js';

/**
 * PropertyPanel shows and edits the properties of an element or of the
 * diagram itself in a panel that floats next to the element, connected by
 * a dashed line. It opens on double click (the diagram: double click on
 * the empty canvas or the ⚙ button), follows the selection while open and
 * closes with ×, Esc or a click on the empty canvas.
 *
 * Fields, title and style come from the panel options of the diagram type
 * profile (src/types.js); an element kind without fields does not open the
 * panel. Every input changes the model immediately. The form is only rebuilt when
 * the selection changes, so typing never loses focus.
 */
export class PropertyPanel {

    /**
     * @param {HTMLElement} host - canvas element; the panel floats above the
     *   diagram, outside the zoomed content
     * @param {DiagramModel} model
     * @param {function(object): ({x:number, y:number, width:number, height:number}|null)} anchorOf -
     *   host rectangle of the selected element ({ kind, id, x, y }), null for the diagram
     * @param {{fields: object, caption?: function(object): string, className?: string}} options -
     *   panel options of the diagram type profile
     */
    constructor(host, model, anchorOf, options) {
        this.host = host;
        this.model = model;
        this.anchorOf = anchorOf;
        this.fields = options.fields;
        this.caption = options.caption;
        this.workflows = null;
        this.selection = null;
        this.isOpen = false;

        this.link = document.createElement('div');
        this.link.className = 'imixs-properties__link';
        this.container = document.createElement('div');
        this.container.className = 'imixs-properties';
        if (options.className) {
            this.container.classList.add(options.className);
        }
        this.link.hidden = this.container.hidden = true;
        host.append(this.link, this.container);

        // Esc closes the panel, also from a field; the selection stays
        this.container.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                this.close();
                host.focus();
            }
        });
    }

    /**
     * Opens the panel for a node or edge ({ kind, id }) or the diagram (null),
     * or moves the open panel to it.
     */
    open(selection) {
        this.isOpen = true;
        this.container.hidden = false;
        this.show(selection);
    }

    /** Closes the panel. */
    close() {
        this.isOpen = false;
        this.container.hidden = this.link.hidden = true;
    }

    /**
     * Moves the open panel next to its element after the view was panned,
     * zoomed or laid out again.
     */
    updatePosition() {
        if (!this.isOpen) {
            return;
        }
        const anchor = this.anchorOf(this.selection);
        const place = placePanel(anchor,
            { width: this.container.offsetWidth, height: this.container.offsetHeight },
            { width: this.host.clientWidth, height: this.host.clientHeight });
        this.container.style.left = Math.round(place.x) + 'px';
        this.container.style.top = Math.round(place.y) + 'px';
        this.link.hidden = !place.link;
        if (place.link) {
            this.link.style.left = Math.round(Math.min(place.link.x1, place.link.x2)) + 'px';
            this.link.style.top = Math.round(place.link.y) + 'px';
            this.link.style.width = Math.round(Math.abs(place.link.x2 - place.link.x1)) + 'px';
        }
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
     * diagram (null) in the open panel.
     */
    show(selection) {
        this.selection = selection;
        if (!this.isOpen) {
            return;
        }
        const kind = selection ? selection.kind : 'diagram';
        const id = selection ? selection.id : null;
        const element = this.#getElement(kind, id);
        const fields = this.fields[kind];
        if (!element || !fields) {
            this.close();
            return;
        }

        const title = document.createElement('div');
        title.className = 'imixs-properties__title';
        const caption = document.createElement('span');
        caption.textContent = this.caption && kind !== 'diagram'
            ? this.caption(element)
            : `Properties · ${this.#title(kind, element)}`;
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = '×';
        close.title = 'Close (Esc)';
        close.addEventListener('click', () => this.close());
        title.append(caption, close);

        const form = document.createElement('div');
        form.className = 'imixs-properties__form';
        let row = null;
        for (const field of fields) {
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
        this.updatePosition();
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
        if (field.type === 'roles') {
            return this.#createRoles(value || []);
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
     * Roles of an org unit side by side, read-only: one column per role
     * ({ name, members }) with its name as heading and a list of members.
     */
    #createRoles(roles) {
        const container = document.createElement('div');
        container.className = 'imixs-roles';
        for (const role of roles) {
            const column = document.createElement('div');
            column.className = 'imixs-roles__column';
            const heading = document.createElement('span');
            heading.className = 'imixs-properties__label';
            heading.textContent = role.name || '';
            const list = document.createElement('ul');
            for (const member of role.members || []) {
                const item = document.createElement('li');
                item.textContent = member;
                list.append(item);
            }
            if (list.childElementCount === 0) {
                const empty = document.createElement('li');
                empty.className = 'imixs-roles__empty';
                empty.textContent = '—';
                list.append(empty);
            }
            column.append(heading, list);
            container.append(column);
        }
        return container;
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
