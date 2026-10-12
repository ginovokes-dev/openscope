/**
 * ElevenLabs text-to-speech and speech-to-text, called with the platform `fetch` (Node 18+)
 *
 * Pilots get a stable voice: the same voice key (the callsign) always maps to the same voice, with an accent
 * that suits the operator when the account has voices labelled for it.
 */

const FALLBACK_VOICE_IDS = [
    '21m00Tcm4TlvDq8ikWAM',
    'pNInz6obpgDQGcFmaJgB',
    'EXAVITQu4vr4xnSDxMaL',
    'TxGEqnHWrfWFTfGW9XjX',
    'ErXwobaYiN019PkySvjV',
    'VR6AewLTigWG4xSOukaG'
];

/**
 * Preferred accent by airline ICAO prefix. Only airlines whose home country has an accent label ElevenLabs
 * commonly provides are listed; the others get whichever voice the callsign hashes to.
 *
 * @property ACCENT_BY_AIRLINE
 * @type {object}
 * @final
 */
const ACCENT_BY_AIRLINE = {
    british: ['BAW', 'EZY', 'VIR', 'TOM', 'TUI', 'JET', 'LOG', 'BEE', 'EXS', 'SHT', 'CFE', 'RUK', 'NSZ', 'UAF', 'ASCOT', 'RRR'],
    american: ['AAL', 'DAL', 'UAL', 'SWA', 'JBU', 'ASA', 'FDX', 'UPS', 'SKW', 'ENY', 'RPA', 'QXE', 'NKS', 'FFT', 'HAL'],
    australian: ['QFA', 'JST', 'VOZ', 'RXA', 'QLK', 'ANZ'],
    irish: ['RYR', 'EIN', 'EIN', 'CLH', 'STK'],
    german: ['DLH', 'EWG', 'CFG', 'GWI', 'BER', 'TUI'],
    french: ['AFR', 'TVF', 'HOP', 'EZS']
};

const SPEECH_TEXT_LIMIT = 600;

const hashString = (text) => {
    let hash = 2166136261;

    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i); // eslint-disable-line no-bitwise
        hash = Math.imul(hash, 16777619);
    }

    return hash >>> 0; // eslint-disable-line no-bitwise
};

const accentForCallsign = (callsign) => {
    const prefix = String(callsign || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    const accent = Object.keys(ACCENT_BY_AIRLINE).find((name) => ACCENT_BY_AIRLINE[name].indexOf(prefix) !== -1);

    return accent || null;
};

/**
 * Choose a voice id deterministically for a voice key
 *
 * @function chooseVoice
 * @param voiceKey {string} typically the aircraft callsign
 * @param voices {array<object>} `[{ id, name, accent, gender }]`
 * @return {object|null}
 */
const chooseVoice = (voiceKey, voices) => {
    if (!voices || voices.length === 0) {
        return null;
    }

    const accent = accentForCallsign(voiceKey);
    const matching = accent ? voices.filter((voice) => (voice.accent || '').toLowerCase().includes(accent)) : [];
    const pool = matching.length > 0 ? matching : voices;

    return pool[hashString(String(voiceKey)) % pool.length];
};

/**
 * Voice settings with a little variation per pilot so they do not all sound identical
 *
 * @function buildVoiceSettings
 * @param voiceKey {string}
 * @return {object}
 */
const buildVoiceSettings = (voiceKey) => {
    const variation = (hashString(`${voiceKey}:settings`) % 100) / 100;

    return {
        stability: 0.35 + (variation * 0.3),
        similarity_boost: 0.75,
        style: 0.05,
        use_speaker_boost: true,
        speed: 1.05 + ((variation - 0.5) * 0.1)
    };
};

const createClient = ({
    apiKey, baseUrl, ttsModel, sttModel, configuredVoiceIds
}) => {
    let cachedVoices = null;
    let cachedAt = 0;

    const headers = () => ({ 'xi-api-key': apiKey });

    const listVoices = async() => {
        if (configuredVoiceIds && configuredVoiceIds.length > 0) {
            return configuredVoiceIds.map((id) => ({
                id, name: id, accent: '', gender: ''
            }));
        }

        if (cachedVoices && Date.now() - cachedAt < 60 * 60 * 1000) {
            return cachedVoices;
        }

        try {
            const response = await fetch(`${baseUrl}/v1/voices`, { headers: headers() });

            if (response.ok) {
                const body = await response.json();
                const voices = (body.voices || []).map((voice) => ({
                    id: voice.voice_id,
                    name: voice.name,
                    accent: (voice.labels && voice.labels.accent) || '',
                    gender: (voice.labels && voice.labels.gender) || ''
                }));

                if (voices.length > 0) {
                    cachedVoices = voices;
                    cachedAt = Date.now();

                    return voices;
                }
            }
        } catch (error) {
            // fall through to the built-in list
        }

        return FALLBACK_VOICE_IDS.map((id) => ({
            id, name: id, accent: '', gender: ''
        }));
    };

    return {
        listVoices,

        /**
         * @return {Promise<{ ok: boolean, status: number, body: Buffer, error: string }>}
         */
        async synthesize({ text, voiceKey, voiceId }) {
            const clean = String(text || '').trim().slice(0, SPEECH_TEXT_LIMIT);

            if (!clean) {
                return { ok: false, status: 400, error: 'no text to speak' };
            }

            const chosenVoice = voiceId ? { id: voiceId } : chooseVoice(voiceKey || clean, await listVoices());
            const url = `${baseUrl}/v1/text-to-speech/${encodeURIComponent(chosenVoice.id)}?output_format=mp3_44100_64`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { ...headers(), 'content-type': 'application/json', accept: 'audio/mpeg' },
                body: JSON.stringify({
                    text: clean,
                    model_id: ttsModel,
                    voice_settings: buildVoiceSettings(voiceKey || clean)
                })
            });

            if (!response.ok) {
                return { ok: false, status: response.status, error: await describeFailure(response) };
            }

            return {
                ok: true, status: 200, body: Buffer.from(await response.arrayBuffer()), voice: chosenVoice
            };
        },

        /**
         * @return {Promise<{ ok: boolean, status: number, text: string, error: string }>}
         */
        async transcribe({ audio, contentType }) {
            const form = new FormData();

            form.append('model_id', sttModel);
            form.append('tag_audio_events', 'false');
            form.append('diarize', 'false');
            form.append('file', new Blob([audio], { type: contentType || 'audio/webm' }), 'transmission.webm');

            const response = await fetch(`${baseUrl}/v1/speech-to-text`, { method: 'POST', headers: headers(), body: form });

            if (!response.ok) {
                return { ok: false, status: response.status, error: await describeFailure(response) };
            }

            const body = await response.json();

            return { ok: true, status: 200, text: String(body.text || '').trim() };
        }
    };
};

async function describeFailure(response) {
    try {
        const body = await response.json();
        const detail = body && body.detail;

        if (typeof detail === 'string') {
            return detail;
        }

        if (detail && detail.message) {
            return detail.message;
        }
    } catch (error) {
        // body was not JSON
    }

    return `ElevenLabs returned HTTP ${response.status}`;
}

module.exports = {
    FALLBACK_VOICE_IDS,
    SPEECH_TEXT_LIMIT,
    accentForCallsign,
    buildVoiceSettings,
    chooseVoice,
    createClient
};
