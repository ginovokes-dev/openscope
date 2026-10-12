import $ from 'jquery';
import { greatCircleDistanceNm, initialBearingDegrees } from './geoMath';

const INDEX_URL = 'assets/airports/airportIndex.json';
// how much a larger airport type counts as extra runway when ranking where a flight is likely going
const AIRPORT_TYPE_BONUS_METERS = { large_airport: 8000, medium_airport: 3000 };
const rankAirport = (airport) => (airport.rwy_m || 0) + (AIRPORT_TYPE_BONUS_METERS[airport.type] || 0);
const DEFAULT_FIELDS = ['icao', 'iata', 'name', 'city', 'country', 'lat', 'lon', 'elev_ft', 'rwy_m', 'type'];

/**
 * Global lookup of airports by ICAO / IATA code
 *
 * The sim only has full airport data for the airports with a file in `assets/airports`, but flights
 * originate from and head to airports all over the world, and a diverting aircraft can choose
 * any airport. This index (one compact JSON file) answers "where is EGLL?", "how far is it?" and
 * "which airports nearby have a runway long enough for this aircraft?" for all of them.
 *
 * The file is optional: when it is missing every lookup returns `null`, and the callers degrade
 * gracefully (no city names, no distance-based fuel planning, diversions limited to loaded airports).
 *
 * @class AirportIndex
 */
export class AirportIndex {
    constructor() {
        this._byIcao = new Map();
        this._byIata = new Map();
        this._list = [];
        this.isLoaded = false;
    }

    /**
     * Fetch and parse the index file; resolves with the number of airports loaded (0 on failure)
     *
     * @for AirportIndex
     * @method load
     * @param url {string}
     * @return {Promise<number>}
     */
    load(url = INDEX_URL) {
        return new Promise((resolve) => {
            $.getJSON(url)
                .done((data) => resolve(this.populate(data)))
                .fail(() => resolve(0));
        });
    }

    /**
     * Fill the index from parsed JSON of the shape `{ fields: [...], airports: [[...], ...] }`
     *
     * @for AirportIndex
     * @method populate
     * @param data {object}
     * @return {number} airports loaded
     */
    populate(data) {
        this._byIcao.clear();
        this._byIata.clear();
        this._list = [];

        if (!data || !Array.isArray(data.airports)) {
            this.isLoaded = false;

            return 0;
        }

        const fields = Array.isArray(data.fields) ? data.fields : DEFAULT_FIELDS;

        data.airports.forEach((row) => {
            const airport = {};

            fields.forEach((field, index) => {
                airport[field] = row[index];
            });

            if (!airport.icao || !Number.isFinite(airport.lat) || !Number.isFinite(airport.lon)) {
                return;
            }

            airport.icao = String(airport.icao).toUpperCase();
            airport.iata = airport.iata ? String(airport.iata).toUpperCase() : '';
            this._byIcao.set(airport.icao, airport);

            if (airport.iata) {
                this._byIata.set(airport.iata, airport);
            }

            this._list.push(airport);
        });

        this.isLoaded = this._list.length > 0;

        return this._list.length;
    }

    /**
     * @for AirportIndex
     * @method lookup
     * @param code {string} ICAO or IATA code
     * @return {object|null} `{ icao, iata, name, city, country, lat, lon, elev_ft, rwy_m, type }`
     */
    lookup(code) {
        if (!code) {
            return null;
        }

        const key = String(code).trim().toUpperCase();

        return this._byIcao.get(key) || this._byIata.get(key) || null;
    }

    /**
     * Find airports whose name or city contains `text` (case-insensitive), best matches first
     *
     * @for AirportIndex
     * @method search
     * @param text {string}
     * @param limit {number}
     * @return {array<object>}
     */
    search(text, limit = 5) {
        const needle = String(text || '').trim().toLowerCase();

        if (needle.length < 3) {
            return [];
        }

        const scored = [];

        this._list.forEach((airport) => {
            const city = (airport.city || '').toLowerCase();
            const name = (airport.name || '').toLowerCase();
            let score = 0;

            if (city === needle) {
                score = 3;
            } else if (name.startsWith(needle) || city.startsWith(needle)) {
                score = 2;
            } else if (name.includes(needle) || city.includes(needle)) {
                score = 1;
            }

            if (score > 0) {
                // prefer airports with a longer runway and an IATA code (the "main" airport of a city)
                scored.push({ airport, score: score + (airport.iata ? 0.5 : 0) + Math.min(0.4, (airport.rwy_m || 0) / 10000) });
            }
        });

        return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((entry) => entry.airport);
    }

