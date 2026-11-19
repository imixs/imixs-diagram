/**
 * Imixs rules for meta models.
 *
 * Imixs-Workflow is an event-driven engine: a task is a state, every
 * transition between tasks is an intermediate catch event. A model is
 * valid if it follows these rules:
 *
 *  - start:   exactly one per model, followed by exactly one event (init event)
 *  - event:   exactly one incoming flow, followed by exactly one task or gateway
 *  - task:    reached from an event or a conditional gateway; followed by
 *             at most one element: an event, a gateway or an end
 *  - gateway: exactly one incoming flow and at least one branch.
 *             After a task, every branch leads to an event.
 *             After an event (conditional gateway), every branch is a
 *             conditional flow to a task.
 *  - end:     follows exactly one task (the final state)
 *  - every element is reachable from the start
 *
 * Pure functions, DOM-free.
 */

/**
 * Checks a model against the Imixs rules.
 *
 * Every problem has a severity:
 *  - 'incomplete': allowed while modeling, the model is not finished yet
 *    (event without target, gateway without branch, task without successor)
 *  - 'error': a structure that can never become valid (e.g. task → task)
 *
 * @param {{id:string, type:string}[]} nodes
 * @param {{id:string, source:string, target:string}[]} edges
 * @returns {{id:string, severity:string, message:string}[]} problems, empty if the model is valid
 */
export function validate(nodes, edges) {
    const problems = [];
    const error = (id, message) => problems.push({ id, severity: 'error', message });
    const incomplete = (id, message) => problems.push({ id, severity: 'incomplete', message });
    const byId = new Map(nodes.map(node => [node.id, node]));
    const typeOf = id => byId.get(id)?.type;
    const sources = id => edges.filter(edge => edge.target === id).map(edge => typeOf(edge.source));
    const targets = id => edges.filter(edge => edge.source === id).map(edge => typeOf(edge.target));

    for (const edge of edges) {
        if (!byId.has(edge.source) || !byId.has(edge.target)) {
            error(edge.id, 'flow points to an unknown element');
        }
    }
    if (nodes.filter(node => node.type === 'start').length !== 1) {
        error(null, 'model needs exactly one start');
    }

    for (const node of nodes) {
        const from = sources(node.id);
        const to = targets(node.id);
        switch (node.type) {
            case 'start':
                if (from.length > 0 || to.length !== 1 || to[0] !== 'event') {
                    error(node.id, 'start must be followed by exactly one event');
                }
                break;
            case 'event':
                if (from.length !== 1) {
                    error(node.id, 'event needs exactly one incoming flow');
                }
                if (to.length > 1 || to.some(type => type !== 'task' && type !== 'gateway')) {
                    error(node.id, 'event must be followed by exactly one task or gateway');
                } else if (to.length === 0) {
                    incomplete(node.id, 'event has no target');
                }
                break;
            case 'task':
                if (from.length === 0 || from.some(type => type !== 'event' && type !== 'gateway')) {
                    error(node.id, 'task must be reached from an event or a conditional gateway');
                }
                if (to.length > 1 || to.some(type => !['event', 'gateway', 'end'].includes(type))) {
                    error(node.id, 'task must be followed by at most one event, gateway or end');
                } else if (to.length === 0) {
                    incomplete(node.id, 'task has no successor (add an event or an end)');
                }
                break;
            case 'gateway':
                if (from.length !== 1 || !['task', 'event'].includes(from[0])) {
                    error(node.id, 'gateway needs exactly one incoming flow from a task or an event');
                } else if (from[0] === 'task' && to.some(type => type !== 'event')) {
                    error(node.id, 'every branch of a gateway after a task must lead to an event');
                } else if (from[0] === 'event' && to.some(type => type !== 'task')) {
                    error(node.id, 'every branch of a conditional gateway must lead to a task');
                } else if (to.length === 0) {
                    incomplete(node.id, 'gateway has no branch');
                }
                break;
            case 'end':
                if (from.length !== 1 || from[0] !== 'task' || to.length > 0) {
                    error(node.id, 'end must follow exactly one task');
                }
                break;
            default:
                error(node.id, `unknown element type '${node.type}'`);
        }
    }

    for (const id of findUnreachable(nodes, edges)) {
        error(id, 'element is not reachable from the start');
    }
    return problems;
}

/**
 * Returns the ids of all nodes that are not reachable from a start node.
 * Returns an empty list if there is no start node.
 */
export function findUnreachable(nodes, edges) {
    const starts = nodes.filter(node => node.type === 'start').map(node => node.id);
    if (starts.length === 0) {
        return [];
    }
    const reached = new Set(starts);
    const queue = [...starts];
    while (queue.length > 0) {
        const id = queue.shift();
        for (const edge of edges) {
            if (edge.source === id && !reached.has(edge.target)) {
                reached.add(edge.target);
                queue.push(edge.target);
            }
        }
    }
    return nodes.filter(node => !reached.has(node.id)).map(node => node.id);
}

/**
 * Assigns the numbers the Imixs engine needs:
 *  - processid of a task: unique in the model, steps of 100 (100, 200, …)
 *  - activityid of an event: unique among the events of the task it
 *    belongs to, steps of 10 (10, 20, …). An event belongs to the task it
 *    comes from, also across a gateway; the init event belongs to the start.
 *
 * Existing numbers are kept if they are still unique, so they stay stable
 * while the model is edited. Missing or duplicate numbers get the next
 * free step.
 *
 * @param {{id:string, type:string, properties:object}[]} nodes
 * @param {{source:string, target:string}[]} edges
 * @returns {Map<string, number>} number per task and event id
 */
export function assignImixsIds(nodes, edges) {
    const byId = new Map(nodes.map(node => [node.id, node]));
    const predecessor = id => byId.get(edges.find(edge => edge.target === id)?.source);
    const keyOf = node => node.type === 'task' ? 'processid' : 'activityid';
    const stepOf = node => node.type === 'task' ? 100 : 10;

    // Tasks share one scope, events are numbered per owning task
    const scopeOf = node => {
        if (node.type === 'task') {
            return 'tasks';
        }
        let owner = predecessor(node.id);
        if (owner?.type === 'gateway') {
            owner = predecessor(owner.id);
        }
        return `events of ${owner?.id}`;
    };

    const numbered = nodes.filter(node => node.type === 'task' || node.type === 'event');
    const result = new Map();
    const used = new Set();
    const max = new Map();

    // 1. Keep existing numbers that are valid and unique
    for (const node of numbered) {
        const value = Number(node.properties?.[keyOf(node)]);
        const scope = scopeOf(node);
        if (Number.isInteger(value) && value > 0 && !used.has(`${scope}#${value}`)) {
            result.set(node.id, value);
            used.add(`${scope}#${value}`);
            max.set(scope, Math.max(max.get(scope) || 0, value));
        }
    }
    // 2. All others get the next free step of their scope
    for (const node of numbered) {
        if (result.has(node.id)) {
            continue;
        }
        const scope = scopeOf(node);
        const step = stepOf(node);
        const next = (Math.floor((max.get(scope) || 0) / step) + 1) * step;
        result.set(node.id, next);
        max.set(scope, next);
    }
    return result;
}
