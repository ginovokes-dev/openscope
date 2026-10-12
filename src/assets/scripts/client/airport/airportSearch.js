/**
 * Search text for the airport switcher
 *
 * With several hundred airports the switcher has to be searchable by what people actually remember: the city
 * ("liverpool"), the IATA code ("man"), the country ("united kingdom", "uk", "france") or part of the name.
 */

// extra words people use for the countries that are not what the ISO name says
const COUNTRY_ALIASES = {
    GB: 'uk u.k. united kingdom great britain britain england scotland wales northern ireland',
    US: 'usa u.s.a. united states america',
    AE: 'uae emirates',
    KR: 'south korea korea',
    CZ: 'czech republic czechia',
    RU: 'russia russian federation'
};

let regionNames = null;

const getRegionNames = () => {
    if (regionNames === null) {
        try {
            regionNames = typeof Intl !== 'undefined' && Intl.DisplayNames ? new Intl.DisplayNames(['en'], { type: 'region' }) : false;
        } catch (error) {
            regionNames = false;
        }
    }

    return regionNames;
};

/**
 * Country name for an ISO 3166 alpha-2 code ("GB" -> "United Kingdom"); falls back to the code
 *
 * @function getCountryName
 * @param countryCode {string}
 * @return {string}
 */
export const getCountryName = (countryCode) => {
    const code = String(countryCode || '').toUpperCase();

    if (!code) {
        return '';
    }

    const names = getRegionNames();

    try {
        return (names && names.of(code)) || code;
    } catch (error) {
        return code;
    }
};

/**
 * All the words an airport can be found by, lower case
 *
 * @function buildAirportKeywords
 * @param airport {object} `{ icao, iata, name, city, country }`
 * @return {string}
 */
export const buildAirportKeywords = ({
    icao, iata, name, city, country
}) => {
    const code = String(country || '').toUpperCase();

    return [icao, iata, name, city, code, getCountryName(code), COUNTRY_ALIASES[code]]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
};

/**
 * Every whitespace separated term of the query has to appear somewhere in the keywords
 *
 * @function matchesAirportQuery
 * @param keywords {string} lower case
 * @param query {string}
 * @return {boolean}
 */
export const matchesAirportQuery = (keywords, query) => {
    const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);

    return terms.every((term) => keywords.indexOf(term) !== -1);
};
