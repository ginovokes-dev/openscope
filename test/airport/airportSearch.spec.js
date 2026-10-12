import ava from 'ava';
import { buildAirportKeywords, getCountryName, matchesAirportQuery } from '../../src/assets/scripts/client/airport/airportSearch';

const LIVERPOOL = {
    icao: 'EGGP', iata: 'LPL', name: 'Liverpool John Lennon Airport', city: 'Liverpool', country: 'GB'
};

ava('keywords include code, iata, name, city and country words', (t) => {
    const keywords = buildAirportKeywords(LIVERPOOL);

    ['eggp', 'lpl', 'john lennon', 'liverpool', 'gb', 'united kingdom', 'uk', 'england'].forEach((word) => t.true(keywords.indexOf(word) !== -1, word));
});

ava('every term of a query must match', (t) => {
    const keywords = buildAirportKeywords(LIVERPOOL);

    t.true(matchesAirportQuery(keywords, 'liverpool'));
    t.true(matchesAirportQuery(keywords, 'lpl'));
    t.true(matchesAirportQuery(keywords, 'uk liverpool'));
    t.false(matchesAirportQuery(keywords, 'manchester'));
    t.false(matchesAirportQuery(keywords, 'uk manchester'));
    t.true(matchesAirportQuery(keywords, '   '));
});

ava('country names resolve and fall back to the code', (t) => {
    t.is(getCountryName(''), '');
    t.is(getCountryName('zz').length > 0, true);
});
