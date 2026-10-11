import _ceil from 'lodash/ceil';
import _floor from 'lodash/floor';
import _get from 'lodash/get';
import _round from 'lodash/round';
import AirportController from '../airport/AirportController';
import airportIndex from '../geo/AirportIndex';
import AtisController from '../atis/AtisController';
import DynamicPositionModel from '../base/DynamicPositionModel';
import GameController from '../game/GameController';
import WeatherController from '../weather/WeatherController';
import { FLIGHT_PHASE, FLIGHT_CATEGORY } from '../constants/aircraftConstants';
import { GAME_OPTION_NAMES } from '../constants/gameOptionConstants';
import { INVALID_NUMBER } from '../constants/globalConstants';
import { radians_normalize } from '../math/circle';
import { vlen, vradial, vsub } from '../math/vector';
import { FUEL_POLICY } from './aircraftProfile';
import { MCP_MODE } from './ModeControl/modeControlConstants';
import { isAircraftTypeSuitableForRunwayLength } from './aircraftSuitability';
import { usesImperialUnits } from '../atis/atisGenerator';
import {
    radio_altitude,
    radio_heading,
    radio_runway
} from '../utilities/radioUtilities';
import {
    heading_to_string,
    nm,
    radiansToDegrees
} from '../utilities/unitConverters';

/**
 * Things a pilot can be asked or told to do that go beyond the basic heading/altitude/speed instructions
 * (go around, divert) and the data that describes an aircraft to the player (information panel, LLM context).
 * Kept apart from `AircraftModel` so that class does not grow further.
 */

const MISSED_APPROACH_MINIMUM_HEIGHT_FEET = 2000;
const DIVERSION_TRANSIT_ALTITUDE_FEET = 10000;
const DIVERSION_ARRIVAL_MARGIN_MINUTES = 10;
const TYPICAL_GROUND_SPEED_FACTOR = 0.9;

/**
 * Break off an approach and climb away
 *
 * Used for controller go-around instructions and for pilot-initiated go-arounds (windshear, unstable approach,
 * runway occupied...). The aircraft stops being cleared for the approach, holds the runway heading
 * (or its present heading when not yet established) and climbs to the missed approach altitude.
 *
 * @function goAround
 * @param aircraft {AircraftModel}
 * @return {array} `[success, readback]`
 */
export const goAround = (aircraft) => {
    if (!aircraft.isArrival() || aircraft.isOnGround()) {
        return [false, 'unable, we are not on an approach'];
    }

    const runway = aircraft.fms.arrivalRunwayModel;
    const referenceElevation = runway ? runway.elevation : AirportController.airport_get().elevation;
    const missedApproachAltitude = Math.max(
        _ceil(referenceElevation + MISSED_APPROACH_MINIMUM_HEIGHT_FEET, -3),
        _floor(aircraft.altitude, -3)
    );
    const climbToAltitude = Math.min(missedApproachAltitude, AirportController.airport_get().maxAssignableAltitude);
    const headingToFly = runway && aircraft.isOnFinal() ? runway.angle : aircraft.heading;
    const goAroundSpeed = Math.max(aircraft.model.speed.landing + 30, Math.min(aircraft.speed, 200));

    aircraft.pilot.hasApproachClearance = false;
    aircraft.mcp.setAltitudeFieldValue(climbToAltitude);
    aircraft.mcp.setAltitudeHold();
    aircraft.mcp.setHeadingFieldValue(headingToFly);
    aircraft.mcp.setHeadingHold();
    aircraft.mcp.setSpeedFieldValue(goAroundSpeed);
    aircraft.mcp.setSpeedHold();
    aircraft.setFlightPhase(FLIGHT_PHASE.DESCENT);

    return [true, {
        log: `going around, ${runway && aircraft.isOnFinal() ? 'runway heading' : 'present heading'}, climbing ${climbToAltitude}`,
        say: `going around, ${runway && aircraft.isOnFinal() ? 'runway heading' : 'present heading'}, climbing ${radio_altitude(climbToAltitude)}`
    }];
};

/**
 * Whether a diversion to this airport is feasible for this aircraft, with a reason when not
 *
 * @function evaluateDiversion
 * @param aircraft {AircraftModel}
 * @param destination {object} an `AirportIndex` entry
 * @return {object} `{ ok, reason, distanceNm, minutesRequired }`
 */
export const evaluateDiversion = (aircraft, destination) => {
    const airport = AirportController.airport_get();
    const target = new DynamicPositionModel([destination.lat, destination.lon], airport.positionModel, airport.magneticNorth);
    const distanceNm = nm(vlen(vsub(target.relativePosition, aircraft.relativePosition)));
    const cruiseSpeed = _get(aircraft, 'model.speed.cruise', 400);
    const minutesRequired = ((distanceNm / (cruiseSpeed * TYPICAL_GROUND_SPEED_FACTOR)) * 60) + DIVERSION_ARRIVAL_MARGIN_MINUTES;
    const result = {
        ok: true, reason: '', distanceNm, minutesRequired, target
    };

    if (destination.rwy_m && !isAircraftTypeSuitableForRunwayLength(aircraft.model, destination.rwy_m)) {
        return { ...result, ok: false, reason: `the runway at ${destination.city || destination.name} is too short for us` };
    }

    const endurance = aircraft.onboard ? aircraft.onboard.enduranceMinutes : Infinity;

    if (minutesRequired + FUEL_POLICY.FINAL_RESERVE_MINUTES > endurance) {
        const spoken = aircraft.onboard.describe().enduranceSpoken;

        return {
            ...result,
            ok: false,
            reason: `we don't have the fuel to reach ${destination.city || destination.name}, we have ${spoken} remaining`
        };
    }

    return result;
};

