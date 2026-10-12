/**
 * Small planar geometry helpers for the ground chart. All coordinates are `[x, y]` in kilometres relative to the airport
 * (x east, y north, in the same frame the radar uses).
 */

export const distanceBetween = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export const lerpPoint = (a, b, t) => [a[0] + ((b[0] - a[0]) * t), a[1] + ((b[1] - a[1]) * t)];

export const addScaled = (point, vector, factor) => [point[0] + (vector[0] * factor), point[1] + (vector[1] * factor)];

export const unitVector = (from, to) => {
    const length = distanceBetween(from, to);

    return length === 0 ? [0, 1] : [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
};

/**
 * Bearing of a vector in radians, 0 = north, clockwise
 *
 * @function bearingOf
 * @param from {array}
 * @param to {array}
 * @return {number}
 */
export const bearingOf = (from, to) => {
    const angle = Math.atan2(to[0] - from[0], to[1] - from[1]);

    return angle < 0 ? angle + (Math.PI * 2) : angle;
};

export const polylineLength = (points) => {
    let total = 0;

    for (let i = 1; i < points.length; i++) {
        total += distanceBetween(points[i - 1], points[i]);
    }

    return total;
};

/**
 * The point `distance` km along a polyline, with the bearing of the segment it is on
 *
 * @function pointAlongPolyline
 * @param points {array<array>}
 * @param distance {number}
 * @return {object} `{ point, bearing }`
 */
export const pointAlongPolyline = (points, distance) => {
    if (points.length === 1) {
        return { point: points[0], bearing: 0 };
    }

    let remaining = Math.max(0, distance);

    for (let i = 1; i < points.length; i++) {
        const segment = distanceBetween(points[i - 1], points[i]);

        if (remaining <= segment || i === points.length - 1) {
            const t = segment === 0 ? 1 : Math.min(1, remaining / segment);

            return { point: lerpPoint(points[i - 1], points[i], t), bearing: bearingOf(points[i - 1], points[i]) };
        }

        remaining -= segment;
    }

    return { point: points[points.length - 1], bearing: 0 };
};

/**
 * Closest point on segment `a`-`b` to `p`
 *
 * @function nearestOnSegment
 * @return {object} `{ point, t, distance }`
 */
export const nearestOnSegment = (p, a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSquared = (dx * dx) + (dy * dy);
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (((p[0] - a[0]) * dx) + ((p[1] - a[1]) * dy)) / lengthSquared));
    const point = [a[0] + (dx * t), a[1] + (dy * t)];

    return { point, t, distance: distanceBetween(p, point) };
};

export const boundsOf = (pointLists) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    pointLists.forEach((points) => points.forEach(([x, y]) => {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }));

    return minX === Infinity ? null : {
        minX, minY, maxX, maxY
    };
};

export const isPointInPolygon = (point, polygon) => {
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        const crosses = ((yi > point[1]) !== (yj > point[1])) && (point[0] < (((xj - xi) * (point[1] - yi)) / (yj - yi)) + xi);

        if (crosses) {
            inside = !inside;
        }
    }

    return inside;
};

export const polygonCentroid = (polygon) => {
    const count = polygon.length;

    return [
        polygon.reduce((sum, [x]) => sum + x, 0) / count,
        polygon.reduce((sum, [, y]) => sum + y, 0) / count
    ];
};

/**
 * Drop vertices closer than `minimumKm` to the previous kept one (always keeps the last)
 *
 * @function simplifyPolyline
 */
export const simplifyPolyline = (points, minimumKm = 0.002) => {
    if (points.length <= 2) {
        return points;
    }

    const kept = [points[0]];

    for (let i = 1; i < points.length - 1; i++) {
        if (distanceBetween(kept[kept.length - 1], points[i]) >= minimumKm) {
            kept.push(points[i]);
        }
    }

    kept.push(points[points.length - 1]);

    return kept;
};
