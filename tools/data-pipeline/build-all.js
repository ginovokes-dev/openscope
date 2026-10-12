#!/usr/bin/env node
'use strict';
/**
 * Run the whole pipeline in the right order:
 *
 *   1. build-airlines.js       (new airline files)
 *   2. build-airports.js       (airport files + airportLoadList.json entries; needs the airlines)
 *   3. build-airport-index.js  (global index; needs the generated airports)
 *   4. check.js                (structural validation, exit code 1 on error)
 *
 *   node tools/data-pipeline/build-all.js --data-dir <dir> [any flag understood by the builders]
 *
 * All flags are forwarded to every step (see each script's header for the list), e.g.
 *   --max-airports 700 --size-budget-mb 8 --exclude-defunct --no-repair --dry-run
 */

const path = require('path');
const { spawnSync } = require('child_process');
const airlines = require('./build-airlines');
const airports = require('./build-airports');
const airportIndex = require('./build-airport-index');

function main() {
    const argv = process.argv.slice(2);
    const dryRun = argv.includes('--dry-run');

    airlines.run(argv);
    airports.run(argv);
    airportIndex.run(argv);

    if (dryRun) {
        console.log('dry run: skipping check.js');

        return;
    }

    const result = spawnSync(process.execPath, [path.join(__dirname, 'check.js')], { stdio: 'inherit' });

    process.exit(result.status === null ? 1 : result.status);
}

try {
    main();
} catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
}