/**
 * Send an aircraft to another airport
 *
 * The aircraft turns toward the airport, climbs to a transit altitude and leaves the airspace. The
 * simulation then treats it as handed off (no airspace-bust penalty).
 *
 * @function divertAircraft
 * @param aircraft {AircraftModel}
 * @param destination {object} an `AirportIndex` entry
 * @param reason {string} optional, eg. "weather"
 * @return {array} `[success, readback]`
 */
export const divertAircraft = (aircraft, destination, reason = '') => {
    if (aircraft.isOnGround()) {
        return [false, 'unable, we are still on the ground'];
    }

    const evaluation = evaluateDiversion(aircraft, destination);

    if (!evaluation.ok) {
        return [false, `unable to divert, ${evaluation.reason}`];
    }

    const airport = AirportController.airport_get();
    const headingRadians = radians_normalize(vradial(vsub(evaluation.target.relativePosition, aircraft.relativePosition)));
    const headingDegrees = Math.round(radiansToDegrees(headingRadians)) || 360;
    const transitAltitude = Math.min(
        Math.max(_round(aircraft.altitude, -3), DIVERSION_TRANSIT_ALTITUDE_FEET),
        airport.maxAssignableAltitude,
        aircraft.model.ceiling
    );
    const place = destination.city || destination.name || destination.icao;

    aircraft.pilot.cancelHoldingPattern();
    aircraft.pilot.cancelApproachClearance(aircraft);
    aircraft.pilot.maintainHeading(aircraft, headingDegrees);
    aircraft.pilot.maintainAltitude(transitAltitude, false, true, airport, aircraft);
    aircraft.pilot.maintainSpeed(Math.min(250, aircraft.model.speed.max), aircraft);
    aircraft.diversion = {
        icao: destination.icao,
        iata: destination.iata,
        name: destination.name,
        city: destination.city,
        distanceNm: Math.round(evaluation.distanceNm),
        headingDegrees,
        reason
    };

    if (aircraft.flightPhase === FLIGHT_PHASE.APPROACH || aircraft.flightPhase === FLIGHT_PHASE.LANDING) {
        aircraft.setFlightPhase(FLIGHT_PHASE.DESCENT);
    }

    return [true, {
        log: `diverting to ${place} (${destination.icao}), heading ${heading_to_string(headingRadians)}, ` +
            `${Math.round(evaluation.distanceNm)} nautical miles`,
        say: `diverting to ${place}, heading ${radio_heading(heading_to_string(headingRadians))}, ` +
            `climb and maintain ${radio_altitude(transitAltitude)}`
    }];
};

/**
 * Resolve what the player typed after `divert` into an airport index entry
 *
 * @function findDiversionAirport
 * @param text {string} ICAO, IATA or part of a city or airport name
 * @return {object|null}
 */
export const findDiversionAirport = (text) => {
    const direct = airportIndex.lookup(text);

    if (direct) {
        return direct;
    }

    const [first] = airportIndex.search(text, 1);

    return first || null;
};

const PHASE_TEXT = {
    [FLIGHT_PHASE.APRON]: 'at the gate',
    [FLIGHT_PHASE.TAXI]: 'taxiing',
    [FLIGHT_PHASE.WAITING]: 'holding at the runway',
    [FLIGHT_PHASE.TAKEOFF]: 'taking off',
    [FLIGHT_PHASE.CLIMB]: 'climbing',
    [FLIGHT_PHASE.CRUISE]: 'cruising',
    [FLIGHT_PHASE.DESCENT]: 'descending',
    [FLIGHT_PHASE.APPROACH]: 'on approach',
    [FLIGHT_PHASE.LANDING]: 'on final approach'
};

const describeAirport = (icao) => {
    if (!icao) {
        return null;
    }

    const entry = airportIndex.lookup(icao);

    return entry ? {
        icao: entry.icao, iata: entry.iata, name: entry.name, city: entry.city
    } : { icao: icao.toUpperCase() };
};

/**
 * Pick a suitable alternate airport for an aircraft and remember it
 *
 * @function ensureAlternate
 * @param aircraft {AircraftModel}
 * @return {string} ICAO code, empty when no suitable airport is known
 */
