'use strict';
/**
 * Coastline backdrop for the radar.
 *
 * Reads a GeoJSON file of coastline/land polygons (the `map.geo.json` of the npm package
 * `@geo-maps/countries-coastline-1km`, derived from OpenStreetMap, ODbL) and cuts out the part around an airport as
 * a list of line segments in the format of the airport files' `maps`. The input is untrusted data: it is only parsed
 * as JSON and its numbers are validated, never executed.
 */

const fs = require('fs');
const { destinationPoint, round } = require('./geo');

const KM_PER_DEGREE_LAT = 111.19;

/** @returns {Array<Array<[number, number]>>} rings of [lon, lat] */
function extractLines(geometry) {
    const out = [];

    if (!geometry) {
        return out;
    }

    const add = (coordinates) => {
        if (Array.isArray(coordinates) && coordinates.length > 1) {
            out.push(coordinates);
        }
    };

    switch (geometry.type) {
        case 'Polygon':
            geometry.coordinates.forEach(add);
            break;
        case 'MultiPolygon':
            geometry.coordinates.forEach((polygon) => polygon.forEach(add));
            break;
        case 'LineString':
            add(geometry.coordinates);
            break;
        case 'MultiLineString':
            geometry.coordinates.forEach(add);
            break;
        default:
            break;
    }

    return out;
}

/**
 * @param {string} file path of the GeoJSON file
 * @returns {{lines: Array<{points: Array<[number, number]>, bbox: number[]}>}}
 */
function loadCoast(file) {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const features = Array.isArray(json.features) ? json.features : [{ geometry: json }];
    const lines = [];

    for (const feature of features) {
        for (const ring of extractLines(feature.geometry)) {
            const points = ring.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));

            if (points.length < 2) {
                continue;
            }

            let minLon = Infinity;
            let maxLon = -Infinity;
            let minLat = Infinity;
            let maxLat = -Infinity;

            for (const [lon, lat] of points) {
                minLon = Math.min(minLon, lon);
                maxLon = Math.max(maxLon, lon);
                minLat = Math.min(minLat, lat);
                maxLat = Math.max(maxLat, lat);
            }

            lines.push({ points, bbox: [minLon, minLat, maxLon, maxLat] });
        }
    }

    return { lines };
}

/** Distance of a point from a segment's perpendicular line, in the same (degree) units */
function perpendicularDistance(p, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);

    if (length === 0) {
        return Math.hypot(p[0] - a[0], p[1] - a[1]);
    }

    return Math.abs((dy * p[0]) - (dx * p[1]) + (b[0] * a[1]) - (b[1] * a[0])) / length;
}

/** Douglas-Peucker line simplification */
function simplify(points, tolerance) {
    if (points.length < 3) {
        return points;
    }

    let maxDistance = 0;
    let index = 0;

    for (let i = 1; i < points.length - 1; i++) {
        const distance = perpendicularDistance(points[i], points[0], points[points.length - 1]);

        if (distance > maxDistance) {
            maxDistance = distance;
            index = i;
        }
    }

    if (maxDistance <= tolerance) {
        return [points[0], points[points.length - 1]];
    }

    return simplify(points.slice(0, index + 1), tolerance).slice(0, -1).concat(simplify(points.slice(index), tolerance));
}

/**
 * Coastline segments within `radiusNm` of a point, as `[lat1, lon1, lat2, lon2]` (3 decimals, about 100 m)
 *
 * @param {{lines: Array}} coast result of `loadCoast`
 * @param {number} lat
 * @param {number} lon
 * @param {number} radiusNm
 * @param {{maximumSegments?: number}} options
 * @returns {Array<number[]>}
 */
function coastSegmentsNear(coast, lat, lon, radiusNm, { maximumSegments = 2500 } = {}) {
    const [northLat] = destinationPoint(lat, lon, 0, radiusNm);
    const dLat = Math.abs(northLat - lat);
    const dLon = dLat / Math.max(0.1, Math.cos((lat * Math.PI) / 180));
    const box = [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
    const radiusKm = radiusNm * 1.852;
    let tolerance = 0.002; // degrees, about 200 m
    let segments = [];

    for (let attempt = 0; attempt < 6; attempt++) {
        segments = [];

        for (const line of coast.lines) {
            const [minLon, minLat, maxLon, maxLat] = line.bbox;

            if (maxLon < box[0] || minLon > box[2] || maxLat < box[1] || minLat > box[3]) {
                continue;
            }

            // keep the runs of points inside the circle (plus one point either side so lines leave the edge)
            let run = [];
            const flush = () => {
                if (run.length > 1) {
                    const simplified = simplify(run, tolerance);

                    for (let i = 0; i < simplified.length - 1; i++) {
                        segments.push([
                            round(simplified[i][1], 3), round(simplified[i][0], 3),
                            round(simplified[i + 1][1], 3), round(simplified[i + 1][0], 3)
                        ]);
                    }
                }

                run = [];
            };

            for (let i = 0; i < line.points.length; i++) {
                const point = line.points[i];
                const dx = (point[0] - lon) * KM_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
                const dy = (point[1] - lat) * KM_PER_DEGREE_LAT;
                const inside = Math.hypot(dx, dy) <= radiusKm * 1.1;

                if (inside) {
                    if (run.length === 0 && i > 0) {
                        run.push(line.points[i - 1]);
                    }

                    run.push(point);
                } else if (run.length > 0) {
                    run.push(point);
                    flush();
                }
            }

            flush();
        }

        if (segments.length <= maximumSegments) {
            break;
        }

        tolerance *= 2;
    }

    return segments;
}

module.exports = { loadCoast, coastSegmentsNear, simplify };
