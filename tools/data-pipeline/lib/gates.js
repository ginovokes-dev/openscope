'use strict';
/**
 * Entry/exit "gate" placement.
 *
 * Gates are generated in SCOPE SPACE (magnetic bearing + distance from the airport reference
 * point, exactly how the client positions things) and sit outside the airspace polygon:
 *
 *  1. gate bearings are chosen by weighted peak picking of the bearings to the real other
 *     airports served (so e.g. Liverpool gets a south-east gate toward London and a south-west
 *     one toward the Irish Sea / Dublin);
 *  2. each gate is snapped to a REAL navaid (OurAirports VOR/NDB ident, real coordinates) when one
 *     lies in the right sector and distance window; otherwise it gets a unique synthetic
 *     pronounceable five-letter name at the ideal position;
 *  3. an "inner" fix is placed 12-20 NM from the airport on the line gate -> airport (real
 *     navaid within a small window if available, else synthetic).
 */

const {
    angleDiffDeg,
    normaliseDeg,
    simBearingDistance,
    simOffsetToLatLon
} = require('./geo');
const { navaidSpokenName, syntheticFixName } = require('./naming');

/** Fix names that must never be used (they are aircraft command words / aliases in the client). */
const COMMAND_WORDS = new Set([
    'A', 'ABORT', 'AIRAC', 'AIRPORT', 'ALTITUDE', 'AUTO', 'C', 'CAF', 'CANCELHOLD', 'CLEAR', 'CLIMB', 'CONTINUE', 'CR',
    'CROSS', 'CTO', 'CVS', 'D', 'DCT', 'DEL', 'DELETE', 'DESCEND', 'DIRECT', 'DVS', 'E', 'EXITHOLD', 'F', 'FH', 'FIX',
    'FPH', 'H', 'HEADING', 'HOLD', 'I', 'ILS', 'KILL', 'LAND', 'NOHOLD', 'PAUSE', 'PD', 'RATE', 'REROUTE', 'ROUTE', 'RR',
    'SA', 'SAA', 'SAH', 'SAS', 'SH', 'SI', 'SID', 'SLOW', 'SP', 'SPEED', 'SQ', 'SQUAWK', 'SR', 'STAR', 'T', 'TAKEOFF',
    'TAXI', 'TIMEWARP', 'TO', 'TRACK', 'TURN', 'TUTORIAL', 'TW', 'W', 'WAIT', 'X', 'XH'
]);

/**
 * Weighted peak picking on the compass.
 *
 * @param {Array<{bearing: number, weight: number}>} samples scope bearings with weights
 * @param {number} maxGates
 * @param {number} minSeparationDeg
 * @returns {number[]} gate bearings (degrees), strongest first
 */
function pickGateBearings(samples, maxGates, minSeparationDeg) {
    const bins = new Array(72).fill(0); // 5 degree bins

    for (const s of samples) {
        bins[Math.floor(normaliseDeg(s.bearing) / 5) % 72] += s.weight;
    }

    const total = bins.reduce((a, b) => a + b, 0);
    const picked = [];

    if (total <= 0) {
        return picked;
    }

    const remaining = samples.map((s) => ({ bearing: normaliseDeg(s.bearing), weight: s.weight }));
    let remainingWeight = total;

    while (picked.length < maxGates && remainingWeight > total * 0.02) {
        // smooth window sum for each 5 degree centre
        let bestScore = 0;
        let bestCentre = -1;

        for (let c = 0; c < 360; c += 5) {
            let score = 0;

            for (const s of remaining) {
                if (Math.abs(angleDiffDeg(s.bearing, c + 2.5)) <= 15) {
                    score += s.weight;
                }
            }

            if (score > bestScore) {
                bestScore = score;
                bestCentre = c + 2.5;
            }
        }

        if (bestCentre < 0) {
            break;
        }

        // weighted mean of samples inside +-15 degrees of the peak
        let sx = 0;
        let sy = 0;

        for (const s of remaining) {
            if (Math.abs(angleDiffDeg(s.bearing, bestCentre)) <= 15) {
                sx += s.weight * Math.sin((s.bearing * Math.PI) / 180);
                sy += s.weight * Math.cos((s.bearing * Math.PI) / 180);
            }
        }

        const centre = normaliseDeg((Math.atan2(sx, sy) * 180) / Math.PI);

        if (picked.some((p) => Math.abs(angleDiffDeg(p, centre)) < minSeparationDeg)) {
            // too close to an existing gate: drop the samples and carry on
            for (const s of remaining) {
                if (Math.abs(angleDiffDeg(s.bearing, bestCentre)) <= minSeparationDeg) {
                    remainingWeight -= s.weight;
                    s.weight = 0;
                }
            }

            continue;
        }

        picked.push(centre);

        for (const s of remaining) {
            if (Math.abs(angleDiffDeg(s.bearing, centre)) <= minSeparationDeg) {
                remainingWeight -= s.weight;
                s.weight = 0;
            }
        }
    }

    return picked;
}

/**
 * Ensure at least `minGates` gates exist and the compass is not left with a >150 degree hole
 * by adding gates in the middle of the largest gaps.
 */
