'use strict';
/**
 * Geometry helpers shared by the data-pipeline scripts.
 *
 * Two flavours of distance/position maths are provided:
 *
 *  - great-circle helpers (`distanceNm`, `bearingDeg`, `destinationPoint`) used for
 *    real-world quantities (route lengths, runway geometry, navaid search);
 *  - "scope space" helpers (`simRelative`, `simOffsetToLatLon`) which replicate exactly
 *    how the openScope client turns lat/lon into x/y kilometres relative to the airport
 *    (see `DynamicPositionModel.calculateRelativePosition`). Gates, inner fixes and the
 *    airspace polygon are generated in scope space so that they come out exactly where
 *    intended on the radar scope, and `check.js` verifies geometry in the same space.
 */

const EARTH_RADIUS_KM = 6371; // identical to client `math/circle.distanceToPoint`
const EARTH_RADIUS_NM = 3440; // client PHYSICS_CONSTANTS.EARTH_RADIUS_NM
const KM_PER_NM = 1.852;
const FT_PER_M = 3.280839895;

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

function normaliseDeg(d) {
    const r = d % 360;

    return r < 0 ? r + 360 : r;
}

/** Signed smallest difference a - b in degrees, in (-180, 180]. */
function angleDiffDeg(a, b) {
    let d = normaliseDeg(a - b);

    if (d > 180) {
        d -= 360;
    }

    return d;
}

/** Great-circle distance in km. */
function distanceKm(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

    return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceNm(lat1, lon1, lat2, lon2) {
    return distanceKm(lat1, lon1, lat2, lon2) / KM_PER_NM;
}

/** Initial true bearing (deg 0..360) from point 1 to point 2. */
function bearingDeg(lat1, lon1, lat2, lon2) {
    const p1 = toRad(lat1);
    const p2 = toRad(lat2);
    const dl = toRad(lon2 - lon1);
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);

    return normaliseDeg(toDeg(Math.atan2(y, x)));
}

/** Point reached from (lat, lon) travelling `distNm` on true bearing `brgDeg` (great circle). */
function destinationPoint(lat, lon, brgDeg, distNm) {
    const d = (distNm * KM_PER_NM) / EARTH_RADIUS_KM;
    const t = toRad(brgDeg);
    const p1 = toRad(lat);
    const l1 = toRad(lon);
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
    const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));

    return [toDeg(p2), ((toDeg(l2) + 540) % 360) - 180];
}

/**
 * Replicates the client's `DynamicPositionModel.calculateRelativePosition`.
 *
 * @param {number} refLat
 * @param {number} refLon
 * @param {number} magneticNorthDeg declination in degrees EAST
 * @param {number} lat
 * @param {number} lon
 * @returns {number[]} [x_km_east_mag, y_km_north_mag]
 */
function simRelative(refLat, refLon, magneticNorthDeg, lat, lon) {
    let x = distanceKm(refLat, refLon, refLat, lon);

    if (refLon > lon) {
        x *= -1;
    }

    let y = distanceKm(refLat, refLon, lat, refLon);

    if (refLat > lat) {
        y *= -1;
    }

    const t = Math.atan2(y, x) + toRad(magneticNorthDeg);
    const r = Math.sqrt(x * x + y * y);

    return [r * Math.cos(t), r * Math.sin(t)];
}

/**
 * Inverse of `simRelative` (planar approximation consistent with the client's maths).
 * Given a magnetic bearing/distance from the reference point, return lat/lon such that
 * `simRelative` of the result reproduces that bearing/distance on the scope.
 *
 * @param {number} refLat
 * @param {number} refLon
 * @param {number} magneticNorthDeg declination in degrees EAST
 * @param {number} magBearingDeg    bearing on the scope (magnetic), degrees clockwise from scope-up
 * @param {number} distNm
 * @returns {number[]} [lat, lon]
 */
function simOffsetToLatLon(refLat, refLon, magneticNorthDeg, magBearingDeg, distNm) {
    const trueBearing = toRad(magBearingDeg + magneticNorthDeg);
    const dKm = distNm * KM_PER_NM;
    const north = dKm * Math.cos(trueBearing);
    const east = dKm * Math.sin(trueBearing);
    const lat = refLat + toDeg(north / EARTH_RADIUS_KM);
    const lon = refLon + toDeg(east / (EARTH_RADIUS_KM * Math.cos(toRad(refLat))));

    return [lat, lon];
}

/** Bearing (magnetic scope bearing) and distance (nm) of a point as seen on the scope. */
function simBearingDistance(refLat, refLon, magneticNorthDeg, lat, lon) {
    const [x, y] = simRelative(refLat, refLon, magneticNorthDeg, lat, lon);

    return [normaliseDeg(toDeg(Math.atan2(x, y))), Math.sqrt(x * x + y * y) / KM_PER_NM];
}

function round(value, decimals) {
    const f = 10 ** decimals;

    return Math.round(value * f) / f;
}

/**
 * Point-in-polygon (ray casting) in a planar coordinate system.
 *
 * @param {number[]} pt [x, y]
 * @param {number[][]} poly [[x, y], ...]
 */
function pointInPolygon(pt, poly) {
    let inside = false;

    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0];
        const yi = poly[i][1];
        const xj = poly[j][0];
        const yj = poly[j][1];
        const intersect = ((yi > pt[1]) !== (yj > pt[1])) &&
            (pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi);

        if (intersect) {
            inside = !inside;
        }
    }

    return inside;
}

module.exports = {
    EARTH_RADIUS_KM,
    EARTH_RADIUS_NM,
    KM_PER_NM,
    FT_PER_M,
    toRad,
    toDeg,
    normaliseDeg,
    angleDiffDeg,
    distanceKm,
    distanceNm,
    bearingDeg,
    destinationPoint,
    simRelative,
    simOffsetToLatLon,
    simBearingDistance,
    pointInPolygon,
    round
};
