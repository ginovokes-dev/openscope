'use strict';
/**
 * Turns the raw OpenFlights route records into "services": one entry per
 * (airline, airport pair), carrying the openScope aircraft types seen on that pair.
 *
 * Route direction is ignored (a record A->B is treated as service on the pair {A, B}),
 * codeshare and multi-stop records were already dropped by the loader.
 */

const { mapEquipment } = require('./equipment');
const { DEFUNCT, SUCCESSOR } = require('./defunct');

/**
 * @param {Object} ctx
 * @param {Map<string,Object>} ctx.ofAirlines
 * @param {Array} ctx.routes
 * @param {Map<string,string>} ctx.byIata        IATA -> ICAO (OurAirports)
 * @param {Map<string,string>} ctx.ofCodes       IATA -> ICAO (OpenFlights fallback)
 * @param {Set<string>} ctx.knownTypes
 * @param {Set<string>} ctx.knownAirlineIds      lower-case ids that have (or will have) an airline file
 * @param {boolean} [ctx.excludeDefunct]         drop carriers known to have ceased operating (see defunct.js)
 *                                               unless a successor brand with an airline file exists
 */
function buildRouteIndex({ ofAirlines, routes, byIata, ofCodes, knownTypes, knownAirlineIds, excludeDefunct = false }) {
    const services = new Map();
    const stats = { records: 0, usedRecords: 0, noAirport: 0, inactive: 0, defunct: 0, unmappedCodes: new Map() };

    for (const route of routes) {
        stats.records += 1;

        const airlineRec = ofAirlines.get(route.airlineId);

        if (!airlineRec || !airlineRec.active || !/^[A-Z]{3}$/.test(airlineRec.icao)) {
            stats.inactive += 1;
            continue;
        }

        let icaoAirline = airlineRec.icao;

        if (DEFUNCT.has(icaoAirline)) {
            const successor = SUCCESSOR[icaoAirline];

            if (successor && knownAirlineIds.has(successor.toLowerCase())) {
                icaoAirline = successor; // merged carrier: attribute the route to its successor brand
            } else if (excludeDefunct) {
                stats.defunct += 1;
                continue;
            }
        }

        const a = byIata.get(route.src) || ofCodes.get(route.src);
        const b = byIata.get(route.dst) || ofCodes.get(route.dst);

        if (!a || !b || a === b) {
            stats.noAirport += 1;
            continue;
        }

        const airline = icaoAirline.toLowerCase();
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const key = `${airline}|${lo}|${hi}`;
        let service = services.get(key);

        if (!service) {
            service = { airline, a: lo, b: hi, fwd: new Map(), bwd: new Map() };
            services.set(key, service);
        }

        const directional = a === lo ? service.fwd : service.bwd;

        for (const code of route.equipment) {
            const mapped = mapEquipment(code, knownTypes);

            if (mapped.length === 0) {
                stats.unmappedCodes.set(code, (stats.unmappedCodes.get(code) || 0) + 1);
                continue;
            }

            const totalWeight = mapped.reduce((s, [, w]) => s + w, 0);

            for (const [type, weight] of mapped) {
                directional.set(type, (directional.get(type) || 0) + weight / totalWeight);
            }
        }

        stats.usedRecords += 1;
    }

    // a route is normally listed once per direction: count the pair once (max of both directions)
    for (const service of services.values()) {
        service.types = new Map();

        for (const map of [service.fwd, service.bwd]) {
            for (const [type, weight] of map) {
                service.types.set(type, Math.max(service.types.get(type) || 0, weight));
            }
        }

        delete service.fwd;
        delete service.bwd;
    }

    const list = Array.from(services.values());
    const byAirport = new Map();
    const byAirline = new Map();

    for (const s of list) {
        for (const icao of [s.a, s.b]) {
            if (!byAirport.has(icao)) {
                byAirport.set(icao, []);
            }

            byAirport.get(icao).push(s);
        }

        if (!byAirline.has(s.airline)) {
            byAirline.set(s.airline, []);
        }

        byAirline.get(s.airline).push(s);
    }

    return { services: list, byAirport, byAirline, stats };
}

module.exports = { buildRouteIndex };
