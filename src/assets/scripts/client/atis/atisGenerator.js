import {
    ATIS_LETTERS,
    DEFAULT_TRANSITION_ALTITUDE,
    IMPERIAL_PREFIXES,
    TRANSITION_ALTITUDE_BY_PREFIX
} from '../weather/weatherConstants';

/**
 * Builds ATIS broadcasts (written D-ATIS style and fully spoken) from the simulated weather and the
 * airport's operational state.
 *
 * Content and ordering follow the ICAO / UK CAP 413 convention: identification and information letter,
 * time, runway in use and expected approach, transition level, surface wind, visibility, RVR when low,
 * present weather, cloud, temperature and dewpoint, QNH, trend, remarks, and the request to
 * acknowledge receipt on first contact.
 *
 * Pure functions only, so the whole module is unit testable.
 */

const DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
const RUNWAY_SUFFIX_WORDS = { L: 'left', R: 'right', C: 'centre' };

const PHENOMENA_WORDS = {
    RA: 'rain',
    '-RA': 'light rain',
    '+RA': 'heavy rain',
    SHRA: 'rain showers',
    '-SHRA': 'light rain showers',
    '+SHRA': 'heavy rain showers',
    TSRA: 'thunderstorm with rain',
    '+TSRA': 'thunderstorm with heavy rain',
    TS: 'thunderstorm',
    SN: 'snow',
    '-SN': 'light snow',
    '+SN': 'heavy snow',
    FG: 'fog',
    BR: 'mist',
    HZ: 'haze'
};

const COVER_WORDS = {
    FEW: 'few', SCT: 'scattered', BKN: 'broken', OVC: 'overcast'
};
const COVER_WRITTEN = {
    FEW: 'FEW', SCT: 'SCT', BKN: 'BKN', OVC: 'OVC'
};

/**
 * Pronounce a string digit by digit ("1008" -> "one zero zero eight")
 *
 * @function spokenDigits
 * @param value {string|number}
 * @return {string}
 */
export const spokenDigits = (value) => String(value)
    .split('')
    .map((character) => (/\d/.test(character) ? DIGIT_WORDS[Number(character)] : character))
    .join(' ');

/**
 * "27L" -> "two seven left"
 *
 * @function spokenRunway
 * @param runwayName {string}
 * @return {string}
 */
export const spokenRunway = (runwayName) => String(runwayName)
    .toUpperCase()
    .split('')
    .map((character) => {
        if (/\d/.test(character)) {
            return DIGIT_WORDS[Number(character)];
        }

        return RUNWAY_SUFFIX_WORDS[character] || character.toLowerCase();
    })
    .join(' ');

/**
 * Pronounce a height or distance in the aviation way ("2500" -> "two thousand five hundred")
 *
 * @function spokenQuantity
 * @param value {number}
 * @return {string}
 */
export const spokenQuantity = (value) => {
    const rounded = Math.round(value);

    if (rounded === 0) {
        return 'zero';
    }

    const thousands = Math.floor(rounded / 1000);
    const hundreds = Math.floor((rounded % 1000) / 100);
    const remainder = rounded % 100;
    const parts = [];

    if (thousands > 0) {
        parts.push(`${spokenDigits(thousands)} thousand`);
    }

    if (hundreds > 0) {
        parts.push(`${DIGIT_WORDS[hundreds]} hundred`);
    }

    if (remainder > 0) {
        parts.push(spokenDigits(remainder));
    }

    return parts.join(' ');
};

/**
 * @function getInformationLetter
 * @param index {number} 0 -> ALPHA
 * @return {string}
 */
export const getInformationLetter = (index) => ATIS_LETTERS[((index % ATIS_LETTERS.length) + ATIS_LETTERS.length) % ATIS_LETTERS.length];

/**
 * @function getNextInformationLetter
 * @param letter {string}
 * @return {string}
 */
export const getNextInformationLetter = (letter) => {
    const index = ATIS_LETTERS.indexOf(String(letter).toUpperCase());

    return getInformationLetter(index + 1);
};

