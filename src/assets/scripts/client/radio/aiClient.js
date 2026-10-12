/**
 * Browser side of the AI features: talks to the `/api/...` endpoints served by the openScope server
 *
 * API keys can live in the server's `.env` file (nothing to do here), or be typed into the "AI & Voice" dialog,
 * in which case they are kept in this browser's local storage and sent as request headers. They are never part of
 * the game options and never leave the machine except to the server you are playing on.
 */

const KEY_STORAGE = 'openscope.ai.keys';
const PREFERENCE_STORAGE = 'openscope.ai.preferences';
const STATUS_CACHE_MILLISECONDS = 30000;

let cachedStatus = null;
let cachedStatusAt = 0;

const readStorage = (name) => {
    try {
        return JSON.parse(window.localStorage.getItem(name)) || {};
    } catch (error) {
        return {};
    }
};

const writeStorage = (name, value) => {
    try {
        window.localStorage.setItem(name, JSON.stringify(value));

        return true;
    } catch (error) {
        return false;
    }
};

/**
 * @function loadKeys
 * @return {object} `{ anthropic, elevenlabs }`, empty strings when not set
 */
export const loadKeys = () => {
    const stored = readStorage(KEY_STORAGE);

    return { anthropic: stored.anthropic || '', elevenlabs: stored.elevenlabs || '' };
};

/**
 * @function saveKeys
 * @param keys {object} `{ anthropic, elevenlabs }`
 * @return {boolean} false when the browser would not store them
 */
export const saveKeys = (keys) => {
    cachedStatus = null;

    return writeStorage(KEY_STORAGE, {
        anthropic: String(keys.anthropic || '').trim(),
        elevenlabs: String(keys.elevenlabs || '').trim()
    });
};

const DEFAULT_PREFERENCES = {
    // answer controller transmissions with the language model when one is available
    useLanguageModel: true,
    // speak pilot replies with ElevenLabs voices when available (otherwise the browser's own voices)
    useStudioVoices: true,
    // add the radio filter and squelch to spoken audio
    radioEffect: true
};

/**
 * @function loadPreferences
 * @return {object}
 */
export const loadPreferences = () => ({ ...DEFAULT_PREFERENCES, ...readStorage(PREFERENCE_STORAGE) });

/**
 * @function savePreferences
 * @param preferences {object}
 * @return {boolean}
 */
export const savePreferences = (preferences) => writeStorage(PREFERENCE_STORAGE, { ...DEFAULT_PREFERENCES, ...preferences });

const buildHeaders = (extra = {}) => {
    const keys = loadKeys();
    const headers = { ...extra };

    if (keys.anthropic) {
        headers['x-anthropic-key'] = keys.anthropic;
    }

    if (keys.elevenlabs) {
        headers['x-elevenlabs-key'] = keys.elevenlabs;
    }

    return headers;
};

const readError = async(response) => {
    try {
        const body = await response.json();

        if (body && body.error) {
            return body.error;
        }
    } catch (error) {
        // not JSON
    }

    return `The server answered HTTP ${response.status}`;
};

/**
 * What the server can do right now
 *
 * @function fetchStatus
 * @param force {boolean} skip the short cache
 * @return {Promise<object>} `{ llm, voice, model, offline }`; `offline` when the server's API could not be reached
 */
export const fetchStatus = async(force = false) => {
    if (!force && cachedStatus && Date.now() - cachedStatusAt < STATUS_CACHE_MILLISECONDS) {
        return cachedStatus;
    }

    try {
        const response = await fetch('api/status', { headers: buildHeaders() });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        cachedStatus = { offline: false, ...(await response.json()) };
    } catch (error) {
        cachedStatus = {
            offline: true, llm: false, voice: false, model: '', sdk: 'unreachable'
        };
    }

    cachedStatusAt = Date.now();

    return cachedStatus;
};

/**
 * Ask the language model to interpret a transmission
 *
 * @function interpretTransmission
 * @param payload {object} `{ transcript, airport, weather, atis, fixes, sids, stars, aircraft, selectedCallsign, history }`
 * @return {Promise<object>} `{ transmissions, controller_note }`
 * @throws {Error} with a message suitable for showing to the player
 */
export const interpretTransmission = async(payload) => {
    const response = await fetch('api/atc/interpret', {
        method: 'POST',
        headers: buildHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(await readError(response));
    }

    return response.json();
};

/**
 * Plausible NOTAM-style remarks for an airport
 *
 * @function fetchNotams
 * @param details {object} `{ icao, name, country, runways }`
 * @return {Promise<array<string>>}
 */
export const fetchNotams = async(details) => {
    const response = await fetch('api/atc/notams', {
        method: 'POST',
        headers: buildHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify(details)
    });

    if (!response.ok) {
        throw new Error(await readError(response));
    }

    return (await response.json()).remarks || [];
};

/**
 * Speak text with a studio voice; resolves with the encoded audio (mp3)
 *
 * @function synthesizeSpeech
 * @param details {object} `{ text, voiceKey }` the voice key (the callsign) always maps to the same voice
 * @return {Promise<ArrayBuffer>}
 */
export const synthesizeSpeech = async({ text, voiceKey }) => {
    const response = await fetch('api/voice/tts', {
        method: 'POST',
        headers: buildHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ text, voiceKey })
    });

    if (!response.ok) {
        throw new Error(await readError(response));
    }

    return response.arrayBuffer();
};

/**
 * Turn a recording into text
 *
 * @function transcribeAudio
 * @param blob {Blob} recorded audio
 * @return {Promise<string>}
 */
export const transcribeAudio = async(blob) => {
    const response = await fetch('api/voice/stt', {
        method: 'POST',
        headers: buildHeaders({ 'content-type': blob.type || 'audio/webm' }),
        body: blob
    });

    if (!response.ok) {
        throw new Error(await readError(response));
    }

    return (await response.json()).text || '';
};

/**
 * Forget the cached status (after keys change)
 *
 * @function resetStatusCache
 */
export const resetStatusCache = () => {
    cachedStatus = null;
};
