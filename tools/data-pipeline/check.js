#!/usr/bin/env node
'use strict';
/**
 * Structural validator for generated (and, report-only, hand-authored) assets.
 *
 *   node tools/data-pipeline/check.js [--report] [--strict-hand] [--no-git] [--require EGGP,EGPH,...]
 *
 * The repository's own `npm run validator` is broken (its published package is missing a module),
 * so this script re-implements the checks that matter for loading an airport in the client. It
 * mirrors what `AirportModel`, `RunwayCollection`, `NavigationLibrary`, `LegModel`, `Fms`,
 * `SpawnPatternModel` and `AirlineModel` demand at load time:
 *
 *  - every `assets/airports/*.json` marked `"_generated": true` is fully validated; hand-authored
 *    files are only parsed and summarised (their problems are reported as warnings unless
 *    `--strict-hand` is given);
 *  - every generated airline file is validated;
 *  - `airportLoadList.json` consistency (file per entry, entry per generated file, no duplicates);
 *  - `airportIndex.json` shape;
 *  - hand-authored assets under assets/ were not modified (uses `git status`, skipped by --no-git).
 *
 * Exit code 1 when any error was found.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseArgs } = require('./lib/args');
const repo = require('./lib/repo');
const geo = require('./lib/geo');
const { isTypeAllowed } = require('./lib/realism');
const { COMMAND_WORDS } = require('./lib/gates');
const { areReciprocal, parseRunwayEnd } = require('./lib/runways');

const REQUIRED_TOP_LEVEL = [
    'radio', 'icao', 'iata', 'magnetic_north', 'ctr_radius', 'ctr_ceiling', 'initial_alt', 'position', 'rangeRings',
    'has_terrain', 'wind', 'arrivalRunway', 'departureRunway', 'defaultMaps', 'airspace', 'fixes', 'runways', 'sids',
    'stars', 'spawnPatterns', 'maps'
];
const SPAWN_KEYS = ['origin', 'destination', 'category', 'route', 'altitude', 'speed', 'method', 'rate', 'airlines'];
const SPAWN_METHODS = new Set(['random', 'cyclic', 'surge', 'wave']);
const DEFAULT_REQUIRED = [
    'EGGP', 'EGPH', 'EGPF', 'EGBB', 'EGNT', 'EGGD', 'EGNX', 'EGSS', 'EGHI', 'EGAA', 'EGAC', 'EGPD', 'EGFF', 'EGPK', 'EGHH',
    'EGHQ', 'EGSH', 'EGNJ', 'EGNV', 'EGPE', 'EGPA', 'EGPB', 'EGMC', 'EGTE', 'EGPN', 'EICK'
];

class Report {
    constructor() {
        this.errors = [];
        this.warnings = [];
    }

    error(scope, message) {
        this.errors.push(`${scope}: ${message}`);
    }

    warn(scope, message) {
        this.warnings.push(`${scope}: ${message}`);
    }
}

function isCoordinate(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value);
    }

    return typeof value === 'string' && /^([NESW])(\d+(\.\d+)?)([d °](\d+(\.\d+)?))?([m '](\d+(\.\d+)?))?$/.test(value);
}

function parseCoordinate(value) {
    if (typeof value === 'number') {
        return value;
    }

    const m = /^([NESW])(\d+(\.\d+)?)([d °](\d+(\.\d+)?))?([m '](\d+(\.\d+)?))?$/.exec(value);

    if (!m) {
        return NaN;
    }

    let deg = parseFloat(m[2]) + (m[5] ? parseFloat(m[5]) / 60 : 0) + (m[8] ? parseFloat(m[8]) / 3600 : 0);

    if (/[SW]/.test(m[1])) {
        deg *= -1;
    }

    return deg;
}

function isLatLon(pair) {
    return Array.isArray(pair) && (pair.length === 2 || pair.length === 3) && isCoordinate(pair[0]) && isCoordinate(pair[1]) &&
        typeof pair[0] === typeof pair[1];
}

function parseElevationFt(value) {
    if (typeof value === 'number') {
        return value;
    }

    const m = /^(-?\d+(\.\d+)?)(ft|m)$/.exec(String(value));

    if (!m) {
        return NaN;
    }

    return m[3] === 'm' ? parseFloat(m[1]) * 3.280839895 : parseFloat(m[1]);
}

/** Replicates how the client strips a route element down to a fix name. */
function fixNameOf(element) {
    let name = Array.isArray(element) ? element[0] : element;

    if (typeof name !== 'string') {
        return null;
    }

    if (name.includes('#')) {
        return null; // heading instruction
    }

    name = name.replace('^', '').replace('@', '').replace('*', '');

    return name;
}

/**
 * Full validation of one airport file.
 * @returns {Object} stats for the summary (rate, counts...)
 */
