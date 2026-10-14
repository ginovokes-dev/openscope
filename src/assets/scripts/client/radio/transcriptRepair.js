/**
 * Repairs the usual slips of speech-to-text before a transmission is interpreted
 *
 * Recognisers hear radio phraseology badly: "descend" becomes "center", "heading" becomes "heating", "flight level"
 * becomes "flight love", "speedbird" becomes "speed bird", "four" becomes "for". The repairs are conservative: known
 * mishearings of the phraseology are replaced, words close to a phraseology word (or to a callsign or fix that actually
 * exists right now) are corrected, and nothing else is touched.
 */

// whole-phrase corrections, applied to the lower-case transcript; longer phrases first
const PHRASE_FIXES = [
    [/\bthe (?:sent|cent|center|centre|scent)\b/g, 'descend'],
    [/\b(?:fly(?:te)?|fright|light|flat|flight) (?:love|lever|leaves|label|lovel|leval|levels)\b/g, 'flight level'],
    [/\bflightlevel\b/g, 'flight level'],
    [/\bflight (?:alert|lover)\b/g, 'flight level'],
    [/\bi\.? ?l\.? ?s\b/g, 'ils'],
    [/\bi'?ll(?:s)?\b(?= (?:runway|approach|\d))/g, 'ils'],
    [/\bspeed ?(?:bird|burt|bert|byrd)\b/g, 'speedbird'],
    [/\bryan ?air\b/g, 'ryanair'],
    [/\beasy ?jet\b/g, 'easy'],
    [/\bwiz ?air\b/g, 'wizzair'],
    [/\bline ?up and (?:wait|weight)\b/g, 'line up and wait'],
    [/\btake[- ]?off\b/g, 'takeoff'],
    [/\brun ?(?:way|weigh)\b/g, 'runway'],
    [/\bground ?speed\b/g, 'ground speed']
];

// single-word corrections for words that are almost never meant literally in an ATC sentence
const WORD_FIXES = {
    center: 'descend',
    centre: 'descend',
    sent: 'descend',
    cent: 'descend',
    scent: 'descend',
    decent: 'descend',
    descent: 'descend',
    dissent: 'descend',
    descended: 'descend',
    descending: 'descend',
    desend: 'descend',
    deescend: 'descend',
    climbed: 'climb',
    climbing: 'climb',
    clime: 'climb',
    clam: 'climb',
    climb: 'climb',
    heating: 'heading',
    heeding: 'heading',
    hating: 'heading',
    heady: 'heading',
    hedding: 'heading',
    heiding: 'heading',
    maintaining: 'maintain',
    maintained: 'maintain',
    mainstain: 'maintain',
    reduced: 'reduce',
    reducing: 'reduce',
    increased: 'increase',
    increasing: 'increase',
    runaway: 'runway',
    ronway: 'runway',
    roundway: 'runway',
    knotts: 'knots',
    nots: 'knots',
    nauts: 'knots',
    squark: 'squawk',
    squork: 'squawk',
    squaw: 'squawk',
    squad: 'squawk',
    ills: 'ils',
    isles: 'ils',
    expect: 'expect',
    expected: 'expect',
    cleared: 'cleared',
    clear: 'cleared',
    cleaned: 'cleared',
    cleert: 'cleared',
    direct: 'direct',
    directly: 'direct',
    dairect: 'direct',
    proceed: 'proceed',
    proceeding: 'proceed',
    preceed: 'proceed',
    expedite: 'expedite',
    expediting: 'expedite',
    expedited: 'expedite',
    squawking: 'squawk',
    divert: 'divert',
    diverting: 'divert',
    diversion: 'divert',
    fuel: 'fuel',
    fule: 'fuel',
    fuell: 'fuel'
};

// words that should be matched to the phraseology vocabulary by edit distance
const VOCABULARY = [
    'climb', 'descend', 'maintain', 'altitude', 'heading', 'turn', 'left', 'right', 'speed', 'reduce', 'increase', 'knots',
    'cleared', 'takeoff', 'approach', 'runway', 'taxi', 'hold', 'short', 'position', 'squawk', 'direct', 'proceed',
    'expedite', 'level', 'flight', 'degrees', 'resume', 'navigation', 'contact', 'frequency', 'expect', 'localiser',
    'fuel', 'remaining', 'persons', 'souls', 'intentions', 'divert', 'around', 'missed', 'present', 'continue', 'cancel',
    'information', 'wait', 'line', 'immediately', 'unable', 'roger', 'wilco', 'affirm', 'negative', 'say', 'again',
    'report', 'request', 'pushback', 'start', 'ground', 'tower', 'departure', 'clearance', 'vectors', 'established'
];

const NUMBER_WORD = /^(?:zero|oh|one|two|three|tree|four|five|fife|six|seven|eight|nine|niner|\d+)$/;

const editDistance = (a, b) => {
    if (a === b) {
        return 0;
    }

    const previous = Array.from({ length: b.length + 1 }, (_, i) => i);

    for (let i = 1; i <= a.length; i++) {
        let diagonal = previous[0];

        previous[0] = i;

        for (let j = 1; j <= b.length; j++) {
            const above = previous[j];

            previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
            diagonal = above;
        }
    }

    return previous[b.length];
};

/**
 * The closest word of `candidates` to `word`, when it is close enough to be a mishearing
 *
 * @function closestWord
 * @param word {string}
 * @param candidates {array<string>}
 * @return {string|null}
 */
export const closestWord = (word, candidates) => {
    if (word.length < 4) {
        return null;
    }

    const allowed = word.length >= 8 ? 2 : 1;
    let best = null;
    let bestDistance = allowed + 1;

    candidates.forEach((candidate) => {
        if (Math.abs(candidate.length - word.length) > allowed) {
            return;
        }

        const distance = editDistance(word, candidate);

        if (distance < bestDistance) {
            best = candidate;
            bestDistance = distance;
        }
    });

    return bestDistance <= allowed ? best : null;
};

/**
 * Repair a transcript
 *
 * @function repairTranscript
 * @param text {string}
 * @param context {object} `{ telephonyWords: array<string>, fixNames: array<string> }` words that exist right now
 * @return {string} lower case text
 */
export const repairTranscript = (text, context = {}) => {
    let repaired = String(text || '').toLowerCase().replace(/[“”"]/g, ' ').replace(/\s+/g, ' ')
        .trim();

    PHRASE_FIXES.forEach(([pattern, replacement]) => {
        repaired = repaired.replace(pattern, replacement);
    });

    const telephony = (context.telephonyWords || []).map((word) => word.toLowerCase()).filter((word) => word.length >= 4);
    const fixes = (context.fixNames || []).map((name) => name.toLowerCase()).filter((name) => name.length >= 4);
    const words = repaired.split(' ');

    const out = words.map((word, index) => {
        const bare = word.replace(/[.,;:!?]+$/g, '');
        const trail = word.slice(bare.length);
        const previous = words[index - 1] || '';
        const next = words[index + 1] || '';

        if (bare === 'for' || bare === 'fore') {
            // "heading two seven for" / "for five zero": a number inside a run of numbers
            return (NUMBER_WORD.test(previous) || NUMBER_WORD.test(next) ? 'four' : bare) + trail;
        }

        if (bare === 'won' && (NUMBER_WORD.test(previous) || NUMBER_WORD.test(next))) {
            return `one${trail}`;
        }

        if (bare === 'ate' && (NUMBER_WORD.test(previous) || NUMBER_WORD.test(next))) {
            return `eight${trail}`;
        }

        if (WORD_FIXES[bare] !== undefined) {
            // "clear"/"direct"/"fuel" are real words: only change those that are genuinely different
            return WORD_FIXES[bare] + trail;
        }

        if (telephony.indexOf(bare) !== -1 || VOCABULARY.indexOf(bare) !== -1 || NUMBER_WORD.test(bare)) {
            return word;
        }

        const afterNavigationWord = /^(?:direct|proceed|hold|to|via|over|at)$/.test(previous);
        const nearTelephony = closestWord(bare, telephony);

        if (nearTelephony) {
            return nearTelephony + trail;
        }

        const nearWord = closestWord(bare, VOCABULARY);

        if (nearWord) {
            return nearWord + trail;
        }

        if (afterNavigationWord) {
            const nearFix = closestWord(bare, fixes);

            if (nearFix) {
                return nearFix + trail;
            }
        }

        return word;
    });

    return out.join(' ');
};

const FUNCTION_WORDS = new Set([
    'the', 'to', 'and', 'at', 'on', 'of', 'for', 'a', 'in', 'is', 'you', 'your', 'me', 'it', 'please', 'with', 'via', 'then',
    'thousand', 'hundred', 'feet', 'foot', 'point', 'degrees', 'ils', 'fl', 'if', 'do', 'have', 'can', 'what', 'which', 'how', 'much'
]);

// the controller's one-letter shorthand ("d 20", "c 30", "h 270", "s 210", "t l 270") and its usual mis-hearings
const SHORTHAND_WORDS = new Set(['d', 'dee', 'c', 'h', 's', 't', 'l', 'r', 'sp', 'fh', 'cto', 'caf', 'lu', 'hp', 'ga', 'ils']);

const NATO_WORDS = new Set([
    'alpha', 'alfa', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima', 'mike',
    'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango', 'uniform', 'victor', 'whiskey', 'xray', 'yankee', 'zulu'
]);

/**
 * How much a transcript looks like something said to a pilot: used to choose between the alternatives a speech
 * recogniser offers
 *
 * @function scoreTranscript
 * @param text {string}
 * @param context {object} `{ telephonyWords, fixNames }`
 * @return {number} higher is better
 */
export const scoreTranscript = (text, context = {}) => {
    const repaired = repairTranscript(text, context);
    const tokens = repaired.split(' ').filter(Boolean);

    if (tokens.length === 0) {
        return 0;
    }

    const telephony = new Set((context.telephonyWords || []).map((word) => word.toLowerCase()));
    const fixes = new Set((context.fixNames || []).map((name) => name.toLowerCase()));
    let known = 0;
    let hasTelephony = false;
    let hasVerb = false;

    tokens.forEach((token, index) => {
        const isKnown = VOCABULARY.indexOf(token) !== -1 || FUNCTION_WORDS.has(token) || NATO_WORDS.has(token) || SHORTHAND_WORDS.has(token) ||
            NUMBER_WORD.test(token) || telephony.has(token) || fixes.has(token) || /^(?:fl)?\d+[a-z]?$/.test(token) || /^[dchs]-?\d{1,5}$/.test(token);

        if (isKnown) {
            known += 1;
        }

        if (telephony.has(token)) {
            hasTelephony = true;
        }

        if (/^(?:climb|descend|maintain|turn|heading|speed|reduce|increase|cleared|taxi|hold|squawk|direct|proceed|expect|contact|say|report|divert|fuel)$/.test(token) ||
            /^[dchs]-?\d{1,5}$/.test(token) || (/^(?:d|dee|c|h|s)$/.test(token) && NUMBER_WORD.test(tokens[index + 1] || ''))) {
            hasVerb = true;
        }
    });

    return (known / tokens.length) + (hasTelephony ? 0.5 : 0) + (hasVerb ? 0.3 : 0);
};
