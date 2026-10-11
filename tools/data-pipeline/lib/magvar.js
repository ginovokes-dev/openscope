'use strict';
/**
 * Magnetic declination (degrees EAST) for an airport position.
 *
 * Primary source: the optional npm package `geomagnetism` (NOAA World Magnetic Model),
 * evaluated at a FIXED epoch so output is deterministic. Install it WITHOUT touching
 * package.json:
 *
 *     npm install --no-save --prefix tools/data-pipeline geomagnetism
 *
 * The generated airport files embed the computed value, so there is no runtime dependency.
 *
 * Fallback (clearly flagged, only when the package cannot be loaded): a centred-dipole
 * approximation using the 2020 geomagnetic north pole (80.65N, 72.68W). It can be off by
 * 10-20 degrees in places; the caller records `source: "coarse-dipole"` so it can be reported.
 */

const path = require('path');
const { bearingDeg } = require('./geo');

const EPOCH = new Date(Date.UTC(2026, 0, 1));
let cachedModel;
let cachedSource = null;

function tryRequire(request) {
    try {
        // eslint-disable-next-line global-require, import/no-dynamic-require
        return require(request);
    } catch (error) {
        return null;
    }
}

function loadModel(extraPaths = []) {
    if (cachedModel !== undefined) {
        return cachedModel;
    }

    const candidates = [
        'geomagnetism',
        path.join(__dirname, '..', 'node_modules', 'geomagnetism'),
        process.env.GEOMAGNETISM_PATH,
        ...extraPaths
    ].filter(Boolean);

    for (const candidate of candidates) {
        const mod = tryRequire(candidate);

        if (mod && typeof mod.model === 'function') {
            cachedModel = mod.model(EPOCH);
            cachedSource = 'wmm';

            return cachedModel;
        }
    }

    cachedModel = null;
    cachedSource = 'coarse-dipole';

    return cachedModel;
}

/**
 * @param {number} lat
 * @param {number} lon
 * @returns {{decl: number, source: 'wmm'|'coarse-dipole'}}
 */
function declination(lat, lon) {
    const model = loadModel();

    if (model) {
        const decl = model.point([lat, lon]).decl;

        if (Number.isFinite(decl)) {
            return { decl: Math.round(decl * 10) / 10, source: 'wmm' };
        }
    }

    // bearing from the site to the geomagnetic north pole == declination (east positive)
    let decl = bearingDeg(lat, lon, 80.65, -72.68);

    if (decl > 180) {
        decl -= 360;
    }

    return { decl: Math.round(decl * 10) / 10, source: 'coarse-dipole' };
}

function source() {
    loadModel();

    return cachedSource;
}

module.exports = { declination, source, EPOCH };
