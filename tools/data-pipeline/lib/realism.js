'use strict';
/**
 * Runway-length realism filter.
 *
 * The aircraft definitions in `assets/aircraft/*.json` carry `runway.takeoff` and
 * `runway.landing` in km (typical near-maximum-weight figures). Airlines operate sectors
 * well below MTOW, so a strict `takeoff <= runway` test would be unrealistically harsh for
 * narrowbodies and regional jets, yet we must keep the big types off short fields.
 *
 * required(type) = max(takeoff, min(landing, 1.3 * takeoff)) * derate(takeoff) * elevationFactor
 *
 *   derate: 0.85 for takeoff <= 2.0 km  (turboprops, regional jets, A318-A320 class:
 *                                       E170 needs ~1.45 km, ATR 72 ~1.2 km, E190 ~1.6 km)
 *           0.90 for 2.0 < takeoff <= 2.6 km (A321, B738, B752 class: B738 ~2.03 km)
 *           0.95 above (wide-bodies, 747/A380/777: stay strict)
 *   elevationFactor: +2.5 % per 1000 ft of airport elevation (density altitude).
 *
 * The `landing` figure is only used when it exceeds `takeoff` (some of the supplied
 * landing values are conservative), capped at 130 % of takeoff so a data outlier cannot
 * rule a type out completely.
 */

function derate(takeoffKm) {
    if (takeoffKm <= 2.0) {
        return 0.85;
    }

    if (takeoffKm <= 2.6) {
        return 0.90;
    }

    return 0.95;
}

/**
 * Minimum runway length (km) required for a type at a given airport elevation.
 *
 * @param {{takeoff: number, landing: number}} type
 * @param {number} elevationFt
 */
function requiredRunwayKm(type, elevationFt = 0) {
    const landing = Math.min(type.landing, type.takeoff * 1.3);
    const base = Math.max(type.takeoff, landing);
    const elevationFactor = 1 + 0.025 * Math.max(0, elevationFt) / 1000;

    return base * derate(type.takeoff) * elevationFactor;
}

/**
 * @param {{takeoff: number, landing: number}} type
 * @param {number} longestRunwayM
 * @param {number} elevationFt
 * @returns {boolean}
 */
function isTypeAllowed(type, longestRunwayM, elevationFt = 0) {
    return longestRunwayM / 1000 >= requiredRunwayKm(type, elevationFt);
}

module.exports = { requiredRunwayKm, isTypeAllowed };
