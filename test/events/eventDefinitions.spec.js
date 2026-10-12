/* eslint-disable arrow-parens, max-len, import/no-extraneous-dependencies */
import ava from 'ava';
import { EVENT_CATEGORY, EVENT_DEFINITIONS, distanceNm } from '../../src/assets/scripts/client/events/eventDefinitions';
import { selectEvent } from '../../src/assets/scripts/client/events/EventDirector';
import {
    FAILURE_FREQUENCY,
    FREQUENCY_PROFILE,
    getFrequencyProfile,
    sampleExponentialDelay,
    sampleFirstEventDelay
} from '../../src/assets/scripts/client/events/eventTiming';

const makeAircraft = (overrides = {}) => ({
    callsign: 'TST1',
    isControllable: true,
    hit: false,
    isNordo: false,
    diversion: null,
    emergency: null,
    pendingRequest: null,
    category: 'arrival',
    flightPhase: 'DESCENT',
    altitude: 6000,
    distance: 40 * 1.852,
    model: { engines: { number: 2 }, ceiling: 39000 },
    onboard: { enduranceMinutes: 90, passengers: 120 },
    isAirborne: () => true,
    isArrival() { return this.category === 'arrival'; },
    isDeparture() { return this.category === 'departure'; },
    ...overrides
});

const CLEAR = {
    visibilityMeters: 9999, phenomena: [], ceilingFeet: null, windGust: null
};
const ctx = (aircraft, weather = CLEAR, random = () => 0.1) => ({
    aircraft, weather, random, now: 0, airportIcao: 'EGGP', actions: { getFixAhead: () => 'DET' }
});
const definition = (id) => EVENT_DEFINITIONS.find((d) => d.id === id);

ava('every definition declares what it needs', (t) => {
    const ids = new Set();

    EVENT_DEFINITIONS.forEach((d) => {
        t.false(ids.has(d.id), `duplicate id ${d.id}`);
        ids.add(d.id);
        t.true(Object.values(EVENT_CATEGORY).includes(d.category), `${d.id} category`);
        t.true(['failure', 'request'].includes(d.process), `${d.id} process`);
        t.true(d.weight > 0, `${d.id} weight`);
        t.is(typeof d.pick, 'function');
        t.is(typeof d.start, 'function');
    });
});

ava('distanceNm() converts the model kilometres', (t) => {
    t.true(Math.abs(distanceNm({ distance: 18.52 }) - 10) < 1e-9);
});

ava('LOW_FUEL only picks controllable inbound aircraft with plenty of fuel and not on approach', (t) => {
    const good = makeAircraft({ callsign: 'GOOD' });
    const departure = makeAircraft({ callsign: 'DEP', category: 'departure' });
    const uncontrollable = makeAircraft({ callsign: 'OUT', isControllable: false });
    const alreadyLow = makeAircraft({ callsign: 'LOW', onboard: { enduranceMinutes: 30, passengers: 100 } });
    const onFinal = makeAircraft({ callsign: 'FINAL', flightPhase: 'LANDING' });
    const nordo = makeAircraft({ callsign: 'NORDO', isNordo: true });
    const emergency = makeAircraft({ callsign: 'EMG', emergency: { resolved: false } });
    const tooClose = makeAircraft({ callsign: 'CLOSE', distance: 3 * 1.852 });
    const picked = definition('LOW_FUEL').pick(ctx([departure, uncontrollable, alreadyLow, onFinal, nordo, emergency, tooClose, good]));

    t.is(picked.callsign, 'GOOD');
    t.is(definition('LOW_FUEL').pick(ctx([departure])), null);
    t.is(definition('LOW_FUEL').pick(ctx([])), null);
});

ava('BIRD_STRIKE needs a low departure', (t) => {
    const lowDeparture = makeAircraft({ category: 'departure', altitude: 1500 });
    const highDeparture = makeAircraft({ category: 'departure', altitude: 9000 });

    t.is(definition('BIRD_STRIKE').pick(ctx([lowDeparture])), lowDeparture);
    t.is(definition('BIRD_STRIKE').pick(ctx([highDeparture])), null);
    t.is(definition('BIRD_STRIKE').pick(ctx([makeAircraft()])), null);
});

ava('PRESSURISATION needs a high aircraft', (t) => {
    t.is(definition('PRESSURISATION').pick(ctx([makeAircraft({ altitude: 8000 })])), null);
    t.truthy(definition('PRESSURISATION').pick(ctx([makeAircraft({ altitude: 24000 })])));
});

ava('ENGINE_FAILURE requires a multi-engine aircraft', (t) => {
    const single = makeAircraft({ model: { engines: { number: 1 }, ceiling: 15000 } });

    t.is(definition('ENGINE_FAILURE').pick(ctx([single])), null);
    t.truthy(definition('ENGINE_FAILURE').pick(ctx([makeAircraft()])));
});

