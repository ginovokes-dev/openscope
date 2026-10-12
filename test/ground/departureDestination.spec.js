import ava from 'ava';
import { AirportIndex } from '../../src/assets/scripts/client/geo/AirportIndex';
import { pickDepartureDestination } from '../../src/assets/scripts/client/aircraft/departureFlow';

const index = new AirportIndex();

index.populate({
    fields: ['icao', 'iata', 'name', 'city', 'country', 'lat', 'lon', 'elev_ft', 'rwy_m', 'type'],
    airports: [
        ['EGLL', 'LHR', 'Heathrow', 'London', 'GB', 51.47, -0.45, 83, 3900, 'large_airport'],
        ['EGCC', 'MAN', 'Manchester', 'Manchester', 'GB', 53.35, -2.27, 257, 3050, 'large_airport'],
        ['EGGP', 'LPL', 'Liverpool', 'Liverpool', 'GB', 53.33, -2.85, 80, 2286, 'medium_airport'],
        ['EIDW', 'DUB', 'Dublin', 'Dublin', 'IE', 53.42, -6.27, 242, 2637, 'large_airport'],
        ['EGSS', 'STN', 'Stansted', 'London', 'GB', 51.89, 0.23, 348, 3048, 'large_airport'],
        ['PABI', 'BIG', 'Allen AAF', 'Delta Junction', 'US', 64.0, -145.7, 1290, 2300, 'small_airport'],
        ['XXXX', '', 'No IATA', 'Nowhere', 'GB', 52.0, -1.0, 100, 3000, 'large_airport']
    ]
});

const origin = { icao: 'EGGP', latitude: 53.33, longitude: -2.85 };

ava('findInDirection returns big airports roughly in that direction, largest first, ignoring those without IATA', (t) => {
    const south = index.findInDirection(53.33, -2.85, 160, { toleranceDegrees: 40, minimumDistanceNm: 50 });

    t.deepEqual(south.map((airport) => airport.icao), ['EGLL', 'EGSS']);
    t.true(south.every((airport) => airport.iata));
});

ava('a departure heading west goes to Ireland, never to its own airport', (t) => {
    const destination = pickDepartureDestination(index, origin, 270, () => 0.5);

    t.is(destination, 'EIDW');
});

ava('when nothing is in the direction it falls back to anything nearby, and no index means no destination', (t) => {
    t.not(pickDepartureDestination(index, origin, 20, () => 0.1), '');
    t.is(pickDepartureDestination(new AirportIndex(), origin, 90), '');
    t.is(pickDepartureDestination(index, null, 90), '');
});

ava('flights are drawn from the large airports when there are several', (t) => {
    const picks = [0, 0.3, 0.6, 0.99].map((value) => pickDepartureDestination(index, origin, 160, () => value));

    t.true(picks.every((icao) => icao === 'EGLL' || icao === 'EGSS'));
});
