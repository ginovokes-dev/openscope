/**
 * Taxiway names as spoken: "via alpha bravo", "via alpha one then zulu" -> `['A', 'B']`, `['A1', 'Z']`
 */

const NATO = {
    alpha: 'A',
    alfa: 'A',
    bravo: 'B',
    charlie: 'C',
    delta: 'D',
    echo: 'E',
    foxtrot: 'F',
    golf: 'G',
    hotel: 'H',
    india: 'I',
    juliet: 'J',
    juliett: 'J',
    kilo: 'K',
    lima: 'L',
    mike: 'M',
    november: 'N',
    oscar: 'O',
    papa: 'P',
    quebec: 'Q',
    romeo: 'R',
    sierra: 'S',
    tango: 'T',
    uniform: 'U',
    victor: 'V',
    whiskey: 'W',
    whisky: 'W',
    xray: 'X',
    yankee: 'Y',
    zulu: 'Z'
};

const DIGITS = {
    zero: '0', one: '1', two: '2', three: '3', tree: '3', four: '4', five: '5', fife: '5', six: '6', seven: '7', eight: '8', nine: '9', niner: '9'
};

const SEPARATORS = new Set(['and', 'then', 'to', 'via', 'along', 'using']);

/**
 * @function parseTaxiwayRefs
 * @param text {string} lower-case text following the word "via"
 * @return {array<string>} taxiway references in the order spoken
 */
export const parseTaxiwayRefs = (text) => {
    const tokens = String(text || '').toLowerCase().replace(/[,.;]/g, ' ').split(/\s+/)
        .filter(Boolean);
    const refs = [];

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        if (SEPARATORS.has(token)) {
            continue;
        }

        let ref = null;

        if (NATO[token]) {
            ref = NATO[token];
        } else if (/^[a-z]\d?$/.test(token) && token !== 'a') {
            ref = token.toUpperCase();
        } else if (/^[a-z]\d{1,2}$/.test(token)) {
            ref = token.toUpperCase();
        }

        if (ref === null) {
            break;
        }

        // "alpha one" / "alpha 1" -> A1
        while (i + 1 < tokens.length && (DIGITS[tokens[i + 1]] !== undefined || /^\d$/.test(tokens[i + 1])) && ref.length < 3) {
            ref += DIGITS[tokens[i + 1]] !== undefined ? DIGITS[tokens[i + 1]] : tokens[i + 1];
            i += 1;
        }

        refs.push(ref);
    }

    return refs;
};
