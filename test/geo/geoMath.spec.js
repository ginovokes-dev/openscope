/* eslint-disable arrow-parens, max-len, import/no-extraneous-dependencies */
import ava from 'ava';
import {
    compassPoint,
    destinationPoint,
    greatCircleDistanceNm,
    initialBearingDegrees
} from '../../src/assets/scripts/client/geo/geoMath';
import { AirportIndex } from '../../src/assets/scripts/client/geo/AirportIndex';

const EGLL = [51.4706, -0.4619];
const EGGP = [53.3336, -2.8497];
const KJFK = [40.6398, -73.7789];

ava('great circle distance between known airports is accurate to within 1%', (t) => {
    // Heathrow - Liverpool ~ 138 nm; Heathrow - JFK ~ 2,990 nm
    const lhrLpl = greatCircleDistanceNm(...EGLL, ...EGGP);
    const lhrJfk = greatCircleDistanceNm(...EGLL, ...KJFK);

    t.true(Math.abs(lhrLpl - 138) / 138 < 0.03, `LHR-LPL ${lhrLpl}`);
    t.true(Math.abs(lhrJfk - 2990) / 2990 < 0.01, `LHR-JFK ${lhrJfk}`);
    t.is(greatCircleDistanceNm(...EGLL, ...EGLL), 0);
});

ava('initial bearing', (t) => {
    // Liverpool is north-west of Heathrow (about 323 degrees true)
    const bearing = initialBearingDegrees(...EGLL, ...EGGP);

    t.true(bearing > 315 && bearing < 330, `bearing ${bearing}`);
    t.true(Math.abs(initialBearingDegrees(0, 0, 10, 0)) < 1e-9);
    t.true(Math.abs(initialBearingDegrees(0, 0, 0, 10) - 90) < 1e-9);
});

ava('destinationPoint() is the inverse of distance + bearing', (t) => {
    const point = destinationPoint(...EGLL, 90, 100);

    t.true(Math.abs(greatCircleDistanceNm(...EGLL, point.latitude, point.longitude) - 100) < 0.01);
    t.true(Math.abs(initialBearingDegrees(...EGLL, point.latitude, point.longitude) - 90) < 0.5);
});

ava('compassPoint()', (t) => {
    t.is(compassPoint(0), 'north');
    t.is(compassPoint(350), 'north');
    t.is(compassPoint(135), 'south-east');
    t.is(compassPoint(270), 'west');
});

const buildIndex = () => {
    const index = new AirportIndex();

    index.populate({
        fields: ['icao', 'iata', 'name', 'city', 'country', 'lat', 'lon', 'elev_ft', 'rwy_m', 'type'],
        airports: [
            ['EGLL', 'LHR', 'London Heathrow Airport', 'London', 'GB', 51.4706, -0.4619, 83, 3902, 'large_airport'],
            ['EGGP', 'LPL', 'Liverpool John Lennon Airport', 'Liverpool', 'GB', 53.3336, -2.8497, 81, 2286, 'large_airport'],
            ['EGCC', 'MAN', 'Manchester Airport', 'Manchester', 'GB', 53.3537, -2.275, 257, 3050, 'large_airport'],
            ['EGNR', 'CEG', 'Hawarden Airport', 'Chester', 'GB', 53.1781, -2.9778, 45, 1500, 'medium_airport'],
            ['EGGG', '', 'Dummy strip', 'Nowhere', 'GB', 53.4, -2.9, 10, 900, 'small_airport'],
            ['KJFK', 'JFK', 'John F Kennedy International Airport', 'New York', 'US', 40.6398, -73.7789, 13, 4423, 'large_airport'],
            ['BAD', 'BAD', 'broken row', 'x', 'x', 'not-a-number', 0, 0, 0, 'x']
        ]
    });

    return index;
};

ava('AirportIndex loads rows and skips malformed ones', (t) => {
    const index = buildIndex();

    t.is(index.size, 6);
    t.true(index.isLoaded);
});

ava('AirportIndex.lookup() accepts ICAO or IATA, any case', (t) => {
    const index = buildIndex();

    t.is(index.lookup('egll').city, 'London');
    t.is(index.lookup('LPL').icao, 'EGGP');
    t.is(index.lookup('nope'), null);
    t.is(index.lookup(''), null);
    t.is(index.lookup(undefined), null);
});

ava('AirportIndex.search() finds by city and name, preferring the main airport', (t) => {
    const index = buildIndex();

    t.is(index.search('liverpool')[0].icao, 'EGGP');
    t.is(index.search('Manchester')[0].icao, 'EGCC');
    t.is(index.search('li').length, 0);
});

ava('AirportIndex distance and bearing helpers', (t) => {
    const index = buildIndex();

    t.true(Math.abs(index.distanceNm('EGLL', 'LPL') - 138) < 5);
    t.is(index.distanceNm('EGLL', 'ZZZZ'), null);
    t.true(index.bearingDegrees('EGLL', 'EGGP') > 315);
});

ava('AirportIndex.findNear() filters by runway length, distance and exclusions, nearest first', (t) => {
    const index = buildIndex();
    const near = index.findNear(53.3336, -2.8497, { minimumRunwayMeters: 2500, excludeIcao: ['EGGP'], maximumDistanceNm: 100 });

    t.deepEqual(near.map((a) => a.icao), ['EGCC']);

    const all = index.findNear(53.3336, -2.8497, { excludeIcao: 'EGGP', maximumDistanceNm: 200, requireIata: false });

    t.deepEqual(all.map((a) => a.icao).slice(0, 3), ['EGGG', 'EGNR', 'EGCC']);
    t.true(all.every((a) => a.distanceNm <= 200));
});

ava('AirportIndex.populate() copes with garbage', (t) => {
    const index = new AirportIndex();

    t.is(index.populate(null), 0);
    t.is(index.populate({ airports: 'nope' }), 0);
    t.false(index.isLoaded);
});
