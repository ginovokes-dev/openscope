import { EVENT } from './eventNames';
import { MEASURE_TOOL_STYLE } from './inputConstants';

/* eslint-disable max-len, import/prefer-default-export */
/**
 * Name enumeration of available game options
 *
 * @property GAME_OPTION_NAMES
 * @type {Object}
 * @final
 */
export const GAME_OPTION_NAMES = {
    CONTROL_METHOD: 'controlMethod',
    CHAT_LOG_DURATION: 'chatLogDuration',
    DRAW_PROJECTED_PATHS: 'drawProjectedPaths',
    DRAW_ILS_DISTANCE_SEPARATOR: 'drawIlsDistanceSeparator',
    MEASURE_TOOL_PATH: 'measureToolPath',
    MOUSE_CLICK_DRAG: 'mouseClickDrag',
    PROJECTED_TRACK_LINE_LENGTHS: 'ptlLengths',
    RANGE_RINGS: 'rangeRings',
    SOFT_CEILING: 'softCeiling',
    THEME: 'theme',
    TOWER_CONTROLLER: 'towerController',
    WEATHER_VARIABILITY: 'weatherVariability',
    ATIS_UPDATES: 'atisUpdates',
    FAILURE_FREQUENCY: 'failureFrequency',
    EVENTS_FUEL: 'eventsFuel',
    EVENTS_MEDICAL: 'eventsMedical',
    EVENTS_TECHNICAL: 'eventsTechnical',
    EVENTS_WEATHER: 'eventsWeather',
    EVENTS_REQUESTS: 'eventsRequests',
    EVENTS_TRAFFIC: 'eventsTraffic',
    AIRCRAFT_INFO_DETAIL: 'aircraftInfoDetail',
    FUEL_UNITS: 'fuelUnits',
    TRAFFIC_LEVEL: 'trafficLevel',
    DRAW_SIDS: 'drawSids',
    DRAW_STARS: 'drawStars',
    GROUND_LAYOUT_SOURCE: 'groundLayoutSource'
};

/**
 * User options
 *
 * These options are presented in a modal and are stored in localStorage
 *
 * @property GAME_OPTION_VALUES
 * @type {array<object>}
 * @final
 */
