import ava from 'ava';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseCsv, parseCsvObjects } from '../../tools/data-pipeline/lib/csv';
import { mapEquipment } from '../../tools/data-pipeline/lib/equipment';
import { requiredRunwayKm, isTypeAllowed } from '../../tools/data-pipeline/lib/realism';
import {
    areReciprocal, buildRunways, isHardSurface, parseRunwayEnd
} from '../../tools/data-pipeline/lib/runways';
import { airportPlaceName, cleanCallsignName } from '../../tools/data-pipeline/lib/naming';
import { simBearingDistance, simOffsetToLatLon } from '../../tools/data-pipeline/lib/geo';
import { serializeFile } from '../../tools/data-pipeline/lib/format';
import { mergeLoadList } from '../../tools/data-pipeline/lib/loadlist';
import { COMMAND_WORDS, pickGateBearings } from '../../tools/data-pipeline/lib/gates';

const TYPES = {
    A321: { takeoff: 2.4, landing: 1.5 },
    B739: { takeoff: 2.9, landing: 2.4 },
    A388: { takeoff: 3, landing: 3 },
    B744: { takeoff: 3.352, landing: 2.072 },
    AT72: { takeoff: 1.408, landing: 1.21 },
    E190: { takeoff: 1.9, landing: 1.3 },
    E170: { takeoff: 1.7, landing: 1.2 },
    A320: { takeoff: 1.9, landing: 1.4 }
};

ava('csv: parses quoted fields, doubled quotes, embedded newlines, CRLF and a BOM', (t) => {
    const text = '﻿a,b,c\r\n1,"x,y","he said ""hi"""\r\n2,"line1\nline2",\r\n';
    const rows = parseCsv(text);

    t.deepEqual(rows[0], ['a', 'b', 'c']);
    t.deepEqual(rows[1], ['1', 'x,y', 'he said "hi"']);
    t.deepEqual(rows[2], ['2', 'line1\nline2', '']);
    t.is(parseCsvObjects(text)[0].b, 'x,y');
});

ava('equipment: maps IATA codes and drops unknown types', (t) => {
    const known = new Set(['B738', 'A388', 'DH8D', 'CRJ7', 'CRJ9']);

    t.deepEqual(mapEquipment('73H', known), [['B738', 1]]);
    t.deepEqual(mapEquipment('388', known), [['A388', 1]]);
    t.deepEqual(mapEquipment('DH4', known), [['DH8D', 1]]);
    t.deepEqual(mapEquipment('ZZZ', known), []);
    t.deepEqual(mapEquipment('CRJ', known).map((x) => x[0]).sort(), ['CRJ7', 'CRJ9']);
});

ava('realism: large aircraft are kept off short runways, regionals are not', (t) => {
    t.true(isTypeAllowed(TYPES.A321, 2286));
    t.true(isTypeAllowed(TYPES.A320, 1700));
    t.false(isTypeAllowed(TYPES.B739, 2286));
    t.false(isTypeAllowed(TYPES.A388, 2286));
    t.false(isTypeAllowed(TYPES.B744, 2500));
    t.true(isTypeAllowed(TYPES.B744, 3300));
    t.true(isTypeAllowed(TYPES.AT72, 1300));
    t.true(isTypeAllowed(TYPES.E170, 1500));
    t.false(isTypeAllowed(TYPES.E190, 1400));
    t.true(requiredRunwayKm(TYPES.A320, 5000) > requiredRunwayKm(TYPES.A320, 0));
});

ava('runways: names are parsed, padded and checked for reciprocity', (t) => {
    t.deepEqual(parseRunwayEnd('9L'), { num: 9, suffix: 'L' });
    t.deepEqual(parseRunwayEnd('13T'), { num: 13, suffix: '' });
    t.is(parseRunwayEnd('H1'), null);
    t.is(parseRunwayEnd('37'), null);
    t.true(areReciprocal(parseRunwayEnd('09L'), parseRunwayEnd('27R')));
    t.true(areReciprocal(parseRunwayEnd('36'), parseRunwayEnd('18')));
    t.false(areReciprocal(parseRunwayEnd('09L'), parseRunwayEnd('27L')));
    t.false(areReciprocal(parseRunwayEnd('09'), parseRunwayEnd('28')));
    t.true(isHardSurface('ASPH-G'));
    t.true(isHardSurface('Concrete/Asphalt'));
    t.false(isHardSurface('TURF'));
    t.false(isHardSurface('Graded Hardcore'));
});

