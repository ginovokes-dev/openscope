import ava from 'ava';
import { buildGraph } from '../../src/assets/scripts/client/ground/groundGraph';
import { deriveStands, holdNodeForRunway } from '../../src/assets/scripts/client/ground/layoutPreparation';

const taxiway = (ref, points) => ({ ref, kind: 'taxiway', points });
const runways = [{ names: ['09', '27'], p0: [-1, 0], p1: [1, 0] }];

ava('stands are taken from the apron when the data has none', (t) => {
    const layout = {
        taxiways: [taxiway('A', [[-1, 0.2], [1, 0.2]]), taxiway('B', [[0, 0.2], [0, 0.6], [0.3, 0.6], [0.6, 0.6]])],
        aprons: [{ points: [[-0.1, 0.5], [0.7, 0.5], [0.7, 0.7], [-0.1, 0.7]] }],
        stands: [],
        holds: []
    };
    const stands = deriveStands(layout, buildGraph(layout), runways);

    t.true(stands.length >= 2);
    t.true(stands.every((stand) => stand.y >= 0.5));
    t.is(stands[0].ref, '1');
});

ava('with no apron mapped, dead ends away from the runways are used', (t) => {
    const layout = {
        taxiways: [taxiway('A', [[-1, 0.2], [1, 0.2]]), taxiway('B', [[0, 0.2], [0, 1]])],
        aprons: [],
        stands: [],
        holds: []
    };
    const stands = deriveStands(layout, buildGraph(layout), runways);

    t.deepEqual(stands.map((stand) => [stand.x, stand.y]), [[0, 1]]);
});

ava('a mapped holding position near the threshold is preferred', (t) => {
    const layout = {
        taxiways: [taxiway('A', [[-1.1, 0.2], [1.1, 0.2]]), taxiway('A1', [[-0.9, 0.2], [-0.9, 0.08]])],
        aprons: [],
        stands: [],
        holds: [{
            runway: '09/27', x: -0.9, y: 0.08, taxiway: 'A1'
        }]
    };
    const graph = buildGraph(layout);
    const id = holdNodeForRunway(layout, graph, { name: '09', threshold: [-1, 0] }, runways);

    t.deepEqual(graph.nodes[id], [-0.9, 0.08]);
});

ava('without mapped holds the node nearest the threshold that is clear of the runway is used', (t) => {
    const layout = {
        taxiways: [taxiway('A', [[-1.2, 0.2], [1.2, 0.2]]), taxiway('X', [[-1, 0.2], [-1, 0]])],
        aprons: [],
        stands: [],
        holds: []
    };
    const graph = buildGraph(layout);
    const id = holdNodeForRunway(layout, graph, { name: '09', threshold: [-1, 0] }, runways);

    t.deepEqual(graph.nodes[id], [-1, 0.2]);
    t.is(holdNodeForRunway({ ...layout, taxiways: [] }, buildGraph({ taxiways: [] }), { name: '09', threshold: [-1, 0] }, runways), null);
});
