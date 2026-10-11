import AirportController from '../airport/AirportController';
import EventBus from '../lib/EventBus';
import GameController, { GAME_EVENTS } from '../game/GameController';
import TimeKeeper from '../engine/TimeKeeper';
import UiController from '../ui/UiController';
import { speech_say } from '../speech';
import { EVENT } from '../constants/eventNames';
import { FUEL_STATE } from './OnboardState';

/**
 * Emergency and abnormal-situation behaviour for aircraft
 *
 * Phraseology follows ICAO / UK CAP 413: a MAYDAY is spoken three times and states the callsign, nature of the
 * emergency, intentions and souls on board; a PAN PAN states the same without the distress prefix. Aircraft that
 * declare a MAYDAY select 7700 on their transponder. The text is generated here so every part of the
 * simulation (fuel burn, random failures, LLM-driven pilots) declares emergencies in one consistent way.
 */

export const EMERGENCY_LEVEL = {
    PAN: 'PAN PAN',
    MAYDAY: 'MAYDAY'
};

export const SQUAWK = {
    EMERGENCY: '7700',
    RADIO_FAILURE: '7600'
};

/**
 * Catalogue of emergencies. `request` is what the pilot asks for, phrased so that the player knows
 * which instruction resolves it.
 *
 * - `effects(aircraft)` applies the lasting consequence to the aircraft (reduced performance, forced descent)
 *
 * @property EMERGENCY_TYPES
 * @type {object}
 * @final
 */
export const EMERGENCY_TYPES = {
    FUEL_EMERGENCY: {
        level: EMERGENCY_LEVEL.MAYDAY,
        reason: 'fuel',
        description: 'fuel emergency',
        request: 'request immediate vectors to the nearest suitable runway'
    },
    ENGINE_FAILURE: {
        level: EMERGENCY_LEVEL.MAYDAY,
        reason: 'engine failure',
        description: 'engine failure',
        request: 'request vectors for an immediate return and the nearest runway, fire services to be on standby',
        effects: (aircraft) => {
            aircraft.performance.climb = 0.45;
            aircraft.performance.descent = 0.9;
            aircraft.performance.maxSpeed = 250;
        }
    },
    SMOKE: {
        level: EMERGENCY_LEVEL.MAYDAY,
        reason: 'smoke in the cockpit',
        description: 'smoke in the cockpit',
        request: 'request immediate descent and the shortest vectors for landing, fire services to be on standby'
    },
    PRESSURISATION: {
        level: EMERGENCY_LEVEL.MAYDAY,
        reason: 'loss of pressurisation',
        description: 'loss of pressurisation',
        request: 'commencing emergency descent to ten thousand feet',
        effects: (aircraft) => {
            if (aircraft.altitude > 10000) {
                aircraft.pilot.maintainAltitude(10000, true, false, AirportController.airport_get(), aircraft);
            }
        }
    },
    MEDICAL: {
        level: EMERGENCY_LEVEL.PAN,
        reason: 'medical',
        description: 'medical emergency',
        request: 'a passenger is seriously unwell, request priority landing and ambulance on arrival'
    },
    UNRULY_PASSENGER: {
        level: EMERGENCY_LEVEL.PAN,
        reason: 'unruly passenger',
        description: 'unruly passenger',
        request: 'we have a disruptive passenger, request priority landing and police on arrival'
    },
    BIRD_STRIKE: {
        level: EMERGENCY_LEVEL.PAN,
        reason: 'bird strike',
        description: 'bird strike',
        request: 'we have suffered a bird strike and would like to return to land, no immediate difficulty',
        effects: (aircraft) => {
            aircraft.performance.climb = 0.8;
        }
    }
};

const sectorFor = (aircraft) => (aircraft.isAirborne() ? 'app' : 'twr');

const buildUnitName = (aircraft) => {
    const radio = AirportController.airport_get().radio || {};

    return radio[sectorFor(aircraft)] || radio.app || '';
};

/**
 * Compose the declaration a pilot would make
 *
 * @function buildDeclarationText
 * @param aircraft {AircraftModel}
 * @param type {object} an entry of `EMERGENCY_TYPES`
 * @return {object} `{ written, spoken }`
 */
export const buildDeclarationText = (aircraft, type) => {
    const unit = buildUnitName(aircraft);
    const { callsign } = aircraft;
    const spokenCallsign = aircraft.getRadioCallsign();
    const repeated = type.level === EMERGENCY_LEVEL.MAYDAY ? 'MAYDAY MAYDAY MAYDAY' : 'PAN PAN, PAN PAN, PAN PAN';
    const souls = aircraft.onboard ? `${aircraft.onboard.souls} souls on board` : '';
    const endurance = aircraft.onboard && aircraft.onboard.enduranceMinutes > 0 ?
        `${aircraft.onboard.describe().enduranceSpoken} of fuel remaining` :
        '';
    const details = [type.description, type.request, endurance, souls].filter(Boolean).join(', ');

    return {
        written: `${repeated}, ${unit}, ${callsign}, ${details}`,
        spoken: `${repeated}, ${unit}, ${spokenCallsign}, ${details}`
    };
};

