/**
 * Things you can ask the application to do in plain words, as opposed to instructions to an aircraft
 *
 * "open the ATIS", "give me the latest information", "hide the SIDs", "switch to Manchester", "zoom in", "make it
 * busier", "what's the wind", "pause". The parser takes normalised text (see `normalizeTranscript`) and returns a list of
 * `{ action, target, value }`; `RadioController` carries them out. The language model returns the same shape.
 *
 * Actions: `open` / `close` (target: a panel), `layer` (target: a map layer, value: show|hide|toggle), `atis_update`,
 * `atis_read`, `switch_airport` (value: ICAO), `zoom` (value: in|out|reset), `traffic_level` (value: quiet|medium|busy|rush|more|less),
 * `time` (value: pause|resume|normal|a number), `info` (target: wind|qnh|atis|runway|time|traffic|temperature|visibility|summary).
 */

export const APP_ACTIONS = ['open', 'close', 'layer', 'atis_update', 'atis_read', 'switch_airport', 'zoom', 'traffic_level', 'time', 'info'];

export const PANEL_TARGETS = ['atis', 'radio', 'controls', 'procedures', 'settings', 'ai_settings', 'airports', 'ground', 'traffic'];

export const LAYER_TARGETS = ['sids', 'stars', 'labels', 'airspace', 'terrain', 'restricted', 'maps'];

export const INFO_TARGETS = ['wind', 'qnh', 'atis', 'runway', 'time', 'traffic', 'temperature', 'visibility', 'summary'];

const PANEL_WORDS = [
    ['atis', /\b(?:atis|information)\b/],
    ['radio', /\b(?:radio|transcript|comms|communications)\b/],
    ['controls', /\b(?:controls?|help|guide|commands?|instructions|how to)\b/],
    ['procedures', /\b(?:procedures?|sids? and stars?|stars? and sids?|sid list|star list)\b/],
    ['ai_settings', /\b(?:ai settings|voice settings|api keys?)\b/],
    ['settings', /\b(?:settings|options|preferences)\b/],
    ['airports', /\b(?:airport list|list of airports|airports)\b/],
    ['ground', /\b(?:ground chart|ground map|taxi chart|taxiway chart|airport diagram|ground view|ground)\b/]
];

const LAYER_WORDS = [
    ['sids', /\bsids?\b|\bdepartures? routes?\b/],
    ['stars', /\bstars?\b|\barrival routes?\b/],
    ['labels', /\b(?:labels?|fixes|waypoints?|runway labels?)\b/],
    ['airspace', /\bairspace\b|\bcontrol zone\b|\bctr\b/],
    ['terrain', /\b(?:terrain|elevation|hills?)\b/],
    ['restricted', /\b(?:restricted|danger areas?|prohibited)\b/],
    ['maps', /\b(?:video ?maps?|maps?|coast(?:line)?)\b/]
];

const TRAFFIC_WORDS = [
    ['quiet', /\b(?:quiet|quieter|calm|light|empty|slow)\b/],
    ['medium', /\b(?:medium|moderate|normal|average)\b/],
    ['rush', /\b(?:rush hour|rush|chaos|insane|crazy|packed|extreme)\b/],
    ['busy', /\b(?:busy|busier|heavy|crowded)\b/]
];

const INFO_WORDS = [
    ['wind', /\b(?:wind|winds|gusts?)\b/],
    ['qnh', /\b(?:qnh|altimeter|pressure|qfe)\b/],
    ['temperature', /\b(?:temperature|temp)\b/],
    ['visibility', /\b(?:visibility|vis|weather|cloud|ceiling)\b/],
    ['runway', /\b(?:runway in use|active runway|which runway|what runway|runways? in use)\b/],
    ['time', /\b(?:what time|the time|time is it|zulu time|utc)\b/],
    ['traffic', /\b(?:how many aircraft|how many planes|traffic count|number of aircraft|aircraft count)\b/],
    ['atis', /\b(?:atis|information)\b/]
];

