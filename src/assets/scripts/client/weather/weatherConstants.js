/**
 * Constants for the weather engine and the ATIS generator
 *
 * Weather is modelled as a sequence of "regimes" (clear, showers, fog, thunderstorms...). Each regime
 * has numeric ranges that are sampled when it begins; surface wind, visibility, cloud, QNH and
 * temperature then ease toward those targets. How often regimes change, and how severe they may
 * become, is governed by the player's `weatherVariability` game option.
 */

/**
 * @property WEATHER_VARIABILITY
 * @type {object}
 * @final
 */
export const WEATHER_VARIABILITY = {
    STATIC: 'static',
    CALM: 'calm',
    NORMAL: 'normal',
    LIVELY: 'lively',
    SEVERE: 'severe'
};

/**
 * @property WEATHER_REGIME
 * @type {object}
 * @final
 */
export const WEATHER_REGIME = {
    CAVOK: 'CAVOK',
    FAIR: 'FAIR',
    CLOUDY: 'CLOUDY',
    SHOWERS: 'SHOWERS',
    RAIN: 'RAIN',
    LOW_CLOUD: 'LOW_CLOUD',
    THUNDERSTORM: 'THUNDERSTORM',
    FOG: 'FOG',
    SNOW: 'SNOW'
};

/**
 * Per-variability behaviour
 *
 * - `maxSeverity`: the most severe regime that can occur (indexes `REGIME_SEVERITY`)
 * - `meanMinutes`: average regime duration in simulated minutes
 * - `directionDriftDegreesPerMinute`: sigma of the wind direction random walk
 * - `frontShiftDegrees`: sigma of the wind shift applied when the regime changes
 *
 * @property VARIABILITY_PROFILE
 * @type {object}
 * @final
 */
export const VARIABILITY_PROFILE = {
    [WEATHER_VARIABILITY.STATIC]: {
        maxSeverity: 0, meanMinutes: Infinity, directionDriftDegreesPerMinute: 0, frontShiftDegrees: 0
    },
    [WEATHER_VARIABILITY.CALM]: {
        maxSeverity: 2, meanMinutes: 90, directionDriftDegreesPerMinute: 0.8, frontShiftDegrees: 20
    },
    [WEATHER_VARIABILITY.NORMAL]: {
        maxSeverity: 4, meanMinutes: 55, directionDriftDegreesPerMinute: 1.5, frontShiftDegrees: 40
    },
    [WEATHER_VARIABILITY.LIVELY]: {
        maxSeverity: 6, meanMinutes: 35, directionDriftDegreesPerMinute: 2.5, frontShiftDegrees: 65
    },
    [WEATHER_VARIABILITY.SEVERE]: {
        maxSeverity: 8, meanMinutes: 22, directionDriftDegreesPerMinute: 3.5, frontShiftDegrees: 90
    }
};

/**
 * Regimes ordered from benign to severe. Used with `maxSeverity` to cap what can occur.
 *
 * @property REGIME_SEVERITY
 * @type {array<string>}
 * @final
 */
export const REGIME_SEVERITY = [
    WEATHER_REGIME.CAVOK,
    WEATHER_REGIME.FAIR,
    WEATHER_REGIME.CLOUDY,
    WEATHER_REGIME.SHOWERS,
    WEATHER_REGIME.RAIN,
    WEATHER_REGIME.LOW_CLOUD,
    WEATHER_REGIME.THUNDERSTORM,
    WEATHER_REGIME.SNOW,
    WEATHER_REGIME.FOG
];

/**
 * Regime definitions
 *
 * - `wind`: [min, max] mean surface wind in knots
 * - `gustChance`: probability that the wind is gusty while the regime lasts
 * - `visibility`: [min, max] metres
 * - `cloud`: candidate layers `[cover, [minBaseFt, maxBaseFt], type?]`. One of each listed layer is generated.
 * - `phenomena`: weather codes from which one is chosen (empty = none)
 * - `qnhShift`: hPa shift of the target pressure relative to the long-term mean
 * - `dewpointSpread`: [min, max] degrees C between temperature and dewpoint
 * - `neighbours`: weighted next regimes
 *
 * @property REGIME_DEFINITION
 * @type {object}
 * @final
 */
