'use strict';
/**
 * Convert raw OurAirports runway rows into the openScope `runways` structure.
 *
 * Rules (documented in README):
 *  - closed runways, helipads and non-numeric identifiers (H1, N, S ...) are skipped;
 *  - normal airports: hard surface only and length >= 800 m;
 *  - "relaxed" airports (UK/IE with scheduled service, e.g. Orkney/Hebrides island strips):
 *    any non-water surface and length >= 400 m, hard surfaces preferred;
 *  - names are zero padded ("9" -> "09") with L/R/C preserved; the two ends must be reciprocal
 *    (differ by 18, L<->R swapped);
 *  - thresholds are the OurAirports runway-end coordinates moved along the runway by the
 *    displaced threshold (if any, capped at 35 % of the length);
 *  - if only one end has coordinates the other is derived from heading + length; if neither has
 *    usable coordinates the runway is centred on the airport reference point (flagged
 *    `approximate`); coordinates that contradict the runway name (> 25 degrees) are treated as
 *    unusable;
 *  - runways with duplicate names at the same airport are dropped (the longest wins);
 *  - at most `maxRunways` physical runways are kept (longest first).
 */

const { bearingDeg, destinationPoint, distanceKm, normaliseDeg, angleDiffDeg, round } = require('./geo');

const FT_PER_M = 3.280839895;
const HARD = /^(ASP|CON|PEM|BIT|TAR|PAV|PER)/i;
const WATER = /(WAT|SEA|ICE|SNOW)/i;

const UNKNOWN_SURFACE = /^(|UNK|UNKNOWN|U|X)$/i;

/**
 * @param {string} surface
 * @param {boolean} [assumeUnknownHard]  treat blank/unknown surface codes as paved (used for
 *                                       scheduled large/medium airports with long runways, where
 *                                       missing surface data is a data-entry gap, not a grass strip)
 */
function isHardSurface(surface, assumeUnknownHard = false) {
    const text = String(surface || '').trim();

    if (assumeUnknownHard && UNKNOWN_SURFACE.test(text)) {
        return true;
    }

    const first = text.split(/[\s\-\/,]+/)[0];

    return HARD.test(first);
}

/** "9L" -> {num: 9, suffix: 'L'}; returns null for H1/N/S/etc. A trailing "T" (true-north designator) is dropped. */
function parseRunwayEnd(ident) {
    const m = /^(\d{1,2})([LRC]?)T?$/.exec(String(ident || '').trim().toUpperCase());

    if (!m) {
        return null;
    }

    const num = parseInt(m[1], 10);

    if (num < 1 || num > 36) {
        return null;
    }

    return { num, suffix: m[2] };
}

function formatRunwayEnd({ num, suffix }) {
    return `${String(num).padStart(2, '0')}${suffix}`;
}

function reciprocalSuffix(s) {
    if (s === 'L') {
        return 'R';
    }

    if (s === 'R') {
        return 'L';
    }

    return s;
}

function areReciprocal(a, b) {
    const diff = Math.abs(a.num - b.num);

    return diff === 18 && b.suffix === reciprocalSuffix(a.suffix);
}

function resolveGeometry(cand, arp, declinationDeg) {
    const { row, le, lengthM } = cand;
    const lengthNm = lengthM / 1852;
    const arpElev = arp.elevationFt || 0;
    const expectedMag = le.num * 10;
    const near = (p) => p && distanceKm(p[0], p[1], arp.lat, arp.lon) < 15;
    let leEnd = row.le.lat !== null && row.le.lon !== null ? [row.le.lat, row.le.lon] : null;
    let heEnd = row.he.lat !== null && row.he.lon !== null ? [row.he.lat, row.he.lon] : null;
    let fromCoordinates = false;

    if (leEnd && !near(leEnd)) {
        leEnd = null;
    }

    if (heEnd && !near(heEnd)) {
        heEnd = null;
    }

    const stated = row.le.headingTrue !== null
        ? row.le.headingTrue
        : (row.he.headingTrue !== null ? normaliseDeg(row.he.headingTrue + 180) : null);

    if (leEnd && heEnd) {
        const measuredM = distanceKm(leEnd[0], leEnd[1], heEnd[0], heEnd[1]) * 1000;

        if (measuredM >= 200 && Math.abs(measuredM - lengthM) / lengthM <= 0.35) {
            fromCoordinates = true;
        } else if (measuredM >= 200) {
            // coordinates good for bearing/centre, stated length wins
            const brg = bearingDeg(leEnd[0], leEnd[1], heEnd[0], heEnd[1]);
            const mid = [(leEnd[0] + heEnd[0]) / 2, (leEnd[1] + heEnd[1]) / 2];

            leEnd = destinationPoint(mid[0], mid[1], normaliseDeg(brg + 180), lengthNm / 2);
            heEnd = destinationPoint(mid[0], mid[1], brg, lengthNm / 2);
            fromCoordinates = true;
        } else {
            leEnd = null;
            heEnd = null;
        }
    } else if (leEnd || heEnd) {
        const heading = stated !== null ? stated : normaliseDeg(expectedMag + declinationDeg);

        if (leEnd) {
            heEnd = destinationPoint(leEnd[0], leEnd[1], heading, lengthNm);
        } else {
            leEnd = destinationPoint(heEnd[0], heEnd[1], normaliseDeg(heading + 180), lengthNm);
        }

        fromCoordinates = true;
    }

    if (fromCoordinates) {
        const geometryMag = normaliseDeg(bearingDeg(leEnd[0], leEnd[1], heEnd[0], heEnd[1]) - declinationDeg);

        if (Math.abs(angleDiffDeg(geometryMag, expectedMag)) >= 25) {
            fromCoordinates = false; // contradicts the runway name: do not trust
        }
    }

    if (!fromCoordinates) {
        const heading = stated !== null && Math.abs(angleDiffDeg(normaliseDeg(stated - declinationDeg), expectedMag)) < 25
            ? stated
            : normaliseDeg(expectedMag + declinationDeg);

        leEnd = destinationPoint(arp.lat, arp.lon, normaliseDeg(heading + 180), lengthNm / 2);
        heEnd = destinationPoint(arp.lat, arp.lon, heading, lengthNm / 2);
    }

    const headingTrue = bearingDeg(leEnd[0], leEnd[1], heEnd[0], heEnd[1]);
    const maxDisplace = 0.35 * lengthNm;
    const dispLe = Math.min(maxDisplace, ((row.le.displacedFt || 0) / FT_PER_M) / 1852);
    const dispHe = Math.min(maxDisplace, ((row.he.displacedFt || 0) / FT_PER_M) / 1852);
    const leThr = dispLe > 0 ? destinationPoint(leEnd[0], leEnd[1], headingTrue, dispLe) : leEnd;
    const heThr = dispHe > 0 ? destinationPoint(heEnd[0], heEnd[1], normaliseDeg(headingTrue + 180), dispHe) : heEnd;

    return {
        measuredM: distanceKm(leEnd[0], leEnd[1], heEnd[0], heEnd[1]) * 1000,
        ends: [
            [round(leThr[0], 6), round(leThr[1], 6)],
            [round(heThr[0], 6), round(heThr[1], 6)]
        ],
        elevations: [
            Math.round(row.le.elevationFt !== null ? row.le.elevationFt : arpElev),
            Math.round(row.he.elevationFt !== null ? row.he.elevationFt : arpElev)
        ],
        headingTrue,
        fromCoordinates
    };
}

