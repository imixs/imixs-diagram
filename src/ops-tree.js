import { validateTree } from './tree.js';

/**
 * Structure operations and rules of the trees (org chart, skill map).
 * Plain functions, called by DiagramModel inside a transaction with the
 * context `tx` (see ops-metamodel.js); each returns a result or null if
 * it does not apply.
 *
 * Children are laid out in edge order, so the operations keep the order
 * of the edges meaningful.
 */

/**
 * Returns the kind of a tree for DiagramModel.
 *
 * @param {string} nodeType - type of all nodes ('unit' or 'skill')
 * @param {string} name - default name of new nodes
 */
export function treeKind(nodeType, name) {
    const isTreeNode = (tx, id) => tx.typeOf(id) === nodeType;

    const operations = {
        addChild(tx, parentId) {
            if (!isTreeNode(tx, parentId)) {
                return null;
            }
            const node = tx.createNode(nodeType);
            tx.createEdge(parentId, node.id);
            return node;
        },

        addSibling(tx, id) {
            const parentEdge = tx.model.getIncoming(id)[0];
            if (!isTreeNode(tx, id) || !parentEdge) {
                return null;
            }
            const node = tx.createNode(nodeType);
            const edge = tx.createEdge(parentEdge.source, node.id);
            // Place the new node right after the given one
            const edges = tx.model.edges;
            edges.splice(edges.indexOf(edge), 1);
            edges.splice(edges.indexOf(parentEdge) + 1, 0, edge);
            return node;
        },

        deleteSubtree(tx, id) {
            if (!isTreeNode(tx, id) || tx.model.getIncoming(id).length === 0) {
                return null;
            }
            const removed = [];
            const collect = nodeId => {
                removed.push(nodeId);
                tx.model.getOutgoing(nodeId).forEach(edge => collect(edge.target));
            };
            collect(id);
            tx.removeNodes(removed);
            return removed;
        },

        /** The children move up to the parent and take the place of the node. */
        deleteNode(tx, id) {
            const model = tx.model;
            const node = model.getNode(id);
            const parentEdge = model.getIncoming(id)[0];
            if (!node || !isTreeNode(tx, id) || !parentEdge) {
                return null;
            }
            const childEdges = model.getOutgoing(id);
            childEdges.forEach(edge => edge.source = parentEdge.source);
            const index = model.edges.indexOf(parentEdge);
            const others = edge => !childEdges.includes(edge);
            model.edges = [
                ...model.edges.slice(0, index).filter(others),
                ...childEdges,
                ...model.edges.slice(index + 1).filter(others)
            ];
            tx.removeNodes([id]);
            return node;
        }
    };

    return {
        names: { [nodeType]: name },
        validate: (nodes, edges) => validateTree(nodes, edges, nodeType),
        operations,
        assignIds() {}
    };
}
