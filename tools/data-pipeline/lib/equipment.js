'use strict';
/**
 * Hand-written mapping from IATA equipment codes (as found in the OpenFlights
 * `routes.dat` "equipment" column) to openScope aircraft type designators (the
 * ICAO type code, matching `assets/aircraft/<icao>.json`).
 *
 * - A value is either a single ICAO code, or an array of `[icao, weight]` pairs when a
 *   generic family code (e.g. "CRJ", "330", "DH8") should be split across several variants.
 * - Codes that are not in the table, or that map to a type for which no
 *   `assets/aircraft/<icao>.json` exists, are dropped by `mapEquipment` (the caller
 *   passes the set of types that exist).
 * - Some real aircraft have no openScope equivalent (Fokker 28, Yak-40, Il-114 ...).
 *   They are deliberately absent so they are dropped rather than mis-mapped.
 * - Modernisation: generic "family" codes map to the most common current variant
 *   (e.g. 737 -> B738, 320 -> A320) because the route data is a ~2014 snapshot and
 *   the simulator is used with present-day fleets.
 *
 * Codes were assigned from knowledge of the IATA three-character aircraft type
 * convention and cross-checked against the OpenFlights `planes.dat` list. Unknown
 * or doubtful codes are intentionally left out (they are simply dropped).
 */

