import EventBus from '../lib/EventBus';
import AirportController from '../airport/AirportController';
import AtisController from '../atis/AtisController';
import NavigationLibrary from '../navigationLibrary/NavigationLibrary';
import UiController from '../ui/UiController';
import WeatherController from '../weather/WeatherController';
import GameController from '../game/GameController';
import CanvasStageModel from '../canvas/CanvasStageModel';
import airportIndex from '../geo/AirportIndex';
import { buildAircraftInfo } from '../aircraft/aircraftActions';
import { getTransitionAltitude } from '../atis/atisGenerator';
import { PROCEDURE_TYPE } from '../constants/routeConstants';
import { EVENT } from '../constants/eventNames';
import { SELECTORS } from '../constants/selectors';
import { GAME_OPTION_NAMES } from '../constants/gameOptionConstants';
import { speech_say } from '../speech';
import { fetchStatus, interpretTransmission, loadPreferences } from './aiClient';
import { interpretLocally } from './localInterpreter';
import { repairTranscript, scoreTranscript } from './transcriptRepair';
import voiceInput from './voiceInput';
import voiceOutput from './voiceOutput';

const HISTORY_LENGTH = 8;
const RECENT_ADDRESS_MILLISECONDS = 120000;

const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Turns what the controller says or types into actions in the simulation, and what the pilots say into a transcript
 * and (optionally) audio.
 *
 * The transmission is interpreted by the language model when the server has one, and by the built-in phrase matcher
 * when it does not (or when the model cannot be reached), so text and voice control always work. Either way the
 * result is a list of ordinary command-bar commands per aircraft, which are executed through the same code that
 * handles typed commands, so readbacks, scoring and validation are identical.
 *
 * @class RadioController
 */
export default class RadioController {
    constructor(aircraftController, inputController) {
        this._aircraftController = aircraftController;
        this._inputController = inputController;
        this._history = [];
        this._listeners = [];
        this._isBusy = false;
        this._mode = 'offline';
        this._microphone = { state: 'idle', interim: '' };
        this._microphoneEngine = '';
        this._status = null;
        this._wantsMicrophone = false;
        this._isStartingMicrophone = false;
        this._app = { panels: {}, $element: null };
        this._lastAddressed = { callsign: null, at: 0 };
    }

    init() {
        voiceOutput.init();
        voiceInput.setScorer((text) => scoreTranscript(text, this._vocabularyContext()));
        voiceOutput.subscribe(() => this._notify());
        voiceInput.subscribe((event) => {
            this._microphone = event;

            if (event.state === 'timeout') {
                this.stopListening();

                return;
            }

            this._notify();
        });
        EventBus.on(EVENT.RADIO_FREE_TEXT, (text) => this.submit(text, { source: 'text' }));
        EventBus.on(EVENT.RADIO_TRANSMISSION, (transmission) => {
            if (transmission && transmission.kind === 'pilot') {
                this._pushHistory('pilot', `${transmission.speaker}: ${transmission.text}`);
            }
        });
        EventBus.on(EVENT.AIRPORT_CHANGE, () => {
            this._history = [];
        });
        this.refreshStatus();
    }

    /**
     * Be told when anything the panel shows changes: `listener()`
     *
     * @for RadioController
     * @method subscribe
     * @param listener {function}
     */
    subscribe(listener) {
        this._listeners.push(listener);
    }

    /**
     * @for RadioController
     * @method getState
     * @return {object}
     */
    getState() {
        return {
            mode: this._mode,
            isBusy: this._isBusy,
            microphone: this._microphone,
            microphoneEngine: this._microphoneEngine,
            isSpeaking: voiceOutput.isSpeaking(),
            isMicrophoneSupported: voiceInput.isSupported()
        };
    }

    /**
     * Find out what the server can do and whether to use it
     *
     * @for RadioController
     * @method refreshStatus
     * @param force {boolean}
     * @return {Promise<object>}
     */
    async refreshStatus(force = false) {
        const status = await fetchStatus(force);
        const useModel = loadPreferences().useLanguageModel && status.llm;

        this._mode = useModel ? 'ai' : 'offline';
        this._status = status;
        this._notify();

        return status;
    }

