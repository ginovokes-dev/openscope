import EventBus from '../lib/EventBus';
import { EVENT } from '../constants/eventNames';
import { fetchStatus, loadPreferences, synthesizeSpeech } from './aiClient';

const MAXIMUM_QUEUE_LENGTH = 6;
const AUDIO_CACHE_LIMIT = 60;
const STUDIO_RETRY_DELAY_MILLISECONDS = 60000;
const SQUELCH_SECONDS = 0.07;

/**
 * Plays everything the pilots (and the ATIS) say
 *
 * Utterances are spoken one at a time, like a real frequency, and the oldest are dropped if they pile up faster
 * than they can be spoken. When ElevenLabs is configured every pilot gets a stable studio voice (chosen from the
 * callsign, with an accent that suits the airline) and the audio is run through a radio band-pass with a
 * squelch click at each end. Otherwise the browser's own speech synthesis is used with the pilot's random
 * voice, pitch and rate, as before.
 *
 * @class VoiceOutput
 */
export class VoiceOutput {
    constructor() {
        this._queue = [];
        this._isPlaying = false;
        this._audioContext = null;
        this._currentSource = null;
        this._cache = new Map();
        this._studioRetryAt = 0;
        this._listeners = [];
        this._speechTimer = null;
        this._cancelCurrent = null;
        this.lastEngine = '';
    }

    /**
     * Speak the ATIS when the player asks for it to be read aloud
     *
     * @for VoiceOutput
     * @method init
     */
    init() {
        EventBus.on(EVENT.RADIO_TRANSMISSION, (transmission) => {
            if (transmission && transmission.kind === 'atis' && transmission.text) {
                this.speak({ text: transmission.text, voiceKey: 'ATIS', forced: true });
            }
        });
    }

    /**
     * Be told when speaking starts and stops: `listener(isSpeaking)`
     *
     * @for VoiceOutput
     * @method subscribe
     * @param listener {function}
     */
    subscribe(listener) {
        this._listeners.push(listener);
    }

    /**
     * @for VoiceOutput
     * @method isSpeaking
     * @return {boolean}
     */
    isSpeaking() {
        return this._isPlaying || this._queue.length > 0;
    }

    /**
     * Queue an utterance
     *
     * @for VoiceOutput
     * @method speak
     * @param details {object}
     * @param details.text {string}
     * @param details.voiceKey {string} the callsign; keeps a pilot's voice the same all session
     * @param details.pilotVoice {object} browser fallback voice `{ voice, pitch, rate }`
     */
    speak({ text, voiceKey, pilotVoice = null }) {
        const clean = String(text || '').replace(/\s+/g, ' ').trim();

        if (!clean) {
            return;
        }

        this._queue.push({ text: clean, voiceKey: voiceKey || clean, pilotVoice });

        while (this._queue.length > MAXIMUM_QUEUE_LENGTH) {
            this._queue.shift();
        }

        this._playNext();
    }

    /**
     * Stop talking and forget anything waiting, eg. when the controller keys the microphone
     *
     * @for VoiceOutput
     * @method stop
     */
    stop() {
        this._queue = [];

        if (this._currentSource) {
            try {
                this._currentSource.onended = null;
                this._currentSource.stop();
            } catch (error) {
                // already stopped
            }

            this._currentSource = null;
        }

        if (typeof window !== 'undefined' && window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }

        window.clearTimeout(this._speechTimer);

        if (this._cancelCurrent) {
            this._cancelCurrent();
            this._cancelCurrent = null;
        }

        this._setPlaying(false);
    }

    // ------------------------------ PRIVATE ------------------------------

    _setPlaying(value) {
        if (this._isPlaying === value) {
            return;
        }

        this._isPlaying = value;
        this._listeners.forEach((listener) => listener(this.isSpeaking()));
    }

    async _playNext() {
        if (this._isPlaying || this._queue.length === 0) {
            return;
        }

        const utterance = this._queue.shift();

        this._setPlaying(true);

        try {
            await this._play(utterance);
        } catch (error) {
            // a failed utterance must never stop the queue
        }

        this._isPlaying = false;

        if (this._queue.length > 0) {
            this._playNext();
        } else {
            this._listeners.forEach((listener) => listener(false));
        }
    }