/**
 * Whether an airport reports in imperial units (US, Canada)
 *
 * @function usesImperialUnits
 * @param icao {string}
 * @return {boolean}
 */
export const usesImperialUnits = (icao) => {
    const prefix = String(icao).toUpperCase()[0];

    return IMPERIAL_PREFIXES.indexOf(prefix) !== -1;
};

/**
 * Transition altitude, in feet, for an airport (explicit airport value wins over the regional default)
 *
 * @function getTransitionAltitude
 * @param icao {string}
 * @param explicitFeet {number} optional per-airport value from the airport file
 * @return {number}
 */
export const getTransitionAltitude = (icao, explicitFeet = null) => {
    if (Number.isFinite(explicitFeet) && explicitFeet > 0) {
        return explicitFeet;
    }

    const code = String(icao).toUpperCase();

    return TRANSITION_ALTITUDE_BY_PREFIX[code.slice(0, 2)] ||
        TRANSITION_ALTITUDE_BY_PREFIX[code.slice(0, 1)] ||
        DEFAULT_TRANSITION_ALTITUDE;
};

/**
 * Transition level (flight level, multiple of 5) for a transition altitude and QNH
 *
 * The pressure altitude of the transition altitude is found with the usual 27 ft per hPa, 1000 ft of
 * clearance is added, and the result is rounded up to the next available level.
 *
 * @function computeTransitionLevel
 * @param transitionAltitudeFeet {number}
 * @param qnhHpa {number}
 * @return {number} flight level, eg. `70`
 */
export const computeTransitionLevel = (transitionAltitudeFeet, qnhHpa) => {
    const pressureAltitude = transitionAltitudeFeet + ((1013 - qnhHpa) * 27);

    return Math.ceil((pressureAltitude + 1000) / 500) * 5;
};

const formatTemperatureWritten = (value) => (value < 0 ? `M${String(Math.abs(value)).padStart(2, '0')}` : String(value).padStart(2, '0'));
const formatTemperatureSpoken = (value) => (value < 0 ? `minus ${spokenDigits(Math.abs(value))}` : spokenDigits(value));

const describePhenomena = (phenomena) => phenomena.map((code) => PHENOMENA_WORDS[code] || code.toLowerCase());

/**
 * CAVOK applies when visibility is 10 km or more, no cloud below 5000 ft, no CB/TCU and no significant weather
 *
 * @function isCavok
 * @param weather {object}
 * @return {boolean}
 */
export const isCavok = (weather) => weather.visibilityMeters >= 9999 &&
    weather.phenomena.length === 0 &&
    weather.cloud.every((layer) => layer.baseFt >= 5000 && !layer.type);

/**
 * @function buildWindPhrases
 * @param weather {object}
 * @return {object} `{ written, spoken }`
 */
export const buildWindPhrases = (weather) => {
    const {
        windDirection, windSpeed, windGust, windVariableFrom, windVariableTo
    } = weather;

    if (windSpeed === 0) {
        return { written: 'WIND CALM', spoken: 'wind calm' };
    }

    if (windSpeed < 3) {
        return {
            written: `WIND VRB${String(windSpeed).padStart(2, '0')}KT`,
            spoken: `wind variable at ${spokenDigits(windSpeed)} knots`
        };
    }

    const direction = String(windDirection).padStart(3, '0');
    let written = `WIND ${direction}/${String(windSpeed).padStart(2, '0')}KT`;
    let spoken = `wind ${spokenDigits(direction)} degrees ${spokenDigits(windSpeed)} knots`;

    if (windGust) {
        written += ` GUSTING ${windGust}KT`;
        spoken += `, gusting ${spokenDigits(windGust)} knots`;
    }

    if (windVariableFrom && windVariableTo) {
        written += ` VRB BTN ${String(windVariableFrom).padStart(3, '0')}/${String(windVariableTo).padStart(3, '0')}`;
        spoken += `, varying between ${spokenDigits(String(windVariableFrom).padStart(3, '0'))} and ${spokenDigits(String(windVariableTo).padStart(3, '0'))} degrees`;
    }

    return { written, spoken };
};

