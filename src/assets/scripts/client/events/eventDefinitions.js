import { FLIGHT_PHASE } from '../constants/aircraftConstants';

/**
 * The catalogue of random events
 *
 * Each definition has:
 * - `id`, `category` (one of the "Failures and events" options), `weight` (relative likelihood)
 * - `process`: `failure` events follow the failure frequency setting, `request` events follow the request cadence
 * - `pick(context)`: choose a suitable aircraft (and anything else needed) or return `null` when the event cannot
 *   happen right now. Pure, so it can be unit tested with plain objects.
 * - `start(selection, context)`: carry the event out (declare the emergency, send the aircraft around, etc.)
 *
 * `context` provides `aircraft` (list), `weather`, `random`, `now`, `airportIcao` and the `actions` object
 * (so tests can supply stubs instead of the real simulation).
 */

export const EVENT_CATEGORY = {
    FUEL: 'fuel',
    MEDICAL: 'medical',
    TECHNICAL: 'technical',
    WEATHER: 'weather',
    REQUESTS: 'requests',
    TRAFFIC: 'traffic'
};

const isAirborneAndControllable = (aircraft) => Boolean(
    aircraft.isControllable && aircraft.isAirborne() && !aircraft.hit && !aircraft.isNordo && !aircraft.diversion
);

/**
 * Distance of an aircraft from the airport, in nautical miles (the aircraft model keeps kilometres)
 *
 * @function distanceNm
 * @param aircraft {AircraftModel}
 * @return {number}
 */
export const distanceNm = (aircraft) => aircraft.distance / 1.852;

const hasActiveEmergency = (aircraft) => Boolean(aircraft.emergency && !aircraft.emergency.resolved);

const isOnApproach = (aircraft) => aircraft.flightPhase === FLIGHT_PHASE.APPROACH || aircraft.flightPhase === FLIGHT_PHASE.LANDING;

const choose = (list, random) => (list.length === 0 ? null : list[Math.floor(random() * list.length)]);

const inboundCandidates = (context) => context.aircraft.filter((aircraft) => (
    isAirborneAndControllable(aircraft) &&
    aircraft.isArrival() &&
    !hasActiveEmergency(aircraft) &&
    !isOnApproach(aircraft) &&
    distanceNm(aircraft) > 8
));

const airborneCandidates = (context) => context.aircraft.filter((aircraft) => (
    isAirborneAndControllable(aircraft) && !hasActiveEmergency(aircraft) && !isOnApproach(aircraft)
));

const FINAL_APPROACH_CANDIDATE_MAX_DISTANCE_NM = 6;

const finalApproachCandidates = (context) => context.aircraft.filter((aircraft) => (
    isAirborneAndControllable(aircraft) &&
    aircraft.isArrival() &&
    !hasActiveEmergency(aircraft) &&
    isOnApproach(aircraft) &&
    distanceNm(aircraft) <= FINAL_APPROACH_CANDIDATE_MAX_DISTANCE_NM &&
    aircraft.altitude > 600
));

const isBadWeather = (weather) => Boolean(weather) && (
    weather.visibilityMeters < 1500 ||
    weather.phenomena.some((code) => /TS/.test(code)) ||
    (weather.ceilingFeet !== null && weather.ceilingFeet < 300)
);

const isTurbulentWeather = (weather) => Boolean(weather) && (
    Boolean(weather.windGust && weather.windGust >= 22) || weather.phenomena.some((code) => /TS/.test(code))
);

