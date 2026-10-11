/**
 * Decides whether an aircraft type is a believable visitor at an airport.
 *
 * The hand-authored traffic mixes in the airport files are already curated, but airline fleets
 * are broad: a generic "BAW" spawn pattern can draw an A380 or a 747 and drop it onto a 1,500 m
 * regional runway. This module is the single place that rejects those combinations.
 *
 * The rule has two parts:
 *   1. a (deliberately lenient) comparison of the type's published takeoff / landing distances with
 *      the longest runway at the airport. Operators routinely fly below maximum weight, so only 75%
 *      of the published figure is demanded.
 *   2. minimum runway lengths per wake class. The published distances are uneven across types, so a
 *      class floor keeps wide-bodies and the A380 away from airports that cannot really host them.
 *
 * Everything here is pure so it can be unit tested without the DOM or the sim.
 */

/**
 * Fraction of the published takeoff / landing distance that must fit the longest runway
 *
 * @property RUNWAY_DISTANCE_FACTOR
 * @type {number}
 * @final
 */
export const RUNWAY_DISTANCE_FACTOR = 0.75;

/**
 * Minimum runway length, in metres, for each wake class
 *
 * Super (A380) and four-engined heavies are only believable at big airports; twin-engine heavies
 * (A330/767/787/777) need a long but not intercontinental-hub runway.
 *
 * @property MINIMUM_RUNWAY_METERS_BY_CLASS
 * @type {object}
 * @final
 */
export const MINIMUM_RUNWAY_METERS_BY_CLASS = {
    SUPER: 3000,
    HEAVY_MULTI_ENGINE: 2800,
    HEAVY_TWIN: 2400
};

/**
 * Published distances are noisy for small types, so cap what a non-heavy type can demand
 *
 * @property MAXIMUM_REQUIREMENT_METERS_BY_CLASS
 * @type {object}
 * @final
 */
const MAXIMUM_REQUIREMENT_METERS_BY_CLASS = {
    S: 1200,
    'S+': 1500,
    M: 2000,
    L: 2300
};

/**
 * Lower bound so a type with missing performance data never reports a zero-length requirement
 *
 * @property MINIMUM_RUNWAY_METERS
 * @type {number}
 * @final
 */
const MINIMUM_RUNWAY_METERS = 250;

/**
 * Number of attempts made at drawing a suitable type from an airline's fleet before giving up
 *
 * @property MAXIMUM_FLEET_DRAWS
 * @type {number}
 * @final
 */
export const MAXIMUM_FLEET_DRAWS = 40;

/**
 * Runway length, in metres, an aircraft type needs before it is believable at an airport
 *
 * @function getRequiredRunwayLengthInMeters
 * @param typeDefinition {AircraftTypeDefinitionModel|object}
 * @return {number}
 */
export const getRequiredRunwayLengthInMeters = (typeDefinition) => {
    const takeoffKm = typeDefinition?.runway?.takeoff ?? 0;
    const landingKm = typeDefinition?.runway?.landing ?? 0;
    const weightClass = typeDefinition?.weightClass;
    let required = Math.max(takeoffKm, landingKm) * 1000 * RUNWAY_DISTANCE_FACTOR;

    if (MAXIMUM_REQUIREMENT_METERS_BY_CLASS[weightClass]) {
        required = Math.min(required, MAXIMUM_REQUIREMENT_METERS_BY_CLASS[weightClass]);
    }

    if (weightClass === 'J') {
        required = Math.max(required, MINIMUM_RUNWAY_METERS_BY_CLASS.SUPER);
    } else if (weightClass === 'H') {
        const engineCount = typeDefinition?.engines?.number ?? 2;
        const floor = engineCount > 2 ?
            MINIMUM_RUNWAY_METERS_BY_CLASS.HEAVY_MULTI_ENGINE :
            MINIMUM_RUNWAY_METERS_BY_CLASS.HEAVY_TWIN;

        required = Math.max(required, floor);
    }

    return Math.max(required, MINIMUM_RUNWAY_METERS);
};

/**
 * @function isAircraftTypeSuitableForRunwayLength
 * @param typeDefinition {AircraftTypeDefinitionModel|object}
 * @param longestRunwayInMeters {number}
 * @return {boolean}
 */
export const isAircraftTypeSuitableForRunwayLength = (typeDefinition, longestRunwayInMeters) => {
    if (!Number.isFinite(longestRunwayInMeters) || longestRunwayInMeters <= 0) {
        // no runway data, nothing to judge against
        return true;
    }

    return getRequiredRunwayLengthInMeters(typeDefinition) <= longestRunwayInMeters;
};

/**
 * Longest runway, in metres, of an airport
 *
 * @function getLongestRunwayInMeters
 * @param airportModel {AirportModel}
 * @return {number} `0` when unknown
 */
export const getLongestRunwayInMeters = (airportModel) => {
    const pairs = airportModel?.runways ?? [];
    let longestKm = 0;

    for (let i = 0; i < pairs.length; i++) {
        const runway = pairs[i][0];

        if (runway?.length > longestKm) {
            longestKm = runway.length;
        }
    }

    return longestKm * 1000;
};

/**
 * Pick the most believable type out of a list of candidates for this runway length
 *
 * Used as the last resort when random draws from an airline's fleet all fail the suitability test
 * (eg. a pattern asks for an operator that only flies widebodies).
 *
 * @function findLeastDemandingType
 * @param typeDefinitions {Array<AircraftTypeDefinitionModel>}
 * @return {AircraftTypeDefinitionModel|undefined}
 */
export const findLeastDemandingType = (typeDefinitions) => {
    let best;
    let bestRequired = Infinity;

    for (let i = 0; i < typeDefinitions.length; i++) {
        const required = getRequiredRunwayLengthInMeters(typeDefinitions[i]);

        if (required < bestRequired) {
            best = typeDefinitions[i];
            bestRequired = required;
        }
    }

    return best;
};
