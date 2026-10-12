#!/usr/bin/env node
'use strict';
/**
 * Generate `assets/airports/<icao>.json` files and the matching `airportLoadList.json` entries.
 *
 *   node tools/data-pipeline/build-airports.js --data-dir <dir> [options]
 *
 * Options
 *   --max-airports N        total number of NEW airports to generate (default 700)
 *   --size-budget-mb N      stop adding ranked airports once the generated airport JSON would
 *                           exceed N megabytes (default 8)
 *   --min-routes N          minimum number of real airline/route pairs for a ranked airport (default 3)
 *   --must-include GB,IE,.. countries whose airports with scheduled service are ALWAYS generated,
 *                           even with short/unpaved runways (default GB,IE,IM,JE,GG: the UK, Ireland
 *                           and the Crown Dependencies)
 *   --include ICAO,ICAO     airports that are ALWAYS generated (default: UK business and general aviation
 *                           airports with hard runways that have no scheduled service, eg. Biggin Hill)
 *   --only ICAO,ICAO        generate only these airports (debugging; disables pruning)
 *   --dry-run               compute everything but write nothing
 *   --no-prune              keep previously generated files that are no longer selected
 *   --exclude-defunct       must match build-airlines.js: ignore carriers known to have ceased operating
 *   --no-repair             must match build-airlines.js: disable the OpenFlights attribution repair
 *   --summary-json FILE     also write a machine-readable summary (e.g. into your scratch dir)
 *   --verbose               print one line per airport
 *
 * Hand-authored airports (files without `"_generated": true`) are never overwritten or deleted.
 */

const fs = require('fs');
const path = require('path');
const { parseArgs, getNumber, getDataDir } = require('./lib/args');
const { loadContext } = require('./lib/context');
const data = require('./lib/data');
const repo = require('./lib/repo');
const { buildAirport, indexNavaids } = require('./lib/airport');
const { serializeFile } = require('./lib/format');
const { mergeLoadList } = require('./lib/loadlist');

/** UK/IE airports without scheduled airline service that a UK controller would still expect to find */
const DEFAULT_INCLUDE = [
    'EGLF', 'EGKB', 'EGWU', 'EGBJ', 'EGBE', 'EGHD', 'EGMD', 'EGKA', 'EGTK', 'EGLK', 'EGTC', 'EGNR', 'EGMH', 'EGHC',
    'EGNH', 'EGBP', 'EGHL', 'EGLM', 'EGHA', 'EGKR', 'EGMC', 'EGTB', 'EGSC', 'EGSX', 'EGHN', 'EGPM', 'EGBW', 'EGBK',
    'EGUW', 'EGOV', 'EGXW', 'EGVN', 'EGUN'
].join(',');
const magvar = require('./lib/magvar');

