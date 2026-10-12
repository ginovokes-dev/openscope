/**
 * Turns OpenStreetMap aeroway data into a ground layout, for the browser to fetch on demand
 *
 * The data is © OpenStreetMap contributors, available under the Open Database Licence (https://www.openstreetmap.org/copyright).
 * The chart shows that credit whenever it uses this layout.
 */
import {
    boundsOf,
    polygonCentroid,
    simplifyPolyline
} from './groundGeometry';

export const OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
];

const round = (value) => Math.round(value * 1000) / 1000;

/**
 * Overpass query for everything on the ground within `radiusMeters` of a point
 *
 * @function buildOverpassQuery
 * @param latitude {number}
 * @param longitude {number}
 * @param radiusMeters {number}
 * @return {string}
 */
export const buildOverpassQuery = (latitude, longitude, radiusMeters) => {
    const around = `(around:${Math.round(radiusMeters)},${latitude.toFixed(6)},${longitude.toFixed(6)})`;

    return [
        '[out:json][timeout:25];',
        '(',
        `  way["aeroway"~"^(taxiway|taxilane|apron|terminal|parking_position)$"]${around};`,
        `  way["building"="terminal"]${around};`,
        `  node["aeroway"~"^(parking_position|gate|holding_position)$"]${around};`,
        ');',
        'out geom;'
    ].join('\n');
};

const geometryOf = (element, project) => (element.geometry || []).map((node) => project(node.lat, node.lon));

/**
 * @function parseOverpass
 * @param data {object} the Overpass JSON response
 * @param project {function} `(latitude, longitude) => [x, y]` in km relative to the airport
 * @return {object|null} layout, null when there is nothing worth using
 */
export const parseOverpass = (data, project) => {
    const layout = {
        source: 'osm',
        taxiways: [],
        aprons: [],
        terminals: [],
        stands: [],
        holds: []
    };

    ((data && data.elements) || []).forEach((element) => {
        const tags = element.tags || {};
        const kind = tags.aeroway || (tags.building === 'terminal' ? 'terminal' : '');

        if (element.type === 'node') {
            const [x, y] = project(element.lat, element.lon);

            if (kind === 'parking_position' || kind === 'gate') {
                layout.stands.push({ ref: tags.ref || tags.name || '', x: round(x), y: round(y) });
            } else if (kind === 'holding_position') {
                layout.holds.push({
                    runway: tags.ref || '', x: round(x), y: round(y), taxiway: ''
                });
            }

            return;
        }

        if (element.type !== 'way') {
            return;
        }

        const points = geometryOf(element, project);

        if (points.length < 2) {
            return;
        }

        if (kind === 'taxiway' || kind === 'taxilane') {
            layout.taxiways.push({
                ref: tags.ref || tags.name || '',
                kind,
                points: simplifyPolyline(points).map(([x, y]) => [round(x), round(y)])
            });
        } else if (kind === 'apron' && points.length >= 3) {
            layout.aprons.push({ points: points.map(([x, y]) => [round(x), round(y)]) });
        } else if (kind === 'terminal' && points.length >= 3) {
            layout.terminals.push({ name: tags.name || '', points: points.map(([x, y]) => [round(x), round(y)]) });
        } else if (kind === 'parking_position') {
            const [x, y] = polygonCentroid(points);

            layout.stands.push({ ref: tags.ref || tags.name || '', x: round(x), y: round(y) });
        }
    });

    return layout.taxiways.length >= 3 ? layout : null;
};

/**
 * Bounding box of everything in a layout, in km
 *
 * @function layoutBounds
 * @param layout {object}
 * @return {object|null}
 */
export const layoutBounds = (layout) => boundsOf([
    ...layout.taxiways.map((taxiway) => taxiway.points),
    ...layout.aprons.map((apron) => apron.points),
    ...layout.terminals.map((terminal) => terminal.points),
    layout.stands.map((stand) => [stand.x, stand.y])
]);

/**
 * Fetch the layout from Overpass, trying the endpoints in turn
 *
 * @function fetchOsmElements
 * @param query {string}
 * @param fetchFunction {function} `fetch`
 * @param timeoutMilliseconds {number}
 * @return {Promise<object|null>} parsed JSON, null on failure
 */
export const fetchOsmElements = async(query, fetchFunction = (...args) => fetch(...args), timeoutMilliseconds = 30000) => {
    for (let i = 0; i < OVERPASS_ENDPOINTS.length; i++) {
        const controller = typeof AbortController === 'undefined' ? null : new AbortController();
        const timer = controller ? setTimeout(() => controller.abort(), timeoutMilliseconds) : null;

        try {
            // eslint-disable-next-line no-await-in-loop
            const response = await fetchFunction(OVERPASS_ENDPOINTS[i], {
                method: 'POST',
                body: `data=${encodeURIComponent(query)}`,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                signal: controller ? controller.signal : undefined
            });

            if (response.ok) {
                // eslint-disable-next-line no-await-in-loop
                return await response.json();
            }
        } catch (error) {
            // try the next endpoint
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }

    return null;
};