function checkAirport(icaoLower, d, ctx, report, isGenerated) {
    const scope = icaoLower.toUpperCase();
    const err = (m) => (isGenerated ? report.error(scope, m) : report.warn(scope, m));
    const stats = { patterns: 0, rate: 0, fixes: 0, runways: 0, gates: 0, contractEntries: 0 };

    for (const key of REQUIRED_TOP_LEVEL) {
        if (!(key in d)) {
            err(`missing required key "${key}"`);
        }
    }

    if (!isGenerated) {
        return stats; // hand-authored files: keys only
    }

    if (d._generated !== true) {
        err('"_generated" must be true');
    }

    if (d.icao !== scope) {
        err(`icao "${d.icao}" does not match file name`);
    }

    if (typeof d.iata !== 'string' || !/^[A-Z]{0,3}$/.test(d.iata)) {
        err(`iata "${d.iata}" invalid`);
    }

    if (!isLatLon(d.position)) {
        err('position is not a valid coordinate pair');
        return stats;
    }

    const lat0 = parseCoordinate(d.position[0]);
    const lon0 = parseCoordinate(d.position[1]);
    const elevationFt = parseElevationFt(d.position[2]);

    if (!Number.isFinite(elevationFt)) {
        err(`position elevation "${d.position[2]}" invalid`);
    }

    if (typeof d.magnetic_north !== 'number' || Math.abs(d.magnetic_north) > 60) {
        err(`magnetic_north ${d.magnetic_north} out of range`);
    }

    const mn = d.magnetic_north;

    if (!(d.ctr_radius >= 30 && d.ctr_radius <= 120) || !(d.ctr_ceiling >= 3000) || !(d.initial_alt >= 1000 && d.initial_alt < d.ctr_ceiling)) {
        err(`ctr_radius/ctr_ceiling/initial_alt suspicious (${d.ctr_radius}/${d.ctr_ceiling}/${d.initial_alt})`);
    }

    if (!d.rangeRings || !isLatLon(d.rangeRings.center) || typeof d.rangeRings.enabled !== 'boolean' || !(d.rangeRings.radius_nm > 0)) {
        err('rangeRings invalid');
    }

    if (!d.wind || typeof d.wind.angle !== 'number' || typeof d.wind.speed !== 'number') {
        err('wind invalid');
    }

    if (!d.radio || !d.radio.twr || !d.radio.app || !d.radio.dep) {
        err('radio needs twr/app/dep');
    }

    // ---------------------------------------------------------------- airspace
    const rel = (lat, lon) => geo.simRelative(lat0, lon0, mn, lat, lon);
    let airspaceRel = [];

    if (!Array.isArray(d.airspace) || d.airspace.length === 0) {
        err('airspace missing (required by SpawnPatternModel pre-spawn)');
    } else {
        for (const a of d.airspace) {
            if (!Array.isArray(a.poly) || a.poly.length < 3 || !a.poly.every(isLatLon)) {
                err('airspace poly invalid');
                continue;
            }

            const lowest = Math.min(0, elevationFt, ...(d.runways || []).flatMap((rw) => (rw.end || []).map((e) => parseElevationFt(e[2]))));

            if (!(a.ceiling >= 20) || !Number.isInteger(a.floor) || a.floor > 0 || a.floor * 100 > lowest || !a.airspace_class) {
                err('airspace floor/ceiling/class invalid (floor must be <= 0 and at or below the airport elevation)');
            }

            if (a.ceiling * 100 !== d.ctr_ceiling) {
                err(`airspace ceiling FL${a.ceiling} != ctr_ceiling ${d.ctr_ceiling}`);
            }

            airspaceRel = a.poly.map((p) => rel(parseCoordinate(p[0]), parseCoordinate(p[1])));

            if (!geo.pointInPolygon([0, 0], airspaceRel)) {
                err('airport reference point is not inside the airspace polygon');
            }
        }
    }

    // ---------------------------------------------------------------- fixes
    const fixes = d.fixes || {};
    const fixNames = Object.keys(fixes);
    const runwayNames = new Set();

    stats.fixes = fixNames.length;

    if (new Set(fixNames.map((n) => n.toUpperCase())).size !== fixNames.length) {
        err('duplicate fix names (case-insensitive)');
    }

    for (const name of fixNames) {
        const value = fixes[name];

        if (!/^_?[A-Z0-9]{1,24}$/.test(name)) {
            err(`fix name "${name}" malformed`);
        }

        if (!name.startsWith('_') && !/^[A-Z]{2,5}$|^[A-Z]{4}$/.test(name)) {
            err(`visible fix name "${name}" should be 2-5 letters`);
        }

        if (!name.startsWith('_') && COMMAND_WORDS.has(name)) {
            err(`fix name "${name}" collides with an aircraft command word`);
        }

        if (!Array.isArray(value) || !isLatLon(value.slice(0, 2)) || (value.length === 3 && typeof value[2] !== 'string') || value.length > 3) {
            err(`fix ${name} has an invalid definition ${JSON.stringify(value)}`);
        } else if (Math.abs(parseCoordinate(value[1]) - lon0) > 4 || Math.abs(parseCoordinate(value[0])) > 85) {
            // the client's relative-position maths breaks across the antimeridian / near the poles
            err(`fix ${name} is too far in longitude from the airport (antimeridian?) or too close to a pole`);
        }
    }

    if (!(d.icao in fixes)) {
        err('no fix named after the airport ICAO (arrival routes end at it)');
    }

    for (const name of fixNames) {
        if (!name.startsWith('_') && name !== d.icao && ctx.allIcaos.has(name)) {
            err(`fix name "${name}" collides with an airport ICAO code`);
        }
    }

    // ---------------------------------------------------------------- runways
    let longestThresholdKm = 0;

    if (!Array.isArray(d.runways) || d.runways.length === 0) {
        err('no runways');
    } else {
        stats.runways = d.runways.length;

        for (const rw of d.runways) {
            if (!Array.isArray(rw.name) || rw.name.length !== 2 || !Array.isArray(rw.end) || rw.end.length !== 2 || !Array.isArray(rw.ils) || rw.ils.length !== 2) {
                err(`runway ${JSON.stringify(rw.name)} malformed`);
                continue;
            }

            const a = parseRunwayEnd(rw.name[0]);
            const b = parseRunwayEnd(rw.name[1]);

            if (!a || !b || !/^\d\d[LRC]?$/.test(rw.name[0]) || !/^\d\d[LRC]?$/.test(rw.name[1]) || !areReciprocal(a, b)) {
                err(`runway names ${rw.name.join('/')} are not reciprocal / malformed`);
            }

            for (const name of rw.name) {
                if (runwayNames.has(name)) {
                    err(`duplicate runway name ${name}`);
                }

                runwayNames.add(name);

                if (name in fixes) {
                    err(`runway name ${name} collides with a fix name`);
                }
            }

            if (!rw.end.every((e) => isLatLon(e) && e.length === 3 && Number.isFinite(parseElevationFt(e[2])))) {
                err(`runway ${rw.name.join('/')} end coordinates invalid`);
                continue;
            }

            const [e0, e1] = rw.end;
            const lengthKm = geo.distanceKm(parseCoordinate(e0[0]), parseCoordinate(e0[1]), parseCoordinate(e1[0]), parseCoordinate(e1[1]));

            longestThresholdKm = Math.max(longestThresholdKm, lengthKm);

            if (lengthKm < 0.25 || lengthKm > 6.5) {
                err(`runway ${rw.name.join('/')} length ${(lengthKm * 1000).toFixed(0)} m not sane`);
            }

            if (geo.distanceKm(lat0, lon0, parseCoordinate(e0[0]), parseCoordinate(e0[1])) > 15) {
                err(`runway ${rw.name.join('/')} is more than 15 km from the airport position`);
            }

            const bearing = geo.bearingDeg(parseCoordinate(e0[0]), parseCoordinate(e0[1]), parseCoordinate(e1[0]), parseCoordinate(e1[1]));
            const magnetic = geo.normaliseDeg(bearing - mn);

            if (Math.abs(geo.angleDiffDeg(magnetic, a ? a.num * 10 : 0)) > 25) {
                err(`runway ${rw.name[0]} geometry heading ${magnetic.toFixed(0)} (magnetic) disagrees with its name`);
            }

            if (rw.ils.some((v) => typeof v !== 'boolean')) {
                err(`runway ${rw.name.join('/')} ils flags must be booleans`);
            }
        }

        for (const key of ['arrivalRunway', 'departureRunway']) {
            if (!runwayNames.has(d[key])) {
                err(`${key} "${d[key]}" is not a runway of this airport`);
            }
        }
    }

    const longestRunwayM = d.info && Number.isFinite(d.info.longestRunwayM) ? d.info.longestRunwayM : longestThresholdKm * 1000;

    if (d.info && Number.isFinite(d.info.longestRunwayM) && d.info.longestRunwayM < longestThresholdKm * 1000 - 5) {
        err('info.longestRunwayM is shorter than the threshold-to-threshold distance');
    }

    // ---------------------------------------------------------------- maps
    if (!Array.isArray(d.maps) || d.maps.length === 0) {
        err('maps must be a non-empty array');
    } else {
        const mapNames = new Set();

        for (const map of d.maps) {
            mapNames.add(map.name);

            if (typeof map.name !== 'string' || !Array.isArray(map.lines) || map.lines.length === 0) {
                err('a map needs a name and non-empty lines');
                continue;
            }

            if (!map.lines.every((l) => Array.isArray(l) && l.length === 4 && l.every((v) => isCoordinate(v)))) {
                err(`map "${map.name}" has a malformed line`);
            }
        }

        if (!Array.isArray(d.defaultMaps) || d.defaultMaps.length === 0 || !d.defaultMaps.every((n) => mapNames.has(n))) {
            err('defaultMaps must be non-empty and name existing maps');
        }
    }

    // ---------------------------------------------------------------- procedures
    const sids = d.sids || {};
    const stars = d.stars || {};
    const fixReferenced = (name, where) => {
        if (name && !(name in fixes)) {
            err(`${where} references undefined fix "${name}"`);
        }
    };
    const procedureIds = new Set([...Object.keys(sids), ...Object.keys(stars)]);

    if (procedureIds.size !== Object.keys(sids).length + Object.keys(stars).length) {
        err('SID/STAR identifiers must be unique across both');
    }

    for (const [id, sid] of Object.entries(sids)) {
        if (sid.icao !== id || typeof sid.name !== 'string' || !sid.rwy || !sid.exitPoints || !Array.isArray(sid.body) || !Array.isArray(sid.draw) || sid.draw.length === 0) {
            err(`SID ${id} malformed`);
            continue;
        }

        if (id in fixes) {
            err(`SID ${id} has the same identifier as a fix`);
        }

        for (const key of Object.keys(sid.rwy)) {
            const rwyName = key.slice(4);

            if (key.slice(0, 4) !== d.icao || !runwayNames.has(rwyName)) {
                err(`SID ${id} rwy key "${key}" is not <ICAO><runway>`);
            }

            for (const el of sid.rwy[key]) {
                fixReferenced(fixNameOf(el), `SID ${id}/${key}`);
            }

            if (sid.rwy[key].length + Math.min(...Object.values(sid.exitPoints).map((e) => e.length)) < 2) {
                err(`SID ${id}/${key} yields fewer than two waypoints (Fms requires at least two)`);
            }
        }

        for (const rwyName of runwayNames) {
            if (!(`${d.icao}${rwyName}` in sid.rwy)) {
                err(`SID ${id} lacks an entry for runway ${rwyName}`);
            }
        }

        for (const [exit, route] of Object.entries(sid.exitPoints)) {
            if (!Array.isArray(route) || route.length === 0) {
                err(`SID ${id} exit ${exit} empty`);
            }

            route.forEach((el) => fixReferenced(fixNameOf(el), `SID ${id}/exit ${exit}`));
        }

        sid.body.forEach((el) => fixReferenced(fixNameOf(el), `SID ${id}/body`));
        sid.draw.forEach((line) => line.filter((el) => !String(el).startsWith('@')).forEach((el) => fixReferenced(fixNameOf(el), `SID ${id}/draw`)));
    }

    for (const [id, star] of Object.entries(stars)) {
        if (star.icao !== id || typeof star.name !== 'string' || !star.entryPoints || !star.rwy || !Array.isArray(star.body) ||
            !Array.isArray(star.draw) || star.draw.length === 0) {
            err(`STAR ${id} malformed`);
            continue;
        }

        if (id in fixes) {
            err(`STAR ${id} has the same identifier as a fix`);
        }

        for (const rwyName of runwayNames) {
            if (!(`${d.icao}${rwyName}` in star.rwy)) {
                err(`STAR ${id} lacks an exit for runway ${rwyName}`);
            }
        }

        for (const [key, legs] of Object.entries(star.rwy)) {
            if (key.slice(0, 4) !== d.icao || !runwayNames.has(key.slice(4))) {
                err(`STAR ${id} rwy key "${key}" is not <ICAO><runway>`);
            }

            legs.forEach((el) => {
                if (typeof el === 'string' && el.startsWith('#')) {
                    return;
                }

                fixReferenced(fixNameOf(el), `STAR ${id}/${key}`);
            });
        }

        star.body.forEach((el) => fixReferenced(fixNameOf(el), `STAR ${id}/body`));
        star.draw.forEach((line) => line.filter((el) => !String(el).startsWith('@')).forEach((el) => fixReferenced(fixNameOf(el), `STAR ${id}/draw`)));
        Object.entries(star.entryPoints).forEach(([entry, legs]) => {
            fixReferenced(entry, `STAR ${id}/entry`);
            legs.forEach((el) => fixReferenced(fixNameOf(el), `STAR ${id}/entry ${entry}`));
        });
    }

    stats.gates = Object.keys(sids).length;

    // ---------------------------------------------------------------- spawn patterns
    if (!Array.isArray(d.spawnPatterns) || d.spawnPatterns.length === 0) {
        err('no spawn patterns');
        return stats;
    }

    const longestForRealism = longestRunwayM;
    let arrivals = 0;
    let departures = 0;

    d.spawnPatterns.forEach((p, i) => {
        const where = `spawnPattern[${i}]`;

        for (const key of SPAWN_KEYS) {
            if (!(key in p)) {
                err(`${where} missing key "${key}"`);
            }
        }

        const unknown = Object.keys(p).filter((k) => !SPAWN_KEYS.includes(k) && !['commands', 'offset', 'period', 'variation', 'entrail'].includes(k));

        if (unknown.length) {
            err(`${where} has unsupported keys ${unknown.join(',')}`);
        }

        if (!['arrival', 'departure', 'overflight'].includes(p.category)) {
            err(`${where} bad category "${p.category}"`);
        }

        if (!SPAWN_METHODS.has(p.method)) {
            err(`${where} bad method "${p.method}"`);
        }

        if (typeof p.rate !== 'number' || !(p.rate > 0) || p.rate > 45) {
            err(`${where} rate ${p.rate} invalid`);
        }

        stats.rate += p.rate || 0;
        stats.patterns += 1;

        if (typeof p.origin !== 'string' || typeof p.destination !== 'string') {
            err(`${where} origin/destination must be strings`);
        }

        if (p.category === 'arrival') {
            arrivals += 1;

            if (p.destination !== d.icao) {
                err(`${where} arrival destination must be ${d.icao}`);
            }

            if (p.origin && !/^[A-Z]{4}$/.test(p.origin)) {
                err(`${where} origin "${p.origin}" is not an ICAO code`);
            }

            if (!Array.isArray(p.altitude) || p.altitude.length !== 2 || p.altitude.some((v) => typeof v !== 'number') || p.altitude[0] > p.altitude[1]) {
                err(`${where} arrival altitude must be [min, max] numbers`);
            } else if (p.altitude[0] < elevationFt + 2500) {
                err(`${where} arrival altitude ${p.altitude[0]} too close to the ground`);
            }

            if (typeof p.speed !== 'number' || p.speed < 150 || p.speed > 320) {
                err(`${where} arrival speed ${p.speed} invalid`);
            }

            // route: ENTRY.STAR.<ICAO><runway>; the entry is a defined fix outside the airspace and the STAR's next fix is inside it
            const parts = String(p.route).split('.');

            if (parts.length !== 3 || String(p.route).includes('..')) {
                err(`${where} arrival route "${p.route}" must be ENTRY.STAR.<ICAO><runway>`);
            } else {
                const star = stars[parts[1]];

                if (!star) {
                    err(`${where} unknown STAR "${parts[1]}"`);
                } else {
                    if (!(parts[0] in star.entryPoints)) {
                        err(`${where} entry "${parts[0]}" not in STAR ${parts[1]} entryPoints`);
                    }

                    if (!(parts[2] in star.rwy)) {
                        err(`${where} exit "${parts[2]}" not in STAR ${parts[1]} rwy keys`);
                    }

                    if (parts[2] !== `${d.icao}${d.arrivalRunway}`) {
                        err(`${where} arrival exit should use the default arrival runway`);
                    }

                    fixReferenced(parts[0], `${where} route`);

                    const first = fixes[parts[0]];

                    if (first) {
                        const [x, y] = rel(parseCoordinate(first[0]), parseCoordinate(first[1]));

                        if (airspaceRel.length && geo.pointInPolygon([x, y], airspaceRel)) {
                            err(`${where} spawns inside the airspace (first fix ${parts[0]})`);
                        }
                    }

                    const secondName = fixNameOf(star.body[1]);
                    const second = fixes[secondName];

                    if (second && airspaceRel.length) {
                        const [x, y] = rel(parseCoordinate(second[0]), parseCoordinate(second[1]));

                        if (!geo.pointInPolygon([x, y], airspaceRel)) {
                            err(`${where} second fix ${secondName} is not inside the airspace`);
                        }
                    }
                }
            }
        } else if (p.category === 'departure') {
            departures += 1;

            if (p.origin !== d.icao) {
                err(`${where} departure origin must be ${d.icao}`);
            }

            if (p.destination && !/^[A-Z]{4}$/.test(p.destination)) {
                err(`${where} destination "${p.destination}" is not an ICAO code`);
            }

            const parts = String(p.route).split('.');

            if (parts.length !== 3 || String(p.route).includes('..')) {
                err(`${where} departure route "${p.route}" must be ENTRY.SID.EXIT`);
            } else {
                const sid = sids[parts[1]];

                if (!sid) {
                    err(`${where} unknown SID "${parts[1]}"`);
                } else {
                    if (!(parts[0] in sid.rwy)) {
                        err(`${where} entry "${parts[0]}" not in SID ${parts[1]} rwy keys`);
                    }

                    if (!(parts[2] in sid.exitPoints)) {
                        err(`${where} exit "${parts[2]}" not in SID ${parts[1]} exitPoints`);
                    }
                }

                if (parts[0] !== `${d.icao}${d.departureRunway}`) {
                    err(`${where} departure entry should use the default departure runway`);
                }
            }

            if (p.altitude !== '' && p.altitude !== null && typeof p.altitude !== 'number') {
                err(`${where} departure altitude must be "", null or a number`);
            }
        }

        if (!Array.isArray(p.airlines) || p.airlines.length === 0) {
            err(`${where} airlines must be a non-empty 2D array`);

            return;
        }

        for (const entry of p.airlines) {
            if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || typeof entry[1] !== 'number' || !(entry[1] > 0)) {
                err(`${where} bad airline entry ${JSON.stringify(entry)}`);
                continue;
            }

            const [id, fleet] = entry[0].split('/');

            if (!ctx.airlines.has(id)) {
                err(`${where} airline "${id}" has no assets/airlines/${id}.json`);
                continue;
            }

            if (fleet !== undefined) {
                const upper = fleet.toUpperCase();
                const type = ctx.aircraftTypes.get(upper);
                const airline = ctx.airlines.get(id);

                if (airline && !(airline.fleets && fleet in airline.fleets)) {
                    // relies on the client synthesising a single-type fleet for any ICAO type designator
                    if (type) {
                        stats.contractEntries += 1;
                        ctx.contractCombos.add(entry[0]);
                    } else {
                        err(`${where} fleet "${fleet}" of airline ${id} is neither a declared fleet nor an aircraft type`);
                    }
                }

                if (type && !isTypeAllowed(type, longestForRealism, elevationFt)) {
                    err(`${where} realism: ${upper} (takeoff ${type.takeoff} km) on a ${Math.round(longestForRealism)} m runway`);
                }
            }
        }
    });

    if (arrivals === 0 || departures === 0) {
        err('needs at least one arrival and one departure spawn pattern');
    }

    return stats;
}