const EQUIPMENT_MAP = {
    // ---- Airbus narrowbody ----
    '318': 'A318',
    '319': 'A319',
    '31N': 'A319', // A319neo has no type file: closest
    '320': 'A320',
    '32A': 'A320', // A320 with sharklets
    '32S': 'A320', // generic A318/319/320/321 family
    '32N': 'A20N',
    '321': 'A321',
    '32B': 'A321', // A321 with sharklets
    '32C': 'A319', // A319 with sharklets
    '32Q': 'A21N',
    // ---- Airbus widebody ----
    '300': 'A306',
    '30F': 'A306',
    '310': 'A310',
    '312': 'A310',
    '313': 'A310',
    '31F': 'A310',
    '330': [['A333', 3], ['A332', 2]],
    '332': 'A332',
    '333': 'A333',
    '33X': 'A332', // A330-200F
    '33F': 'A332',
    '338': 'A338',
    '339': 'A339',
    '340': [['A343', 3], ['A346', 1]],
    '342': 'A343',
    '343': 'A343',
    '345': 'A345',
    '346': 'A346',
    '350': 'A359',
    '359': 'A359',
    '351': 'A35K',
    '35K': 'A35K',
    '380': 'A388',
    '388': 'A388',
    'AB4': 'A30B',
    'AB6': 'A306',
    'ABF': 'A306',
    // ---- Boeing 717/727/737 ----
    '717': 'B712',
    '721': 'B722',
    '722': 'B722',
    '727': 'B722',
    '72F': 'B722',
    '732': 'B732',
    '73S': 'B732',
    '73M': 'B732',
    '73X': 'B732',
    '733': 'B733',
    '73N': 'B733',
    '73C': 'B733',
    '73Y': 'B733',
    '734': 'B734',
    '73Q': 'B734',
    '735': 'B735',
    '736': 'B736',
    '737': 'B737',
    '73G': 'B737', // 737-700
    '73W': 'B737', // 737-700 winglets
    '73R': 'B737',
    '738': 'B738',
    '73H': 'B738', // 737-800 winglets
    '739': 'B739',
    '73J': 'B739', // 737-900 winglets
    '7M8': 'B38M',
    '7M9': 'B39M',
    '7M7': 'B737',
    // ---- Boeing 747/757/767/777/787 ----
    '741': 'B741',
    '742': 'B742',
    '743': 'B743',
    '744': 'B744',
    '747': 'B744',
    '74E': 'B744',
    '74M': 'B744',
    '74D': 'B743',
    '74J': 'B744',
    '74N': 'B748', // 747-8F
    '74H': 'B748',
    '748': 'B748',
    '74L': 'B74S',
    '74Y': 'B744',
    '752': 'B752',
    '757': 'B752',
    '75W': 'B752',
    '75T': 'B752',
    '75F': 'B752',
    '753': 'B753',
    '762': 'B762',
    '763': 'B763',
    '767': 'B763',
    '76W': 'B763',
    '76F': 'B763',
    '764': 'B764',
    '772': 'B772',
    '773': 'B773',
    '777': 'B772',
    '77L': 'B77L',
    '77W': 'B77W',
    '77X': 'B77L', // 777F
    '77F': 'B77L',
    '787': 'B788',
    '788': 'B788',
    '789': 'B789',
    '78X': 'B78X',
    // ---- McDonnell Douglas / Lockheed / Tupolev / Ilyushin ----
    'M80': 'MD82',
    'M81': 'MD81',
    'M82': 'MD82',
    'M83': 'MD83',
    'M87': 'MD87',
    'M88': 'MD88',
    'M90': 'MD90',
    'M11': 'MD11',
    'M1F': 'MD11',
    'D10': 'DC10',
    'D11': 'DC10',
    'D1C': 'DC10',
    'D1M': 'DC10',
    'D1F': 'DC10',
    'D1X': 'DC10',
    'DC9': 'DC93',
    'D93': 'DC93',
    'D95': 'DC93',
    'D9S': 'DC93',
    'DC8': 'DC87',
    'L10': 'L101',
    'L11': 'L101',
    'TU3': 'T134',
    'TU5': 'T154',
    'T20': 'T204',
    'IL6': 'IL62',
    'IL9': 'IL96',
    'IL7': 'IL76',
    'A81': 'A148',
    'AN4': 'AN24',
    'AN7': 'AN72',
    'ANF': 'AN12',
    // ---- Regional jets ----
    'CRJ': [['CRJ7', 3], ['CRJ9', 3], ['CRJ2', 2]],
    'CR1': 'CRJ2',
    'CR2': 'CRJ2',
    'CR7': 'CRJ7',
    'CR9': 'CRJ9',
    'CRA': 'CRJ7',
    'CRK': 'CRJX',
    'CS1': 'BCS1',
    'CS3': 'BCS3',
    '221': 'BCS1',
    '223': 'BCS3',
    'ERJ': [['E145', 3], ['E135', 1]],
    'ER3': 'E135',
    'ER4': 'E145',
    'ERD': 'E145', // ERJ-140
    'E70': 'E170',
    'E75': 'E75L',
    'E7W': 'E75L',
    'E90': 'E190',
    'E95': 'E190',
    'E9W': 'E190',
    'EMJ': [['E170', 2], ['E190', 3]],
    'E29': 'E290',
    '290': 'E290',
    '295': 'E290',
    '100': 'F100',
    'F100': 'F100',
    'F70': 'F70',
    '146': 'RJ85',
    '141': 'B462',
    '142': 'B462',
    '143': 'B463',
    'AR1': 'RJ1H',
    'AR8': 'RJ85',
    'AR7': 'RJ70',
    'ARJ': 'RJ85',
    'FRJ': 'J328',
    'SU9': 'SU95',
    'SSJ': 'SU95',
    // ---- Turboprops ----
    'ATR': [['AT72', 3], ['AT75', 1], ['AT45', 1]],
    'AT4': 'AT43',
    'AT5': 'AT45',
    'AT7': 'AT72',
    'AT3': 'AT43',
    'AT6': 'AT76',
    'ATP': 'ATP',
    'DH1': 'DH8A',
    'DH2': 'DH8B',
    'DH3': 'DH8C',
    'DH4': 'DH8D',
    'DH8': [['DH8D', 4], ['DH8C', 1], ['DH8B', 1]],
    'DHT': 'DHC6',
    'DH6': 'DHC6',
    'SF3': 'SF34',
    'SFB': 'SF34',
    'S34': 'SF34',
    'S20': 'SB20',
    'F50': 'F50',
    'F27': 'F50',
    'J31': 'JS31',
    'J32': 'JS32',
    'J41': 'JS41',
    'BE1': 'B190',
    'BEH': 'B190',
    'B19': 'B190',
    'BE9': 'BE20',
    'BEC': 'BE20',
    'BE2': 'BE20',
    'SWM': 'SW4',
    'SW4': 'SW4',
    'EMB': 'E120',
    'EM2': 'E120',
    'E12': 'E120',
    'D28': 'D228',
    'D38': 'D328',
    'L4T': 'L410',
    'CNC': 'C208',
    'CNT': 'C208',
    'C20': 'C208',
    'PL2': 'PC12',
    'PC1': 'PC12',
    'BNI': 'BN2P',
    'BN2': 'BN2P',
    // ---- General aviation / business jets (rare in route data) ----
    'CNA': 'C172',
    'CN1': 'C172',
    'CN2': 'C402',
    'CNJ': 'C550',
    'PA1': 'P28A',
    'CCJ': 'CL60',
    'CL6': 'CL60',
    'CL3': 'CL30',
    'GRJ': 'GLF4',
    'LRJ': 'LJ45'
};

/**
 * Types that count as "long haul" (used to build `long`/`short` airline fleets).
 * Anything with weight class H (heavy) or the 757/A321 family flown on transatlantic.
 * We only use weight class from the aircraft files plus this small allow-list.
 */
const LONG_HAUL_EXTRA = new Set(['B752', 'B753']);

/**
 * @param {string} iataCode
 * @param {Set<string>} knownTypes   ICAO designators that exist in assets/aircraft
 * @returns {Array<[string, number]>} list of [icaoType, weight]; empty when unmappable
 */
function mapEquipment(iataCode, knownTypes) {
    const code = String(iataCode || '').trim().toUpperCase();

    if (!code || !Object.prototype.hasOwnProperty.call(EQUIPMENT_MAP, code)) {
        return [];
    }

    const value = EQUIPMENT_MAP[code];
    const pairs = Array.isArray(value) ? value : [[value, 1]];

    return pairs.filter(([icao]) => knownTypes.has(icao));
}

module.exports = { EQUIPMENT_MAP, LONG_HAUL_EXTRA, mapEquipment };
