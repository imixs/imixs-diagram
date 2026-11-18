/**
 * Orthogonal ("Manhattan") edge router.
 *
 * The router computes the route points of an edge automatically from the
 * bounds of the source and target node. Users never edit route points.
 *
 * Strategy:
 *  - Nodes share a common height (or width) range: straight edge.
 *  - Enough horizontal space between the nodes: leave the source on the
 *    left/right side and enter the target on the opposite side (Z-shape).
 *  - Enough vertical space: same with top/bottom sides.
 *  - Nodes too close or overlapping: leave the source horizontally and
 *    enter the target vertically (L-shape).
 *
 * Edges always attach at the middle of a node side. For round nodes this
 * point lies exactly on the circle, for diamonds it is a corner.
 *
 * Loops and edges that would cross other nodes are routed as an arc
 * around the nodes (see computeArcRoute).
 */

/** Minimum gap between two nodes to route a Z-shape in that direction. */
const MIN_GAP = 20;

/** Default corner radius of the rendered path. */
const CORNER_RADIUS = 8;

/** Straight edges keep this distance to the corners of rectangular nodes. */
const CORNER_MARGIN = 10;

/** Distance between an arc and the nodes it goes around. */
const ARC_OFFSET = 25;

/**
 * Computes the orthogonal route between two nodes.
 *
 * @param {{x:number, y:number, width:number, height:number}} source
 * @param {{x:number, y:number, width:number, height:number}} target
 * @returns {{x:number, y:number}[]} route points from source to target
 */
