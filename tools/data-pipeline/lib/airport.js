'use strict';
/**
 * Builds one generated openScope airport file from OurAirports + OpenFlights data.
 *
 * The structure mirrors working hand-authored files (egnm.json, eick.json): real `runways`,
 * an `airspace` polygon, `fixes`, exit-gate SIDs (one per gate, every runway end listed, each with
 * a hidden climb-out fix so the route has >= 2 waypoints as the FMS requires), one STAR per gate
 * (gate -> inner fix -> per runway end: optional base fix, 13 DME and 8 DME fixes on the extended centreline,
 * then a heading to fly), STAR-based arrival spawn routes `GATE.STAR.ICAO<runway>` (the client swaps in the active runway), and small map layers
 * (coastline when a coastline file is given).
 */

const {
    bearingDeg,
    destinationPoint,
    angleDiffDeg,
    normaliseDeg,
    simOffsetToLatLon,
    round
} = require('./geo');
const { createRng } = require('./rng');
const { declination } = require('./magvar');
const { coastSegmentsNear } = require('./coast');
const { buildRunways } = require('./runways');
const { airportPlaceName, cleanCity, sidName } = require('./naming');
const { pickGateBearings, fillGateGaps, placeGates } = require('./gates');
const { GA_BY_COUNTRY, gaAirlines, collectCities, topAirlines, countryFallbackMix } = require('./traffic');

const CLASS_PARAMS = {
    hub: { radiusKm: 90, ceilingAdd: 12000, initialAdd: 5000, gateMarginNm: 14, innerNm: 20, maxGates: 8, gaShare: 0.04 },
    large: { radiusKm: 75, ceilingAdd: 11000, initialAdd: 5000, gateMarginNm: 12, innerNm: 17, maxGates: 7, gaShare: 0.07 },
    medium: { radiusKm: 60, ceilingAdd: 9000, initialAdd: 4000, gateMarginNm: 10, innerNm: 15, maxGates: 6, gaShare: 0.12 },
    small: { radiusKm: 45, ceilingAdd: 7000, initialAdd: 3000, gateMarginNm: 8, innerNm: 12, maxGates: 5, gaShare: 0.25 }
};

const KM_PER_NM = 1.852;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ceil1000 = (v) => Math.ceil(v / 1000) * 1000;

function classify(importance, osmType) {
    if (osmType === 'small_airport' && importance < 0.6) {
        return 'small';
    }

    if (importance >= 0.8) {
        return 'hub';
    }

    if (importance >= 0.6) {
        return 'large';
    }

    if (importance >= 0.4) {
        return 'medium';
    }

    return 'small';
}

function levelForRate(totalRate) {
    if (totalRate < 20) {
        return 'beginner';
    }

    if (totalRate < 40) {
        return 'easy';
    }

    if (totalRate <= 60) {
        return 'medium';
    }

    return 'hard';
}

/** Spatial index of navaids on a 1 degree grid. */
function indexNavaids(navaids) {
    const grid = new Map();

    for (const n of navaids) {
        const key = `${Math.floor(n.lat)}|${Math.floor(n.lon)}`;

        if (!grid.has(key)) {
            grid.set(key, []);
        }

        grid.get(key).push(n);
    }

    return grid;
}

function navaidsNear(grid, lat, lon, radiusDeg) {
    const out = [];
    const lonSpan = radiusDeg / Math.max(0.2, Math.cos((lat * Math.PI) / 180));

    for (let la = Math.floor(lat - radiusDeg); la <= Math.floor(lat + radiusDeg); la++) {
        for (let lo = Math.floor(lon - lonSpan); lo <= Math.floor(lon + lonSpan); lo++) {
            const cell = grid.get(`${la}|${lo}`);

            if (cell) {
                out.push(...cell);
            }
        }
    }

    return out;
}

function mhz(value) {
    return value.toFixed(3);
}

function pickFrequencies(rows) {
    if (!rows || rows.length === 0) {
        return null;
    }

    const find = (pred) => rows.find(pred);
    const atis = find((r) => r.type === 'ATIS');
    const twr = find((r) => r.type === 'TWR');
    const app = find((r) => r.type === 'APP' && /app|radar|approach/i.test(r.description || 'approach')) || find((r) => r.type === 'APP');
    const gnd = find((r) => r.type === 'GND');
    const dep = find((r) => r.type === 'DEP');
    const out = {};

    if (atis) {
        out.atis = mhz(atis.mhz);
    }

    if (twr) {
        out.twr = mhz(twr.mhz);
    }

    if (app) {
        out.app = mhz(app.mhz);
    }

    if (gnd) {
        out.gnd = mhz(gnd.mhz);
    }

    if (dep) {
        out.dep = mhz(dep.mhz);
    }

    return Object.keys(out).length ? out : null;
}

