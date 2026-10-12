import ava from 'ava';
import {
    buildOverpassQuery, fetchOsmElements, layoutBounds, parseOverpass
} from '../../src/assets/scripts/client/ground/osmLayout';

const project = (lat, lon) => [(lon - 10) * 100, (lat - 50) * 100];
const way = (tags, geometry) => ({ type: 'way', tags, geometry: geometry.map(([lat, lon]) => ({ lat, lon })) });

const SAMPLE = {
    elements: [
        way({ aeroway: 'taxiway', ref: 'A' }, [[50, 10], [50, 10.01], [50, 10.02]]),
        way({ aeroway: 'taxiway', ref: 'B' }, [[50, 10.01], [50.01, 10.01]]),
        way({ aeroway: 'taxilane' }, [[50.01, 10.01], [50.01, 10.02]]),
        way({ aeroway: 'apron' }, [[50.01, 10], [50.01, 10.01], [50.02, 10.01], [50.02, 10]]),
        way({ building: 'terminal', name: 'Terminal 1' }, [[50.02, 10], [50.02, 10.01], [50.03, 10.01]]),
        way({ aeroway: 'parking_position', ref: 'B3' }, [[50.01, 10.005], [50.011, 10.005]]),
        {
            type: 'node', lat: 50.012, lon: 10.006, tags: { aeroway: 'parking_position', ref: 'B4' }
        },
        {
            type: 'node', lat: 50.0001, lon: 10.001, tags: { aeroway: 'holding_position', ref: '09/27' }
        },
        way({ aeroway: 'runway', ref: '09/27' }, [[50, 10], [50, 10.03]])
    ]
};

ava('the query asks for taxiways, aprons, terminals, stands and holding positions around the airport', (t) => {
    const query = buildOverpassQuery(53.3336, -2.8497, 3500);

    t.true(query.includes('around:3500,53.333600,-2.849700'));
    t.true(query.includes('taxiway|taxilane|apron|terminal|parking_position'));
    t.true(query.includes('holding_position'));
    t.true(query.includes('out geom;'));
});

ava('OSM elements become a layout in airport-relative kilometres', (t) => {
    const layout = parseOverpass(SAMPLE, project);

    t.is(layout.source, 'osm');
    t.is(layout.taxiways.length, 3);
    t.is(layout.taxiways[0].ref, 'A');
    t.is(layout.taxiways[2].kind, 'taxilane');
    t.is(layout.aprons.length, 1);
    t.is(layout.terminals[0].name, 'Terminal 1');
    t.deepEqual(layout.stands.map((stand) => stand.ref).sort(), ['B3', 'B4']);
    t.is(layout.holds.length, 1);
    t.is(layout.holds[0].runway, '09/27');
    t.deepEqual(layout.taxiways[0].points[2], [2, 0]);
});

ava('a response with hardly any taxiways is not worth using', (t) => {
    t.is(parseOverpass({ elements: [way({ aeroway: 'taxiway' }, [[50, 10], [50, 10.01]])] }, project), null);
    t.is(parseOverpass(null, project), null);
});

ava('layoutBounds spans the whole layout', (t) => {
    const bounds = layoutBounds(parseOverpass(SAMPLE, project));

    t.true(bounds.maxX >= 2 && bounds.maxY >= 3 && bounds.minX <= 0);
});

ava('fetchOsmElements tries the next endpoint after a failure and gives up quietly', async(t) => {
    const calls = [];
    const flaky = async(url) => {
        calls.push(url);

        if (calls.length === 1) {
            throw new Error('offline');
        }

        return { ok: true, json: async() => ({ elements: [] }) };
    };

    t.deepEqual(await fetchOsmElements('q', flaky), { elements: [] });
    t.is(calls.length, 2);
    t.is(await fetchOsmElements('q', async() => { throw new Error('offline'); }), null);
});
