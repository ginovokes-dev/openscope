import AirportController from '../airport/AirportController';
import EventBus from '../lib/EventBus';
import GameController from '../game/GameController';
import TimeKeeper from '../engine/TimeKeeper';
import WeatherModel from './WeatherModel';
import { EVENT } from '../constants/eventNames';
import { GAME_OPTION_NAMES } from '../constants/gameOptionConstants';
import { WEATHER_VARIABILITY } from './weatherConstants';
import { radiansToDegrees } from '../utilities/unitConverters';

/**
 * Owns the evolving weather for the current airport and feeds it into the simulation
 *
 * Wind is pushed through the existing `EVENT.WIND_CHANGE` event (which `AirportModel` already
 * listens to), so runway wind components, crosswind/tailwind scoring and drift all follow the weather.
 * A richer `EVENT.WEATHER_CHANGE` event carries the full snapshot to the ATIS and the info panels.
 *
 * Wind imposed from elsewhere (the traffic dialog's wind sliders) is adopted as the new surface wind.
 *
 * @class WeatherController
 */
class WeatherController {
    constructor() {
        this._eventBus = EventBus;
        this.model = null;
        this._lastWind = null;
        this._isPublishing = false;
        this._latestSnapshot = null;
    }

    /**
     * Lifecycle method, runs once after the airport has been loaded
     *
     * @for WeatherController
     * @method init
     */
    init() {
        this._eventBus.on(EVENT.AIRPORT_CHANGE, this._onAirportChange);
        this._eventBus.on(EVENT.WIND_CHANGE, this._onWindChange);
        this._eventBus.on(EVENT.WEATHER_VARIABILITY_CHANGE, this._onVariabilityChange);

        this.reset();
    }

    /**
     * Rebuild the weather for the current airport from its file wind
     *
     * @for WeatherController
     * @method reset
     */
    reset() {
        const airport = AirportController.airport_get();

        if (!airport || !airport.positionModel) {
            return;
        }

        const { defaultWind, positionModel } = airport;

        this.model = new WeatherModel({
            latitudeDegrees: positionModel.latitude,
            variability: this._getConfiguredVariability(),
            baseWind: {
                angle: Math.round(radiansToDegrees(defaultWind.angle)),
                speed: defaultWind.speed
            }
        });

        this._lastWind = null;
        this._publish(true);
    }

    /**
     * Per-frame update
     *
     * @for WeatherController
     * @method update
     */
    update() {
        if (!this.model) {
            return;
        }

        const deltaTime = TimeKeeper.getDeltaTimeForGameStateAndTimewarp();

        if (this.model.tick(deltaTime)) {
            this._publish(false);
        }
    }

    /**
     * @for WeatherController
     * @method getSnapshot
     * @return {object|null}
     */
    getSnapshot() {
        return this._latestSnapshot;
    }

    /**
     * @for WeatherController
     * @method getUpcoming
     * @return {object|null}
     */
    getUpcoming() {
        return this.model ? this.model.getUpcoming() : null;
    }

    /**
     * Jump to a weather regime (used by the debugging console and scenario scripts)
     *
     * @for WeatherController
     * @method forceRegime
     * @param regime {string}
     */
    forceRegime(regime) {
        if (!this.model) {
            return;
        }

        this.model.forceRegime(regime);
        this._publish(true);
    }

    // ------------------------------ PRIVATE ------------------------------

    _getConfiguredVariability() {
        const configured = GameController.game.option.getOptionByName(GAME_OPTION_NAMES.WEATHER_VARIABILITY);

        return Object.values(WEATHER_VARIABILITY).indexOf(configured) !== -1 ? configured : WEATHER_VARIABILITY.NORMAL;
    }

    _publish(force) {
        const snapshot = this.model.getSnapshot();
        const last = this._lastWind;
        const windChanged = force || !last ||
            last.angle !== snapshot.windDirection ||
            last.speed !== snapshot.windSpeed ||
            last.gust !== snapshot.windGust;

        this._latestSnapshot = snapshot;

        if (windChanged) {
            this._lastWind = { angle: snapshot.windDirection, speed: snapshot.windSpeed, gust: snapshot.windGust };
            this._isPublishing = true;
            this._eventBus.trigger(EVENT.WIND_CHANGE, {
                angle: snapshot.windDirection,
                speed: snapshot.windSpeed,
                gust: snapshot.windGust,
                variableFrom: snapshot.windVariableFrom,
                variableTo: snapshot.windVariableTo,
                source: 'weather'
            });
            this._isPublishing = false;
        }

        this._eventBus.trigger(EVENT.WEATHER_CHANGE, snapshot);
    }

    _onAirportChange = () => {
        this.reset();
    };

    _onWindChange = (wind) => {
        if (this._isPublishing || !wind || wind.source === 'weather' || !this.model) {
            return;
        }

        // the player dragged the wind sliders: adopt it as the surface wind
        this.model.setWind({ angle: wind.angle, speed: wind.speed });
        this._publish(false);
    };

    _onVariabilityChange = (variability) => {
        if (this.model) {
            this.model.setVariability(variability);
        }
    };
}

export default new WeatherController();
