'use strict';
/**
 * Detects and repairs a known class of defects in the OpenFlights data.
 *
 * `routes.dat` identifies the operating airline by IATA code *and* an OpenFlights airline id. Where
 * several airlines (historically) shared an IATA code, many route records carry the id of the WRONG
 * airline: e.g. all of Monarch's (ZB) Birmingham-Spain flights are filed under "Air Bourbon" (a
 * Reunion Island carrier), Vueling's (VY) under "Formosa Airlines", Gol's (G3) under "City
 * Connexion Airlines" (Burundi).
 *
 * Heuristic (conservative, documented in the README):
 *  - an airline is SUSPICIOUS when it has at least `minRecords` route records and not one of them
 *    touches an airport in the airline's own registered country;
 *  - if another *active* airline with the same IATA code would have a home-country share of at
 *    least `minShare` on those records, the records are re-attributed to that airline;
 *  - otherwise the suspicious airline's records are dropped (we cannot tell who really flew them).
 *
 * Airlines whose home country cannot be resolved are left alone.
 */

const COUNTRY_ALIASES = {
    'republic of korea': 'KR',
    'south korea': 'KR',
    'democratic peoples republic of korea': 'KP',
    'north korea': 'KP',
    'burma': 'MM',
    'myanmar': 'MM',
    'hong kong sar of china': 'HK',
    'hong kong': 'HK',
    'macao': 'MO',
    'macau': 'MO',
    'lao peoples democratic republic': 'LA',
    'laos': 'LA',
    'russia': 'RU',
    'russian federation': 'RU',
    'ivory coast': 'CI',
    'cote d ivoire': 'CI',
    'congo kinshasa': 'CD',
    'democratic republic of the congo': 'CD',
    'republic of the congo': 'CG',
    'congo brazzaville': 'CG',
    'cape verde': 'CV',
    'east timor': 'TL',
    'swaziland': 'SZ',
    'macedonia': 'MK',
    'syria': 'SY',
    'iran': 'IR',
    'vietnam': 'VN',
    'brunei': 'BN',
    'taiwan': 'TW',
    'palestine': 'PS',
    'bolivia': 'BO',
    'tanzania': 'TZ',
    'moldova': 'MD',
    'venezuela': 'VE'
};

/**
 * Overseas territories count as "home" for their parent state (an airline registered in the US
 * flying San Juan - St Thomas is not mis-attributed).
 */
const HOME_FAMILIES = [
    ['US', 'PR', 'VI', 'GU', 'MP', 'AS', 'UM'],
    ['FR', 'RE', 'GP', 'MQ', 'GF', 'YT', 'NC', 'PF', 'PM', 'WF', 'BL', 'MF', 'TF'],
    ['GB', 'IM', 'JE', 'GG', 'GI', 'BM', 'KY', 'FK', 'AI', 'VG', 'TC', 'MS', 'SH', 'IO'],
    ['DK', 'GL', 'FO'],
    ['IS', 'GL', 'FO'],
    ['NL', 'AW', 'CW', 'SX', 'BQ'],
    ['NZ', 'CK', 'NU', 'TK'],
    ['AU', 'CX', 'CC', 'NF'],
    ['CN', 'HK', 'MO'],
    ['NO', 'SJ'],
    ['FI', 'AX'],
    ['IT', 'VA', 'SM'],
    ['CH', 'LI']
];

function homeSet(iso) {
    const set = new Set([iso]);

    for (const family of HOME_FAMILIES) {
        if (family[0] === iso) {
            family.forEach((c) => set.add(c));
        }
    }

    return set;
}

function fold(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * @param {Object} p
 * @param {Map<string,Object>} p.ofAirlines
 * @param {Array<{airlineId: string, src: string, dst: string, equipment: string[]}>} p.routes
 * @param {Map<string,Object>} p.airports        OurAirports records keyed by ICAO
 * @param {Map<string,string>} p.byIata
 * @param {Map<string,string>} p.ofCodes
 * @param {Map<string,string>} p.countries       ISO code -> OurAirports country name
 * @returns {{routes: Array, repaired: Array, dropped: Array}}
 */
function repairAirlineAttribution({ ofAirlines, routes, airports, byIata, ofCodes, countries, minRecords = 6, minShare = 0.6 }) {
    const nameToIso = new Map();

    for (const [code, name] of countries) {
        nameToIso.set(fold(name), code);
    }

    for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) {
        nameToIso.set(alias, code);
    }

    const countryOfIata = (iata) => {
        const icao = byIata.get(iata) || ofCodes.get(iata);
        const rec = icao ? airports.get(icao) : null;

        return rec ? rec.country : null;
    };

    const recordsById = new Map();

    for (const r of routes) {
        if (!recordsById.has(r.airlineId)) {
            recordsById.set(r.airlineId, []);
        }

        recordsById.get(r.airlineId).push(r);
    }

    const homeShare = (records, iso) => {
        const home = homeSet(iso);
        let count = 0;

        for (const r of records) {
            if (home.has(countryOfIata(r.src)) || home.has(countryOfIata(r.dst))) {
                count += 1;
            }
        }

        return count / records.length;
    };

    const byIataCode = new Map();

    for (const rec of ofAirlines.values()) {
        if (/^[A-Z0-9]{2}$/.test(rec.iata)) {
            if (!byIataCode.has(rec.iata)) {
                byIataCode.set(rec.iata, []);
            }

            byIataCode.get(rec.iata).push(rec);
        }
    }

    const suspicious = new Set();

    for (const [id, records] of recordsById) {
        const rec = ofAirlines.get(id);

        if (!rec || !rec.active || records.length < minRecords) {
            continue;
        }

        const iso = nameToIso.get(fold(rec.country));

        if (iso && homeShare(records, iso) === 0) {
            suspicious.add(id);
        }
    }

    const remap = new Map();
    const dropped = [];
    const repaired = [];

    for (const id of suspicious) {
        const rec = ofAirlines.get(id);
        const records = recordsById.get(id);
        let best = null;
        let bestShare = 0;

        for (const alt of byIataCode.get(rec.iata) || []) {
            const iso = nameToIso.get(fold(alt.country));

            if (alt.id === id || !alt.active || !/^[A-Z]{3}$/.test(alt.icao) || !iso || suspicious.has(alt.id)) {
                continue;
            }

            const share = homeShare(records, iso);

            if (share > bestShare) {
                best = alt;
                bestShare = share;
            }
        }

        if (best && bestShare >= minShare) {
            remap.set(id, best.id);
            repaired.push(`${rec.icao} (${rec.name}) -> ${best.icao} (${best.name}): ${records.length} records, home share ${bestShare.toFixed(2)}`);
        } else {
            remap.set(id, null);
            dropped.push(`${rec.icao} (${rec.name}, ${rec.country}): ${records.length} records, none touch its home country`);
        }
    }

    const out = [];

    for (const r of routes) {
        if (!remap.has(r.airlineId)) {
            out.push(r);
            continue;
        }

        const target = remap.get(r.airlineId);

        if (target) {
            out.push(Object.assign({}, r, { airlineId: target }));
        }
    }

    return { routes: out, repaired, dropped };
}

module.exports = { repairAirlineAttribution };
