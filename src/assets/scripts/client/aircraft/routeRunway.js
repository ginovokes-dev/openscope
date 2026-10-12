import AirportController from '../airport/AirportController';
import NavigationLibrary from '../navigationLibrary/NavigationLibrary';
import { FLIGHT_CATEGORY } from '../constants/aircraftConstants';

const RUNWAY_TOKEN = /^([A-Z]{4})(\d{1,2}[LRC]?)$/;

/**
 * Spawn routes name a runway (`WBA.WBA2I.EGGP27`, `EGGP27.WBA3D.WBA`) because the procedure's legs depend on it.
 * When the active runway is not the one in the route, use the same procedure to the active runway instead, as long as
 * the procedure is published for it. This is what lets the ATIS change the runway in use at an airport.
 *
 * @function adaptRouteToActiveRunway
 * @param routeString {string}
 * @param category {string} 'arrival' or 'departure'
 * @return {string} the route to give the aircraft
 */
export const adaptRouteToActiveRunway = (routeString, category) => {
    const airport = AirportController.airport_get();
    const tokens = String(routeString).split('.');
    const isArrival = category === FLIGHT_CATEGORY.ARRIVAL;
    const isDeparture = category === FLIGHT_CATEGORY.DEPARTURE;

    if (!airport || (!isArrival && !isDeparture)) {
        return routeString;
    }

    const runwayIndex = isArrival ? tokens.length - 1 : 0;
    const procedureIndex = isArrival ? tokens.length - 2 : 1;
    const match = RUNWAY_TOKEN.exec(tokens[runwayIndex] || '');
    const activeRunway = isArrival ? airport.arrivalRunwayModel : airport.departureRunwayModel;

    if (!match || !activeRunway || match[1] !== airport.icao.toUpperCase() || match[2] === activeRunway.name) {
        return routeString;
    }

    const procedureId = tokens[procedureIndex];

    if (!procedureId || !NavigationLibrary.hasProcedure(procedureId)) {
        return routeString;
    }

    const procedure = NavigationLibrary.getProcedure(procedureId);
    const newToken = `${match[1]}${activeRunway.name}`;
    const isPublished = isArrival ? procedure.hasExit(newToken) : procedure.hasEntry(newToken);

    if (!isPublished) {
        return routeString;
    }

    const adapted = tokens.slice();

    adapted[runwayIndex] = newToken;

    return adapted.join('.');
};

/**
 * Whether every spawn route can be flown to or from every runway of the airport
 *
 * @function areAllRoutesRunwayIndependent
 * @param routeStrings {array<string>}
 * @param runwayNames {array<string>}
 * @return {boolean}
 */
export const areAllRoutesRunwayIndependent = (routeStrings, runwayNames) => {
    const airport = AirportController.airport_get();
    const icao = airport.icao.toUpperCase();

    return routeStrings.every((routeString) => {
        const tokens = String(routeString).split('.');
        const arrivalToken = RUNWAY_TOKEN.exec(tokens[tokens.length - 1] || '');
        const departureToken = RUNWAY_TOKEN.exec(tokens[0] || '');

        if (arrivalToken && arrivalToken[1] === icao) {
            const procedureId = tokens[tokens.length - 2];

            return Boolean(procedureId) && NavigationLibrary.hasProcedure(procedureId) &&
                runwayNames.every((name) => NavigationLibrary.getProcedure(procedureId).hasExit(`${icao}${name}`));
        }

        if (departureToken && departureToken[1] === icao) {
            const procedureId = tokens[1];

            return Boolean(procedureId) && NavigationLibrary.hasProcedure(procedureId) &&
                runwayNames.every((name) => NavigationLibrary.getProcedure(procedureId).hasEntry(`${icao}${name}`));
        }

        return true;
    });
};
