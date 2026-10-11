import AirportController from '../airport/AirportController';
import EventBus from '../lib/EventBus';
import GameController from '../game/GameController';
import NavigationLibrary from '../navigationLibrary/NavigationLibrary';
import TimeKeeper from '../engine/TimeKeeper';
import UiController from '../ui/UiController';
import WeatherController from '../weather/WeatherController';
import { EVENT } from '../constants/eventNames';
import { GAME_OPTION_NAMES } from '../constants/gameOptionConstants';
import { AIRPORT_CONTROL_POSITION_NAME } from '../constants/airportConstants';
import { declareEmergency, declareMinimumFuel, SQUAWK } from '../aircraft/aircraftEmergency';
import { ensureAlternate, goAround } from '../aircraft/aircraftActions';
import airportIndex from '../geo/AirportIndex';
import { EVENT_CATEGORY, EVENT_DEFINITIONS } from './eventDefinitions';
import {
    getFrequencyProfile,
    sampleExponentialDelay,
    sampleFirstEventDelay
} from './eventTiming';
import { radio_altitude } from '../utilities/radioUtilities';

const MAXIMUM_PICK_ATTEMPTS = 4;
const RETRY_DELAY_SECONDS = 45;
const PENDING_REQUEST_LIFETIME_SECONDS = 600;
const MINIMUM_FUEL_ENDURANCE_MINUTES = [28, 34];
const FUEL_EMERGENCY_ENDURANCE_MINUTES = [12, 14];
const RADIO_FAILURE_DURATION_SECONDS = [240, 420];
const WAYPOINTS_AHEAD_FOR_DIRECT_REQUEST = [2, 4];

const CATEGORY_OPTION = {
    [EVENT_CATEGORY.FUEL]: GAME_OPTION_NAMES.EVENTS_FUEL,
    [EVENT_CATEGORY.MEDICAL]: GAME_OPTION_NAMES.EVENTS_MEDICAL,
    [EVENT_CATEGORY.TECHNICAL]: GAME_OPTION_NAMES.EVENTS_TECHNICAL,
    [EVENT_CATEGORY.WEATHER]: GAME_OPTION_NAMES.EVENTS_WEATHER,
    [EVENT_CATEGORY.REQUESTS]: GAME_OPTION_NAMES.EVENTS_REQUESTS,
    [EVENT_CATEGORY.TRAFFIC]: GAME_OPTION_NAMES.EVENTS_TRAFFIC
};

const randomBetween = (range, random) => range[0] + (random() * (range[1] - range[0]));

/**
 * Chooses a weighted event definition among those that are enabled and currently possible
 *
 * @function selectEvent
 * @param definitions {array}
 * @param context {object}
 * @param isCategoryEnabled {function}
 * @param process {string} `failure` or `request`
 * @return {object|null} `{ definition, selection }`
 */
export const selectEvent = (definitions, context, isCategoryEnabled, process) => {
    const remaining = definitions.filter((definition) => definition.process === process && isCategoryEnabled(definition.category));

    for (let attempt = 0; attempt < MAXIMUM_PICK_ATTEMPTS && remaining.length > 0; attempt++) {
        const totalWeight = remaining.reduce((sum, definition) => sum + definition.weight, 0);
        let roll = context.random() * totalWeight;
        let index = 0;

        for (let i = 0; i < remaining.length; i++) {
            roll -= remaining[i].weight;

            if (roll < 0) {
                index = i;

                break;
            }
        }

        const [definition] = remaining.splice(index, 1);
        const selection = definition.pick(context);

        if (selection) {
            return { definition, selection };
        }
    }

    return null;
};

const sectorFor = (aircraft) => (aircraft.isAirborne() ? AIRPORT_CONTROL_POSITION_NAME.APPROACH : AIRPORT_CONTROL_POSITION_NAME.TOWER);

const setRequest = (aircraft, type, text, extra = {}) => {
    aircraft.pendingRequest = {
        type,
        text,
        issuedAt: TimeKeeper.accumulatedDeltaTime,
        expiresAt: TimeKeeper.accumulatedDeltaTime + PENDING_REQUEST_LIFETIME_SECONDS,
        ...extra
    };
};

/**
 * Real effects of the events on the simulation
 *
 * @function buildActions
 * @param random {function}
 * @return {object}
 */