    async _play(utterance) {
        if (await this._canUseStudioVoice()) {
            try {
                await this._playStudio(utterance);
                this.lastEngine = 'elevenlabs';

                return;
            } catch (error) {
                this._studioRetryAt = Date.now() + STUDIO_RETRY_DELAY_MILLISECONDS;
            }
        }

        this.lastEngine = 'browser';

        await this._playBrowser(utterance);
    }

    async _canUseStudioVoice() {
        if (Date.now() < this._studioRetryAt || !loadPreferences().useStudioVoices) {
            return false;
        }

        const status = await fetchStatus();

        return Boolean(status.voice) && Boolean(window.AudioContext || window.webkitAudioContext);
    }

    _getAudioContext() {
        if (!this._audioContext) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;

            this._audioContext = new AudioContextClass();
        }

        if (this._audioContext.state === 'suspended') {
            this._audioContext.resume();
        }

        return this._audioContext;
    }

    async _fetchAudio(utterance) {
        const cacheKey = `${utterance.voiceKey}|${utterance.text}`;

        if (this._cache.has(cacheKey)) {
            return this._cache.get(cacheKey).slice(0);
        }

        const audio = await synthesizeSpeech({ text: utterance.text, voiceKey: utterance.voiceKey });

        this._cache.set(cacheKey, audio.slice(0));

        if (this._cache.size > AUDIO_CACHE_LIMIT) {
            this._cache.delete(this._cache.keys().next().value);
        }

        return audio;
    }

    _noiseBurst(context, startTime) {
        const length = Math.floor(context.sampleRate * SQUELCH_SECONDS);
        const buffer = context.createBuffer(1, length, context.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < length; i++) {
            data[i] = (Math.random() * 2 - 1) * (1 - (i / length));
        }

        const source = context.createBufferSource();
        const gain = context.createGain();

        gain.gain.value = 0.05;
        source.buffer = buffer;
        source.connect(gain);
        gain.connect(context.destination);
        source.start(startTime);
    }

    async _playStudio(utterance) {
        const context = this._getAudioContext();
        const decoded = await new Promise((resolve, reject) => {
            this._fetchAudio(utterance).then((audio) => context.decodeAudioData(audio, resolve, reject), reject);
        });
        const useEffect = loadPreferences().radioEffect;

        await new Promise((resolve) => {
            const source = context.createBufferSource();
            const lead = useEffect ? SQUELCH_SECONDS : 0;
            const startTime = context.currentTime + lead;

            source.buffer = decoded;

            if (useEffect) {
                const highpass = context.createBiquadFilter();
                const lowpass = context.createBiquadFilter();
                const compressor = context.createDynamicsCompressor();
                const gain = context.createGain();

                highpass.type = 'highpass';
                highpass.frequency.value = 380;
                lowpass.type = 'lowpass';
                lowpass.frequency.value = 3200;
                gain.gain.value = 1.15;
                source.connect(highpass);
                highpass.connect(lowpass);
                lowpass.connect(compressor);
                compressor.connect(gain);
                gain.connect(context.destination);
                this._noiseBurst(context, context.currentTime);
                this._noiseBurst(context, startTime + decoded.duration);
            } else {
                source.connect(context.destination);
            }

            this._currentSource = source;
            this._cancelCurrent = resolve;
            source.onended = () => {
                this._currentSource = null;
                this._cancelCurrent = null;
                window.setTimeout(resolve, useEffect ? SQUELCH_SECONDS * 1000 : 0);
            };
            source.start(startTime);
        });
    }

    _playBrowser(utterance) {
        const synthesis = window.speechSynthesis;

        if (!synthesis || typeof SpeechSynthesisUtterance === 'undefined') {
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            const speech = new SpeechSynthesisUtterance(utterance.text);
            const { pilotVoice } = utterance;

            speech.lang = 'en-GB';

            if (pilotVoice) {
                const voice = synthesis.getVoices().filter((candidate) => candidate.name === pilotVoice.voice)[0];

                if (voice) {
                    speech.voice = voice;
                }

                speech.rate = Number(pilotVoice.rate) || 1;
                speech.pitch = Number(pilotVoice.pitch) || 1;
            }

            const finish = () => {
                window.clearTimeout(this._speechTimer);
                this._cancelCurrent = null;
                resolve();
            };

            this._cancelCurrent = finish;
            speech.onend = finish;
            speech.onerror = finish;
            // some browsers never fire `end`; do not let the queue stall
            this._speechTimer = window.setTimeout(finish, 3000 + (utterance.text.length * 110));
            synthesis.speak(speech);
        });
    }
}

export default new VoiceOutput();