export const REGIME_DEFINITION = {
    [WEATHER_REGIME.CAVOK]: {
        label: 'clear',
        wind: [2, 11],
        gustChance: 0.05,
        visibility: [9999, 9999],
        cloud: [],
        phenomena: [],
        qnhShift: 5,
        dewpointSpread: [4, 10],
        neighbours: { FAIR: 5, CLOUDY: 1 }
    },
    [WEATHER_REGIME.FAIR]: {
        label: 'fair',
        wind: [4, 14],
        gustChance: 0.15,
        visibility: [9999, 9999],
        cloud: [['FEW', [2500, 5000]], ['SCT', [3500, 6500]]],
        phenomena: [],
        qnhShift: 2,
        dewpointSpread: [3, 8],
        neighbours: { CAVOK: 3, CLOUDY: 4, SHOWERS: 1 }
    },
    [WEATHER_REGIME.CLOUDY]: {
        label: 'cloudy',
        wind: [6, 18],
        gustChance: 0.3,
        visibility: [9000, 9999],
        cloud: [['SCT', [1800, 3000]], ['BKN', [3000, 5500]]],
        phenomena: [],
        qnhShift: -1,
        dewpointSpread: [2, 5],
        neighbours: {
            FAIR: 3, SHOWERS: 3, RAIN: 2, LOW_CLOUD: 1
        }
    },
    [WEATHER_REGIME.SHOWERS]: {
        label: 'showers',
        wind: [8, 22],
        gustChance: 0.55,
        visibility: [4500, 8000],
        cloud: [['SCT', [1500, 2500]], ['BKN', [2500, 3500]]],
        phenomena: ['-SHRA', 'SHRA'],
        qnhShift: -3,
        dewpointSpread: [1, 3],
        neighbours: {
            CLOUDY: 4, FAIR: 2, RAIN: 2, THUNDERSTORM: 1
        }
    },
    [WEATHER_REGIME.RAIN]: {
        label: 'rain',
        wind: [8, 20],
        gustChance: 0.4,
        visibility: [3000, 7000],
        cloud: [['BKN', [1000, 1800]], ['OVC', [1800, 3000]]],
        phenomena: ['-RA', 'RA', 'RA'],
        qnhShift: -6,
        dewpointSpread: [0, 2],
        neighbours: {
            CLOUDY: 4, SHOWERS: 2, LOW_CLOUD: 2, THUNDERSTORM: 1
        }
    },
    [WEATHER_REGIME.LOW_CLOUD]: {
        label: 'low cloud and mist',
        wind: [2, 9],
        gustChance: 0.05,
        visibility: [1500, 4500],
        cloud: [['BKN', [300, 600]], ['OVC', [500, 900]]],
        phenomena: ['BR'],
        qnhShift: 0,
        dewpointSpread: [0, 2],
        neighbours: { CLOUDY: 3, RAIN: 2, FOG: 2 }
    },
    [WEATHER_REGIME.THUNDERSTORM]: {
        label: 'thunderstorms',
        wind: [12, 28],
        gustChance: 0.95,
        visibility: [2500, 6000],
        cloud: [['SCT', [1500, 2200], 'CB'], ['BKN', [2200, 3200], 'CB']],
        phenomena: ['TSRA', 'TSRA', '+TSRA'],
        qnhShift: -9,
        dewpointSpread: [0, 2],
        neighbours: { SHOWERS: 4, RAIN: 3, CLOUDY: 2 }
    },
    [WEATHER_REGIME.SNOW]: {
        label: 'snow',
        wind: [6, 16],
        gustChance: 0.3,
        visibility: [800, 3000],
        cloud: [['BKN', [600, 1200]], ['OVC', [1000, 1800]]],
        phenomena: ['-SN', 'SN'],
        qnhShift: -5,
        dewpointSpread: [0, 1],
        neighbours: { CLOUDY: 3, LOW_CLOUD: 2, RAIN: 1 }
    },
    [WEATHER_REGIME.FOG]: {
        label: 'fog',
        wind: [0, 4],
        gustChance: 0,
        visibility: [150, 800],
        cloud: [['VV', [100, 200]]],
        phenomena: ['FG'],
        qnhShift: 4,
        dewpointSpread: [0, 1],
        neighbours: { LOW_CLOUD: 4, CLOUDY: 2, FAIR: 1 }
    }
};