ava('go-arounds need an aircraft established on final', (t) => {
    const onFinal = makeAircraft({ flightPhase: 'LANDING', distance: 3 * 1.852, altitude: 1500 });
    const farOut = makeAircraft({ flightPhase: 'APPROACH', distance: 15 * 1.852, altitude: 4000 });
    const turbulent = { ...CLEAR, windGust: 32 };

    t.is(definition('OPERATIONAL_GO_AROUND').pick(ctx([onFinal, farOut])), onFinal);
    t.is(definition('OPERATIONAL_GO_AROUND').pick(ctx([farOut])), null);
    // windshear needs gusty or stormy weather
    t.is(definition('WINDSHEAR_GO_AROUND').pick(ctx([onFinal], CLEAR)), null);
    t.is(definition('WINDSHEAR_GO_AROUND').pick(ctx([onFinal], turbulent)), onFinal);
    t.is(definition('WINDSHEAR_GO_AROUND').pick(ctx([onFinal], { ...CLEAR, phenomena: ['TSRA'] })), onFinal);
});

ava('weather diversion requests only happen in bad weather', (t) => {
    const aircraft = makeAircraft();
    const fog = {
        visibilityMeters: 400, phenomena: ['FG'], ceilingFeet: 100, windGust: null
    };

    t.is(definition('WEATHER_DIVERSION_REQUEST').pick(ctx([aircraft], CLEAR)), null);
    t.is(definition('WEATHER_DIVERSION_REQUEST').pick(ctx([aircraft], fog)), aircraft);
    t.is(definition('WEATHER_DIVERSION_REQUEST').pick(ctx([aircraft], { ...CLEAR, phenomena: ['TSRA'] })), aircraft);
});

ava('request events skip aircraft that already have a pending request', (t) => {
    const busy = makeAircraft({ pendingRequest: { type: 'direct' } });
    const free = makeAircraft({ category: 'departure' });

    t.is(definition('REQUEST_DIRECT').pick(ctx([busy])), null);
    t.is(definition('REQUEST_DIRECT').pick(ctx([busy, free])), free);
    t.is(definition('REQUEST_ALTITUDE').pick(ctx([makeAircraft()])), null, 'arrivals do not ask for altitude changes');
});

ava('MEDICAL needs enough passengers', (t) => {
    t.is(definition('MEDICAL').pick(ctx([makeAircraft({ onboard: { enduranceMinutes: 90, passengers: 3 } })])), null);
    t.truthy(definition('MEDICAL').pick(ctx([makeAircraft()])));
});

ava('selectEvent() honours disabled categories and the process', (t) => {
    const aircraft = [makeAircraft({ category: 'departure', altitude: 1500 }), makeAircraft()];
    const everything = () => true;
    const failuresOnly = selectEvent(EVENT_DEFINITIONS, ctx(aircraft), everything, 'failure');

    t.truthy(failuresOnly);
    t.is(failuresOnly.definition.process, 'failure');

    const requestsOnly = selectEvent(EVENT_DEFINITIONS, ctx(aircraft), everything, 'request');

    t.is(requestsOnly.definition.process, 'request');

    // with every category off nothing can be chosen
    t.is(selectEvent(EVENT_DEFINITIONS, ctx(aircraft), () => false, 'failure'), null);

    // with only fuel enabled the result must be a fuel event
    const fuelOnly = selectEvent(EVENT_DEFINITIONS, ctx(aircraft), (category) => category === EVENT_CATEGORY.FUEL, 'failure');

    t.is(fuelOnly.definition.category, EVENT_CATEGORY.FUEL);
});

ava('selectEvent() returns null when nothing is possible', (t) => {
    t.is(selectEvent(EVENT_DEFINITIONS, ctx([]), () => true, 'failure'), null);
});

ava('frequency profiles get steadily busier', (t) => {
    const order = [FAILURE_FREQUENCY.RARE, FAILURE_FREQUENCY.OCCASIONAL, FAILURE_FREQUENCY.FREQUENT, FAILURE_FREQUENCY.CHAOS];

    for (let i = 1; i < order.length; i++) {
        t.true(FREQUENCY_PROFILE[order[i]].meanFailureSeconds < FREQUENCY_PROFILE[order[i - 1]].meanFailureSeconds);
        t.true(FREQUENCY_PROFILE[order[i]].meanRequestSeconds <= FREQUENCY_PROFILE[order[i - 1]].meanRequestSeconds);
    }

    t.is(FREQUENCY_PROFILE[FAILURE_FREQUENCY.OFF].meanFailureSeconds, Infinity);
    t.is(FREQUENCY_PROFILE[FAILURE_FREQUENCY.OFF].maxActiveEmergencies, 0);
    t.is(getFrequencyProfile('nonsense'), FREQUENCY_PROFILE[FAILURE_FREQUENCY.RARE]);
});

ava('sampleExponentialDelay() has the requested mean and a minimum gap', (t) => {
    let seed = 7;
    const random = () => {
        seed = (seed * 16807) % 2147483647;

        return seed / 2147483647;
    };
    let total = 0;
    const samples = 20000;

    for (let i = 0; i < samples; i++) {
        const delay = sampleExponentialDelay(600, random);

        t.true(delay >= 90);
        total += delay;
    }

    const mean = total / samples;

    t.true(mean > 560 && mean < 700, `mean ${mean}`);
    t.is(sampleExponentialDelay(Infinity), Infinity);
});

ava('first event is delayed so the player can settle in', (t) => {
    [FAILURE_FREQUENCY.RARE, FAILURE_FREQUENCY.CHAOS].forEach((frequency) => {
        const [min, max] = FREQUENCY_PROFILE[frequency].firstEventDelaySeconds;

        t.is(sampleFirstEventDelay(frequency, () => 0), min);
        t.is(sampleFirstEventDelay(frequency, () => 1), max);
        t.true(min >= 90);
    });
});