    /**
     * @for AirportIndex
     * @method distanceNm
     * @param codeA {string}
     * @param codeB {string}
     * @return {number|null}
     */
    distanceNm(codeA, codeB) {
        const a = this.lookup(codeA);
        const b = this.lookup(codeB);

        if (!a || !b) {
            return null;
        }

        return greatCircleDistanceNm(a.lat, a.lon, b.lat, b.lon);
    }

    /**
     * True bearing from `fromCode` to `toCode`
     *
     * @for AirportIndex
     * @method bearingDegrees
     * @return {number|null}
     */
    bearingDegrees(fromCode, toCode) {
        const a = this.lookup(fromCode);
        const b = this.lookup(toCode);

        if (!a || !b) {
            return null;
        }

        return initialBearingDegrees(a.lat, a.lon, b.lat, b.lon);
    }

    /**
     * Airports close to a point with a runway of at least `minimumRunwayMeters`, nearest first
     *
     * @for AirportIndex
     * @method findNear
     * @param latitude {number}
     * @param longitude {number}
     * @param options {object} `{ minimumRunwayMeters, maximumDistanceNm, excludeIcao, limit, requireIata }`
     * @return {array<object>} index entries with an added `distanceNm`
     */
    findNear(latitude, longitude, {
        minimumRunwayMeters = 0,
        maximumDistanceNm = 250,
        excludeIcao = [],
        limit = 5,
        requireIata = true
    } = {}) {
        const excluded = new Set([].concat(excludeIcao).map((code) => String(code).toUpperCase()));

        return this._list
            .filter((airport) => !excluded.has(airport.icao) && (!requireIata || airport.iata) && airport.rwy_m >= minimumRunwayMeters)
            .map((airport) => ({ ...airport, distanceNm: greatCircleDistanceNm(latitude, longitude, airport.lat, airport.lon) }))
            .filter((airport) => airport.distanceNm <= maximumDistanceNm)
            .sort((a, b) => a.distanceNm - b.distanceNm)
            .slice(0, limit);
    }

    /**
     * Airports roughly in one direction from a point, at a distance a scheduled flight would cover; the largest first
     *
     * Used to give a departure a believable destination: flights leave on the SID that points the way they are going
     *
     * @for AirportIndex
     * @method findInDirection
     * @param latitude {number}
     * @param longitude {number}
     * @param bearingDegrees {number} true bearing
     * @param options {object} `{ minimumDistanceNm, maximumDistanceNm, toleranceDegrees, minimumRunwayMeters, excludeIcao, limit }`
     * @return {array<object>} index entries with added `distanceNm` and `bearing`
     */
    findInDirection(latitude, longitude, bearingDegrees, {
        minimumDistanceNm = 120,
        maximumDistanceNm = 1800,
        toleranceDegrees = 50,
        minimumRunwayMeters = 2200,
        excludeIcao = [],
        limit = 10
    } = {}) {
        const excluded = new Set([].concat(excludeIcao).map((code) => String(code).toUpperCase()));

        return this._list
            .filter((airport) => airport.iata && !excluded.has(airport.icao) && airport.rwy_m >= minimumRunwayMeters)
            .map((airport) => ({
                ...airport,
                distanceNm: greatCircleDistanceNm(latitude, longitude, airport.lat, airport.lon),
                bearing: initialBearingDegrees(latitude, longitude, airport.lat, airport.lon)
            }))
            .filter((airport) => {
                const difference = Math.abs(((airport.bearing - bearingDegrees + 540) % 360) - 180);

                return airport.distanceNm >= minimumDistanceNm && airport.distanceNm <= maximumDistanceNm && difference <= toleranceDegrees;
            })
            .sort((a, b) => rankAirport(b) - rankAirport(a))
            .slice(0, limit);
    }

    get size() {
        return this._list.length;
    }
}

export default new AirportIndex();
