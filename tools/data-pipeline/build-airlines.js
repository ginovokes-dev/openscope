#!/usr/bin/env node
'use strict';
/**
 * Generate `assets/airlines/<icao>.json` for active OpenFlights airlines that have routes in the
 * data set but no airline file in the repo yet.
 *
 *   node tools/data-pipeline/build-airlines.js --data-dir <dir> [--dry-run] [--no-prune] [--exclude-defunct] [--no-repair]
 *
 * `--no-repair` disables the OpenFlights attribution repair (lib/repair.js), which re-attributes or
 * drops route records filed under an airline that never touches its home country (a known defect
 * of the data set). Must match the flag given to build-airports.js.
 *
 * `--exclude-defunct` drops carriers listed in lib/defunct.js (known to have ceased operating since
 * the ~2014 OpenFlights snapshot) instead of keeping them; merged carriers with a successor brand
 * that already has an airline file (e.g. US Airways -> American) are always re-attributed.
 *
 * Existing hand-authored airline files are never modified (only files carrying
 * `"_generated": true` are ever rewritten or pruned).
 */

const path = require('path');
const { parseArgs, getDataDir } = require('./lib/args');
const { loadContext } = require('./lib/context');
const repo = require('./lib/repo');
const { cleanCallsignName } = require('./lib/naming');
const { DEFUNCT } = require('./lib/defunct');
const { LONG_HAUL_EXTRA } = require('./lib/equipment');

/** OpenFlights country name -> callsign format group. */
const FORMAT_GROUPS = {
    westEurope: {
        formats: ['####', '###@', '##@@', '###'],
        countries: ['United Kingdom', 'Ireland', 'Germany', 'France', 'Spain', 'Italy', 'Netherlands', 'Belgium', 'Switzerland',
            'Austria', 'Denmark', 'Norway', 'Sweden', 'Finland', 'Iceland', 'Luxembourg', 'Portugal', 'Malta', 'Greece', 'Cyprus',
            'Faroe Islands', 'Jersey', 'Guernsey', 'Isle of Man', 'Liechtenstein']
    },
    northAmerica: {
        formats: ['####', '###'],
        countries: ['United States', 'Canada', 'Mexico', 'Puerto Rico', 'Guam']
    },
    eastEurope: {
        formats: ['###', '####'],
        countries: ['Russia', 'Ukraine', 'Belarus', 'Kazakhstan', 'Uzbekistan', 'Azerbaijan', 'Armenia', 'Georgia', 'Moldova',
            'Lithuania', 'Latvia', 'Estonia', 'Poland', 'Czech Republic', 'Slovakia', 'Hungary', 'Romania', 'Bulgaria', 'Serbia',
            'Croatia', 'Slovenia', 'Bosnia and Herzegovina', 'Montenegro', 'Macedonia', 'Albania', 'Kyrgyzstan', 'Tajikistan',
            'Turkmenistan']
    },
    eastAsia: {
        formats: ['####', '###'],
        countries: ['Japan', 'China', 'South Korea', 'Taiwan', 'Hong Kong', 'Macau', 'Mongolia']
    },
    oceania: {
        formats: ['###', '####', '##'],
        countries: ['Australia', 'New Zealand', 'Fiji', 'Papua New Guinea', 'French Polynesia', 'New Caledonia', 'Vanuatu',
            'Samoa', 'Tonga', 'Solomon Islands']
    }
};

const DEFAULT_FORMATS = ['###', '####', '##'];

function formatsForCountry(country) {
    for (const group of Object.values(FORMAT_GROUPS)) {
        if (group.countries.includes(country)) {
            return group.formats.slice();
        }
    }

    return DEFAULT_FORMATS.slice();
}

/**
 * @param {Object} ctx    from loadContext
 * @returns {{airlines: Map<string, Object>, skipped: Object}}
 */
