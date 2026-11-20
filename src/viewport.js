/**
 * Viewport math for pan and zoom.
 *
 * A view is { x, y, scale }: the diagram point (0, 0) is shown at screen
 * position (x, y), one diagram pixel is `scale` screen pixels wide.
 * Screen coordinates are relative to the host element.
 *
 * All coordinate transforms between screen and diagram live here, so the
 * rest of the editor never computes them on its own. Pure functions,
 * DOM-free.
 */

/** Smallest allowed zoom factor. */
export const MIN_SCALE = 0.25;

/** Largest allowed zoom factor. */
export const MAX_SCALE = 8;

/**
 * Limits a zoom factor to the allowed range.
 */
export function clampScale(scale) {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Converts a screen point into diagram coordinates.
 */
export function toDiagram(view, point) {
    return {
        x: (point.x - view.x) / view.scale,
        y: (point.y - view.y) / view.scale
    };
}

/**
 * Converts a diagram point into screen coordinates.
 */
export function toScreen(view, point) {
    return {
        x: view.x + point.x * view.scale,
        y: view.y + point.y * view.scale
    };
}

/**
 * Returns a view zoomed to the given scale, keeping the diagram point
 * under the given screen point in place (zoom at mouse position).
 */
export function zoomAt(view, scale, point) {
    const newScale = clampScale(scale);
    const anchor = toDiagram(view, point);
    return {
        x: point.x - anchor.x * newScale,
        y: point.y - anchor.y * newScale,
        scale: newScale
    };
}

/**
 * Returns a view that shows the whole diagram centered in the host.
 * The diagram is never enlarged beyond 100%.
 *
 * @param {{width:number, height:number}} content - diagram size
 * @param {{width:number, height:number}} host - visible area
 */
export function fitToView(content, host) {
    const scale = clampScale(Math.min(1, host.width / content.width, host.height / content.height));
    return {
        x: Math.round((host.width - content.width * scale) / 2),
        y: Math.round((host.height - content.height * scale) / 2),
        scale
    };
}

/**
 * Returns a view that shows the given diagram rectangle centered in the
 * host, filling the given share of the host (e.g. a bubble of a skill map).
 *
 * @param {{x:number, y:number, width:number, height:number}} rect - diagram coordinates
 * @param {{width:number, height:number}} host - visible area
 * @param {number} [fill] - share of the host the rectangle should fill
 */
export function fitRect(rect, host, fill = 0.9) {
    const scale = clampScale(Math.min(host.width / rect.width, host.height / rect.height) * fill);
    return {
        x: host.width / 2 - (rect.x + rect.width / 2) * scale,
        y: host.height / 2 - (rect.y + rect.height / 2) * scale,
        scale
    };
}

/**
 * Returns the view between two views at progress t (0 … 1). The scale is
 * interpolated logarithmically and the position follows it, so the point
 * in the middle of the screen moves smoothly while zooming.
 */
export function interpolateView(from, to, t, host) {
    const scale = from.scale * Math.pow(to.scale / from.scale, t);
    const center = view => toDiagram(view, { x: host.width / 2, y: host.height / 2 });
    const a = center(from);
    const b = center(to);
    const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    return { x: host.width / 2 - point.x * scale, y: host.height / 2 - point.y * scale, scale };
}
