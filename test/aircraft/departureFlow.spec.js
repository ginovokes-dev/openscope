import ava from 'ava';
import {
    DEPARTURE_TIMING,
    addGroundControlPositions,
    buildClearancePhrases,
    formatSquawk,
    randomBetween,
    taxiSecondsForRunwayLength
} from '../../src/assets/scripts/client/aircraft/departureFlow';

ava('addGroundControlPositions derives delivery and ground from the tower name', (t) => {
    const radio = addGroundControlPositions({ twr: 'Manchester Tower', app: 'Manchester Radar' });

    t.is(radio.del, 'Manchester Delivery');
    t.is(radio.gnd, 'Manchester Ground');
    t.is(radio.twr, 'Manchester Tower');
});

ava('addGroundControlPositions keeps names already present and falls back to the airport name', (t) => {
    t.is(addGroundControlPositions({ twr: 'Tower', gnd: 'Apron Control' }).gnd, 'Apron Control');
    t.is(addGroundControlPositions(null, 'Liverpool').del, 'Liverpool Delivery');
    t.is(addGroundControlPositions({ twr: 'Humberside' }).gnd, 'Humberside Ground');
});

ava('taxi time grows with the size of the airport and stays in range', (t) => {
    const low = taxiSecondsForRunwayLength(1200, () => 0.999);
    const high = taxiSecondsForRunwayLength(4500, () => 0.999);

    t.true(high > low);
    t.true(low >= DEPARTURE_TIMING.TAXI_MIN);
    t.true(high <= DEPARTURE_TIMING.TAXI_MAX);
});

ava('randomBetween and formatSquawk', (t) => {
    t.is(randomBetween(10, 20, () => 0.5), 15);
    t.is(formatSquawk(7), '0007');
    t.is(formatSquawk(4721), '4721');
});

ava('clearance phrases cover a SID, an as-filed route and a missing squawk', (t) => {
    const withSid = buildClearancePhrases({
        destination: 'Dublin', sidName: 'Daventry 2L', runwayName: '23R', initialAltitude: 5000, squawk: 4721
    });

    t.is(withSid.route, 'via the Daventry 2L departure');
    t.is(withSid.runway, 'runway 23R');
    t.is(withSid.climb, 'initial climb 5000');
    t.is(withSid.squawk, 'squawk 4721');

    const filed = buildClearancePhrases({});

    t.is(filed.destination, 'destination');
    t.is(filed.route, 'as filed');
    t.is(filed.squawk, '');
});
