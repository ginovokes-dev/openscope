import { fetchStatus, transcribeAudio } from './aiClient';

const MAXIMUM_RECORDING_MILLISECONDS = 30000;
const MINIMUM_RECORDING_MILLISECONDS = 350;

const RECORDER_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

const getSpeechRecognitionClass = () => (typeof window === 'undefined' ? null : window.SpeechRecognition || window.webkitSpeechRecognition || null);

const hasRecorder = () => typeof window !== 'undefined' &&
    Boolean(window.MediaRecorder) && Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

/**
 * Push-to-talk microphone input
 *
 * Two ways of turning speech into text, chosen automatically:
 *
 * - ElevenLabs speech-to-text (when the server has a key): the microphone is recorded and uploaded when you let go
 * - the browser's built-in speech recognition (Chrome, Edge, Safari) otherwise: no key or upload needed
 *
 * `begin()` starts listening and `finish()` stops and resolves with what was heard.
 *
 * @class VoiceInput
 */
export class VoiceInput {
    constructor() {
        this._session = null;
        this._listeners = [];
    }

    /**
     * @for VoiceInput
     * @method isSupported
     * @return {boolean}
     */
    isSupported() {
        return hasRecorder() || Boolean(getSpeechRecognitionClass());
    }

    /**
     * @for VoiceInput
     * @method isListening
     * @return {boolean}
     */
    isListening() {
        return this._session !== null;
    }

    /**
     * Be told what is happening: `listener({ state: 'listening'|'transcribing'|'idle'|'timeout', interim })`
     *
     * @for VoiceInput
     * @method subscribe
     * @param listener {function}
     */
    subscribe(listener) {
        this._listeners.push(listener);
    }

    /**
     * Start listening
     *
     * @for VoiceInput
     * @method begin
     * @return {Promise<string>} the engine in use: 'elevenlabs' or 'browser'
     * @throws {Error} when the microphone cannot be used
     */
    async begin() {
        if (this._session) {
            return this._session.engine;
        }

        const status = await fetchStatus();
        const useStudio = Boolean(status.voice) && hasRecorder();

        if (!useStudio && !getSpeechRecognitionClass()) {
            throw new Error('This browser has no speech recognition. Add an ElevenLabs key in the AI & Voice dialog, or use Chrome or Edge.');
        }

        this._session = useStudio ? await this._beginRecording() : this._beginRecognition();
        this._notify({ state: 'listening', interim: '' });

        return this._session.engine;
    }

    /**
     * Stop listening and resolve with the transcript ('' when nothing intelligible was heard)
     *
     * @for VoiceInput
     * @method finish
     * @return {Promise<string>}
     */
    async finish() {
        const { _session: session } = this;

        if (!session) {
            return '';
        }

        this._session = null;

        try {
            this._notify({ state: 'transcribing', interim: '' });

            return await session.finish();
        } finally {
            this._notify({ state: 'idle', interim: '' });
        }
    }

    /**
     * Abandon the current recording without transcribing it
     *
     * @for VoiceInput
     * @method cancel
     */
    cancel() {
        if (this._session) {
            this._session.cancel();
            this._session = null;
            this._notify({ state: 'idle', interim: '' });
        }
    }

    // ------------------------------ PRIVATE ------------------------------

    _notify(event) {
        this._listeners.forEach((listener) => listener(event));
    }

    async _beginRecording() {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        const mimeType = RECORDER_MIME_TYPES.find((type) => window.MediaRecorder.isTypeSupported(type)) || '';
        const recorder = new window.MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        const chunks = [];
        const startedAt = Date.now();
        const releaseMicrophone = () => stream.getTracks().forEach((track) => track.stop());
        const stopped = new Promise((resolve) => {
            recorder.onstop = resolve;
        });
        // the owner of the microphone key decides what to do with a recording that ran too long
        const timeout = window.setTimeout(() => this._notify({ state: 'timeout', interim: '' }), MAXIMUM_RECORDING_MILLISECONDS);

        recorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                chunks.push(event.data);
            }
        };
        recorder.start();

        return {
            engine: 'elevenlabs',

            finish: async() => {
                window.clearTimeout(timeout);
                recorder.stop();
                await stopped;
                releaseMicrophone();

                if (Date.now() - startedAt < MINIMUM_RECORDING_MILLISECONDS || chunks.length === 0) {
                    return '';
                }

                return transcribeAudio(new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }));
            },

            cancel: () => {
                window.clearTimeout(timeout);
                recorder.onstop = null;

                if (recorder.state !== 'inactive') {
                    recorder.stop();
                }

                releaseMicrophone();
            }
        };
    }

    _beginRecognition() {
        const RecognitionClass = getSpeechRecognitionClass();
        const recognition = new RecognitionClass();
        let finalText = '';
        let interimText = '';
        let error = null;
        const ended = new Promise((resolve) => {
            recognition.onend = resolve;
        });

        recognition.lang = 'en-GB';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.onresult = (event) => {
            interimText = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const { transcript } = event.results[i][0];

                if (event.results[i].isFinal) {
                    finalText += `${transcript} `;
                } else {
                    interimText += transcript;
                }
            }

            this._notify({ state: 'listening', interim: `${finalText}${interimText}`.trim() });
        };
        recognition.onerror = (event) => {
            error = event.error;
        };
        recognition.start();

        return {
            engine: 'browser',

            finish: async() => {
                recognition.stop();
                await Promise.race([ended, new Promise((resolve) => window.setTimeout(resolve, 2500))]);

                if (error && error !== 'no-speech' && error !== 'aborted') {
                    throw new Error(error === 'not-allowed' ? 'Microphone access was refused.' : `Speech recognition failed (${error}).`);
                }

                return `${finalText}${interimText}`.trim();
            },

            cancel: () => {
                recognition.onend = null;
                recognition.abort();
            }
        };
    }
}

export default new VoiceInput();
