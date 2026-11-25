import { fitToView, fitRect, interpolateView, toDiagram, toScreen, zoomAt } from './viewport.js';

/** Pointer movement in pixels after which a drag pans the diagram. */
const PAN_THRESHOLD = 4;

/** Duration of animated camera moves in milliseconds. */
const ANIMATION_DURATION = 650;

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
 *  - A small toolbar offers zoom in, zoom out, 100% and fit; further
 *    buttons can be added with addButton().
 *
 * The view ({ x, y, scale }) is pure view state and not stored in the model.
 */
export class PanZoom {

    /**
     * @param {HTMLElement} host - visible area, receives pointer and wheel events
     * @param {HTMLElement} content - element that is transformed
     * @param {function(): {width:number, height:number}} contentSize - current diagram size
     * @param {{panOnNodes?: boolean}} [options] - allow panning by dragging nodes (skill map)
     */
    constructor(host, content, contentSize, options = {}) {
        this.panOnNodes = !!options.panOnNodes;
        /** True if the last pointer gesture panned the diagram (then it was no click). */
        this.moved = false;
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
     * Moves the camera so that the given diagram rectangle fills the host,
     * with a smooth animation unless `animate` is false.
     */
    focusRect(rect, animate = true) {
        const target = fitRect(rect, this.#hostSize());
        cancelAnimationFrame(this.animation);
        if (!animate) {
            this.#setView(target);
            return;
        }
        const from = this.view;
        const host = this.#hostSize();
        const start = performance.now();
        const step = now => {
            const t = Math.min(1, (now - start) / ANIMATION_DURATION);
            const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            this.#setView(t < 1 ? interpolateView(from, target, eased, host) : target);
            if (t < 1) {
                this.animation = requestAnimationFrame(step);
            }
        };
        this.animation = requestAnimationFrame(step);
    }

    /**
     * Initial view after loading: the whole diagram centered, never enlarged
     * beyond 100%. If the host has no size yet (e.g. inside a hidden tab of
     * the host page), the fit waits until it becomes visible.
     */
    fitOnLoad() {
        const host = this.#hostSize();
        if (host.width > 0 && host.height > 0) {
            this.fit();
            return;
        }
        const observer = new ResizeObserver(() => {
            const size = this.#hostSize();
            if (size.width > 0 && size.height > 0) {
                observer.disconnect();
                this.fit();
            }
        });
        observer.observe(this.host);
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
        this.toolbar = document.createElement('div');
        this.toolbar.className = 'imixs-zoom';
        this.addButton('−', 'Zoom out', () => this.zoomBy(1 / BUTTON_ZOOM_FACTOR));
        this.zoomLabel = this.addButton('100%', 'Reset zoom to 100%', () => this.resetZoom());
        this.zoomLabel.classList.add('imixs-zoom__level');
        this.addButton('+', 'Zoom in', () => this.zoomBy(BUTTON_ZOOM_FACTOR));
        this.addButton('Fit', 'Show the whole diagram', () => this.fit());
        this.host.append(this.toolbar);
    }

    /**
     * Adds a button to the toolbar and returns it. With `first`, the button
     * is placed in a group before the zoom buttons (e.g. undo / redo).
     */
    addButton(text, title, action, first = false) {
        const element = document.createElement('button');
        element.type = 'button';
        element.textContent = text;
        element.title = title;
        element.addEventListener('click', action);
        if (first) {
            this.toolbar.insertBefore(element, this.toolbar.querySelector('.imixs-zoom__group') ||
                this.#startGroup());
        } else {
            this.toolbar.append(element);
        }
        return element;
    }

    /** Separator between the leading buttons and the zoom buttons. */
    #startGroup() {
        const separator = document.createElement('span');
        separator.className = 'imixs-zoom__group';
        this.toolbar.prepend(separator);
        return separator;
    }

    /**
     * Drag on empty space pans the diagram. Nodes, edges and toolbars keep
     * their own pointer handling.
     */
    #onPointerDown(event) {
        const excluded = this.panOnNodes
            ? '.imixs-actions, .imixs-zoom, .imixs-breadcrumb, .imixs-properties'
            : '.imixs-node, .imixs-edge-group, .imixs-actions, .imixs-zoom, .imixs-breadcrumb, .imixs-properties';
        if (event.button !== 0 || event.target.closest(excluded)) {
            return;
        }
        const start = { pointerX: event.clientX, pointerY: event.clientY, x: this.view.x, y: this.view.y };
        let panning = false;
        this.moved = false;

        const onMove = moveEvent => {
            // Panning starts after a few pixels, so a click stays a click on its element
            if (!panning) {
                if (Math.hypot(moveEvent.clientX - start.pointerX, moveEvent.clientY - start.pointerY) < PAN_THRESHOLD) {
                    return;
                }
                panning = true;
                this.moved = true;
                cancelAnimationFrame(this.animation);
                this.host.setPointerCapture(moveEvent.pointerId);
                this.host.classList.add('is-panning');
            }
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
        // The floating property panel scrolls its own content
        if (event.target.closest('.imixs-properties')) {
            return;
        }
        event.preventDefault();
        cancelAnimationFrame(this.animation);
        this.#zoomTo(this.view.scale * Math.exp(-event.deltaY * WHEEL_ZOOM_SPEED), this.#hostPoint(event));
    }
}
