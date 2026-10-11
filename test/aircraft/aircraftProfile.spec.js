/* eslint-disable arrow-parens, max-len, import/no-extraneous-dependencies */
import ava from 'ava';
import {
    FUEL_POLICY,
    buildDepartureFuel,
    buildInboundFuel,
    buildPassengerLoad,
    formatEnduranceForDisplay,
    formatEnduranceForRadio,
    getBurnRateKgPerSecond,
    getCabinCrewCount,
    getEnduranceMinutes,
    getFlightCrewCount,
    getFuelForEnduranceMinutes,
    getFuelFlowFactor,
    getFuelState
} from '../../src/assets/scripts/client/aircraft/aircraftProfile';

const loadType = (icao) => require(`../../assets/aircraft/${icao.toLowerCase()}.json`);
const seeded = (values) => {
    let i = 0;

    return () => values[i++ % values.length];
};

ava('every shipped aircraft type has a complete profile block', (t) => {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '../../assets/aircraft');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'aircraft.json');

    t.true(files.length > 100);

    files.forEach((file) => {
        const type = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));

        t.truthy(type.profile, `${type.icao} has a profile`);
        t.true(type.profile.seats >= 0, `${type.icao} seats`);
        t.true(type.profile.fuelBurnKgPerHour > 0, `${type.icao} burn`);
        t.true(type.profile.fuelCapacityKg > 0, `${type.icao} capacity`);
        // capacity should give a sane maximum endurance (catches unit typos): 20 min .. 24 h
        const enduranceHours = type.profile.fuelCapacityKg / type.profile.fuelBurnKgPerHour;

        t.true(enduranceHours > 0.3 && enduranceHours < 24, `${type.icao} full-tank endurance ${enduranceHours.toFixed(1)} h`);
    });
});

ava('crew counts follow type and size', (t) => {
    t.is(getFlightCrewCount(loadType('C172')), 1);
    t.is(getFlightCrewCount(loadType('A320')), 2);
    t.is(getFlightCrewCount(loadType('B744')), 3);
    t.is(getCabinCrewCount(loadType('C172')), 0);
    t.is(getCabinCrewCount(loadType('A320')), 4);
    t.is(getCabinCrewCount(loadType('A388')), 11);
});

ava('buildPassengerLoad() never overfills the cabin and counts every soul', (t) => {
    ['A320', 'B77W', 'A388', 'AT72', 'C172', 'GLF5', 'C130'].forEach((icao) => {
        const type = loadType(icao);

        for (let i = 0; i < 200; i++) {
            const load = buildPassengerLoad(type);

            t.true(load.passengers <= type.profile.seats, `${icao} pax within seats`);
            t.is(load.souls, load.passengers + load.flightCrew + load.cabinCrew);
        }
    });
});

ava('airline loads are weighted toward a busy cabin; freighters carry crew only', (t) => {
    const a320 = loadType('A320');
    const loads = Array.from({ length: 500 }, () => buildPassengerLoad(a320).passengers);
    const mean = loads.reduce((a, b) => a + b, 0) / loads.length;

    t.true(mean > 168 * 0.7 && mean < 168 * 0.95, `mean A320 load ${mean}`);
    t.is(buildPassengerLoad(loadType('C130')).passengers, 0);
});

ava('buildPassengerLoad() accepts an injected random source', (t) => {
    const low = buildPassengerLoad(loadType('A320'), seeded([0]));
    const high = buildPassengerLoad(loadType('A320'), seeded([0.999999]));

    t.true(low.passengers < high.passengers);
});

ava('fuel flow factor reflects phase of flight', (t) => {
    t.is(getFuelFlowFactor({ isOnGround: true, isMoving: false, isEngineRunning: false }), 0);
    t.true(getFuelFlowFactor({ isOnGround: true, isMoving: true }) < getFuelFlowFactor({ isOnGround: false, altitude: 36000 }));
    t.true(getFuelFlowFactor({ isOnGround: false, trend: 1, altitude: 3000 }) > getFuelFlowFactor({ isOnGround: false, altitude: 36000 }));
    t.true(getFuelFlowFactor({ isOnGround: false, trend: -1, altitude: 20000 }) < 0.6);
});

ava('burn rate scales with the type', (t) => {
    const cruise = { isOnGround: false, altitude: 36000 };

    t.true(getBurnRateKgPerSecond(loadType('B744'), cruise) > getBurnRateKgPerSecond(loadType('A320'), cruise) * 3);
    t.is(getBurnRateKgPerSecond(loadType('A320'), cruise), 2450 / 3600);
});

ava('endurance and fuel-for-endurance are inverse operations', (t) => {
    const type = loadType('B738');
    const fuel = getFuelForEnduranceMinutes(type, 75);

    t.true(Math.abs(getEnduranceMinutes(type, fuel) - 75) < 1e-9);
});

ava('buildInboundFuel() ordinary arrivals carry more than the 30 minute final reserve', (t) => {
    for (let i = 0; i < 300; i++) {
        const type = loadType(['A320', 'B738', 'E190', 'AT72', 'B77W'][i % 5]);
        const endurance = getEnduranceMinutes(type, buildInboundFuel(type));

        t.true(endurance >= FUEL_POLICY.FINAL_RESERVE_MINUTES + 20, `endurance ${endurance}`);
    }
});

ava('buildInboundFuel() low fuel flags produce minimum and emergency endurance bands', (t) => {
    const type = loadType('A320');

    for (let i = 0; i < 100; i++) {
        const minimum = getEnduranceMinutes(type, buildInboundFuel(type, { fuelProblem: 'minimum' }));
        const emergency = getEnduranceMinutes(type, buildInboundFuel(type, { fuelProblem: 'emergency' }));

        t.is(getFuelState(minimum), 'minimum');
        t.is(getFuelState(emergency), 'emergency');
    }
});

ava('buildDepartureFuel() grows with sector length and never exceeds capacity', (t) => {
    const type = loadType('A320');
    const short = buildDepartureFuel(type, 150, seeded([0.5]));
    const long = buildDepartureFuel(type, 1200, seeded([0.5]));

    t.true(long > short);
    t.true(buildDepartureFuel(type, 99999) <= type.profile.fuelCapacityKg);
});

ava('buildDepartureFuel() carries final reserve even on a very short hop', (t) => {
    const type = loadType('E190');
    const endurance = getEnduranceMinutes(type, buildDepartureFuel(type, 50));

    t.true(endurance > FUEL_POLICY.FINAL_RESERVE_MINUTES);
});

ava('getFuelState() thresholds', (t) => {
    t.is(getFuelState(90), 'normal');
    t.is(getFuelState(FUEL_POLICY.MINIMUM_FUEL_MINUTES), 'minimum');
    t.is(getFuelState(FUEL_POLICY.EMERGENCY_FUEL_MINUTES), 'emergency');
});

ava('endurance formatting', (t) => {
    t.is(formatEnduranceForRadio(80), '1 hour 20 minutes');
    t.is(formatEnduranceForRadio(120), '2 hours');
    t.is(formatEnduranceForRadio(43), '45 minutes');
    t.is(formatEnduranceForDisplay(80), '1h20');
    t.is(formatEnduranceForDisplay(5), '0h05');
});