/**
 * Put an aircraft into an emergency
 *
 * @function declareEmergency
 * @param aircraft {AircraftModel}
 * @param typeKey {string} key of `EMERGENCY_TYPES`
 * @return {boolean} false when the aircraft is already in a (worse or equal) emergency
 */
export const declareEmergency = (aircraft, typeKey) => {
    const type = EMERGENCY_TYPES[typeKey];

    if (!type || aircraft.projected) {
        return false;
    }

    if (aircraft.emergency && aircraft.emergency.level === EMERGENCY_LEVEL.MAYDAY) {
        return false;
    }

    const declaration = buildDeclarationText(aircraft, type);
    const isMayday = type.level === EMERGENCY_LEVEL.MAYDAY;

    aircraft.emergency = {
        key: typeKey,
        level: type.level,
        reason: type.reason,
        description: type.description,
        declaredAt: TimeKeeper.accumulatedDeltaTime,
        previousSquawk: aircraft.transponderCode
    };

    if (isMayday) {
        aircraft.transponderCode = SQUAWK.EMERGENCY;
    }

    if (type.effects) {
        type.effects(aircraft);
    }

    UiController.ui_log(declaration.written, true);
    speech_say([{ type: 'text', content: declaration.spoken }], aircraft.pilotVoice);
    EventBus.trigger(EVENT.EMERGENCY_DECLARED, aircraft, aircraft.emergency);

    return true;
};

/**
 * "Minimum fuel" is an advisory, not a distress call: the pilot is telling ATC that any undue delay may
 * result in an emergency
 *
 * @function declareMinimumFuel
 * @param aircraft {AircraftModel}
 */
export const declareMinimumFuel = (aircraft) => {
    if (aircraft.projected || aircraft.emergency) {
        return;
    }

    const unit = buildUnitName(aircraft);
    const endurance = aircraft.onboard.describe().enduranceSpoken;
    const written = `${unit}, ${aircraft.callsign}, minimum fuel, ${endurance} remaining, request direct routing or priority`;
    const spoken = `${unit}, ${aircraft.getRadioCallsign()}, minimum fuel, ${endurance} remaining, request direct routing or priority`;

    aircraft.emergency = {
        key: 'MINIMUM_FUEL',
        level: 'ADVISORY',
        reason: 'minimum fuel',
        description: 'minimum fuel',
        declaredAt: TimeKeeper.accumulatedDeltaTime,
        previousSquawk: aircraft.transponderCode
    };

    UiController.ui_log(written, true);
    speech_say([{ type: 'text', content: spoken }], aircraft.pilotVoice);
    EventBus.trigger(EVENT.EMERGENCY_DECLARED, aircraft, aircraft.emergency);
};

/**
 * Fuel has run out
 *
 * @function handleFuelExhausted
 * @param aircraft {AircraftModel}
 */
export const handleFuelExhausted = (aircraft) => {
    if (aircraft.projected || aircraft.hit) {
        return;
    }

    if (aircraft.isOnGround()) {
        return;
    }

    aircraft.hit = true;
    UiController.ui_log(`${aircraft.callsign} has run out of fuel and crashed`, true);
    speech_say([
        { type: 'callsign', content: aircraft },
        { type: 'text', content: ', engines flamed out, we have no fuel, going down' }
    ], aircraft.pilotVoice);
    GameController.events_recordNew(GAME_EVENTS.FUEL_EXHAUSTION);
};

/**
 * React to a fuel state that the aircraft has just reached
 *
 * @function handleFuelStateReached
 * @param aircraft {AircraftModel}
 * @param state {string} one of `FUEL_STATE`
 */
export const handleFuelStateReached = (aircraft, state) => {
    if (aircraft.projected || !aircraft.isAirborne()) {
        return;
    }

    switch (state) {
        case FUEL_STATE.MINIMUM:
            declareMinimumFuel(aircraft);

            break;
        case FUEL_STATE.EMERGENCY:
            declareEmergency(aircraft, 'FUEL_EMERGENCY');

            break;
        case FUEL_STATE.EXHAUSTED:
            handleFuelExhausted(aircraft);

            break;
        default:
            break;
    }
};

/**
 * Called when an aircraft with an active emergency lands or leaves the airspace safely
 *
 * @function resolveEmergency
 * @param aircraft {AircraftModel}
 */
export const resolveEmergency = (aircraft) => {
    if (!aircraft.emergency || aircraft.emergency.resolved || aircraft.projected) {
        return;
    }

    aircraft.emergency.resolved = true;

    if (aircraft.emergency.level !== 'ADVISORY') {
        GameController.events_recordNew(GAME_EVENTS.EMERGENCY_HANDLED);
    }

    if (aircraft.transponderCode === SQUAWK.EMERGENCY && aircraft.emergency.previousSquawk) {
        aircraft.transponderCode = aircraft.emergency.previousSquawk;
    }
};