export function buildActions(random) {
    return {
        startMinimumFuel(aircraft) {
            aircraft.onboard.setEnduranceMinutes(randomBetween(MINIMUM_FUEL_ENDURANCE_MINUTES, random));
            aircraft.onboard.markReported('minimum');
            declareMinimumFuel(aircraft);
            setRequest(aircraft, 'priority', 'we are at minimum fuel and request priority handling');
        },

        startFuelEmergency(aircraft) {
            aircraft.onboard.setEnduranceMinutes(randomBetween(FUEL_EMERGENCY_ENDURANCE_MINUTES, random));
            aircraft.onboard.markReported('minimum');
            aircraft.onboard.markReported('emergency');
            declareEmergency(aircraft, 'FUEL_EMERGENCY');
            setRequest(aircraft, 'priority', 'fuel emergency, we require immediate vectors to the runway');
        },

        startEmergency(aircraft, key) {
            declareEmergency(aircraft, key);
            setRequest(aircraft, 'priority', `${aircraft.emergency.description}, we require priority handling`);
        },

        startRadioFailure(aircraft) {
            aircraft.isNordo = true;
            aircraft.nordoUntil = TimeKeeper.accumulatedDeltaTime + randomBetween(RADIO_FAILURE_DURATION_SECONDS, random);
            aircraft.emergency = {
                key: 'RADIO_FAILURE',
                level: 'COMMS',
                reason: 'radio failure',
                description: 'radio failure',
                declaredAt: TimeKeeper.accumulatedDeltaTime,
                previousSquawk: aircraft.transponderCode
            };
            aircraft.transponderCode = SQUAWK.RADIO_FAILURE;
            UiController.ui_log(`${aircraft.callsign} has stopped answering and is now squawking 7600 (radio failure)`, true);
        },

        startGoAround(aircraft, reason) {
            const [, readback] = goAround(aircraft);

            aircraft.radioCall(`going around, ${reason}, ${readback.log || readback}`, sectorFor(aircraft), true);
        },

        startDiversionRequest(aircraft, reason) {
            const alternate = ensureAlternate(aircraft);
            const entry = airportIndex.lookup(alternate);

            if (!entry) {
                return;
            }

            setRequest(aircraft, 'divert', `request diversion to ${entry.city || entry.name} (${entry.icao}) due ${reason}`, { icao: entry.icao });
            aircraft.radioCall(`request diversion to ${entry.city || entry.name} due ${reason}`, sectorFor(aircraft), true);
        },

        getFixAhead(aircraft) {
            const waypoints = aircraft.fms.waypoints || [];
            const currentName = aircraft.fms.currentWaypoint && aircraft.fms.currentWaypoint.name;
            const currentIndex = waypoints.findIndex((waypoint) => waypoint.name === currentName);

            if (currentIndex < 0) {
                return null;
            }

            const [minAhead, maxAhead] = WAYPOINTS_AHEAD_FOR_DIRECT_REQUEST;
            const candidates = waypoints
                .slice(currentIndex + minAhead, currentIndex + maxAhead + 1)
                .filter((waypoint) => !waypoint.isVectorWaypoint && /^[A-Z]{3,5}$/.test(waypoint.name) && NavigationLibrary.hasFixName(waypoint.name));

            return candidates.length > 0 ? candidates[Math.floor(random() * candidates.length)].name : null;
        },

        startDirectRequest(aircraft) {
            const fix = this.getFixAhead(aircraft);

            if (!fix) {
                return;
            }

            const spoken = NavigationLibrary.getFixSpokenName(fix) || fix;

            setRequest(aircraft, 'direct', `request direct ${fix}`, { fix });
            aircraft.radioCall(`request direct ${spoken}`, sectorFor(aircraft), false);
        },

        startAltitudeRequest(aircraft) {
            const weHaveRoom = aircraft.model.ceiling - 2000;
            const higher = random() < 0.7 && aircraft.altitude + 4000 < weHaveRoom;
            const step = (2 + Math.floor(random() * 4)) * 1000;
            const target = Math.max(3000, Math.min(weHaveRoom, aircraft.altitude + (higher ? step : -step)));
            const rounded = Math.round(target / 1000) * 1000;

            if (rounded === Math.round(aircraft.altitude / 1000) * 1000) {
                return;
            }

            setRequest(aircraft, 'altitude', `request ${higher ? 'higher' : 'lower'}, ${rounded} feet`, { altitude: rounded });
            aircraft.radioCall(`request ${higher ? 'climb' : 'descent'} to ${radio_altitude(rounded)}`, sectorFor(aircraft), false);
        },

        startRunwayRequest(aircraft) {
            const airport = AirportController.airport_get();
            const assigned = aircraft.fms.arrivalRunwayModel;
            const alternatives = (airport.runways || [])
                .reduce((all, pair) => all.concat(pair), [])
                .filter((runway) => runway.ils && runway.ils.enabled && assigned && runway.name !== assigned.name && runway.parallel !== assigned.name);

            if (alternatives.length === 0) {
                return;
            }

            const choice = alternatives[Math.floor(random() * alternatives.length)];

            setRequest(aircraft, 'runway', `request runway ${choice.name}`, { runway: choice.name });
            aircraft.radioCall(`request runway ${choice.name} if possible`, sectorFor(aircraft), false);
        }
    };
}

/**
 * Runs the random events: failures and emergencies on a schedule set by the player, and routine pilot requests
 *
 * @class EventDirector
 */
class EventDirector {
    constructor() {
        this._eventBus = EventBus;
        this._random = Math.random;
        this._aircraftController = null;
        this._secondsUntilFailure = Infinity;
        this._secondsUntilRequest = Infinity;
        this._lastFrequency = null;
        this.history = [];
    }

