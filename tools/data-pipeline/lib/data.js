'use strict';
/**
 * Loaders for the downloaded open datasets. All files are treated as UNTRUSTED text: they are
 * only ever parsed as CSV/strings, never evaluated or required, and every field is validated
 * before use.
 *
 *  OurAirports (public domain)  https://github.com/davidmegginson/ourairports-data
 *    airports.csv runways.csv airport-frequencies.csv navaids.csv countries.csv regions.csv
 *  OpenFlights (ODbL)           https://github.com/jpatokal/openflights/tree/master/data
 *    airlines.dat routes.dat airports.dat (planes.dat is not needed)
 *    Either the original names or the "of_" prefixed names (of_airlines.dat, of_routes.dat,
 *    of_airports.dat) are accepted, so the OpenFlights files do not clash with OurAirports'
 *    airports.csv when stored in one directory.
 */

const fs = require('fs');
const path = require('path');
const { parseCsvObjects, parseCsv, normaliseNull } = require('./csv');

/** canonical name -> accepted file names (first existing wins) */
const FILE_NAMES = {
    'airports.csv': ['airports.csv'],
    'runways.csv': ['runways.csv'],
    'airport-frequencies.csv': ['airport-frequencies.csv'],
    'navaids.csv': ['navaids.csv'],
    'countries.csv': ['countries.csv'],
    'of_airlines.dat': ['of_airlines.dat', 'airlines.dat'],
    'of_routes.dat': ['of_routes.dat', 'routes.dat'],
    'of_airports.dat': ['of_airports.dat', 'airports.dat']
};
const REQUIRED_FILES = Object.keys(FILE_NAMES);

function resolveFile(dir, canonical) {
    const found = FILE_NAMES[canonical].find((name) => fs.existsSync(path.join(dir, name)));

    return found ? path.join(dir, found) : null;
}

function readText(dir, canonical) {
    const file = resolveFile(dir, canonical);

    if (!file) {
        throw new Error(`Data file ${FILE_NAMES[canonical].join(' or ')} not found in ${dir}`);
    }

    return fs.readFileSync(file, 'utf8');
}

function num(value) {
    if (value === undefined || value === null || value === '') {
        return null;
    }

    const n = Number(value);

    return Number.isFinite(n) ? n : null;
}

function checkDataDir(dataDir) {
    if (!dataDir || !fs.existsSync(dataDir) || !fs.statSync(dataDir).isDirectory()) {
        throw new Error(`Data directory not found: ${dataDir}\nSee tools/data-pipeline/README.md for download instructions.`);
    }

    const missing = REQUIRED_FILES.filter((f) => !resolveFile(dataDir, f));

    if (missing.length) {
        throw new Error(`Data directory ${dataDir} is missing: ${missing.map((f) => FILE_NAMES[f].join(' or ')).join(', ')}\n` +
            'See tools/data-pipeline/README.md.');
    }
}

/** ICAO code of an OurAirports row (4 letters), or ''. */
function icaoOf(row) {
    const candidates = [row.icao_code, row.ident];

    for (const c of candidates) {
        if (/^[A-Z]{4}$/.test(c || '')) {
            return c;
        }
    }

    return '';
}

/**
 * @param {string} dataDir
 * @returns {{airports: Map<string,Object>, byIata: Map<string,string>, identToIcao: Map<string,string>, countries: Map<string,string>}}
 */
function loadOurAirports(dataDir) {
    const rows = parseCsvObjects(readText(dataDir, 'airports.csv'));
    const airports = new Map();
    const byIata = new Map();
    const identToIcao = new Map();
    const rank = { large_airport: 3, medium_airport: 2, small_airport: 1 };

    for (const r of rows) {
        const type = r.type;

        if (!rank[type]) {
            continue;
        }

        const icao = icaoOf(r);
        const lat = num(r.latitude_deg);
        const lon = num(r.longitude_deg);

        if (!icao || lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
            continue;
        }

        const existing = airports.get(icao);

        if (existing && rank[existing.type] >= rank[type]) {
            continue;
        }

        const iata = /^[A-Z]{3}$/.test(r.iata_code || '') ? r.iata_code : '';
        const record = {
            icao,
            ident: r.ident,
            iata,
            name: (r.name || '').trim(),
            city: (r.municipality || '').trim(),
            country: r.iso_country || '',
            region: r.iso_region || '',
            continent: r.continent || '',
            lat,
            lon,
            elevationFt: num(r.elevation_ft),
            type,
            scheduled: r.scheduled_service === 'yes'
        };

        airports.set(icao, record);
        identToIcao.set(r.ident, icao);
    }

    for (const record of airports.values()) {
        if (record.iata) {
            const current = byIata.get(record.iata);

            if (!current || rank[airports.get(current).type] < rank[record.type]) {
                byIata.set(record.iata, record.icao);
            }
        }
    }

    const countries = new Map();

    for (const r of parseCsvObjects(readText(dataDir, 'countries.csv'))) {
        countries.set(r.code, r.name);
    }

    return { airports, byIata, identToIcao, countries };
}

