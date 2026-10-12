import AirportController from '../airport/AirportController';
import DynamicPositionModel from '../base/DynamicPositionModel';
import EventBus from '../lib/EventBus';
import GameController from '../game/GameController';
import { generateSchematicLayout } from './schematicLayout';
import { buildGraph } from './groundGraph';
import { deriveStands, holdNodeForRunway } from './layoutPreparation';
import {
    buildOverpassQuery,
    fetchOsmElements,
    layoutBounds,
    parseOverpass
} from './osmLayout';
import { distanceBetween } from './groundGeometry';
import { EVENT } from '../constants/eventNames';
import { GAME_OPTION_NAMES } from '../constants/gameOptionConstants';

const CACHE_PREFIX = 'openscope.groundLayout.v1.';
const CACHE_MAX_AGE_MILLISECONDS = 1000 * 60 * 60 * 24 * 90;
const OSM_RADIUS_MARGIN_METERS = 1500;

/**
 * Knows the ground layout of the current airport: stands, taxiways, holding points, and routes between them
 *
 * Every airport gets a generated schematic layout straight away. Unless the player asked for generated layouts only,
 * the real one is then fetched from OpenStreetMap in the background (and cached in the browser) and swapped in.
 *
 * @class AirportLayoutController
 */
class AirportLayoutController {
    constructor() {
        this._eventBus = EventBus;
        this.icao = '';
        this.layout = null;
        this.graph = null;
        this.runways = [];
        this.standNodes = [];
        this.holdNodes = new Map();
        this.standsInUse = new Map();
        this.status = 'none';
        this._generation = 0;
        this._isActive = false;
        this._onAirportChange = () => this.onAirportChange();
    }

    init() {
        this._isActive = true;
        this._eventBus.on(EVENT.AIRPORT_CHANGE, this._onAirportChange);
        this.onAirportChange();
    }

    disable() {
        this._isActive = false;
        this._eventBus.off(EVENT.AIRPORT_CHANGE, this._onAirportChange);
        this.layout = null;
        this.graph = null;
        this.icao = '';
    }

    // ------------------------------ AIRPORT ------------------------------

    onAirportChange() {
        const airport = AirportController.airport_get();

        if (!this._isActive || !airport || !airport.runways || airport.runways.length === 0 || !airport.positionModel) {
            return;
        }

        this._generation += 1;
        this.icao = airport.icao;
        this.standsInUse.clear();
        this.runways = this._describeRunways(airport);

        const cached = this._readCache(airport.icao);

        if (cached) {
            this._setLayout(cached, 'cached');

            return;
        }

        this._setLayout(generateSchematicLayout(this.runways), 'schematic');

        if (this._shouldFetchReal()) {
            this._fetchReal(airport, this._generation);
        }
    }

    /**
     * Make sure a layout exists for the airport currently loaded
     *
     * @for AirportLayoutController
     * @method ensureCurrent
     */
    ensureCurrent() {
        const airport = AirportController.airport_get();

        if (this._isActive && airport && airport.icao !== this.icao) {
            this.onAirportChange();
        }
    }

    _shouldFetchReal() {
        try {
            return GameController.game.option.getOptionByName(GAME_OPTION_NAMES.GROUND_LAYOUT_SOURCE) !== 'schematic';
        } catch (error) {
            return false;
        }
    }

    _describeRunways(airport) {
        return airport.runways.map(([first, second]) => ({
            names: [first.name, second.name],
            p0: [first.positionModel.relativePosition[0], first.positionModel.relativePosition[1]],
            p1: [second.positionModel.relativePosition[0], second.positionModel.relativePosition[1]]
        }));
    }

    // ------------------------------ LAYOUT ------------------------------

    _setLayout(layout, status) {
        this.layout = layout;
        this.status = status;
        this.graph = buildGraph(layout);

        if (layout.stands.length === 0) {
            layout.stands = deriveStands(layout, this.graph, this.runways);
        }

        this.standNodes = layout.stands.map((stand) => this.graph.attachPoint([stand.x, stand.y], 0.15));
        this.holdNodes = new Map();

        this.runways.forEach((runway) => {
            [[runway.names[0], runway.p0], [runway.names[1], runway.p1]].forEach(([name, threshold]) => {
                const id = holdNodeForRunway(layout, this.graph, { name, threshold }, this.runways);

                if (id !== null) {
                    this.holdNodes.set(String(name).toUpperCase(), id);
                }
            });
        });

        this._eventBus.trigger(EVENT.GROUND_LAYOUT_CHANGE, this);
    }