    /**
     * @for EventDirector
     * @method init
     * @param aircraftController {AircraftController}
     */
    init(aircraftController) {
        this._aircraftController = aircraftController;
        this._eventBus.on(EVENT.AIRPORT_CHANGE, this._onAirportChange);
        this._eventBus.on(EVENT.TRAFFIC_RESET, this._onAirportChange);
        this.reset();
    }

    reset() {
        const frequency = this._getFrequency();

        this._lastFrequency = frequency;
        this._secondsUntilFailure = sampleFirstEventDelay(frequency, this._random);
        this._secondsUntilRequest = sampleFirstEventDelay(frequency, this._random) * 0.6;
        this.history = [];
    }

    /**
     * Per-frame update
     *
     * @for EventDirector
     * @method update
     */
    update() {
        const deltaTime = TimeKeeper.getDeltaTimeForGameStateAndTimewarp();

        if (deltaTime <= 0) {
            return;
        }

        this._expirePendingRequests();

        const frequency = this._getFrequency();
        const profile = getFrequencyProfile(frequency);

        if (frequency !== this._lastFrequency) {
            // the player changed the setting: reschedule from the new mean rather than waiting out the old delay
            this._lastFrequency = frequency;
            this._secondsUntilFailure = Math.min(this._secondsUntilFailure, sampleExponentialDelay(profile.meanFailureSeconds, this._random));
        }

        this._secondsUntilFailure -= deltaTime;
        this._secondsUntilRequest -= deltaTime;

        if (this._secondsUntilFailure <= 0) {
            this._secondsUntilFailure = this._runFailure(profile) ?
                sampleExponentialDelay(profile.meanFailureSeconds, this._random) :
                RETRY_DELAY_SECONDS;
        }

        if (this._secondsUntilRequest <= 0) {
            this._secondsUntilRequest = this._runRequest() ?
                sampleExponentialDelay(profile.meanRequestSeconds, this._random) :
                RETRY_DELAY_SECONDS;
        }
    }

    /**
     * Trigger a specific event right now (debugging, scenario scripts and tests)
     *
     * @for EventDirector
     * @method trigger
     * @param eventId {string}
     * @return {boolean} whether the event could be started
     */
    trigger(eventId) {
        const definition = EVENT_DEFINITIONS.find((candidate) => candidate.id === eventId);

        if (!definition) {
            return false;
        }

        const context = this._buildContext();
        const selection = definition.pick(context);

        if (!selection) {
            return false;
        }

        this._start(definition, selection, context);

        return true;
    }

    // ------------------------------ PRIVATE ------------------------------

    _getFrequency() {
        return GameController.game.option.getOptionByName(GAME_OPTION_NAMES.FAILURE_FREQUENCY);
    }

    _isCategoryEnabled(category) {
        return GameController.game.option.getOptionByName(CATEGORY_OPTION[category]) !== 'off';
    }

    _getAircraft() {
        return this._aircraftController ? this._aircraftController.aircraft.list : [];
    }

    _countActiveEmergencies() {
        return this._getAircraft().filter((aircraft) => (
            aircraft.emergency && !aircraft.emergency.resolved && aircraft.emergency.key !== 'RADIO_FAILURE'
        )).length;
    }

    _runFailure(profile) {
        if (profile.meanFailureSeconds === Infinity || this._countActiveEmergencies() >= profile.maxActiveEmergencies) {
            return profile.meanFailureSeconds === Infinity;
        }

        const context = this._buildContext();
        const chosen = selectEvent(EVENT_DEFINITIONS, context, (category) => this._isCategoryEnabled(category), 'failure');

        if (!chosen) {
            return false;
        }

        this._start(chosen.definition, chosen.selection, context);

        return true;
    }

    _runRequest() {
        const context = this._buildContext();
        const chosen = selectEvent(EVENT_DEFINITIONS, context, (category) => this._isCategoryEnabled(category), 'request');

        if (!chosen) {
            return false;
        }

        this._start(chosen.definition, chosen.selection, context);

        return true;
    }

    _start(definition, aircraft, context) {
        definition.start(aircraft, context);
        this.history.push({ id: definition.id, callsign: aircraft.callsign, at: TimeKeeper.accumulatedDeltaTime });
        this._eventBus.trigger(EVENT.SIM_EVENT, { id: definition.id, category: definition.category, aircraft });
    }

    _expirePendingRequests() {
        const now = TimeKeeper.accumulatedDeltaTime;

        this._getAircraft().forEach((aircraft) => {
            if (aircraft.pendingRequest && aircraft.pendingRequest.expiresAt < now) {
                aircraft.pendingRequest = null;
            }
        });
    }

    _buildContext() {
        const airport = AirportController.airport_get();
        const actions = buildActions(this._random);

        return {
            aircraft: this._getAircraft(),
            weather: WeatherController.getSnapshot(),
            random: this._random,
            now: TimeKeeper.accumulatedDeltaTime,
            airportIcao: airport.icao.toUpperCase(),
            actions
        };
    }

    _onAirportChange = () => {
        this.reset();
    };
}

export default new EventDirector();