export const ensureAlternate = (aircraft) => {
    if (aircraft.alternateIcao) {
        return aircraft.alternateIcao;
    }

    const airport = AirportController.airport_get();

    if (!airportIndex.isLoaded || !airport || !airport.positionModel) {
        return '';
    }

    const [candidate] = airportIndex.findNear(airport.positionModel.latitude, airport.positionModel.longitude, {
        minimumRunwayMeters: 2000,
        maximumDistanceNm: 200,
        excludeIcao: [airport.icao, aircraft.origin],
        limit: 1
    });

    aircraft.alternateIcao = candidate ? candidate.icao : '';

    return aircraft.alternateIcao;
};

/**
 * Everything the player (or the LLM) may want to know about an aircraft, in one plain object
 *
 * @function buildAircraftInfo
 * @param aircraft {AircraftModel}
 * @return {object}
 */
export const buildAircraftInfo = (aircraft) => {
    const airport = AirportController.airport_get();
    const weather = WeatherController.getSnapshot();
    const fuelUnit = GameController.game.option.getOptionByName(GAME_OPTION_NAMES.FUEL_UNITS) === 'lb' ? 'lb' : 'kg';
    const onboard = aircraft.onboard ? aircraft.onboard.describe(fuelUnit) : null;
    const imperial = usesImperialUnits(airport.icao);
    const hasAssignedAltitude = aircraft.mcp.altitude !== INVALID_NUMBER;
    const hasAssignedHeading = aircraft.mcp.headingMode === MCP_MODE.HEADING.HOLD;
    const runway = aircraft.isDeparture() ? aircraft.fms.departureRunwayModel : aircraft.fms.arrivalRunwayModel;
    const alternateIcao = ensureAlternate(aircraft);
    let qnh = null;

    if (weather) {
        qnh = imperial ? (weather.qnhHpa * 0.02953).toFixed(2) : weather.qnhHpa;
    }

    const distanceNm = nm(aircraft.distance);
    const bearing = Math.round(radiansToDegrees(aircraft.radial)) || 360;

    return {
        id: aircraft.id,
        callsign: aircraft.callsign,
        spokenCallsign: aircraft.getRadioCallsign(),
        airlineCallsign: aircraft.airlineCallsign,
        airlineId: aircraft.airlineId.toUpperCase(),
        flightNumber: aircraft.flightNumber,
        type: aircraft.model.icao,
        typeName: aircraft.model.name,
        wakeCategory: aircraft.model.weightClass,
        category: aircraft.category,
        squawk: aircraft.transponderCode,
        origin: describeAirport(aircraft.isDeparture() ? airport.icao : aircraft.origin),
        destination: describeAirport(aircraft.isDeparture() ? aircraft.destination : (aircraft.destination || airport.icao)),
        alternate: describeAirport(alternateIcao),
        route: aircraft.fms.getFullRouteStringWithoutAirportsWithSpaces(),
        nextWaypoint: _get(aircraft, 'fms.currentWaypoint.name', ''),
        runway: runway ? runway.name : '',
        phase: aircraft.flightPhase,
        phaseText: PHASE_TEXT[aircraft.flightPhase] || aircraft.flightPhase,
        isControllable: aircraft.isControllable,
        isAirborne: aircraft.isAirborne(),
        altitude: Math.round(aircraft.altitude),
        assignedAltitude: hasAssignedAltitude ? Math.round(aircraft.mcp.altitude) : null,
        verticalTrend: aircraft.trend,
        heading: Number(heading_to_string(aircraft.heading)),
        assignedHeading: hasAssignedHeading ? Number(heading_to_string(aircraft.mcp.heading)) : null,
        speed: Math.round(aircraft.speed),
        groundSpeed: Math.round(aircraft.groundSpeed),
        assignedSpeed: aircraft.mcp.speedMode === MCP_MODE.SPEED.HOLD ? Math.round(aircraft.mcp.speed) : null,
        distanceFromAirportNm: Math.round(distanceNm * 10) / 10,
        bearingFromAirport: bearing,
        hasApproachClearance: Boolean(aircraft.pilot.hasApproachClearance),
        hasDepartureClearance: Boolean(aircraft.pilot.hasDepartureClearance),
        onboard,
        emergency: aircraft.emergency && !aircraft.emergency.resolved ?
            { level: aircraft.emergency.level, reason: aircraft.emergency.reason } :
            null,
        isNordo: aircraft.isNordo,
        diversion: aircraft.diversion,
        pendingRequest: aircraft.pendingRequest,
        qnh,
        qnhUnit: imperial ? 'inHg' : 'hPa',
        atisLetterHeard: aircraft.atisLetterHeard,
        currentAtisLetter: AtisController.getCurrent() ? AtisController.getCurrent().letter : '',
        isArrival: aircraft.category === FLIGHT_CATEGORY.ARRIVAL,
        isDeparture: aircraft.category === FLIGHT_CATEGORY.DEPARTURE
    };
};

/**
 * Helper for phrasing runway names consistently in pilot replies
 *
 * @function spokenRunwayName
 * @param aircraft {AircraftModel}
 * @return {string}
 */
export const spokenRunwayName = (aircraft) => {
    const runway = aircraft.isDeparture() ? aircraft.fms.departureRunwayModel : aircraft.fms.arrivalRunwayModel;

    return runway ? radio_runway(runway.name) : '';
};
