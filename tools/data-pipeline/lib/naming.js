'use strict';
/**
 * Naming heuristics: airline radio call signs, airport radio names, spoken navaid names,
 * synthetic (pronounceable) fix names and SID names.
 */

const VOWELS = /[AEIOUY]/i;

/** Remove diacritics and anything outside printable ASCII. */
function asciiFold(str) {
    return String(str || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/ß/g, 'ss')
        .replace(/ø/gi, 'o')
        .replace(/æ/gi, 'ae')
        .replace(/[^\x20-\x7e]/g, '');
}

const COMMON_CLUSTERS = /^(BR|CR|DR|FR|GR|PR|TR|KR|WR|BL|CL|FL|GL|PL|SL|SP|ST|SK|SC|SM|SN|SW|TW|CH|SH|TH|WH|PH|SQ|PS|GN|KN)/;

/** Short all-caps words that are not pronounceable as a word (no vowel, or an unusual leading consonant pair). */
function looksLikeAcronym(word) {
    if (!VOWELS.test(word)) {
        return true;
    }

    return /^[BCDFGHJKLMNPQRSTVWXZ]{2}/.test(word) && !COMMON_CLUSTERS.test(word);
}

/**
 * Clean and title-case an OpenFlights telephony designator.
 * Returns null for entries that are empty/garbage.
 *
 * "SPEEDBIRD" -> "Speedbird", "NOR SHUTTLE" -> "Nor Shuttle", "AL-AAS" -> "Al-Aas",
 * acronym-like words without vowels (CSA, DHL, TNT) keep their capitals.
 *
 * @param {string} raw
 * @returns {string|null}
 */