    /**
     * Hold-to-talk: start listening
     *
     * @for RadioController
     * @method startListening
     */
    async startListening() {
        if (voiceInput.isListening() || this._isStartingMicrophone) {
            return;
        }

        this._wantsMicrophone = true;
        this._isStartingMicrophone = true;
        voiceOutput.stop();

        try {
            this._microphoneEngine = await voiceInput.begin();
        } catch (error) {
            this._wantsMicrophone = false;
            this._system(error.message || 'The microphone could not be used.', true);
        }

        this._isStartingMicrophone = false;
        this._notify();

        // the key or button was released while the microphone was still being opened
        if (!this._wantsMicrophone && voiceInput.isListening()) {
            await this._finishListening();
        }
    }

    /**
     * Hold-to-talk: let go, transcribe, and act on it
     *
     * @for RadioController
     * @method stopListening
     */
    async stopListening() {
        this._wantsMicrophone = false;

        if (this._isStartingMicrophone || !voiceInput.isListening()) {
            return;
        }

        await this._finishListening();
    }

    async _finishListening() {
        try {
            const text = await voiceInput.finish();

            if (text) {
                await this.submit(text, { source: 'voice' });
            } else {
                this._system('Nothing was heard.', false);
            }
        } catch (error) {
            this._system(error.message || 'Could not understand the recording.', true);
        }

        this._notify();
    }

    /**
     * Act on a transmission
     *
     * @for RadioController
     * @method submit
     * @param text {string}
     * @param options {object} `{ source: 'text'|'voice' }`
     * @return {Promise<void>}
     */
    async submit(text, { source = 'text' } = {}) {
        const transcript = String(text || '').trim();

        if (!transcript) {
            return;
        }

        this._emit({
            kind: 'controller', speaker: 'You', text: transcript, source
        });
        this._pushHistory('controller', transcript);
        this._isBusy = true;
        this._notify();

        try {
            const result = await this._interpret(transcript);

            this._apply(result);
        } finally {
            this._isBusy = false;
            this._notify();
        }
    }

    /**
     * Everything the interpreter needs to know about the airport and the traffic
     *
     * @for RadioController
     * @method buildContext
     * @param transcript {string}
     * @return {object}
     */
    buildContext(transcript) {
        const airport = AirportController.airport_get();
        const weather = WeatherController.getSnapshot();
        const atis = AtisController.getCurrent();
        const arrivalRunway = airport.arrivalRunwayModel;
        const departureRunway = airport.departureRunwayModel;
        const runways = [];
        const aircraftInfo = this._aircraftController.aircraft.list.map((aircraft) => buildAircraftInfo(aircraft));
        const fixes = NavigationLibrary.realFixes.map((fix) => fix.name);
        const telephony = Array.from(new Set(aircraftInfo.flatMap((info) => String(info.airlineCallsign || '').toLowerCase().split(/\s+/).filter(Boolean))));

        airport.runways.forEach((pair) => pair.forEach((runway) => {
            runways.push({ name: runway.name, lengthMeters: Math.round(runway.length * 1000), ils: Boolean(runway.ils && runway.ils.enabled) });
        }));

        return {
            transcript,
            repairedTranscript: repairTranscript(transcript, { telephonyWords: telephony, fixNames: fixes }),
            airport: {
                icao: airport.icao.toUpperCase(),
                name: airport.name,
                elevationFeet: Math.round(airport.elevation),
                transitionAltitudeFeet: getTransitionAltitude(airport.icao, airport.data && airport.data.transition_altitude),
                runways,
                activeArrivalRunway: arrivalRunway ? arrivalRunway.name : null,
                activeDepartureRunway: departureRunway ? departureRunway.name : null
            },
            weather: weather || {},
            atis: atis ? { letter: atis.letter, text: atis.written } : {},
            fixes,
            sids: NavigationLibrary.getProceduresByType(PROCEDURE_TYPE.SID).map((procedure) => procedure.name),
            stars: NavigationLibrary.getProceduresByType(PROCEDURE_TYPE.STAR).map((procedure) => procedure.name),
            selectedCallsign: this._inputController.input.callsign || this._recentlyAddressedCallsign(),
            history: this._history.slice(-HISTORY_LENGTH),
            aircraft: aircraftInfo
        };
    }

    /**
     * The panels and screens the radio may open or close when asked in plain words
     *
     * @for RadioController
     * @method setApp
     * @param app {object} `{ panels: { atis, radio, controls, procedures, ai_settings, ground, ... }, $element }`; panels provide `isOpen()` and `toggle()`
     */
    setApp(app) {
        this._app = app;
    }