function planAirlines(ctx) {
    const hand = new Set();
    const handCallsigns = new Set();
    const existing = repo.loadAirlines();

    for (const [id, info] of existing) {
        if (!info.generated) {
            hand.add(id);
            handCallsigns.add(String(info.data.callsign && info.data.callsign.name).toLowerCase());
        }
    }

    const skipped = { existing: 0, defunct: 0, badCallsign: 0, duplicateCallsign: 0, noTypes: 0, inactiveOrNoIcao: 0 };
    const candidates = new Map(); // icao lower -> candidate

    for (const rec of ctx.ofAirlines.values()) {
        if (!rec.active || !/^[A-Z]{3}$/.test(rec.icao)) {
            skipped.inactiveOrNoIcao += 1;
            continue;
        }

        const id = rec.icao.toLowerCase();

        if (hand.has(id)) {
            skipped.existing += 1;
            continue;
        }

        if (ctx.excludeDefunct && DEFUNCT.has(rec.icao)) {
            skipped.defunct += 1;
            continue;
        }

        const services = ctx.routeIndex.byAirline.get(id) || [];

        if (services.length === 0) {
            continue; // no routes in the data: not generated (no fleet information)
        }

        const callsign = cleanCallsignName(rec.callsign);

        if (!callsign) {
            skipped.badCallsign += 1;
            continue;
        }

        const types = new Map();

        for (const s of services) {
            for (const [type, w] of s.types) {
                types.set(type, (types.get(type) || 0) + w);
            }
        }

        if (types.size === 0) {
            skipped.noTypes += 1;
            continue;
        }

        const previous = candidates.get(id);

        if (previous && previous.services.length >= services.length) {
            continue;
        }

        candidates.set(id, { id, rec, callsign, services, types });
    }

    // callsign uniqueness against hand-authored airlines and among the new ones
    const byCallsign = new Map();

    for (const c of Array.from(candidates.values()).sort((a, b) => (b.services.length - a.services.length) || (a.id < b.id ? -1 : 1))) {
        const key = c.callsign.toLowerCase();

        if (handCallsigns.has(key) || byCallsign.has(key)) {
            skipped.duplicateCallsign += 1;
            candidates.delete(c.id);
            continue;
        }

        byCallsign.set(key, c.id);
    }

    return { candidates, skipped };
}

function buildFleets(types, aircraftTypes) {
    const entries = Array.from(types.entries()).sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1));
    const max = entries[0][1];
    const scale = max > 100 ? 100 / max : 1;
    const weight = (c) => Math.max(1, Math.round(c * scale));
    const all = entries.map(([type, c]) => [type, weight(c)]);
    const sortByType = (list) => list.slice().sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const isLong = (type) => {
        const def = aircraftTypes.get(type);

        return (def && (def.weightClass === 'H' || def.weightClass === 'J')) || LONG_HAUL_EXTRA.has(type);
    };
    const fleets = { default: sortByType(all) };
    const long = all.filter(([type]) => isLong(type));
    const short = all.filter(([type]) => !isLong(type));

    if (long.length) {
        fleets.long = sortByType(long);
    }

    if (short.length) {
        fleets.short = sortByType(short);
    }

    for (const [type, w] of sortByType(all)) {
        fleets[type.toLowerCase()] = [[type, w]];
    }

    return fleets;
}

function run(argv) {
    const args = parseArgs(argv);
    const dryRun = Boolean(args['dry-run']);
    const prune = args.prune !== false;
    const ctx = loadContext(getDataDir(args), {
        excludeDefunct: Boolean(args['exclude-defunct']),
        repairAttribution: args.repair !== false
    });
    const { candidates, skipped } = planAirlines(ctx);
    const results = { created: 0, updated: 0, unchanged: 0, refused: 0, pruned: 0 };
    const written = new Set();

    for (const c of Array.from(candidates.values()).sort((a, b) => (a.id < b.id ? -1 : 1))) {
        const airline = {
            _generated: true,
            icao: c.id,
            name: c.rec.name.trim(),
            callsign: { name: c.callsign, callsignFormats: formatsForCountry(c.rec.country) },
            fleets: buildFleets(c.types, ctx.aircraftTypes)
        };
        const result = repo.writeGeneratedFile(path.join(repo.AIRLINES_DIR, `${c.id}.json`), airline, { dryRun });

        results[result] += 1;
        written.add(c.id);
    }

    if (prune) {
        for (const id of repo.listAirlineIds()) {
            const file = path.join(repo.AIRLINES_DIR, `${id}.json`);

            if (!written.has(id) && repo.isGeneratedFile(file) && repo.deleteGeneratedFile(file, { dryRun })) {
                results.pruned += 1;
            }
        }
    }

    console.log(`airlines: ${candidates.size} generated (${JSON.stringify(results)})${dryRun ? ' [dry run]' : ''}`);
    console.log(`  skipped: ${JSON.stringify(skipped)}`);
    console.log(`  OpenFlights attribution repair: ${ctx.repair.repaired.length} airlines re-attributed, ${ctx.repair.dropped.length} dropped` +
        `${args.verbose ? '' : ' (--verbose lists them)'}`);

    if (args.verbose) {
        ctx.repair.repaired.forEach((line) => console.log(`    re-attributed: ${line}`));
        ctx.repair.dropped.forEach((line) => console.log(`    dropped: ${line}`));
    }

    return { count: candidates.size, results, skipped };
}

if (require.main === module) {
    try {
        run(process.argv.slice(2));
    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        process.exit(1);
    }
}

module.exports = { run, planAirlines, buildFleets, formatsForCountry };
