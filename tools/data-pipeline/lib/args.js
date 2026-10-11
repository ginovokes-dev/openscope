'use strict';
/**
 * Tiny CLI argument parser (no dependencies).
 *
 *   --flag            -> true
 *   --no-flag         -> false
 *   --key value       -> 'value'
 *   --key=value       -> 'value'
 *
 * Numeric-looking values are converted to numbers by `getNumber`.
 */

function parseArgs(argv) {
    const out = { _: [] };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        if (!arg.startsWith('--')) {
            out._.push(arg);
            continue;
        }

        const body = arg.slice(2);
        const eq = body.indexOf('=');

        if (eq >= 0) {
            out[body.slice(0, eq)] = body.slice(eq + 1);
            continue;
        }

        if (body.startsWith('no-')) {
            out[body.slice(3)] = false;
            continue;
        }

        const next = argv[i + 1];

        if (next !== undefined && !next.startsWith('--')) {
            out[body] = next;
            i += 1;
        } else {
            out[body] = true;
        }
    }

    return out;
}

function getNumber(args, key, fallback) {
    if (args[key] === undefined || args[key] === true) {
        return fallback;
    }

    const n = Number(args[key]);

    if (!Number.isFinite(n)) {
        throw new Error(`--${key} expects a number, got "${args[key]}"`);
    }

    return n;
}

function getDataDir(args) {
    const dir = args['data-dir'] || process.env.PIPELINE_DATA_DIR;

    if (!dir || dir === true) {
        throw new Error('Missing --data-dir <directory with the OurAirports/OpenFlights files> (or env PIPELINE_DATA_DIR).\n' +
            'See tools/data-pipeline/README.md for where to download the data.');
    }

    return String(dir);
}

module.exports = { parseArgs, getNumber, getDataDir };