const ASKING = /\b(?:what(?:'s| is| are)?|whats|tell me|give me|say|report|how|which|check|current|latest|read)\b/;
const OPEN_VERB = /\b(?:open|show|bring up|display|pull up|go to|take me to|launch|view)\b/;
const CLOSE_VERB = /\b(?:close|hide|dismiss|shut|remove|get rid of)\b/;
const SHOW_VERB = /\b(?:show|display|draw|turn on|switch on|enable|put on|add)\b/;

const firstMatch = (table, text) => {
    const found = table.find(([, pattern]) => pattern.test(text));

    return found ? found[0] : null;
};

/**
 * @function parseAppActions
 * @param text {string} normalised lower-case text
 * @param context {object} `{ resolveAirport: (words) => ICAO|null, hasAircraftMention: boolean }`
 * @return {array<object>} `[{ action, target, value }]`
 */
export const parseAppActions = (text, context = {}) => {
    const actions = [];
    const add = (action, target = '', value = '') => {
        if (!actions.some((existing) => existing.action === action && existing.target === target && existing.value === value)) {
            actions.push({ action, target, value });
        }
    };

    if (!text) {
        return actions;
    }

    // ---- ATIS: update / read / show
    if (/\b(?:update|issue|refresh|renew|regenerate|publish|new)\b[^.]*\b(?:atis|information)\b/.test(text) ||
        /\b(?:atis|information)\b[^.]*\b(?:update|refresh|renew)\b/.test(text)) {
        add('atis_update');
    }

    if (/\b(?:read|play|broadcast|listen to|hear|speak)\b[^.]*\batis\b/.test(text)) {
        add('atis_read');
    }

    // ---- layers on the radar, otherwise panels
    const layerTargets = LAYER_WORDS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
    const hasLayerVerb = /\b(?:show|hide|display|draw|turn on|turn off|switch on|switch off|enable|disable|toggle|remove)\b/.test(text);
    const mentionsPanel = /\b(?:panel|window|list|dialog|menu|screen|page)\b/.test(text);

    if (hasLayerVerb && layerTargets.length > 0 && !mentionsPanel) {
        const wantsHide = /\b(?:hide|remove|turn off|switch off|disable)\b/.test(text);
        const wantsShow = SHOW_VERB.test(text) && !wantsHide;
        let value = 'toggle';

        if (wantsHide) {
            value = 'hide';
        } else if (wantsShow) {
            value = 'show';
        }


        layerTargets.forEach((target) => add('layer', target, value));
    } else {
        const panel = firstMatch(PANEL_WORDS, text);

        if (panel) {
            if (CLOSE_VERB.test(text)) {
                add('close', panel);
            } else if (OPEN_VERB.test(text) || /\b(?:latest|current|updated?)\b[^.]*\b(?:atis|information)\b/.test(text) ||
                /\bwhat(?:'s| is) the (?:atis|information)\b/.test(text)) {
                add('open', panel);
            }
        }
    }

    // ---- switching airports
    const switchMatch = /\b(?:switch|change|go|move|load|take me|fly|jump|transfer)\b(?: me)?(?: over)?(?: to| into)?(?: the)?(?: airport)?\s+(.+)$/.exec(text) ||
        /\bairport\s+([a-z]{4})\b/.exec(text);

    if (switchMatch && context.resolveAirport) {
        const icao = context.resolveAirport(switchMatch[1]);

        if (icao) {
            add('switch_airport', '', icao);
        }
    }

    // ---- zoom
    if (/\bzoom(?:ed)?\s+in\b|\bcloser\b|\benlarge\b|\bmagnify\b/.test(text)) {
        add('zoom', '', 'in');
    } else if (/\bzoom(?:ed)?\s+out\b|\bfurther out\b|\bwider\b/.test(text)) {
        add('zoom', '', 'out');
    } else if (/\b(?:reset|default|centre|center)\b[^.]*\b(?:view|zoom|scope|radar|map)\b|\bzoom (?:to|on) (?:the )?(?:airport|field)\b|\bzoom reset\b/.test(text)) {
        add('zoom', '', 'reset');
    }

    // ---- traffic level
    if (/\btraffic\b|\bbusy\b|\bbusier\b|\bquiet\b|\bquieter\b|\brush hour\b|\bmore (?:aircraft|planes)\b|\bfewer (?:aircraft|planes)\b/.test(text) &&
        !context.hasAircraftMention) {
        const level = firstMatch(TRAFFIC_WORDS, text);

        if (/\b(?:more|increase|higher|busier|add more|raise)\b/.test(text) && /\b(?:traffic|aircraft|planes|busy)\b|busier/.test(text)) {
            add('traffic_level', '', 'more');
        } else if (/\b(?:less|fewer|reduce|lower|quieter|decrease)\b/.test(text) && /\b(?:traffic|aircraft|planes)\b|quieter/.test(text)) {
            add('traffic_level', '', 'less');
        } else if (level && /\b(?:set|make|change|switch|put|traffic|airport|level)\b/.test(text)) {
            add('traffic_level', '', level);
        }
    }

    // ---- time
    if (!context.hasAircraftMention) {
        if (/^(?:please )?(?:pause|freeze|hold the game|stop the game)(?: the game| it)?$/.test(text) || /\bpause the (?:game|simulation|sim)\b/.test(text)) {
            add('time', '', 'pause');
        } else if (/^(?:please )?(?:resume|unpause|continue|carry on|restart)(?: the game| it)?$/.test(text) || /\b(?:resume|unpause) the (?:game|simulation|sim)\b/.test(text)) {
            add('time', '', 'resume');
        } else {
            const warp = /\b(?:time ?warp|speed up(?: time| the game)?|fast forward|faster|run at|go at)\b[^.]*?\b(\d{1,2})\b/.exec(text);

            if (warp) {
                add('time', '', warp[1]);
            } else if (/\b(?:normal speed|real time|realtime|slow down time|stop speeding|timewarp off)\b/.test(text)) {
                add('time', '', 'normal');
            } else if (/\b(?:speed up|fast forward|faster)\b/.test(text) && /\b(?:time|game|simulation|sim)\b/.test(text)) {
                add('time', '', '5');
            }
        }
    }

    // ---- questions about conditions
    if (ASKING.test(text) && actions.length === 0 && !context.hasAircraftMention) {
        const topic = firstMatch(INFO_WORDS, text);

        if (topic) {
            add('info', topic);
        } else if (/\b(?:summary|situation|overview|status)\b|\bwhat(?:'s| is) going on\b/.test(text)) {
            add('info', 'summary');
        }
    }

    return actions;
};
