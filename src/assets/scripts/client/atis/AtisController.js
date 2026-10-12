import _isString from 'lodash/isString';
import AirportController from '../airport/AirportController';
import EventBus from '../lib/EventBus';
import GameController from '../game/GameController';
import SpawnPatternCollection from '../trafficGenerator/SpawnPatternCollection';
import { areAllRoutesRunwayIndependent } from '../aircraft/routeRunway';
import TimeKeeper from '../engine/TimeKeeper';
import WeatherController from '../weather/WeatherController';
import { hasSignificantWeatherChange } from '../weather/WeatherModel';
import {
    buildAtis,
    getInformationLetter,
    getTransitionAltitude
} from './atisGenerator';
import {
    buildStandingNotices,
    buildWeatherRemarks,
    createSeededRandom,
    seedFromString
} from './atisRemarks';
import { EVENT } from '../constants/eventNames';
import { GAME_OPTION_NAMES } from '../constants/gameOptionConstants';
import { ATIS_LETTERS } from '../weather/weatherConstants';

const CHECK_INTERVAL_SECONDS = 20;
const ROUTINE_UPDATE_INTERVAL_SECONDS = 30 * 60;

/**
 * Keeps the ATIS for the current airport: which information letter is current, what it says, whether
 * it is overdue for an update, and any edits the player has made.
 *
 * Content is built by `atisGenerator` from the live weather snapshot, so the ATIS can never disagree
 * with the simulation. Pilots use `getLetterForNewContact()` to say which information they have.
 *
 * @class AtisController
 */
class AtisController {
    constructor() {
        this._eventBus = EventBus;
        this._startMilliseconds = Date.now();
        this._current = null;
        this._issuedSnapshot = null;
        this._issuedAtSeconds = 0;
        this._lastCheckSeconds = 0;
        this._previousLetter = null;
        this._updateDue = false;
        this._standingNotices = [];
        this._userRemarks = [];
        this._type = 'combined';
        this._approachOverride = null;
        this._icao = null;
        this._letterIndex = 0;
        this._issuedRunway = '';
    }

    /**
     * @for AtisController
     * @method init
     */
    init() {
        this._eventBus.on(EVENT.AIRPORT_CHANGE, this._onAirportChange);

        this.reset();
    }

    /**
     * Rebuild the state for the current airport
     *
     * @for AtisController
     * @method reset
     */
    reset() {
        const airport = AirportController.airport_get();

        if (!airport || !airport.icao) {
            return;
        }

        this._icao = airport.icao.toUpperCase();

        const seed = seedFromString(`${this._icao}:${this._startMilliseconds}`);
        const random = createSeededRandom(seed);

        this._letterIndex = Math.floor(random() * ATIS_LETTERS.length);
        this._standingNotices = buildStandingNotices(random, 1 + Math.floor(random() * 2));
        this._userRemarks = [];
        this._type = 'combined';
        this._approachOverride = null;
        this._previousLetter = null;
        this._updateDue = false;
        this._issue(false);
    }

    /**
     * Per-frame update; cheap, only does real work every few simulated seconds
     *
     * @for AtisController
     * @method update
     */
    update() {
        if (!this._current) {
            return;
        }

        const now = TimeKeeper.accumulatedDeltaTime;

        if (now - this._lastCheckSeconds < CHECK_INTERVAL_SECONDS) {
            return;
        }

        this._lastCheckSeconds = now;

        if (!this._isUpdateRequired()) {
            return;
        }

        if (this.isAutomatic()) {
            this.issueUpdate();

            return;
        }

        if (!this._updateDue) {
            this._updateDue = true;
            this._eventBus.trigger(EVENT.ATIS_UPDATE_DUE, this._current);
        }
    }

    /**
     * @for AtisController
     * @method getCurrent
     * @return {object|null} `{ letter, timeZ, written, spoken, lines }`
     */
    getCurrent() {
        return this._current;
    }

    /**
     * @for AtisController
     * @method isUpdateDue
     * @return {boolean}
     */
    isUpdateDue() {
        return this._updateDue;
    }

    /**
     * @for AtisController
     * @method isAutomatic
     * @return {boolean}
     */
    isAutomatic() {
        return GameController.game.option.getOptionByName(GAME_OPTION_NAMES.ATIS_UPDATES) !== 'manual';
    }

    /**
     * The information letter a pilot making first contact now will quote
     *
     * When the player runs the ATIS by hand and has let it go stale, pilots tune in to what was last
     * broadcast and so are one letter behind.
     *
     * @for AtisController
     * @method getLetterForNewContact
     * @return {string} the phonetic word, eg. "BRAVO"; empty when unavailable
     */
    getLetterForNewContact() {
        if (!this._current) {
            return '';
        }

        return this._updateDue && this._previousLetter ? this._previousLetter : this._current.letter;
    }

    /**
     * Whether the player may change the active runway from the ATIS panel
     *
     * Spawn routes name a runway (`WBA.WBA2I.EGGP27`); the runway can be changed when every route's procedure is
     * published for every runway, because new traffic is then given the same procedure to the active runway.
     * Airports whose procedures only serve one runway keep flying it.
     *
     * @for AtisController
     * @method canChangeRunway
     * @return {boolean}
     */
    canChangeRunway() {
        const patterns = SpawnPatternCollection.spawnPatternModels || [];
        const airport = AirportController.airport_get();
        const runwayNames = airport.runways.reduce((names, pair) => names.concat(pair.map((runway) => runway.name)), []);

        return areAllRoutesRunwayIndependent(patterns.map((pattern) => pattern.routeString || ''), runwayNames);
    }

