#!/usr/bin/env node
'use strict';
/**
 * Build `assets/airports/airportIndex.json`: a compact lookup of (almost) every airport in the world
 * the client may need to know about (origin/destination/diversion/fuel-distance calculations).
 *
 *   node tools/data-pipeline/build-airport-index.js --data-dir <dir> [--dry-run]
 *
 * Contents: every OurAirports airport of type large/medium/small that has an ICAO code AND
 * (an IATA code, OR scheduled_service = yes, OR a file in assets/airports/ (hand-authored or generated)).
 *
 * Format
 *   {
 *     "_generated": true,
 *     "fields": ["icao","iata","name","city","country","lat","lon","elev_ft","rwy_m","type"],
 *     "airports": [["EGGP","LPL","Liverpool John Lennon Airport","Liverpool","GB",53.3336,-2.8497,80,2285,"large_airport"], ...]
 *   }
 *
 * `rwy_m` is the length in metres of the longest non-closed HARD-surface runway (0 when none is
 * known, e.g. grass strips or no runway data). Blank/unknown surface codes at scheduled
 * large/medium airports with runways >= 1200 m are treated as paved (data gap), as in build-airports.js.
 * lat/lon are rounded to 3 decimals (~100 m), elevation to whole feet, rwy_m to whole metres.
 * Small airports (OurAirports type small_airport) with no hard runway of at least 1400 m are left
 * out unless they have scheduled service, a file in assets/airports/, or are the origin/destination
 * of a generated spawn pattern (this keeps the index near 600 KB; run with --all-small to keep them).
 */

const fs = require('fs');
const path = require('path');
const { parseArgs, getDataDir } = require('./lib/args');
const data = require('./lib/data');
const repo = require('./lib/repo');
const { isHardSurface } = require('./lib/runways');
const { round } = require('./lib/geo');

const FIELDS = ['icao', 'iata', 'name', 'city', 'country', 'lat', 'lon', 'elev_ft', 'rwy_m', 'type'];
const FT_PER_M = 3.280839895;
/** small airports below this hard-runway length are only indexed when they matter (see header) */
const MIN_SMALL_RWY_M = 1400;

/** Origin/destination ICAO codes used by the spawn patterns of the generated airports. */
function referencedAirports(generatedIcaos) {
    const out = new Set();

    for (const icao of generatedIcaos) {
        try {
            const d = repo.readJson(path.join(repo.AIRPORTS_DIR, `${icao}.json`));

            for (const p of d.spawnPatterns || []) {
                [p.origin, p.destination].forEach((code) => {
                    if (code) {
                        out.add(code);
                    }
                });
            }
        } catch (error) {
            // unreadable files are reported by check.js
        }
    }

    return out;
}

function run(argv) {
    const args = parseArgs(argv);
    const dryRun = Boolean(args['dry-run']);
    const allSmall = Boolean(args['all-small']);
    const dataDir = getDataDir(args);

    data.checkDataDir(dataDir);

    const { airports } = data.loadOurAirports(dataDir);
    const runways = data.loadRunways(dataDir);
    const { hand, generated } = repo.listAirportFiles();
    const inRepo = new Set([...hand, ...generated].map((i) => i.toUpperCase()));
    const referenced = referencedAirports(generated);
    const rows = [];
    let droppedSmall = 0;

    for (const rec of airports.values()) {
        if (!(rec.iata || rec.scheduled || inRepo.has(rec.icao))) {
            continue;
        }

        let longestFt = 0;

        for (const r of runways.get(rec.ident) || []) {
            if (r.closed || !r.lengthFt) {
                continue;
            }

            const assume = rec.type !== 'small_airport' && rec.scheduled && r.lengthFt / FT_PER_M >= 1200;

            if (isHardSurface(r.surface, assume)) {
                longestFt = Math.max(longestFt, r.lengthFt);
            }
        }

        // keep the file compact: tiny strips without a hard runway are only listed when they have
        // scheduled service, a file in the repo, or are the origin/destination of generated traffic
        if (!allSmall && rec.type === 'small_airport' && longestFt / FT_PER_M < MIN_SMALL_RWY_M && !rec.scheduled &&
            !inRepo.has(rec.icao) && !referenced.has(rec.icao)) {
            droppedSmall += 1;
            continue;
        }

        rows.push([
            rec.icao,
            rec.iata,
            rec.name,
            rec.city,
            rec.country,
            round(rec.lat, 3),
            round(rec.lon, 3),
            rec.elevationFt === null ? 0 : Math.round(rec.elevationFt),
            Math.round(longestFt / FT_PER_M),
            rec.type
        ]);
    }

    rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));

    const file = { _generated: true, fields: FIELDS, airports: rows };
    const result = repo.writeGeneratedFile(repo.AIRPORT_INDEX, file, { dryRun });
    const bytes = dryRun ? 0 : fs.statSync(repo.AIRPORT_INDEX).size;

    console.log(`airport index: ${rows.length} airports, ${(bytes / 1024).toFixed(0)} KB (${result})${dryRun ? ' [dry run]' : ''}; ` +
        `${droppedSmall} small airports (< ${MIN_SMALL_RWY_M} m hard runway, no service, not referenced) left out`);

    if (result === 'refused') {
        console.error(`ERROR: ${path.relative(repo.REPO_ROOT, repo.AIRPORT_INDEX)} exists and is not marked "_generated": refusing to overwrite`);
        process.exitCode = 1;
    }

    return { count: rows.length, bytes, result };
}

if (require.main === module) {
    try {
        run(process.argv.slice(2));
    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        process.exit(1);
    }
}

module.exports = { run, FIELDS };