ava('runways: builds a pair from OurAirports rows and skips unsuitable ones', (t) => {
    const end = (ident, lat, lon, elevationFt) => ({
        ident, lat, lon, elevationFt, headingTrue: null, displacedFt: null
    });
    const rows = [
        {
            lengthFt: 7497, widthFt: 150, surface: 'ASP', lighted: true, closed: false, le: end('9', 53.3329, -2.8660, 59), he: end('27', 53.3344, -2.8327, 77)
        },
        {
            lengthFt: 3000, widthFt: 60, surface: 'TURF', lighted: false, closed: false, le: end('04', null, null, null), he: end('22', null, null, null)
        },
        {
            lengthFt: 6000, widthFt: 100, surface: 'ASP', lighted: false, closed: true, le: end('01', null, null, null), he: end('19', null, null, null)
        }
    ];
    const result = buildRunways(rows, { lat: 53.3349, lon: -2.8496, elevationFt: 80 }, 0, {});

    t.is(result.runways.length, 1);
    t.deepEqual(result.runways[0].names, ['09', '27']);
    t.true(result.longestM > 2200 && result.longestM < 2400);
    t.false(result.approximate);
});

ava('naming: call signs and radio place names', (t) => {
    t.is(cleanCallsignName('SPEEDBIRD'), 'Speedbird');
    t.is(cleanCallsignName('NOR SHUTTLE'), 'Nor Shuttle');
    t.is(cleanCallsignName('CSA'), 'CSA');
    t.is(cleanCallsignName('AL-AAS'), 'Al-Aas');
    t.is(cleanCallsignName(''), null);
    t.is(cleanCallsignName('N/A'), null);
    t.is(cleanCallsignName('5B'), null);
    t.is(airportPlaceName('Liverpool John Lennon Airport', 'Liverpool'), 'Liverpool');
    t.is(airportPlaceName('Edinburgh Airport', 'Ingliston, Edinburgh'), 'Edinburgh');
    t.is(airportPlaceName('London Stansted Airport', 'London'), 'Stansted');
    t.is(airportPlaceName('Charles de Gaulle International Airport', 'Paris (Roissy-en-France)', 'Paris'), 'Paris');
});

ava('geo: scope-space offsets round-trip', (t) => {
    const [lat, lon] = simOffsetToLatLon(53.3349, -2.8496, -1.5, 135, 42);
    const [bearing, distance] = simBearingDistance(53.3349, -2.8496, -1.5, lat, lon);

    t.true(Math.abs(bearing - 135) < 0.3);
    t.true(Math.abs(distance - 42) < 0.3);
});

ava('gates: bearing clustering finds the two dominant sectors', (t) => {
    const samples = [
        { bearing: 140, weight: 10 }, { bearing: 150, weight: 6 }, { bearing: 260, weight: 8 }, { bearing: 255, weight: 5 }
    ];
    const gates = pickGateBearings(samples, 6, 30);

    t.is(gates.length, 2);
    t.true(gates.some((g) => Math.abs(g - 144) < 12));
    t.true(gates.some((g) => Math.abs(g - 258) < 12));
    t.true(COMMAND_WORDS.has('ILS'));
});

ava('format: top-level keys are on their own line and the text parses back', (t) => {
    const obj = {
        _generated: true, icao: 'TEST', fixes: { A: [1, 2], B: [3, 4, 'bee'] }, maps: [{ name: 'x', lines: [[1, 2, 3, 4], [5, 6, 7, 8]] }]
    };
    const text = serializeFile(obj);

    t.deepEqual(JSON.parse(text), obj);
    t.true(text.startsWith('{\n    "_generated": true,\n    "icao": "TEST"'));
    t.true(text.includes('\n        "A": [1,2],\n'));
});

ava('loadlist: generated entries are merged without touching hand-authored text and re-merging is stable', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openscope-loadlist-'));
    const file = path.join(dir, 'airportLoadList.json');
    const original = '[\n    {\n        "icao": "aaaa",\n        "level": "easy",\n        "name": "A",\n        "premium": false\n    },\n' +
        '\t{\n        "icao": "cccc",\n        "level": "easy",\n        "name": "C",\n        "premium": false,\n        "disabled": true\n    }\n]\n';

    fs.writeFileSync(file, original);

    const entry = {
        icao: 'bbbb', level: 'beginner', name: 'B', premium: false, iata: 'BBB', country: 'GB', generated: true
    };
    const first = mergeLoadList(file, [entry]);
    const merged = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(merged);

    t.is(first.added, 1);
    t.deepEqual(parsed.map((e) => e.icao), ['aaaa', 'bbbb', 'cccc']);
    t.true(merged.includes('\t{\n        "icao": "cccc"'));

    const second = mergeLoadList(file, [entry]);

    t.false(second.changed);
    t.is(fs.readFileSync(file, 'utf8'), merged);

    // removing the generated entry restores the original text exactly
    mergeLoadList(file, []);
    t.is(fs.readFileSync(file, 'utf8'), original);

    fs.unlinkSync(file);
    fs.rmdirSync(dir);
});
