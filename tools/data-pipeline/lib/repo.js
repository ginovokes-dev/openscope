'use strict';
/**
 * Repository paths, safe writing of generated files and loading of the existing assets.
 *
 * SAFETY RULES enforced here:
 *  - A file is only ever (over)written / deleted when it already carries the marker
 *    `"_generated": true` as its first key, or when it does not exist yet.
 *  - Hand-authored files (which lack the marker) are never touched.
 */

const fs = require('fs');
const path = require('path');
const { serializeFile } = require('./format');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const ASSETS = path.join(REPO_ROOT, 'assets');
const AIRPORTS_DIR = path.join(ASSETS, 'airports');
const AIRLINES_DIR = path.join(ASSETS, 'airlines');
const AIRCRAFT_DIR = path.join(ASSETS, 'aircraft');
const LOAD_LIST = path.join(AIRPORTS_DIR, 'airportLoadList.json');
const LOAD_LIST_SCHEMA = path.join(AIRPORTS_DIR, 'airportLoadList.schema.json');
const AIRPORT_INDEX = path.join(AIRPORTS_DIR, 'airportIndex.json');

const GENERATED_MARKER = /^\s*\{\s*"_generated"\s*:\s*true\b/;

/** True when the file exists and carries the generated marker. */
function isGeneratedFile(file) {
    let fd;

    try {
        fd = fs.openSync(file, 'r');
        const buf = Buffer.alloc(256);
        const n = fs.readSync(fd, buf, 0, 256, 0);

        return GENERATED_MARKER.test(buf.toString('utf8', 0, n));
    } catch (error) {
        return false;
    } finally {
        if (fd !== undefined) {
            fs.closeSync(fd);
        }
    }
}

/**
 * Write a generated JSON file. Refuses to touch files that are not marked as generated.
 *
 * @returns {'created'|'updated'|'unchanged'|'refused'}
 */
function writeGeneratedFile(file, obj, { dryRun = false } = {}) {
    if (obj._generated !== true || Object.keys(obj)[0] !== '_generated') {
        throw new Error(`Refusing to write ${file}: "_generated": true must be the first key`);
    }

    const text = serializeFile(obj);
    const exists = fs.existsSync(file);

    if (exists && !isGeneratedFile(file)) {
        return 'refused';
    }

    if (exists && fs.readFileSync(file, 'utf8') === text) {
        return 'unchanged';
    }

    if (!dryRun) {
        fs.writeFileSync(file, text);
    }

    return exists ? 'updated' : 'created';
}

/** Delete a file only if it is marked generated. */
function deleteGeneratedFile(file, { dryRun = false } = {}) {
    if (!fs.existsSync(file) || !isGeneratedFile(file)) {
        return false;
    }

    if (!dryRun) {
        fs.unlinkSync(file);
    }

    return true;
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Lower-case ids of every `assets/airlines/*.json` file (excluding the build output). */
function listAirlineIds() {
    return fs.readdirSync(AIRLINES_DIR)
        .filter((f) => f.endsWith('.json') && f !== 'airlines.json')
        .map((f) => f.slice(0, -5));
}

/**
 * Parsed existing airlines keyed by id. `generated` tells whether the file is ours.
 *
 * @returns {Map<string, {data: Object, generated: boolean}>}
 */
function loadAirlines() {
    const map = new Map();

    for (const id of listAirlineIds()) {
        const file = path.join(AIRLINES_DIR, `${id}.json`);

        try {
            map.set(id, { data: readJson(file), generated: isGeneratedFile(file) });
        } catch (error) {
            console.warn(`WARN: unable to parse ${file}: ${error.message}`);
        }
    }

    return map;
}

/**
 * Aircraft types available to the sim.
 *
 * @returns {Map<string, {icao: string, name: string, weightClass: string, takeoff: number, landing: number, ceiling: number, engines: Object}>}
 */
function loadAircraftTypes() {
    const map = new Map();

    for (const f of fs.readdirSync(AIRCRAFT_DIR)) {
        if (!f.endsWith('.json') || f === 'aircraft.json') {
            continue;
        }

        const d = readJson(path.join(AIRCRAFT_DIR, f));

        map.set(d.icao, {
            icao: d.icao,
            name: d.name,
            weightClass: d.weightClass,
            takeoff: d.runway.takeoff,
            landing: d.runway.landing,
            ceiling: d.ceiling,
            engines: d.engines,
            speed: d.speed
        });
    }

    return map;
}

/** Lower-case ICAO codes of airport files in the repo, split by hand-authored / generated. */
function listAirportFiles() {
    const hand = new Set();
    const generated = new Set();

    for (const f of fs.readdirSync(AIRPORTS_DIR)) {
        if (!/^[a-z0-9]{4}\.json$/.test(f)) {
            continue;
        }

        const icao = f.slice(0, 4);

        if (isGeneratedFile(path.join(AIRPORTS_DIR, f))) {
            generated.add(icao);
        } else {
            hand.add(icao);
        }
    }

    return { hand, generated };
}

module.exports = {
    REPO_ROOT,
    ASSETS,
    AIRPORTS_DIR,
    AIRLINES_DIR,
    AIRCRAFT_DIR,
    LOAD_LIST,
    LOAD_LIST_SCHEMA,
    AIRPORT_INDEX,
    isGeneratedFile,
    writeGeneratedFile,
    deleteGeneratedFile,
    readJson,
    listAirlineIds,
    loadAirlines,
    loadAircraftTypes,
    listAirportFiles
};