function run(argv) {
    const args = parseArgs(argv);
    const dryRun = Boolean(args['dry-run']);
    const prune = args.prune !== false && !args.only;
    const verbose = Boolean(args.verbose);
    const maxAirports = getNumber(args, 'max-airports', 700);
    const budgetBytes = getNumber(args, 'size-budget-mb', 8) * 1024 * 1024;
    const minRoutes = getNumber(args, 'min-routes', 3);
    const mustCountries = new Set(String(args['must-include'] === undefined ? 'GB,IE,IM,JE,GG' : args['must-include']).split(',').filter(Boolean));
    const include = new Set(String(args.include === undefined ? DEFAULT_INCLUDE : args.include).toUpperCase().split(',').filter(Boolean));
    const only = args.only ? new Set(String(args.only).toUpperCase().split(',')) : null;
    const dataDir = getDataDir(args);
    const ctx = loadContext(dataDir, {
        excludeDefunct: Boolean(args['exclude-defunct']),
        repairAttribution: args.repair !== false
    });

    ctx.runwaysByIdent = data.loadRunways(dataDir);
    ctx.frequenciesByIdent = data.loadFrequencies(dataDir);
    ctx.navaidGrid = indexNavaids(data.loadNavaids(dataDir));

    if (magvar.source() !== 'wmm') {
        console.warn('WARN: the "geomagnetism" package was not found; magnetic_north uses a COARSE dipole fallback.\n' +
            '      Install it with:  npm install --no-save --prefix tools/data-pipeline geomagnetism');
    }

    const { hand } = repo.listAirportFiles();

    // ---------------------------------------------------------------- selection
    const serviceCount = (rec) => (ctx.routeIndex.byAirport.get(rec.icao) || [])
        .filter((s) => ctx.airlineIds.has(s.airline) && s.types.size > 0).length;
    const all = Array.from(ctx.airports.values()).filter((rec) => !hand.has(rec.icao.toLowerCase()));
    const mandatory = all
        .filter((rec) => (mustCountries.has(rec.country) && rec.scheduled) || include.has(rec.icao))
        .sort((a, b) => (a.icao < b.icao ? -1 : 1));
    const mandatorySet = new Set(mandatory.map((r) => r.icao));
    const ranked = all
        .filter((rec) => !mandatorySet.has(rec.icao))
        .map((rec) => ({ rec, count: serviceCount(rec) }))
        .filter((x) => x.count >= minRoutes)
        .sort((a, b) => (b.count - a.count) || (a.rec.icao < b.rec.icao ? -1 : 1));

    // ---------------------------------------------------------------- generation
    const generated = new Map(); // icao -> {file, entry, summary, bytes}
    const skipped = [];
    let totalBytes = 0;

    const attempt = (rec, relaxed) => {
        if (only && !only.has(rec.icao)) {
            return false;
        }

        let result;

        try {
            result = buildAirport(rec, ctx, relaxed);
        } catch (error) {
            skipped.push([rec.icao, `ERROR ${error.message}`]);
            console.error(`ERROR generating ${rec.icao}: ${error.stack}`);

            return false;
        }

        if (result.skip) {
            skipped.push([rec.icao, result.skip]);

            return false;
        }

        const bytes = Buffer.byteLength(serializeFile(result.file));

        generated.set(rec.icao, Object.assign(result, { bytes }));
        totalBytes += bytes;

        if (verbose) {
            const s = result.summary;

            console.log(`${rec.icao} ${s.klass.padEnd(6)} routes=${String(s.routeCount).padStart(4)} rate=${String(s.rate).padStart(5)} ` +
                `gates=${s.gates}(${s.realGates} real) rwy=${s.longestM}m src=${s.trafficSource} ${bytes}B`);
        }

        return true;
    };

    for (const rec of mandatory) {
        attempt(rec, true);
    }

    let budgetStopped = false;

    for (const { rec } of ranked) {
        if (generated.size >= maxAirports) {
            break;
        }

        if (totalBytes >= budgetBytes) {
            budgetStopped = true;
            break;
        }

        attempt(rec, false);
    }

    // ---------------------------------------------------------------- write
    const results = { created: 0, updated: 0, unchanged: 0, refused: 0, pruned: 0 };

    for (const [icao, g] of generated) {
        const result = repo.writeGeneratedFile(path.join(repo.AIRPORTS_DIR, `${icao.toLowerCase()}.json`), g.file, { dryRun });

        results[result] += 1;
    }

    if (prune) {
        const keep = new Set(Array.from(generated.keys()).map((i) => i.toLowerCase()));
        const { generated: previous } = repo.listAirportFiles();

        for (const icao of previous) {
            if (!keep.has(icao) && repo.deleteGeneratedFile(path.join(repo.AIRPORTS_DIR, `${icao}.json`), { dryRun })) {
                results.pruned += 1;
            }
        }
    }

    const entries = Array.from(generated.values()).map((g) => g.entry);
    const loadListResult = args.only ? null : mergeLoadList(repo.LOAD_LIST, entries, { dryRun });

    // ---------------------------------------------------------------- report
    const byClass = {};
    let rateSum = 0;

    for (const g of generated.values()) {
        byClass[g.summary.klass] = (byClass[g.summary.klass] || 0) + 1;
        rateSum += g.summary.rate;
    }

    const summary = {
        generated: generated.size,
        mandatory: mandatory.length,
        bytes: totalBytes,
        results,
        byClass,
        averageRate: generated.size ? Math.round((rateSum / generated.size) * 10) / 10 : 0,
        approximateRunways: Array.from(generated.values()).filter((g) => g.summary.approximate).map((g) => g.summary.icao),
        trafficSource: Array.from(generated.values()).reduce((acc, g) => {
            acc[g.summary.trafficSource] = (acc[g.summary.trafficSource] || 0) + 1;

            return acc;
        }, {}),
        budgetStopped,
        loadList: loadListResult,
        skippedCount: skipped.length,
        skipped: skipped.slice(0, 50)
    };

    console.log(`airports: ${generated.size} generated (${mandatory.length} mandatory UK/IE-style, ${generated.size - mandatory.length} ranked), ` +
        `${(totalBytes / 1048576).toFixed(2)} MB${dryRun ? ' [dry run]' : ''}`);
    console.log(`  files: ${JSON.stringify(results)}`);
    console.log(`  classes: ${JSON.stringify(byClass)}  avg total rate ${summary.averageRate}/h`);
    console.log(`  traffic source: ${JSON.stringify(summary.trafficSource)}`);
    console.log(`  approximate runway geometry: ${summary.approximateRunways.length} (${summary.approximateRunways.join(' ')})`);
    console.log(`  skipped: ${skipped.length}${budgetStopped ? ' (stopped by size budget)' : ''}`);

    if (loadListResult) {
        console.log(`  load list: ${JSON.stringify(loadListResult)}`);
    }

    if (args['summary-json'] && args['summary-json'] !== true) {
        fs.writeFileSync(String(args['summary-json']), JSON.stringify(Object.assign(summary, {
            airports: Array.from(generated.values()).map((g) => g.summary),
            skippedAll: skipped
        }), null, 1));
    }

    return summary;
}

if (require.main === module) {
    try {
        run(process.argv.slice(2));
    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        process.exit(1);
    }
}

module.exports = { run };
