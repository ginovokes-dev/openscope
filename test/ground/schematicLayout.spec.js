import ava from 'ava';
import { generateSchematicLayout } from '../../src/assets/scripts/client/ground/schematicLayout';
import { buildGraph } from '../../src/assets/scripts/client/ground/groundGraph';

const runway = (names, p0, p1) => ({ names, p0, p1 });

const connectedRoutes = (t, layout) => {
    const graph = buildGraph(layout);

    layout.stands.forEach((stand) => {
        const from = graph.attachPoint([stand.x, stand.y]);

        t.not(from, null, `stand ${stand.ref} joins the network`);

        layout.holds.forEach((hold) => {
            const to = graph.attachPoint([hold.x, hold.y]);
            const route = graph.findRoute(from, to);

            t.truthy(route, `stand ${stand.ref} reaches the hold for ${hold.runway}`);
        });
    });

    return graph;
};

ava('a single runway gets a parallel taxiway, holds at both ends, an apron, a terminal and stands', (t) => {
    const layout = generateSchematicLayout([runway(['09', '27'], [-1.2, 0], [1.2, 0])]);

    t.is(layout.source, 'schematic');
    t.deepEqual(layout.holds.map((hold) => hold.runway).sort(), ['09', '27']);
    t.is(layout.aprons.length, 1);
    t.is(layout.terminals.length, 1);
    t.true(layout.stands.length >= 6);
    t.true(layout.taxiways.some((taxiway) => taxiway.ref === 'A' && taxiway.kind === 'taxiway'));
    connectedRoutes(t, layout);
});

ava('the holds sit beside the thresholds they belong to', (t) => {
    const layout = generateSchematicLayout([runway(['09', '27'], [-1.2, 0], [1.2, 0])]);
    const hold09 = layout.holds.find((hold) => hold.runway === '09');
    const hold27 = layout.holds.find((hold) => hold.runway === '27');

    t.true(hold09.x < 0 && hold27.x > 0);
    t.true(Math.abs(Math.abs(hold09.y) - 0.07) < 1e-6);
});

ava('several runways, crossing and parallel, are all joined to the one terminal', (t) => {
    const layout = generateSchematicLayout([
        runway(['05L', '23R'], [-1.8, -1.2], [1.8, 1.2]),
        runway(['05R', '23L'], [-1.2, -2.0], [2.4, 0.4]),
        runway(['09', '27'], [-1.5, 0.5], [1.6, 0.6])
    ]);

    t.is(layout.holds.length, 6);
    connectedRoutes(t, layout);
});

ava('a short airfield still gets a usable layout', (t) => {
    const layout = generateSchematicLayout([runway(['03', '21'], [0, -0.5], [0.4, 0.5])]);

    t.is(layout.holds.length, 2);
    t.true(layout.stands.length >= 6);
    connectedRoutes(t, layout);
});

ava('no runways gives an empty layout', (t) => {
    const layout = generateSchematicLayout([]);

    t.deepEqual(layout.taxiways, []);
    t.deepEqual(layout.stands, []);
});