export function computeRoute(source, target) {
    const s = sides(source);
    const t = sides(target);
    const dx = t.centerX - s.centerX;
    const dy = t.centerY - s.centerY;

    const gapX = dx >= 0 ? t.left - s.right : s.left - t.right;
    const gapY = dy >= 0 ? t.top - s.bottom : s.top - t.bottom;
    const horizontalPreferred = Math.abs(dx) >= Math.abs(dy);

    let points;
    if (gapX >= MIN_GAP && (horizontalPreferred || gapY < MIN_GAP)) {
        // Straight horizontal line if both nodes share a common height range
        const y = sharedCoordinate(source, target, 'y');
        if (y !== null) {
            return [
                { x: sideCoordinate(source, 'x', dx >= 0 ? 1 : -1, y), y },
                { x: sideCoordinate(target, 'x', dx >= 0 ? -1 : 1, y), y }
            ];
        }
        // Z-shape: horizontal - vertical - horizontal
        const start = { x: dx >= 0 ? s.right : s.left, y: s.centerY };
        const end = { x: dx >= 0 ? t.left : t.right, y: t.centerY };
        const midX = (start.x + end.x) / 2;
        points = [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
    } else if (gapY >= MIN_GAP) {
        // Straight vertical line if both nodes share a common width range
        const x = sharedCoordinate(source, target, 'x');
        if (x !== null) {
            return [
                { x, y: sideCoordinate(source, 'y', dy >= 0 ? 1 : -1, x) },
                { x, y: sideCoordinate(target, 'y', dy >= 0 ? -1 : 1, x) }
            ];
        }
        // Z-shape: vertical - horizontal - vertical
        const start = { x: s.centerX, y: dy >= 0 ? s.bottom : s.top };
        const end = { x: t.centerX, y: dy >= 0 ? t.top : t.bottom };
        const midY = (start.y + end.y) / 2;
        points = [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
    } else {
        // L-shape: leave horizontally, enter vertically
        const start = { x: dx >= 0 ? s.right : s.left, y: s.centerY };
        const end = { x: t.centerX, y: dy >= 0 ? t.top : t.bottom };
        points = [start, { x: end.x, y: start.y }, end];
    }
    return simplify(points);
}

/**
 * Computes a route that goes around the nodes as an arc: leave the source
 * vertically, run horizontally beside both nodes, enter the target
 * vertically. Used for loops (back edges) and edges skipping nodes.
 *
 * The arc runs above both nodes, or below them if the source lies lower
 * than the target, so it does not cross the rows in between.
 *
 * @param {{x:number, y:number, width:number, height:number}} source
 * @param {{x:number, y:number, width:number, height:number}} target
 * @returns {{x:number, y:number}[]} route points from source to target
 */
export function computeArcRoute(source, target) {
    const s = sides(source);
    const t = sides(target);
    if (s.centerY > t.centerY) {
        const y = Math.max(s.bottom, t.bottom) + ARC_OFFSET;
        return simplify([
            { x: s.centerX, y: s.bottom }, { x: s.centerX, y },
            { x: t.centerX, y }, { x: t.centerX, y: t.bottom }
        ]);
    }
    const y = Math.min(s.top, t.top) - ARC_OFFSET;
    return simplify([
        { x: s.centerX, y: s.top }, { x: s.centerX, y },
        { x: t.centerX, y }, { x: t.centerX, y: t.top }
    ]);
}

/**
 * Converts route points into an SVG path with rounded corners.
 * The radius shrinks automatically on short segments.
 *
 * @param {{x:number, y:number}[]} points
 * @param {number} radius - corner radius in pixels
 * @returns {string} SVG path data
 */
export function toRoundedPath(points, radius = CORNER_RADIUS) {
    if (points.length === 0) {
        return '';
    }
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
        const prev = points[i - 1];
        const corner = points[i];
        const next = points[i + 1];
        const r = Math.min(radius, distance(prev, corner) / 2, distance(corner, next) / 2);
        const before = moveTowards(corner, prev, r);
        const after = moveTowards(corner, next, r);
        d += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`;
    }
    const last = points[points.length - 1];
    d += ` L ${last.x} ${last.y}`;
    return d;
}

/**
 * Returns a coordinate on the given axis ('x' or 'y') that both nodes share,
 * so that a straight edge can connect them, or null if there is none.
 *
 * Rectangles keep a margin to their corners. Circles only allow the inner
 * part of their diameter; if one node is a circle its center is preferred.
 * Diamonds only allow their center (the corner of the diamond).
 */
function sharedCoordinate(a, b, axis) {
    const ra = attachRange(a, axis);
    const rb = attachRange(b, axis);
    const low = Math.max(ra.low, rb.low);
    const high = Math.min(ra.high, rb.high);
    if (low > high) {
        return null;
    }
    let preferred = (low + high) / 2;
    if (a.shape === 'circle' || a.shape === 'diamond') {
        preferred = ra.center;
    } else if (b.shape === 'circle' || b.shape === 'diamond') {
        preferred = rb.center;
    }
    return Math.round(Math.min(high, Math.max(low, preferred)));
}

function attachRange(bounds, axis) {
    const start = axis === 'y' ? bounds.y : bounds.x;
    const size = axis === 'y' ? bounds.height : bounds.width;
    const center = start + size / 2;
    if (bounds.shape === 'circle') {
        return { low: center - size / 4, high: center + size / 4, center };
    }
    if (bounds.shape === 'diamond') {
        return { low: center, high: center, center };
    }
    return { low: start + CORNER_MARGIN, high: start + size - CORNER_MARGIN, center };
}

/**
 * Returns the position of the node border on the given axis at the given
 * cross coordinate. direction 1 = right/bottom side, -1 = left/top side.
 */
function sideCoordinate(bounds, axis, direction, cross) {
    const start = axis === 'x' ? bounds.x : bounds.y;
    const size = axis === 'x' ? bounds.width : bounds.height;
    if (bounds.shape === 'circle') {
        const r = size / 2;
        const crossCenter = axis === 'x' ? bounds.y + bounds.height / 2 : bounds.x + bounds.width / 2;
        const offset = cross - crossCenter;
        return Math.round(start + r + direction * Math.sqrt(r * r - offset * offset));
    }
    return direction > 0 ? start + size : start;
}

function sides(bounds) {
    return {
        left: bounds.x,
        right: bounds.x + bounds.width,
        top: bounds.y,
        bottom: bounds.y + bounds.height,
        centerX: bounds.x + bounds.width / 2,
        centerY: bounds.y + bounds.height / 2
    };
}

/**
 * Removes duplicate points and points that lie on a straight line between
 * their neighbors, so that aligned nodes get a straight edge without corners.
 */
function simplify(points) {
    const unique = points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
    return unique.filter((p, i) => {
        if (i === 0 || i === unique.length - 1) {
            return true;
        }
        const prev = unique[i - 1];
        const next = unique[i + 1];
        return !((prev.x === p.x && p.x === next.x) || (prev.y === p.y && p.y === next.y));
    });
}

function distance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

function moveTowards(from, to, length) {
    const d = distance(from, to);
    return {
        x: from.x + (to.x - from.x) * length / d,
        y: from.y + (to.y - from.y) * length / d
    };
}