function cleanCallsignName(raw) {
    let s = asciiFold(raw).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

    s = s.replace(/[.,;:]+$/, '').trim();

    if (!/^[A-Za-z][A-Za-z0-9 '\-]*$/.test(s)) {
        return null;
    }

    const letters = s.replace(/[^A-Za-z]/g, '');

    if (letters.length < 3 || s.length > 26) {
        return null;
    }

    if (/^(n\/?a|none|unknown|test|private|nil|null|undefined|inc|ltd|llc|gmbh|s\.?a\.?)$/i.test(s)) {
        return null;
    }

    // placeholders found in the OpenFlights data ("Assignment Postponed", "Not Assigned", ...)
    if (/(postpone|assign|reserved|not (used|issued|allocated)|no callsign|unknown)/i.test(s)) {
        return null;
    }

    const words = s.split(' ').map((word) => word.split('-').map((part) => {
        if (part === '') {
            return part;
        }

        const wasUpper = part === part.toUpperCase();

        if (wasUpper && part.length >= 2 && part.length <= 4 && looksLikeAcronym(part)) {
            return part; // acronym like CSA / DHL / KLM
        }

        if (wasUpper && part.length === 1) {
            return part;
        }

        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    }).join('-'));

    return words.join(' ');
}

const AIRPORT_NOISE_WORDS = new Set([
    'airport', 'airfield', 'aerodrome', 'airstrip', 'international', 'intl', 'regional', 'municipal',
    'national', 'domestic', 'county', 'city', 'field', 'aeropuerto', 'aeroporto', 'aeroport',
    'flughafen', 'lufthavn', 'lentoasema', 'airbase', 'air', 'base', 'civil', 'joint', 'executive',
    'memorial', 'metropolitan', 'metro', 'general', 'aviation', 'heliport', 'seaplane', 'rafs'
]);

/** "Paris (Roissy-en-France, Val-d'Oise)" -> "Paris"; "Glasgow / Prestwick" -> "Glasgow". */
function cleanCity(raw) {
    return asciiFold(raw).split(/\s*[\/,(]\s*/)[0].replace(/\s+/g, ' ').trim();
}

/** "ST MARY'S" -> "St Mary's"; mixed-case input is left alone. */
function titleCasePlace(s) {
    if (s !== s.toUpperCase()) {
        return s;
    }

    return s.toLowerCase().replace(/(^|[ \-])([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
}

/**
 * Place name used in "<Place> Tower" / "<Place> Approach" / "<Place> Radar".
 *
 * Order of preference:
 *  1. the OurAirports municipality when it appears in the airport name ("Liverpool John Lennon
 *     Airport" -> Liverpool; "Cornwall Airport Newquay" -> Newquay);
 *  2. the airport name minus generic words when that leaves one or two words ("Edinburgh Airport"
 *     -> Edinburgh, although OurAirports files it under the village "Ingliston"; "Donegal Airport");
 *  3. the OpenFlights served city ("Charles de Gaulle International Airport" -> Paris);
 *  4. the OurAirports municipality, then the first words of the name.
 * "London Stansted Airport" becomes "Stansted" (the bare city is ambiguous).
 *
 * @param {string} airportName    official airport name
 * @param {string} municipality   OurAirports municipality
 * @param {string} [servedCity]   OpenFlights city
 * @returns {string}
 */
function airportPlaceName(airportName, municipality, servedCity = '') {
    const name = asciiFold(airportName);
    const words = name.split(/\s+/).filter((w) => w && !AIRPORT_NOISE_WORDS.has(w.toLowerCase()));
    const usable = (s) => s.length >= 3 && s.length <= 24 && !/\d/.test(s);
    const mun = cleanCity(municipality);
    const served = cleanCity(servedCity);
    const nameTokens = ` ${name.toLowerCase().replace(/[^a-z' ]/g, ' ')} `;
    let place = '';

    if (usable(mun) && nameTokens.includes(` ${mun.toLowerCase()} `)) {
        place = mun;

        if (/^london$/i.test(mun) && words.length > 1 && /^london$/i.test(words[0])) {
            place = words.slice(1, 3).join(' ');
        }
    } else if (words.length >= 1 && words.length <= 2) {
        place = words.join(' ');
    } else if (usable(served)) {
        place = served;
    } else if (usable(mun)) {
        place = mun;
    } else {
        place = words.slice(0, 2).join(' ') || name.split(/\s+/).slice(0, 2).join(' ').trim() || 'Airport';
    }

    place = place.replace(/[^A-Za-z0-9 '\-]/g, '').replace(/\s+/g, ' ').trim().replace(/^London (?=\S)/i, '');

    return titleCasePlace(place);
}

/**
 * Spoken name for a navaid-derived fix: "Bovingdon VOR/DME" -> "Bovingdon".
 *
 * @param {string} navaidName
 * @returns {string|null}
 */
function navaidSpokenName(navaidName) {
    let s = asciiFold(navaidName)
        .replace(/\b(VOR|DME|NDB|VORTAC|TACAN|ILS|LOC|LLZ|DME\/TACAN|VOR\/DME|NDB\/DME|BEACON|NON|DIRECTIONAL)\b/gi, ' ')
        .replace(/[^A-Za-z '\-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (s.length < 3 || s.length > 22) {
        return null;
    }

    s = s.toLowerCase();

    return s;
}

const CONSONANTS = 'BCDFGHJKLMNPRSTVWZ';
const VOWEL_LETTERS = 'AEIOU';
const SOFT_BLACKLIST = ['SEX', 'ASS', 'FUC', 'FUK', 'SHIT', 'CUNT', 'DAMN', 'HELL', 'GAY', 'NAZI', 'KKK', 'RAPE', 'DIE', 'KILL', 'NIG', 'FAG', 'TIT', 'COCK', 'PEN', 'BUM', 'POO', 'WTF'];

/**
 * Deterministic pronounceable five letter fix name, e.g. "KEDOR", "TAVLO".
 *
 * @param {{pick: function(Array): *, int: function(number, number): number}} rng
 * @param {function(string): boolean} isTaken
 * @returns {string}
 */
function syntheticFixName(rng, isTaken) {
    for (let attempt = 0; attempt < 500; attempt++) {
        const c = () => CONSONANTS[rng.int(0, CONSONANTS.length - 1)];
        const v = () => VOWEL_LETTERS[rng.int(0, VOWEL_LETTERS.length - 1)];
        const pattern = rng.int(0, 2);
        let name;

        if (pattern === 0) {
            name = c() + v() + c() + v() + c(); // KEDOR
        } else if (pattern === 1) {
            name = c() + v() + c() + c() + v(); // TAVLO
        } else {
            name = v() + c() + v() + c() + v(); // ABUGO
        }

        if (SOFT_BLACKLIST.some((bad) => name.includes(bad)) || isTaken(name)) {
            continue;
        }

        return name;
    }

    throw new Error('Unable to generate a unique synthetic fix name');
}

const NATO = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'Xray', 'Yankee', 'Zulu'];
const NUMBER_WORDS = ['zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

/**
 * SID identifier and spoken name, e.g. ("BNN", 1, 0) -> { icao: "BNN1A", name: "Bovingdon One Alpha" }
 */
function sidName(fixName, spoken, version, letterIndex) {
    const letter = String.fromCharCode(65 + letterIndex);
    const base = spoken || fixName.toLowerCase();
    const titled = base.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    return {
        icao: `${fixName}${version}${letter}`,
        name: `${titled} ${NUMBER_WORDS[version]} ${NATO[letterIndex]}`
    };
}

module.exports = {
    asciiFold,
    cleanCallsignName,
    cleanCity,
    airportPlaceName,
    navaidSpokenName,
    syntheticFixName,
    sidName
};
