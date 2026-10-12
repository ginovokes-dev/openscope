/**
 * Configuration for the AI features (LLM pilots and voice)
 *
 * Keys are read from the environment (or a `.env` file in the directory the server is started from):
 *
 *   ANTHROPIC_API_KEY      enables free-text / voice instructions to pilots (Claude)
 *   ELEVENLABS_API_KEY     enables ElevenLabs text-to-speech and speech-to-text
 *
 * Optional:
 *   ATC_LLM_MODEL          Claude model id (default claude-opus-5-5; claude-haiku-5-5 is faster and cheaper)
 *   ATC_LLM_EFFORT         low | medium | high | xhigh | max | none (default low: radio calls must be fast)
 *   ELEVENLABS_VOICE_IDS   comma separated voice ids to use for pilots (default: voices available to the account)
 *   ELEVENLABS_TTS_MODEL   default eleven_flash_v2_5 (lowest latency)
 *   ELEVENLABS_STT_MODEL   default scribe_v1
 *   ANTHROPIC_BASE_URL / ELEVENLABS_BASE_URL   alternative API endpoints (proxies, tests)
 *   ATC_AI_RATE_LIMIT      requests per minute per client for the AI endpoints (default 90)
 *
 * A browser can also supply its own keys per request through the `x-anthropic-key` and `x-elevenlabs-key`
 * headers (the "AI & Voice" dialog does this for people who do not want to edit environment variables).
 * Keys are never logged and never stored by the server.
 */
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
    model: 'claude-opus-5-5',
    effort: 'low',
    ttsModel: 'eleven_flash_v2_5',
    sttModel: 'scribe_v1',
    elevenLabsBaseUrl: 'https://api.elevenlabs.io',
    rateLimitPerMinute: 90
};

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Parse the contents of a `.env` file
 *
 * @function parseDotEnv
 * @param text {string}
 * @return {object}
 */
const parseDotEnv = (text) => {
    const values = {};

    String(text).split(/\r?\n/).forEach((line) => {
        const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);

        if (!match || line.trim().startsWith('#')) {
            return;
        }

        let [, key, value] = match;

        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
            value = value.slice(1, -1);
        }

        values[key] = value;
    });

    return values;
};

/**
 * Load a `.env` file into `process.env` without overriding variables that are already set
 *
 * @function loadDotEnv
 * @param directory {string}
 * @return {boolean} whether a file was found
 */
const loadDotEnv = (directory = process.cwd()) => {
    const file = path.join(directory, '.env');

    if (!fs.existsSync(file)) {
        return false;
    }

    const values = parseDotEnv(fs.readFileSync(file, 'utf8'));

    Object.keys(values).forEach((key) => {
        if (process.env[key] === undefined) {
            process.env[key] = values[key];
        }
    });

    return true;
};

/**
 * Build the configuration object from an environment
 *
 * @function readConfig
 * @param env {object}
 * @return {object}
 */
const readConfig = (env = process.env) => {
    const requestedEffort = (env.ATC_LLM_EFFORT || DEFAULTS.effort).toLowerCase();
    const voiceIds = (env.ELEVENLABS_VOICE_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);

    return {
        anthropicKey: env.ANTHROPIC_API_KEY || '',
        anthropicBaseUrl: env.ANTHROPIC_BASE_URL || undefined,
        model: env.ATC_LLM_MODEL || DEFAULTS.model,
        effort: EFFORT_LEVELS.indexOf(requestedEffort) !== -1 ? requestedEffort : null,
        elevenLabsKey: env.ELEVENLABS_API_KEY || '',
        elevenLabsBaseUrl: (env.ELEVENLABS_BASE_URL || DEFAULTS.elevenLabsBaseUrl).replace(/\/+$/, ''),
        ttsModel: env.ELEVENLABS_TTS_MODEL || DEFAULTS.ttsModel,
        sttModel: env.ELEVENLABS_STT_MODEL || DEFAULTS.sttModel,
        voiceIds,
        rateLimitPerMinute: Number(env.ATC_AI_RATE_LIMIT) > 0 ? Number(env.ATC_AI_RATE_LIMIT) : DEFAULTS.rateLimitPerMinute
    };
};

module.exports = {
    DEFAULTS,
    loadDotEnv,
    parseDotEnv,
    readConfig
};