/**
 * @param {Array} rows            raw runway rows (see data.loadRunways) for ONE airport
 * @param {{lat: number, lon: number, elevationFt: number|null}} arp
 * @param {number} declinationDeg magnetic declination (east positive) used for approximate geometry
 * @param {{relaxed?: boolean, maxRunways?: number, minLengthM?: number}} options
 * @returns {{runways: Array, longestM: number, longestHardM: number, approximate: boolean}}
 */
function buildRunways(rows, arp, declinationDeg, options = {}) {
    const relaxed = Boolean(options.relaxed);
    const maxRunways = options.maxRunways || 6;
    const minLengthM = options.minLengthM || (relaxed ? 400 : 800);
    const assumeUnknownHard = Boolean(options.assumeUnknownHard);
    const candidates = [];

    for (const row of rows) {
        if (row.closed || !row.lengthFt) {
            continue;
        }

        const lengthM = row.lengthFt / FT_PER_M;
        const hard = isHardSurface(row.surface, assumeUnknownHard && lengthM >= 1200);

        if (lengthM < minLengthM) {
            continue;
        }

        if (!relaxed && !hard) {
            continue;
        }

        if (relaxed && WATER.test(row.surface || '')) {
            continue;
        }

        const le = parseRunwayEnd(row.le.ident);
        const he = parseRunwayEnd(row.he.ident);

        if (!le || !he || !areReciprocal(le, he)) {
            continue;
        }

        candidates.push({ row, le, he, lengthM, hard });
    }

    // hard runways first, then longest first
    candidates.sort((x, y) => (Number(y.hard) - Number(x.hard)) || (y.lengthM - x.lengthM));

    const out = [];
    const usedNames = new Set();
    let approximate = false;

    for (const cand of candidates) {
        if (out.length >= maxRunways) {
            break;
        }

        const nameLe = formatRunwayEnd(cand.le);
        const nameHe = formatRunwayEnd(cand.he);

        if (usedNames.has(nameLe) || usedNames.has(nameHe)) {
            continue;
        }

        const geometry = resolveGeometry(cand, arp, declinationDeg);

        if (!geometry.fromCoordinates) {
            approximate = true;
        }

        usedNames.add(nameLe);
        usedNames.add(nameHe);

        out.push({
            names: [nameLe, nameHe],
            ends: geometry.ends,
            elevations: geometry.elevations,
            // the longer of the stated length and the end-to-end distance actually drawn
            lengthM: Math.max(cand.lengthM, geometry.measuredM),
            widthFt: cand.row.widthFt,
            hard: cand.hard,
            lighted: cand.row.lighted,
            headingTrue: geometry.headingTrue,
            approximate: !geometry.fromCoordinates
        });
    }

    // resort the kept runways longest-first for deterministic "primary runway" logic
    out.sort((x, y) => (y.lengthM - x.lengthM) || x.names[0].localeCompare(y.names[0]));

    const longestM = out.reduce((m, r) => Math.max(m, r.lengthM), 0);
    const longestHardM = out.reduce((m, r) => (r.hard ? Math.max(m, r.lengthM) : m), 0);

    return { runways: out, longestM, longestHardM, approximate };
}

module.exports = {
    isHardSurface,
    parseRunwayEnd,
    formatRunwayEnd,
    areReciprocal,
    buildRunways
};
