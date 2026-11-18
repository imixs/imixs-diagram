import { computeRoute, toRoundedPath } from './router.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * EdgeLayer renders the edges of a model as SVG paths with an arrow head.
 * The route of each edge is computed automatically by the router.
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
        this.render();
    }

    /**
     * Creates missing edge elements and recomputes all edge routes.
     */
    render() {
        for (const edge of this.model.edges) {
            let path = this.elements.get(edge.id);
            if (!path) {
                path = document.createElementNS(SVG_NS, 'path');
                path.setAttribute('class', 'imixs-edge');
                path.setAttribute('marker-end', 'url(#imixs-arrow)');
                path.dataset.id = edge.id;
                this.elements.set(edge.id, path);
                this.svg.append(path);
            }
            const source = this.nodeLayer.getBounds(edge.source);
            const target = this.nodeLayer.getBounds(edge.target);
            path.setAttribute('d', toRoundedPath(computeRoute(source, target)));
        }
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
        defs.append(marker);
        this.svg.append(defs);
    }
}
