/* eslint-disable arrow-parens, max-len, import/no-extraneous-dependencies */
import ava from 'ava';
import OnboardState, { FUEL_STATE } from '../../src/assets/scripts/client/aircraft/OnboardState';

const loadType = (icao) => require(`../../assets/aircraft/${icao.toLowerCase()}.json`);
const CRUISE = { isOnGround: false, trend: 0, altitude: 30000 };

ava('a new arrival carries more than the minimum-fuel threshold', (t) => {
    for (let i = 0; i < 200; i++) {
        const state = new OnboardState({ typeDefinition: loadType('A320'), category: 'arrival' });

        t.is(state.fuelState, FUEL_STATE.NORMAL);
        t.true(state.enduranceMinutes > 50);
    }
});

ava('souls on board are the sum of passengers and crew', (t) => {
    const state = new OnboardState({ typeDefinition: loadType('B77W') });

    t.is(state.souls, state.passengers + state.flightCrew + state.cabinCrew);
    t.true(state.souls > 100);
});

ava('burn() reduces fuel at the cruise rate', (t) => {
    const state = new OnboardState({ typeDefinition: loadType('A320') });

    // a random start can be under an hour of fuel, which would not last the full hour of burn
    state.setEnduranceMinutes(300);

    const before = state.fuelKg;

    state.burn(3600, CRUISE);

    t.true(Math.abs((before - state.fuelKg) - 2450) < 1e-6);
});

ava('burn() reports each worse fuel state exactly once as fuel runs down', (t) => {
    const state = new OnboardState({ typeDefinition: loadType('A320'), category: 'arrival' });
    const reported = [];

    for (let minute = 0; minute < 600 && state.fuelState !== FUEL_STATE.EXHAUSTED; minute++) {
        reported.push(...state.burn(60, CRUISE));
    }

    t.deepEqual(reported, [FUEL_STATE.MINIMUM, FUEL_STATE.EMERGENCY, FUEL_STATE.EXHAUSTED]);
    t.is(state.fuelKg, 0);
    t.deepEqual(state.burn(60, CRUISE), []);
});

ava('burn() ignores non-positive time steps (paused sim)', (t) => {
    const state = new OnboardState({ typeDefinition: loadType('A320') });
    const before = state.fuelKg;

    t.deepEqual(state.burn(0, CRUISE), []);
    t.deepEqual(state.burn(-5, CRUISE), []);
    t.is(state.fuelKg, before);
});

ava('engines off burn nothing', (t) => {
    const state = new OnboardState({ typeDefinition: loadType('A320'), category: 'departure' });
    const before = state.fuelKg;

    state.burn(600, { isOnGround: true, isMoving: false, isEngineRunning: false });

    t.is(state.fuelKg, before);
});

ava('fuel problems start in the right band', (t) => {
    const minimum = new OnboardState({ typeDefinition: loadType('B738'), fuelProblem: 'minimum' });
    const emergency = new OnboardState({ typeDefinition: loadType('B738'), fuelProblem: 'emergency' });

    t.is(minimum.fuelState, FUEL_STATE.MINIMUM);
    t.is(emergency.fuelState, FUEL_STATE.EMERGENCY);
});

ava('setEnduranceMinutes() sets endurance and re-arms declarations', (t) => {
    const state = new OnboardState({ typeDefinition: loadType('A320') });

    state.setEnduranceMinutes(30);

    t.true(Math.abs(state.enduranceMinutes - 30) < 0.01);
    t.is(state.fuelState, FUEL_STATE.MINIMUM);
    // not yet reported: the next burn reports the state it is in once something worse happens
    const reported = [];

    for (let i = 0; i < 40; i++) {
        reported.push(...state.burn(60, CRUISE));
    }

    t.true(reported.includes(FUEL_STATE.EMERGENCY));
});

ava('markReported() suppresses an already-declared state', (t) => {
    const state = new OnboardState({ typeDefinition: loadType('A320') });

    state.setEnduranceMinutes(30);
    state.markReported(FUEL_STATE.MINIMUM);

    const reported = [];

    for (let i = 0; i < 40; i++) {
        reported.push(...state.burn(60, CRUISE));
    }

    t.false(reported.includes(FUEL_STATE.MINIMUM));
    t.true(reported.includes(FUEL_STATE.EMERGENCY));
});

ava('fuel never exceeds capacity', (t) => {
    const state = new OnboardState({ typeDefinition: loadType('E190') });

    state.setEnduranceMinutes(100000);

    t.is(state.fuelKg, state.fuelCapacityKg);
});

ava('describe() gives displayable and speakable values', (t) => {
    const state = new OnboardState({ typeDefinition: loadType('A320') });

    state.setEnduranceMinutes(80);
    const d = state.describe('kg');

    t.is(d.enduranceDisplay, '1h20');
    t.is(d.enduranceSpoken, '1 hour 20 minutes');
    t.is(d.fuelUnit, 'kg');
    t.is(d.fuelQuantity % 10, 0);
    t.is(d.fuelState, FUEL_STATE.NORMAL);
    t.true(state.describe('lb').fuelQuantity > d.fuelQuantity * 2);
    t.true(d.fuelPercent > 0 && d.fuelPercent <= 100);
});
