/**
 * Taxiway network as a graph, and routing over it
 *
 * Polylines from a layout (hand-mapped, generated or from OpenStreetMap) become nodes and edges: vertices that coincide
 * are merged, a taxiway that ends on the side of another is joined to it, and small gaps between separate pieces are
 * bridged, because real-world data is never perfectly connected.
 */
import {
    distanceBetween,
    nearestOnSegment,
    polylineLength,
    pointAlongPolyline
} from './groundGeometry';

const SNAP_KM = 0.004;
const T_JUNCTION_KM = 0.008;
const GAP_BRIDGE_KM = 0.08;
const PREFERRED_EDGE_FACTOR = 0.4;

class MinHeap {
    constructor() {
        this._items = [];
    }

    get size() {
        return this._items.length;
    }

    push(priority, value) {
        const items = this._items;

        items.push({ priority, value });

        let index = items.length - 1;

        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);

            if (items[parent].priority <= items[index].priority) {
                break;
            }

            [items[parent], items[index]] = [items[index], items[parent]];
            index = parent;
        }
    }

    pop() {
        const items = this._items;
        const top = items[0];
        const last = items.pop();

        if (items.length > 0) {
            items[0] = last;

            let index = 0;

            for (;;) {
                const left = (index * 2) + 1;
                const right = left + 1;
                let smallest = index;

                if (left < items.length && items[left].priority < items[smallest].priority) {
                    smallest = left;
                }

                if (right < items.length && items[right].priority < items[smallest].priority) {
                    smallest = right;
                }

                if (smallest === index) {
                    break;
                }

                [items[smallest], items[index]] = [items[index], items[smallest]];
                index = smallest;
            }
        }

        return top.value;
    }
}

export class GroundGraph {
    constructor() {
        this.nodes = [];
        this.adjacency = [];
        this._grid = new Map();
    }

    _cell(x, y) {
        return `${Math.round(x / SNAP_KM)},${Math.round(y / SNAP_KM)}`;
    }

