/**
 * Great-circle helpers for airport-to-airport questions (distance, bearing, fuel for a sector, diversions)
 *
 * All angles are degrees, distances nautical miles, coordinates decimal degrees (north / east positive).
 */

const EARTH_RADIUS_NM = 3440.065;
const toRadians = (degrees) => (degrees * Math.PI) / 180;
const toDegrees = (radians) => (radians * 180) / Math.PI;

/**
 * @function greatCircleDistanceNm
 * @return {number}
 */
export const greatCircleDistanceNm = (latitude1, longitude1, latitude2, longitude2) => {
    const φ1 = toRadians(latitude1);
    const φ2 = toRadians(latitude2);
    const Δφ = toRadians(latitude2 - latitude1);
    const Δλ = toRadians(longitude2 - longitude1);
    const a = (Math.sin(Δφ / 2) ** 2) + (Math.cos(φ1) * Math.cos(φ2) * (Math.sin(Δλ / 2) ** 2));

    return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(a)));
};

/**
 * Initial true bearing from point 1 to point 2, 0..360
 *
 * @function initialBearingDegrees
 * @return {number}
 */
export const initialBearingDegrees = (latitude1, longitude1, latitude2, longitude2) => {
    const φ1 = toRadians(latitude1);
    const φ2 = toRadians(latitude2);
    const Δλ = toRadians(longitude2 - longitude1);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = (Math.cos(φ1) * Math.sin(φ2)) - (Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ));

    return (toDegrees(Math.atan2(y, x)) + 360) % 360;
};

/**
 * Point reached by travelling `distanceNm` along `bearingDegrees` from the start
 *
 * @function destinationPoint
 * @return {object} `{ latitude, longitude }`
 */
export const destinationPoint = (latitude, longitude, bearingDegrees, distanceNm) => {
    const δ = distanceNm / EARTH_RADIUS_NM;
    const θ = toRadians(bearingDegrees);
    const φ1 = toRadians(latitude);
    const λ1 = toRadians(longitude);
    const φ2 = Math.asin((Math.sin(φ1) * Math.cos(δ)) + (Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - (Math.sin(φ1) * Math.sin(φ2)));

    return { latitude: toDegrees(φ2), longitude: ((toDegrees(λ2) + 540) % 360) - 180 };
};

/**
 * "north-west", "south" ... for a bearing
 *
 * @function compassPoint
 * @param bearingDegrees {number}
 * @return {string}
 */
export const compassPoint = (bearingDegrees) => {
    const points = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

    return points[Math.round((((bearingDegrees % 360) + 360) % 360) / 45) % 8];
};
