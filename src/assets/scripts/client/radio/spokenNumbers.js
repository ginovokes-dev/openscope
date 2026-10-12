/**
 * Turns radiotelephony number and letter words into digits and letters, so "speedbird one two three" and
 * "descend flight level one zero zero" can be matched with a few regular expressions.
 *
 * Handles the usual spoken variants and common speech-to-text slips: niner, tree, fife, wun, "to" between digits,
 * "thousand" and "hundred" multipliers, teens and tens, and NATO letters following a flight number.
 */

const DIGIT_WORDS = {
    zero: '0',
    oh: '0',
    one: '1',
    wun: '1',
    two: '2',
    too: '2',
    three: '3',
    tree: '3',
    four: '4',
    fower: '4',
    five: '5',
    fife: '5',
    six: '6',
    seven: '7',
    eight: '8',
    nine: '9',
    niner: '9'
};

const TEEN_WORDS = {
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19
};

const TENS_WORDS = {
    twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90
};

const NATO = {
    alpha: 'a',
    alfa: 'a',
    bravo: 'b',
    charlie: 'c',
    delta: 'd',
    echo: 'e',
    foxtrot: 'f',
    golf: 'g',
    hotel: 'h',
    india: 'i',
    juliet: 'j',
    juliett: 'j',
    kilo: 'k',
    lima: 'l',
    mike: 'm',
    november: 'n',
    oscar: 'o',
    papa: 'p',
    quebec: 'q',
    romeo: 'r',
    sierra: 's',
    tango: 't',
    uniform: 'u',
    victor: 'v',
    whiskey: 'w',
    whisky: 'w',
    xray: 'x',
    yankee: 'y',
    zulu: 'z'
};

const isNumberWord = (word) => DIGIT_WORDS[word] !== undefined || TEEN_WORDS[word] !== undefined ||
    TENS_WORDS[word] !== undefined || word === 'hundred' || word === 'thousand';

const isNumberLike = (word) => word !== undefined && (isNumberWord(word) || /^\d+$/.test(word));

/**
 * Convert a run of number words into a string: digits concatenated, multipliers applied
 *
 * @function composeNumber
 * @param words {array<string>} number words and/or digit strings
 * @return {string}
 */
const composeNumber = (words) => {
    let total = 0;
    let group = '';
    let usedMultiplier = false;

    for (let i = 0; i < words.length; i++) {
        const word = words[i];

        if (word === 'thousand' || word === 'hundred') {
            total += Number(group || 1) * (word === 'thousand' ? 1000 : 100);
            group = '';
            usedMultiplier = true;
        } else if (DIGIT_WORDS[word] !== undefined) {
            group += DIGIT_WORDS[word];
        } else if (TEEN_WORDS[word] !== undefined) {
            group += String(TEEN_WORDS[word]);
        } else if (TENS_WORDS[word] !== undefined) {
            const next = words[i + 1];

            if (DIGIT_WORDS[next] !== undefined && DIGIT_WORDS[next] !== '0') {
                group += String(TENS_WORDS[word] + Number(DIGIT_WORDS[next]));
                i += 1;
            } else {
                group += String(TENS_WORDS[word]);
            }
        } else {
            group += word;
        }
    }

    if (usedMultiplier) {
        return String(total + (group ? Number(group) : 0));
    }

    return group;
};

/**
 * Three or more phonetic letters in a row are a spelled callsign ("golf alpha bravo charlie delta" -> "gabcd")
 *
 * @function collapseSpelledLetters
 * @param tokens {array<string>}
 * @return {array<string>}
 */
const collapseSpelledLetters = (tokens) => {
    const result = [];
    let i = 0;

    while (i < tokens.length) {
        let end = i;

        while (end < tokens.length && NATO[tokens[end]] !== undefined) {
            end += 1;
        }

        if (end - i >= 3) {
            result.push(tokens.slice(i, end).map((word) => NATO[word]).join(''));
            i = end;
        } else {
            result.push(tokens[i]);
            i += 1;
        }
    }

    return result;
};

/**
 * Normalise a transcript: lower case, punctuation removed, spoken numbers and letters converted.
 *
 * "two seven zero" -> "270", "three thousand five hundred" -> "3500", "one two thousand" -> "12000",
 * "runway zero niner left" -> "runway 09 left", "easy six four alpha" -> "easy 64a".
 *
 * @function normalizeTranscript
 * @param text {string}
 * @return {string}
 */
export const normalizeTranscript = (text) => {
    const words = String(text || '')
        .toLowerCase()
        .replace(/[,;:!?()]/g, ' ')
        .replace(/(\d)\.(\d)/g, '$1 point $2')
        .replace(/\.(?=\s|$)/g, ' ')
        .replace(/-/g, ' ')
        .replace(/\bx ray\b/g, 'xray')
        .split(/\s+/)
        .filter(Boolean);
    const output = [];
    let i = 0;

    while (i < words.length) {
        const word = words[i];

        // "to" is the digit two only when it sits inside a run of numbers
        const isNumberStart = isNumberLike(word) && !(word === 'too' && !isNumberLike(words[i + 1]) && !isNumberLike(words[i - 1]));

        if (!isNumberStart) {
            output.push(word);
            i += 1;

            continue;
        }

        const run = [];

        while (i < words.length) {
            if (isNumberLike(words[i])) {
                run.push(words[i]);
                i += 1;
            } else if (words[i] === 'to' && isNumberLike(words[i - 1]) && isNumberLike(words[i + 1])) {
                run.push('two');
                i += 1;
            } else {
                break;
            }
        }

        let composed = composeNumber(run);

        // a flight number such as "six four alpha" or "one one seven kilo sierra" keeps its trailing letters
        let letters = 0;

        while (NATO[words[i]] !== undefined && /^\d+[a-z]*$/.test(composed) && letters < 3) {
            composed += NATO[words[i]];
            letters += 1;
            i += 1;
        }

        output.push(composed);
    }

    return collapseSpelledLetters(output).join(' ');
};

/**
 * Spoken form of a written number, one digit at a time ("27" -> "two seven")
 *
 * @function digitsToWords
 * @param digits {string}
 * @return {string}
 */
export const digitsToWords = (digits) => String(digits)
    .split('')
    .map((digit) => (/\d/.test(digit) ? ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'][Number(digit)] : digit))
    .join(' ');