    /**
     * Publish a new information letter from the live conditions
     *
     * @for AtisController
     * @method issueUpdate
     * @return {object} the new ATIS
     */
    issueUpdate() {
        return this._issue(true);
    }

    /**
     * Apply the player's edits and publish a new information letter
     *
     * @for AtisController
     * @method applyEdit
     * @param edit {object}
     * @param edit.arrivalRunway {string} optional
     * @param edit.departureRunway {string} optional
     * @param edit.approachType {string} optional; empty string removes the approach line
     * @param edit.remarks {string|array} optional free text, one remark per line
     * @param edit.type {string} optional: `combined`, `arrival`, `departure`
     * @return {object} the new ATIS
     */
    applyEdit({
        arrivalRunway, departureRunway, approachType, remarks, type
    } = {}) {
        const airport = AirportController.airport_get();

        if (this.canChangeRunway()) {
            if (arrivalRunway && airport.getRunway(arrivalRunway)) {
                airport.setArrivalRunway(airport.getRunway(arrivalRunway));
            }

            if (departureRunway && airport.getRunway(departureRunway)) {
                airport.setDepartureRunway(airport.getRunway(departureRunway));
            }
        }

        if (approachType !== undefined) {
            this._approachOverride = _isString(approachType) ? approachType.trim() : null;
        }

        if (remarks !== undefined) {
            const lines = Array.isArray(remarks) ? remarks : String(remarks).split('\n');

            this._userRemarks = lines.map((line) => line.trim()).filter(Boolean);
        }

        if (type && ['combined', 'arrival', 'departure'].indexOf(type) !== -1) {
            this._type = type;
        }

        return this._issue(true);
    }

    /**
     * The values a form needs to present when editing the ATIS
     *
     * @for AtisController
     * @method getEditableState
     * @return {object}
     */
    getEditableState() {
        const airport = AirportController.airport_get();
        const runwayNames = (airport.runways || []).reduce((names, pair) => names.concat(pair.map((runway) => runway.name)), []);

        return {
            arrivalRunway: airport.arrivalRunwayModel ? airport.arrivalRunwayModel.name : '',
            departureRunway: airport.departureRunwayModel ? airport.departureRunwayModel.name : '',
            runwayNames: runwayNames.sort(),
            approachType: this._getApproachType(),
            remarks: this._userRemarks.join('\n'),
            type: this._type,
            canChangeRunway: this.canChangeRunway()
        };
    }

    // ------------------------------ PRIVATE ------------------------------

    _getSimulatedDate() {
        return new Date(this._startMilliseconds + (TimeKeeper.accumulatedDeltaTime * 1000));
    }

    _getApproachType() {
        if (this._approachOverride !== null) {
            return this._approachOverride;
        }

        const airport = AirportController.airport_get();
        const runway = airport.arrivalRunwayModel;

        if (!runway) {
            return '';
        }

        return runway.ils && runway.ils.enabled ? 'ILS' : 'visual';
    }

    _getAirportSpokenName(airport) {
        const radio = airport.radio || {};
        const source = radio.twr || radio.app || airport.name || airport.icao;

        return source.replace(/\s+(tower|approach|radar|departure|control|ground)$/i, '');
    }

    _isUpdateRequired() {
        const now = TimeKeeper.accumulatedDeltaTime;
        const snapshot = WeatherController.getSnapshot();

        if (now - this._issuedAtSeconds >= ROUTINE_UPDATE_INTERVAL_SECONDS) {
            return true;
        }

        const airport = AirportController.airport_get();
        const arrivalRunway = airport.arrivalRunwayModel ? airport.arrivalRunwayModel.name : '';

        if (this._issuedRunway !== arrivalRunway) {
            return true;
        }

        return hasSignificantWeatherChange(this._issuedSnapshot, snapshot);
    }

    _issue(advanceLetter) {
        const airport = AirportController.airport_get();
        const weather = WeatherController.getSnapshot();

        if (!airport || !weather) {
            return null;
        }

        if (advanceLetter) {
            this._previousLetter = this._current ? this._current.letter : null;
            this._letterIndex += 1;
        }

        const arrivalRunway = airport.arrivalRunwayModel ? airport.arrivalRunwayModel.name : '';
        const departureRunway = airport.departureRunwayModel ? airport.departureRunwayModel.name : '';
        const radio = airport.radio || {};
        const letter = getInformationLetter(this._letterIndex);
        const remarks = [
            ...buildWeatherRemarks(weather, arrivalRunway || departureRunway),
            ...this._standingNotices,
            ...this._userRemarks
        ];

        this._current = buildAtis({
            airportName: this._getAirportSpokenName(airport),
            icao: this._icao,
            letter,
            timeUtc: this._getSimulatedDate(),
            type: this._type,
            arrivalRunway,
            departureRunway,
            approachType: this._getApproachType(),
            weather,
            upcoming: WeatherController.getUpcoming(),
            transitionAltitudeFeet: getTransitionAltitude(this._icao, airport.data && airport.data.transition_altitude),
            remarks,
            contactName: radio.app || ''
        });
        this._issuedSnapshot = weather;
        this._issuedRunway = arrivalRunway;
        this._issuedAtSeconds = TimeKeeper.accumulatedDeltaTime;
        this._lastCheckSeconds = TimeKeeper.accumulatedDeltaTime;
        this._updateDue = false;

        this._eventBus.trigger(EVENT.ATIS_UPDATED, this._current);

        return this._current;
    }

    _onAirportChange = () => {
        this.reset();
    };
}

export default new AtisController();