    /**
     * An airport named in words ("manchester", "liverpool john lennon", "egcc", "lpl") that can be loaded here
     *
     * @for RadioController
     * @method resolveAirport
     * @param words {string}
     * @return {string|null} ICAO code
     */
    resolveAirport(words) {
        const text = String(words || '').toLowerCase().replace(/\b(?:airport|international|please|now|thanks)\b/g, ' ').replace(/\s+/g, ' ')
            .trim();
        const isAvailable = (icao) => Boolean(AirportController.airports[String(icao).toLowerCase()]);

        if (!text) {
            return null;
        }

        const compact = text.replace(/\s+/g, '').toUpperCase();

        if (/^[A-Z]{4}$/.test(compact) && isAvailable(compact)) {
            return compact;
        }

        const tokens = text.split(' ');

        for (let length = Math.min(tokens.length, 4); length >= 1; length--) {
            const candidate = tokens.slice(0, length).join(' ');
            const exact = airportIndex.lookup(candidate.replace(/\s+/g, ''));

            if (exact && isAvailable(exact.icao)) {
                return exact.icao;
            }

            // several airports can share a name ("Manchester": England, New Hampshire): prefer the bigger airport
            const sizeScore = { large_airport: 3, medium_airport: 2, small_airport: 1 };
            const best = airportIndex.search(candidate, 20)
                .filter((hit) => isAvailable(hit.icao))
                .map((hit) => ({ hit, score: ((sizeScore[hit.type] || 0) * 10) + (hit.iata ? 1 : 0) + ((hit.rwy_m || 0) / 10000) }))
                .sort((a, b) => b.score - a.score)[0];

            if (best) {
                return best.hit.icao;
            }
        }

        return null;
    }

    // ------------------------------ PRIVATE ------------------------------

    async _interpret(transcript) {
        const context = this.buildContext(transcript);
        const status = await this.refreshStatus();

        if (this._mode === 'ai' && status.llm) {
            try {
                return await interpretTransmission(context);
            } catch (error) {
                this._system(`${error.message} Using the built-in phrase matcher instead.`, true);
            }
        }

        const local = interpretLocally(transcript, {
            resolveAirport: (words) => this.resolveAirport(words),
            aircraft: context.aircraft,
            selectedCallsign: context.selectedCallsign,
            fixes: context.fixes,
            runways: context.airport.runways.map((runway) => runway.name)
        });

        return { ...local, usedLocal: true };
    }

    _apply(result) {
        const transmissions = result.transmissions || [];
        const appActions = result.appActions || result.app_actions || [];

        appActions.forEach((action) => this._runAppAction(action));

        if (transmissions.length === 0) {
            if (appActions.length === 0) {
                this._system(result.controller_note || 'No aircraft answered.', true);
            } else if (result.controller_note) {
                this._system(result.controller_note, false);
            }

            return;
        }

        transmissions.forEach((transmission) => {
            const aircraft = this._aircraftController.aircraft.list.find((candidate) => candidate.callsign === transmission.callsign);

            if (!aircraft) {
                return;
            }

            let commandsWereRun = false;

            this._lastAddressed = { callsign: aircraft.callsign, at: Date.now() };

            if (transmission.commands.length > 0) {
                const outcome = this._inputController.executeCommandText(`${aircraft.callsign} ${transmission.commands.join(' ')}`);

                commandsWereRun = outcome.ok;

                if (!outcome.ok) {
                    this._system(`${aircraft.callsign}: could not carry out "${transmission.commands.join(' ')}".`, true);
                }
            }

            // the simulation reads back commands itself; a reply is for what has no command (or when the model is unsure)
            if (transmission.reply && !aircraft.isNordo) {
                this._pilotSays(aircraft, transmission.reply);
            } else if (!commandsWereRun && transmission.commands.length === 0 && !transmission.reply && transmission.intent === 'unclear') {
                this._pilotSays(aircraft, 'say again');
            }
        });

        if (result.controller_note) {
            this._system(result.controller_note, false);
        }
    }