function checkAirlines(report, ctx) {
    const seenCallsigns = new Map();
    let generated = 0;

    for (const id of repo.listAirlineIds()) {
        const file = path.join(repo.AIRLINES_DIR, `${id}.json`);
        let d;

        try {
            d = repo.readJson(file);
        } catch (error) {
            report.error(`airline ${id}`, `does not parse: ${error.message}`);
            continue;
        }

        const isGen = repo.isGeneratedFile(file);

        if (isGen) {
            generated += 1;
        }

        const err = (m) => (isGen ? report.error(`airline ${id}`, m) : report.warn(`airline ${id}`, m));

        if (typeof d.icao !== 'string' || d.icao.toLowerCase() !== id) {
            err(`icao "${d.icao}" does not match file name`);
        }

        if (!d.callsign || typeof d.callsign.name !== 'string' || !d.callsign.name) {
            err('callsign.name missing');
        }

        if (!d.fleets || !Array.isArray(d.fleets.default) || d.fleets.default.length === 0) {
            err('fleets.default missing or empty');
            continue;
        }

        if (isGen) {
            if (d._generated !== true) {
                err('"_generated" must be true');
            }

            if (!/^[A-Z][A-Za-z0-9 '\-]+$/.test(d.callsign.name)) {
                err(`callsign name "${d.callsign.name}" malformed`);
            }

            const formats = d.callsign.callsignFormats;

            if (!Array.isArray(formats) || formats.length === 0 || formats.some((f) => !/^[#@]{1,6}$/.test(f) || f[0] === '0')) {
                err(`callsignFormats ${JSON.stringify(formats)} invalid`);
            }

            const key = d.callsign.name.toLowerCase();

            if (seenCallsigns.has(key)) {
                report.warn(`airline ${id}`, `callsign "${d.callsign.name}" duplicates airline ${seenCallsigns.get(key)}`);
            } else {
                seenCallsigns.set(key, id);
            }

            for (const [fleetName, list] of Object.entries(d.fleets)) {
                if (!Array.isArray(list) || list.length === 0 || list.some((e) => !Array.isArray(e) || e.length !== 2 || !ctx.aircraftTypes.has(e[0]) || !(e[1] > 0))) {
                    err(`fleet "${fleetName}" malformed or references an unknown aircraft type`);
                }
            }
        } else {
            seenCallsigns.set(d.callsign && d.callsign.name ? d.callsign.name.toLowerCase() : id, id);
        }
    }

    return generated;
}

function checkLoadList(report, files) {
    let list;

    try {
        list = repo.readJson(repo.LOAD_LIST);
    } catch (error) {
        report.error('airportLoadList', `does not parse: ${error.message}`);

        return { entries: 0, generated: 0 };
    }

    const seen = new Set();
    let generated = 0;
    const schema = repo.readJson(repo.LOAD_LIST_SCHEMA);
    const allowed = new Set(Object.keys(schema.$defs.airport.properties));

    for (const e of list) {
        if (seen.has(e.icao)) {
            report.error('airportLoadList', `duplicate entry ${e.icao}`);
        }

        seen.add(e.icao);

        for (const key of Object.keys(e)) {
            if (!allowed.has(key)) {
                report.error('airportLoadList', `${e.icao}: property "${key}" is not in the schema`);
            }
        }

        if (!/^[a-z]{4}$/.test(e.icao) || !['beginner', 'easy', 'medium', 'hard'].includes(e.level) || typeof e.name !== 'string' || typeof e.premium !== 'boolean') {
            report.error('airportLoadList', `entry ${JSON.stringify(e)} malformed`);
        }

        if (!e.disabled && !files.has(e.icao)) {
            report.error('airportLoadList', `${e.icao} is listed but assets/airports/${e.icao}.json does not exist`);
        }

        if (e.generated === true) {
            generated += 1;

            if (!files.get(e.icao) || files.get(e.icao).generated !== true) {
                report.error('airportLoadList', `${e.icao} is marked generated but its file is not`);
            }
        }
    }

    for (const [icao, info] of files) {
        if (info.generated && !seen.has(icao)) {
            report.error('airportLoadList', `generated file ${icao}.json has no load list entry`);
        }
    }

    return { entries: list.length, generated };
}

function checkIndex(report, generatedIcaos) {
    if (!fs.existsSync(repo.AIRPORT_INDEX)) {
        report.warn('airportIndex', 'assets/airports/airportIndex.json not found (run build-airport-index.js)');

        return null;
    }

    const bytes = fs.statSync(repo.AIRPORT_INDEX).size;
    let d;

    try {
        d = repo.readJson(repo.AIRPORT_INDEX);
    } catch (error) {
        report.error('airportIndex', `does not parse: ${error.message}`);

        return null;
    }

    const fields = ['icao', 'iata', 'name', 'city', 'country', 'lat', 'lon', 'elev_ft', 'rwy_m', 'type'];

    if (JSON.stringify(d.fields) !== JSON.stringify(fields) || !Array.isArray(d.airports)) {
        report.error('airportIndex', 'unexpected "fields"/"airports" shape');

        return null;
    }

    const seen = new Set();

    for (const row of d.airports) {
        if (!Array.isArray(row) || row.length !== fields.length || !/^[A-Z]{4}$/.test(row[0]) || typeof row[5] !== 'number' || typeof row[6] !== 'number' ||
            Math.abs(row[5]) > 90 || Math.abs(row[6]) > 180) {
            report.error('airportIndex', `bad row ${JSON.stringify(row)}`);
            break;
        }

        if (seen.has(row[0])) {
            report.error('airportIndex', `duplicate ${row[0]}`);
        }

        seen.add(row[0]);
    }

    for (const icao of generatedIcaos) {
        if (!seen.has(icao.toUpperCase())) {
            report.error('airportIndex', `generated airport ${icao.toUpperCase()} is missing from the index`);
        }
    }

    if (bytes > 700 * 1024) {
        report.warn('airportIndex', `file is ${(bytes / 1024).toFixed(0)} KB (target < 600 KB)`);
    }

    return { entries: d.airports.length, bytes };
}

function checkNoHandEditedAssets(report) {
    let out;

    try {
        out = execFileSync('git', ['status', '--porcelain', '--', 'assets'], { cwd: repo.REPO_ROOT, encoding: 'utf8' });
    } catch (error) {
        report.warn('git', `could not run git status (${error.message.split('\n')[0]}); hand-authored asset check skipped`);

        return;
    }

    const allowedModified = new Set(['assets/airports/airportLoadList.json', 'assets/airports/airportLoadList.schema.json']);

    for (const line of out.split('\n').filter(Boolean)) {
        const status = line.slice(0, 2);
        const file = line.slice(3).replace(/^"|"$/g, '');

        if (status.trim() === '??') {
            continue; // new untracked file: allowed (generated files are validated elsewhere)
        }

        if (!allowedModified.has(file)) {
            report.error('git', `tracked asset modified or deleted: ${status.trim()} ${file}`);
        }
    }
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const report = new Report();
    const aircraftTypes = repo.loadAircraftTypes();
    const airlines = new Map();

    for (const [id, info] of repo.loadAirlines()) {
        airlines.set(id, info.data);
    }

    const handIcaosUpper = new Set();
    const files = new Map();
    const airportsDir = repo.AIRPORTS_DIR;
    const identList = fs.readdirSync(airportsDir).filter((f) => /^[a-z0-9]{4}\.json$/.test(f)).map((f) => f.slice(0, 4));

    for (const icao of identList) {
        files.set(icao, { generated: repo.isGeneratedFile(path.join(airportsDir, `${icao}.json`)) });
    }

    // every ICAO in OurAirports is not available here; approximate the "airport ICAO" collision check with the
    // index (if present) plus the repository's own airports
    const allIcaos = new Set(identList.map((i) => i.toUpperCase()));

    if (fs.existsSync(repo.AIRPORT_INDEX)) {
        try {
            repo.readJson(repo.AIRPORT_INDEX).airports.forEach((row) => allIcaos.add(row[0]));
        } catch (error) {
            // reported by checkIndex
        }
    }

    const ctx = { aircraftTypes, airlines, allIcaos, contractCombos: new Set() };
    const summary = { generated: 0, hand: 0, bytes: 0, rate: 0, patterns: 0, contractEntries: 0 };
    const samples = {};
    const stats = new Map();

    for (const icao of identList) {
        const file = path.join(airportsDir, `${icao}.json`);
        const info = files.get(icao);
        let d;

        try {
            d = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (error) {
            (info.generated || args['strict-hand'] ? report.error : report.warn).call(report, icao.toUpperCase(), `does not parse: ${error.message}`);
            continue;
        }

        if (info.generated) {
            summary.generated += 1;
            summary.bytes += fs.statSync(file).size;
        } else {
            summary.hand += 1;
        }

        const s = checkAirport(icao, d, ctx, report, info.generated || Boolean(args['strict-hand']));

        if (info.generated) {
            stats.set(icao, s);
            summary.rate += s.rate;
            summary.patterns += s.patterns;
            summary.contractEntries += s.contractEntries;
            samples[icao] = d;
        } else {
            handIcaosUpper.add(icao.toUpperCase());
        }
    }

    const generatedAirlines = checkAirlines(report, ctx);
    const loadList = checkLoadList(report, files);
    const index = checkIndex(report, Array.from(files.entries()).filter(([, v]) => v.generated).map(([k]) => k));

    const required = args.require ? String(args.require).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : DEFAULT_REQUIRED;

    for (const icao of required) {
        if (!files.has(icao.toLowerCase())) {
            report.error('required', `airport ${icao} does not exist (neither hand-authored nor generated)`);
        }
    }

    if (args.git !== false) {
        checkNoHandEditedAssets(report);
    }

    // ---------------------------------------------------------------- output
    for (const w of report.warnings.slice(0, 40)) {
        console.log(`WARN  ${w}`);
    }

    if (report.warnings.length > 40) {
        console.log(`WARN  ... and ${report.warnings.length - 40} more warnings`);
    }

    for (const e of report.errors.slice(0, 200)) {
        console.log(`ERROR ${e}`);
    }

    if (report.errors.length > 200) {
        console.log(`ERROR ... and ${report.errors.length - 200} more errors`);
    }

    console.log('');
    console.log(`generated airports : ${summary.generated}  (${(summary.bytes / 1048576).toFixed(2)} MB)`);
    console.log(`hand-authored      : ${summary.hand} (structure not enforced)`);
    console.log(`generated airlines : ${generatedAirlines} of ${airlines.size} airline files`);
    console.log(`load list          : ${loadList.entries} entries, ${loadList.generated} generated`);
    console.log(`airport index      : ${index ? `${index.entries} entries, ${(index.bytes / 1024).toFixed(0)} KB` : 'n/a'}`);
    console.log(`spawn patterns     : ${summary.patterns} in generated airports`);
    console.log(`fleet contract     : ${summary.contractEntries} airline/type entries (${ctx.contractCombos.size} distinct) reference a type that the airline file does not declare as a fleet;`);
    console.log('                     they rely on the client synthesising a single-type fleet for any ICAO type designator');
    console.log(`result             : ${report.errors.length} errors, ${report.warnings.length} warnings`);

    if (args.report) {
        printSamples(samples, ['EGGP', 'EGPH', 'EGBB']);
    }

    process.exit(report.errors.length ? 1 : 0);
}

function printSamples(samples, icaos) {
    for (const icao of icaos) {
        const d = samples[icao.toLowerCase()];

        if (!d) {
            continue;
        }

        const agg = new Map();
        const types = new Map();
        let total = 0;

        for (const p of d.spawnPatterns) {
            const sum = p.airlines.reduce((s, e) => s + e[1], 0);

            total += p.rate;

            for (const [key, w] of p.airlines) {
                const share = (p.rate * w) / sum;
                const [airline, type] = key.split('/');

                agg.set(airline, (agg.get(airline) || 0) + share);
                types.set(type, (types.get(type) || 0) + share);
            }
        }

        const top = (map, n) => Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ');
        const gates = Object.values(d.sids).map((s) => Object.keys(s.exitPoints)[0]);
        const destinations = d.spawnPatterns.filter((p) => p.category === 'arrival' && p.origin).slice(0, 8).map((p) => p.origin).join(' ');

        console.log('');
        console.log(`== ${d.icao} (${d.iata}) ${d.info && d.info.city ? d.info.city : ''}  total ${total.toFixed(1)}/h, ${d.spawnPatterns.length} patterns`);
        console.log(`   runways: ${d.runways.map((r) => `${r.name.join('/')} ils=${r.ils.map((v) => (v ? 'Y' : 'n')).join('')}`).join('; ')}  longest ${d.info && d.info.longestRunwayM} m`);
        console.log(`   gates: ${gates.join(' ')}  | radio: ${d.radio.twr} / ${d.radio.app} / ${d.radio.dep}  | variation ${d.magnetic_north} E`);
        console.log(`   airlines (acph): ${top(agg, 10)}`);
        console.log(`   types (acph): ${top(types, 12)}`);
        console.log(`   main origins: ${destinations}`);
    }
}

if (require.main === module) {
    main();
}

module.exports = { checkAirport };
