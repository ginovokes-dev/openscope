'use strict';
/**
 * Traffic modelling helpers: real-route city pairs, general-aviation mixes and country-level
 * fallback mixes, all subject to the runway-length realism filter.
 */

const { isTypeAllowed } = require('./realism');
const { bearingDeg, distanceNm, normaliseDeg } = require('./geo');

/** ISO country -> general aviation airline id (registration prefix) as present in assets/airlines. */
const GA_BY_COUNTRY = {
    GB: 'g', IE: 'ei', US: 'n', CA: 'c', DE: 'd', FR: 'f', IT: 'i', ES: 'ec', PT: 'cs', NL: 'ph', BE: 'oo',
    CH: 'hb', AT: 'oe', SE: 'se', NO: 'ln', DK: 'oy', FI: 'oh', IS: 'tf', PL: 'sp', CZ: 'ok', SK: 'om',
    HU: 'ha', RO: 'yr', BG: 'lz', TR: 'tc', RU: 'ra', UA: 'ur', BY: 'ew', LT: 'ly', LV: 'yl', EE: 'es',
    HR: '9a', SI: 's5', RS: 'yu', BA: 'e7', ME: '4o', AL: 'za', MK: 'z3', LU: 'lx', MT: '9h', CY: '5b',
    IL: '4x', JO: 'jy', LB: 'od', SA: 'hz', AE: 'a6', QA: 'a7', KW: '9k', BH: 'a9c', OM: 'a4o', IR: 'ep',
    IQ: 'yi', EG: 'su', MA: 'cn', DZ: '7t', TN: 'ts', ZA: 'zs', KE: '5y', ET: 'et', NG: '5n', GH: '9g',
    TZ: '5h', UG: '5x', ZW: 'z', ZM: '9j', JP: 'ja', KR: 'hl', CN: 'b', HK: 'b', TW: 'b', IN: 'vt', PK: 'ap',
    BD: 's2', LK: '4r', TH: 'hs', VN: 'vn', MY: '9m', SG: '9v', ID: 'pk', PH: 'rp', AU: 'vh', NZ: 'zk',
    BR: 'pp', AR: 'lv', CL: 'cc', CO: 'hk', PE: 'ob', VE: 'yv', MX: 'xa', EC: 'hc', UY: 'cx', PY: 'zp',
    BO: 'cp', CR: 'ti', PA: 'hp', GT: 'tg', CU: 'cu', JM: '6y', BS: 'c6', TT: '9y', BB: '8p', PR: 'n',
    GU: 'n', VI: 'n', MC: '3a', GE: '4l', AZ: '4k', AM: 'ek', MD: 'er', KG: 'ex', TJ: 'ey', TM: 'ez',
    UZ: 'uk', KZ: 'up', MN: 'ju', NP: '9n', MM: 'xy', KH: 'xu', BN: 'v8', NA: 'v5', BW: 'a2', MZ: 'c9',
    AO: 'd2', SN: '6v', CI: 'tu', CM: 'tj', GA: 'tr', CD: '9s', RW: '9xr', MU: '3b', MG: '5r', SC: 's7',
    MV: '8q', FJ: 'dq', PG: 'p2', BZ: 'v3', HN: 'hr', SV: 'ys', NI: 'yn', GY: '8r', SR: 'pz', AW: 'p4',
    IM: 'm', GG: '2', JE: 'zj', AD: 'c3'
};

/** [type, weight, kind] -- kind: 'light' | 'turbo' | 'jet' */
const GA_TYPES = [
    ['C172', 6, 'light'], ['P28A', 5, 'light'], ['C182', 3, 'light'], ['BE36', 2, 'light'],
    ['DA42', 1, 'light'], ['TB20', 1, 'light'],
    ['C208', 2, 'turbo'], ['PC12', 2, 'turbo'], ['BE20', 1, 'turbo'], ['B350', 1, 'turbo'], ['P180', 1, 'turbo'],
    ['C510', 1.2, 'jet'], ['E50P', 1, 'jet'], ['C550', 1.4, 'jet'], ['E55P', 1, 'jet'], ['CL30', 1, 'jet'],
    ['C680', 0.8, 'jet'], ['H25B', 0.8, 'jet'], ['LJ45', 0.8, 'jet'], ['F2TH', 0.6, 'jet'],
    ['GLF4', 0.5, 'jet'], ['GLEX', 0.5, 'jet'], ['GLF5', 0.4, 'jet']
];

/** Relative weight of jets vs light GA by airport class. */
const JET_FACTOR = { hub: 3.0, large: 2.2, medium: 1.2, small: 0.5 };

