import { parseTaxiwayRefs } from './taxiwayRefs';
import { normalizeTranscript } from './spokenNumbers';
import { parseAppActions } from './appActions';
import { repairTranscript } from './transcriptRepair';

/**
 * Offline interpreter for spoken or typed instructions
 *
 * When no language model is available (no API key, or the server is unreachable) this turns common
 * radiotelephony into simulator commands with pattern matching. It understands the standard phrases a
 * controller uses (turn, climb/descend, speed, ILS clearance, direct, hold, go around, takeoff, taxi, squawk, divert
 * and the "say ..." questions); the language model understands far more, but this keeps text and voice control
 * working with no setup.
 *
 * The result has the same shape as the server's answer: `{ transmissions: [{ callsign, commands, reply, intent }],
 * controller_note }`.
 */

const STOP_WORDS = new Set([
    'the', 'your', 'to', 'at', 'left', 'right', 'runway', 'altitude', 'heading', 'speed', 'approach', 'ils', 'and', 'then',
    'maintain', 'knots', 'feet', 'level', 'flight', 'degrees', 'present', 'position', 'own', 'navigation', 'for', 'via'
]);

// four letter words that follow "divert" but are not airport codes
const DIVERT_NON_CODES = new Set(['this', 'that', 'back', 'over', 'with', 'from', 'into', 'then', 'city', 'your', 'them', 'will', 'when', 'once', 'also', 'both', 'near']);

const FEET_UNITS = '(?:feet|foot|ft)';
const RUNWAY = '(\\d{1,2}[lrc]?)';

/**
 * Runway names in the airport files are zero padded ("09L"), speech gives "9 left"; resolve to the airport's own name
 *
 * @function resolveRunway
 * @param token {string} eg "9l", "09l", "27"
 * @param runways {Set<string>|null} runway names at this airport, upper case
 * @return {string}
 */
const resolveRunway = (token, runways) => {
    const upper = token.toUpperCase();
    const padded = /^\d[LRC]?$/.test(upper) ? `0${upper}` : upper;

    if (!runways) {
        return padded;
    }

    const stripZeros = (name) => name.replace(/^0+/, '');
    const match = Array.from(runways).find((name) => stripZeros(name) === stripZeros(upper));

    return match || padded;
};

const escapeForRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const wordBoundaryIndex = (haystack, needle) => {
    const match = new RegExp(`(^|\\s)${escapeForRegex(needle)}(?=\\s|$)`).exec(haystack);

    return match ? match.index + match[1].length : -1;
};

/**
 * Find the aircraft mentioned in a (normalised) transcript, in the order they are mentioned
 *
 * @function findMentions
 * @param normalized {string}
 * @param aircraft {array<object>}
 * @return {array<object>} `[{ aircraft, start, end }]`
 */
export const findMentions = (normalized, aircraft) => {
    const mentions = [];

    aircraft.forEach((candidate) => {
        const callsign = String(candidate.callsign || '').toLowerCase();
        const airlineId = String(candidate.airlineId || '').toLowerCase();
        const flightNumber = String(candidate.flightNumber || '').toLowerCase();
        const telephony = normalizeTranscript(candidate.airlineCallsign || '');
        const forms = [
            `${telephony} ${flightNumber}`,
            callsign,
            `${airlineId} ${flightNumber}`,
            `${airlineId}${flightNumber}`
        ].filter((form) => form.trim().length > 2 && flightNumber);
        let best = null;

        forms.forEach((form) => {
            const index = wordBoundaryIndex(normalized, form);

            if (index !== -1 && (best === null || index < best.start)) {
                best = { start: index, end: index + form.length };
            }
        });

        if (best) {
            mentions.push({ aircraft: candidate, ...best });
        }
    });

    return mentions.sort((a, b) => a.start - b.start);
};

const toHundreds = (value, hasFlightLevel, hasFeetUnit) => {
    const number = Number(value);

    if (hasFlightLevel) {
        return number;
    }

    if (hasFeetUnit || number >= 1000) {
        return Math.round(number / 100);
    }

    // eslint-disable-next-line no-nested-ternary
    return number;
};