    _runAppAction(action) {
        const { action: name, target, value } = action;
        const app = this._app || { panels: {} };

        switch (name) {
            case 'open':
            case 'close': {
                const panel = app.panels[target];

                if (!panel) {
                    this._system(`There is no "${target}" screen to ${name}.`, true);

                    return;
                }

                if ((name === 'open') !== panel.isOpen()) {
                    panel.toggle();
                }

                this._system(`${name === 'open' ? 'Opened' : 'Closed'} ${String(target).replace('_', ' ')}.`, false);

                return;
            }

            case 'layer':
                this._setLayer(target, value);

                return;

            case 'atis_update': {
                const atis = AtisController.issueUpdate();

                this._system(atis ? `ATIS updated: information ${atis.letter}.` : 'The ATIS is not available yet.', !atis);

                return;
            }

            case 'atis_read': {
                const atis = AtisController.getCurrent();

                if (atis) {
                    EventBus.trigger(EVENT.RADIO_TRANSMISSION, { kind: 'atis', speaker: 'ATIS', text: atis.spoken });
                }

                return;
            }

            case 'switch_airport':
                if (value && AirportController.airports[String(value).toLowerCase()]) {
                    AirportController.airport_set(String(value).toLowerCase());
                    this._system(`Switching to ${String(value).toUpperCase()}.`, false);
                } else {
                    this._system(`${value || 'That airport'} is not available.`, true);
                }

                return;

            case 'zoom':
                if (value === 'in') {
                    CanvasStageModel.zoomIn();
                } else if (value === 'out') {
                    CanvasStageModel.zoomOut();
                } else {
                    CanvasStageModel.zoomReset();
                    CanvasStageModel.updatePan(0, 0);
                }

                return;

            case 'traffic_level':
                this._setTrafficLevel(value);

                return;

            case 'time':
                this._setTime(value);

                return;

            case 'info':
                this._answerInfo(target);

                return;

            default:
                this._system(`I do not know how to "${name}".`, true);
        }
    }

    _setLayer(target, value) {
        const options = GameController.game.option;
        const wantOn = { show: true, hide: false }[value] === undefined ? null : { show: true, hide: false }[value];

        if (target === 'sids' || target === 'stars') {
            const name = target === 'sids' ? GAME_OPTION_NAMES.DRAW_SIDS : GAME_OPTION_NAMES.DRAW_STARS;
            const isOn = options.getOptionByName(name) !== 'no';
            const next = wantOn === null ? !isOn : wantOn;

            options.setOptionByName(name, next ? 'yes' : 'no');
            this._system(`${target.toUpperCase()} ${next ? 'shown' : 'hidden'}.`, false);

            return;
        }

        const buttons = {
            labels: '.toggle-labels', airspace: '.toggle-airspace', terrain: '.toggle-terrain', restricted: '.toggle-restricted-areas', maps: '.toggle-video-map'
        };
        const $button = this._app.$element ? this._app.$element.find(buttons[target]) : null;

        if (!$button || $button.length === 0) {
            this._system(`There is no "${target}" layer.`, true);

            return;
        }

        const isOn = $button.hasClass(SELECTORS.CLASSNAMES.ACTIVE);
        const next = wantOn === null ? !isOn : wantOn;

        if (next !== isOn) {
            $button.trigger('click');
        }

        this._system(`${target} ${next ? 'shown' : 'hidden'}.`, false);
    }

    _setTrafficLevel(value) {
        const order = ['quiet', 'medium', 'busy', 'rush'];
        const options = GameController.game.option;
        const current = options.getOptionByName(GAME_OPTION_NAMES.TRAFFIC_LEVEL);
        let next = value;

        if (value === 'more' || value === 'less') {
            const index = Math.max(0, order.indexOf(current)) + (value === 'more' ? 1 : -1);

            next = order[Math.max(0, Math.min(order.length - 1, index))];
        }

        if (order.indexOf(next) === -1) {
            return;
        }

        options.setOptionByName(GAME_OPTION_NAMES.TRAFFIC_LEVEL, next);
        this._system(`Traffic set to ${next === 'rush' ? 'rush hour' : next}.`, false);
    }

    _setTime(value) {
        if (value === 'pause') {
            GameController.game_pause();
            this._system('Paused. Click the screen to resume.', false);
        } else if (value === 'resume') {
            GameController.game_unpause();
            this._system('Resumed.', false);
        } else {
            const rate = value === 'normal' ? 1 : Number(value);

            if (Number.isFinite(rate) && rate >= 1) {
                this._inputController.executeCommandText(`timewarp ${rate}`);
                this._system(rate === 1 ? 'Normal speed.' : `Time running at ${rate}x.`, false);
            }
        }
    }

