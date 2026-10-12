import EventBus from '../lib/EventBus';
import AirportController from '../airport/AirportController';
import AtisController from '../atis/AtisController';
import NavigationLibrary from '../navigationLibrary/NavigationLibrary';
import UiController from '../ui/UiController';
import WeatherController from '../weather/WeatherController';
import { buildAircraftInfo } from '../aircraft/aircraftActions';
import { getTransitionAltitude } from '../atis/atisGenerator';
import { PROCEDURE_TYPE } from '../constants/routeConstants';
import { EVENT } from '../constants/eventNames';
import { speech_say } from '../speech';
import { fetchStatus, interpretTransmission, loadPreferences } from './aiClient';
import { interpretLocally } from './localInterpreter';
import voiceInput from './voiceInput';
import voiceOutput from './voiceOutput';

const HISTORY_LENGTH = 8;

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
    }

    init() {
        voiceOutput.init();
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

        airport.runways.forEach((pair) => pair.forEach((runway) => {
            runways.push({ name: runway.name, lengthMeters: Math.round(runway.length * 1000), ils: Boolean(runway.ils && runway.ils.enabled) });
        }));

        return {
            transcript,
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
            fixes: NavigationLibrary.realFixes.map((fix) => fix.name),
            sids: NavigationLibrary.getProceduresByType(PROCEDURE_TYPE.SID).map((procedure) => procedure.name),
            stars: NavigationLibrary.getProceduresByType(PROCEDURE_TYPE.STAR).map((procedure) => procedure.name),
            selectedCallsign: this._inputController.input.callsign || null,
            history: this._history.slice(-HISTORY_LENGTH),
            aircraft: this._aircraftController.aircraft.list.map((aircraft) => buildAircraftInfo(aircraft))
        };
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
            aircraft: context.aircraft,
            selectedCallsign: context.selectedCallsign,
            fixes: context.fixes,
            runways: context.airport.runways.map((runway) => runway.name)
        });

        return { ...local, usedLocal: true };
    }

    _apply(result) {
        const transmissions = result.transmissions || [];

        if (transmissions.length === 0) {
            this._system(result.controller_note || 'No aircraft answered.', true);

            return;
        }

        transmissions.forEach((transmission) => {
            const aircraft = this._aircraftController.aircraft.list.find((candidate) => candidate.callsign === transmission.callsign);

            if (!aircraft) {
                return;
            }

            let commandsWereRun = false;

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