/**
 * Build the weighted airline entries for a GA pattern.
 *
 * @returns {Array<[string, number]>}
 */
function gaAirlines(gaId, airportClass, longestRunwayM, elevationFt, aircraftTypes) {
    const out = [];

    for (const [type, weight, kind] of GA_TYPES) {
        const def = aircraftTypes.get(type);

        if (!def || !isTypeAllowed(def, longestRunwayM, elevationFt)) {
            continue;
        }

        let w = weight;

        if (kind === 'jet') {
            w *= JET_FACTOR[airportClass];
        } else if (kind === 'light' && (airportClass === 'hub' || airportClass === 'large')) {
            w *= 0.5;
        }

        out.push([`${gaId}/${type.toLowerCase()}`, Math.max(1, Math.round(w))]);
    }

    return out;
}

/**
 * Collect the real city pairs for an airport.
 *
 * @param {Object} airport                 OurAirports record
 * @param {Array} services                 route services touching the airport
 * @param {Object} ctx                     { airports, aircraftTypes, airlineIds }
 * @param {number} longestRunwayM
 * @returns {Array<{icao, lat, lon, weight, combos: Map<string, number>, distNm, trueBearing}>}
 */
function collectCities(airport, services, ctx, longestRunwayM) {
    const cities = new Map();
    const elevation = airport.elevationFt || 0;

    for (const service of services) {
        if (!ctx.airlineIds.has(service.airline)) {
            continue;
        }

        const otherIcao = service.a === airport.icao ? service.b : service.a;
        const other = ctx.airports.get(otherIcao);

        if (!other) {
            continue;
        }

        const combos = [];

        for (const [type, weight] of service.types) {
            const def = ctx.aircraftTypes.get(type);

            if (def && isTypeAllowed(def, longestRunwayM, elevation)) {
                combos.push([type, weight]);
            }
        }

        if (combos.length === 0) {
            continue;
        }

        let city = cities.get(otherIcao);

        if (!city) {
            city = {
                icao: otherIcao,
                lat: other.lat,
                lon: other.lon,
                weight: 0,
                combos: new Map(),
                distNm: distanceNm(airport.lat, airport.lon, other.lat, other.lon),
                trueBearing: bearingDeg(airport.lat, airport.lon, other.lat, other.lon)
            };
            cities.set(otherIcao, city);
        }

        for (const [type, weight] of combos) {
            const key = `${service.airline}/${type.toLowerCase()}`;

            city.combos.set(key, (city.combos.get(key) || 0) + weight);
            city.weight += weight;
        }
    }

    return Array.from(cities.values()).sort((x, y) => (y.weight - x.weight) || (x.icao < y.icao ? -1 : 1));
}

/**
 * Aggregate several combos maps into the top-N `[airline/type, weight]` list.
 */
function topAirlines(comboMaps, limit = 12) {
    const merged = new Map();

    for (const map of comboMaps) {
        for (const [key, weight] of map) {
            merged.set(key, (merged.get(key) || 0) + weight);
        }
    }

    return Array.from(merged.entries())
        .sort((x, y) => (y[1] - x[1]) || (x[0] < y[0] ? -1 : 1))
        .slice(0, limit)
        .map(([key, weight]) => [key, Math.max(1, Math.round(weight))]);
}

/**
 * Domestic (same country) airline/type mix, used when an airport has no usable real routes.
 *
 * @returns {Map<string, number>} airline/type -> weight
 */
function countryFallbackMix(country, ctx, routeIndex, longestRunwayM, elevationFt) {
    const mix = new Map();

    for (const service of routeIndex.services) {
        if (!ctx.airlineIds.has(service.airline)) {
            continue;
        }

        const a = ctx.airports.get(service.a);
        const b = ctx.airports.get(service.b);

        if (!a || !b || a.country !== country || b.country !== country) {
            continue;
        }

        for (const [type, weight] of service.types) {
            const def = ctx.aircraftTypes.get(type);

            // fallback traffic is deliberately conservative: never wide-bodies
            if (!def || def.weightClass === 'H' || def.weightClass === 'J' || !isTypeAllowed(def, longestRunwayM, elevationFt)) {
                continue;
            }

            const key = `${service.airline}/${type.toLowerCase()}`;

            mix.set(key, (mix.get(key) || 0) + weight);
        }
    }

    return mix;
}

module.exports = {
    GA_BY_COUNTRY,
    gaAirlines,
    collectCities,
    topAirlines,
    countryFallbackMix,
    normaliseDeg
};