/**
 * @function buildVisibilityPhrases
 * @param weather {object}
 * @param imperial {boolean}
 * @return {object} `{ written, spoken }`
 */
export const buildVisibilityPhrases = (weather, imperial = false) => {
    const meters = weather.visibilityMeters;

    if (imperial) {
        const rawMiles = meters / 1609;
        // whole statute miles from 3 up, quarter miles below that (as in a METAR)
        let miles = Math.max(0.25, Math.round(rawMiles * 4) / 4);

        if (meters >= 9999) {
            miles = 10;
        } else if (rawMiles >= 3) {
            miles = Math.round(rawMiles);
        }

        const spokenMiles = miles >= 10 ? 'one zero' : spokenDigits(String(miles).replace('.', ' point '));

        return {
            written: `VISIBILITY ${miles}SM`,
            spoken: `visibility ${spokenMiles} miles`
        };
    }

    if (meters >= 9999) {
        return { written: 'VISIBILITY 10KM OR MORE', spoken: 'visibility one zero kilometres or more' };
    }

    if (meters >= 5000) {
        return { written: `VISIBILITY ${meters / 1000}KM`, spoken: `visibility ${spokenDigits(meters / 1000)} kilometres` };
    }

    return { written: `VISIBILITY ${meters}M`, spoken: `visibility ${spokenQuantity(meters)} metres` };
};

/**
 * @function buildCloudPhrases
 * @param weather {object}
 * @return {object} `{ written, spoken }`
 */
export const buildCloudPhrases = (weather) => {
    if (isCavok(weather)) {
        return { written: 'CAVOK', spoken: 'CAVOK' };
    }

    if (weather.cloud.length === 0) {
        return { written: 'NO SIGNIFICANT CLOUD', spoken: 'no significant cloud' };
    }

    const written = [];
    const spoken = [];

    weather.cloud.forEach((layer) => {
        if (layer.cover === 'VV') {
            written.push(`VV${String(Math.round(layer.baseFt / 100)).padStart(3, '0')}`);
            spoken.push(`sky obscured, vertical visibility ${spokenQuantity(layer.baseFt)} feet`);

            return;
        }

        const typeWritten = layer.type || '';
        const typeSpoken = layer.type === 'CB' ? ' cumulonimbus' : '';

        written.push(`${COVER_WRITTEN[layer.cover]}${String(Math.round(layer.baseFt / 100)).padStart(3, '0')}${typeWritten}`);
        spoken.push(`${COVER_WORDS[layer.cover]}${typeSpoken} ${spokenQuantity(layer.baseFt)} feet`);
    });

    return { written: `CLOUD ${written.join(' ')}`, spoken: `cloud ${spoken.join(', ')}` };
};

/**
 * @function buildPressurePhrases
 * @param weather {object}
 * @param imperial {boolean}
 * @return {object} `{ written, spoken }`
 */
export const buildPressurePhrases = (weather, imperial = false) => {
    if (imperial) {
        const inHg = Math.round(weather.qnhHpa * 0.02953 * 100);

        return {
            written: `ALTIMETER ${(inHg / 100).toFixed(2)}`,
            spoken: `altimeter ${spokenDigits(String(inHg))}`
        };
    }

    return { written: `QNH ${weather.qnhHpa}`, spoken: `QNH ${spokenDigits(weather.qnhHpa)}` };
};

/**
 * @function buildTrendPhrases
 * @param upcoming {object|null} forecast from `WeatherModel.getUpcoming()`
 * @return {object} `{ written, spoken }`
 */