    async _fetchReal(airport, generation) {
        this.status = 'fetching';
        this._eventBus.trigger(EVENT.GROUND_LAYOUT_CHANGE, this);

        const [latitude, longitude] = [airport.positionModel.latitude, airport.positionModel.longitude];
        const extent = Math.max(...this.runways.map((runway) => Math.max(
            Math.hypot(runway.p0[0], runway.p0[1]),
            Math.hypot(runway.p1[0], runway.p1[1])
        )));
        const radius = (extent * 1000) + OSM_RADIUS_MARGIN_METERS;
        const data = await fetchOsmElements(buildOverpassQuery(latitude, longitude, radius));

        if (generation !== this._generation) {
            return;
        }

        const layout = data ? parseOverpass(data, (lat, lon) => this.projectGps(lat, lon)) : null;

        if (!layout) {
            this.status = data ? 'schematic-nodata' : 'schematic-offline';
            this._eventBus.trigger(EVENT.GROUND_LAYOUT_CHANGE, this);

            return;
        }

        this._writeCache(airport.icao, layout);
        this._setLayout(layout, 'osm');
    }

    _readCache(icao) {
        if (!this._shouldFetchReal()) {
            return null;
        }

        try {
            const stored = JSON.parse(localStorage.getItem(`${CACHE_PREFIX}${icao}`));

            if (stored && stored.layout && Date.now() - stored.savedAt < CACHE_MAX_AGE_MILLISECONDS) {
                return stored.layout;
            }
        } catch (error) {
            // no cache, or unreadable
        }

        return null;
    }

    _writeCache(icao, layout) {
        try {
            localStorage.setItem(`${CACHE_PREFIX}${icao}`, JSON.stringify({ savedAt: Date.now(), layout }));
        } catch (error) {
            // storage is full or blocked: the layout is simply fetched again next time
        }
    }

    // ------------------------------ GEOMETRY ------------------------------

    projectGps(latitude, longitude) {
        const airport = AirportController.airport_get();

        return DynamicPositionModel.calculateRelativePosition([latitude, longitude], airport.positionModel, airport.magneticNorth);
    }

    toGps(point) {
        const airport = AirportController.airport_get();

        return DynamicPositionModel.calculateGpsCoordinatesFromRelativePosition(point, airport.positionModel);
    }

    getBounds() {
        return this.layout ? layoutBounds(this.layout) : null;
    }

    // ------------------------------ STANDS AND ROUTES ------------------------------

    /**
     * Give an aircraft a free stand (any, if all are taken)
     *
     * @for AirportLayoutController
     * @method assignStand
     * @param aircraftId {string}
     * @param random {function}
     * @return {object|null} `{ ref, point, nodeId }`
     */
    assignStand(aircraftId, random = Math.random) {
        this.ensureCurrent();

        if (!this.layout || this.layout.stands.length === 0) {
            return null;
        }

        this.releaseStand(aircraftId);

        const usable = this.layout.stands.map((stand, index) => index).filter((index) => this.standNodes[index] !== null);
        const free = usable.filter((index) => !this.standsInUse.has(index));
        const pool = free.length > 0 ? free : usable;

        if (pool.length === 0) {
            return null;
        }

        const index = pool[Math.floor(random() * pool.length)];
        const stand = this.layout.stands[index];

        this.standsInUse.set(index, aircraftId);

        return { ref: stand.ref, point: [stand.x, stand.y], nodeId: this.standNodes[index] };
    }

    releaseStand(aircraftId) {
        this.standsInUse.forEach((id, index) => {
            if (id === aircraftId) {
                this.standsInUse.delete(index);
            }
        });
    }

    /**
     * The hold node and a route to it
     *
     * @for AirportLayoutController
     * @method planTaxi
     * @param options {object} `{ fromPoint, fromNodeId, runwayName, preferredRefs }`
     * @return {object|null} `{ points, length, refs, holdPoint }`
     */
    planTaxi({
        fromPoint, fromNodeId = null, runwayName, preferredRefs = []
    }) {
        this.ensureCurrent();

        const holdId = this.holdNodes.get(String(runwayName).toUpperCase());

        if (!this.graph || holdId === undefined) {
            return null;
        }

        let from = fromNodeId;

        if (from === null || from === undefined) {
            const nearest = this.graph.nearestNode(fromPoint, 0.5);

            from = nearest ? nearest.id : null;
        }

        if (from === null) {
            return null;
        }

        const route = this.graph.findRoute(from, holdId, { preferredRefs });

        if (!route) {
            return null;
        }

        return { ...route, holdPoint: this.graph.nodes[holdId] };
    }

    getHoldPoint(runwayName) {
        const id = this.holdNodes.get(String(runwayName).toUpperCase());

        return id === undefined || !this.graph ? null : this.graph.nodes[id];
    }

    /**
     * Nearest taxiway reference, for readbacks
     *
     * @for AirportLayoutController
     * @method describeSource
     * @return {string}
     */
    describeSource() {
        switch (this.status) {
            case 'osm':
            case 'cached':
                return 'Layout: OpenStreetMap contributors (ODbL)';
            case 'fetching':
                return 'Layout: generated schematic (fetching the real one...)';
            case 'schematic-offline':
                return 'Layout: generated schematic (real layout unavailable offline)';
            case 'schematic-nodata':
                return 'Layout: generated schematic (no taxiway data mapped for this airport)';
            default:
                return 'Layout: generated schematic, not an official chart';
        }
    }

    distanceBetweenPoints(a, b) {
        return distanceBetween(a, b);
    }
}

export default new AirportLayoutController();
