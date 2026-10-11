'use strict';
/**
 * Loads (once) everything the builders need: datasets, route index, aircraft types, repo state.
 */

const data = require('./data');
const repo = require('./repo');
const { buildRouteIndex } = require('./routes');
const { repairAirlineAttribution } = require('./repair');

/**
 * @param {string} dataDir
 * @param {{excludeDefunct?: boolean}} options
 * @returns {Object}
 */
function loadContext(dataDir, { excludeDefunct = false, repairAttribution = true } = {}) {
    data.checkDataDir(dataDir);

    const ourAirports = data.loadOurAirports(dataDir);
    const ofAirlines = data.loadOpenFlightsAirlines(dataDir);
    const rawRoutes = data.loadOpenFlightsRoutes(dataDir);
    const ofAirports = data.loadOpenFlightsAirports(dataDir);
    const ofCodes = ofAirports.codes;
    const aircraftTypes = repo.loadAircraftTypes();
    const airlineIds = new Set(repo.listAirlineIds());
    const repair = repairAttribution
        ? repairAirlineAttribution({
            ofAirlines,
            routes: rawRoutes,
            airports: ourAirports.airports,
            byIata: ourAirports.byIata,
            ofCodes,
            countries: ourAirports.countries
        })
        : { routes: rawRoutes, repaired: [], dropped: [] };
    const routeIndex = buildRouteIndex({
        ofAirlines,
        routes: repair.routes,
        byIata: ourAirports.byIata,
        ofCodes,
        knownTypes: new Set(aircraftTypes.keys()),
        knownAirlineIds: airlineIds,
        excludeDefunct
    });

    return {
        dataDir,
        excludeDefunct,
        airports: ourAirports.airports,
        byIata: ourAirports.byIata,
        countries: ourAirports.countries,
        ofAirlines,
        routes: repair.routes,
        repair,
        ofCodes,
        ofCities: ofAirports.cities,
        routeIndex,
        aircraftTypes,
        airlineIds,
        allIcaos: new Set(ourAirports.airports.keys())
    };
}

module.exports = { loadContext };
