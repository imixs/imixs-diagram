import { computeRoute, computeArcRoute, computeBranchRoute, computeTreeRoute, toRoundedPath } from './router.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * EdgeLayer renders the edges of a model as SVG paths with an arrow head.
 * The route of each edge is computed automatically by the router.
 *
 * Each edge consists of a visible path and a wider transparent path on top
 * that makes the edge easy to click.
 */
export class EdgeLayer {

    /**
     * @param {SVGSVGElement} svg - SVG element that holds the edges
     * @param {DiagramModel} model
     * @param {NodeLayer} nodeLayer - provides node positions and sizes
     */
    constructor(svg, model, nodeLayer) {
        this.svg = svg;
        this.model = model;
        this.nodeLayer = nodeLayer;
        this.elements = new Map();
        this.#createArrowMarker();
    }

    /**
     * Creates missing edge elements, removes deleted ones and recomputes
     * all edge routes.
     *
     * @param {Set<string>} arcEdges - ids of edges routed as an arc around the nodes
     * @param {string} [routing] - 'tree' for org chart edges (top-down, no arrow head)
     * @param {Set<string>} [branchEdges] - ids of gateway branches routed down and in from the left
     */
    render(arcEdges = new Set(), routing, branchEdges = new Set()) {
        const ids = new Set(this.model.edges.map(edge => edge.id));
        for (const [id, group] of this.elements) {
            if (!ids.has(id)) {
                group.remove();
                this.elements.delete(id);
            }
        }
        for (const edge of this.model.edges) {
            let group = this.elements.get(edge.id);
            if (!group) {
                group = this.#createElement(edge.id);
                this.elements.set(edge.id, group);
                this.svg.append(group);
            }
            const source = this.nodeLayer.getBounds(edge.source);
            const target = this.nodeLayer.getBounds(edge.target);
            const route = routing === 'tree' ? computeTreeRoute(source, target)
                : arcEdges.has(edge.id) ? computeArcRoute(source, target)
                    : branchEdges.has(edge.id) ? computeBranchRoute(source, target)
                        : computeRoute(source, target);
            const d = toRoundedPath(route);
            for (const path of group.children) {
                path.setAttribute('d', d);
            }
            const visible = group.firstChild;
            if (routing === 'tree') {
                visible.removeAttribute('marker-end');
            }
            // Conditional flows start with a small diamond, as in BPMN
            if (this.model.isConditionalFlow(edge.id)) {
                visible.setAttribute('marker-start', 'url(#imixs-condition)');
            } else {
                visible.removeAttribute('marker-start');
            }
        }
    }

    /**
     * Returns the SVG group of an edge or undefined.
     */
    getElement(id) {
        return this.elements.get(id);
    }

    #createElement(id) {
        const group = document.createElementNS(SVG_NS, 'g');
        group.setAttribute('class', 'imixs-edge-group');
        group.dataset.id = id;

        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('class', 'imixs-edge');
        path.setAttribute('marker-end', 'url(#imixs-arrow)');

        const hit = document.createElementNS(SVG_NS, 'path');
        hit.setAttribute('class', 'imixs-edge-hit');

        group.append(path, hit);
        return group;
    }

    #createArrowMarker() {
        const defs = document.createElementNS(SVG_NS, 'defs');
        const marker = document.createElementNS(SVG_NS, 'marker');
        marker.setAttribute('id', 'imixs-arrow');
        marker.setAttribute('viewBox', '0 0 10 10');
        marker.setAttribute('refX', '10');
        marker.setAttribute('refY', '5');
        marker.setAttribute('markerWidth', '8');
        marker.setAttribute('markerHeight', '8');
        marker.setAttribute('orient', 'auto-start-reverse');

        const arrow = document.createElementNS(SVG_NS, 'path');
        arrow.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
        arrow.setAttribute('class', 'imixs-edge__arrow');

        marker.append(arrow);

        const condition = document.createElementNS(SVG_NS, 'marker');
        condition.setAttribute('id', 'imixs-condition');
        condition.setAttribute('viewBox', '0 0 16 10');
        condition.setAttribute('refX', '1');
        condition.setAttribute('refY', '5');
        condition.setAttribute('markerWidth', '16');
        condition.setAttribute('markerHeight', '10');
        condition.setAttribute('markerUnits', 'userSpaceOnUse');
        condition.setAttribute('orient', 'auto');

        const diamond = document.createElementNS(SVG_NS, 'path');
        diamond.setAttribute('d', 'M 1 5 L 8 1 L 15 5 L 8 9 z');
        diamond.setAttribute('class', 'imixs-edge__condition');

        condition.append(diamond);
        defs.append(marker, condition);
        this.svg.append(defs);
    }
}
