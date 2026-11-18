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
export const MAX_SCALE = 2.5;

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
