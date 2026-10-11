/* eslint-disable no-bitwise */
/**
 * Procedural NOTAM / remark generator for the ATIS
 *
 * Produces the kind of operational remarks that appear on a real ATIS ("birds reported in the vicinity",
 * "runway wet", "crane at...", "GNSS interference"). Every item is purely informational and is chosen
 * consistently with the weather and the airport, so the ATIS never contradicts the simulation.
 *
 * A seeded random source makes the selection stable for an airport during a session (the same notices
 * persist from one ATIS letter to the next, as real NOTAMs do) while still varying between sessions.
 */

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

const pick = (list, random) => list[Math.floor(random() * list.length)];

/**
 * Remarks that follow directly from present weather and runway state
 *
 * @function buildWeatherRemarks
 * @param weather {object} snapshot
 * @param runway {string} runway in use
 * @return {array<string>}
 */
export const buildWeatherRemarks = (weather, runway) => {
    const remarks = [];
    const wet = weather.phenomena.some((code) => /RA|SN|SH|TS/.test(code));
    const snowing = weather.phenomena.some((code) => /SN/.test(code));

    if (snowing) {
        remarks.push(`Runway ${runway} contaminated, braking action medium`);
    } else if (wet) {
        remarks.push(`Runway ${runway} wet`);
    }

    if (weather.windGust && weather.windGust >= 28) {
        remarks.push(`Windshear reported on final runway ${runway}`);
    }

    if (weather.phenomena.some((code) => /TS/.test(code))) {
        remarks.push('Thunderstorm activity in the vicinity of the airfield');
    }

    return remarks;
};

/**
 * Standing notices that do not depend on weather
 *
 * @property STANDING_NOTICES
 * @type {array<function>}
 * @final
 */
const STANDING_NOTICES = [
    () => 'Birds reported in the vicinity of the aerodrome',
    () => 'Caution, drone activity reported in the vicinity of the approach paths',
    () => 'GNSS interference reported, crews are advised to cross-check navigation',
    (random) => `Crane ${Math.round((90 + (random() * 260)) / 10) * 10} feet above ground level, ${Math.round(1 + (random() * 3))} nautical miles ${pick(COMPASS, random)} of the airfield`,
    () => 'Some taxiways are closed for maintenance, follow ATC instructions',
    () => 'Work in progress on the apron, caution when taxiing',
    (random) => `Parachute dropping up to flight level ${Math.round(80 + (random() * 70)) * 1} within ${Math.round(3 + (random() * 4))} nautical miles ${pick(COMPASS, random)} of the airfield`,
    () => 'Military helicopter activity reported to the east of the approach path',
    () => 'Grass cutting in progress near the runway, expect brief delays',
    () => 'Runway sweeper in operation, vehicles may be on the manoeuvring area'
];

/**
 * Standing notices for an airport, stable for a given seed
 *
 * @function buildStandingNotices
 * @param random {function}
 * @param count {number} how many to include
 * @return {array<string>}
 */
export const buildStandingNotices = (random = Math.random, count = 2) => {
    const indices = STANDING_NOTICES.map((_, index) => index);
    const notices = [];

    for (let i = 0; i < count && indices.length > 0; i++) {
        const choice = Math.floor(random() * indices.length);
        const [index] = indices.splice(choice, 1);

        notices.push(STANDING_NOTICES[index](random));
    }

    return notices;
};

/**
 * Turn an airport identifier into a repeatable seed so notices stay stable across a session
 *
 * @function seedFromString
 * @param text {string}
 * @return {number}
 */
export const seedFromString = (text) => {
    let hash = 2166136261;

    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }

    return hash >>> 0;
};

/**
 * Small deterministic random source
 *
 * @function createSeededRandom
 * @param seed {number}
 * @return {function}
 */
export const createSeededRandom = (seed) => {
    let state = seed >>> 0;

    return () => {
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);

        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};
