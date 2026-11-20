/**
 * Org chart logic: tree layout, tree rules and the new model template.
 *
 * Automatic tree layout for org charts, flowing from top to bottom.
 *
 * Every subtree gets the width it needs; a parent is centered above its
 * children, children are placed left to right in model order. The nodes of
 * one level are top-aligned, so the edges to all children of a parent meet
 * on one horizontal line (see computeTreeRoute).
 *
 * The root is the node without parent; several roots are placed side by
 * side. The module is DOM-free; node sizes are passed in by the caller.
 */

/** Distance between the canvas border and the diagram. */
const MARGIN = 40;

/** Horizontal gap between two neighboring subtrees. */
const SIBLING_GAP = 30;

/** Vertical gap between two levels. */
const LEVEL_GAP = 60;

/**
 * Computes the positions of all nodes of a tree.
 *
 * @param {{id:string}[]} nodes
 * @param {{source:string, target:string}[]} edges - parent → child
 * @param {function(string): {width:number, height:number}} sizeOf - node size by id
 * @returns {{positions: Map<string, {x:number, y:number}>, arcEdges: Set<string>, routing: string, width:number, height:number}}
 */
export function computeTreeLayout(nodes, edges, sizeOf) {
    const ids = new Set(nodes.map(node => node.id));
    const children = new Map(nodes.map(node => [node.id, []]));
    const hasParent = new Set();
    for (const edge of edges) {
        if (ids.has(edge.source) && ids.has(edge.target) && !hasParent.has(edge.target)) {
            children.get(edge.source).push(edge.target);
            hasParent.add(edge.target);
        }
    }
    const sizes = new Map(nodes.map(node => [node.id, sizeOf(node.id)]));

    // Depth of every node and height of every level. Each node is visited
    // once, so cycles in invalid data cannot cause endless recursion.
    const depth = new Map();
    const treeChildren = new Map();
    const levelHeight = [];
    const visit = (id, level) => {
        depth.set(id, level);
        levelHeight[level] = Math.max(levelHeight[level] || 0, sizes.get(id).height);
        const kids = [];
        for (const child of children.get(id)) {
            if (!depth.has(child)) {
                kids.push(child);
                visit(child, level + 1);
            }
        }
        treeChildren.set(id, kids);
    };
    const roots = [];
    for (const node of [...nodes.filter(node => !hasParent.has(node.id)), ...nodes]) {
        if (!depth.has(node.id)) {
            roots.push(node.id);
            visit(node.id, 0);
        }
    }

    // Width of every subtree
    const subtreeWidth = new Map();
    const measure = id => {
        const kids = treeChildren.get(id);
        const childrenWidth = kids.reduce((sum, child) => sum + measure(child), 0) +
            SIBLING_GAP * Math.max(0, kids.length - 1);
        const width = Math.max(sizes.get(id).width, childrenWidth);
        subtreeWidth.set(id, width);
        return width;
    };

    const levelY = [];
    let y = MARGIN;
    for (let level = 0; level < levelHeight.length; level++) {
        levelY[level] = y;
        y += levelHeight[level] + LEVEL_GAP;
    }

    // Place every subtree in its horizontal slot, the parent centered above
    const positions = new Map();
    const place = (id, left) => {
        const width = subtreeWidth.get(id);
        const kids = treeChildren.get(id);
        positions.set(id, {
            x: Math.round(left + (width - sizes.get(id).width) / 2),
            y: levelY[depth.get(id)]
        });
        const childrenWidth = kids.reduce((sum, child) => sum + subtreeWidth.get(child), 0) +
            SIBLING_GAP * Math.max(0, kids.length - 1);
        let childLeft = left + (width - childrenWidth) / 2;
        for (const child of kids) {
            place(child, childLeft);
            childLeft += subtreeWidth.get(child) + SIBLING_GAP;
        }
    };
    let left = MARGIN;
    for (const root of roots) {
        const rootWidth = measure(root);
        place(root, left);
        left += rootWidth + SIBLING_GAP * 2;
    }

    let width = 0;
    let height = 0;
    for (const [id, position] of positions) {
        width = Math.max(width, position.x + sizes.get(id).width + MARGIN);
        height = Math.max(height, position.y + sizes.get(id).height + MARGIN);
    }
    return { positions, arcEdges: new Set(), routing: 'tree', width, height };
}

/**
 * Returns the JSON model of a new org chart: a single root unit.
 */
export function newOrgChart() {
    return {
        type: 'orgchart',
        properties: {},
        nodes: [{ id: 'n1', type: 'unit', x: 0, y: 0, properties: { name: 'Organization' } }],
        edges: []
    };
}

/** Node type of the trees: org chart units and skill map skills. */
export const TREE_NODE_TYPES = { orgchart: 'unit', skillmap: 'skill' };

/**
 * Returns the JSON model of a new skill map: a single root skill.
 */
export function newSkillMap() {
    return {
        type: 'skillmap',
        properties: {},
        nodes: [{ id: 'n1', type: 'skill', x: 0, y: 0, properties: { name: 'Skills' } }],
        edges: []
    };
}

/**
 * Checks a tree (org chart or skill map): exactly one root (a node without
 * parent), every other node has exactly one parent and is reachable from
 * the root, all nodes have the given type.

 *
 * @param {{id:string, type:string}[]} nodes
 * @param {{id:string, source:string, target:string}[]} edges - parent → child
 * @param {string} [nodeType] - 'unit' (org chart) or 'skill' (skill map)
 * @returns {{id:string, severity:string, message:string}[]} problems, empty if the tree is valid
 */
export function validateTree(nodes, edges, nodeType = 'unit') {
    const problems = [];
    const error = (id, message) => problems.push({ id, severity: 'error', message });
    const parents = id => edges.filter(edge => edge.target === id).length;

    for (const node of nodes) {
        if (node.type !== nodeType) {
            error(node.id, `unknown element type '${node.type}'`);
        }
        if (parents(node.id) > 1) {
            error(node.id, 'unit has more than one parent');
        }
    }
    const roots = nodes.filter(node => parents(node.id) === 0);
    if (roots.length !== 1) {
        error(null, 'org chart needs exactly one root');
    }

    // Every unit must be reachable from the root (no cycles, no islands)
    const reached = new Set(roots.slice(0, 1).map(node => node.id));
    const queue = [...reached];
    while (queue.length > 0) {
        const id = queue.shift();
        for (const edge of edges) {
            if (edge.source === id && !reached.has(edge.target)) {
                reached.add(edge.target);
                queue.push(edge.target);
            }
        }
    }
    for (const node of nodes) {
        if (!reached.has(node.id) && !roots.includes(node)) {
            error(node.id, 'unit is not reachable from the root');
        }
    }
    return problems;
}