export const GAME_OPTION_VALUES = [
    {
        name: GAME_OPTION_NAMES.THEME,
        defaultValue: 'DEFAULT',
        description: 'Scope Theme',
        type: 'select',
        onChangeEventHandler: EVENT.SET_THEME,
        optionList: [
            {
                displayLabel: 'Classic',
                value: 'CLASSIC'
            },
            {
                displayLabel: 'Default',
                value: 'DEFAULT'
            },
            {
                displayLabel: 'Celestial',
                value: 'CELESTIAL'
            }
        ]
    },
    {
        name: GAME_OPTION_NAMES.TOWER_CONTROLLER,
        group: 'Departures',
        defaultValue: 'USER',
        description: 'Who clears departures',
        help: 'You: departures wait at the stand until you give them an IFR clearance, taxi instruction and takeoff clearance. ' +
            'Automatic: the tower does it for you and they take off when the runway is clear.',
        type: 'select',
        onChangeEventHandler: null,
        optionList: [
            {
                displayLabel: 'Me (IFR clearance, taxi, takeoff)',
                value: 'USER'
            },
            {
                displayLabel: 'Automatic (tower does it)',
                value: 'SYSTEM'
            }
        ]
    },
    {
        name: GAME_OPTION_NAMES.TRAFFIC_LEVEL,
        group: 'Traffic',
        defaultValue: 'medium',
        description: 'How busy is the airport',
        help: 'Scales how many aircraft arrive and depart, and caps how many arrivals are in the airspace at once.',
        type: 'select',
        onChangeEventHandler: EVENT.TRAFFIC_LEVEL_CHANGE,
        optionList: [
            { displayLabel: 'Quiet (a few aircraft)', value: 'quiet' },
            { displayLabel: 'Medium', value: 'medium' },
            { displayLabel: 'Busy', value: 'busy' },
            { displayLabel: 'Rush hour', value: 'rush' }
        ]
    },
    {
        name: GAME_OPTION_NAMES.GROUND_LAYOUT_SOURCE,
        group: 'Ground',
        defaultValue: 'auto',
        description: 'Airport ground layout',
        help: 'Taxiways, aprons and stands. Real layouts come from OpenStreetMap when the browser is online (and are remembered); ' +
            'otherwise, or when set to generated, a schematic layout is drawn from the runways.',
        type: 'select',
        optionList: [
            { displayLabel: 'Real (OpenStreetMap), else generated', value: 'auto' },
            { displayLabel: 'Generated schematic only', value: 'schematic' }
        ]
    },
    {
        name: GAME_OPTION_NAMES.DRAW_SIDS,
        group: 'Radar',
        defaultValue: 'yes',
        description: 'Show SIDs',
        help: 'Draw departure routes and their names on the radar',
        type: 'select',
        onChangeEventHandler: EVENT.DRAW_PROCEDURES_CHANGE,
        optionList: [{ displayLabel: 'Yes', value: 'yes' }, { displayLabel: 'No', value: 'no' }]
    },
    {
        name: GAME_OPTION_NAMES.DRAW_STARS,
        group: 'Radar',
        defaultValue: 'yes',
        description: 'Show STARs',
        help: 'Draw arrival routes and their names on the radar',
        type: 'select',
        onChangeEventHandler: EVENT.DRAW_PROCEDURES_CHANGE,
        optionList: [{ displayLabel: 'Yes', value: 'yes' }, { displayLabel: 'No', value: 'no' }]
    },
    {
        name: GAME_OPTION_NAMES.CONTROL_METHOD,
        defaultValue: 'classic',
        description: 'Control Method',
        type: 'select',
        onChangeEventHandler: null,
        optionList: [
            {
                displayLabel: 'Classic',
                value: 'classic'
            },
            {
                displayLabel: 'Arrow Keys',
                value: 'arrows'
            }
        ]
    },
    {
        name: GAME_OPTION_NAMES.DRAW_ILS_DISTANCE_SEPARATOR,
        defaultValue: 'from-theme',
        description: 'Show trailing separation indicator on ILS',
        help: 'Draw a trailing indicator 2.5 NM (4.6km) behind landing aircraft to help with traffic spacing',
        type: 'select',
        onChangeEventHandler: null,
        optionList: [
            {
                displayLabel: 'From Theme',
                value: 'from-theme'
            },
            {
                displayLabel: 'Yes',
                value: 'yes'
            },
            {
                displayLabel: 'No',
                value: 'no'
            }
        ]
    },
    {
        name: GAME_OPTION_NAMES.PROJECTED_TRACK_LINE_LENGTHS,
        defaultValue: '1-2-4-8',
        description: 'Projected Track Line (PTL) increments, in minutes',
        type: 'select',
        onChangeEventHandler: null,
        optionList: [
            {
                displayLabel: '0.5 x n ... 8',
                value: '0.5-1-1.5-2-2.5-3-3.5-4-4.5-5-5.5-6-6.5-7-7.5-8'
            },
            {
                displayLabel: '1.0 x n ... 8',
                value: '1-2-3-4-5-6-7-8'
            },
            {
                displayLabel: '1-2-4-6-8-10-12-14-16',
                value: '1-2-4-6-8-10-12-14-16'
            },
            {
                displayLabel: '0.5-1-2-4-8',
                value: '0.5-1-2-4-8'
            },
            {
                displayLabel: '1-2-4-8',
                value: '1-2-4-8'
            }
        ]
    },
    {
        name: GAME_OPTION_NAMES.DRAW_PROJECTED_PATHS,
        defaultValue: 'selected',
        description: 'Draw aircraft projected path',
        type: 'select',
        onChangeEventHandler: null,
        optionList: [
            {
                displayLabel: 'Always',
                value: 'always'
            },
            {
                displayLabel: 'Selected',
                value: 'selected'
            },
            {
                displayLabel: 'Never',
                value: 'never'
            }
        ]
    },
    {
        name: GAME_OPTION_NAMES.SOFT_CEILING,
        defaultValue: 'yes',
        description: 'Allow departures via climb',
        help: 'Normally aircraft departs the airspace by flying beyond the horizontal bounds.  If set to yes, aircraft may also depart the airspace by climbing above it.',
        type: 'select',
        onChangeEventHandler: null,
        optionList: [
            {
                displayLabel: 'Yes',
                value: 'yes'
            },
            {
                displayLabel: 'No',
                value: 'no'
            }
        ]
    },
    {
        name: GAME_OPTION_NAMES.MOUSE_CLICK_DRAG,
        defaultValue: 'right',
        description: 'Panning Button',
        help: 'Which mouse button (left or right) should drag the canvas when held',
        type: 'select',
        onChangeEventHandler: null,
        optionList: [
            {
                displayLabel: 'Left Click',
                value: 'left'
            },
            {
                displayLabel: 'Right Click',
                value: 'right'
            }
        ]
    },
    {
        name: GAME_OPTION_NAMES.RANGE_RINGS,
        defaultValue: 'default',
        description: 'Range rings',
        help: 'Radius of range rings, in nautical miles',
        type: 'select',
        onChangeEventHandler: EVENT.RANGE_RINGS_CHANGE,
        optionList: [
            {
                displayLabel: 'Default',
                value: 'default'
            },
            {
                displayLabel: 'Off',
                value: 'off'
            },
            {
                displayLabel: '1 nm',
                value: 1
            },
            {
                displayLabel: '2 nm',
                value: 2
            },
            {
                displayLabel: '5 nm',
                value: 5
            },
            {
                displayLabel: '10 nm',
                value: 10
            },
            {
                displayLabel: '15 nm',
                value: 15
            },
            {
                displayLabel: '20 nm',
                value: 20
            }
        ]
    },
    {
        name: GAME_OPTION_NAMES.MEASURE_TOOL_PATH,
        defaultValue: '0',
        description: 'Measure path style',
        help: 'How the path is rendered when using the range/bearing measuring tool',
        type: 'select',
        onChangeEventHandler: EVENT.MEASURE_TOOL_STYLE_CHANGE,
        optionList: [
            {
                displayLabel: 'Straight lines only',
                value: MEASURE_TOOL_STYLE.STRAIGHT
            },
            {
                displayLabel: 'Arc to next fix, then straight',
                value: MEASURE_TOOL_STYLE.ARC_TO_NEXT
            },
            {
                displayLabel: 'All lines arced',
                value: MEASURE_TOOL_STYLE.ALL_ARCED
            }
        ]
    },
    {
        name: GAME_OPTION_NAMES.CHAT_LOG_DURATION,
        defaultValue: '3',
        description: 'Chat Log Duration',
        help: 'How long chat transmissions will remain visible before fading out',
        type: 'number',
        onChangeEventHandler: EVENT.CHAT_LOG_DURATION_CHANGE,
        unit: 'sec',
        validationHandler(newVal) {
            const output = parseFloat(newVal);

            return !Number.isNaN(output) && output > 0;
        }
    },
    {
        name: GAME_OPTION_NAMES.WEATHER_VARIABILITY,
        group: 'Weather and ATIS',
        defaultValue: 'normal',
        description: 'Weather changes',
        help: 'How often and how severely wind, visibility, cloud and pressure change. Static keeps the airport file\'s wind.',
        type: 'select',
        onChangeEventHandler: EVENT.WEATHER_VARIABILITY_CHANGE,
        optionList: [
            { displayLabel: 'Static (airport file wind)', value: 'static' },
            { displayLabel: 'Calm - slow, benign changes', value: 'calm' },
            { displayLabel: 'Normal', value: 'normal' },
            { displayLabel: 'Lively - fronts and showers', value: 'lively' },
            { displayLabel: 'Severe - storms, fog, snow', value: 'severe' }
        ]
    },
    {
        name: GAME_OPTION_NAMES.ATIS_UPDATES,
        group: 'Weather and ATIS',
        defaultValue: 'auto',
        description: 'ATIS updates',
        help: 'Automatic: a new information letter is issued when conditions change. Manual: you issue each update ' +
            'from the ATIS panel, and pilots will call with outdated information if you forget.',
        type: 'select',
        onChangeEventHandler: null,
        optionList: [
            { displayLabel: 'Automatic', value: 'auto' },
            { displayLabel: 'Manual (I update it)', value: 'manual' }
        ]
    },
    {
        name: GAME_OPTION_NAMES.FAILURE_FREQUENCY,
        group: 'Failures and events',
        defaultValue: 'rare',
        description: 'Failures and emergencies',
        help: 'How often something goes wrong: low fuel, medical emergencies, engine and system failures, ' +
            'go-arounds, radio failures, diversions. Rare is about one event an hour.',
        type: 'select',
        onChangeEventHandler: null,
        optionList: [
            { displayLabel: 'Off', value: 'off' },
            { displayLabel: 'Rare (~1 per hour)', value: 'rare' },
            { displayLabel: 'Occasional (~1 per 20 min)', value: 'occasional' },
            { displayLabel: 'Frequent (~1 per 10 min)', value: 'frequent' },
            { displayLabel: 'Chaos (~1 per 4 min)', value: 'chaos' }
        ]
    },
    {
        name: GAME_OPTION_NAMES.EVENTS_FUEL,
        group: 'Failures and events',
        defaultValue: 'on',
        description: 'Low fuel / fuel emergencies',
        help: 'Arrivals that declare minimum fuel or MAYDAY FUEL and need priority',
        type: 'select',
        onChangeEventHandler: null,
        optionList: [{ displayLabel: 'On', value: 'on' }, { displayLabel: 'Off', value: 'off' }]
    },
    {
        name: GAME_OPTION_NAMES.EVENTS_MEDICAL,
        group: 'Failures and events',
        defaultValue: 'on',
        description: 'Medical and passenger emergencies',
        help: 'Sick passengers, unruly passengers: PAN-PAN calls that request priority',
        type: 'select',
        onChangeEventHandler: null,
        optionList: [{ displayLabel: 'On', value: 'on' }, { displayLabel: 'Off', value: 'off' }]
    },
    {
        name: GAME_OPTION_NAMES.EVENTS_TECHNICAL,
        group: 'Failures and events',
        defaultValue: 'on',
        description: 'Technical failures',
        help: 'Engine failure, smoke, bird strike, pressurisation loss and radio failure (squawk 7600)',
        type: 'select',
        onChangeEventHandler: null,
        optionList: [{ displayLabel: 'On', value: 'on' }, { displayLabel: 'Off', value: 'off' }]
    },
    {
        name: GAME_OPTION_NAMES.EVENTS_WEATHER,
        group: 'Failures and events',
        defaultValue: 'on',
        description: 'Weather-related events',
        help: 'Windshear go-arounds and pilots requesting a diversion because of the weather',
        type: 'select',
        onChangeEventHandler: null,
        optionList: [{ displayLabel: 'On', value: 'on' }, { displayLabel: 'Off', value: 'off' }]
    },
    {
        name: GAME_OPTION_NAMES.EVENTS_REQUESTS,
        group: 'Failures and events',
        defaultValue: 'on',
        description: 'Pilot requests',
        help: 'Pilots asking for direct routings, different altitudes or a different runway',
        type: 'select',
        onChangeEventHandler: null,
        optionList: [{ displayLabel: 'On', value: 'on' }, { displayLabel: 'Off', value: 'off' }]
    },
    {
        name: GAME_OPTION_NAMES.EVENTS_TRAFFIC,
        group: 'Failures and events',
        defaultValue: 'on',
        description: 'Operational go-arounds',
        help: 'Arrivals that go around because of an occupied runway, an unstable approach or birds',
        type: 'select',
        onChangeEventHandler: null,
        optionList: [{ displayLabel: 'On', value: 'on' }, { displayLabel: 'Off', value: 'off' }]
    },
    {
        name: GAME_OPTION_NAMES.AIRCRAFT_INFO_DETAIL,
        group: 'Aircraft information',
        defaultValue: 'full',
        description: 'Aircraft info panel detail',
        help: 'Standard shows what a real controller sees (flight plan, squawk, levels). Full also shows ' +
            'fuel and souls on board, which a real controller would have to ask the pilot for.',
        type: 'select',
        onChangeEventHandler: null,
        optionList: [
            { displayLabel: 'Full (includes fuel and souls on board)', value: 'full' },
            { displayLabel: 'Standard (controller view)', value: 'standard' }
        ]
    },
    {
        name: GAME_OPTION_NAMES.FUEL_UNITS,
        group: 'Aircraft information',
        defaultValue: 'kg',
        description: 'Fuel units',
        help: 'Units used for fuel quantities in the aircraft info panel and pilot reports',
        type: 'select',
        onChangeEventHandler: null,
        optionList: [{ displayLabel: 'Kilograms', value: 'kg' }, { displayLabel: 'Pounds', value: 'lb' }]
    }
];
