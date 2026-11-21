/**
 * Automatic layered layout for process models, flowing from left to right.
 *
 * Strategy:
 *  1. A depth-first search from the start node finds back edges (loops).
 *     They are ignored for ranking, so the remaining graph has no cycles.
 *  2. Rank (column) = longest path from the start node. A node is always
 *     right of all its predecessors.
 *  3. Row: a node continues the row of its predecessor if it is the first
 *     successor; every further branch opens a new row below. A row is
 *     therefore a single chain, so nodes never share a cell.
 *  4. Nodes are centered in their column and row, so aligned nodes get
 *     straight edges.
 *
 * The module is DOM-free; node sizes are passed in by the caller.
 */

/** Distance between the canvas border and the diagram. */
const MARGIN = 40;

/** Horizontal gap between two columns. */
const COLUMN_GAP = 60;

/** Vertical gap between two rows (space for labels and loop edges). */
const ROW_GAP = 70;

/**
 * Computes the positions of all nodes.
 *
 * @param {{id:string, type:string}[]} nodes
 * @param {{id:string, source:string, target:string}[]} edges
 * @param {function(string): {width:number, height:number}} sizeOf - node size by id
 * @returns {{positions: Map<string, {x:number, y:number}>, arcEdges: Set<string>, branchEdges: Set<string>, width:number, height:number}}
 *   arcEdges are edges that must be routed around the nodes (loops and
 *   edges skipping nodes in the same row). branchEdges are edges from a
 *   gateway to a branch in a lower row of the next column; the column of
 *   the gateway is free below it, so they run down and enter from the left.
 */
export function computeLayout(nodes, edges, sizeOf) {
    const outgoing = new Map(nodes.map(node => [node.id, []]));
    for (const edge of edges) {
        if (outgoing.has(edge.source) && outgoing.has(edge.target)) {
            outgoing.get(edge.source).push(edge);
        }
    }
    const roots = orderRoots(nodes, edges);
    const { backEdges, topologicalOrder } = analyze(roots, outgoing);
    const rank = computeRanks(topologicalOrder, outgoing, backEdges);
    const row = computeRows(roots, outgoing, backEdges);

    const sizes = new Map(nodes.map(node => [node.id, sizeOf(node.id)]));
    const columnWidth = [];
    let rowHeight = 0;
    for (const node of nodes) {
        const { width, height } = sizes.get(node.id);
        const r = rank.get(node.id);
        columnWidth[r] = Math.max(columnWidth[r] || 0, width);
        rowHeight = Math.max(rowHeight, height);
    }
    const columnX = [];
    let x = MARGIN;
    for (let r = 0; r < columnWidth.length; r++) {
        columnX[r] = x;
        x += (columnWidth[r] || 0) + COLUMN_GAP;
    }

    const positions = new Map();
    let width = 0;
    let height = 0;
    for (const node of nodes) {
        const size = sizes.get(node.id);
        const r = rank.get(node.id);
        const position = {
            x: Math.round(columnX[r] + ((columnWidth[r] || 0) - size.width) / 2),
            y: Math.round(MARGIN + row.get(node.id) * (rowHeight + ROW_GAP) + (rowHeight - size.height) / 2)
        };
        positions.set(node.id, position);
        width = Math.max(width, position.x + size.width + MARGIN);
        height = Math.max(height, position.y + size.height + MARGIN);
    }

    const arcEdges = new Set(backEdges);
    for (const edge of edges) {
        if (row.has(edge.source) && row.has(edge.target) &&
            row.get(edge.source) === row.get(edge.target) &&
            rank.get(edge.target) - rank.get(edge.source) > 1) {
            arcEdges.add(edge.id);
        }
    }
    const types = new Map(nodes.map(node => [node.id, node.type]));
    const branchEdges = new Set();
    for (const edge of edges) {
        if (types.get(edge.source) === 'gateway' && !arcEdges.has(edge.id) &&
            row.has(edge.source) && row.has(edge.target) &&
            row.get(edge.target) > row.get(edge.source) &&
            rank.get(edge.target) === rank.get(edge.source) + 1) {
            branchEdges.add(edge.id);
        }
    }
    return { positions, arcEdges, branchEdges, width, height };
}

/**
 * Start nodes first, then nodes without incoming edges, then all others
 * (only relevant for unconnected cycles).
 */
function orderRoots(nodes, edges) {
    const targets = new Set(edges.map(edge => edge.target));
    return [
        ...nodes.filter(node => node.type === 'start'),
        ...nodes.filter(node => node.type !== 'start' && !targets.has(node.id)),
        ...nodes
    ].map(node => node.id);
}

/**
 * Depth-first search: an edge to a node that is still on the stack is a
 * back edge. The reverse post order is a topological order of the
 * remaining (acyclic) graph.
 */
function analyze(roots, outgoing) {
    const backEdges = new Set();
    const state = new Map();
    const postOrder = [];
    const visit = id => {
        state.set(id, 'active');
        for (const edge of outgoing.get(id)) {
            const targetState = state.get(edge.target);
            if (targetState === 'active') {
                backEdges.add(edge.id);
            } else if (!targetState) {
                visit(edge.target);
            }
        }
        state.set(id, 'done');
        postOrder.push(id);
    };
    for (const id of roots) {
        if (!state.has(id)) {
            visit(id);
        }
    }
    return { backEdges, topologicalOrder: postOrder.reverse() };
}

/** Longest path ranking along forward edges. */
function computeRanks(topologicalOrder, outgoing, backEdges) {
    const rank = new Map();
    for (const id of topologicalOrder) {
        if (!rank.has(id)) {
            rank.set(id, 0);
        }
        for (const edge of outgoing.get(id)) {
            if (!backEdges.has(edge.id)) {
                rank.set(edge.target, Math.max(rank.get(edge.target) ?? 0, rank.get(id) + 1));
            }
        }
    }
    return rank;
}

/** The first successor keeps the row, further branches open new rows. */
function computeRows(roots, outgoing, backEdges) {
    const row = new Map();
    let rowCount = 0;
    const place = (id, r) => {
        row.set(id, r);
        let rowTaken = false;
        for (const edge of outgoing.get(id)) {
            if (backEdges.has(edge.id) || row.has(edge.target)) {
                continue;
            }
            place(edge.target, rowTaken ? rowCount++ : r);
            rowTaken = true;
        }
    };
    for (const id of roots) {
        if (!row.has(id)) {
            place(id, rowCount++);
        }
    }
    return row;
}