function inferIls(runways, rec) {
    const ils = runways.map(() => [false, false]);
    const eligible = [];

    runways.forEach((rw, i) => {
        const lit = rw.lighted || rec.type !== 'small_airport';

        if (rw.hard && rw.lengthM >= 1400 && rec.scheduled && lit) {
            eligible.push(i);
        }
    });

    if (eligible.length === 0) {
        return ils;
    }

    const chosen = rec.type === 'large_airport' ? eligible : [eligible[0]]; // runways are sorted longest first

    chosen.forEach((i) => {
        ils[i] = [true, true];
    });

    return ils;
}

/**
 * @param {Object} rec                OurAirports record
 * @param {Object} ctx
 * @param {boolean} relaxed           UK/IE scheduled airfield: relaxed runway rules
 * @returns {{file: Object, entry: Object, summary: Object}|{skip: string}}
 */
function buildAirport(rec, ctx, relaxed) {
    const rng = createRng(`airport:${rec.icao}`);
    const { decl, source: declSource } = declination(rec.lat, rec.lon);
    const arp = { lat: rec.lat, lon: rec.lon, elevationFt: rec.elevationFt };
    const rwResult = buildRunways(ctx.runwaysByIdent.get(rec.ident) || [], arp, decl, {
        relaxed,
        assumeUnknownHard: rec.type !== 'small_airport' && rec.scheduled
    });

    if (rwResult.runways.length === 0) {
        return { skip: 'no usable runway' };
    }

    const runways = rwResult.runways;
    const longestM = rwResult.longestM;
    const elevationFt = Math.round(rec.elevationFt !== null && rec.elevationFt !== undefined
        ? rec.elevationFt
        : runways[0].elevations[0]);

    // lowest point aircraft will occupy (some runway ends are below sea level while the reference point is not)
    const minElevationFt = Math.min(elevationFt, ...runways.map((rw) => Math.min(rw.elevations[0], rw.elevations[1])));

    // ---------------------------------------------------------------- traffic model
    const services = ctx.routeIndex.byAirport.get(rec.icao) || [];
    const cities = collectCities(rec, services, ctx, longestM);
    const routeCount = cities.length;
    const importance = clamp(Math.log(routeCount + 1) / Math.log(700), 0, 1);
    const klass = classify(importance, rec.type);
    const params = CLASS_PARAMS[klass];
    let scheduledDemand = cities.length > 0;
    let trafficSource = scheduledDemand ? 'routes' : 'country-mix';
    let totalRate;

    if (scheduledDemand) {
        totalRate = 5 + 35 * (importance ** 1.6);
    } else {
        totalRate = rec.type === 'large_airport' ? 12 : (rec.type === 'medium_airport' ? 9 : 6);
    }

    // ---------------------------------------------------------------- airspace / limits
    const radiusKm = params.radiusKm;
    const radiusNm = radiusKm / KM_PER_NM;
    const ceilingFt = ceil1000(elevationFt + params.ceilingAdd);
    const initialAlt = Math.min(ceil1000(elevationFt + params.initialAdd), ceilingFt - 2000);
    const arrivalHi = Math.max(ceilingFt - 1000, ceil1000(elevationFt + 4000));
    const arrivalLo = Math.max(arrivalHi - 3000, ceil1000(elevationFt + 3000));
    const airspacePoly = [];

    for (let b = 0; b < 360; b += 15) {
        const [la, lo] = simOffsetToLatLon(rec.lat, rec.lon, decl, b, radiusNm);

        airspacePoly.push([round(la, 4), round(lo, 4)]);
    }

    // ---------------------------------------------------------------- runway names, ILS, primary end
    const ils = inferIls(runways, rec);
    const endHeadingMag = (rw, end) => {
        const fwd = bearingDeg(rw.ends[0][0], rw.ends[0][1], rw.ends[1][0], rw.ends[1][1]);

        return normaliseDeg((end === 0 ? fwd : fwd + 180) - decl);
    };
    const prevailing = (Math.abs(rec.lat) >= 30 ? 250 : 80) + rng.int(-25, 25);
    const primary = runways[0];
    const primaryEnd = Math.abs(angleDiffDeg(endHeadingMag(primary, 0), prevailing)) <=
        Math.abs(angleDiffDeg(endHeadingMag(primary, 1), prevailing)) ? 0 : 1;
    const primaryName = primary.names[primaryEnd];
    const windAngle = normaliseDeg(Math.round((endHeadingMag(primary, primaryEnd) + rng.int(-25, 25)) / 10) * 10);
    const windSpeed = rng.int(5, 12);

    // ---------------------------------------------------------------- gates
    const taken = new Set([rec.icao]);
    const samples = cities.map((c) => ({ bearing: normaliseDeg(c.trueBearing - decl), weight: Math.sqrt(c.weight) }));
    const desiredGates = clamp(Math.round(3 + 5 * importance), 3, params.maxGates);
    const minSep = clamp(360 / (desiredGates * 1.8), 20, 45);
    let bearings = pickGateBearings(samples, desiredGates, minSep);

    bearings = fillGateGaps(bearings, 3, desiredGates, normaliseDeg(endHeadingMag(primary, primaryEnd) + 45));

    const gateRadiusNm = radiusNm + params.gateMarginNm;
    const gates = placeGates({
        arp,
        declination: decl,
        airspaceRadiusNm: radiusNm,
        gateRadiusNm,
        innerRadiusNm: params.innerNm,
        bearings,
        navaids: navaidsNear(ctx.navaidGrid, rec.lat, rec.lon, (radiusNm + 40) / 60),
        taken,
        bannedNames: ctx.allIcaos,
        rng
    });

    gates.forEach((g, idx) => {
        const version = rng.int(1, 3);
        const letter = rng.int(0, 5);
        const sid = sidName(g.name, g.spoken, version, letter);

        g.sid = sid.icao;
        g.sidSpoken = sid.name;
        g.index = idx;
    });

    const nearestGate = (scopeBearing) => {
        let best = gates[0];
        let bestDiff = 999;

        for (const g of gates) {
            const diff = Math.abs(angleDiffDeg(scopeBearing, g.bearing));

            if (diff < bestDiff) {
                bestDiff = diff;
                best = g;
            }
        }

        return best;
    };

    // ---------------------------------------------------------------- fixes
    const fixes = {};
    const fix = (name, lat, lon, spoken) => {
        fixes[name] = spoken ? [round(lat, 5), round(lon, 5), spoken] : [round(lat, 5), round(lon, 5)];
    };

    fix(rec.icao, rec.lat, rec.lon);

    for (const g of gates) {
        fix(g.name, g.lat, g.lon, g.spoken);
        fix(g.inner.name, g.inner.lat, g.inner.lon, g.inner.spoken);
    }

    // hidden climb-out fix beyond the far end of every runway: named after the runway whose
    // approach course it lies on (documented convention `_RWY<name><dd>DME`)
    const climbFix = {};
    const climbNm = primary.lengthM >= 1800 ? 4 : 3;

    runways.forEach((rw) => {
        [0, 1].forEach((end) => {
            const heading = normaliseDeg(endHeadingMag(rw, end) + decl); // true heading of this end's landing direction
            const [la, lo] = destinationPoint(rw.ends[end][0], rw.ends[end][1], normaliseDeg(heading + 180), climbNm);
            const name = `_RWY${rw.names[end]}${String(climbNm).padStart(2, '0')}DME`;

            fix(name, la, lo);
            climbFix[rw.names[1 - end]] = name; // departing from the opposite end flies over this point
        });
    });

    // ---------------------------------------------------------------- SIDs
    const sids = {};
    const runwayEndNames = [];

    runways.forEach((rw) => rw.names.forEach((n) => runwayEndNames.push(n)));

    const hundreds = (ft) => Math.round(ft / 100);
    const initialClimbRestriction = `A${hundreds(elevationFt + 1500)}+`;

    for (const g of gates) {
        const rwy = {};

        for (const name of runwayEndNames) {
            rwy[`${rec.icao}${name}`] = [[climbFix[name], initialClimbRestriction]];
        }

        sids[g.sid] = {
            icao: g.sid,
            name: g.sidSpoken,
            rwy,
            body: [],
            exitPoints: { [g.name]: [g.name] },
            draw: [[rec.icao, `${g.name}*`]]
        };
    }

    // ---------------------------------------------------------------- STARs
    // For every runway end two hidden fixes on the extended centreline (13 and 8 DME) and, when the gate is on the
    // far side of the airport, a base fix abeam on the gate's side so aircraft do not have to cross the field.
    const stars = {};
    const approachFixes = {};
    const arrivalDescent = [
        ['IF', 13, 4200, 210],
        ['FAF', 8, 2600, 180]
    ];

    runways.forEach((rw) => {
        [0, 1].forEach((end) => {
            const name = rw.names[end];
            const landingTrueHeading = normaliseDeg(endHeadingMag(rw, end) + decl);
            const outward = normaliseDeg(landingTrueHeading + 180);

            approachFixes[name] = {
                outwardMag: normaliseDeg(endHeadingMag(rw, end) + 180),
                headingMag: Math.round(endHeadingMag(rw, end)) % 360 || 360,
                legs: arrivalDescent.map(([label, dme, aglFt, speed]) => {
                    const [la, lo] = destinationPoint(rw.ends[end][0], rw.ends[end][1], outward, dme);
                    const fixName = `_RWY${name}${String(dme).padStart(2, '0')}DME`;

                    fix(fixName, la, lo);

                    return [fixName, `A${hundreds(elevationFt + aglFt)}-|S${speed}`, label];
                })
            };
        });
    });

    for (const g of gates) {
        const version = rng.int(1, 3);
        const letter = 6 + rng.int(0, 5); // G..L, never a letter used by the SIDs (A..F)
        const star = sidName(g.name, g.spoken, version, letter);
        const rwy = {};
        const draw = [[`${g.name}*`, g.inner.name]];

        for (const name of runwayEndNames) {
            const approach = approachFixes[name];
            const legs = [];
            const route = [g.inner.name];
            const side = angleDiffDeg(g.bearing, approach.outwardMag);

            if (Math.abs(side) > 75) {
                const sign = side >= 0 ? 1 : -1;
                const baseName = `_RWY${name}BASE${sign > 0 ? 'R' : 'L'}`;

                if (!fixes[baseName]) {
                    const [la, lo] = simOffsetToLatLon(rec.lat, rec.lon, decl, normaliseDeg(approach.outwardMag + (sign * 60)), 11);

                    fix(baseName, la, lo);
                }

                legs.push([baseName, `A${hundreds(elevationFt + 5200)}-|S230`]);
                route.push(baseName);
            }

            for (const [fixName, restriction] of approach.legs) {
                legs.push([fixName, restriction]);
                route.push(fixName);
            }

            legs.push(`#${String(approach.headingMag).padStart(3, '0')}`);
            rwy[`${rec.icao}${name}`] = legs;
            draw.push(route);
        }

        g.star = star.icao;
        g.starSpoken = star.name;
        stars[star.icao] = {
            icao: star.icao,
            name: star.name,
            entryPoints: { [g.name]: [] },
            body: [g.name, [g.inner.name, 'S250-']],
            rwy,
            draw
        };
    }

    // ---------------------------------------------------------------- spawn patterns
    const gaId = GA_BY_COUNTRY[rec.country] && ctx.airlineIds.has(GA_BY_COUNTRY[rec.country]) ? GA_BY_COUNTRY[rec.country] : null;
    const gaMix = gaId ? gaAirlines(gaId, klass, longestM, elevationFt, ctx.aircraftTypes, rec.icao) : [];
    let gaShare = gaMix.length ? params.gaShare : 0;
    const departureBase = (gate) => `${rec.icao}${primaryName}.${gate.sid}.${gate.name}`;
    const arrivalRoute = (gate) => `${gate.name}.${gate.star}.${rec.icao}${primaryName}`;
    const arrivalPatterns = [];
    const departurePatterns = [];

    if (scheduledDemand) {
        // named city patterns per direction: 3..10, so a busy airport ends up near 40 patterns in total
        // (named cities + one catch-all per gate for the long tail + 1-2 general aviation patterns)
        const maxCities = clamp(Math.round(2 + 8 * importance), 3, 10);
        const top = cities.slice(0, maxCities);
        const tail = cities.slice(maxCities);
        const tailByGate = new Map();

        const specs = [];

        for (const city of top) {
            const gate = nearestGate(normaliseDeg(city.trueBearing - decl));

            specs.push({ city: city.icao, gate, combos: [city.combos], weight: city.weight });
        }

        for (const city of tail) {
            const gate = nearestGate(normaliseDeg(city.trueBearing - decl));

            if (!tailByGate.has(gate.index)) {
                tailByGate.set(gate.index, { city: '', gate, combos: [], weight: 0 });
            }

            const entry = tailByGate.get(gate.index);

            entry.combos.push(city.combos);
            entry.weight += city.weight;
        }

        for (const entry of Array.from(tailByGate.values()).sort((a, b) => a.gate.index - b.gate.index)) {
            specs.push(entry);
        }

        const totalWeight = specs.reduce((s, x) => s + x.weight, 0);
        const dirRate = (totalRate * (1 - gaShare)) / 2;

        for (const spec of specs) {
            const airlines = topAirlines(spec.combos, 12);
            const rate = Math.max(0.05, round((dirRate * spec.weight) / totalWeight, 2));

            arrivalPatterns.push({
                origin: spec.city,
                destination: rec.icao,
                category: 'arrival',
                route: arrivalRoute(spec.gate),
                altitude: [arrivalLo, arrivalHi],
                speed: 250,
                method: 'random',
                rate,
                airlines
            });

            departurePatterns.push({
                origin: rec.icao,
                destination: spec.city,
                category: 'departure',
                route: departureBase(spec.gate),
                altitude: '',
                speed: '',
                method: 'random',
                rate,
                airlines
            });
        }
    } else {
        // no usable real routes: country-level domestic mix, spread over the gates
        const mixMap = countryFallbackMix(rec.country, ctx, ctx.routeIndex, longestM, elevationFt);
        const airlines = topAirlines([mixMap], 12);

        if (airlines.length > 0) {
            const dirRate = (totalRate * (1 - gaShare)) / 2;
            const perGate = Math.max(0.05, round(dirRate / gates.length, 2));

            for (const gate of gates) {
                arrivalPatterns.push({
                    origin: '',
                    destination: rec.icao,
                    category: 'arrival',
                    route: arrivalRoute(gate),
                    altitude: [arrivalLo, arrivalHi],
                    speed: 250,
                    method: 'random',
                    rate: perGate,
                    airlines
                });
                departurePatterns.push({
                    origin: rec.icao,
                    destination: '',
                    category: 'departure',
                    route: departureBase(gate),
                    altitude: '',
                    speed: '',
                    method: 'random',
                    rate: perGate,
                    airlines
                });
            }
        } else {
            scheduledDemand = false;
            trafficSource = 'ga-only';
            gaShare = gaMix.length ? 1 : 0;
        }
    }

    // general aviation / business traffic
    if (gaMix.length > 0) {
        const gaPatternCount = klass === 'small' ? 1 : 2;
        const order = gates
            .map((g) => [rng.next(), g.index])
            .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]))
            .map((pair) => pair[1]);
        const gaDirRate = Math.max(0.1, round((totalRate * gaShare) / 2 / gaPatternCount, 2));

        for (let i = 0; i < gaPatternCount; i++) {
            const gate = gates[order[i % order.length]];

            arrivalPatterns.push({
                origin: '',
                destination: rec.icao,
                category: 'arrival',
                route: arrivalRoute(gate),
                altitude: [arrivalLo, arrivalHi],
                speed: 250,
                method: 'random',
                rate: gaDirRate,
                airlines: gaMix
            });
            departurePatterns.push({
                origin: rec.icao,
                destination: '',
                category: 'departure',
                route: departureBase(gate),
                altitude: '',
                speed: '',
                method: 'random',
                rate: gaDirRate,
                airlines: gaMix
            });
        }
    }

    if (arrivalPatterns.length === 0 || departurePatterns.length === 0) {
        return { skip: 'no traffic could be generated (no airline files for this country / runway too short)' };
    }

    const spawnPatterns = [...departurePatterns, ...arrivalPatterns];
    const finalRate = round(spawnPatterns.reduce((s, p) => s + p.rate, 0), 1);

    // ---------------------------------------------------------------- maps
    const lines4 = (la1, lo1, la2, lo2) => [round(la1, 4), round(lo1, 4), round(la2, 4), round(lo2, 4)];
    const coastLines = ctx.coast ? coastSegmentsNear(ctx.coast, rec.lat, rec.lon, (radiusNm * 1.15)) : [];

    const centrelines = [];
    const drawEnds = [];

    runways.forEach((rw, i) => {
        [0, 1].forEach((end) => {
            if (ils[i][end]) {
                drawEnds.push([rw, end]);
            }
        });
    });

    if (drawEnds.length === 0) {
        drawEnds.push([primary, primaryEnd]);
    }

    for (const [rw, end] of drawEnds) {
        const heading = normaliseDeg(endHeadingMag(rw, end) + decl);
        const approach = normaliseDeg(heading + 180);
        const [tLat, tLon] = rw.ends[end];
        const far = destinationPoint(tLat, tLon, approach, 10);

        centrelines.push(lines4(tLat, tLon, far[0], far[1]));

        for (const d of [5, 10]) {
            const mid = destinationPoint(tLat, tLon, approach, d);
            const left = destinationPoint(mid[0], mid[1], normaliseDeg(approach - 90), 0.6);
            const right = destinationPoint(mid[0], mid[1], normaliseDeg(approach + 90), 0.6);

            centrelines.push(lines4(left[0], left[1], right[0], right[1]));
        }
    }

    // ---------------------------------------------------------------- assemble file
    const ofCity = rec.iata ? ctx.ofCities.get(rec.iata) : undefined;
    const place = airportPlaceName(rec.name, rec.city, ofCity);
    const dep = rec.country === 'GB' || rec.country === 'IE' ? 'Radar' : 'Departure';
    const info = {
        country: rec.country,
        city: cleanCity(rec.city) || cleanCity(ofCity),
        type: rec.type,
        longestRunwayM: Math.round(longestM)
    };
    const frequencies = pickFrequencies(ctx.frequenciesByIdent.get(rec.ident));

    if (frequencies) {
        info.frequencies = frequencies;
    }

    if (rwResult.approximate) {
        info.approximateRunways = true;
    }

    if (declSource !== 'wmm') {
        info.coarseMagneticVariation = true;
    }

    const file = {
        _generated: true,
        reference: `https://ourairports.com/airports/${rec.icao}/`,
        info,
        radio: { twr: `${place} Tower`, app: `${place} Approach`, dep: `${place} ${dep}` },
        icao: rec.icao,
        iata: rec.iata,
        magnetic_north: decl,
        ctr_radius: radiusKm,
        ctr_ceiling: ceilingFt,
        initial_alt: initialAlt,
        position: [round(rec.lat, 6), round(rec.lon, 6), `${elevationFt}ft`],
        rangeRings: { enabled: true, center: [round(rec.lat, 6), round(rec.lon, 6)], radius_nm: 5.0 },
        has_terrain: false,
        wind: { angle: windAngle, speed: windSpeed },
        arrivalRunway: primaryName,
        departureRunway: primaryName,
        defaultMaps: coastLines.length > 0 ? ['Base Map', 'Coastline', 'Extended Runway Centrelines'] : ['Base Map', 'Extended Runway Centrelines'],
        airspace: [{
            // aircraft below the floor count as outside the airspace: airports below sea level need a negative floor
            floor: minElevationFt < 0 ? Math.floor(minElevationFt / 100) - 1 : 0,
            ceiling: ceilingFt / 100,
            airspace_class: klass === 'small' ? 'D' : 'C',
            poly: airspacePoly
        }],
        fixes,
        runways: runways.map((rw, i) => ({
            name: rw.names,
            end: [
                [round(rw.ends[0][0], 5), round(rw.ends[0][1], 5), `${rw.elevations[0]}ft`],
                [round(rw.ends[1][0], 5), round(rw.ends[1][1], 5), `${rw.elevations[1]}ft`]
            ],
            ils: ils[i]
        })),
        sids,
        stars,
        spawnPatterns,
        maps: [
            // the runways themselves, so the base map is never empty
            { name: 'Base Map', lines: runways.map((rw) => lines4(rw.ends[0][0], rw.ends[0][1], rw.ends[1][0], rw.ends[1][1])) },
            ...(coastLines.length > 0 ? [{ name: 'Coastline', lines: coastLines }] : []),
            { name: 'Extended Runway Centrelines', lines: centrelines }
        ]
    };

    const entry = {
        icao: rec.icao.toLowerCase(),
        level: levelForRate(finalRate),
        name: rec.name,
        premium: false,
        iata: rec.iata,
        country: rec.country,
        generated: true
    };

    return {
        file,
        entry,
        summary: {
            icao: rec.icao,
            klass,
            routeCount,
            cities: cities.length,
            rate: finalRate,
            gates: gates.length,
            realGates: gates.filter((g) => g.real).length,
            longestM: Math.round(longestM),
            declSource,
            approximate: rwResult.approximate,
            trafficSource,
            patterns: spawnPatterns.length
        }
    };
}

module.exports = {
    CLASS_PARAMS,
    classify,
    levelForRate,
    indexNavaids,
    buildAirport
};
