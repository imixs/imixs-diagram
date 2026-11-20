/**
 * Circle packing layout for skill maps.
 *
 * Every node is a circle; the children of a node are packed as smaller
 * circles inside it, so the hierarchy is shown by nesting instead of edges.
 * Leaves have a fixed radius, a parent is as large as it must be to hold
 * its children, so the size only depends on the number of sub-skills.
 *
 * Packing of siblings: circles are placed one after the other, largest
 * first, each one touching two already placed circles, at the free
 * position closest to the center. The enclosing circle is then computed
 * and the children are centered in their parent.
 *
 * Unlike the other layouts, the size of a node is computed here (not by
 * CSS). It is returned for rendering only and not stored in the model.
 * Pure function, DOM-free.
 */

/** Radius of a skill without sub-skills. */
const LEAF_RADIUS = 38;

/** Gap between two sibling circles. */
const GAP = 8;

/** Space between the children and the border of their parent, relative to the parent radius. */
const PADDING = 0.12;

/** Distance between the canvas border and the root circle. */
const MARGIN = 40;

/**
 * Computes position and size of all nodes of a tree.
 *
 * @param {{id:string}[]} nodes
 * @param {{source:string, target:string}[]} edges - parent → child
 * @returns {{positions: Map<string, {x:number, y:number}>, sizes: Map<string, {width:number, height:number}>,
 *   circles: Map<string, {x:number, y:number, r:number}>, depths: Map<string, number>,
 *   parents: Map<string, string>, arcEdges: Set<string>, routing: string, width:number, height:number}}
 *   positions are top-left corners, circles hold center and radius.
 */
export function computePackLayout(nodes, edges) {
    const ids = new Set(nodes.map(node => node.id));
    const children = new Map(nodes.map(node => [node.id, []]));
    const parents = new Map();
    for (const edge of edges) {
        if (ids.has(edge.source) && ids.has(edge.target) && !parents.has(edge.target)) {
            children.get(edge.source).push(edge.target);
            parents.set(edge.target, edge.source);
        }
    }

    // Bottom up: radius of every node and offsets of its children (relative to its center)
    const radius = new Map();
    const offsets = new Map();
    const depths = new Map();
    const measure = (id, depth) => {
        depths.set(id, depth);
        const kids = children.get(id).filter(child => !depths.has(child));
        if (kids.length === 0) {
            radius.set(id, LEAF_RADIUS);
            offsets.set(id, new Map());
            return;
        }
        kids.forEach(child => measure(child, depth + 1));
        const circles = packSiblings(kids.map(child => ({ id: child, r: radius.get(child) })));
        const enclosing = enclose(circles);
        const r = enclosing.r / (1 - PADDING);
        radius.set(id, r);
        offsets.set(id, new Map(circles.map(c => [c.id, { x: c.x - enclosing.x, y: c.y - enclosing.y }])));
    };

    // Top down: absolute centers. Several roots (invalid data) are placed side by side.
    const circles = new Map();
    const place = (id, x, y) => {
        circles.set(id, { x, y, r: radius.get(id) });
        for (const [child, offset] of offsets.get(id)) {
            place(child, x + offset.x, y + offset.y);
        }
    };
    let left = MARGIN;
    let height = 0;
    for (const node of [...nodes.filter(node => !parents.has(node.id)), ...nodes]) {
        if (!depths.has(node.id)) {
            measure(node.id, 0);
            const r = radius.get(node.id);
            place(node.id, left + r, MARGIN + r);
            left += 2 * r + MARGIN;
            height = Math.max(height, 2 * r + 2 * MARGIN);
        }
    }

    const positions = new Map();
    const sizes = new Map();
    for (const [id, c] of circles) {
        positions.set(id, { x: Math.round(c.x - c.r), y: Math.round(c.y - c.r) });
        sizes.set(id, { width: Math.round(2 * c.r), height: Math.round(2 * c.r) });
    }
    return {
        positions, sizes, circles, depths, parents,
        arcEdges: new Set(), routing: 'none', width: Math.round(left), height: Math.round(height)
    };
}

/**
 * Places sibling circles ({ id, r }) without overlap, compact around the
 * origin. Returns the circles with their centers ({ id, r, x, y }).
 */
export function packSiblings(circles) {
    const sorted = [...circles].sort((a, b) => b.r - a.r);
    const placed = [];
    for (const circle of sorted) {
        if (placed.length === 0) {
            placed.push({ ...circle, x: 0, y: 0 });
            continue;
        }
        if (placed.length === 1) {
            placed.push({ ...circle, x: placed[0].r + circle.r + GAP, y: 0 });
            continue;
        }
        // Candidate positions touch two placed circles; take the free one closest to the center
        let best = null;
        for (let i = 0; i < placed.length; i++) {
            for (let j = i + 1; j < placed.length; j++) {
                for (const point of touching(placed[i], placed[j], circle.r + GAP)) {
                    const free = placed.every(other =>
                        Math.hypot(point.x - other.x, point.y - other.y) >= other.r + circle.r + GAP - 0.001);
                    const distance = Math.hypot(point.x, point.y);
                    if (free && (!best || distance < best.distance)) {
                        best = { ...point, distance };
                    }
                }
            }
        }
        placed.push({ ...circle, x: best.x, y: best.y });
    }
    return placed;
}

/**
 * The (up to two) centers of a circle with radius r that touches both
 * circles a and b (each with an additional gap included in r).
 */
function touching(a, b, r) {
    const da = a.r + r;
    const db = b.r + r;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d === 0 || d > da + db || d < Math.abs(da - db)) {
        return [];
    }
    const along = (da * da - db * db + d * d) / (2 * d);
    const across = Math.sqrt(Math.max(0, da * da - along * along));
    const mx = a.x + dx * along / d;
    const my = a.y + dy * along / d;
    return [
        { x: mx - dy * across / d, y: my + dx * across / d },
        { x: mx + dy * across / d, y: my - dx * across / d }
    ];
}

/**
 * Returns a small circle ({ x, y, r }) that encloses all given circles.
 * Iterative approximation: the center moves towards the farthest circle
 * with a shrinking step, which converges to the minimal enclosing circle.
 */
export function enclose(circles) {
    let x = circles.reduce((sum, c) => sum + c.x, 0) / circles.length;
    let y = circles.reduce((sum, c) => sum + c.y, 0) / circles.length;
    const reach = c => Math.hypot(c.x - x, c.y - y) + c.r;
    for (let i = 1; i <= 200; i++) {
        const farthest = circles.reduce((a, b) => reach(a) >= reach(b) ? a : b);
        const distance = Math.hypot(farthest.x - x, farthest.y - y);
        if (distance === 0) {
            break;
        }
        const step = (reach(farthest) - circles.reduce((max, c) => Math.max(max, c.r), 0)) / (i + 1);
        x += (farthest.x - x) / distance * Math.min(step, distance);
        y += (farthest.y - y) / distance * Math.min(step, distance);
    }
    return { x, y, r: Math.max(...circles.map(reach)) };
}