    /**
     * Existing node within snapping distance of a point, or a new one
     *
     * @for GroundGraph
     * @method nodeAt
     * @param point {array}
     * @return {number} node id
     */
    nodeAt(point) {
        const cx = Math.round(point[0] / SNAP_KM);
        const cy = Math.round(point[1] / SNAP_KM);

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const ids = this._grid.get(`${cx + dx},${cy + dy}`);

                if (ids) {
                    const found = ids.find((id) => distanceBetween(this.nodes[id], point) <= SNAP_KM);

                    if (found !== undefined) {
                        return found;
                    }
                }
            }
        }

        const id = this.nodes.length;

        this.nodes.push([point[0], point[1]]);
        this.adjacency.push([]);

        const key = this._cell(point[0], point[1]);

        if (!this._grid.has(key)) {
            this._grid.set(key, []);
        }

        this._grid.get(key).push(id);

        return id;
    }

    addEdge(a, b, ref = '', kind = 'taxiway') {
        if (a === b || this.adjacency[a].some((edge) => edge.to === b)) {
            return;
        }

        const length = distanceBetween(this.nodes[a], this.nodes[b]);

        this.adjacency[a].push({
            to: b, length, ref, kind
        });
        this.adjacency[b].push({
            to: a, length, ref, kind
        });
    }

    removeEdge(a, b) {
        this.adjacency[a] = this.adjacency[a].filter((edge) => edge.to !== b);
        this.adjacency[b] = this.adjacency[b].filter((edge) => edge.to !== a);
    }

    /**
     * Add a polyline
     *
     * @for GroundGraph
     * @method addPolyline
     * @param points {array<array>}
     * @param ref {string}
     * @param kind {string}
     */
    addPolyline(points, ref, kind) {
        let previous = null;

        points.forEach((point) => {
            const id = this.nodeAt(point);

            if (previous !== null) {
                this.addEdge(previous, id, ref, kind);
            }

            previous = id;
        });
    }

    /**
     * The nearest node to a point
     *
     * @for GroundGraph
     * @method nearestNode
     * @param point {array}
     * @param maximumKm {number}
     * @return {object|null} `{ id, distance }`
     */
    nearestNode(point, maximumKm = Infinity) {
        let best = null;

        this.nodes.forEach((node, id) => {
            if (this.adjacency[id].length === 0) {
                return;
            }

            const distance = distanceBetween(node, point);

            if (distance <= maximumKm && (!best || distance < best.distance)) {
                best = { id, distance };
            }
        });

        return best;
    }

    /**
     * Join a point (stand, holding position) to the network: the closest node, or the closest spot on an edge, within
     * `maximumKm`
     *
     * @for GroundGraph
     * @method attachPoint
     * @param point {array}
     * @param maximumKm {number}
     * @param ref {string}
     * @return {number|null} node id of the point, null when nothing is close enough
     */
    attachPoint(point, maximumKm = 0.15, ref = '') {
        const existing = this.nodeAt(point);

        if (this.adjacency[existing].length > 0) {
            return existing;
        }

        let best = null;

        this.nodes.forEach((node, id) => {
            if (id === existing) {
                return;
            }

            this.adjacency[id].forEach((edge) => {
                if (edge.to < id || edge.kind === 'bridge') {
                    return;
                }

                const candidate = nearestOnSegment(point, node, this.nodes[edge.to]);

                if (candidate.distance <= maximumKm && (!best || candidate.distance < best.distance)) {
                    best = {
                        ...candidate, a: id, b: edge.to, ref: edge.ref, kind: edge.kind
                    };
                }
            });
        });

        if (!best) {
            return null;
        }

        const onEdge = this.nodeAt(best.point);

        if (onEdge !== best.a && onEdge !== best.b) {
            this.removeEdge(best.a, best.b);
            this.addEdge(best.a, onEdge, best.ref, best.kind);
            this.addEdge(onEdge, best.b, best.ref, best.kind);
        }

        this.addEdge(existing, onEdge, ref || best.ref, 'stub');

        return existing;
    }

    _splitTJunctions() {
        const deadEnds = [];

        this.adjacency.forEach((edges, id) => {
            if (edges.length === 1) {
                deadEnds.push(id);
            }
        });

        deadEnds.forEach((id) => {
            const point = this.nodes[id];
            let best = null;

            this.nodes.forEach((node, a) => {
                this.adjacency[a].forEach((edge) => {
                    const b = edge.to;

                    if (b < a || a === id || b === id) {
                        return;
                    }

                    const candidate = nearestOnSegment(point, node, this.nodes[b]);

                    if (candidate.distance <= T_JUNCTION_KM && candidate.t > 0 && candidate.t < 1 &&
                        (!best || candidate.distance < best.distance)) {
                        best = {
                            a, b, ref: edge.ref, kind: edge.kind, distance: candidate.distance
                        };
                    }
                });
            });

            if (best) {
                this.removeEdge(best.a, best.b);
                this.addEdge(best.a, id, best.ref, best.kind);
                this.addEdge(id, best.b, best.ref, best.kind);
            }
        });
    }

    components() {
        const seen = new Array(this.nodes.length).fill(-1);
        const components = [];

        this.nodes.forEach((node, start) => {
            if (seen[start] !== -1 || this.adjacency[start].length === 0) {
                return;
            }

            const members = [];
            const stack = [start];

            seen[start] = components.length;

            while (stack.length > 0) {
                const id = stack.pop();

                members.push(id);
                this.adjacency[id].forEach(({ to }) => {
                    if (seen[to] === -1) {
                        seen[to] = components.length;
                        stack.push(to);
                    }
                });
            }

            components.push(members);
        });

        return components;
    }

    _bridgeGaps() {
        let components = this.components().sort((a, b) => b.length - a.length);

        for (let round = 0; round < 6 && components.length > 1; round++) {
            const [main, ...rest] = components;
            const mainSet = new Set(main);
            let bridged = false;

            rest.forEach((members) => {
                let best = null;

                members.forEach((id) => {
                    main.forEach((other) => {
                        const distance = distanceBetween(this.nodes[id], this.nodes[other]);

                        if (distance <= GAP_BRIDGE_KM && (!best || distance < best.distance)) {
                            best = { id, other, distance };
                        }
                    });
                });

                if (best) {
                    this.addEdge(best.id, best.other, '', 'bridge');
                    members.forEach((id) => mainSet.add(id));
                    bridged = true;
                }
            });

            if (!bridged) {
                break;
            }

            components = this.components().sort((a, b) => b.length - a.length);
        }
    }

    /**
     * Shortest route between two nodes (A*), optionally preferring some taxiways
     *
     * @for GroundGraph
     * @method findRoute
     * @param from {number}
     * @param to {number}
     * @param options {object} `{ preferredRefs: array<string> }`
     * @return {object|null} `{ nodeIds, points, length, refs }`
     */
    findRoute(from, to, { preferredRefs = [] } = {}) {
        if (from === to) {
            return {
                nodeIds: [from], points: [this.nodes[from]], length: 0, refs: []
            };
        }

        const preferred = new Set(preferredRefs.map((ref) => String(ref).toUpperCase()));
        const heuristicFactor = preferred.size > 0 ? PREFERRED_EDGE_FACTOR : 1;
        const cost = new Map([[from, 0]]);
        const previous = new Map();
        const open = new MinHeap();
        const closed = new Set();

        open.push(distanceBetween(this.nodes[from], this.nodes[to]) * heuristicFactor, from);

        while (open.size > 0) {
            const current = open.pop();

            if (current === to) {
                break;
            }

            if (!closed.has(current)) {
                closed.add(current);

                this.adjacency[current].forEach((edge) => {
                    const weight = edge.length * (preferred.has(String(edge.ref).toUpperCase()) ? PREFERRED_EDGE_FACTOR : 1);
                    const next = cost.get(current) + weight;

                    if (!cost.has(edge.to) || next < cost.get(edge.to)) {
                        cost.set(edge.to, next);
                        previous.set(edge.to, { node: current, ref: edge.ref });
                        open.push(next + (distanceBetween(this.nodes[edge.to], this.nodes[to]) * heuristicFactor), edge.to);
                    }
                });
            }
        }

        if (!previous.has(to)) {
            return null;
        }

        const nodeIds = [to];
        const refs = [];
        let cursor = to;

        while (cursor !== from) {
            const step = previous.get(cursor);

            if (step.ref && refs[0] !== step.ref) {
                refs.unshift(step.ref);
            }

            cursor = step.node;
            nodeIds.unshift(cursor);
        }

        const points = nodeIds.map((id) => this.nodes[id]);

        return {
            nodeIds, points, length: polylineLength(points), refs
        };
    }
}

/**
 * Build the graph for a layout
 *
 * @function buildGraph
 * @param layout {object}
 * @return {GroundGraph}
 */
export const buildGraph = (layout) => {
    const graph = new GroundGraph();

    layout.taxiways.forEach((taxiway) => graph.addPolyline(taxiway.points, taxiway.ref || '', taxiway.kind || 'taxiway'));
    graph._splitTJunctions();
    graph._bridgeGaps();

    return graph;
};

/**
 * A point reached by following a route `distance` km from its start
 *
 * @function pointAlongRoute
 * @param route {object}
 * @param distance {number}
 * @return {object} `{ point, bearing, finished }`
 */
export const pointAlongRoute = (route, distance) => {
    const { point, bearing } = pointAlongPolyline(route.points, distance);

    return { point, bearing, finished: distance >= route.length };
};