export const buildTrendPhrases = (upcoming) => {
    if (!upcoming) {
        return { written: 'TREND NOSIG', spoken: 'trend, no significant change' };
    }

    const changes = [];
    const spokenChanges = [];

    if (upcoming.visibilityMeters < 9999) {
        changes.push(`VIS ${upcoming.visibilityMeters}M`);
        spokenChanges.push(`visibility ${upcoming.visibilityMeters >= 5000 ? `${spokenDigits(upcoming.visibilityMeters / 1000)} kilometres` : `${spokenQuantity(upcoming.visibilityMeters)} metres`}`);
    }

    if (upcoming.phenomena.length > 0) {
        changes.push(upcoming.phenomena.join(' '));
        spokenChanges.push(describePhenomena(upcoming.phenomena).join(' and '));
    }

    if (upcoming.ceilingFeet !== null && upcoming.ceilingFeet < 3000) {
        changes.push(`CIG ${upcoming.ceilingFeet}FT`);
        spokenChanges.push(`cloud ceiling ${spokenQuantity(upcoming.ceilingFeet)} feet`);
    }

    if (changes.length === 0) {
        changes.push('IMPROVING');
        spokenChanges.push('conditions improving');
    }

    return {
        written: `TREND BECMG ${changes.join(' ')} WITHIN ${upcoming.inMinutes} MIN`,
        spoken: `trend, becoming ${spokenChanges.join(', ')} within ${spokenQuantity(upcoming.inMinutes)} minutes`
    };
};

/**
 * Make a written remark readable aloud ("Runway 27 wet" -> "runway two seven wet")
 *
 * @function spokenRemark
 * @param remark {string}
 * @return {string}
 */
export const spokenRemark = (remark) => remark
    .replace(/\brunway (\d{2}[LRC]?)\b/gi, (match, runway) => `runway ${spokenRunway(runway)}`)
    .replace(/\d+/g, (digits) => spokenDigits(digits));

const formatClock = (timeUtc) => {
    const date = timeUtc instanceof Date ? timeUtc : new Date(timeUtc);
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');

    return `${hours}${minutes}`;
};

/**
 * Compose a complete ATIS broadcast
 *
 * @function buildAtis
 * @param input {object}
 * @param input.airportName {string} spoken name, eg. "Liverpool"
 * @param input.icao {string}
 * @param input.letter {string} information letter word, eg. "BRAVO"
 * @param input.timeUtc {Date|number} observation time
 * @param input.type {string} `combined`, `arrival` or `departure`
 * @param input.arrivalRunway {string}
 * @param input.departureRunway {string}
 * @param input.approachType {string} eg. "ILS" or "VISUAL"; blank for none announced
 * @param input.weather {object} snapshot from `WeatherModel`
 * @param input.upcoming {object|null} forecast from `WeatherModel`
 * @param input.transitionAltitudeFeet {number}
 * @param input.remarks {array<string>} NOTAM style lines, user edits and operational notes
 * @param input.contactName {string} unit to call on first contact, eg. "Liverpool Approach"
 * @return {object} `{ letter, timeZ, written, spoken, lines }`
 */
