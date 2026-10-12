/**
 * Timing and wording for the ground phase of a departure: stand, clearance, pushback, taxi, holding point, line-up
 *
 * Kept free of game state so it can be tested on its own. `AircraftModel` owns the state and calls these helpers.
 */

export const DEPARTURE_TIMING = {
    // seconds of game time between an aircraft appearing at its stand and the pilot asking for the clearance
    CLEARANCE_REQUEST_MIN: 6,
    CLEARANCE_REQUEST_MAX: 45,
    // seconds between receiving the clearance and being ready for pushback
    READY_FOR_PUSH_MIN: 5,
    READY_FOR_PUSH_MAX: 20,
    // pushback and engine start
    PUSHBACK_MIN: 30,
    PUSHBACK_MAX: 60,
    // taxi from the stand to the holding point: a small airfield is quick, a large one takes a while
    TAXI_MIN: 45,
    TAXI_MAX: 200,
    // pause between arriving at the holding point and the pilot calling ready
    HOLDING_POINT_CALL_DELAY: 4
};

export const DEPARTURE_CALL = {
    CLEARANCE: 'ifr_clearance',
    PUSHBACK: 'pushback',
    READY: 'ready'
};

/**
 * @function randomBetween
 * @param min {number}
 * @param max {number}
 * @param random {function} returns [0, 1)
 * @return {number}
 */
export const randomBetween = (min, max, random = Math.random) => min + ((max - min) * random());

/**
 * How long the taxi from stand to holding point takes, scaled by how large the airport is (using its longest runway)
 *
 * @function taxiSecondsForRunwayLength
 * @param runwayLengthMeters {number}
 * @param random {function}
 * @return {number} seconds
 */
export const taxiSecondsForRunwayLength = (runwayLengthMeters, random = Math.random) => {
    const length = Number.isFinite(runwayLengthMeters) ? runwayLengthMeters : 2500;
    const scale = Math.min(1, Math.max(0, (length - 1000) / 3500));
    const upper = DEPARTURE_TIMING.TAXI_MIN + ((DEPARTURE_TIMING.TAXI_MAX - DEPARTURE_TIMING.TAXI_MIN) * scale);

    return randomBetween(DEPARTURE_TIMING.TAXI_MIN, Math.max(DEPARTURE_TIMING.TAXI_MIN + 10, upper), random);
};

const withPosition = (towerName, replacement, fallbackName) => {
    const tower = String(towerName || '').trim();

    if (tower) {
        return /\btower\b/i.test(tower) ? tower.replace(/\btower\b/i, replacement) : `${tower} ${replacement}`;
    }

    return fallbackName ? `${fallbackName} ${replacement}` : replacement;
};

/**
 * Add `del` (clearance delivery) and `gnd` (ground) to an airport's `radio` positions, derived from its tower name
 *
 * @function addGroundControlPositions
 * @param radio {object|null} `{ twr, app, dep }`
 * @param fallbackName {string} airport name used when there is no tower name
 * @return {object}
 */
export const addGroundControlPositions = (radio, fallbackName = '') => {
    const positions = { ...(radio || {}) };

    positions.del = positions.del || withPosition(positions.twr, 'Delivery', fallbackName);
    positions.gnd = positions.gnd || withPosition(positions.twr, 'Ground', fallbackName);

    return positions;
};

/**
 * A squawk code as the four digits it is spoken as
 *
 * @function formatSquawk
 * @param code {number|string}
 * @return {string}
 */
export const formatSquawk = (code) => String(code).padStart(4, '0');

/**
 * Words for a departure clearance readback
 *
 * @function buildClearancePhrases
 * @param details {object} `{ destination, sidName, runwayName, initialAltitude, squawk }` - `sidName` may be empty
 * @return {object} `{ destination, route, runway, climb, squawk }` pieces, each already in written form
 */
export const buildClearancePhrases = ({
    destination, sidName, runwayName, initialAltitude, squawk
}) => ({
    destination: destination || 'destination',
    route: sidName ? `via the ${sidName} departure` : 'as filed',
    runway: runwayName ? `runway ${runwayName}` : '',
    climb: initialAltitude ? `initial climb ${initialAltitude}` : '',
    squawk: squawk !== undefined && squawk !== null && squawk !== '' ? `squawk ${formatSquawk(squawk)}` : ''
});

/**
 * A believable destination for a departure that was not given one, in the direction its SID leaves the airspace
 *
 * @function pickDepartureDestination
 * @param index {AirportIndex}
 * @param origin {object} `{ icao, latitude, longitude }`
 * @param exitBearingDegrees {number|null} true bearing from the airport to the exit fix, null when unknown
 * @param random {function}
 * @return {string} ICAO code, empty when the index cannot help
 */
export const pickDepartureDestination = (index, origin, exitBearingDegrees, random = Math.random) => {
    if (!index || !index.isLoaded || !origin) {
        return '';
    }

    const options = { excludeIcao: [origin.icao], minimumRunwayMeters: 2200, limit: 12 };
    let candidates = Number.isFinite(exitBearingDegrees) ?
        index.findInDirection(origin.latitude, origin.longitude, exitBearingDegrees, options) : [];

    if (candidates.length === 0) {
        candidates = index.findNear(origin.latitude, origin.longitude, {
            minimumRunwayMeters: 2200,
            maximumDistanceNm: 1200,
            excludeIcao: [origin.icao],
            limit: 40
        }).filter((airport) => airport.distanceNm > 100);
    }

    if (candidates.length === 0) {
        return '';
    }

    return candidates[Math.floor(random() * candidates.length)].icao;
};
