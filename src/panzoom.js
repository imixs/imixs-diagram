import { fitToView, toDiagram, toScreen, zoomAt } from './viewport.js';

/** Zoom step of the toolbar buttons. */
const BUTTON_ZOOM_FACTOR = 1.2;

/** Zoom sensitivity of the mouse wheel and touchpad pinch. */
const WHEEL_ZOOM_SPEED = 0.0015;

/**
 * PanZoom moves and scales the diagram content inside the host.
 *
 *  - Drag on empty space pans the diagram.
 *  - Mouse wheel (and touchpad pinch) zooms at the mouse position, like
 *    in Open-BPMN.
 *  - A small toolbar offers zoom in, zoom out, 100% and fit.
 *
 * The view ({ x, y, scale }) is pure view state and not stored in the model.
 */
export class PanZoom {

    /**
     * @param {HTMLElement} host - visible area, receives pointer and wheel events
     * @param {HTMLElement} content - element that is transformed
     * @param {function(): {width:number, height:number}} contentSize - current diagram size
     */
    constructor(host, content, contentSize) {
        this.host = host;
        this.content = content;
        this.contentSize = contentSize;
        this.view = { x: 0, y: 0, scale: 1 };
        this.listeners = [];

        this.#createToolbar();
        host.addEventListener('pointerdown', event => this.#onPointerDown(event));
        host.addEventListener('wheel', event => this.#onWheel(event), { passive: false });
        this.#apply();
    }

    /**
     * Registers a callback that is called after each view change.
     */
    onChange(callback) {
        this.listeners.push(callback);
    }

    /**
     * Converts a diagram point into host coordinates.
     */
    toScreen(point) {
        return toScreen(this.view, point);
    }

    /**
     * Converts a pointer event position into diagram coordinates.
     */
    eventToDiagram(event) {
        return toDiagram(this.view, this.#hostPoint(event));
    }

    /**
     * Shows the whole diagram, never enlarged beyond 100%.
     */
    fit() {
        this.#setView(fitToView(this.contentSize(), this.#hostSize()));
    }

    /**
     * Fits the diagram only if it does not fit into the host at 100%.
     */
    fitIfNeeded() {
        const content = this.contentSize();
        const host = this.#hostSize();
        if (content.width > host.width || content.height > host.height) {
            this.fit();
        }
    }

    /**
     * Zooms by the given factor around the center of the host.
     */
    zoomBy(factor) {
        const host = this.#hostSize();
        this.#zoomTo(this.view.scale * factor, { x: host.width / 2, y: host.height / 2 });
    }

    /**
     * Resets the zoom to 100%, keeping the center of the host in place.
     */
    resetZoom() {
        const host = this.#hostSize();
        this.#zoomTo(1, { x: host.width / 2, y: host.height / 2 });
    }

    #zoomTo(scale, point) {
        this.#setView(zoomAt(this.view, scale, point));
    }

    #setView(view) {
        this.view = view;
        this.#apply();
        for (const callback of this.listeners) {
            callback(this.view);
        }
    }

    #apply() {
        const { x, y, scale } = this.view;
        this.content.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
        this.host.style.setProperty('--imixs-view-x', x + 'px');
        this.host.style.setProperty('--imixs-view-y', y + 'px');
        this.host.style.setProperty('--imixs-view-scale', scale);
        this.zoomLabel.textContent = Math.round(scale * 100) + '%';
    }

    /** Pointer position relative to the inner edge of the host. */
    #hostPoint(event) {
        const rect = this.host.getBoundingClientRect();
        return {
            x: event.clientX - rect.left - this.host.clientLeft,
            y: event.clientY - rect.top - this.host.clientTop
        };
    }

    #hostSize() {
        return { width: this.host.clientWidth, height: this.host.clientHeight };
    }

    #createToolbar() {
        const toolbar = document.createElement('div');
        toolbar.className = 'imixs-zoom';
        const button = (text, title, action) => {
            const element = document.createElement('button');
            element.type = 'button';
            element.textContent = text;
            element.title = title;
            element.addEventListener('click', action);
            toolbar.append(element);
            return element;
        };
        button('−', 'Zoom out', () => this.zoomBy(1 / BUTTON_ZOOM_FACTOR));
        this.zoomLabel = button('100%', 'Reset zoom to 100%', () => this.resetZoom());
        this.zoomLabel.classList.add('imixs-zoom__level');
        button('+', 'Zoom in', () => this.zoomBy(BUTTON_ZOOM_FACTOR));
        button('Fit', 'Show the whole diagram', () => this.fit());
        this.host.append(toolbar);
    }

    /**
     * Drag on empty space pans the diagram. Nodes, edges and toolbars keep
     * their own pointer handling.
     */
    #onPointerDown(event) {
        if (event.button !== 0 ||
            event.target.closest('.imixs-node, .imixs-edge-group, .imixs-actions, .imixs-zoom')) {
            return;
        }
        const start = { pointerX: event.clientX, pointerY: event.clientY, x: this.view.x, y: this.view.y };
        this.host.setPointerCapture(event.pointerId);
        this.host.classList.add('is-panning');

        const onMove = moveEvent => {
            this.#setView({
                ...this.view,
                x: start.x + moveEvent.clientX - start.pointerX,
                y: start.y + moveEvent.clientY - start.pointerY
            });
        };
        const onEnd = () => {
            this.host.classList.remove('is-panning');
            this.host.removeEventListener('pointermove', onMove);
            this.host.removeEventListener('pointerup', onEnd);
            this.host.removeEventListener('pointercancel', onEnd);
        };
        this.host.addEventListener('pointermove', onMove);
        this.host.addEventListener('pointerup', onEnd);
        this.host.addEventListener('pointercancel', onEnd);
    }

    /**
     * The mouse wheel zooms at the mouse position.
     */
    #onWheel(event) {
        event.preventDefault();
        this.#zoomTo(this.view.scale * Math.exp(-event.deltaY * WHEEL_ZOOM_SPEED), this.#hostPoint(event));
    }
}