export const buildAtis = ({
    airportName,
    icao,
    letter,
    timeUtc = Date.now(),
    type = 'combined',
    arrivalRunway,
    departureRunway,
    approachType = '',
    weather,
    upcoming = null,
    transitionAltitudeFeet = null,
    remarks = [],
    contactName = ''
}) => {
    const imperial = usesImperialUnits(icao);
    const name = airportName || icao;
    const letterWord = String(letter).toUpperCase();
    const letterChar = letterWord[0];
    const timeZ = formatClock(timeUtc);
    const kind = type === 'combined' ? '' : `${type} `;
    const lines = [];
    const add = (id, written, spoken) => lines.push({ id, written, spoken });

    add(
        'identification',
        `${name.toUpperCase()} ${kind.toUpperCase()}INFORMATION ${letterChar} ${timeZ}Z`,
        `This is ${name} ${kind}information ${letterWord.toLowerCase()}, time ${spokenDigits(timeZ)}`
    );

    const sameRunway = arrivalRunway === departureRunway;
    const approachWritten = approachType ? ` EXPECT ${approachType.toUpperCase()} APPROACH` : '';
    const approachSpoken = approachType ? `, expect ${approachType.toLowerCase() === 'ils' ? 'ILS' : approachType.toLowerCase()} approach` : '';

    if (sameRunway || !departureRunway || !arrivalRunway) {
        const runway = arrivalRunway || departureRunway;

        if (runway) {
            add('runway', `RWY IN USE ${runway}${approachWritten}`, `runway in use ${spokenRunway(runway)}${approachSpoken}`);
        }
    } else {
        add(
            'runway',
            `ARRIVAL RWY ${arrivalRunway}${approachWritten}, DEPARTURE RWY ${departureRunway}`,
            `arrival runway ${spokenRunway(arrivalRunway)}${approachSpoken}, departure runway ${spokenRunway(departureRunway)}`
        );
    }

    if (!imperial) {
        const transitionAltitude = transitionAltitudeFeet || getTransitionAltitude(icao);
        const transitionLevel = computeTransitionLevel(transitionAltitude, weather.qnhHpa);

        add(
            'transition',
            `TRANSITION LEVEL ${transitionLevel}`,
            `transition level ${spokenDigits(String(transitionLevel).padStart(2, '0'))}`
        );
    }

    const wind = buildWindPhrases(weather);

    add('wind', wind.written, wind.spoken);

    const visibility = buildVisibilityPhrases(weather, imperial);
    const lowVisibility = weather.visibilityMeters < 800 || (weather.ceilingFeet !== null && weather.ceilingFeet < 200);

    if (!isCavok(weather)) {
        add('visibility', visibility.written, visibility.spoken);
    }

    if (weather.visibilityMeters < 1500) {
        const rvr = Math.max(50, Math.round((weather.visibilityMeters * 1.1) / 25) * 25);
        const rvrRunway = arrivalRunway || departureRunway;

        if (rvrRunway) {
            add(
                'rvr',
                `RVR RWY ${rvrRunway} ${rvr}M`,
                `RVR runway ${spokenRunway(rvrRunway)} ${spokenQuantity(rvr)} metres`
            );
        }
    }

    if (weather.phenomena.length > 0) {
        add('weather', `WX ${weather.phenomena.join(' ')}`, describePhenomena(weather.phenomena).join(' and '));
    }

    const cloud = buildCloudPhrases(weather);

    add('cloud', cloud.written, cloud.spoken);

    add(
        'temperature',
        `TEMP ${formatTemperatureWritten(weather.temperatureC)} DEW POINT ${formatTemperatureWritten(weather.dewpointC)}`,
        `temperature ${formatTemperatureSpoken(weather.temperatureC)}, dewpoint ${formatTemperatureSpoken(weather.dewpointC)}`
    );

    const pressure = buildPressurePhrases(weather, imperial);

    add('pressure', pressure.written, pressure.spoken);

    const trend = buildTrendPhrases(upcoming);

    add('trend', trend.written, trend.spoken);

    if (lowVisibility) {
        add('lvp', 'LOW VISIBILITY PROCEDURES IN OPERATION', 'low visibility procedures are in operation');
    }

    remarks.filter(Boolean).forEach((remark, index) => {
        add(`remark${index}`, remark.toUpperCase(), spokenRemark(remark));
    });

    const contact = contactName ? ` WITH ${contactName.toUpperCase()}` : '';
    const contactSpoken = contactName ? ` with ${contactName}` : '';

    add(
        'acknowledge',
        `ACKNOWLEDGE RECEIPT OF INFORMATION ${letterChar} ON FIRST CONTACT${contact}`,
        `Acknowledge receipt of information ${letterWord.toLowerCase()} on first contact${contactSpoken}. Information ${letterWord.toLowerCase()} out`
    );

    return {
        letter: letterWord,
        timeZ,
        lines,
        written: lines.map((line) => line.written).join('\n'),
        spoken: lines
            .map((line) => `${line.spoken.charAt(0).toUpperCase()}${line.spoken.slice(1)}.`)
            .join(' ')
            .replace(/\s+/g, ' ')
    };
};