/**
 * Temperature and pressure behaviour
 *
 * @property CLIMATE
 * @type {object}
 * @final
 */
export const CLIMATE = {
    MEAN_QNH_HPA: 1013,
    MIN_QNH_HPA: 985,
    MAX_QNH_HPA: 1038,
    QNH_RELAXATION_MINUTES: 90
};

/**
 * Seconds of simulated time between weather evolution steps
 *
 * @property WEATHER_STEP_SECONDS
 * @type {number}
 * @final
 */
export const WEATHER_STEP_SECONDS = 30;

/**
 * Minutes over which a regime change blends in
 *
 * @property REGIME_BLEND_MINUTES
 * @type {number}
 * @final
 */
export const REGIME_BLEND_MINUTES = 12;

/**
 * Minutes' notice given in the ATIS trend for an upcoming regime change
 *
 * @property TREND_LOOKAHEAD_MINUTES
 * @type {number}
 * @final
 */
export const TREND_LOOKAHEAD_MINUTES = 40;

/**
 * Transition altitudes (ft) by ICAO prefix. These are regional defaults, not per-airport AIP data, and
 * can be overridden per airport with a `transition_altitude` property in the airport file.
 *
 * @property TRANSITION_ALTITUDE_BY_PREFIX
 * @type {object}
 * @final
 */
export const TRANSITION_ALTITUDE_BY_PREFIX = {
    EG: 6000,
    EI: 5000,
    LF: 5000,
    ED: 5000,
    ET: 5000,
    EH: 3000,
    EB: 4500,
    EL: 4500,
    LS: 7000,
    LE: 6000,
    LI: 5000,
    LP: 4000,
    LO: 5000,
    EK: 5000,
    ES: 5000,
    EN: 7000,
    EF: 5000,
    EP: 6500,
    LK: 5000,
    LH: 5000,
    LG: 6000,
    LT: 10000,
    K: 18000,
    P: 18000,
    C: 18000
};

/**
 * @property DEFAULT_TRANSITION_ALTITUDE
 * @type {number}
 * @final
 */
export const DEFAULT_TRANSITION_ALTITUDE = 5000;

/**
 * ICAO prefixes that report pressure as an altimeter setting in inches of mercury and visibility in
 * statute miles (United States, Canada); everyone else uses hPa QNH and metres / kilometres.
 *
 * @property IMPERIAL_PREFIXES
 * @type {array<string>}
 * @final
 */
export const IMPERIAL_PREFIXES = ['K', 'P', 'C'];

/**
 * Phonetic alphabet used for ATIS information letters
 *
 * @property ATIS_LETTERS
 * @type {array<string>}
 * @final
 */
export const ATIS_LETTERS = [
    'ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL', 'INDIA', 'JULIET',
    'KILO', 'LIMA', 'MIKE', 'NOVEMBER', 'OSCAR', 'PAPA', 'QUEBEC', 'ROMEO', 'SIERRA', 'TANGO',
    'UNIFORM', 'VICTOR', 'WHISKEY', 'XRAY', 'YANKEE', 'ZULU'
];