export const EVENT_DEFINITIONS = [
    {
        id: 'LOW_FUEL',
        category: EVENT_CATEGORY.FUEL,
        process: 'failure',
        weight: 5,
        pick: (context) => {
            const candidates = inboundCandidates(context).filter((aircraft) => aircraft.onboard.enduranceMinutes > 45);

            return choose(candidates, context.random);
        },
        start: (aircraft, context) => context.actions.startMinimumFuel(aircraft)
    },
    {
        id: 'FUEL_EMERGENCY',
        category: EVENT_CATEGORY.FUEL,
        process: 'failure',
        weight: 1,
        pick: (context) => choose(inboundCandidates(context).filter((aircraft) => aircraft.onboard.enduranceMinutes > 30), context.random),
        start: (aircraft, context) => context.actions.startFuelEmergency(aircraft)
    },
    {
        id: 'MEDICAL',
        category: EVENT_CATEGORY.MEDICAL,
        process: 'failure',
        weight: 4,
        pick: (context) => choose(
            context.aircraft.filter((aircraft) => (
                isAirborneAndControllable(aircraft) &&
                !hasActiveEmergency(aircraft) &&
                aircraft.onboard.passengers > 20 &&
                !isOnApproach(aircraft) &&
                (aircraft.isArrival() || aircraft.altitude < 12000)
            )),
            context.random
        ),
        start: (aircraft, context) => context.actions.startEmergency(aircraft, context.random() < 0.7 ? 'MEDICAL' : 'UNRULY_PASSENGER')
    },
    {
        id: 'ENGINE_FAILURE',
        category: EVENT_CATEGORY.TECHNICAL,
        process: 'failure',
        weight: 2,
        pick: (context) => choose(
            airborneCandidates(context).filter((aircraft) => aircraft.model.engines.number >= 2),
            context.random
        ),
        start: (aircraft, context) => context.actions.startEmergency(aircraft, 'ENGINE_FAILURE')
    },
    {
        id: 'SMOKE',
        category: EVENT_CATEGORY.TECHNICAL,
        process: 'failure',
        weight: 1,
        pick: (context) => choose(inboundCandidates(context), context.random),
        start: (aircraft, context) => context.actions.startEmergency(aircraft, 'SMOKE')
    },
    {
        id: 'PRESSURISATION',
        category: EVENT_CATEGORY.TECHNICAL,
        process: 'failure',
        weight: 1,
        pick: (context) => choose(airborneCandidates(context).filter((aircraft) => aircraft.altitude > 13000), context.random),
        start: (aircraft, context) => context.actions.startEmergency(aircraft, 'PRESSURISATION')
    },
    {
        id: 'BIRD_STRIKE',
        category: EVENT_CATEGORY.TECHNICAL,
        process: 'failure',
        weight: 3,
        pick: (context) => choose(
            airborneCandidates(context).filter((aircraft) => aircraft.isDeparture() && aircraft.altitude < 4000),
            context.random
        ),
        start: (aircraft, context) => context.actions.startEmergency(aircraft, 'BIRD_STRIKE')
    },
    {
        id: 'RADIO_FAILURE',
        category: EVENT_CATEGORY.TECHNICAL,
        process: 'failure',
        weight: 2,
        pick: (context) => choose(
            airborneCandidates(context).filter((aircraft) => distanceNm(aircraft) > 5),
            context.random
        ),
        start: (aircraft, context) => context.actions.startRadioFailure(aircraft)
    },
    {
        id: 'WINDSHEAR_GO_AROUND',
        category: EVENT_CATEGORY.WEATHER,
        process: 'failure',
        weight: 6,
        pick: (context) => (isTurbulentWeather(context.weather) ? choose(finalApproachCandidates(context), context.random) : null),
        start: (aircraft, context) => context.actions.startGoAround(aircraft, 'windshear on final')
    },
    {
        id: 'WEATHER_DIVERSION_REQUEST',
        category: EVENT_CATEGORY.WEATHER,
        process: 'failure',
        weight: 4,
        pick: (context) => (isBadWeather(context.weather) ? choose(inboundCandidates(context), context.random) : null),
        start: (aircraft, context) => context.actions.startDiversionRequest(aircraft, 'weather')
    },
    {
        id: 'OPERATIONAL_GO_AROUND',
        category: EVENT_CATEGORY.TRAFFIC,
        process: 'failure',
        weight: 3,
        pick: (context) => choose(finalApproachCandidates(context), context.random),
        start: (aircraft, context) => context.actions.startGoAround(
            aircraft,
            choose(['runway occupied', 'unstable approach', 'birds on the runway', 'vehicle on the runway'], context.random)
        )
    },
    {
        id: 'REQUEST_DIRECT',
        category: EVENT_CATEGORY.REQUESTS,
        process: 'request',
        weight: 5,
        pick: (context) => {
            const candidates = airborneCandidates(context)
                .filter((aircraft) => !aircraft.pendingRequest && context.actions.getFixAhead(aircraft));

            return choose(candidates, context.random);
        },
        start: (aircraft, context) => context.actions.startDirectRequest(aircraft)
    },
    {
        id: 'REQUEST_ALTITUDE',
        category: EVENT_CATEGORY.REQUESTS,
        process: 'request',
        weight: 3,
        pick: (context) => choose(
            airborneCandidates(context).filter((aircraft) => (
                !aircraft.pendingRequest && !aircraft.isArrival() && aircraft.altitude > 3000
            )),
            context.random
        ),
        start: (aircraft, context) => context.actions.startAltitudeRequest(aircraft)
    },
    {
        id: 'REQUEST_RUNWAY',
        category: EVENT_CATEGORY.REQUESTS,
        process: 'request',
        weight: 1,
        pick: (context) => choose(inboundCandidates(context).filter((aircraft) => !aircraft.pendingRequest), context.random),
        start: (aircraft, context) => context.actions.startRunwayRequest(aircraft)
    }
];