    /**
     * Answer a question about the airport and conditions from the live simulation
     *
     * @for RadioController
     * @method _answerInfo
     * @param topic {string}
     * @private
     */
    _answerInfo(topic) {
        const airport = AirportController.airport_get();
        const weather = WeatherController.getSnapshot();
        const atis = AtisController.getCurrent();
        const icao = airport.icao.toUpperCase();
        const lines = [];
        const pad = (number) => String(number).padStart(3, '0');
        const wind = weather ? `${pad(weather.windDirection)} degrees ${weather.windSpeed} knots${weather.windGust ? `, gusting ${weather.windGust}` : ''}` : '';
        const runwayUse = `arrivals runway ${airport.arrivalRunwayModel ? airport.arrivalRunwayModel.name : '-'}, departures runway ${airport.departureRunwayModel ? airport.departureRunwayModel.name : '-'}`;
        const { list } = this._aircraftController.aircraft;
        const count = (predicate) => list.filter(predicate).length;
        const all = {
            wind: weather ? `${icao} wind ${wind}.` : null,
            qnh: weather ? `${icao} QNH ${weather.qnhHpa}.` : null,
            temperature: weather ? `${icao} temperature ${weather.temperatureC}, dewpoint ${weather.dewpointC}.` : null,
            visibility: weather ? `${icao} visibility ${weather.visibilityMeters >= 10000 ? '10 km or more' : `${weather.visibilityMeters} metres`}${weather.ceilingFeet ? `, ceiling ${weather.ceilingFeet} feet` : ', no ceiling'}.` : null,
            runway: `${icao} ${runwayUse}.`,
            atis: atis ? `${icao} information ${atis.letter}: ${atis.written}` : null,
            time: atis ? `The time is ${atis.timeZ} UTC.` : null,
            traffic: `${list.length} aircraft: ${count((a) => a.isArrival())} arriving, ${count((a) => a.category === 'departure')} departing, ${count((a) => a.flightPhase === 'APRON')} waiting at the stands.`
        };

        if (topic === 'summary') {
            ['atis', 'runway', 'traffic'].forEach((name) => all[name] && lines.push(all[name]));
        } else if (all[topic]) {
            lines.push(all[topic]);
        }

        if (lines.length === 0) {
            this._system('No information is available for that yet.', true);

            return;
        }

        lines.forEach((line) => this._emit({ kind: 'atis', speaker: 'INFO', text: line }));
    }

    /**
     * Words that exist right now (airline telephony of the aircraft in the airspace, fixes), for repairing and scoring transcripts
     *
     * @for RadioController
     * @method _vocabularyContext
     * @return {object}
     * @private
     */
    _vocabularyContext() {
        const telephonyWords = Array.from(new Set(
            this._aircraftController.aircraft.list.flatMap((aircraft) => String(aircraft.airlineCallsign || '').toLowerCase().split(/\s+/).filter(Boolean))
        ));

        return { telephonyWords, fixNames: NavigationLibrary.realFixes.map((fix) => fix.name) };
    }

    /**
     * Follow-up instructions ("and reduce speed one eight zero") go to the aircraft just spoken to
     *
     * @for RadioController
     * @method _recentlyAddressedCallsign
     * @return {string|null}
     * @private
     */
    _recentlyAddressedCallsign() {
        const isRecent = Date.now() - this._lastAddressed.at < RECENT_ADDRESS_MILLISECONDS;

        return isRecent ? this._lastAddressed.callsign : null;
    }

    _pilotSays(aircraft, text) {
        UiController.ui_log(`${aircraft.callsign}, ${escapeHtml(text)}`);
        speech_say([
            { type: 'callsign', content: aircraft },
            { type: 'text', content: text }
        ], aircraft.pilotVoice);
    }

    _pushHistory(role, text) {
        this._history.push({ role, text });
        this._history = this._history.slice(-HISTORY_LENGTH * 2);
    }

    _system(text, isWarning) {
        this._emit({
            kind: 'system', speaker: '', text, isWarning
        });
    }

    _emit(transmission) {
        EventBus.trigger(EVENT.RADIO_TRANSMISSION, transmission);
    }

    _notify() {
        this._listeners.forEach((listener) => listener());
    }
}
