import GameController from '../game/GameController';
import { GAME_OPTION_NAMES } from '../constants/gameOptionConstants';

/**
 * How busy the airport is
 *
 * The rates in the airport files are for a busy session; the level scales them. `maximumArrivals` is the most arrivals
 * that are allowed in the airspace at once, so a burst of random spawns never floods the scope, and
 * `minimumArrivalGapSeconds` is the least time between two new arrivals appearing (on any route), and
 * `maximumWaitingDepartures` is how many departures may be waiting at the stands for a clearance at once.
 *
 * @property TRAFFIC_LEVELS
 * @type {object}
 * @final
 */
export const TRAFFIC_LEVELS = {
    quiet: {
        multiplier: 0.3, maximumArrivals: 4, minimumArrivalGapSeconds: 120, maximumWaitingDepartures: 2
    },
    medium: {
        multiplier: 0.6, maximumArrivals: 7, minimumArrivalGapSeconds: 75, maximumWaitingDepartures: 3
    },
    busy: {
        multiplier: 1, maximumArrivals: 12, minimumArrivalGapSeconds: 45, maximumWaitingDepartures: 5
    },
    rush: {
        multiplier: 1.5, maximumArrivals: 18, minimumArrivalGapSeconds: 30, maximumWaitingDepartures: 8
    }
};

export const DEFAULT_TRAFFIC_LEVEL = 'medium';

// the app switches the levels on at start-up; until then (unit tests) the airport files' own rates are used unchanged
let areLevelsActive = false;

/**
 * @function activateTrafficLevels
 */
export const activateTrafficLevels = () => {
    areLevelsActive = true;
};

/**
 * Settings for the current traffic level
 *
 * Until `activateTrafficLevels()` is called (unit tests) the airport files' own rates are used unchanged.
 *
 * @function getTrafficLevel
 * @return {object} `{ name, multiplier, maximumArrivals, minimumArrivalGapSeconds, maximumWaitingDepartures }`
 */
export const getTrafficLevel = () => {
    let name = null;

    try {
        name = areLevelsActive && GameController.game ? GameController.getGameOption(GAME_OPTION_NAMES.TRAFFIC_LEVEL) : null;
    } catch (error) {
        name = null;
    }

    if (!name) {
        return {
            name: 'unscaled', multiplier: 1, maximumArrivals: Infinity, minimumArrivalGapSeconds: 0, maximumWaitingDepartures: Infinity
        };
    }

    return { name, ...(TRAFFIC_LEVELS[name] || TRAFFIC_LEVELS[DEFAULT_TRAFFIC_LEVEL]) };
};
