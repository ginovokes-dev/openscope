/* eslint-disable arrow-parens, max-len, import/no-extraneous-dependencies */
import ava from 'ava';
import {
    findLeastDemandingType,
    getLongestRunwayInMeters,
    getRequiredRunwayLengthInMeters,
    isAircraftTypeSuitableForRunwayLength
} from '../../src/assets/scripts/client/aircraft/aircraftSuitability';

const loadType = (icao) => require(`../../assets/aircraft/${icao.toLowerCase()}.json`);

// real longest-runway lengths, metres
const LIVERPOOL = 2286;
const LONDON_CITY = 1508;
const MANCHESTER = 3050;
const HEATHROW = 3902;

ava('widebodies and the A380 are not believable at Liverpool', (t) => {
    ['A388', 'B744', 'B748', 'B77W', 'B772', 'A359', 'A333', 'B788', 'B763'].forEach((icao) => {
        t.false(isAircraftTypeSuitableForRunwayLength(loadType(icao), LIVERPOOL), `${icao} should not operate at Liverpool`);
    });
});

ava('narrowbodies, regional jets and turboprops are believable at Liverpool', (t) => {
    ['A319', 'A320', 'A321', 'A20N', 'B737', 'B738', 'B38M', 'E190', 'E170', 'CRJ9', 'AT72', 'DH8D', 'C172', 'C510'].forEach((icao) => {
        t.true(isAircraftTypeSuitableForRunwayLength(loadType(icao), LIVERPOOL), `${icao} should operate at Liverpool`);
    });
});

ava('London City keeps its real regional and A318/E-jet traffic but not an A320 family stretch', (t) => {
    ['A318', 'E170', 'E190', 'DH8D', 'AT72', 'BCS1'].forEach((icao) => {
        t.true(isAircraftTypeSuitableForRunwayLength(loadType(icao), LONDON_CITY), `${icao} should operate at London City`);
    });
    ['A388', 'B77W', 'A333', 'B744'].forEach((icao) => {
        t.false(isAircraftTypeSuitableForRunwayLength(loadType(icao), LONDON_CITY), `${icao} should not operate at London City`);
    });
});

ava('Manchester hosts the A380 and 747 class but Heathrow certainly does', (t) => {
    t.true(isAircraftTypeSuitableForRunwayLength(loadType('A388'), MANCHESTER));
    t.true(isAircraftTypeSuitableForRunwayLength(loadType('B744'), MANCHESTER));
    t.true(isAircraftTypeSuitableForRunwayLength(loadType('A388'), HEATHROW));
});

ava('a runway length of zero (unknown) never excludes a type', (t) => {
    t.true(isAircraftTypeSuitableForRunwayLength(loadType('A388'), 0));
    t.true(isAircraftTypeSuitableForRunwayLength(loadType('A388'), NaN));
});

ava('the A380 requirement is never below the super-class floor', (t) => {
    t.true(getRequiredRunwayLengthInMeters(loadType('A388')) >= 3000);
});

ava('types with missing runway data still report a positive requirement', (t) => {
    t.true(getRequiredRunwayLengthInMeters({}) > 0);
});

ava('getLongestRunwayInMeters() reads runway lengths (km) from runway pairs', (t) => {
    const airport = { runways: [[{ length: 1.2 }, { length: 1.2 }], [{ length: 2.286 }, { length: 2.286 }]] };

    t.is(getLongestRunwayInMeters(airport), 2286);
    t.is(getLongestRunwayInMeters({ runways: [] }), 0);
    t.is(getLongestRunwayInMeters(null), 0);
});

ava('findLeastDemandingType() returns the type with the smallest requirement', (t) => {
    const result = findLeastDemandingType([loadType('A388'), loadType('A320'), loadType('B77W')]);

    t.is(result.icao, 'A320');
    t.is(findLeastDemandingType([]), undefined);
});
