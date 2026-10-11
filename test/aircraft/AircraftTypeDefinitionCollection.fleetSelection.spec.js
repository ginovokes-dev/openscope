/* eslint-disable arrow-parens, max-len, import/no-extraneous-dependencies */
import ava from 'ava';
import AircraftTypeDefinitionCollection from '../../src/assets/scripts/client/aircraft/AircraftTypeDefinitionCollection';
import AirlineModel from '../../src/assets/scripts/client/airline/AirlineModel';
import { isAircraftTypeSuitableForRunwayLength } from '../../src/assets/scripts/client/aircraft/aircraftSuitability';

const loadType = (icao) => require(`../../assets/aircraft/${icao.toLowerCase()}.json`);
const buildCollection = () => new AircraftTypeDefinitionCollection(
    ['A318', 'A319', 'A320', 'A321', 'A388', 'B744', 'B77W', 'E190', 'AT72'].map(loadType)
);
const buildAirline = (fleets) => new AirlineModel({
    icao: 'tst',
    name: 'Test Airways',
    callsign: { name: 'Testbird', callsignFormats: ['###'] },
    fleets
});

ava('airline fleet draws are weighted, not uniform', (t) => {
    const airline = buildAirline({ default: [['A320', 99], ['A318', 1]] });
    let a318Count = 0;

    for (let i = 0; i < 2000; i++) {
        if (airline.getRandomAircraftType('default') === 'a318') {
            a318Count += 1;
        }
    }

    // expected ~20 of 2000; uniform draws would give ~1000
    t.true(a318Count < 100, `A318 drawn ${a318Count} times`);
});

ava('fleet draws tolerate entries with no usable weight', (t) => {
    const airline = buildAirline({ default: [['A320', 0], ['A319', 'x']] });

    t.notThrows(() => airline.getRandomAircraftType('default'));
});

ava('a fleet name that is an aircraft type works even when the airline does not declare it', (t) => {
    const airline = buildAirline({ default: [['A320', 1]] });
    const result = buildCollection().getAircraftDefinitionForAirlineId('tst/b77w', airline);

    t.is(result.icao, 'B77W');
});

ava('declared fleets still win over type-name lookup', (t) => {
    const airline = buildAirline({ default: [['A320', 1]], a319: [['A321', 1]] });
    const result = buildCollection().getAircraftDefinitionForAirlineId('tst/a319', airline);

    t.is(result.icao, 'A321');
});

ava('the suitability predicate removes unrealistic types from draws', (t) => {
    const airline = buildAirline({ default: [['A320', 10], ['A388', 10], ['B744', 10], ['E190', 10]] });
    const collection = buildCollection();
    const isSuitable = (definition) => isAircraftTypeSuitableForRunwayLength(definition, 2286);

    for (let i = 0; i < 500; i++) {
        const { icao } = collection.getAircraftDefinitionForAirlineId('tst', airline, isSuitable);

        t.true(['A320', 'E190'].includes(icao), `${icao} should not appear at a 2,286 m runway`);
    }
});

ava('when no type in the fleet is suitable the least demanding one is used rather than failing', (t) => {
    const airline = buildAirline({ default: [['A388', 1], ['B77W', 1], ['B744', 1]] });
    const isSuitable = (definition) => isAircraftTypeSuitableForRunwayLength(definition, 1200);
    const result = buildCollection().getAircraftDefinitionForAirlineId('tst', airline, isSuitable);

    // 777-300ER has the smallest requirement of the three heavies
    t.is(result.icao, 'B77W');
});

ava('unknown aircraft types in a fleet no longer cause infinite recursion', (t) => {
    const airline = buildAirline({ default: [['ZZZZ', 1]] });
    const result = buildCollection().getAircraftDefinitionForAirlineId('tst', airline);

    t.is(result.icao, 'A320');
});
