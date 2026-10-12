import ava from 'ava';
import { buildGraph, pointAlongRoute } from '../../src/assets/scripts/client/ground/groundGraph';

const layoutOf = (...taxiways) => ({ taxiways: taxiways.map(([ref, points]) => ({ ref, kind: 'taxiway', points })) });

ava('polylines sharing a vertex are one network and the shortest way is found', (t) => {
    const graph = buildGraph(layoutOf(
        ['A', [[0, 0], [1, 0], [2, 0]]],
        ['B', [[1, 0], [1, 1]]],
        ['C', [[0, 0], [0, 1], [1, 1]]]
    ));
    const from = graph.nodeAt([0, 0]);
    const to = graph.nodeAt([1, 1]);
    const route = graph.findRoute(from, to);

    t.is(route.length, 2);
    t.deepEqual(route.points, [[0, 0], [1, 0], [1, 1]]);
    t.deepEqual(route.refs, ['A', 'B']);
});

ava('preferred taxiways attract the route even when it is longer', (t) => {
    const graph = buildGraph(layoutOf(
        ['A', [[0, 0], [1, 0]]],
        ['B', [[1, 0], [2, 0]]],
        ['C', [[0, 0], [0, 0.6], [1, 0.6], [2, 0.6], [2, 0]]]
    ));
    const from = graph.nodeAt([0, 0]);
    const to = graph.nodeAt([2, 0]);

    t.deepEqual(graph.findRoute(from, to).refs, ['A', 'B']);
    t.deepEqual(graph.findRoute(from, to, { preferredRefs: ['C'] }).refs, ['C']);
});

ava('a taxiway that ends on the side of another is joined to it', (t) => {
    const graph = buildGraph(layoutOf(
        ['A', [[0, 0], [2, 0]]],
        ['B', [[1, 0.004], [1, 1]]]
    ));
    const route = graph.findRoute(graph.nodeAt([0, 0]), graph.nodeAt([1, 1]));

    t.truthy(route);
    t.true(Math.abs(route.length - 2) < 0.02);
});

ava('a small gap between two pieces of network is bridged, a big one is not', (t) => {
    const small = buildGraph(layoutOf(['A', [[0, 0], [1, 0]]], ['B', [[1.05, 0], [2, 0]]]));

    t.truthy(small.findRoute(small.nodeAt([0, 0]), small.nodeAt([2, 0])));

    const big = buildGraph(layoutOf(['A', [[0, 0], [1, 0]]], ['B', [[1.5, 0], [2, 0]]]));

    t.is(big.findRoute(big.nodeAt([0, 0]), big.nodeAt([2, 0])), null);
});

ava('attachPoint joins a stand to the nearest part of an edge', (t) => {
    const graph = buildGraph(layoutOf(['A', [[0, 0], [1, 0]]]));
    const stand = graph.attachPoint([0.5, 0.06]);
    const route = graph.findRoute(stand, graph.nodeAt([1, 0]));

    t.truthy(route);
    t.true(route.length > 0.5);
    t.is(graph.attachPoint([0.5, 5]), null);
});

ava('pointAlongRoute walks the route and reports when it is finished', (t) => {
    const route = { points: [[0, 0], [1, 0], [1, 1]], length: 2 };
    const middle = pointAlongRoute(route, 1.5);

    t.deepEqual(middle.point, [1, 0.5]);
    t.false(middle.finished);
    t.true(Math.abs(middle.bearing) < 1e-9);
    t.true(pointAlongRoute(route, 2.5).finished);
});