/** Runway rows grouped by airport ident (as numbers where applicable). */
function loadRunways(dataDir) {
    const rows = parseCsvObjects(readText(dataDir, 'runways.csv'));
    const byIdent = new Map();

    for (const r of rows) {
        const entry = {
            ident: r.airport_ident,
            lengthFt: num(r.length_ft),
            widthFt: num(r.width_ft),
            surface: (r.surface || '').trim(),
            lighted: r.lighted === '1',
            closed: r.closed === '1',
            le: {
                ident: (r.le_ident || '').trim().toUpperCase(),
                lat: num(r.le_latitude_deg),
                lon: num(r.le_longitude_deg),
                elevationFt: num(r.le_elevation_ft),
                headingTrue: num(r.le_heading_degT),
                displacedFt: num(r.le_displaced_threshold_ft)
            },
            he: {
                ident: (r.he_ident || '').trim().toUpperCase(),
                lat: num(r.he_latitude_deg),
                lon: num(r.he_longitude_deg),
                elevationFt: num(r.he_elevation_ft),
                headingTrue: num(r.he_heading_degT),
                displacedFt: num(r.he_displaced_threshold_ft)
            }
        };

        if (!byIdent.has(entry.ident)) {
            byIdent.set(entry.ident, []);
        }

        byIdent.get(entry.ident).push(entry);
    }

    return byIdent;
}

function loadFrequencies(dataDir) {
    const rows = parseCsvObjects(readText(dataDir, 'airport-frequencies.csv'));
    const byIdent = new Map();

    for (const r of rows) {
        const mhz = num(r.frequency_mhz);

        if (mhz === null || mhz < 100 || mhz > 140) {
            continue;
        }

        if (!byIdent.has(r.airport_ident)) {
            byIdent.set(r.airport_ident, []);
        }

        byIdent.get(r.airport_ident).push({
            type: (r.type || '').toUpperCase(),
            description: (r.description || '').trim(),
            mhz
        });
    }

    return byIdent;
}

/** VOR / NDB family navaids with a plausible 2-5 letter identifier. */
function loadNavaids(dataDir) {
    const rows = parseCsvObjects(readText(dataDir, 'navaids.csv'));
    const out = [];

    for (const r of rows) {
        const ident = (r.ident || '').trim().toUpperCase();
        const lat = num(r.latitude_deg);
        const lon = num(r.longitude_deg);

        if (!/^[A-Z]{2,5}$/.test(ident) || lat === null || lon === null) {
            continue;
        }

        if (!/^(VOR|VOR-DME|VORTAC|NDB|NDB-DME)$/.test(r.type || '')) {
            continue;
        }

        out.push({
            ident,
            name: (r.name || '').trim(),
            type: r.type,
            lat,
            lon,
            country: r.iso_country || ''
        });
    }

    return out;
}

/** OpenFlights airlines keyed by numeric id. */
function loadOpenFlightsAirlines(dataDir) {
    const rows = parseCsv(readText(dataDir, 'of_airlines.dat'));
    const byId = new Map();

    for (const r of rows) {
        const c = r.map(normaliseNull);

        if (c.length < 8) {
            continue;
        }

        byId.set(c[0], {
            id: c[0],
            name: c[1],
            alias: c[2],
            iata: c[3],
            icao: c[4],
            callsign: c[5],
            country: c[6],
            active: c[7] === 'Y'
        });
    }

    return byId;
}

/**
 * OpenFlights routes. Codeshares and multi-stop records are discarded.
 *
 * @returns {Array<{airlineId: string, src: string, dst: string, equipment: string[]}>}
 */
function loadOpenFlightsRoutes(dataDir) {
    const rows = parseCsv(readText(dataDir, 'of_routes.dat'));
    const out = [];

    for (const r of rows) {
        const c = r.map(normaliseNull);

        if (c.length < 9) {
            continue;
        }

        if (c[6] === 'Y' || (c[7] && c[7] !== '0')) {
            continue;
        }

        if (!/^[A-Z0-9]{3}$/.test(c[2]) || !/^[A-Z0-9]{3}$/.test(c[4])) {
            continue;
        }

        out.push({
            airlineId: c[1],
            src: c[2],
            dst: c[4],
            equipment: (c[8] || '').split(/\s+/).filter(Boolean)
        });
    }

    return out;
}

/**
 * OpenFlights airport table.
 *
 * @returns {{codes: Map<string,string>, cities: Map<string,string>}} IATA -> ICAO (fallback for the
 *          OurAirports mapping) and IATA -> served city (used to name the radio facility, e.g.
 *          "Charles de Gaulle" -> "Paris", "Ingliston" -> "Edinburgh")
 */
function loadOpenFlightsAirports(dataDir) {
    const rows = parseCsv(readText(dataDir, 'of_airports.dat'));
    const codes = new Map();
    const cities = new Map();

    for (const r of rows) {
        const c = r.map(normaliseNull);

        if (c.length >= 6 && /^[A-Z]{3}$/.test(c[4])) {
            if (/^[A-Z]{4}$/.test(c[5])) {
                codes.set(c[4], c[5]);
            }

            if (c[2]) {
                cities.set(c[4], c[2]);
            }
        }
    }

    return { codes, cities };
}

module.exports = {
    REQUIRED_FILES,
    checkDataDir,
    loadOurAirports,
    loadRunways,
    loadFrequencies,
    loadNavaids,
    loadOpenFlightsAirlines,
    loadOpenFlightsRoutes,
    loadOpenFlightsAirports
};