function fillGateGaps(bearings, minGates, maxGates, fallbackStart) {
    const out = bearings.slice();

    if (out.length === 0) {
        for (let i = 0; i < Math.max(minGates, 4); i++) {
            out.push(normaliseDeg(fallbackStart + (i * 360) / Math.max(minGates, 4)));
        }

        return out;
    }

    const largestGap = () => {
        const sorted = out.slice().sort((a, b) => a - b);
        let best = { size: -1, mid: 0 };

        for (let i = 0; i < sorted.length; i++) {
            const a = sorted[i];
            const b = sorted[(i + 1) % sorted.length] + (i + 1 === sorted.length ? 360 : 0);
            const size = sorted.length === 1 ? 360 : b - a;

            if (size > best.size) {
                best = { size, mid: normaliseDeg(a + size / 2) };
            }
        }

        return best;
    };

    while (out.length < maxGates) {
        const gap = largestGap();

        if (out.length >= minGates && gap.size <= 150) {
            break;
        }

        out.push(gap.mid);
    }

    return out;
}

/**
 * @param {Object} params
 * @param {{lat: number, lon: number}} params.arp
 * @param {number} params.declination
 * @param {number} params.airspaceRadiusNm
 * @param {number} params.gateRadiusNm        ideal gate distance
 * @param {number} params.innerRadiusNm       ideal inner fix distance
 * @param {number[]} params.bearings          chosen gate bearings (scope degrees)
 * @param {Array} params.navaids              navaids near the airport
 * @param {Set<string>} params.taken          names already used (mutated)
 * @param {Set<string>} params.bannedNames    airport ICAOs etc.
 * @param {Object} params.rng
 * @returns {Array<Object>}
 */
function placeGates(params) {
    const { arp, declination, airspaceRadiusNm, gateRadiusNm, innerRadiusNm, navaids, taken, bannedNames, rng } = params;
    const bearings = params.bearings.slice().sort((a, b) => a - b);
    const gates = [];

    // pre-compute scope bearing/distance of nearby navaids
    const scoped = navaids.map((n) => {
        const [bearing, distNm] = simBearingDistance(arp.lat, arp.lon, declination, n.lat, n.lon);

        return Object.assign({ bearing, distNm }, n);
    });

    const nameOk = (name) => /^[A-Z]{2,5}$/.test(name) && !taken.has(name) && !bannedNames.has(name) && !COMMAND_WORDS.has(name);

    for (const ideal of bearings) {
        let best = null;
        let bestCost = Infinity;
        const minDist = airspaceRadiusNm + 4;
        const maxDist = airspaceRadiusNm + 38;

        for (const n of scoped) {
            if (n.distNm < minDist || n.distNm > maxDist || !nameOk(n.ident)) {
                continue;
            }

            const dAng = Math.abs(angleDiffDeg(n.bearing, ideal));

            if (dAng > 28) {
                continue;
            }

            // keep gates at least 22 degrees apart from those already placed
            if (gates.some((g) => Math.abs(angleDiffDeg(g.bearing, n.bearing)) < 22)) {
                continue;
            }

            const cost = dAng / 28 + (Math.abs(n.distNm - gateRadiusNm) / 25) * 0.6 +
                (n.ident.length === 2 ? 0.5 : 0) + (n.type.startsWith('NDB') ? 0.35 : 0);

            if (cost < bestCost || (cost === bestCost && best && n.ident < best.ident)) {
                best = n;
                bestCost = cost;
            }
        }

        let gate;

        if (best) {
            taken.add(best.ident);
            gate = {
                name: best.ident,
                spoken: navaidSpokenName(best.name),
                lat: best.lat,
                lon: best.lon,
                bearing: best.bearing,
                distNm: best.distNm,
                real: true
            };
        } else {
            const name = syntheticFixName(rng, (candidate) => taken.has(candidate) || bannedNames.has(candidate) || COMMAND_WORDS.has(candidate));
            const [lat, lon] = simOffsetToLatLon(arp.lat, arp.lon, declination, ideal, gateRadiusNm);

            taken.add(name);
            gate = { name, spoken: null, lat, lon, bearing: ideal, distNm: gateRadiusNm, real: false };
        }

        gates.push(gate);
    }

    // inner fixes, along the gate -> airport line
    for (const gate of gates) {
        let best = null;
        let bestCost = Infinity;

        for (const n of scoped) {
            if (!nameOk(n.ident) || n.ident === gate.name) {
                continue;
            }

            const dAng = Math.abs(angleDiffDeg(n.bearing, gate.bearing));
            const dDist = Math.abs(n.distNm - innerRadiusNm);

            if (dAng > 9 || dDist > 4 || n.distNm < airspaceRadiusNm * 0.25) {
                continue;
            }

            const cost = dAng / 9 + dDist / 4 + (n.ident.length === 2 ? 0.5 : 0);

            if (cost < bestCost) {
                best = n;
                bestCost = cost;
            }
        }

        if (best) {
            taken.add(best.ident);
            gate.inner = {
                name: best.ident,
                spoken: navaidSpokenName(best.name),
                lat: best.lat,
                lon: best.lon,
                real: true
            };
        } else {
            const name = syntheticFixName(rng, (candidate) => taken.has(candidate) || bannedNames.has(candidate) || COMMAND_WORDS.has(candidate));
            const [lat, lon] = simOffsetToLatLon(arp.lat, arp.lon, declination, gate.bearing, innerRadiusNm);

            taken.add(name);
            gate.inner = { name, spoken: null, lat, lon, real: false };
        }
    }

    return gates;
}

module.exports = { COMMAND_WORDS, pickGateBearings, fillGateGaps, placeGates };