/**
 * Extract commands from the part of the transmission addressed to one aircraft
 *
 * @function extractCommands
 * @param text {string} normalised text for this aircraft
 * @param aircraft {object} aircraft descriptor (altitude is used to decide climb or descend)
 * @param context {object} `{ fixes: Set<string>, runways: Set<string>, resolveAirport: (text) => ICAO|null }`
 * @return {array<string>}
 */
export const extractCommands = (rawText, aircraft, context = {}) => {
    // "runway 27 left" -> "runway 27l"
    const text = rawText.replace(/\brunway (\d{1,2}) (left|right|centre|center)\b/g, (all, number, side) => `runway ${number}${side[0] === 'c' ? 'c' : side[0]}`);
    const found = [];
    const claimed = [];
    const fixes = context.fixes || null;
    const runways = context.runways || null;
    const isClaimed = (start, end) => claimed.some(([a, b]) => start < b && end > a);
    const add = (match, command) => {
        const start = match.index;
        const end = match.index + match[0].length;

        if (isClaimed(start, end)) {
            return;
        }

        claimed.push([start, end]);
        found.push({ start, command });
    };
    const scan = (pattern, builder) => {
        const regex = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`);
        let match = regex.exec(text);

        while (match) {
            const command = builder(match);

            if (command) {
                add(match, command);
            }

            match = regex.exec(text);
        }
    };
    const expedite = /\b(expedite|expeditious|best rate|immediately|without delay)\b/.test(text);

    scan(/\b(?:go around|going around|missed approach|execute (?:the )?missed)\b/, () => 'ga');
    scan(/\bcleared (?:for )?(?:the )?take ?off\b|\bcleared to take ?off\b|\bcleared take ?off\b/, () => 'cto');
    scan(/\b(?:push ?back|push and start|start ?up)(?: and start)?(?: approved)?\b(?! clearance)|\bpush ?back approved\b/, () => 'push');
    scan(/\bline ?up(?: and wait| and hold)?\b|\bluaw\b/, () => 'lineup');
    scan(/\bhold (?:your )?position\b|\bstop (?:there|here|where you are)\b/, () => 'hp');
    scan(new RegExp(`\\b(?:taxi|hold short)\\b[^.]*?\\brunway ${RUNWAY}\\b`), (m) => {
        const after = text.slice(m.index + m[0].length);
        const viaMatch = /^\s*,?\s*(?:via|along|using)\s+(.+)$/.exec(after);
        const refs = viaMatch ? parseTaxiwayRefs(viaMatch[1]) : [];

        return [`taxi ${resolveRunway(m[1], runways)}`, ...(refs.length > 0 ? ['via', ...refs] : [])].join(' ');
    });
    scan(new RegExp(`\\bcleared (?:for |to )?(?:the )?(?:ils|localiser|localizer|approach)\\b[^.]*?\\brunway ${RUNWAY}\\b`), (m) => `i ${resolveRunway(m[1], runways)}`);
    scan(new RegExp(`\\b(?:ils|approach) runway ${RUNWAY}\\b`), (m) => (/\b(?:expect|vectors)\b/.test(text.slice(Math.max(0, m.index - 20), m.index)) ? null : `i ${resolveRunway(m[1], runways)}`));
    scan(new RegExp(`\\bexpect (?:the )?(?:ils )?(?:approach )?(?:to )?(?:for )?runway ${RUNWAY}\\b`), (m) => `e ${resolveRunway(m[1], runways)}`);
    scan(/\bcleared as filed\b|\b(?:ifr|atc|departure|start ?up) clearance\b|\bcleared to (?!land\b|take ?off\b|the\b|ils\b|localiser\b|localizer\b|approach\b|cross\b|enter\b|leave\b)[a-z' ]{2,30}? (?:via|as filed)\b/, () => 'caf');
    scan(/\bclimb via (?:the )?sid\b/, () => 'cvs');
    scan(/\bdescend via (?:the )?star\b/, () => 'dvs');
    scan(/\bsquawk (\d{4})\b/, (m) => `sq ${m[1]}`);
    scan(/\b(?:cancel|exit|leave) (?:the )?hold(?:ing)?\b|\bresume own navigation\b|\bcontinue (?:own )?navigation\b/, () => 'xh');
    scan(/\bhold (?:at|over|on)? ?([a-z]{3,5})\b(?: (left|right))?(?: (\d{1,2}) min(?:ute)?s?)?/, (m) => {
        const fix = m[1].toUpperCase();

        if ((fixes && !fixes.has(fix)) || STOP_WORDS.has(m[1])) {
            return null;
        }

        return ['hold', fix, m[2] ? m[2][0] : '', m[3] ? `${m[3]}min` : ''].filter(Boolean).join(' ');
    });
    scan(/\b(?:proceed )?direct(?:ly)? (?:to )?([a-z]{3,5})\b/, (m) => {
        const fix = m[1].toUpperCase();

        if ((fixes && !fixes.has(fix)) || STOP_WORDS.has(m[1])) {
            return null;
        }

        return `pd ${fix}`;
    });
    scan(/\bdivert(?:ing)?\b/, (m) => {
        const words = text.slice(m.index + m[0].length).split(' ').filter(Boolean).slice(0, 6);
        const byName = context.resolveAirport ? context.resolveAirport(words.join(' ')) : null;
        const code = words.find((word) => /^[a-z]{4}$/.test(word) && !DIVERT_NON_CODES.has(word));

        if (byName) {
            return `divert ${byName.toUpperCase()}`;
        }

        return code ? `divert ${code.toUpperCase()}` : null;
    });

    // turns: "turn left heading 270", "turn right 20 degrees"
    scan(/\b(?:turn|go|head|fly)\s+(left|right)\s+(?:(?:to|onto)\s+)?(?:heading\s+)?(\d{1,3})(\s+degrees)?\b/, (m) => {
        const degrees = Number(m[2]);
        const isIncremental = Boolean(m[3]) || (degrees <= 45 && !/heading/.test(m[0]));

        return isIncremental ? `t ${m[1][0]} ${degrees}` : `t ${m[1][0]} ${m[2].padStart(3, '0')}`;
    });
    scan(/\b(?:fly |turn |head |continue |maintain )?(?:to )?heading (\d{1,3})\b/, (m) => `fh ${m[1].padStart(3, '0')}`);
    scan(/\b(?:fly|maintain|continue) (?:the )?(?:present|current|runway) heading\b|\bcontinue straight ahead\b/, () => 'fph');

    // the controller's own shorthand, typed or dictated: "d20", "d 20", "dee 20", "c30", "h270", "s210", "t l 270"
    scan(/\b(?:d|dee|delta)[-\s]?(\d{1,5})\b(?!\s*(?:knots?|kt|degrees?|nm|miles))/, (m) => {
        const hundreds = toHundreds(m[1], false, false);

        return hundreds >= 1 && hundreds <= 500 ? `d ${hundreds}` : null;
    });
    scan(/\bc[-\s]?(\d{1,5})\b(?!\s*(?:knots?|kt|degrees?|nm|miles))/, (m) => {
        const hundreds = toHundreds(m[1], false, false);

        return hundreds >= 1 && hundreds <= 500 ? `c ${hundreds}` : null;
    });
    scan(/\bh[-\s]?(\d{3})\b/, (m) => (Number(m[1]) <= 360 ? `fh ${m[1]}` : null));
    scan(/\bs[-\s]?(\d{2,3})\b/, (m) => (Number(m[1]) >= 60 && Number(m[1]) <= 400 ? `sp ${Number(m[1])}` : null));
    scan(/\bt[-\s]?(l|r)[-\s]?(\d{1,3})\b/, (m) => (Number(m[2]) <= 360 ? `t ${m[1]} ${m[2].length === 3 ? m[2] : Number(m[2])}` : null));

    // altitude: "descend flight level 100", "climb and maintain 3000 feet", "maintain 5000"
    scan(new RegExp(`\\b(climb|descend|maintain|altitude|level at|level off at)\\s+(?:and maintain\\s+|to\\s+)?(?:altitude\\s+)?(flight level\\s+|fl\\s*)?(\\d{1,5})(?:\\s*${FEET_UNITS})?\\b`), (m) => {
        const word = m[1];
        const value = Number(m[3]);
        const hasFlightLevel = Boolean(m[2]);
        const hasFeetUnit = new RegExp(FEET_UNITS).test(m[0]);
        const isSpeedLike = !hasFlightLevel && !hasFeetUnit && value >= 100 && value <= 400 && /knots|kt/.test(text.slice(m.index, m.index + m[0].length + 8));

        if (isSpeedLike || (value < 100 && !hasFlightLevel && !hasFeetUnit && word === 'maintain')) {
            return null;
        }

        const hundreds = toHundreds(value, hasFlightLevel, hasFeetUnit);
        const currentHundreds = Math.round((aircraft.altitude || 0) / 100);
        let verb = 'c';

        if (word === 'descend' || ((word !== 'climb') && hundreds < currentHundreds)) {
            verb = 'd';
        }

        return `${verb} ${hundreds}${expedite ? ' ex' : ''}`;
    });

    // speed: "reduce speed 180", "maintain 250 knots", "increase speed to 220"
    scan(/\b(?:reduce|increase|slow|speed|maintain|keep)\s+(?:speed\s+)?(?:to\s+)?(\d{2,3})\s*(?:knots|kt|kts)?\b/, (m) => {
        const value = Number(m[1]);
        const hasUnit = /knots|kt/.test(m[0]);
        const hasSpeedWord = /\b(?:reduce|increase|slow|speed)\b/.test(m[0]);

        if (value < 70 || value > 400 || (!hasUnit && !hasSpeedWord)) {
            return null;
        }

        return `sp ${value}`;
    });

    // questions the simulator can answer
    scan(/\b(?:say|report|confirm|what is|what's|how much)\b[^.]*?\b(?:fuel|endurance)\b|\bfuel (?:remaining|state|on board|endurance)\b/, () => 'sf');
    scan(/\b(?:souls|persons|people|pob)\b(?: on board)?/, () => 'sob');
    scan(/\b(?:say|report|confirm)\b[^.]*?\bintentions?\b|\bsay request\b|\bwhat do you want\b|\bintentions\b/, () => 'sint');
    scan(/\b(?:say|which|what|confirm)\b[^.]*?\b(?:atis|information)\b|\bhave (?:the )?(?:atis|information)\b/, () => 'sinfo');
    scan(/\bsay (?:your )?(?:current )?altitude\b|\breport altitude\b/, () => 'sa');
    scan(/\bsay (?:your )?assigned altitude\b/, () => 'saa');
    scan(/\bsay (?:your )?(?:current )?heading\b/, () => 'sh');
    scan(/\bsay (?:your )?assigned heading\b/, () => 'sah');
    scan(/\bsay (?:your )?(?:indicated )?airspeed\b|\bsay (?:your )?speed\b/, () => 'si');
    scan(/\bsay (?:your )?assigned speed\b/, () => 'sas');
    scan(/\bsay (?:your )?(?:route|flight plan)\b/, () => 'sr');

    // acknowledgements only count when nothing else was asked
    if (found.length === 0) {
        if (/\b(?:unable|negative|denied|not approved)\b/.test(text)) {
            return ['unable'];
        }

        if (/\b(?:roger|copy|wilco|acknowledged|affirm|thank you|thanks)\b/.test(text)) {
            return ['roger'];
        }
    }

    return found.sort((a, b) => a.start - b.start).map((entry) => entry.command);
};

/**
 * Words the recognisers should be able to match: the telephony of every aircraft in the simulation
 *
 * @function telephonyWordsOf
 * @param aircraft {array<object>}
 * @return {array<string>}
 */
const telephonyWordsOf = (aircraft) => {
    const words = new Set();

    aircraft.forEach((candidate) => {
        String(candidate.airlineCallsign || '').toLowerCase().split(/\s+/).filter(Boolean)
            .forEach((word) => words.add(word));
    });

    return Array.from(words);
};

/**
 * "Speedbird one two three delta twenty" is normalised to flight "123d" followed by "20". When no aircraft has that flight number
 * the letter is the controller's shorthand ("d 20") and goes back to being a separate word.
 *
 * @function separateGluedCommandLetter
 * @param text {string} normalised text
 * @param aircraft {array<object>}
 * @return {string}
 */
const separateGluedCommandLetter = (text, aircraft) => text.replace(/\b(\d{1,4})([dchst])(?= ?[lr]? ?\d)/g, (all, digits, letter) => {
    const isFlightNumber = aircraft.some((candidate) => String(candidate.flightNumber || '').toLowerCase() === `${digits}${letter}`);

    return isFlightNumber ? all : `${digits} ${letter}`;
});

/**
 * Interpret a transmission without a language model
 *
 * @function interpretLocally
 * @param text {string} what the controller said or typed
 * @param context {object}
 * @param context.aircraft {array<object>} `[{ callsign, airlineId, airlineCallsign, flightNumber, altitude }]`
 * @param context.selectedCallsign {string} callsign of the aircraft selected on the scope, used when none is named
 * @param context.fixes {array<string>} fix names that exist at this airport (used to validate "direct" and "hold")
 * @param context.resolveAirport {function} optional; given words returns an ICAO code when an airport is named ("manchester")
 * @param context.runways {array<string>} runway names at this airport ("09L"), used to resolve spoken runway numbers
 * @return {object} `{ transmissions, appActions, controller_note, repairedText }`
 */
export const interpretLocally = (text, context = {}) => {
    const aircraft = context.aircraft || [];
    const repairedText = repairTranscript(text, { telephonyWords: telephonyWordsOf(aircraft), fixNames: context.fixes || [] });
    const normalized = separateGluedCommandLetter(normalizeTranscript(repairedText), aircraft);
    const fixes = context.fixes && context.fixes.length > 0 ? new Set(context.fixes.map((fix) => fix.toUpperCase())) : null;
    const runways = context.runways && context.runways.length > 0 ? new Set(context.runways.map((name) => name.toUpperCase())) : null;

    if (!normalized) {
        return {
            transmissions: [], appActions: [], controller_note: 'Nothing was heard.', repairedText
        };
    }

    let mentions = findMentions(normalized, aircraft);

    // the same aircraft mentioned twice (call-up and readback) counts once, at its first mention
    mentions = mentions.filter((mention, index) => mentions.findIndex((other) => other.aircraft.callsign === mention.aircraft.callsign) === index);

    const appActions = parseAppActions(normalized, { resolveAirport: context.resolveAirport, hasAircraftMention: mentions.length > 0 });

    if (mentions.length === 0) {
        const selected = aircraft.find((candidate) => candidate.callsign === context.selectedCallsign);

        // with an aircraft selected, a sentence about "you" is for the pilot; anything else that is an application command is one
        const isForPilot = /\b(?:you|your)\b/.test(normalized) || appActions.length === 0;

        if (!selected || !isForPilot) {
            if (appActions.length > 0) {
                return {
                    transmissions: [], appActions, controller_note: '', repairedText
                };
            }

            return {
                transmissions: [],
                appActions: [],
                controller_note: 'No aircraft was addressed. Start with a callsign (eg "Speedbird one two three, descend ...") or select an aircraft first.',
                repairedText
            };
        }

        mentions = [{ aircraft: selected, start: 0, end: 0 }];
    }

    const transmissions = mentions.map((mention, index) => {
        const nextStart = index + 1 < mentions.length ? mentions[index + 1].start : normalized.length;
        const segment = normalized.slice(mention.end, nextStart).trim();
        const commands = extractCommands(segment, mention.aircraft, { fixes, runways, resolveAirport: context.resolveAirport });

        if (commands.length === 0) {
            return {
                callsign: mention.aircraft.callsign, commands: [], reply: 'say again', intent: 'unclear'
            };
        }

        return {
            callsign: mention.aircraft.callsign, commands, reply: '', intent: commands[0] === 'roger' || commands[0] === 'unable' ? 'request' : 'command'
        };
    });

    return {
        transmissions, appActions: [], controller_note: '', repairedText
    };
};
